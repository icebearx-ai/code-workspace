const crypto = require("node:crypto");
const fs = require("node:fs");
const https = require("node:https");
const path = require("node:path");
const zlib = require("node:zlib");

function archiveError(code, message, details = {}) {
  return Object.assign(new Error(message), { code, details });
}

function safeRelativePath(value) {
  const normalized = String(value || "").replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/$/, "");
  if (!normalized || path.posix.isAbsolute(normalized) || normalized.split("/").some((part) => !part || part === "." || part === "..")) {
    throw archiveError("JIRA_ARCHIVE_UNSAFE", `Unsafe archive path: ${value || "<empty>"}`, { path: value || null });
  }
  return normalized;
}

function tarString(buffer, start, length) {
  return buffer.subarray(start, start + length).toString("utf8").replace(/\0.*$/s, "").trim();
}

function tarNumber(buffer, start, length) {
  const value = tarString(buffer, start, length).replace(/^0+/, "") || "0";
  if (!/^[0-7]+$/.test(value)) throw archiveError("JIRA_ARCHIVE_INVALID", `Invalid tar numeric field: ${value}`);
  return Number.parseInt(value, 8);
}

function parsePax(content) {
  const values = {};
  let offset = 0;
  while (offset < content.length) {
    const space = content.indexOf(0x20, offset);
    if (space < 0) throw archiveError("JIRA_ARCHIVE_INVALID", "Invalid PAX record length");
    const length = Number(content.subarray(offset, space).toString("ascii"));
    if (!Number.isInteger(length) || length <= 0 || offset + length > content.length) throw archiveError("JIRA_ARCHIVE_INVALID", "Invalid PAX record");
    const record = content.subarray(space + 1, offset + length - 1).toString("utf8");
    const equal = record.indexOf("=");
    if (equal > 0) values[record.slice(0, equal)] = record.slice(equal + 1);
    offset += length;
  }
  return values;
}

function assertTarChecksum(buffer, offset) {
  const expected = tarNumber(buffer, offset + 148, 8);
  let actual = 0;
  for (let index = 0; index < 512; index += 1) actual += index >= 148 && index < 156 ? 0x20 : buffer[offset + index];
  if (actual !== expected) throw archiveError("JIRA_ARCHIVE_INVALID", "Tar header checksum mismatch");
}

function extractTarGz(archiveFile, outputRoot, options) {
  let tar;
  try {
    tar = zlib.gunzipSync(fs.readFileSync(archiveFile), { maxOutputLength: options.maxExtractBytes + 1024 * 1024 });
  } catch (error) {
    if (error.code === "ERR_BUFFER_TOO_LARGE" || /larger than/.test(error.message)) throw archiveError("JIRA_ARCHIVE_TOO_LARGE", `Archive expands beyond ${options.maxExtractBytes} bytes`, { limit: options.maxExtractBytes });
    throw archiveError("JIRA_ARCHIVE_INVALID", `Cannot decompress tar.gz archive: ${error.message}`);
  }
  fs.mkdirSync(outputRoot, { recursive: true });
  const seen = new Set();
  let files = 0;
  let extractedBytes = 0;
  let offset = 0;
  let pax = {};
  let longPath = null;
  const links = [];
  while (offset + 512 <= tar.length) {
    const header = tar.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) break;
    assertTarChecksum(tar, offset);
    const type = String.fromCharCode(header[156] || 0x30);
    const size = tarNumber(tar, offset + 124, 12);
    const mode = tarNumber(tar, offset + 100, 8);
    const prefix = tarString(tar, offset + 345, 155);
    const rawName = tarString(tar, offset, 100);
    let name = longPath || pax.path || (prefix ? `${prefix}/${rawName}` : rawName);
    longPath = null;
    pax = {};
    const contentStart = offset + 512;
    const contentEnd = contentStart + size;
    if (contentEnd > tar.length) throw archiveError("JIRA_ARCHIVE_INVALID", "Truncated tar entry");
    const content = tar.subarray(contentStart, contentEnd);
    offset = contentStart + Math.ceil(size / 512) * 512;
    if (type === "x") {
      pax = parsePax(content);
      continue;
    }
    if (type === "L") {
      longPath = content.toString("utf8").replace(/\0.*$/s, "").trim();
      continue;
    }
    if (!["0", "\0", "5", "2"].includes(type)) throw archiveError("JIRA_ARCHIVE_UNSAFE", `Unsupported tar entry type ${JSON.stringify(type)} for ${name}`, { path: name, type });
    name = safeRelativePath(name);
    const rootPrefix = `${options.root}/`;
    if (name !== options.root && !name.startsWith(rootPrefix)) throw archiveError("JIRA_ARCHIVE_UNSAFE", `Archive entry is outside expected root ${options.root}: ${name}`, { path: name, root: options.root });
    const relative = name === options.root ? "" : name.slice(rootPrefix.length);
    if (!relative) {
      if (type !== "5") throw archiveError("JIRA_ARCHIVE_UNSAFE", `Archive root must be a directory: ${name}`, { path: name });
      continue;
    }
    const safe = safeRelativePath(relative);
    if (seen.has(safe)) throw archiveError("JIRA_ARCHIVE_UNSAFE", `Duplicate archive path: ${safe}`, { path: safe });
    seen.add(safe);
    files += 1;
    if (files > options.maxFiles) throw archiveError("JIRA_ARCHIVE_TOO_LARGE", `Archive contains more than ${options.maxFiles} entries`, { limit: options.maxFiles });
    extractedBytes += type === "5" || type === "2" ? 0 : size;
    if (extractedBytes > options.maxExtractBytes) throw archiveError("JIRA_ARCHIVE_TOO_LARGE", `Archive expands beyond ${options.maxExtractBytes} bytes`, { limit: options.maxExtractBytes });
    const target = path.join(outputRoot, ...safe.split("/"));
    if (!target.startsWith(`${path.resolve(outputRoot)}${path.sep}`)) throw archiveError("JIRA_ARCHIVE_UNSAFE", `Archive path escapes output: ${safe}`, { path: safe });
    if (type === "5") fs.mkdirSync(target, { recursive: true, mode: mode & 0o777 });
    else if (type === "2") {
      const linkName = tarString(header, 157, 100);
      if (!linkName || path.posix.isAbsolute(linkName)) throw archiveError("JIRA_ARCHIVE_UNSAFE", `Unsafe symbolic link target for ${safe}`, { path: safe, link: linkName });
      links.push({ safe, target, linkName, mode: mode & 0o777 });
    } else {
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, content, { mode: mode & 0o777 });
    }
  }
  for (const link of links) {
    const resolvedRelative = path.posix.normalize(path.posix.join(path.posix.dirname(link.safe), link.linkName));
    if (resolvedRelative === ".." || resolvedRelative.startsWith("../") || path.posix.isAbsolute(resolvedRelative)) throw archiveError("JIRA_ARCHIVE_UNSAFE", `Symbolic link escapes archive root: ${link.safe}`, { path: link.safe, link: link.linkName });
    const source = path.join(outputRoot, ...resolvedRelative.split("/"));
    if (!fs.existsSync(source) || !fs.lstatSync(source).isFile() || fs.lstatSync(source).isSymbolicLink()) throw archiveError("JIRA_ARCHIVE_UNSAFE", `Symbolic link does not resolve to a regular archive file: ${link.safe}`, { path: link.safe, link: link.linkName });
    fs.mkdirSync(path.dirname(link.target), { recursive: true });
    fs.copyFileSync(source, link.target);
    fs.chmodSync(link.target, link.mode);
    extractedBytes += fs.statSync(link.target).size;
    if (extractedBytes > options.maxExtractBytes) throw archiveError("JIRA_ARCHIVE_TOO_LARGE", `Archive expands beyond ${options.maxExtractBytes} bytes`, { limit: options.maxExtractBytes });
  }
  return { files, extractedBytes };
}

function validatePackage(outputRoot, release) {
  const packageFile = path.join(outputRoot, "package.json");
  let value;
  try { value = JSON.parse(fs.readFileSync(packageFile, "utf8")); } catch (error) { throw archiveError("JIRA_PACKAGE_INVALID", `Cannot read extracted package.json: ${error.message}`, { file: packageFile }); }
  if (value.name !== release.package.name || value.version !== release.package.version) {
    throw archiveError("JIRA_PACKAGE_INVALID", `Extracted package identity mismatch: expected ${release.package.name}@${release.package.version}`, { expected: release.package, actual: { name: value.name, version: value.version } });
  }
  const entry = path.join(outputRoot, ...release.entry.split("/"));
  if (!fs.existsSync(entry) || !fs.lstatSync(entry).isFile() || fs.lstatSync(entry).isSymbolicLink()) throw archiveError("JIRA_PACKAGE_INVALID", `Missing package entry: ${release.entry}`, { entry: release.entry });
}

function download(url, file, options, redirects = 0) {
  return new Promise((resolve, reject) => {
    if (redirects > 5) return reject(archiveError("JIRA_DOWNLOAD_FAILED", "Too many download redirects", { url }));
    let parsed;
    try { parsed = new URL(url); } catch { return reject(archiveError("JIRA_DOWNLOAD_FAILED", `Invalid download URL: ${url}`, { url })); }
    if (parsed.protocol !== "https:") return reject(archiveError("JIRA_DOWNLOAD_FAILED", `Download URL must use HTTPS: ${url}`, { url }));
    if (!Array.isArray(options.allowedHosts) || !options.allowedHosts.includes(parsed.hostname)) {
      return reject(archiveError("JIRA_DOWNLOAD_HOST_FORBIDDEN", `Download host is not allowed: ${parsed.hostname}`, { url, host: parsed.hostname }));
    }
    const request = https.get(parsed, { headers: { "user-agent": "zhuiyi-jira-mcp-extension/0.1.0" } }, (response) => {
      if ([301, 302, 303, 307, 308].includes(response.statusCode) && response.headers.location) {
        response.resume();
        return download(new URL(response.headers.location, parsed).href, file, options, redirects + 1).then(resolve, reject);
      }
      if (response.statusCode !== 200) {
        response.resume();
        return reject(archiveError("JIRA_DOWNLOAD_FAILED", `Download returned HTTP ${response.statusCode}`, { url, statusCode: response.statusCode }));
      }
      const declared = Number(response.headers["content-length"] || 0);
      if (declared > options.maxDownloadBytes) {
        response.resume();
        return reject(archiveError("JIRA_DOWNLOAD_TOO_LARGE", `Download exceeds ${options.maxDownloadBytes} bytes`, { url, limit: options.maxDownloadBytes, actual: declared }));
      }
      const stream = fs.createWriteStream(file, { flags: "wx", mode: 0o600 });
      const hash = crypto.createHash("sha256");
      let bytes = 0;
      response.on("data", (chunk) => {
        bytes += chunk.length;
        if (bytes > options.maxDownloadBytes) request.destroy(archiveError("JIRA_DOWNLOAD_TOO_LARGE", `Download exceeds ${options.maxDownloadBytes} bytes`, { url, limit: options.maxDownloadBytes, actual: bytes }));
        else hash.update(chunk);
      });
      response.pipe(stream);
      stream.on("finish", () => stream.close(() => resolve({ bytes, sha256: hash.digest("hex"), finalUrl: parsed.href })));
      stream.on("error", reject);
    });
    request.setTimeout(options.downloadTimeoutMs, () => request.destroy(archiveError("JIRA_DOWNLOAD_TIMEOUT", `Download timed out after ${options.downloadTimeoutMs}ms`, { url, timeoutMs: options.downloadTimeoutMs })));
    request.on("error", (error) => reject(error.code?.startsWith("JIRA_") ? error : archiveError("JIRA_DOWNLOAD_FAILED", `Download failed: ${error.message}`, { url })));
  });
}

async function prepareRelease(release, outputRoot, options = {}) {
  const archiveFile = path.join(path.dirname(outputRoot), "zhuiyi-jira-mcp.tar.gz");
  const downloaded = options.downloaded || await download(release.url, archiveFile, release);
  if (downloaded.sha256 !== release.sha256) throw archiveError("JIRA_ARCHIVE_HASH_MISMATCH", `Archive hash mismatch for ${release.url}`, { url: release.url, expectedSha256: release.sha256, actualSha256: downloaded.sha256 });
  const source = options.archiveFile || archiveFile;
  const extracted = extractTarGz(source, outputRoot, release);
  validatePackage(outputRoot, release);
  return { ...downloaded, ...extracted };
}

module.exports = { archiveError, download, extractTarGz, prepareRelease, safeRelativePath, validatePackage };
