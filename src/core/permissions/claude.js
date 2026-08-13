const fs = require("node:fs");
const path = require("node:path");

const { WorkspaceError } = require("../errors");
const { atomicWrite } = require("../fs");
const { assertFingerprint, planDirectoryMutation, readTarget } = require("./common");

function parseSettings(target) {
  if (!target.exists || !target.content.trim()) return {};
  let value;
  try {
    value = JSON.parse(target.content);
  } catch (error) {
    throw new WorkspaceError("CLAUDE_PERMISSION_CONFIG_PARSE_FAILED", `Cannot parse Claude settings ${target.file}: ${error.message}`, { file: target.file });
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new WorkspaceError("CLAUDE_PERMISSION_CONFIG_INVALID", `Claude settings must be a JSON object: ${target.file}`, { file: target.file });
  }
  if (value.permissions != null && (!value.permissions || typeof value.permissions !== "object" || Array.isArray(value.permissions))) {
    throw new WorkspaceError("CLAUDE_PERMISSION_CONFIG_INVALID", `Claude permissions must be a JSON object: ${target.file}`, { file: target.file, field: "permissions" });
  }
  const directories = value.permissions?.additionalDirectories;
  if (directories != null && (!Array.isArray(directories) || directories.some((entry) => typeof entry !== "string"))) {
    throw new WorkspaceError("CLAUDE_PERMISSION_CONFIG_INVALID", `Claude permissions.additionalDirectories must be an array of strings: ${target.file}`, {
      file: target.file,
      field: "permissions.additionalDirectories",
    });
  }
  return value;
}

function renderSettings(settings) {
  return `${JSON.stringify(settings, null, 2)}\n`;
}

const claudePermissionAdapter = {
  id: "claude",
  targets(root) {
    return [path.join(root, ".claude", "settings.local.json")];
  },
  inspect(root) {
    const target = readTarget(this.targets(root)[0]);
    const settings = parseSettings(target);
    return {
      ...target,
      settings,
      directories: settings.permissions?.additionalDirectories || [],
    };
  },
  plan({ current, grants, revokes }) {
    const mutation = planDirectoryMutation(current.directories, grants, revokes);
    const settings = structuredClone(current.settings);
    if (mutation.action === "write") {
      settings.permissions = { ...(settings.permissions || {}), additionalDirectories: mutation.desired };
    }
    return {
      tool: this.id,
      target: current.file,
      targets: [current.file],
      fingerprint: current.fingerprint,
      ...mutation,
      desiredContent: mutation.action === "write" ? renderSettings(settings) : current.content,
    };
  },
  assertCurrent(plan) {
    assertFingerprint(plan);
  },
  apply(plan, options = {}) {
    (options.atomicWrite || atomicWrite)(plan.target, plan.desiredContent);
  },
  verify(plan) {
    let actual;
    try {
      actual = fs.readFileSync(plan.target, "utf8");
    } catch (error) {
      throw new WorkspaceError("WORKSPACE_PERMISSION_VERIFY_FAILED", `Cannot verify Claude directory authorization: ${error.message}`, {
        tool: this.id,
        file: plan.target,
        remediation: "Inspect .claude/settings.local.json and re-run code-w permissions apply.",
      });
    }
    if (actual !== plan.desiredContent) {
      throw new WorkspaceError("WORKSPACE_PERMISSION_VERIFY_FAILED", "Claude directory authorization does not match the confirmed plan.", {
        tool: this.id,
        file: plan.target,
        remediation: "Inspect .claude/settings.local.json and re-run code-w permissions apply.",
      });
    }
  },
};

module.exports = { claudePermissionAdapter, parseSettings, renderSettings };
