const fs = require("node:fs");
const path = require("node:path");

const { WorkspaceError } = require("../errors");
const { sha256 } = require("../fs");

function readTarget(file) {
  const exists = fs.existsSync(file);
  const content = exists ? fs.readFileSync(file, "utf8") : "";
  return { file, exists, content, fingerprint: exists ? sha256(content) : null };
}

function assertFingerprint(plan) {
  const actual = readTarget(plan.target);
  if (actual.fingerprint !== plan.fingerprint) {
    throw new WorkspaceError("WORKSPACE_PERMISSION_PLAN_STALE", `Agent permission target changed after planning: ${plan.target}`, {
      tool: plan.tool,
      file: plan.target,
      expectedFingerprint: plan.fingerprint,
      actualFingerprint: actual.fingerprint,
      remediation: "Review the changed Agent settings and retry the command.",
    });
  }
}

function normalizedExistingDirectory(value) {
  return typeof value === "string" && path.isAbsolute(value) ? path.resolve(value) : null;
}

function planDirectoryMutation(currentDirectories, grants, revokes) {
  const currentNormalized = currentDirectories.map(normalizedExistingDirectory);
  const granted = grants.filter((directory) => !currentNormalized.includes(directory));
  const revoked = revokes.filter((directory) => currentNormalized.includes(directory));
  const unchanged = [
    ...grants.filter((directory) => currentNormalized.includes(directory)),
    ...revokes.filter((directory) => !currentNormalized.includes(directory)),
  ];
  const revokedSet = new Set(revoked);
  const desired = currentDirectories.filter((directory, index) => !revokedSet.has(currentNormalized[index]));
  for (const directory of granted) desired.push(directory);
  return { action: granted.length > 0 || revoked.length > 0 ? "write" : "skip", granted, revoked, unchanged, desired };
}

module.exports = { assertFingerprint, normalizedExistingDirectory, planDirectoryMutation, readTarget };
