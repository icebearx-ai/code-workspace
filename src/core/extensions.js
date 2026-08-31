const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const { OBSOLETE_ASSETS } = require("./assets");
const { CONFIG_FILE, LOCAL_DIRECTORY, STATE_FILE, configPath } = require("./config");
const { WorkspaceError } = require("./errors");
const { atomicWrite, sha256 } = require("./fs");
const { loadManagedManifest } = require("./managed-files");
const { permissionTargets } = require("./permissions");
const { createFileTransaction } = require("./transaction");
const { directoryDigest } = require("./directory-digest");
const {
  hooksCurrent,
  hookDeclarationKeys,
  hookDeclarationsForTools,
  validateHookDeclarations,
  verifyHookTransition,
} = require("./hooks");
const {
  ARTIFACT_KINDS,
  LEGACY_ARTIFACT_KINDS,
  directoryArtifacts,
  installedArtifactsCurrent,
  installedRecord,
  planArtifactTransition,
  removeEmptyParents,
  targetForArtifact,
  verifyArtifactTransition,
} = require("./extension-artifacts");

const PACKAGE_ROOT = path.resolve(__dirname, "..", "..");
const EXTENSIONS_ROOT = path.join(PACKAGE_ROOT, "extensions");
const EXTENSION_STATE_FILE = "ext-manifest.json";
const EXTENSION_NAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const SUPPORTED_TOOLS = new Set(["claude", "codex"]);
const SUPPORTED_EXTENSION_SPEC_VERSIONS = Object.freeze([1]);
const SEMVER_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;

function extensionError(code, message, details = {}) {
  return new WorkspaceError(code, message, details);
}

function parseSemver(value) {
  const text = String(value || "").trim();
  const match = text.match(SEMVER_PATTERN);
  if (!match) throw extensionError("EXTENSION_SEMVER_INVALID", `Invalid semantic version: ${value}`, { version: value });
  const prerelease = match[4] ? match[4].split(".") : [];
  for (const identifier of prerelease) {
    if (/^\d+$/.test(identifier) && identifier.length > 1 && identifier.startsWith("0")) {
      throw extensionError("EXTENSION_SEMVER_INVALID", `Invalid semantic version: ${value}`, { version: value });
    }
  }
  return {
    raw: text,
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease,
    build: match[5] ? match[5].split(".") : [],
  };
}

function compareIdentifiers(left, right) {
  const leftNumeric = /^\d+$/.test(left);
  const rightNumeric = /^\d+$/.test(right);
  if (leftNumeric && rightNumeric) return Number(left) - Number(right);
  if (leftNumeric) return -1;
  if (rightNumeric) return 1;
  return left < right ? -1 : left > right ? 1 : 0;
}

function compareSemver(leftValue, rightValue) {
  const left = typeof leftValue === "string" ? parseSemver(leftValue) : leftValue;
  const right = typeof rightValue === "string" ? parseSemver(rightValue) : rightValue;
  for (const key of ["major", "minor", "patch"]) {
    if (left[key] !== right[key]) return left[key] < right[key] ? -1 : 1;
  }
  if (left.prerelease.length === 0 || right.prerelease.length === 0) {
    return left.prerelease.length === right.prerelease.length ? 0 : left.prerelease.length === 0 ? 1 : -1;
  }
  const length = Math.max(left.prerelease.length, right.prerelease.length);
  for (let index = 0; index < length; index += 1) {
    if (left.prerelease[index] === undefined) return -1;
    if (right.prerelease[index] === undefined) return 1;
    const compared = compareIdentifiers(left.prerelease[index], right.prerelease[index]);
    if (compared !== 0) return compared < 0 ? -1 : 1;
  }
  return 0;
}

function supportsExtensionSpec(version, supportedVersions = SUPPORTED_EXTENSION_SPEC_VERSIONS) {
  return Number.isInteger(version) && supportedVersions.includes(version);
}

function validateExtensionName(value, label = "extension") {
  const name = String(value || "");
  if (!EXTENSION_NAME_PATTERN.test(name)) {
    throw extensionError("EXTENSION_NAME_INVALID", `Invalid ${label} name: ${name || "<missing>"}`, { extension: name || null });
  }
  return name;
}

function normalizeArtifactTarget(value) {
  const target = String(value || "");
  const segments = target.split("/");
  if (
    !target || target.includes("\\") || path.posix.isAbsolute(target) ||
    segments.some((segment) => !segment || segment === "." || segment === "..") ||
    path.posix.normalize(target) !== target
  ) {
    throw extensionError("EXTENSION_ARTIFACT_TARGET_INVALID", `Invalid extension artifact target: ${target || "<missing>"}`, { target: target || null });
  }
  return target;
}

function targetPathsOverlap(left, right) {
  return left === right || left.startsWith(`${right}/`) || right.startsWith(`${left}/`);
}

function selectorPathsOverlap(left, right) {
  return left === right || left.startsWith(`${right}/`) || right.startsWith(`${left}/`);
}

function artifactOwnership(artifact) {
  const kind = artifact.kind || "file";
  return ["file", "directory"].includes(kind) ? "exclusive" : "shared";
}

function sharedArtifactFamily(artifact) {
  const kind = artifact.kind || "file";
  if (["text-block", "codex-config-block"].includes(kind)) return "text";
  if (kind === "json-member") return "json";
  return kind;
}

function artifactsConflict(left, right) {
  if (!targetPathsOverlap(left.target, right.target)) return false;
  if (left.target !== right.target) return true;
  if (artifactOwnership(left) === "exclusive" || artifactOwnership(right) === "exclusive") return true;
  const leftFamily = sharedArtifactFamily(left);
  const rightFamily = sharedArtifactFamily(right);
  if (leftFamily !== rightFamily) return true;
  if (leftFamily === "json") return selectorPathsOverlap(left.selector, right.selector);
  return false;
}

function targetIsProtected(target, protectedTargets, exclusive) {
  return exclusive
    ? [...protectedTargets].some((protectedTarget) => targetPathsOverlap(target, protectedTarget))
    : protectedTargets.has(target);
}

function coreWholeFileTargets() {
  const manifest = loadManagedManifest();
  return new Set([
    `${LOCAL_DIRECTORY}/${CONFIG_FILE}`,
    `${LOCAL_DIRECTORY}/${STATE_FILE}`,
    `${LOCAL_DIRECTORY}/${EXTENSION_STATE_FILE}`,
    ...manifest.managedFiles.map((entry) => entry.target),
    ...OBSOLETE_ASSETS,
  ]);
}

function coreManagedTargets() {
  const root = path.parse(PACKAGE_ROOT).root;
  return new Set([
    ...coreWholeFileTargets(),
    ".gitignore",
    ...permissionTargets(root, ["claude", "codex"]).map((target) => path.relative(root, target).split(path.sep).join("/")),
  ]);
}

function assertOnlyKeys(value, allowed, code, label) {
  const unknown = Object.keys(value).filter((key) => !allowed.has(key));
  if (unknown.length > 0) throw extensionError(code, `${label} contains unsupported field ${unknown[0]}`, { field: unknown[0] });
}

function validateOutputTools(value, id, outputId) {
  if (value === undefined) return null;
  if (!Array.isArray(value) || value.length === 0 || new Set(value).size !== value.length || value.some((tool) => !SUPPORTED_TOOLS.has(tool))) {
    throw extensionError("EXTENSION_MANIFEST_INVALID", `Extension ${id} output ${outputId} has invalid tools`, { extension: id, output: outputId });
  }
  return Object.freeze(value.slice());
}

function validateNetworkHosts(value, id) {
  if (value === undefined) return Object.freeze([]);
  if (!Array.isArray(value) || value.length === 0 || new Set(value).size !== value.length) {
    throw extensionError("EXTENSION_MANIFEST_INVALID", `Extension ${id} has invalid networkHosts`, { extension: id });
  }
  const hosts = value.map((entry) => String(entry || ""));
  for (const host of hosts) {
    let parsed;
    try { parsed = new URL(`https://${host}`); } catch { throw extensionError("EXTENSION_MANIFEST_INVALID", `Extension ${id} has invalid network host ${host || "<missing>"}`, { extension: id, host: host || null }); }
    if (!host || host !== host.toLowerCase() || parsed.hostname !== host || parsed.port || parsed.pathname !== "/" || parsed.search || parsed.hash) {
      throw extensionError("EXTENSION_MANIFEST_INVALID", `Extension ${id} has invalid network host ${host || "<missing>"}`, { extension: id, host: host || null });
    }
  }
  return Object.freeze(hosts);
}

function validateManifestEnvelope(value, options = {}) {
  const manifest = value;
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
    throw extensionError("EXTENSION_MANIFEST_INVALID", "Extension manifest must be a JSON object");
  }
  if (!Number.isInteger(manifest.extensionSpecVersion) || manifest.extensionSpecVersion < 1) {
    throw extensionError("EXTENSION_MANIFEST_INVALID", "Extension manifest requires a positive integer extensionSpecVersion", { extensionSpecVersion: manifest.extensionSpecVersion ?? null });
  }
  const id = validateExtensionName(manifest.id);
  if (options.expectedId && id !== options.expectedId) {
    throw extensionError("EXTENSION_MANIFEST_ID_MISMATCH", `Extension manifest id ${id} does not match directory ${options.expectedId}`, { extension: id, expected: options.expectedId });
  }
  if (typeof manifest.name !== "string" || !manifest.name.trim() || [...manifest.name.trim()].length > 100) {
    throw extensionError("EXTENSION_MANIFEST_INVALID", `Extension ${id} has an invalid display name`, { extension: id });
  }
  const version = parseSemver(manifest.version).raw;
  if (options.expectedVersion && version !== options.expectedVersion) {
    throw extensionError("EXTENSION_MANIFEST_VERSION_MISMATCH", `Extension manifest version ${version} does not match directory ${options.expectedVersion}`, { extension: id, version, expected: options.expectedVersion });
  }
  return Object.freeze({
    extensionSpecVersion: manifest.extensionSpecVersion,
    id,
    name: manifest.name.trim(),
    version,
  });
}

function validateManifest(value, options = {}) {
  const manifest = value;
  const envelope = validateManifestEnvelope(manifest, options);
  const supportedVersions = options.supportedExtensionSpecVersions || SUPPORTED_EXTENSION_SPEC_VERSIONS;
  if (!supportsExtensionSpec(envelope.extensionSpecVersion, supportedVersions)) {
    throw extensionError("EXTENSION_SPEC_UNSUPPORTED", `Extension ${envelope.id}@${envelope.version} requires unsupported Extension Spec ${envelope.extensionSpecVersion}`, {
      extension: envelope.id,
      version: envelope.version,
      extensionSpecVersion: envelope.extensionSpecVersion,
      supportedExtensionSpecVersions: [...supportedVersions],
    });
  }
  assertOnlyKeys(manifest, new Set(["schemaVersion", "extensionSpecVersion", "experimental", "id", "name", "version", "entry", "entrySha256", "timeoutMs", "capabilities", "outputs", "hooks"]), "EXTENSION_MANIFEST_INVALID", "Extension manifest");
  if (manifest.schemaVersion !== 3 || manifest.experimental !== true) {
    throw extensionError("EXTENSION_MANIFEST_INVALID", "Extension Spec v1 manifest must use schemaVersion 3 and experimental true");
  }
  const { id, version } = envelope;
  if (manifest.entry !== "init.js") {
    throw extensionError("EXTENSION_MANIFEST_INVALID", `Extension ${id} entry must be init.js`, { extension: id, entry: manifest.entry });
  }
  if (!SHA256_PATTERN.test(manifest.entrySha256 || "")) {
    throw extensionError("EXTENSION_MANIFEST_INVALID", `Extension ${id} entrySha256 is invalid`, { extension: id });
  }
  if (!Number.isInteger(manifest.timeoutMs) || manifest.timeoutMs < 1 || manifest.timeoutMs > 300000) {
    throw extensionError("EXTENSION_MANIFEST_INVALID", `Extension ${id} timeoutMs must be an integer from 1 to 300000`, { extension: id, timeoutMs: manifest.timeoutMs });
  }
  const capabilities = manifest.capabilities === undefined ? {} : manifest.capabilities;
  if (!capabilities || typeof capabilities !== "object" || Array.isArray(capabilities)) {
    throw extensionError("EXTENSION_MANIFEST_INVALID", `Extension ${id} capabilities must be an object`, { extension: id });
  }
  assertOnlyKeys(capabilities, new Set(["networkHosts"]), "EXTENSION_MANIFEST_INVALID", `Extension ${id} capabilities`);
  const networkHosts = validateNetworkHosts(capabilities.networkHosts, id);
  const hooks = validateHookDeclarations(manifest.hooks, id);
  if (manifest.outputs !== undefined && !Array.isArray(manifest.outputs)) {
    throw extensionError("EXTENSION_MANIFEST_INVALID", `Extension ${id} outputs must be an array`, { extension: id });
  }
  if ((!Array.isArray(manifest.outputs) || manifest.outputs.length === 0) && hooks.length === 0) {
    throw extensionError("EXTENSION_MANIFEST_INVALID", `Extension ${id} must declare at least one output or Hook`, { extension: id });
  }
  const ids = new Set();
  const declaredArtifacts = [];
  const exclusiveProtectedTargets = options.protectedTargets || coreManagedTargets();
  const sharedProtectedTargets = options.protectedTargets || coreWholeFileTargets();
  const outputs = (manifest.outputs || []).map((output) => {
    if (!output || typeof output !== "object" || Array.isArray(output)) {
      throw extensionError("EXTENSION_MANIFEST_INVALID", `Extension ${id} contains an invalid output`, { extension: id });
    }
    assertOnlyKeys(output, new Set(["id", "kind", "ownership", "target", "selector", "format", "tools"]), "EXTENSION_MANIFEST_INVALID", `Extension ${id} output`);
    const outputId = validateExtensionName(output.id, "output");
    const kind = String(output.kind || "");
    if (!ARTIFACT_KINDS.has(kind)) throw extensionError("EXTENSION_MANIFEST_INVALID", `Extension ${id} output ${outputId} has unsupported kind ${kind || "<missing>"}`, { extension: id, output: outputId, kind: kind || null });
    const ownership = String(output.ownership || "");
    const expectedOwnership = ["file", "directory"].includes(kind) ? "exclusive" : "shared";
    if (ownership !== expectedOwnership) {
      throw extensionError("EXTENSION_MANIFEST_INVALID", `Extension ${id} output ${outputId} must use ${expectedOwnership} ownership`, { extension: id, output: outputId, kind, ownership: ownership || null });
    }
    const target = normalizeArtifactTarget(output.target);
    const protectedTargets = expectedOwnership === "exclusive" ? exclusiveProtectedTargets : sharedProtectedTargets;
    if (targetIsProtected(target, protectedTargets, expectedOwnership === "exclusive")) throw extensionError("EXTENSION_CORE_TARGET_FORBIDDEN", `Extension ${id} cannot target Code Workspace core path ${target}`, { extension: id, output: outputId, target });
    if (ids.has(outputId)) throw extensionError("EXTENSION_ARTIFACT_DUPLICATE", `Extension ${id} repeats output id ${outputId}`, { extension: id, output: outputId });
    let selector;
    if (kind === "json-member") {
      selector = String(output.selector || "");
      if (!selector.startsWith("/") || selector === "/" || selector.split("/").slice(1).some((segment) => !segment || /~(?![01])/.test(segment))) {
        throw extensionError("EXTENSION_MANIFEST_INVALID", `Extension ${id} output ${outputId} has invalid JSON selector`, { extension: id, output: outputId, selector: selector || null });
      }
    } else if (output.selector !== undefined) {
      throw extensionError("EXTENSION_MANIFEST_INVALID", `Extension ${id} output ${outputId} cannot declare selector for ${kind}`, { extension: id, output: outputId, kind });
    }
    let format;
    if (kind === "text-block") {
      format = output.format === undefined ? "text" : String(output.format);
      if (!["text", "toml"].includes(format)) throw extensionError("EXTENSION_MANIFEST_INVALID", `Extension ${id} output ${outputId} has unsupported text format ${format}`, { extension: id, output: outputId, format });
    } else if (output.format !== undefined) {
      throw extensionError("EXTENSION_MANIFEST_INVALID", `Extension ${id} output ${outputId} cannot declare format for ${kind}`, { extension: id, output: outputId, kind });
    }
    const tools = validateOutputTools(output.tools, id, outputId);
    const normalized = { id: outputId, kind, ownership, target, ...(selector ? { selector } : {}), ...(format ? { format } : {}), ...(tools ? { tools } : {}) };
    const conflicting = declaredArtifacts.find((artifact) => artifactsConflict(artifact, normalized));
    if (conflicting) {
      throw extensionError("EXTENSION_TARGET_CONFLICT", `Extension ${id} outputs ${conflicting.id} and ${outputId} have overlapping ownership`, {
        extension: id,
        output: outputId,
        conflictingOutput: conflicting.id,
        target,
        ...(selector ? { selector } : {}),
      });
    }
    ids.add(outputId);
    declaredArtifacts.push(normalized);
    return Object.freeze(normalized);
  });
  return Object.freeze({
    schemaVersion: 3,
    extensionSpecVersion: envelope.extensionSpecVersion,
    experimental: true,
    id,
    name: envelope.name,
    version,
    entry: manifest.entry,
    entrySha256: manifest.entrySha256,
    timeoutMs: manifest.timeoutMs,
    capabilities: Object.freeze({ networkHosts }),
    outputs: Object.freeze(outputs),
    hooks,
  });
}

function readJson(file, code) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (error) {
    throw extensionError(code, `Cannot parse ${file}: ${error.message}`, { file });
  }
}

function assertRegularFile(file, code, label) {
  let stat;
  try {
    stat = fs.lstatSync(file);
  } catch {
    throw extensionError(code, `Missing ${label}: ${file}`, { file });
  }
  if (!stat.isFile() || stat.isSymbolicLink()) throw extensionError(code, `${label} must be a regular file: ${file}`, { file });
}

function discoverExtensionEntry(extensionsRoot, extensionEntry, supportedExtensionSpecVersions, options = {}) {
    if (!extensionEntry.isDirectory() || extensionEntry.isSymbolicLink()) {
      throw extensionError("EXTENSION_REPOSITORY_INVALID", `Extension repository entry must be a directory: ${extensionEntry.name}`, { entry: extensionEntry.name });
    }
    const id = validateExtensionName(extensionEntry.name);
    const extensionRoot = path.join(extensionsRoot, id);
    const versionEntries = fs.readdirSync(extensionRoot, { withFileTypes: true }).filter((entry) => !entry.name.startsWith("."));
    if (versionEntries.length === 0) throw extensionError("EXTENSION_REPOSITORY_INVALID", `Extension ${id} contains no versions`, { extension: id });
    const versions = [];
    for (const versionEntry of versionEntries) {
      if (!versionEntry.isDirectory() || versionEntry.isSymbolicLink()) {
        throw extensionError("EXTENSION_REPOSITORY_INVALID", `Extension version entry must be a directory: ${id}/${versionEntry.name}`, { extension: id, version: versionEntry.name });
      }
      const version = parseSemver(versionEntry.name).raw;
      const sourceRoot = path.join(extensionRoot, version);
      const manifestFile = path.join(sourceRoot, "manifest.json");
      assertRegularFile(manifestFile, "EXTENSION_MANIFEST_MISSING", "extension manifest");
      const manifestBytes = fs.readFileSync(manifestFile);
      const rawManifest = readJson(manifestFile, "EXTENSION_MANIFEST_PARSE_FAILED");
      const envelope = validateManifestEnvelope(rawManifest, { expectedId: id, expectedVersion: version });
      if (!supportsExtensionSpec(envelope.extensionSpecVersion, supportedExtensionSpecVersions)) {
        versions.push(Object.freeze({
          id,
          version,
          sourceRoot,
          manifestFile,
          manifest: envelope,
          manifestSha256: sha256(manifestBytes),
          extensionSpecVersion: envelope.extensionSpecVersion,
          supported: false,
        }));
        continue;
      }
      const manifest = validateManifest(rawManifest, {
        expectedId: id,
        expectedVersion: version,
        supportedExtensionSpecVersions,
        ...(options.protectedTargets ? { protectedTargets: options.protectedTargets } : {}),
      });
      const entryFile = path.join(sourceRoot, ...manifest.entry.split("/"));
      assertRegularFile(entryFile, "EXTENSION_ENTRY_MISSING", "extension entry");
      const entrySha256 = sha256(fs.readFileSync(entryFile));
      if (entrySha256 !== manifest.entrySha256) {
        throw extensionError("EXTENSION_ENTRY_HASH_MISMATCH", `Extension entry hash mismatch: ${id}@${version}`, { extension: id, version, expectedSha256: manifest.entrySha256, actualSha256: entrySha256 });
      }
      const packageSha256 = directoryDigest(sourceRoot);
      versions.push(Object.freeze({
        id,
        version,
        sourceRoot,
        manifestFile,
        entryFile,
        manifest,
        manifestSha256: sha256(manifestBytes),
        entrySha256,
        packageSha256,
        extensionSpecVersion: manifest.extensionSpecVersion,
        supported: true,
      }));
    }
    versions.sort((left, right) => compareSemver(right.version, left.version));
    const latestSupported = versions.find((entry) => entry.supported) || null;
    return Object.freeze({
      id,
      name: (latestSupported || versions[0]).manifest.name,
      versions: Object.freeze(versions),
      latestSupported,
    });
}

function discoverExtensions(options = {}) {
  const extensionsRoot = path.resolve(options.extensionsRoot || EXTENSIONS_ROOT);
  const supportedExtensionSpecVersions = Object.freeze([...(options.supportedExtensionSpecVersions || SUPPORTED_EXTENSION_SPEC_VERSIONS)]);
  if (!fs.existsSync(extensionsRoot)) return options.tolerant ? { catalog: [], invalid: [] } : [];
  const entries = fs.readdirSync(extensionsRoot, { withFileTypes: true }).filter((entry) => !entry.name.startsWith("."));
  const catalog = [];
  const invalid = [];
  for (const extensionEntry of entries) {
    try {
      catalog.push(discoverExtensionEntry(extensionsRoot, extensionEntry, supportedExtensionSpecVersions, options));
    } catch (error) {
      if (!options.tolerant) throw error;
      invalid.push({ id: EXTENSION_NAME_PATTERN.test(extensionEntry.name) ? extensionEntry.name : null, entry: extensionEntry.name, code: error.code || "EXTENSION_REPOSITORY_INVALID", message: error.message });
    }
  }
  catalog.sort((left, right) => left.id.localeCompare(right.id));
  invalid.sort((left, right) => left.entry.localeCompare(right.entry));
  return options.tolerant ? { catalog, invalid } : catalog;
}

function extensionStatePath(root) {
  return path.join(path.resolve(root), LOCAL_DIRECTORY, EXTENSION_STATE_FILE);
}

function emptyExtensionState() {
  return { schemaVersion: 1, experimental: true, extensions: {} };
}

function validateInstalledState(id, installed) {
  if (installed === null) return null;
  if (!installed || typeof installed !== "object" || Array.isArray(installed)) throw extensionError("EXTENSION_STATE_INVALID", `Invalid installed state for ${id}`, { extension: id });
  parseSemver(installed.version);
  if (!SHA256_PATTERN.test(installed.manifestSha256 || "") || !Array.isArray(installed.artifacts)) {
    throw extensionError("EXTENSION_STATE_INVALID", `Invalid installed state for ${id}`, { extension: id });
  }
  const protocolVersion = installed.protocolVersion || 1;
  if (![1, 2, 3].includes(protocolVersion) || (protocolVersion >= 2 && !SHA256_PATTERN.test(installed.packageSha256 || ""))) {
    throw extensionError("EXTENSION_STATE_INVALID", `Invalid installed protocol state for ${id}`, { extension: id, protocolVersion });
  }
  if (protocolVersion === 3 && (!Number.isInteger(installed.extensionSpecVersion) || installed.extensionSpecVersion < 1)) {
    throw extensionError("EXTENSION_STATE_INVALID", `Installed protocol v3 state for ${id} requires extensionSpecVersion`, { extension: id, extensionSpecVersion: installed.extensionSpecVersion ?? null });
  }
  const ids = new Set();
  const declaredArtifacts = [];
  const exclusiveProtectedTargets = coreManagedTargets();
  const sharedProtectedTargets = coreWholeFileTargets();
  for (const artifact of installed.artifacts) {
    const artifactId = validateExtensionName(artifact?.id, "artifact");
    if (ids.has(artifactId)) throw extensionError("EXTENSION_STATE_INVALID", `Duplicate installed artifact id for ${id}: ${artifactId}`, { extension: id, artifact: artifactId });
    ids.add(artifactId);
    if (!SHA256_PATTERN.test(artifact.installedSha256 || "")) throw extensionError("EXTENSION_STATE_INVALID", `Invalid installed artifact state for ${id}`, { extension: id });
    const kind = artifact.kind || "file";
    if (!ARTIFACT_KINDS.has(kind) && !LEGACY_ARTIFACT_KINDS.has(kind)) throw extensionError("EXTENSION_STATE_INVALID", `Invalid installed artifact kind for ${id}: ${kind}`, { extension: id, kind });
    const target = normalizeArtifactTarget(artifact.target);
    if (target !== targetForArtifact({ ...artifact, kind })) throw extensionError("EXTENSION_STATE_INVALID", `Installed extension ${id} has an invalid target for ${kind}`, { extension: id, target, kind });
    const protectedTargets = ["file", "directory"].includes(kind) ? exclusiveProtectedTargets : sharedProtectedTargets;
    if (ARTIFACT_KINDS.has(kind) && targetIsProtected(target, protectedTargets, ["file", "directory"].includes(kind))) throw extensionError("EXTENSION_STATE_INVALID", `Installed extension ${id} claims core target ${target}`, { extension: id, target });
    if (protocolVersion === 1 && !["file", ...LEGACY_ARTIFACT_KINDS].includes(kind)) {
      throw extensionError("EXTENSION_STATE_INVALID", `Installed protocol v1 state for ${id} cannot contain ${kind}`, { extension: id, artifact: artifactId, kind });
    }
    if (protocolVersion >= 2) {
      const expectedOwnership = ["file", "directory"].includes(kind) ? "exclusive" : "shared";
      if (artifact.ownership !== expectedOwnership) throw extensionError("EXTENSION_STATE_INVALID", `Invalid installed ownership for ${id}/${artifactId}`, { extension: id, artifact: artifactId, kind, ownership: artifact.ownership });
    } else if (kind === "file" && artifact.ownership !== undefined && artifact.ownership !== "exclusive") {
      throw extensionError("EXTENSION_STATE_INVALID", `Invalid legacy file ownership for ${id}/${artifactId}`, { extension: id, artifact: artifactId, ownership: artifact.ownership });
    }
    if (kind === "text-block" && !["text", "toml"].includes(artifact.format || "text")) {
      throw extensionError("EXTENSION_STATE_INVALID", `Invalid installed text block for ${id}/${artifactId}`, { extension: id, artifact: artifactId });
    }
    if (kind === "json-member" && (typeof artifact.selector !== "string" || !Object.prototype.hasOwnProperty.call(artifact, "payload"))) {
      throw extensionError("EXTENSION_STATE_INVALID", `Invalid installed JSON member for ${id}/${artifactId}`, { extension: id, artifact: artifactId });
    }
    if (kind === "codex-hooks" && (!artifact.payload || artifact.payload.schemaVersion !== 1 || !artifact.payload.hooks)) {
      throw extensionError("EXTENSION_STATE_INVALID", `Installed Hook artifact for ${id} is missing its payload`, { extension: id, artifact: artifact.id });
    }
    const normalized = { ...artifact, id: artifactId, kind, target };
    if (declaredArtifacts.some((existing) => artifactsConflict(existing, normalized))) {
      throw extensionError("EXTENSION_STATE_INVALID", `Installed extension ${id} has overlapping artifact ownership at ${target}`, { extension: id, artifact: artifactId, target });
    }
    declaredArtifacts.push(normalized);
  }
  if (installed.hooks !== undefined) {
    validateHookDeclarations(installed.hooks, id);
    if (installed.hooks.some((hook) => !Array.isArray(hook?.tools) || hook.tools.length === 0)) {
      throw extensionError("EXTENSION_STATE_INVALID", `Installed Hook state for ${id} must record selected tools`, { extension: id });
    }
    if (protocolVersion < 3) throw extensionError("EXTENSION_STATE_INVALID", `Installed Hook state for ${id} requires protocol v3`, { extension: id, protocolVersion });
  }
  return installed;
}

function loadExtensionState(root) {
  const file = extensionStatePath(root);
  if (!fs.existsSync(file)) return emptyExtensionState();
  const state = readJson(file, "EXTENSION_STATE_PARSE_FAILED");
  if (state?.schemaVersion !== 1 || state.experimental !== true || !state.extensions || typeof state.extensions !== "object" || Array.isArray(state.extensions)) {
    throw extensionError("EXTENSION_STATE_INVALID", `Invalid Workspace extension state: ${file}`, { file });
  }
  const ownedArtifacts = [];
  const ownedHooks = [];
  for (const [id, value] of Object.entries(state.extensions)) {
    validateExtensionName(id);
    if (!value || typeof value !== "object" || Array.isArray(value)) throw extensionError("EXTENSION_STATE_INVALID", `Invalid extension state for ${id}`, { extension: id });
    const installed = validateInstalledState(id, value.installed ?? null);
    if (value.lastAttempt !== undefined) {
      const attempt = value.lastAttempt;
      if (!attempt || typeof attempt !== "object" || !["installed", "failed"].includes(attempt.status) || !attempt.version) {
        throw extensionError("EXTENSION_STATE_INVALID", `Invalid lastAttempt state for ${id}`, { extension: id });
      }
      parseSemver(attempt.version);
      if (attempt.extensionSpecVersion !== undefined && (!Number.isInteger(attempt.extensionSpecVersion) || attempt.extensionSpecVersion < 1)) {
        throw extensionError("EXTENSION_STATE_INVALID", `Invalid lastAttempt Extension Spec for ${id}`, { extension: id, extensionSpecVersion: attempt.extensionSpecVersion });
      }
      if (attempt.status === "failed" && (!attempt.code || !attempt.message)) throw extensionError("EXTENSION_STATE_INVALID", `Failed lastAttempt for ${id} requires code and message`, { extension: id });
    }
    for (const artifact of installed?.artifacts || []) {
      const conflicting = ownedArtifacts.find((entry) => artifactsConflict(entry.artifact, artifact));
      if (conflicting) {
        throw extensionError("EXTENSION_STATE_INVALID", `Installed extensions ${conflicting.id} and ${id} have overlapping ownership at ${artifact.target}`, {
          extension: id,
          conflictingExtension: conflicting.id,
          target: artifact.target,
          ...(artifact.selector ? { selector: artifact.selector } : {}),
        });
      }
      ownedArtifacts.push({ id, artifact });
    }
    for (const key of hookDeclarationKeys(installed?.hooks || [])) {
      const conflicting = ownedHooks.find((entry) => entry.key === key);
      if (conflicting) throw extensionError("EXTENSION_STATE_INVALID", `Installed extensions ${conflicting.id} and ${id} declare the same native Hook`, { extension: id, conflictingExtension: conflicting.id });
      ownedHooks.push({ id, key });
    }
  }
  return state;
}

function inspectExtensionState(root) {
  try {
    return { state: loadExtensionState(root), error: null };
  } catch (error) {
    return { state: emptyExtensionState(), error };
  }
}

function saveExtensionState(root, state, options = {}) {
  (options.atomicWrite || atomicWrite)(extensionStatePath(root), `${JSON.stringify(state, null, 2)}\n`);
}

function parseExtensionSelection(value) {
  if (value === undefined) return null;
  const text = String(value).trim();
  if (!text) throw extensionError("EXTENSION_SELECTION_INVALID", "--extensions requires one or more extension names or none");
  if (text === "none") return [];
  const names = text.split(",").map((entry) => entry.trim());
  if (names.some((entry) => !entry) || names.includes("none")) {
    throw extensionError("EXTENSION_SELECTION_INVALID", `Invalid extension selection: ${text}`, { selection: text });
  }
  return normalizeExtensionNames(names);
}

function normalizeExtensionNames(values) {
  if (!Array.isArray(values)) throw extensionError("EXTENSION_SELECTION_INVALID", "Extension selection must be a list of names");
  const names = values.map((entry) => String(entry || "").trim());
  if (names.some((entry) => !entry) || new Set(names).size !== names.length) {
    throw extensionError("EXTENSION_SELECTION_INVALID", `Invalid extension selection: ${names.join(",")}`, { selection: names });
  }
  for (const name of names) {
    if (name.includes("@")) throw extensionError("EXTENSION_VERSION_SELECTION_UNSUPPORTED", `Extension versions cannot be selected explicitly: ${name}`, { extension: name });
    validateExtensionName(name);
  }
  return names;
}

function applicableArtifacts(manifest, tools = []) {
  const selected = new Set(tools);
  return manifest.outputs.filter((artifact) => !artifact.tools || artifact.tools.some((tool) => selected.has(tool)));
}

function applicableHooks(manifest, tools = []) {
  return hookDeclarationsForTools(manifest.hooks || [], tools);
}

function installedExtensionNames(state) {
  return Object.entries(state.extensions).filter(([, value]) => value.installed).map(([id]) => id);
}

function hasWorkspaceConfiguration(root) {
  return fs.existsSync(configPath(path.resolve(root)));
}

function resolveExtensionPlans(catalog, requested, options = {}) {
  const tools = options.tools || [];
  const state = options.state || emptyExtensionState();
  const byId = new Map(catalog.map((entry) => [entry.id, entry]));
  const plans = [];
  const ownedArtifacts = [];
  const ownedHooks = new Map();
  for (const [id, value] of Object.entries(state.extensions)) {
    if (!value.installed || requested.includes(id)) continue;
    for (const artifact of value.installed.artifacts) ownedArtifacts.push({ id, artifact });
    for (const key of hookDeclarationKeys(value.installed.hooks || [])) ownedHooks.set(key, id);
  }
  for (const id of requested) {
    const extension = byId.get(id);
    if (!extension) throw extensionError("EXTENSION_NOT_FOUND", `Unknown built-in extension: ${id}`, { extension: id });
    if (!extension.latestSupported) {
      throw extensionError("EXTENSION_SPEC_UNSUPPORTED", `No version of ${id} implements an Extension Spec supported by this Host`, {
        extension: id,
        supportedExtensionSpecVersions: [...SUPPORTED_EXTENSION_SPEC_VERSIONS],
        availableExtensionSpecVersions: [...new Set(extension.versions.map((entry) => entry.extensionSpecVersion))].sort((left, right) => left - right),
      });
    }
    const resolved = extension.latestSupported;
    const artifacts = applicableArtifacts(resolved.manifest, tools);
    const hooks = applicableHooks(resolved.manifest, tools);
    if (artifacts.length === 0 && hooks.length === 0) throw extensionError("EXTENSION_NO_APPLICABLE_OUTPUTS", `Extension ${id} has no outputs or Hooks for the selected tools`, { extension: id, tools });
    for (const artifact of artifacts) {
      const conflicting = ownedArtifacts.find((entry) => artifactsConflict(entry.artifact, artifact));
      if (conflicting) {
        throw extensionError("EXTENSION_TARGET_CONFLICT", `Extensions ${conflicting.id} and ${id} have overlapping ownership at ${artifact.target}`, {
          extension: id,
          conflictingExtension: conflicting.id,
          target: artifact.target,
          ...(artifact.selector ? { selector: artifact.selector } : {}),
        });
      }
      ownedArtifacts.push({ id, artifact });
    }
    for (const key of hookDeclarationKeys(hooks)) {
      const conflictingId = ownedHooks.get(key);
      if (conflictingId) throw extensionError("HOOK_DECLARATION_CONFLICT", `Extensions ${conflictingId} and ${id} declare the same native Hook`, { extension: id, conflictingExtension: conflictingId });
      ownedHooks.set(key, id);
    }
    plans.push(Object.freeze({
      id,
      name: resolved.manifest.name,
      version: resolved.version,
      extensionSpecVersion: resolved.extensionSpecVersion,
      sourceRoot: resolved.sourceRoot,
      entryFile: resolved.entryFile,
      manifestFile: resolved.manifestFile,
      manifest: resolved.manifest,
      manifestSha256: resolved.manifestSha256,
      entrySha256: resolved.entrySha256,
      packageSha256: resolved.packageSha256,
      capabilities: resolved.manifest.capabilities,
      artifacts: Object.freeze(artifacts.slice()),
      hooks: Object.freeze(hooks.slice()),
    }));
  }
  return Object.freeze(plans);
}

function prepareExtensionPlans(catalogResult, requested, options = {}) {
  const catalog = Array.isArray(catalogResult) ? catalogResult : catalogResult.catalog;
  const invalid = Array.isArray(catalogResult) ? [] : catalogResult.invalid;
  const failures = [];
  const diagnostics = invalid.map((entry) => ({ code: entry.code, severity: "warning", message: entry.message, extension: entry.id, entry: entry.entry }));
  const validIds = new Set(catalog.map((entry) => entry.id));
  const invalidById = new Map(invalid.filter((entry) => entry.id).map((entry) => [entry.id, entry]));
  for (const id of requested) {
    if (!validIds.has(id) && !invalidById.has(id)) throw extensionError("EXTENSION_NOT_FOUND", "Unknown built-in extension: " + id, { extension: id });
  }
  if (options.stateError) {
    for (const id of requested) failures.push({ id, version: null, status: "failed", code: options.stateError.code || "EXTENSION_STATE_INVALID", message: options.stateError.message, statePersisted: false, phase: "prepare" });
    diagnostics.push({ code: options.stateError.code || "EXTENSION_STATE_INVALID", severity: "warning", message: options.stateError.message });
    return { plans: [], failures, diagnostics };
  }
  const validRequested = [];
  for (const id of requested) {
    const invalidEntry = invalidById.get(id);
    if (invalidEntry) failures.push({ id, version: null, status: "failed", code: invalidEntry.code, message: invalidEntry.message, statePersisted: false, phase: "prepare" });
    else validRequested.push(id);
  }
  const plans = [];
  const planningState = structuredClone(options.state || emptyExtensionState());
  for (const id of validRequested) {
    try {
      const plan = resolveExtensionPlans(catalog, [id], { ...options, state: planningState })[0];
      plans.push(plan);
      planningState.extensions[id] = {
        installed: {
          artifacts: plan.artifacts.map((artifact) => ({ id: artifact.id, kind: artifact.kind, ownership: artifact.ownership, target: artifact.target, ...(artifact.selector ? { selector: artifact.selector } : {}) })),
          hooks: plan.hooks.map((hook) => ({ ...hook })),
        },
      };
    } catch (error) {
      failures.push({ id, version: null, status: "failed", code: error.code || "EXTENSION_INIT_FAILED", message: error.message, statePersisted: false, phase: "prepare" });
    }
  }
  return { plans, failures, diagnostics };
}

function assertSafeWorkspaceTarget(root, target, options = {}) {
  normalizeArtifactTarget(target);
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(resolvedRoot, ...target.split("/"));
  if (resolved === resolvedRoot || !resolved.startsWith(`${resolvedRoot}${path.sep}`)) {
    throw extensionError("EXTENSION_ARTIFACT_TARGET_INVALID", `Extension target escapes Workspace: ${target}`, { target });
  }
  let current = resolvedRoot;
  for (const segment of target.split("/")) {
    current = path.join(current, segment);
    if (!fs.existsSync(current)) continue;
    const stat = fs.lstatSync(current);
    if (stat.isSymbolicLink()) throw extensionError("EXTENSION_ARTIFACT_SYMLINK", `Extension target traverses a symbolic link: ${target}`, { target, path: current });
    if (current !== resolved && !stat.isDirectory()) throw extensionError("EXTENSION_ARTIFACT_TARGET_INVALID", `Extension target parent is not a directory: ${target}`, { target, path: current });
    if (current === resolved && !(options.directory ? stat.isDirectory() : stat.isFile())) throw extensionError("EXTENSION_ARTIFACT_TARGET_INVALID", `Extension target exists and is not a ${options.directory ? "directory" : "regular file"}: ${target}`, { target, path: current });
  }
  return resolved;
}

function listOutputEntries(root) {
  const entries = [];
  const visit = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      const relative = path.relative(root, file).split(path.sep).join("/");
      const stat = fs.lstatSync(file);
      if (stat.isSymbolicLink()) throw extensionError("EXTENSION_OUTPUT_SYMLINK", `Extension output contains a symbolic link: ${relative}`, { target: relative });
      if (stat.isDirectory()) {
        entries.push({ relative, kind: "directory" });
        visit(file);
      } else if (stat.isFile()) entries.push({ relative, kind: "file" });
      else throw extensionError("EXTENSION_OUTPUT_INVALID", `Extension output is not a regular file: ${relative}`, { target: relative });
    }
  };
  visit(root);
  return entries.sort((left, right) => left.relative.localeCompare(right.relative));
}

function validateInitResult(value, plan) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw extensionError("EXTENSION_RESULT_INVALID", `Extension ${plan.id} result must be a JSON object`, { extension: plan.id });
  assertOnlyKeys(value, new Set(["schemaVersion", "extensionSpecVersion", "extension", "outputs"]), "EXTENSION_RESULT_INVALID", `Extension ${plan.id} result`);
  if (value.schemaVersion !== 1 || value.extensionSpecVersion !== plan.extensionSpecVersion || !value.extension || typeof value.extension !== "object" || Array.isArray(value.extension)) {
    throw extensionError("EXTENSION_RESULT_INVALID", `Extension ${plan.id} result must use schemaVersion 1`, { extension: plan.id });
  }
  assertOnlyKeys(value.extension, new Set(["id", "version"]), "EXTENSION_RESULT_INVALID", `Extension ${plan.id} result identity`);
  if (value.extension.id !== plan.id || value.extension.version !== plan.version) {
    throw extensionError("EXTENSION_RESULT_IDENTITY_MISMATCH", `Extension result identity does not match ${plan.id}@${plan.version}`, { extension: plan.id, version: plan.version, actual: value.extension });
  }
  if (!Array.isArray(value.outputs) || value.outputs.length !== plan.artifacts.length) {
    throw extensionError("EXTENSION_ARTIFACT_MISSING", `Extension ${plan.id} result must contain every applicable output`, { extension: plan.id, expected: plan.artifacts.map((artifact) => artifact.id), actualCount: Array.isArray(value.outputs) ? value.outputs.length : null });
  }
  const declared = new Map(plan.artifacts.map((artifact) => [artifact.id, artifact]));
  const seenIds = new Set();
  const seenSources = [];
  const outputs = value.outputs.map((output) => {
    if (!output || typeof output !== "object" || Array.isArray(output)) throw extensionError("EXTENSION_RESULT_INVALID", `Extension ${plan.id} contains an invalid result output`, { extension: plan.id });
    assertOnlyKeys(output, new Set(["id", "source"]), "EXTENSION_RESULT_INVALID", `Extension ${plan.id} result output`);
    const id = validateExtensionName(output.id, "output");
    if (!declared.has(id)) throw extensionError("EXTENSION_ARTIFACT_UNDECLARED", `Extension ${plan.id} returned undeclared output ${id}`, { extension: plan.id, output: id });
    if (seenIds.has(id)) throw extensionError("EXTENSION_ARTIFACT_DUPLICATE", `Extension ${plan.id} returned output ${id} more than once`, { extension: plan.id, output: id });
    const source = normalizeArtifactTarget(output.source);
    if (seenSources.some((existing) => existing === source || existing.startsWith(`${source}/`) || source.startsWith(`${existing}/`))) {
      throw extensionError("EXTENSION_ARTIFACT_DUPLICATE", `Extension ${plan.id} returned overlapping output source ${source}`, { extension: plan.id, source });
    }
    seenIds.add(id);
    seenSources.push(source);
    return Object.freeze({ id, source });
  });
  for (const id of declared.keys()) if (!seenIds.has(id)) throw extensionError("EXTENSION_ARTIFACT_MISSING", `Extension ${plan.id} did not return output ${id}`, { extension: plan.id, output: id });
  return Object.freeze(outputs);
}

function validateInitContext(value, plan) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw extensionError("EXTENSION_CONTEXT_INVALID", `Extension ${plan.id} context must be an object`, { extension: plan.id });
  assertOnlyKeys(value, new Set(["schemaVersion", "extensionSpecVersion", "extension", "workspace", "tools"]), "EXTENSION_CONTEXT_INVALID", `Extension ${plan.id} context`);
  if (value.schemaVersion !== 1 || value.extensionSpecVersion !== plan.extensionSpecVersion || !value.extension || typeof value.extension !== "object" || Array.isArray(value.extension)) throw extensionError("EXTENSION_CONTEXT_INVALID", `Extension ${plan.id} context must use schemaVersion 1 and Extension Spec ${plan.extensionSpecVersion}`, { extension: plan.id, extensionSpecVersion: plan.extensionSpecVersion });
  assertOnlyKeys(value.extension, new Set(["id", "version"]), "EXTENSION_CONTEXT_INVALID", `Extension ${plan.id} context identity`);
  if (value.extension.id !== plan.id || value.extension.version !== plan.version) throw extensionError("EXTENSION_CONTEXT_INVALID", `Extension context identity does not match ${plan.id}@${plan.version}`, { extension: plan.id, version: plan.version });
  const workspace = value.workspace;
  if (!workspace || typeof workspace !== "object" || Array.isArray(workspace)) throw extensionError("EXTENSION_CONTEXT_INVALID", `Extension ${plan.id} context requires workspace metadata`, { extension: plan.id });
  assertOnlyKeys(workspace, new Set(["name", "uuid", "language"]), "EXTENSION_CONTEXT_INVALID", `Extension ${plan.id} workspace context`);
  for (const field of ["name", "uuid", "language"]) if (typeof workspace[field] !== "string" || !workspace[field]) throw extensionError("EXTENSION_CONTEXT_INVALID", `Extension ${plan.id} workspace ${field} is invalid`, { extension: plan.id, field });
  if (!Array.isArray(value.tools) || new Set(value.tools).size !== value.tools.length || value.tools.some((tool) => !SUPPORTED_TOOLS.has(tool))) throw extensionError("EXTENSION_CONTEXT_INVALID", `Extension ${plan.id} context tools are invalid`, { extension: plan.id });
  return Object.freeze({
    schemaVersion: 1,
    extensionSpecVersion: plan.extensionSpecVersion,
    extension: Object.freeze({ id: plan.id, version: plan.version }),
    workspace: Object.freeze({ name: workspace.name, uuid: workspace.uuid, language: workspace.language }),
    tools: Object.freeze(value.tools.slice()),
  });
}

function verifyExtensionOutput(outputRoot, result, artifactsOrPlan) {
  const plan = Array.isArray(artifactsOrPlan)
    ? { id: result?.extension?.id || "extension", version: result?.extension?.version || "0.0.0", extensionSpecVersion: result?.extensionSpecVersion || 1, artifacts: artifactsOrPlan }
    : artifactsOrPlan;
  const outputs = validateInitResult(result, plan);
  const declared = new Map(plan.artifacts.map((artifact) => [artifact.id, artifact]));
  const actual = listOutputEntries(outputRoot);
  for (const entry of actual) {
    const covered = outputs.some(({ id, source }) => {
      const artifact = declared.get(id);
      return entry.relative === source || source.startsWith(`${entry.relative}/`) || (artifact.kind === "directory" && entry.relative.startsWith(`${source}/`));
    });
    if (!covered) throw extensionError("EXTENSION_ARTIFACT_UNDECLARED", `Extension generated undeclared output: ${entry.relative}`, { target: entry.relative });
  }
  const verified = [];
  for (const { id, source } of outputs) {
    const artifact = declared.get(id);
    const candidate = path.resolve(outputRoot, ...source.split("/"));
    if (!candidate.startsWith(`${path.resolve(outputRoot)}${path.sep}`) || !fs.existsSync(candidate)) {
      throw extensionError("EXTENSION_ARTIFACT_MISSING", `Extension did not generate output ${id}: ${source}`, { output: id, source });
    }
    const stat = fs.lstatSync(candidate);
    if (stat.isSymbolicLink()) throw extensionError("EXTENSION_OUTPUT_SYMLINK", `Extension output contains a symbolic link: ${source}`, { target: source });
    if (artifact.kind === "directory") {
      if (!stat.isDirectory()) throw extensionError("EXTENSION_OUTPUT_INVALID", `Extension output ${id} must be a directory`, { output: id, source });
      verified.push({ ...artifact, source, directory: candidate, installedSha256: directoryDigest(candidate) });
    } else {
      if (!stat.isFile()) throw extensionError("EXTENSION_OUTPUT_INVALID", `Extension output ${id} must be a regular file`, { output: id, source });
      const content = fs.readFileSync(candidate);
      verified.push({ ...artifact, source, file: candidate, content, installedSha256: sha256(content) });
    }
  }
  return verified;
}

function runExtensionProcess(plan, contextFile, outputRoot, resultFile, options = {}) {
  const runner = options.spawnSync || spawnSync;
  const environment = {};
  for (const name of ["PATH", "TMPDIR", "TMP", "TEMP", "LANG", "LC_ALL", "SystemRoot", "WINDIR", "PATHEXT"]) {
    if (process.env[name] !== undefined) environment[name] = process.env[name];
  }
  const result = runner(process.execPath, [plan.entryFile, "--context", contextFile, "--output", outputRoot, "--result", resultFile], {
    cwd: plan.sourceRoot,
    env: environment,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: plan.manifest.timeoutMs,
    killSignal: "SIGKILL",
    maxBuffer: 1024 * 1024,
  });
  if (result.error?.code === "ETIMEDOUT" || result.signal === "SIGKILL") {
    throw extensionError("EXTENSION_INIT_TIMEOUT", `Extension ${plan.id} timed out after ${plan.manifest.timeoutMs}ms`, { extension: plan.id, timeoutMs: plan.manifest.timeoutMs });
  }
  if (result.error) throw extensionError("EXTENSION_INIT_FAILED", `Extension ${plan.id} failed to start: ${result.error.message}`, { extension: plan.id });
  if (result.status !== 0) {
    const detail = String(result.stderr || result.stdout || "").trim().split(/\r?\n/)[0];
    throw extensionError("EXTENSION_INIT_FAILED", `Extension ${plan.id} exited with status ${result.status}${detail ? `: ${detail}` : ""}`, { extension: plan.id, exitCode: result.status });
  }
  return result;
}

function stateFingerprint(root) {
  const file = extensionStatePath(root);
  return fs.existsSync(file) ? sha256(fs.readFileSync(file)) : null;
}

function installedIsCurrent(root, plan, installed, state) {
  if (!installed || installed.protocolVersion !== 3 || installed.extensionSpecVersion !== plan.extensionSpecVersion || installed.version !== plan.version || installed.manifestSha256 !== plan.manifestSha256 || installed.packageSha256 !== plan.packageSha256) return false;
  if (installed.artifacts.length !== plan.artifacts.length) return false;
  const byId = new Map(installed.artifacts.map((artifact) => [artifact.id, artifact]));
  const hooks = installed.hooks || [];
  const planHooks = plan.hooks || [];
  if (hooks.length !== planHooks.length) return false;
  const hookById = new Map(hooks.map((hook) => [hook.id, hook]));
  if (!planHooks.every((hook) => {
    const current = hookById.get(hook.id);
    return current && current.event === hook.event && current.command === hook.command && (current.matcher || null) === (hook.matcher || null) && current.timeoutMs === hook.timeoutMs && JSON.stringify(current.tools || []) === JSON.stringify(hook.tools || []);
  })) return false;
  return plan.artifacts.every((artifact) => {
    const stateArtifact = byId.get(artifact.id);
    return stateArtifact && stateArtifact.kind === artifact.kind && stateArtifact.ownership === artifact.ownership && stateArtifact.target === artifact.target && (artifact.selector || null) === (stateArtifact.selector || null) && (artifact.format || null) === (stateArtifact.format || null);
  }) && installedArtifactsCurrent(root, plan.id, installed, state) && hooksCurrent(root, state);
}

function assertInstallOwnership(root, plan, state) {
  const installed = state.extensions[plan.id]?.installed || null;
  const ownArtifacts = new Map((installed?.artifacts || []).filter((artifact) => ["file", "directory"].includes(artifact.kind || "file")).map((artifact) => [artifact.target, artifact]));
  const otherArtifacts = [];
  for (const [id, value] of Object.entries(state.extensions)) {
    if (id === plan.id || !value.installed) continue;
    for (const artifact of value.installed.artifacts) otherArtifacts.push({ id, artifact });
  }
  for (const artifact of plan.artifacts) {
    const conflicting = otherArtifacts.find((entry) => artifactsConflict(entry.artifact, artifact));
    if (conflicting) {
      throw extensionError("EXTENSION_TARGET_CONFLICT", `Extensions ${conflicting.id} and ${plan.id} have overlapping ownership at ${artifact.target}`, {
        extension: plan.id,
        conflictingExtension: conflicting.id,
        target: artifact.target,
        ...(artifact.selector ? { selector: artifact.selector } : {}),
      });
    }
  }
  for (const artifact of [...plan.artifacts, ...(installed?.artifacts || [])]) {
    const kind = artifact.kind || "file";
    const target = assertSafeWorkspaceTarget(root, targetForArtifact(artifact), { directory: kind === "directory" });
    if (!["file", "directory"].includes(kind)) continue;
    if (!fs.existsSync(target)) continue;
    const own = ownArtifacts.get(artifact.target);
    if (!own) throw extensionError("EXTENSION_TARGET_OCCUPIED", `Extension target already exists and is not owned by ${plan.id}: ${artifact.target}`, { extension: plan.id, target: artifact.target });
    const actualSha256 = kind === "directory" ? directoryDigest(target) : sha256(fs.readFileSync(target));
    if (actualSha256 !== own.installedSha256) {
      throw extensionError("EXTENSION_ARTIFACT_MODIFIED", `Installed extension artifact contains local changes: ${artifact.target}`, { extension: plan.id, target: artifact.target, expectedSha256: own.installedSha256, actualSha256 });
    }
  }
}

function recordFailedAttempt(root, plan, error, options = {}) {
  let transaction;
  try {
    const state = loadExtensionState(root);
    const next = structuredClone(state);
    const previous = next.extensions[plan.id]?.installed ?? null;
    next.extensions[plan.id] = {
      installed: previous,
      lastAttempt: { version: plan.version, extensionSpecVersion: plan.extensionSpecVersion, status: "failed", code: error.code || "EXTENSION_INIT_FAILED", message: error.message },
    };
    transaction = createFileTransaction([extensionStatePath(root)]);
    saveExtensionState(root, next, options);
    options.injectFailure?.("after-failure-state-save", plan);
    const verified = loadExtensionState(root);
    const attempt = verified.extensions[plan.id]?.lastAttempt;
    if (!attempt || attempt.status !== "failed" || attempt.version !== plan.version || attempt.extensionSpecVersion !== plan.extensionSpecVersion || attempt.code !== (error.code || "EXTENSION_INIT_FAILED")) {
      throw extensionError("EXTENSION_STATE_VERIFY_FAILED", `Failed extension attempt state could not be verified for ${plan.id}`, { extension: plan.id });
    }
    transaction.commit();
    return true;
  } catch (stateError) {
    transaction?.rollback(stateError);
    return false;
  }
}

function createDirectoryTransition(root, previousInstalled, nextInstalled, verifiedById) {
  const previous = new Map(directoryArtifacts(previousInstalled).map((artifact) => [artifact.target, artifact]));
  const next = new Map(directoryArtifacts(nextInstalled).map((artifact) => [artifact.target, artifact]));
  const operations = [];
  for (const [target, artifact] of previous) {
    const directory = assertSafeWorkspaceTarget(root, target, { directory: true });
    if (!fs.existsSync(directory) || directoryDigest(directory) !== artifact.installedSha256) {
      throw extensionError("EXTENSION_ARTIFACT_MODIFIED", `Installed extension directory contains local changes: ${target}`, { target, expectedSha256: artifact.installedSha256, actualSha256: fs.existsSync(directory) ? directoryDigest(directory) : null });
    }
    if (!next.has(target)) operations.push({ target, directory, source: null });
  }
  for (const [target, artifact] of next) {
    const verified = verifiedById.get(artifact.id);
    if (!verified?.directory) throw extensionError("EXTENSION_ARTIFACT_MISSING", `Missing verified directory ${artifact.id}`, { artifact: artifact.id });
    operations.push({ target, directory: path.join(root, ...target.split("/")), source: verified.directory });
  }
  const applied = [];
  return {
    targets: operations.map((operation) => operation.target),
    apply() {
      for (const operation of operations) {
        fs.mkdirSync(path.dirname(operation.directory), { recursive: true });
        const suffix = `${process.pid}.${Date.now()}.${applied.length}`;
        const backup = `${operation.directory}.code-workspace-backup.${suffix}`;
        const staging = `${operation.directory}.code-workspace-staging.${suffix}`;
        const ownsPrevious = previous.has(operation.target);
        let existed = false;
        let backedUp = false;
        try {
          if (operation.source) fs.cpSync(operation.source, staging, { recursive: true, errorOnExist: true, preserveTimestamps: false });
          existed = fs.existsSync(operation.directory);
          if (existed && !ownsPrevious) throw extensionError("EXTENSION_TARGET_OCCUPIED", `Extension target appeared while preparing installation: ${operation.target}`, { target: operation.target });
          if (existed) {
            fs.renameSync(operation.directory, backup);
            backedUp = true;
          }
          if (operation.source) fs.renameSync(staging, operation.directory);
          applied.push({ ...operation, backup: existed ? backup : null, staging });
        } catch (error) {
          if (fs.existsSync(staging)) fs.rmSync(staging, { recursive: true, force: true });
          if (backedUp && fs.existsSync(backup)) fs.renameSync(backup, operation.directory);
          throw error;
        }
      }
    },
    verify() {
      for (const operation of operations) {
        if (!operation.source) {
          if (fs.existsSync(operation.directory)) throw extensionError("EXTENSION_POSTCONDITION_FAILED", `Obsolete extension directory was not removed: ${operation.target}`, { target: operation.target });
          continue;
        }
        const expected = directoryDigest(operation.source);
        if (!fs.existsSync(operation.directory) || directoryDigest(operation.directory) !== expected) throw extensionError("EXTENSION_POSTCONDITION_FAILED", `Extension directory could not be verified: ${operation.target}`, { target: operation.target });
      }
    },
    commit() {
      for (const operation of applied) if (operation.backup && fs.existsSync(operation.backup)) fs.rmSync(operation.backup, { recursive: true, force: true });
    },
    rollback(error) {
      const rollbackErrors = [];
      for (const operation of applied.slice().reverse()) {
        try {
          if (fs.existsSync(operation.directory)) fs.rmSync(operation.directory, { recursive: true, force: true });
          if (operation.backup && fs.existsSync(operation.backup)) fs.renameSync(operation.backup, operation.directory);
        } catch (rollbackError) {
          rollbackErrors.push(`${operation.target}: ${rollbackError.message}`);
        }
      }
      if (rollbackErrors.length > 0 && error) {
        error.details = { ...(error.details || {}), workspaceRolledBack: false, rollbackErrors: [...(error.details?.rollbackErrors || []), ...rollbackErrors] };
      }
    },
  };
}

function installVerifiedArtifacts(root, plan, verified, previousState, options = {}) {
  const previousInstalled = previousState.extensions[plan.id]?.installed || null;
  for (const artifact of [...plan.artifacts, ...(previousInstalled?.artifacts || [])]) assertSafeWorkspaceTarget(root, targetForArtifact(artifact), { directory: artifact.kind === "directory" });
  const verifiedById = new Map(verified.map((artifact) => [artifact.id, artifact]));
  const installedArtifacts = plan.artifacts.map((artifact) => installedRecord(artifact, verifiedById.get(artifact.id)));
  const next = structuredClone(previousState);
  next.extensions[plan.id] = {
    installed: {
      protocolVersion: 3,
      extensionSpecVersion: plan.extensionSpecVersion,
      version: plan.version,
      manifestSha256: plan.manifestSha256,
      packageSha256: plan.packageSha256,
      artifacts: installedArtifacts,
      hooks: (plan.hooks || []).map((hook) => ({ ...hook, tools: [...hook.tools] })),
    },
    lastAttempt: { version: plan.version, extensionSpecVersion: plan.extensionSpecVersion, status: "installed" },
  };
  const transition = planArtifactTransition(root, plan.id, previousInstalled, next.extensions[plan.id].installed, previousState, next, verifiedById);
  const directoryTransition = createDirectoryTransition(root, previousInstalled, next.extensions[plan.id].installed, verifiedById);
  const stateFile = extensionStatePath(root);
  const transaction = (options.createFileTransaction || createFileTransaction)([...transition.writes.keys(), ...transition.removes, stateFile]);
  try {
    directoryTransition.apply();
    options.injectFailure?.("after-directory-write", plan);
    for (const [file, content] of transition.writes) {
      (options.atomicWrite || atomicWrite)(file, content);
      options.injectFailure?.("after-artifact-write", { plan, file });
    }
    for (const file of transition.removes) if (fs.existsSync(file)) fs.unlinkSync(file);
    saveExtensionState(root, next, options);
    options.injectFailure?.("after-state-save", plan);
    verifyArtifactTransition(transition);
    verifyHookTransition(transition);
    directoryTransition.verify();
    const persisted = loadExtensionState(root).extensions[plan.id];
    if (!persisted || persisted.lastAttempt?.status !== "installed" || persisted.installed?.extensionSpecVersion !== plan.extensionSpecVersion || persisted.installed?.manifestSha256 !== plan.manifestSha256 || persisted.installed?.packageSha256 !== plan.packageSha256) {
      throw extensionError("EXTENSION_STATE_VERIFY_FAILED", `Installed extension state could not be verified for ${plan.id}`, { extension: plan.id });
    }
    options.injectFailure?.("after-verify", plan);
    transaction.commit();
    directoryTransition.commit();
    return persisted.installed;
  } catch (error) {
    transaction.rollback(error);
    directoryTransition.rollback(error);
    if (error.details?.workspaceRolledBack === false) {
      throw extensionError("EXTENSION_ROLLBACK_INCOMPLETE", `Extension ${plan.id} failed and rollback was incomplete`, { extension: plan.id, causeCode: error.code || "EXTENSION_INSTALL_FAILED", causeMessage: error.message, rollbackErrors: error.details.rollbackErrors });
    }
    throw error;
  }
}

function executeExtension(root, plan, context, options = {}) {
  let temporaryRoot;
  let executionResult;
  try {
    const currentManifestSha = sha256(fs.readFileSync(plan.manifestFile));
    if (currentManifestSha !== plan.manifestSha256) throw extensionError("EXTENSION_PLAN_STALE", `Extension manifest changed after planning: ${plan.id}`, { extension: plan.id });
    const currentEntrySha = sha256(fs.readFileSync(plan.entryFile));
    if (currentEntrySha !== plan.entrySha256 || currentEntrySha !== plan.manifest.entrySha256) {
      throw extensionError("EXTENSION_PLAN_STALE", `Extension entry changed after planning: ${plan.id}`, { extension: plan.id, expectedSha256: plan.entrySha256, actualSha256: currentEntrySha });
    }
    const currentPackageSha = directoryDigest(plan.sourceRoot);
    if (currentPackageSha !== plan.packageSha256) throw extensionError("EXTENSION_PLAN_STALE", `Extension package changed after planning: ${plan.id}`, { extension: plan.id, expectedSha256: plan.packageSha256, actualSha256: currentPackageSha });
    const currentManifest = validateManifest(readJson(plan.manifestFile, "EXTENSION_MANIFEST_PARSE_FAILED"), {
      expectedId: plan.id,
      expectedVersion: plan.version,
    });
    if (currentManifest.extensionSpecVersion !== plan.extensionSpecVersion) {
      throw extensionError("EXTENSION_PLAN_STALE", `Extension Spec changed after planning: ${plan.id}`, { extension: plan.id, expectedExtensionSpecVersion: plan.extensionSpecVersion, actualExtensionSpecVersion: currentManifest.extensionSpecVersion });
    }
    const state = loadExtensionState(root);
    const installed = state.extensions[plan.id]?.installed || null;
    if (installedIsCurrent(root, plan, installed, state)) {
      executionResult = { id: plan.id, version: plan.version, extensionSpecVersion: plan.extensionSpecVersion, status: "skipped", reason: "current", hooks: installed.hooks || [] };
      return executionResult;
    }
    assertInstallOwnership(root, plan, state);
    const beforeState = stateFingerprint(root);
    temporaryRoot = fs.mkdtempSync(path.join(options.tempRoot || os.tmpdir(), `code-workspace-extension-${plan.id}-`));
    const outputRoot = path.join(temporaryRoot, "output");
    const contextFile = path.join(temporaryRoot, "context.json");
    const resultFile = path.join(temporaryRoot, "result.json");
    fs.mkdirSync(outputRoot);
    const runtimeContext = validateInitContext(context, plan);
    fs.writeFileSync(contextFile, `${JSON.stringify(runtimeContext, null, 2)}\n`, { mode: 0o600 });
    runExtensionProcess(plan, contextFile, outputRoot, resultFile, options);
    options.injectFailure?.("after-process", plan);
    assertRegularFile(resultFile, "EXTENSION_RESULT_MISSING", "extension init result");
    const result = readJson(resultFile, "EXTENSION_RESULT_INVALID");
    const verified = verifyExtensionOutput(outputRoot, result, plan);
    options.injectFailure?.("after-output-verify", plan);
    if (stateFingerprint(root) !== beforeState) throw extensionError("EXTENSION_STATE_CONFLICT", `Extension state changed while ${plan.id} was running`, { extension: plan.id });
    const installedState = installVerifiedArtifacts(root, plan, verified, state, options);
    executionResult = { id: plan.id, version: plan.version, extensionSpecVersion: plan.extensionSpecVersion, status: "installed", artifacts: installedState.artifacts, hooks: installedState.hooks || [] };
    return executionResult;
  } catch (error) {
    const normalized = error.code ? error : extensionError("EXTENSION_INIT_FAILED", `Extension ${plan.id} failed: ${error.message}`, { extension: plan.id, cause: error.name });
    const statePersisted = recordFailedAttempt(root, plan, normalized, options);
    executionResult = { id: plan.id, version: plan.version, extensionSpecVersion: plan.extensionSpecVersion, status: "failed", code: normalized.code, message: normalized.message, statePersisted };
    return executionResult;
  } finally {
    if (temporaryRoot) {
      try {
        (options.rmSync || fs.rmSync)(temporaryRoot, { recursive: true, force: true });
      } catch (error) {
        if (executionResult) {
          executionResult.warnings = [{
            code: "EXTENSION_STAGING_CLEANUP_FAILED",
            message: `Could not remove extension staging directory for ${plan.id}: ${error.message}`,
          }];
        }
      }
    }
  }
}

function runExtensionBatch(root, plans, context, options = {}) {
  const executed = [];
  for (const plan of plans) {
    const executionContext = typeof context === "function" ? context(plan) : {
      ...(context || {}),
      extensionSpecVersion: plan.extensionSpecVersion,
      extension: { id: plan.id, version: plan.version },
    };
    executed.push(executeExtension(root, plan, executionContext, options));
  }
  const requested = options.requested || plans.map((plan) => plan.id);
  const byId = new Map([...executed, ...(options.preFailures || [])].map((entry) => [entry.id, entry]));
  const results = requested.map((id) => byId.get(id)).filter(Boolean);
  return {
    requested,
    results,
    summary: {
      installed: results.filter((entry) => entry.status === "installed").length,
      skipped: results.filter((entry) => entry.status === "skipped").length,
      failed: results.filter((entry) => entry.status === "failed").length,
    },
  };
}

function planExtensionUninstall(root, id) {
  const extensionId = validateExtensionName(id);
  const state = loadExtensionState(root);
  const installed = state.extensions[extensionId]?.installed || null;
  if (!installed) return Object.freeze({ root: path.resolve(root), id: extensionId, action: "skip", reason: "not-installed", targets: [] });
  for (const artifact of installed.artifacts) assertSafeWorkspaceTarget(root, targetForArtifact(artifact), { directory: artifact.kind === "directory" });
  const next = structuredClone(state);
  delete next.extensions[extensionId];
  const transition = planArtifactTransition(root, extensionId, installed, null, state, next);
  createDirectoryTransition(root, installed, null, new Map());
  const directoryTargets = directoryArtifacts(installed).map((artifact) => artifact.target);
  return Object.freeze({
    root: path.resolve(root),
    id: extensionId,
    action: "remove",
    version: installed.version,
    stateFingerprint: stateFingerprint(root),
    state,
    next,
    transition,
    targets: Object.freeze([...new Set([...transition.writes.keys(), ...transition.removes])].map((file) => path.relative(path.resolve(root), file).split(path.sep).join("/")).concat(directoryTargets)),
  });
}

function applyExtensionUninstall(plan, options = {}) {
  if (plan.action === "skip") return { id: plan.id, status: "skipped", reason: plan.reason, removed: [] };
  if (stateFingerprint(plan.root) !== plan.stateFingerprint) {
    throw extensionError("EXTENSION_STATE_CONFLICT", `Extension state changed before uninstalling ${plan.id}`, { extension: plan.id });
  }
  const currentState = loadExtensionState(plan.root);
  const installed = currentState.extensions[plan.id]?.installed;
  if (!installed || installed.version !== plan.version) throw extensionError("EXTENSION_STATE_CONFLICT", `Installed extension changed before uninstalling ${plan.id}`, { extension: plan.id });
  const next = structuredClone(currentState);
  delete next.extensions[plan.id];
  const transition = planArtifactTransition(plan.root, plan.id, installed, null, currentState, next);
  const directoryTransition = createDirectoryTransition(plan.root, installed, null, new Map());
  const stateFile = extensionStatePath(plan.root);
  const transaction = (options.createFileTransaction || createFileTransaction)([...transition.writes.keys(), ...transition.removes, stateFile]);
  try {
    directoryTransition.apply();
    for (const [file, content] of transition.writes) (options.atomicWrite || atomicWrite)(file, content);
    options.injectFailure?.("after-uninstall-write", plan);
    for (const file of transition.removes) if (fs.existsSync(file)) fs.unlinkSync(file);
    options.injectFailure?.("after-uninstall-remove", plan);
    saveExtensionState(plan.root, next, options);
    options.injectFailure?.("after-uninstall-state", plan);
    verifyArtifactTransition(transition);
    directoryTransition.verify();
    if (loadExtensionState(plan.root).extensions[plan.id]) throw extensionError("EXTENSION_STATE_VERIFY_FAILED", `Uninstalled extension state still exists for ${plan.id}`, { extension: plan.id });
    options.injectFailure?.("after-uninstall-verify", plan);
    for (const file of transition.removes) removeEmptyParents(plan.root, file);
    transaction.commit();
    directoryTransition.commit();
    return { id: plan.id, version: plan.version, status: "uninstalled", removed: plan.targets };
  } catch (error) {
    transaction.rollback(error);
    directoryTransition.rollback(error);
    throw error;
  }
}

module.exports = {
  EXTENSIONS_ROOT,
  EXTENSION_NAME_PATTERN,
  EXTENSION_STATE_FILE,
  SUPPORTED_EXTENSION_SPEC_VERSIONS,
  applicableArtifacts,
  applicableHooks,
  applyExtensionUninstall,
  assertSafeWorkspaceTarget,
  compareSemver,
  coreManagedTargets,
  discoverExtensions,
  emptyExtensionState,
  executeExtension,
  extensionStatePath,
  hasWorkspaceConfiguration,
  inspectExtensionState,
  installedExtensionNames,
  loadExtensionState,
  normalizeArtifactTarget,
  normalizeExtensionNames,
  parseExtensionSelection,
  parseSemver,
  planExtensionUninstall,
  prepareExtensionPlans,
  resolveExtensionPlans,
  runExtensionBatch,
  saveExtensionState,
  supportsExtensionSpec,
  validateManifest,
  validateManifestEnvelope,
  verifyExtensionOutput,
};
