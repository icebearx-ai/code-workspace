const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

function atomicWrite(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = path.join(
    path.dirname(file),
    `.${path.basename(file)}.${process.pid}.${Date.now()}.tmp`
  );
  fs.writeFileSync(temporary, content);
  fs.renameSync(temporary, file);
}

function sha256(content) {
  return crypto.createHash("sha256").update(content).digest("hex");
}

function readTextIfExists(file) {
  return fs.existsSync(file) ? fs.readFileSync(file, "utf8") : null;
}

function removeFileIfExists(file) {
  if (fs.existsSync(file)) fs.unlinkSync(file);
}

module.exports = {
  atomicWrite,
  readTextIfExists,
  removeFileIfExists,
  sha256,
};
