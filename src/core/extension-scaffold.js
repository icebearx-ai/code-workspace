const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { atomicWrite, sha256 } = require("./fs");
const { createFileTransaction } = require("./transaction");
const { directoryDigest } = require("./directory-digest");
const { EXTENSION_NAME_PATTERN, parseSemver, validateManifestEnvelope } = require("./extensions");
const { validateExtensionTransportEnvelope } = require("./extension-package");
const { WorkspaceError } = require("./errors");

function scaffoldError(code, message, details = {}) {
  return new WorkspaceError(code, message, details);
}

function titleFromId(id) {
  return id.split("-").map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(" ");
}

function readJson(file, code) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (error) {
    throw scaffoldError(code, `Cannot parse JSON file: ${file}`, { path: file, cause: error.message });
  }
}

function validateScaffoldMetadata(options = {}, targetRoot) {
  const derivedId = path.basename(targetRoot).toLowerCase();
  const id = String(options.id || derivedId).trim();
  if (!EXTENSION_NAME_PATTERN.test(id)) throw scaffoldError("EXTENSION_NAME_INVALID", `Invalid extension name: ${id || "<missing>"}`, { extension: id || null });
  const name = String(options.name || titleFromId(id)).trim();
  const description = String(options.description || "Code Workspace extension.").trim();
  const version = parseSemver(options.version || "0.1.0").raw;
  if (!name || [...name].length > 100) throw scaffoldError("EXTENSION_MANIFEST_INVALID", `Extension display name is invalid: ${id}`, { extension: id });
  if (!description || [...description].length > 60 || /[\r\n]/.test(description)) throw scaffoldError("EXTENSION_MANIFEST_INVALID", `Extension description is invalid: ${id}`, { extension: id });
  return Object.freeze({ id, name, description, version });
}

const SCAFFOLD_TEMPLATE_ROOT = path.join(__dirname, "..", "..", "artifacts", "templates", "extension-init");

function readTemplateFiles(root = SCAFFOLD_TEMPLATE_ROOT, current = root, result = {}) {
  let entries;
  try {
    entries = fs.readdirSync(current, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name));
  } catch (error) {
    throw scaffoldError("EXTENSION_TEMPLATE_INVALID", `Cannot read extension init template: ${root}`, { path: root, cause: error.code || error.message });
  }
  for (const entry of entries) {
    const file = path.join(current, entry.name);
    const relative = path.relative(root, file).split(path.sep).join("/");
    const stat = fs.lstatSync(file);
    if (stat.isSymbolicLink()) throw scaffoldError("EXTENSION_TEMPLATE_INVALID", `Extension init template contains a symbolic link: ${relative}`, { path: relative });
    if (stat.isDirectory()) readTemplateFiles(root, file, result);
    else if (stat.isFile()) result[relative === "gitignore" ? ".gitignore" : relative] = fs.readFileSync(file);
    else throw scaffoldError("EXTENSION_TEMPLATE_INVALID", `Extension init template contains a special file: ${relative}`, { path: relative });
  }
  return result;
}

function validateShellManifest(raw) {
  const envelope = validateManifestEnvelope(raw);
  if (raw.schemaVersion !== 3 || raw.experimental !== true || raw.entry !== "init.js") {
    throw scaffoldError("EXTENSION_MANIFEST_INVALID", "Extension shell manifest must use schemaVersion 3, experimental true, and entry init.js", { extension: envelope.id });
  }
  if (!/^[a-f0-9]{64}$/.test(raw.entrySha256 || "")) throw scaffoldError("EXTENSION_MANIFEST_INVALID", `Extension ${envelope.id} entrySha256 is invalid`, { extension: envelope.id });
  if (!Number.isInteger(raw.timeoutMs) || raw.timeoutMs < 1 || raw.timeoutMs > 300000) throw scaffoldError("EXTENSION_MANIFEST_INVALID", `Extension ${envelope.id} timeoutMs is invalid`, { extension: envelope.id });
  return envelope;
}

function readRelativeFiles(root, current = root, result = []) {
  for (const entry of fs.readdirSync(current, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name))) {
    const file = path.join(current, entry.name);
    const relative = path.relative(root, file).split(path.sep).join("/");
    const stat = fs.lstatSync(file);
    if (stat.isSymbolicLink()) throw scaffoldError("EXTENSION_INIT_TARGET_EXISTS", `Scaffold target contains a symbolic link: ${relative}`, { path: relative });
    if (stat.isDirectory()) readRelativeFiles(root, file, result);
    else if (stat.isFile()) result.push(relative);
    else throw scaffoldError("EXTENSION_INIT_TARGET_EXISTS", `Scaffold target contains a special file: ${relative}`, { path: relative });
  }
  return result;
}

function filesMatch(root, files) {
  let actual;
  try { actual = readRelativeFiles(root); } catch { return false; }
  const expected = Object.keys(files).sort();
  if (actual.length !== expected.length || actual.some((entry, index) => entry !== expected[index])) return false;
  return expected.every((relative) => Buffer.from(fs.readFileSync(path.join(root, ...relative.split("/")))).equals(files[relative]));
}

function commitDirectory(temporary, target) {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  if (!fs.existsSync(target)) {
    fs.renameSync(temporary, target);
    return;
  }
  const backup = `${target}.${process.pid}.${crypto.randomUUID()}.old`;
  let moved = false;
  try {
    fs.renameSync(target, backup);
    moved = true;
    fs.renameSync(temporary, target);
    fs.rmSync(backup, { recursive: true, force: true });
  } catch (error) {
    try { if (fs.existsSync(target)) fs.rmSync(target, { recursive: true, force: true }); } catch {}
    try { if (moved && fs.existsSync(backup)) fs.renameSync(backup, target); } catch {}
    throw scaffoldError("EXTENSION_INIT_COMMIT_FAILED", `Cannot commit extension package: ${target}`, { path: target, cause: error.code || error.message });
  }
}

function shellEnvelope(metadata, packageSha256) {
  return {
    name: `@codew-ext/${metadata.id}`,
    version: metadata.version,
    description: metadata.description,
    keywords: ["code-workspace-extension"],
    codeWorkspace: { schemaVersion: 1, extensionId: metadata.id, extensionSpecVersion: 1, packageRoot: "extension", packageSha256 },
    files: ["extension"],
  };
}

function scaffoldExtensionPackage(target, options = {}) {
  const targetRoot = path.resolve(target || ".");
  const metadata = validateScaffoldMetadata(options, targetRoot);
  const templateFiles = readTemplateFiles();
  const entry = templateFiles["extension/init.js"];
  if (!entry) throw scaffoldError("EXTENSION_TEMPLATE_INVALID", "Extension init template must contain extension/init.js", { path: "extension/init.js" });
  const manifest = {
    schemaVersion: 3,
    extensionSpecVersion: 1,
    experimental: true,
    id: metadata.id,
    name: metadata.name,
    description: metadata.description,
    version: metadata.version,
    entry: "init.js",
    entrySha256: sha256(Buffer.from(entry, "utf8")),
    timeoutMs: 30000,
  };
  const files = {
    ...templateFiles,
    "package.json": null,
    "extension/manifest.json": Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, "utf8"),
  };
  const temporary = fs.mkdtempSync(path.join(path.dirname(targetRoot), `.${path.basename(targetRoot)}-`));
  try {
    for (const [relative, content] of Object.entries(files)) {
      if (!content) continue;
      const file = path.join(temporary, ...relative.split("/"));
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, content, { mode: relative.endsWith(".js") ? 0o755 : 0o644 });
    }
    const packageSha256 = directoryDigest(path.join(temporary, "extension"));
    const envelope = shellEnvelope(metadata, packageSha256);
    validateExtensionTransportEnvelope(envelope, { expectedId: metadata.id, expectedVersion: metadata.version, expectedExtensionSpecVersion: 1, expectedPackageSha256: packageSha256 });
    files["package.json"] = Buffer.from(`${JSON.stringify(envelope, null, 2)}\n`, "utf8");
    fs.writeFileSync(path.join(temporary, "package.json"), files["package.json"]);
    if (fs.existsSync(targetRoot)) {
      const stat = fs.lstatSync(targetRoot);
      if (!stat.isDirectory() || stat.isSymbolicLink()) throw scaffoldError("EXTENSION_INIT_TARGET_EXISTS", `Scaffold target is not a regular directory: ${targetRoot}`, { path: targetRoot });
      if (filesMatch(targetRoot, files)) return Object.freeze({ action: "skip", reason: "already-current", path: targetRoot, extension: metadata, files: Object.keys(files).sort() });
      if (fs.readdirSync(targetRoot).length > 0) throw scaffoldError("EXTENSION_INIT_TARGET_EXISTS", `Scaffold target is not empty: ${targetRoot}`, { path: targetRoot, remediation: "Choose another directory or remove its files before running extension init." });
    }
    commitDirectory(temporary, targetRoot);
    return Object.freeze({ action: "created", path: targetRoot, extension: metadata, files: Object.keys(files).sort() });
  } finally {
    try { fs.rmSync(temporary, { recursive: true, force: true }); } catch {}
  }
}

function digestUpdate(target) {
  const packageRoot = path.resolve(target || ".");
  const packageJsonFile = path.join(packageRoot, "package.json");
  const extensionRoot = path.join(packageRoot, "extension");
  const manifestFile = path.join(extensionRoot, "manifest.json");
  const rawPackage = readJson(packageJsonFile, "EXTENSION_NPM_ENVELOPE_INVALID");
  const rawManifest = readJson(manifestFile, "EXTENSION_MANIFEST_PARSE_FAILED");
  const manifest = validateShellManifest(rawManifest);
  validateExtensionTransportEnvelope(rawPackage, { expectedId: manifest.id, expectedVersion: manifest.version, expectedExtensionSpecVersion: manifest.extensionSpecVersion });
  if (rawPackage.description !== rawManifest.description) throw scaffoldError("EXTENSION_NPM_IDENTITY_MISMATCH", "npm transport description does not match the Extension manifest", { field: "description", expected: rawManifest.description, actual: rawPackage.description });
  const entryFile = path.join(extensionRoot, ...rawManifest.entry.split("/"));
  if (!fs.existsSync(entryFile)) throw scaffoldError("EXTENSION_ENTRY_MISSING", `Extension entry is missing: ${entryFile}`, { path: entryFile });
  const nextManifest = { ...rawManifest, entrySha256: sha256(fs.readFileSync(entryFile)) };
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "code-workspace-digest-"));
  try {
    const tempExtension = path.join(temporary, "extension");
    fs.cpSync(extensionRoot, tempExtension, { recursive: true, force: true });
    fs.writeFileSync(path.join(tempExtension, "manifest.json"), `${JSON.stringify(nextManifest, null, 2)}\n`);
    const packageSha256 = directoryDigest(tempExtension);
    const nextPackage = { ...rawPackage, codeWorkspace: { ...rawPackage.codeWorkspace, packageSha256 } };
    validateExtensionTransportEnvelope(nextPackage, { expectedId: manifest.id, expectedVersion: manifest.version, expectedExtensionSpecVersion: manifest.extensionSpecVersion, expectedPackageSha256: packageSha256 });
    const nextManifestBytes = Buffer.from(`${JSON.stringify(nextManifest, null, 2)}\n`, "utf8");
    const nextPackageBytes = Buffer.from(`${JSON.stringify(nextPackage, null, 2)}\n`, "utf8");
    if (fs.readFileSync(packageJsonFile).equals(nextPackageBytes) && fs.readFileSync(manifestFile).equals(nextManifestBytes)) return Object.freeze({ action: "skip", reason: "already-current", path: packageRoot, extension: { id: manifest.id, version: manifest.version }, entrySha256: nextManifest.entrySha256, packageSha256, updatedFiles: [] });
    const transaction = createFileTransaction([packageJsonFile, manifestFile]);
    try {
      atomicWrite(manifestFile, nextManifestBytes);
      atomicWrite(packageJsonFile, nextPackageBytes);
      transaction.commit();
    } catch (error) {
      transaction.rollback(error);
      throw error;
    }
    return Object.freeze({ action: "updated", path: packageRoot, extension: { id: manifest.id, version: manifest.version }, entrySha256: nextManifest.entrySha256, packageSha256, updatedFiles: ["extension/manifest.json", "package.json"] });
  } finally {
    try { fs.rmSync(temporary, { recursive: true, force: true }); } catch {}
  }
}

module.exports = { digestUpdate, scaffoldExtensionPackage, validateScaffoldMetadata };
