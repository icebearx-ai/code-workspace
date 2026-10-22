const { loadConfig } = require("../../core/config");
const { WorkspaceError } = require("../../core/errors");
const { loadInitManifest } = require("../../core/init");
const { installPluginFiles, planPluginInstall, planPluginUninstall, uninstallPluginFiles } = require("../../core/plugin");
const { resolveWorkspaceTools } = require("../../core/tools");
const { confirm } = require("../confirmation");
const { success } = require("../result");

async function executePlugin(invocation) {
  const command = invocation.definition.path.join(" ");
  if (command === "plugin install") return await executePluginInstall(invocation);
  if (command === "plugin uninstall") return await executePluginUninstall(invocation);
  throw new WorkspaceError("CLI_HANDLER_MISSING", `Unsupported plugin action: ${command}`);
}

async function executePluginInstall(invocation) {
  const { options, root: rawRoot, config } = invocation;
  const root = rawRoot;
  const manifest = loadInitManifest();
  const toolSelection = resolveWorkspaceTools({
    state: config?.state,
    manifestTools: manifest.tools,
  });
  if (!toolSelection.tools.includes("claude")) {
    throw new WorkspaceError("PLUGIN_CLAUDE_NOT_SELECTED", "plugin install requires Claude Code to be selected as a tool.", {
      remediation: "Re-run codew init with --tools claude.",
    });
  }

  const plans = planPluginInstall(root);
  const planText = plans.map((p) => `  ${p.action.toUpperCase()} ${p.relativePath}`).join("\n");
  const confirmed = await confirm(`Generate Claude Code plugin structure?\n${planText}`, options);
  if (!confirmed) {
    return success("plugin.install", { action: "cancel" }, "Plugin installation cancelled. No changes were made.");
  }

  const result = installPluginFiles(root);
  return success("plugin.install", {
    files: result.map((p) => ({ path: p.relativePath, action: p.action })),
  }, `Claude Code plugin generated.\nRestart Claude Code to activate the SessionStart hook.\n${planText}`);
}

async function executePluginUninstall(invocation) {
  const { options, root: rawRoot } = invocation;
  const root = rawRoot;
  const plans = planPluginUninstall(root);
  if (plans.length === 0) {
    return success("plugin.uninstall", { action: "skip", reason: "not-installed" }, "No Claude Code plugin structure found.");
  }

  const planText = plans.map((p) => `  REMOVE ${p.relativePath}`).join("\n");
  const confirmed = await confirm(`Remove Claude Code plugin structure?\n${planText}`, options);
  if (!confirmed) {
    return success("plugin.uninstall", { action: "cancel" }, "Plugin uninstall cancelled. No changes were made.");
  }

  const result = uninstallPluginFiles(root);
  return success("plugin.uninstall", { removed: result.removed }, "Claude Code plugin structure removed.");
}

module.exports = { executePlugin };
