const fs = require("node:fs");
const path = require("node:path");
const { loadState, saveState } = require("./config");
const { WorkspaceError } = require("./errors");
const { sha256 } = require("./fs");

const OBSOLETE_ASSETS = [
  "AGENT.md",
  ".claude/commands/opsxw/add-projects.md",
  ".claude/commands/opsxw/explore.md",
  ".claude/commands/opsxw/propose.md",
  ".claude/commands/opsxw/apply.md",
  ".claude/commands/opsxw/sync-specs.md",
  ".claude/commands/opsxw/archive.md",
  "USER_GUIDE.zh-CN.md",
];

const FORGOTTEN_ASSETS = [];

function selectedObsoleteAssets(tools) {
  void tools;
  return OBSOLETE_ASSETS.slice();
}

function removeEmptyParents(root, file) {
  const stop = path.resolve(root);
  let directory = path.dirname(file);
  while (directory !== stop && directory.startsWith(`${stop}${path.sep}`)) {
    if (fs.readdirSync(directory).length > 0) break;
    fs.rmdirSync(directory);
    directory = path.dirname(directory);
  }
}

function cleanupObsoleteAssets(root, tools, options = {}) {
  const state = loadState(root) || { schemaVersion: 2, managedFiles: {} };
  const managedFiles = { ...(state.managedFiles || {}) };
  const results = [];
  for (const item of planObsoleteAssets(root, tools, options)) {
    const targetRelative = item.target;
    const target = path.join(root, targetRelative);
    if (fs.existsSync(target)) {
      fs.unlinkSync(target);
      removeEmptyParents(root, target);
      results.push({ target: targetRelative, action: "remove" });
    }
    delete managedFiles[targetRelative];
  }
  for (const targetRelative of FORGOTTEN_ASSETS) {
    if (!managedFiles[targetRelative]) continue;
    delete managedFiles[targetRelative];
    results.push({ target: targetRelative, action: "forget" });
  }
  saveState(root, { ...state, schemaVersion: 2, managedFiles });
  return results;
}

function planObsoleteAssets(root, tools, options = {}) {
  const state = loadState(root) || { schemaVersion: 2, managedFiles: {} };
  const results = [];
  for (const targetRelative of selectedObsoleteAssets(tools)) {
    const previous = state.managedFiles?.[targetRelative];
    if (!previous) continue;
    const target = path.join(root, targetRelative);
    if (fs.existsSync(target)) {
      const expected = previous.installedSha256 || previous.sha256;
      const actual = sha256(fs.readFileSync(target));
      if (!options.force && expected && expected !== actual) {
        throw new WorkspaceError("OBSOLETE_MANAGED_FILE_UNKNOWN", `Obsolete managed file contains unknown changes: ${targetRelative}`, { target: targetRelative });
      }
    }
    results.push({ target: targetRelative, action: fs.existsSync(target) ? "remove" : "forget" });
  }
  return results;
}

module.exports = {
  FORGOTTEN_ASSETS,
  OBSOLETE_ASSETS,
  cleanupObsoleteAssets,
  planObsoleteAssets,
  selectedObsoleteAssets,
};
