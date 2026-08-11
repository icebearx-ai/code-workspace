const fs = require("node:fs");
const path = require("node:path");
const yaml = require("js-yaml");

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
  ".codex/skills/openspec-workspace-explore/SKILL.md",
  ".codex/skills/openspec-workspace-propose/SKILL.md",
  ".codex/skills/openspec-workspace-apply/SKILL.md",
  ".codex/skills/openspec-workspace-sync-specs/SKILL.md",
  ".codex/skills/openspec-workspace-archive/SKILL.md",
  "USER_GUIDE.zh-CN.md",
];

function selectedObsoleteAssets(tools) {
  const selected = new Set(tools || []);
  return OBSOLETE_ASSETS.filter((target) =>
    (!target.startsWith(".claude/") && !target.startsWith(".codex/")) ||
    (target.startsWith(".claude/") && selected.has("claude")) ||
    (target.startsWith(".codex/") && selected.has("codex"))
  );
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
    const previous = managedFiles[targetRelative];
    const target = path.join(root, targetRelative);
    if (fs.existsSync(target)) {
      fs.unlinkSync(target);
      removeEmptyParents(root, target);
      results.push({ target: targetRelative, action: "remove" });
    }
    delete managedFiles[targetRelative];
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

function ensureWorkspaceSchemaSelection(root) {
  const configFile = path.join(root, "openspec", "config.yaml");
  if (!fs.existsSync(configFile)) throw new WorkspaceError("OPENSPEC_CONFIG_MISSING", "Missing openspec/config.yaml", { file: configFile });
  const config = yaml.load(fs.readFileSync(configFile, "utf8")) || {};
  if (config.schema === "workspace-workflow") return { action: "skip", schema: config.schema };
  throw new WorkspaceError("WORKSPACE_SCHEMA_INVALID", `OpenSpec config schema must be workspace-workflow; found ${config.schema || "missing"}`, { actual: config.schema || null, expected: "workspace-workflow" });
}

function verifyWorkspaceSchemaSelection(root) {
  const configFile = path.join(root, "openspec", "config.yaml");
  if (!fs.existsSync(configFile)) return { errors: ["Missing openspec/config.yaml"] };
  const config = yaml.load(fs.readFileSync(configFile, "utf8")) || {};
  return {
    errors: config.schema === "workspace-workflow"
      ? []
      : [`OpenSpec config schema must be workspace-workflow; found ${config.schema || "missing"}`],
  };
}

module.exports = {
  OBSOLETE_ASSETS,
  cleanupObsoleteAssets,
  ensureWorkspaceSchemaSelection,
  planObsoleteAssets,
  selectedObsoleteAssets,
  verifyWorkspaceSchemaSelection,
};
