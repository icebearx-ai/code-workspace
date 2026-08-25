const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const { WorkspaceError } = require("./errors");

function directoryError(code, message, details = {}) {
  return new WorkspaceError(code, message, details);
}

function directoryEntries(root, directory = root) {
  const entries = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name))) {
    const file = path.join(directory, entry.name);
    const relative = path.relative(root, file).split(path.sep).join("/");
    const stat = fs.lstatSync(file);
    if (stat.isSymbolicLink()) throw directoryError("EXTENSION_OUTPUT_SYMLINK", `Extension directory contains a symbolic link: ${relative}`, { path: relative });
    if (stat.isDirectory()) entries.push(...directoryEntries(root, file));
    else if (stat.isFile()) entries.push(`${relative}\0${stat.mode & 0o777}\0${crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex")}`);
    else throw directoryError("EXTENSION_OUTPUT_INVALID", `Extension directory contains a special file: ${relative}`, { path: relative });
  }
  return entries;
}

function directoryDigest(root) {
  if (!fs.existsSync(root)) throw directoryError("EXTENSION_ARTIFACT_MISSING", `Extension directory is missing: ${root}`, { path: root });
  const stat = fs.lstatSync(root);
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw directoryError("EXTENSION_ARTIFACT_TARGET_INVALID", `Extension directory target is not a regular directory: ${root}`, { path: root });
  }
  return crypto.createHash("sha256").update(directoryEntries(root).join("\n")).digest("hex");
}

module.exports = { directoryDigest, directoryEntries };
