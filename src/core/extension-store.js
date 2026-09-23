const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { WorkspaceError } = require("./errors");
const { atomicWrite, sha256 } = require("./fs");
const { directoryDigest } = require("./directory-digest");
const { SYSTEM_EXTENSION_IDS } = require("./system-extensions");

const STORE_SCHEMA_VERSION = 2;
const LEGACY_STORE_SCHEMA_VERSION = 1;
const STORE_REGISTRY_FILE = ".registry.json";
const STORE_LOCK_DIRECTORY = ".locks";
const STORE_TEMP_PREFIX = ".tmp-";
const ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const SEMVER_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;
const SHA512_SRI_PATTERN = /^sha512-[A-Za-z0-9+/]+={0,2}$/;

function storeError(code, message, details = {}) {
  return new WorkspaceError(code, message, details);
}

function defaultExtensionStoreRoot(options = {}) {
  if (options.storeRoot) return path.resolve(options.storeRoot);
  if (process.env.CODE_WORKSPACE_EXTENSION_STORE) return path.resolve(process.env.CODE_WORKSPACE_EXTENSION_STORE);
  // Node's test runner should not write into a user's persistent data directory.
  if (process.argv.includes("--test") || process.env.NODE_TEST_CONTEXT) return path.join(os.tmpdir(), "code-workspace-extension-store");
  if (process.platform === "darwin") return path.join(os.homedir(), "Library", "Application Support", "Code Workspace", "extensions");
  if (process.platform === "win32") return path.join(process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming"), "Code Workspace", "extensions");
  return path.join(process.env.XDG_DATA_HOME || path.join(os.homedir(), ".local", "share"), "code-workspace", "extensions");
}

function validateId(value, label = "extension") {
  const id = String(value || "");
  if (!ID_PATTERN.test(id)) throw storeError("EXTENSION_STORE_ID_INVALID", `Invalid ${label} id: ${id || "<missing>"}`, { id: id || null });
  return id;
}

function validateVersion(value) {
  const version = String(value || "");
  if (!SEMVER_PATTERN.test(version)) throw storeError("EXTENSION_STORE_VERSION_INVALID", `Invalid extension version: ${version || "<missing>"}`, { version: version || null });
  return version;
}

function packageKey(id, version) {
  return `${validateId(id)}@${validateVersion(version)}`;
}

function packageRoot(storeRoot, id, version) {
  return path.join(defaultExtensionStoreRoot({ storeRoot }), validateId(id), validateVersion(version));
}

function registryPath(storeRoot) {
  return path.join(defaultExtensionStoreRoot({ storeRoot }), STORE_REGISTRY_FILE);
}

function lockPath(storeRoot, id, version) {
  return path.join(defaultExtensionStoreRoot({ storeRoot }), STORE_LOCK_DIRECTORY, `${validateId(id)}@${validateVersion(version)}.lock`);
}

function emptyStoreRegistry() {
  return { schemaVersion: STORE_SCHEMA_VERSION, packages: {} };
}

function normalizeReferences(value) {
  const references = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  return {
    workspaces: Array.isArray(references.workspaces) ? references.workspaces.map(String).filter(Boolean) : [],
    processes: Array.isArray(references.processes) ? references.processes.map(String).filter(Boolean) : [],
    transactions: Array.isArray(references.transactions) ? references.transactions.map(String).filter(Boolean) : [],
    pins: Array.isArray(references.pins) ? references.pins.map(String).filter(Boolean) : [],
  };
}

function normalizeRegistryOrigin(value) {
  const origin = String(value || "").replace(/\/+$/, "");
  try {
    const url = new URL(origin);
    const loopback = url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "[::1]" || url.hostname === "::1";
    if ((url.protocol !== "https:" && !loopback) || url.username || url.password || url.search || url.hash || url.origin !== origin) {
      throw new Error("invalid origin");
    }
  } catch {
    throw storeError("EXTENSION_STORE_PROVENANCE_INVALID", "Nexus provenance registryOrigin must be an HTTPS origin without credentials, query, or fragment", { registryOrigin: origin || null });
  }
  return origin;
}

function normalizeProvenance(value, key = "package") {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw storeError("EXTENSION_STORE_PROVENANCE_INVALID", `Invalid Store provenance for ${key}`, { package: key });
  }
  if (value.kind === "builtin") {
    if (Object.keys(value).length !== 1) throw storeError("EXTENSION_STORE_PROVENANCE_INVALID", `Built-in Store provenance contains unsupported fields for ${key}`, { package: key });
    return Object.freeze({ kind: "builtin" });
  }
  if (value.kind === "nexus-npm") {
    const allowed = new Set(["kind", "registryOrigin", "repository", "packageName", "archiveIntegrity"]);
    const unknown = Object.keys(value).filter((field) => !allowed.has(field));
    if (unknown.length > 0) throw storeError("EXTENSION_STORE_PROVENANCE_INVALID", `Nexus Store provenance contains unsupported field ${unknown[0]} for ${key}`, { package: key, field: unknown[0] });
    const repository = String(value.repository || "");
    const packageName = String(value.packageName || "");
    const archiveIntegrity = String(value.archiveIntegrity || "");
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(repository)) throw storeError("EXTENSION_STORE_PROVENANCE_INVALID", `Invalid Nexus repository in Store provenance for ${key}`, { package: key });
    if (!/^@codew-ext\/[a-z0-9]+(?:-[a-z0-9]+)*$/.test(packageName)) throw storeError("EXTENSION_STORE_PROVENANCE_INVALID", `Invalid npm package name in Store provenance for ${key}`, { package: key });
    if (!SHA512_SRI_PATTERN.test(archiveIntegrity)) throw storeError("EXTENSION_STORE_PROVENANCE_INVALID", `Invalid archive integrity in Store provenance for ${key}`, { package: key });
    return Object.freeze({
      kind: "nexus-npm",
      registryOrigin: normalizeRegistryOrigin(value.registryOrigin),
      repository,
      packageName,
      archiveIntegrity,
    });
  }
  if (value.kind === "local") {
    const allowed = new Set(["kind", "archiveIntegrity"]);
    const unknown = Object.keys(value).filter((field) => !allowed.has(field));
    if (unknown.length > 0) throw storeError("EXTENSION_STORE_PROVENANCE_INVALID", `Local Store provenance contains unsupported field ${unknown[0]} for ${key}`, { package: key, field: unknown[0] });
    const archiveIntegrity = String(value.archiveIntegrity || "");
    if (!SHA512_SRI_PATTERN.test(archiveIntegrity)) throw storeError("EXTENSION_STORE_PROVENANCE_INVALID", `Invalid local archive integrity for ${key}`, { package: key });
    return Object.freeze({ kind: "local", archiveIntegrity });
  }
  throw storeError("EXTENSION_STORE_PROVENANCE_INVALID", `Unsupported Store provenance kind for ${key}: ${value.kind || "<missing>"}`, { package: key, kind: value.kind || null });
}

function provenanceFromOptions(options = {}, key = "package") {
  if (options.provenance) return normalizeProvenance(options.provenance, key);
  const source = options.source || "builtin";
  if (source === "builtin") return Object.freeze({ kind: "builtin" });
  if (source === "nexus-npm" || source === "nexus") {
    throw storeError("EXTENSION_STORE_PROVENANCE_INVALID", `Nexus Store imports require structured provenance for ${key}`, { package: key });
  }
  throw storeError("EXTENSION_STORE_PROVENANCE_INVALID", `Unsupported Store package source for ${key}: ${source}`, { package: key, source });
}

function validatePackageRecord(key, value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw storeError("EXTENSION_STORE_REGISTRY_INVALID", `Invalid Store package record: ${key}`, { package: key });
  const id = validateId(value.id);
  const version = validateVersion(value.version);
  if (packageKey(id, version) !== key || !SHA256_PATTERN.test(value.manifestSha256 || "") || !SHA256_PATTERN.test(value.entrySha256 || "") || !SHA256_PATTERN.test(value.packageSha256 || "")) {
    throw storeError("EXTENSION_STORE_REGISTRY_INVALID", `Invalid Store package digest record: ${key}`, { package: key });
  }
  const provenance = value.provenance
    ? normalizeProvenance(value.provenance, key)
    : Object.freeze({ kind: "builtin" });
  return {
    id,
    version,
    manifestSha256: value.manifestSha256,
    entrySha256: value.entrySha256,
    packageSha256: value.packageSha256,
    source: provenance.kind === "builtin" ? "builtin" : provenance.kind === "local" ? "local" : "nexus",
    provenance,
    importedAt: value.importedAt || null,
    references: normalizeReferences(value.references),
  };
}

function loadStoreRegistry(storeRoot) {
  const file = registryPath(storeRoot);
  if (!fs.existsSync(file)) return emptyStoreRegistry();
  let value;
  try {
    value = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (error) {
    throw storeError("EXTENSION_STORE_REGISTRY_PARSE_FAILED", `Cannot parse Extension Store registry: ${error.message}`, { file });
  }
  if (!value || ![STORE_SCHEMA_VERSION, LEGACY_STORE_SCHEMA_VERSION].includes(value.schemaVersion) || !value.packages || typeof value.packages !== "object" || Array.isArray(value.packages)) {
    throw storeError("EXTENSION_STORE_REGISTRY_INVALID", `Invalid Extension Store registry: ${file}`, { file });
  }
  const packages = {};
  for (const [key, record] of Object.entries(value.packages)) packages[key] = validatePackageRecord(key, record);
  return { schemaVersion: STORE_SCHEMA_VERSION, packages };
}

function saveStoreRegistry(storeRoot, registry) {
  const normalized = emptyStoreRegistry();
  for (const [key, record] of Object.entries(registry?.packages || {})) normalized.packages[key] = validatePackageRecord(key, record);
  const root = defaultExtensionStoreRoot({ storeRoot });
  fs.mkdirSync(root, { recursive: true });
  atomicWrite(path.join(root, STORE_REGISTRY_FILE), `${JSON.stringify(normalized, null, 2)}\n`);
}

function assertDirectory(root, label = "Store package") {
  let stat;
  try { stat = fs.lstatSync(root); } catch (error) { throw storeError("EXTENSION_STORE_PACKAGE_MISSING", `${label} is missing: ${root}`, { path: root, cause: error.code }); }
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw storeError("EXTENSION_STORE_PACKAGE_INVALID", `${label} must be a regular directory: ${root}`, { path: root });
}

function packageRecordFromDirectory(root, options = {}) {
  assertDirectory(root);
  const manifestFile = path.join(root, "manifest.json");
  const manifest = (() => {
    try { return JSON.parse(fs.readFileSync(manifestFile, "utf8")); } catch (error) { throw storeError("EXTENSION_STORE_MANIFEST_INVALID", `Cannot parse Store package manifest: ${error.message}`, { file: manifestFile }); }
  })();
  const id = validateId(options.id || manifest.id);
  const version = validateVersion(options.version || manifest.version);
  if (manifest.id !== id || manifest.version !== version) throw storeError("EXTENSION_STORE_PACKAGE_ID_MISMATCH", `Store package identity does not match ${id}@${version}`, { id, version, actual: { id: manifest.id, version: manifest.version } });
  if (typeof manifest.entry !== "string" || !manifest.entry || manifest.entry.includes("\\") || path.posix.isAbsolute(manifest.entry) || manifest.entry.split("/").some((segment) => !segment || segment === "." || segment === "..")) {
    throw storeError("EXTENSION_STORE_ENTRY_INVALID", `Invalid Store package entry for ${id}@${version}`, { id, version, entry: manifest.entry || null });
  }
  const entryFile = path.resolve(root, ...manifest.entry.split("/"));
  if (!entryFile.startsWith(`${path.resolve(root)}${path.sep}`)) throw storeError("EXTENSION_STORE_ENTRY_INVALID", `Store package entry escapes package root for ${id}@${version}`, { id, version, entry: manifest.entry });
  assertDirectory(root);
  let entryStat;
  try { entryStat = fs.lstatSync(entryFile); } catch { throw storeError("EXTENSION_STORE_ENTRY_MISSING", `Store package entry is missing: ${id}@${version}`, { id, version, entry: manifest.entry }); }
  if (!entryStat.isFile() || entryStat.isSymbolicLink()) throw storeError("EXTENSION_STORE_ENTRY_INVALID", `Store package entry must be a regular file: ${id}@${version}`, { id, version, entry: manifest.entry });
  const manifestBytes = fs.readFileSync(manifestFile);
  const entryBytes = fs.readFileSync(entryFile);
  const manifestSha256 = sha256(manifestBytes);
  const entrySha256 = sha256(entryBytes);
  const packageSha256 = directoryDigest(root);
  if (manifest.entrySha256 && manifest.entrySha256 !== entrySha256) throw storeError("EXTENSION_STORE_ENTRY_HASH_MISMATCH", `Store package entry hash does not match manifest: ${id}@${version}`, { id, version, expectedSha256: manifest.entrySha256, actualSha256: entrySha256 });
  if (options.validate) options.validate(manifest, { id, version, root, manifestFile, entryFile });
  return Object.freeze({ id, version, root: path.resolve(root), manifest, manifestFile, entryFile, manifestSha256, entrySha256, packageSha256 });
}

function acquirePackageLock(storeRoot, id, version) {
  const file = lockPath(storeRoot, id, version);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  try {
    fs.mkdirSync(file);
  } catch (error) {
    if (error.code === "EEXIST") throw storeError("EXTENSION_STORE_LOCKED", `Extension Store package is locked: ${id}@${version}`, { id, version, lock: file });
    throw storeError("EXTENSION_STORE_LOCK_FAILED", `Cannot lock Extension Store package ${id}@${version}: ${error.message}`, { id, version, lock: file, cause: error.code });
  }
  fs.writeFileSync(path.join(file, "owner"), `${process.pid}\n`);
  return () => {
    try { fs.rmSync(file, { recursive: true, force: true }); } catch (error) { throw storeError("EXTENSION_STORE_UNLOCK_FAILED", `Cannot unlock Extension Store package ${id}@${version}: ${error.message}`, { id, version, lock: file }); }
  };
}

function ensureStoredExtensionPackage(options = {}) {
  if (!options.sourceRoot) throw storeError("EXTENSION_STORE_SOURCE_MISSING", "Extension package source is required");
  const sourceRoot = path.resolve(String(options.sourceRoot));
  const source = packageRecordFromDirectory(sourceRoot, options);
  const storeRoot = defaultExtensionStoreRoot(options);
  const target = packageRoot(storeRoot, source.id, source.version);
  const release = acquirePackageLock(storeRoot, source.id, source.version);
  try {
    const existing = fs.existsSync(target);
    const provenance = provenanceFromOptions(options, packageKey(source.id, source.version));
    if (existing) {
      const current = packageRecordFromDirectory(target, { id: source.id, version: source.version, validate: options.validate });
      if (current.packageSha256 !== source.packageSha256) {
        throw storeError("EXTENSION_STORE_PACKAGE_CONFLICT", `Store already contains a different package for ${source.id}@${source.version}`, {
          id: source.id,
          version: source.version,
          expectedSha256: source.packageSha256,
          actualSha256: current.packageSha256,
        });
      }
      const key = packageKey(source.id, source.version);
      const registry = loadStoreRegistry(storeRoot);
      const previous = registry.packages[key];
      registry.packages[key] = {
        id: source.id,
        version: source.version,
        manifestSha256: current.manifestSha256,
        entrySha256: current.entrySha256,
        packageSha256: current.packageSha256,
        source: previous?.source || (provenance.kind === "builtin" ? "builtin" : "nexus"),
        provenance: previous?.provenance || provenance,
        importedAt: previous?.importedAt || new Date().toISOString(),
        references: previous?.references || normalizeReferences(),
      };
      saveStoreRegistry(storeRoot, registry);
      return { ...current, source: registry.packages[key].source, provenance: registry.packages[key].provenance };
    }
    const root = path.dirname(path.dirname(target));
    fs.mkdirSync(root, { recursive: true });
    const temporary = path.join(root, `${STORE_TEMP_PREFIX}${source.id}-${source.version}-${process.pid}-${Date.now()}`);
    try {
      fs.cpSync(source.root, temporary, { recursive: true, errorOnExist: true, force: false });
      const copied = packageRecordFromDirectory(temporary, { id: source.id, version: source.version, validate: options.validate });
      if (copied.packageSha256 !== source.packageSha256) throw storeError("EXTENSION_STORE_PACKAGE_CONFLICT", `Copied package digest changed for ${source.id}@${source.version}`, { id: source.id, version: source.version, expectedSha256: source.packageSha256, actualSha256: copied.packageSha256 });
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.renameSync(temporary, target);
      const registry = loadStoreRegistry(storeRoot);
      registry.packages[packageKey(source.id, source.version)] = {
        id: source.id,
        version: source.version,
        manifestSha256: copied.manifestSha256,
        entrySha256: copied.entrySha256,
        packageSha256: copied.packageSha256,
        source: provenance.kind === "builtin" ? "builtin" : provenance.kind === "local" ? "local" : "nexus",
        provenance,
        importedAt: new Date().toISOString(),
        references: registry.packages[packageKey(source.id, source.version)]?.references || normalizeReferences(),
      };
      saveStoreRegistry(storeRoot, registry);
      const imported = packageRecordFromDirectory(target, { id: source.id, version: source.version, validate: options.validate });
      return { ...imported, source: registry.packages[packageKey(source.id, source.version)].source, provenance };
    } finally {
      if (fs.existsSync(temporary)) fs.rmSync(temporary, { recursive: true, force: true });
    }
  } finally {
    release();
  }
}

function importBuiltInExtensionPackage(options = {}) {
  if (!options.extensionsRoot) throw storeError("EXTENSION_STORE_SOURCE_MISSING", "Built-in extensions root is required");
  const extensionsRoot = path.resolve(String(options.extensionsRoot));
  const id = validateId(options.id);
  if (!SYSTEM_EXTENSION_IDS.has(id)) {
    throw storeError(
      "EXTENSION_BUILTIN_SOURCE_UNSUPPORTED",
      `Ordinary extension ${id} is not available from the built-in Store importer.`,
      { id, remediation: "Import the extension from the configured Nexus Registry." }
    );
  }
  const version = validateVersion(options.version);
  return ensureStoredExtensionPackage({
    ...options,
    sourceRoot: path.join(extensionsRoot, id, version),
    id,
    version,
    source: "builtin",
  });
}

function updatePackageReferences(storeRoot, id, version, mutate) {
  const registry = loadStoreRegistry(storeRoot);
  const key = packageKey(id, version);
  const record = registry.packages[key];
  if (!record) throw storeError("EXTENSION_STORE_PACKAGE_NOT_REGISTERED", `Store package is not registered: ${key}`, { id, version });
  record.references = normalizeReferences(mutate(record.references));
  registry.packages[key] = record;
  saveStoreRegistry(storeRoot, registry);
  return record;
}

function addPackageReference(storeRoot, id, version, type, value) {
  if (!["workspaces", "processes", "transactions", "pins"].includes(type)) throw storeError("EXTENSION_STORE_REFERENCE_INVALID", `Unsupported Store reference type: ${type}`, { type });
  return updatePackageReferences(storeRoot, id, version, (references) => ({ ...references, [type]: [...new Set([...references[type], String(value)])] }));
}

function removePackageReference(storeRoot, id, version, type, value) {
  if (!["workspaces", "processes", "transactions", "pins"].includes(type)) throw storeError("EXTENSION_STORE_REFERENCE_INVALID", `Unsupported Store reference type: ${type}`, { type });
  return updatePackageReferences(storeRoot, id, version, (references) => ({ ...references, [type]: references[type].filter((entry) => entry !== String(value)) }));
}

function replaceWorkspaceReference(storeRoot, id, version, workspace) {
  const workspaceId = path.resolve(workspace);
  const registry = loadStoreRegistry(storeRoot);
  for (const record of Object.values(registry.packages)) record.references.workspaces = record.references.workspaces.filter((entry) => entry !== workspaceId || record.id !== id);
  const key = packageKey(id, version);
  if (!registry.packages[key]) throw storeError("EXTENSION_STORE_PACKAGE_NOT_REGISTERED", `Store package is not registered: ${key}`, { id, version });
  registry.packages[key].references.workspaces = [...new Set([...registry.packages[key].references.workspaces, workspaceId])];
  saveStoreRegistry(storeRoot, registry);
  return registry.packages[key];
}

function removeWorkspaceReference(storeRoot, id, version, workspace) {
  return removePackageReference(storeRoot, id, version, "workspaces", path.resolve(workspace));
}

function packageHasReferences(record) {
  return Object.values(normalizeReferences(record.references)).some((entries) => entries.length > 0);
}

function gcExtensionPackages(storeRoot, options = {}) {
  const root = defaultExtensionStoreRoot({ storeRoot });
  const registry = loadStoreRegistry(root);
  const removed = [];
  const kept = [];
  for (const [key, record] of Object.entries(registry.packages)) {
    const target = packageRoot(root, record.id, record.version);
    const lock = lockPath(root, record.id, record.version);
    if (packageHasReferences(record) || fs.existsSync(lock)) {
      kept.push(key);
      continue;
    }
    if (!options.dryRun) {
      if (fs.existsSync(target)) fs.rmSync(target, { recursive: true, force: true });
      delete registry.packages[key];
    }
    removed.push(key);
  }
  if (!options.dryRun) saveStoreRegistry(root, registry);
  return { removed, kept, dryRun: options.dryRun === true };
}

function listPackageReferences(storeRoot, options = {}) {
  const registry = loadStoreRegistry(storeRoot);
  return Object.values(registry.packages)
    .filter((record) => !options.id || record.id === options.id)
    .filter((record) => !options.version || record.version === options.version)
    .map((record) => ({ ...record, references: normalizeReferences(record.references) }));
}

module.exports = {
  STORE_SCHEMA_VERSION,
  STORE_REGISTRY_FILE,
  defaultExtensionStoreRoot,
  packageKey,
  packageRoot,
  registryPath,
  lockPath,
  emptyStoreRegistry,
  loadStoreRegistry,
  saveStoreRegistry,
  packageRecordFromDirectory,
  ensureStoredExtensionPackage,
  importBuiltInExtensionPackage,
  addPackageReference,
  removePackageReference,
  replaceWorkspaceReference,
  removeWorkspaceReference,
  listPackageReferences,
  gcExtensionPackages,
};
