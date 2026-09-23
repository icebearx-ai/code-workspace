const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { pipeline } = require("node:stream/promises");

const { WorkspaceError } = require("./errors");
const { DEFAULT_PACKAGE_LIMITS, extractExtensionTransportTarball } = require("./extension-package");
const { ensureStoredExtensionPackage, packageRecordFromDirectory } = require("./extension-store");

function localError(code, message, details = {}) {
  return new WorkspaceError(code, message, details);
}

async function sha512File(file) {
  const hash = crypto.createHash("sha512");
  await pipeline(fs.createReadStream(file), hash);
  return `sha512-${hash.digest("base64")}`;
}

async function prepareLocalExtensionTarball(file, options = {}) {
  const archive = path.resolve(String(file || ""));
  if (!archive.toLowerCase().endsWith(".tgz")) {
    throw localError("EXTENSION_LOCAL_ARCHIVE_INVALID", "Local extension installation accepts only a .tgz tarball.", { path: archive });
  }
  let stat;
  try { stat = fs.lstatSync(archive); } catch (error) {
    throw localError("EXTENSION_LOCAL_ARCHIVE_MISSING", `Local extension tarball is missing: ${archive}`, { path: archive, cause: error.code });
  }
  if (!stat.isFile() || stat.isSymbolicLink()) throw localError("EXTENSION_LOCAL_ARCHIVE_INVALID", `Local extension tarball must be a regular file: ${archive}`, { path: archive });
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "code-workspace-local-extension-"));
  try {
    const limits = options.packageLimits || DEFAULT_PACKAGE_LIMITS;
    const inspected = await extractExtensionTransportTarball(archive, path.join(temporaryRoot, "unpacked"), { limits });
    const integrity = await sha512File(archive);
    const packageRecord = packageRecordFromDirectory(inspected.sourceRoot, {
      id: inspected.manifest.id,
      version: inspected.manifest.version,
      validate: options.validate,
    });
    return Object.freeze({ sourceRoot: inspected.sourceRoot, packageRecord, archive: Object.freeze({ path: archive, integrity }), cleanup: () => fs.rmSync(temporaryRoot, { recursive: true, force: true }) });
  } catch (error) {
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
    if (error instanceof WorkspaceError) throw error;
    throw localError("EXTENSION_LOCAL_ARCHIVE_INVALID", `Cannot import local extension tarball: ${error.message}`, { path: archive, cause: error.code });
  }
}

async function importLocalExtensionTarball(file, options = {}) {
  const prepared = await prepareLocalExtensionTarball(file, options);
  try {
    const stored = ensureStoredExtensionPackage({
      sourceRoot: prepared.sourceRoot,
      storeRoot: options.extensionStoreRoot,
      id: prepared.packageRecord.id,
      version: prepared.packageRecord.version,
      provenance: { kind: "local", archiveIntegrity: prepared.archive.integrity },
      validate: options.validate,
    });
    return Object.freeze({ ...stored, source: stored.source || "local", archive: prepared.archive, extensionSpecVersion: prepared.packageRecord.manifest.extensionSpecVersion });
  } finally {
    prepared.cleanup();
  }
}

module.exports = { importLocalExtensionTarball, prepareLocalExtensionTarball };
