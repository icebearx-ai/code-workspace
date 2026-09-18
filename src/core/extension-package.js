const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { pipeline } = require("node:stream/promises");
const zlib = require("node:zlib");
const tar = require("tar");

const { WorkspaceError } = require("./errors");
const {
  EXTENSION_NAME_PATTERN,
  SUPPORTED_EXTENSION_SPEC_VERSIONS,
  inspectExtensionPackageDirectory,
  validateManifest,
} = require("./extensions");

const NPM_EXTENSION_SCOPE = "@codew-ext";
const NPM_PACKAGE_ROOT = "package";
const EXTENSION_PACKAGE_ROOT = "extension";
const EXTENSION_PACKAGE_PREFIX = `${NPM_PACKAGE_ROOT}/${EXTENSION_PACKAGE_ROOT}`;
const ENVELOPE_ARCHIVE_PATH = `${NPM_PACKAGE_ROOT}/package.json`;
const TRANSPORT_ENVELOPE_SCHEMA_VERSION = 1;
const FIXED_TAR_MTIME = new Date(0);
const DEFAULT_PACKAGE_LIMITS = Object.freeze({
  maxFiles: 1024,
  maxFileBytes: 2 * 1024 * 1024,
  maxTotalBytes: 16 * 1024 * 1024,
  maxEnvelopeBytes: 64 * 1024,
});

function packageError(code, message, details = {}) {
  return new WorkspaceError(code, message, details);
}

function sha256(content) {
  return crypto.createHash("sha256").update(content).digest("hex");
}

function normalizeLimits(limits = {}) {
  const merged = { ...DEFAULT_PACKAGE_LIMITS, ...limits };
  for (const [name, value] of Object.entries(merged)) {
    if (!Number.isSafeInteger(value) || value < 1) {
      throw packageError("EXTENSION_PACKAGE_LIMIT_INVALID", `Extension package limit ${name} must be a positive integer`, { limit: name, value });
    }
  }
  return Object.freeze(merged);
}

function extensionNpmPackageName(extensionId) {
  const id = String(extensionId || "");
  if (!EXTENSION_NAME_PATTERN.test(id)) {
    throw packageError("EXTENSION_NAME_INVALID", `Invalid extension name: ${id || "<missing>"}`, { extension: id || null });
  }
  return `${NPM_EXTENSION_SCOPE}/${id}`;
}

function extensionNpmTarballFilename(extensionId, version) {
  return `${NPM_EXTENSION_SCOPE.slice(1)}-${extensionId}-${version}.tgz`;
}

function assertSafeRelativePath(value, code = "EXTENSION_PACKAGE_PATH_INVALID") {
  const relative = String(value || "");
  if (
    !relative || relative.includes("\\") || relative.includes("\0") || path.posix.isAbsolute(relative) ||
    relative.split("/").some((segment) => !segment || segment === "." || segment === "..")
  ) {
    throw packageError(code, `Extension package contains an unsafe path: ${relative || "<missing>"}`, { path: relative || null });
  }
  return relative;
}

function comparePaths(left, right) {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

function collectPackageFiles(root, limits = DEFAULT_PACKAGE_LIMITS, directory = root, files = []) {
  const entries = fs.readdirSync(directory, { withFileTypes: true })
    .sort((left, right) => comparePaths(left.name, right.name));
  for (const entry of entries) {
    const file = path.join(directory, entry.name);
    const relative = assertSafeRelativePath(path.relative(root, file).split(path.sep).join("/"));
    const stat = fs.lstatSync(file);
    if (stat.isSymbolicLink()) {
      throw packageError("EXTENSION_OUTPUT_SYMLINK", `Extension directory contains a symbolic link: ${relative}`, { path: relative });
    }
    if (stat.isDirectory()) {
      collectPackageFiles(root, limits, file, files);
      continue;
    }
    if (!stat.isFile()) {
      throw packageError("EXTENSION_OUTPUT_INVALID", `Extension directory contains a special file: ${relative}`, { path: relative });
    }
    if (stat.nlink > 1) {
      throw packageError("EXTENSION_PACKAGE_HARDLINK", `Extension directory contains a hard link: ${relative}`, { path: relative });
    }
    if (files.length >= limits.maxFiles) {
      throw packageError("EXTENSION_PACKAGE_FILE_COUNT_EXCEEDED", `Extension package contains more than ${limits.maxFiles} files`, {
        maxFiles: limits.maxFiles,
      });
    }
    if (stat.size > limits.maxFileBytes) {
      throw packageError("EXTENSION_PACKAGE_FILE_SIZE_EXCEEDED", `Extension package file ${relative} is larger than ${limits.maxFileBytes} bytes`, {
        path: relative,
        size: stat.size,
        maxFileBytes: limits.maxFileBytes,
      });
    }
    const totalBytes = files.reduce((sum, item) => sum + item.size, 0) + stat.size;
    if (totalBytes > limits.maxTotalBytes) {
      throw packageError("EXTENSION_PACKAGE_TOTAL_SIZE_EXCEEDED", `Extension package is larger than ${limits.maxTotalBytes} bytes`, {
        totalBytes,
        maxTotalBytes: limits.maxTotalBytes,
      });
    }
    files.push(Object.freeze({
      relative,
      absolute: file,
      size: stat.size,
      mode: stat.mode & 0o777,
      sha256: sha256(fs.readFileSync(file)),
    }));
  }
  return files;
}

function buildExtensionTransportEnvelope(inspected) {
  return Object.freeze({
    name: extensionNpmPackageName(inspected.id),
    version: inspected.version,
    description: inspected.manifest.description,
    keywords: Object.freeze(["code-workspace-extension"]),
    codeWorkspace: Object.freeze({
      schemaVersion: TRANSPORT_ENVELOPE_SCHEMA_VERSION,
      extensionId: inspected.id,
      extensionSpecVersion: inspected.extensionSpecVersion,
      packageRoot: EXTENSION_PACKAGE_ROOT,
      packageSha256: inspected.packageSha256,
    }),
    files: Object.freeze([EXTENSION_PACKAGE_ROOT]),
  });
}

function serializeExtensionTransportEnvelope(envelope) {
  return Buffer.from(`${JSON.stringify(envelope, null, 2)}\n`, "utf8");
}

function validateExtensionTransportEnvelope(value, options = {}) {
  const FORBIDDEN_FIELDS = [
    "dependencies",
    "optionalDependencies",
    "peerDependencies",
    "bundledDependencies",
    "bundleDependencies",
    "scripts",
  ];
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw packageError("EXTENSION_NPM_ENVELOPE_INVALID", "npm transport envelope must be a JSON object");
  }
  for (const field of FORBIDDEN_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(value, field)) {
      throw packageError("EXTENSION_NPM_ENVELOPE_FORBIDDEN_FIELD", `npm transport envelope must not contain ${field}`, { field });
    }
  }
  const allowed = new Set(["name", "version", "description", "keywords", "codeWorkspace", "files"]);
  const unknown = Object.keys(value).filter((key) => !allowed.has(key));
  if (unknown.length > 0) {
    throw packageError("EXTENSION_NPM_ENVELOPE_INVALID", `npm transport envelope contains unsupported field ${unknown[0]}`, { field: unknown[0] });
  }
  const metadata = value.codeWorkspace;
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    throw packageError("EXTENSION_NPM_ENVELOPE_INVALID", "npm transport envelope requires a codeWorkspace object");
  }
  const metadataAllowed = new Set(["schemaVersion", "extensionId", "extensionSpecVersion", "packageRoot", "packageSha256"]);
  const metadataUnknown = Object.keys(metadata).filter((key) => !metadataAllowed.has(key));
  if (metadataUnknown.length > 0) {
    throw packageError("EXTENSION_NPM_ENVELOPE_INVALID", `npm transport envelope codeWorkspace contains unsupported field ${metadataUnknown[0]}`, { field: metadataUnknown[0] });
  }
  if (metadata.schemaVersion !== TRANSPORT_ENVELOPE_SCHEMA_VERSION) {
    throw packageError("EXTENSION_NPM_ENVELOPE_INVALID", `Unsupported npm transport envelope schemaVersion: ${metadata.schemaVersion ?? "<missing>"}`, {
      schemaVersion: metadata.schemaVersion ?? null,
    });
  }
  const extensionId = String(metadata.extensionId || "");
  if (!EXTENSION_NAME_PATTERN.test(extensionId)) {
    throw packageError("EXTENSION_NPM_ENVELOPE_INVALID", `npm transport envelope has invalid extensionId: ${extensionId || "<missing>"}`, { extensionId: extensionId || null });
  }
  const extensionSpecVersion = metadata.extensionSpecVersion;
  if (!Number.isInteger(extensionSpecVersion) || extensionSpecVersion < 1) {
    throw packageError("EXTENSION_NPM_ENVELOPE_INVALID", "npm transport envelope has invalid extensionSpecVersion", {
      extensionSpecVersion: extensionSpecVersion ?? null,
    });
  }
  if (metadata.packageRoot !== EXTENSION_PACKAGE_ROOT) {
    throw packageError("EXTENSION_NPM_ENVELOPE_INVALID", `npm transport packageRoot must be ${EXTENSION_PACKAGE_ROOT}`, {
      packageRoot: metadata.packageRoot ?? null,
    });
  }
  if (!/^[a-f0-9]{64}$/.test(metadata.packageSha256 || "")) {
    throw packageError("EXTENSION_NPM_ENVELOPE_INVALID", "npm transport envelope has invalid packageSha256");
  }
  const expectedId = options.expectedId ?? extensionId;
  const expectedVersion = options.expectedVersion ?? String(value.version || "");
  const expectedSpec = options.expectedExtensionSpecVersion ?? extensionSpecVersion;
  const identity = (field, actual, expected) => packageError("EXTENSION_NPM_IDENTITY_MISMATCH", `npm transport ${field} does not match the Extension manifest`, {
    field,
    expected,
    actual: actual ?? null,
  });
  if (value.name !== extensionNpmPackageName(expectedId)) throw identity("name", value.name, extensionNpmPackageName(expectedId));
  if (value.version !== expectedVersion) throw identity("version", value.version, expectedVersion);
  if (extensionId !== expectedId) throw identity("extensionId", extensionId, expectedId);
  if (extensionSpecVersion !== expectedSpec) throw identity("extensionSpecVersion", extensionSpecVersion, expectedSpec);
  if (options.expectedPackageSha256 && metadata.packageSha256 !== options.expectedPackageSha256) {
    throw packageError("EXTENSION_NPM_PACKAGE_DIGEST_MISMATCH", "npm transport packageSha256 does not match the frozen Extension package", {
      expectedSha256: options.expectedPackageSha256,
      actualSha256: metadata.packageSha256,
    });
  }
  if (typeof value.description !== "string" || !value.description.trim() || value.description.includes("\n") || value.description.includes("\r")) {
    throw packageError("EXTENSION_NPM_ENVELOPE_INVALID", "npm transport envelope has invalid description");
  }
  if (!Array.isArray(value.keywords) || value.keywords.length === 0 || new Set(value.keywords).size !== value.keywords.length || value.keywords.some((keyword) => typeof keyword !== "string" || !keyword)) {
    throw packageError("EXTENSION_NPM_ENVELOPE_INVALID", "npm transport envelope has invalid keywords");
  }
  if (!value.keywords.includes("code-workspace-extension")) {
    throw packageError("EXTENSION_NPM_ENVELOPE_INVALID", "npm transport envelope must include the code-workspace-extension keyword");
  }
  if (!Array.isArray(value.files) || value.files.length !== 1 || value.files[0] !== EXTENSION_PACKAGE_ROOT) {
    throw packageError("EXTENSION_NPM_ENVELOPE_INVALID", "npm transport envelope files must be exactly [\"extension\"]");
  }
  return Object.freeze({
    name: value.name,
    version: value.version,
    description: value.description,
    keywords: Object.freeze([...value.keywords]),
    codeWorkspace: Object.freeze({
      schemaVersion: metadata.schemaVersion,
      extensionId,
      extensionSpecVersion,
      packageRoot: metadata.packageRoot,
      packageSha256: metadata.packageSha256,
    }),
    files: Object.freeze([...value.files]),
  });
}

function parseEnvelopeBytes(bytes, limits, options = {}) {
  if (bytes.length > limits.maxEnvelopeBytes) {
    throw packageError("EXTENSION_NPM_ENVELOPE_SIZE_EXCEEDED", `npm transport envelope is larger than ${limits.maxEnvelopeBytes} bytes`, {
      size: bytes.length,
      maxEnvelopeBytes: limits.maxEnvelopeBytes,
    });
  }
  let value;
  try {
    value = JSON.parse(bytes.toString("utf8"));
  } catch (error) {
    throw packageError("EXTENSION_NPM_ENVELOPE_PARSE_FAILED", `Cannot parse npm transport envelope: ${error.message}`);
  }
  return validateExtensionTransportEnvelope(value, options);
}

function packageDigestFromRecords(records) {
  const entries = records
    .map((record) => ({ ...record }))
    .sort((left, right) => left.relative.localeCompare(right.relative))
    .map((record) => `${record.relative}\0${record.mode & 0o777}\0${record.sha256}`);
  return crypto.createHash("sha256").update(entries.join("\n")).digest("hex");
}

async function inspectExtensionTransportTarball(file, options = {}) {
  const limits = normalizeLimits(options.limits);
  const records = new Map();
  const caseInsensitivePaths = new Map();
  const archivePaths = [];
  let envelopeChunks = null;
  let envelopeSize = 0;
  let extensionCount = 0;
  let totalBytes = 0;
  let failure = null;

  try {
    await tar.list({
      file,
      strict: true,
      onReadEntry(entry) {
        if (failure) return;
        try {
          const archivePath = String(entry.path || "");
          if (archivePath === ENVELOPE_ARCHIVE_PATH) {
            if (envelopeChunks) throw packageError("EXTENSION_PACKAGE_PATH_DUPLICATE", "npm transport tarball repeats package/package.json", { path: archivePath });
            if (entry.type !== "File") throw packageError("EXTENSION_PACKAGE_FILE_TYPE_INVALID", "npm transport envelope must be a regular file", { path: archivePath, type: entry.type });
            if (!Number.isSafeInteger(entry.size) || entry.size < 0) throw packageError("EXTENSION_PACKAGE_FILE_SIZE_INVALID", "npm transport envelope has invalid size", { path: archivePath });
            if (entry.size > limits.maxEnvelopeBytes) throw packageError("EXTENSION_NPM_ENVELOPE_SIZE_EXCEEDED", `npm transport envelope is larger than ${limits.maxEnvelopeBytes} bytes`, { size: entry.size });
            envelopeChunks = [];
            envelopeSize = entry.size;
            archivePaths.push(archivePath);
            entry.on("data", (chunk) => {
              if (failure || !envelopeChunks) return;
              if (envelopeChunks.reduce((sum, item) => sum + item.length, 0) + chunk.length > envelopeSize) {
                failure = packageError("EXTENSION_TARBALL_VERIFY_FAILED", "npm transport envelope grew while being read", { path: archivePath });
                return;
              }
              envelopeChunks.push(chunk);
            });
            return;
          }
          if (!archivePath.startsWith(`${EXTENSION_PACKAGE_PREFIX}/`)) {
            throw packageError("EXTENSION_PACKAGE_LAYOUT_INVALID", `npm transport tarball contains an unsupported path: ${archivePath || "<missing>"}`, { path: archivePath || null });
          }
          const relative = assertSafeRelativePath(archivePath.slice(EXTENSION_PACKAGE_PREFIX.length + 1));
          if (records.has(relative)) throw packageError("EXTENSION_PACKAGE_PATH_DUPLICATE", `npm transport tarball repeats ${relative}`, { path: relative });
          const caseKey = relative.toLowerCase();
          if (caseInsensitivePaths.has(caseKey) && caseInsensitivePaths.get(caseKey) !== relative) {
            throw packageError("EXTENSION_PACKAGE_PATH_CASE_CONFLICT", `npm transport tarball repeats path ${relative} with different letter case`, {
              path: relative,
              conflict: caseInsensitivePaths.get(caseKey),
            });
          }
          caseInsensitivePaths.set(caseKey, relative);
          if (entry.type !== "File") throw packageError("EXTENSION_PACKAGE_FILE_TYPE_INVALID", `Extension package path ${relative} must be a regular file`, { path: relative, type: entry.type });
          if (!Number.isSafeInteger(entry.size) || entry.size < 0) throw packageError("EXTENSION_PACKAGE_FILE_SIZE_INVALID", `Extension package path ${relative} has invalid size`, { path: relative, size: entry.size ?? null });
          if (extensionCount >= limits.maxFiles) throw packageError("EXTENSION_PACKAGE_FILE_COUNT_EXCEEDED", `Extension package contains more than ${limits.maxFiles} files`, { maxFiles: limits.maxFiles });
          if (entry.size > limits.maxFileBytes) throw packageError("EXTENSION_PACKAGE_FILE_SIZE_EXCEEDED", `Extension package file ${relative} is larger than ${limits.maxFileBytes} bytes`, { path: relative, size: entry.size, maxFileBytes: limits.maxFileBytes });
          if (totalBytes + entry.size > limits.maxTotalBytes) throw packageError("EXTENSION_PACKAGE_TOTAL_SIZE_EXCEEDED", `Extension package is larger than ${limits.maxTotalBytes} bytes`, { totalBytes: totalBytes + entry.size, maxTotalBytes: limits.maxTotalBytes });
          const hash = crypto.createHash("sha256");
          const chunks = relative === "manifest.json" || relative === "init.js" ? [] : null;
          const record = { relative, size: entry.size, mode: entry.mode & 0o777, sha256: null, bytesRead: 0, chunks };
          records.set(relative, record);
          archivePaths.push(archivePath);
          extensionCount += 1;
          totalBytes += entry.size;
          entry.on("data", (chunk) => {
            if (failure) return;
            record.bytesRead += chunk.length;
            if (record.bytesRead > record.size) {
              failure = packageError("EXTENSION_TARBALL_VERIFY_FAILED", `Extension package path ${relative} grew while being read`, { path: relative });
              return;
            }
            hash.update(chunk);
            if (chunks) chunks.push(chunk);
          });
          entry.on("end", () => {
            if (failure) return;
            record.sha256 = hash.digest("hex");
          });
        } catch (error) {
          failure = error;
        }
      },
    });
  } catch (error) {
    if (error instanceof WorkspaceError) throw error;
    throw packageError("EXTENSION_TARBALL_READ_FAILED", `Cannot read extension npm tarball: ${error.message}`, { path: path.resolve(file), cause: error.code });
  }
  if (failure) throw failure;
  if (!envelopeChunks) throw packageError("EXTENSION_PACKAGE_LAYOUT_INVALID", `npm transport tarball is missing ${ENVELOPE_ARCHIVE_PATH}`, { path: ENVELOPE_ARCHIVE_PATH });
  const envelopeBytes = Buffer.concat(envelopeChunks);
  if (envelopeBytes.length !== envelopeSize) throw packageError("EXTENSION_TARBALL_VERIFY_FAILED", "npm transport envelope is truncated", { path: ENVELOPE_ARCHIVE_PATH });
  const envelope = parseEnvelopeBytes(envelopeBytes, limits, options);
  const manifestRecord = records.get("manifest.json");
  const entryRecord = records.get("init.js");
  if (!manifestRecord || !entryRecord) {
    throw packageError("EXTENSION_PACKAGE_LAYOUT_INVALID", "Extension package payload must contain manifest.json and init.js");
  }
  if (manifestRecord.bytesRead !== manifestRecord.size || !manifestRecord.sha256 || entryRecord.bytesRead !== entryRecord.size || !entryRecord.sha256) {
    throw packageError("EXTENSION_TARBALL_VERIFY_FAILED", "Extension package payload is truncated", { path: ENVELOPE_ARCHIVE_PATH });
  }
  let rawManifest;
  try {
    rawManifest = JSON.parse(Buffer.concat(manifestRecord.chunks).toString("utf8"));
  } catch (error) {
    throw packageError("EXTENSION_MANIFEST_PARSE_FAILED", `Cannot parse ${EXTENSION_PACKAGE_PREFIX}/manifest.json: ${error.message}`, { path: `${EXTENSION_PACKAGE_PREFIX}/manifest.json` });
  }
  const identity = (field, actual, expected) => packageError("EXTENSION_NPM_IDENTITY_MISMATCH", `npm transport ${field} does not match the Extension manifest`, { field, expected, actual });
  if (rawManifest.id !== envelope.codeWorkspace.extensionId) throw identity("extensionId", rawManifest.id, envelope.codeWorkspace.extensionId);
  if (rawManifest.version !== envelope.version) throw identity("version", rawManifest.version, envelope.version);
  if (rawManifest.extensionSpecVersion !== envelope.codeWorkspace.extensionSpecVersion) throw identity("extensionSpecVersion", rawManifest.extensionSpecVersion, envelope.codeWorkspace.extensionSpecVersion);
  const manifest = validateManifest(rawManifest, {
    expectedId: envelope.codeWorkspace.extensionId,
    expectedVersion: envelope.version,
    supportedExtensionSpecVersions: options.supportedExtensionSpecVersions || SUPPORTED_EXTENSION_SPEC_VERSIONS,
    ...(options.protectedTargets ? { protectedTargets: options.protectedTargets } : {}),
  });
  const manifestSha256 = sha256(Buffer.concat(manifestRecord.chunks));
  const entrySha256 = sha256(Buffer.concat(entryRecord.chunks));
  if (manifestSha256 !== manifestRecord.sha256 || entrySha256 !== entryRecord.sha256) {
    throw packageError("EXTENSION_TARBALL_VERIFY_FAILED", "Extension package digest verification failed");
  }
  if (manifest.entry !== "init.js" || manifest.entrySha256 !== entrySha256) {
    throw packageError("EXTENSION_ENTRY_HASH_MISMATCH", `Extension entry hash mismatch: ${manifest.id}@${manifest.version}`, {
      extension: manifest.id,
      version: manifest.version,
      expectedSha256: manifest.entrySha256,
      actualSha256: entrySha256,
    });
  }
  const packageRecords = [...records.values()];
  const packageSha256 = packageDigestFromRecords(packageRecords);
  if (packageSha256 !== envelope.codeWorkspace.packageSha256) {
    throw packageError("EXTENSION_NPM_PACKAGE_DIGEST_MISMATCH", "npm transport packageSha256 does not match the unpacked Extension package", {
      expectedSha256: envelope.codeWorkspace.packageSha256,
      actualSha256: packageSha256,
    });
  }
  if (options.expectedFiles) {
    const expectedFiles = options.expectedFiles;
    const matches = expectedFiles.length === packageRecords.length && expectedFiles.every((expected) => {
      const actual = records.get(expected.relative);
      return actual && actual.size === expected.size && actual.mode === expected.mode && actual.sha256 === expected.sha256;
    });
    if (!matches) throw packageError("EXTENSION_TARBALL_CONTENT_MISMATCH", "Unpacked Extension package does not match the frozen source", { path: EXTENSION_PACKAGE_PREFIX });
  }
  return Object.freeze({
    envelope,
    manifest,
    files: Object.freeze(archivePaths),
    fileCount: packageRecords.length,
    totalBytes,
    manifestSha256,
    entrySha256,
    packageSha256,
  });
}

async function extractExtensionTransportTarball(file, destinationRoot, options = {}) {
  const inspected = await inspectExtensionTransportTarball(file, options);
  const root = path.resolve(destinationRoot);
  fs.mkdirSync(root, { recursive: true });
  const allowed = new Set(inspected.files);
  const extractedCases = new Map();
  try {
    await tar.x({
      file: path.resolve(file),
      cwd: root,
      strict: true,
      unlink: false,
      keep: false,
      filter: (archivePath) => allowed.has(archivePath),
      onentry(entry) {
        const archivePath = String(entry.path || "");
        if (!allowed.has(archivePath)) {
          throw packageError("EXTENSION_PACKAGE_LAYOUT_INVALID", `npm transport tarball contains an unsupported path: ${archivePath || "<missing>"}`, { path: archivePath || null });
        }
        if (entry.type !== "File") {
          throw packageError("EXTENSION_PACKAGE_FILE_TYPE_INVALID", `Extension package path ${archivePath} must be a regular file`, { path: archivePath, type: entry.type });
        }
        const relative = assertSafeRelativePath(archivePath.slice(EXTENSION_PACKAGE_PREFIX.length + 1));
        const caseKey = relative.toLowerCase();
        if (extractedCases.has(caseKey) && extractedCases.get(caseKey) !== relative) {
          throw packageError("EXTENSION_PACKAGE_PATH_CASE_CONFLICT", `npm transport tarball repeats path ${relative} with different letter case`, {
            path: relative,
            conflict: extractedCases.get(caseKey),
          });
        }
        extractedCases.set(caseKey, relative);
      },
    });
  } catch (error) {
    if (error instanceof WorkspaceError) throw error;
    throw packageError("EXTENSION_TARBALL_EXTRACT_FAILED", `Cannot safely extract extension npm tarball: ${error.message}`, {
      path: path.resolve(file),
      cause: error.code,
    });
  }
  const extensionRoot = path.join(root, NPM_PACKAGE_ROOT, EXTENSION_PACKAGE_ROOT);
  const extensionStat = fs.lstatSync(extensionRoot);
  if (!extensionStat.isDirectory() || extensionStat.isSymbolicLink()) {
    throw packageError("EXTENSION_PACKAGE_LAYOUT_INVALID", "Extracted Extension package root is not a regular directory", { path: EXTENSION_PACKAGE_PREFIX });
  }
  return Object.freeze({ ...inspected, sourceRoot: extensionRoot });
}

function normalizeTarMetadata(entry) {
  entry.uid = 0;
  entry.gid = 0;
  entry.uname = undefined;
  entry.gname = undefined;
  entry.atime = undefined;
  entry.ctime = undefined;
  if (entry.stat) {
    entry.stat.uid = 0;
    entry.stat.gid = 0;
    entry.stat.atime = undefined;
    entry.stat.ctime = undefined;
    entry.stat.dev = undefined;
    entry.stat.ino = undefined;
    entry.stat.nlink = 1;
  }
}

async function writeTransportTarball({ sourceRoot, files, envelopeBytes, target, limits }) {
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "code-workspace-pack-"));
  try {
    const envelopeFile = path.join(temporaryRoot, "package.json");
    const envelopeTar = path.join(temporaryRoot, "envelope.tar");
    const extensionTar = path.join(temporaryRoot, "extension.tar");
    fs.writeFileSync(envelopeFile, envelopeBytes, { mode: 0o644 });
    await tar.c({
      file: envelopeTar,
      cwd: temporaryRoot,
      prefix: NPM_PACKAGE_ROOT,
      portable: false,
      mtime: FIXED_TAR_MTIME,
      onWriteEntry: normalizeTarMetadata,
    }, ["package.json"]);
    await tar.c({
      file: extensionTar,
      cwd: sourceRoot,
      prefix: EXTENSION_PACKAGE_PREFIX,
      portable: false,
      mtime: FIXED_TAR_MTIME,
      noDirRecurse: true,
      jobs: 1,
      onWriteEntry: normalizeTarMetadata,
    }, files.map((file) => file.relative));
    await tar.r({
      file: envelopeTar,
      sync: true,
      onWriteEntry: normalizeTarMetadata,
    }, [`@${extensionTar}`]);
    await pipeline(
      fs.createReadStream(envelopeTar),
      zlib.createGzip({ mtime: 0 }),
      fs.createWriteStream(target, { mode: 0o644 })
    );
    if (fs.statSync(target).size > limits.maxTotalBytes + limits.maxEnvelopeBytes + 1024 * 1024) {
      throw packageError("EXTENSION_PACKAGE_TOTAL_SIZE_EXCEEDED", "Generated extension npm tarball exceeds the size limit", {
        maxTotalBytes: limits.maxTotalBytes,
      });
    }
  } finally {
    try {
      fs.rmSync(temporaryRoot, { recursive: true, force: true });
    } catch {
      // Cleanup must not replace the original packing failure.
    }
  }
}

function assertSourceUnchanged(sourceRoot, inspected, files, limits) {
  let currentInspected;
  let currentFiles;
  try {
    currentInspected = inspectExtensionPackageDirectory(sourceRoot, {
      expectedId: inspected.id,
      expectedVersion: inspected.version,
      ...(inspected.extensionSpecVersion ? { supportedExtensionSpecVersions: [inspected.extensionSpecVersion] } : {}),
    });
    currentFiles = collectPackageFiles(sourceRoot, limits);
  } catch (error) {
    throw packageError("EXTENSION_PACKAGE_CHANGED", `Extension package changed while packing: ${inspected.id}@${inspected.version}`, {
      extension: inspected.id,
      version: inspected.version,
      cause: error.code,
    });
  }
  const digestMatches = currentInspected.packageSha256 === inspected.packageSha256 &&
    currentInspected.manifestSha256 === inspected.manifestSha256 &&
    currentInspected.entrySha256 === inspected.entrySha256;
  const filesMatch = currentFiles.length === files.length && currentFiles.every((file, index) =>
    file.relative === files[index].relative && file.size === files[index].size && file.mode === files[index].mode && file.sha256 === files[index].sha256
  );
  if (!digestMatches || !filesMatch) {
    throw packageError("EXTENSION_PACKAGE_CHANGED", `Extension package changed while packing: ${inspected.id}@${inspected.version}`, {
      extension: inspected.id,
      version: inspected.version,
    });
  }
}

async function hashFile(file, algorithm, encoding) {
  const hash = crypto.createHash(algorithm);
  await new Promise((resolve, reject) => {
    fs.createReadStream(file)
      .on("data", (chunk) => hash.update(chunk))
      .on("error", reject)
      .on("end", () => resolve());
  });
  return hash.digest(encoding);
}

async function packExtensionToDirectory(source, outputDirectory, options = {}) {
  const limits = normalizeLimits(options.limits);
  const outputRoot = path.resolve(outputDirectory);
  const inspected = inspectExtensionPackageDirectory(source, {
    ...(options.expectedId ? { expectedId: options.expectedId } : {}),
    ...(options.expectedVersion ? { expectedVersion: options.expectedVersion } : {}),
    ...(options.supportedExtensionSpecVersions ? { supportedExtensionSpecVersions: options.supportedExtensionSpecVersions } : {}),
    ...(options.protectedTargets ? { protectedTargets: options.protectedTargets } : {}),
  });
  const files = collectPackageFiles(inspected.sourceRoot, limits);
  try {
    fs.mkdirSync(outputRoot, { recursive: true });
  } catch (error) {
    throw packageError("EXTENSION_PACK_OUTPUT_CREATE_FAILED", `Cannot create output directory: ${outputRoot}`, {
      path: outputRoot,
      cause: error.code,
    });
  }
  const outputStat = fs.lstatSync(outputRoot);
  if (!outputStat.isDirectory() || outputStat.isSymbolicLink()) {
    throw packageError("EXTENSION_PACK_OUTPUT_INVALID", `Output must be a regular directory: ${outputRoot}`, { path: outputRoot });
  }
  const envelope = buildExtensionTransportEnvelope(inspected);
  const envelopeBytes = serializeExtensionTransportEnvelope(envelope);
  const filename = extensionNpmTarballFilename(inspected.id, inspected.version);
  const target = path.join(outputRoot, filename);
  let targetExists = false;
  try {
    fs.lstatSync(target);
    targetExists = true;
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  if (targetExists) {
    throw packageError("EXTENSION_PACK_OUTPUT_EXISTS", `Extension package output already exists: ${target}`, {
      path: target,
      remediation: "Move or remove the existing tarball, or choose another output directory.",
    });
  }

  const temporaryTarget = path.join(outputRoot, `.${filename}.${process.pid}.${crypto.randomUUID()}.tmp`);
  const fd = fs.openSync(temporaryTarget, "wx", 0o600);
  fs.closeSync(fd);
  let targetReserved = false;
  try {
    const createTarball = options.createTarball || writeTransportTarball;
    try {
      await createTarball({ sourceRoot: inspected.sourceRoot, files, envelopeBytes, target: temporaryTarget, limits });
    } catch (error) {
      if (error instanceof WorkspaceError) throw error;
      throw packageError("EXTENSION_TARBALL_CREATE_FAILED", `Cannot create extension npm tarball: ${error.message}`, {
        path: target,
        cause: error.code,
      });
    }
    options.injectFailure?.("after-create");

    assertSourceUnchanged(inspected.sourceRoot, inspected, files, limits);
    const inspectTarball = options.inspectTarball || inspectExtensionTransportTarball;
    let verified;
    try {
      verified = await inspectTarball(temporaryTarget, {
        expectedId: inspected.id,
        expectedVersion: inspected.version,
        expectedExtensionSpecVersion: inspected.extensionSpecVersion,
        expectedPackageSha256: inspected.packageSha256,
        expectedFiles: files,
        ...(options.protectedTargets ? { protectedTargets: options.protectedTargets } : {}),
        limits,
      });
    } catch (error) {
      if (error instanceof WorkspaceError) throw error;
      throw packageError("EXTENSION_TARBALL_VERIFY_FAILED", `Cannot verify extension npm tarball: ${error.message}`, { path: target, cause: error.code });
    }
    if (!verified || verified.packageSha256 !== inspected.packageSha256 || verified.manifestSha256 !== inspected.manifestSha256 || verified.entrySha256 !== inspected.entrySha256) {
      throw packageError("EXTENSION_TARBALL_VERIFY_FAILED", `Extension npm tarball verification failed: ${inspected.id}@${inspected.version}`, {
        extension: inspected.id,
        version: inspected.version,
      });
    }
    options.injectFailure?.("after-verify");

    targetExists = false;
    try {
      fs.lstatSync(target);
      targetExists = true;
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    if (targetExists) {
      throw packageError("EXTENSION_PACK_OUTPUT_EXISTS", `Extension package output already exists: ${target}`, {
        path: target,
        remediation: "Move or remove the existing tarball, or choose another output directory.",
      });
    }
    const tarballBytes = fs.statSync(temporaryTarget).size;
    const integrity = `sha512-${await hashFile(temporaryTarget, "sha512", "base64")}`;
    const targetFd = fs.openSync(target, "wx", 0o600);
    fs.closeSync(targetFd);
    targetReserved = true;
    options.injectFailure?.("before-rename");
    fs.renameSync(temporaryTarget, target);
    targetReserved = false;
    return Object.freeze({
      schemaVersion: 1,
      extensionId: inspected.id,
      version: inspected.version,
      extensionSpecVersion: inspected.extensionSpecVersion,
      npmName: envelope.name,
      tarball: Object.freeze({
        path: target,
        filename,
        bytes: tarballBytes,
        integrity,
        files: verified.files,
      }),
      manifestSha256: inspected.manifestSha256,
      entrySha256: inspected.entrySha256,
      packageSha256: inspected.packageSha256,
    });
  } finally {
    try { fs.unlinkSync(temporaryTarget); } catch { /* cleanup is best-effort */ }
    if (targetReserved) {
      try { fs.unlinkSync(target); } catch { /* cleanup is best-effort */ }
    }
  }
}

module.exports = {
  DEFAULT_PACKAGE_LIMITS,
  EXTENSION_PACKAGE_PREFIX,
  EXTENSION_PACKAGE_ROOT,
  EXTENSION_TRANSPORT_SCHEMA_VERSION: TRANSPORT_ENVELOPE_SCHEMA_VERSION,
  NPM_EXTENSION_SCOPE,
  NPM_PACKAGE_ROOT,
  buildExtensionTransportEnvelope,
  collectPackageFiles,
  extensionNpmPackageName,
  extensionNpmTarballFilename,
  extractExtensionTransportTarball,
  inspectExtensionTransportTarball,
  packExtensionToDirectory,
  validateExtensionTransportEnvelope,
};
