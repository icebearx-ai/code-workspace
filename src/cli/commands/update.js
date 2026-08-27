const path = require("node:path");

const { cleanupObsoleteAssets, planObsoleteAssets } = require("../../core/assets");
const {
  configPath,
  loadConfig,
  loadState,
  projectConfigPath,
  saveConfig,
  statePath,
} = require("../../core/config");
const { WorkspaceError } = require("../../core/errors");
const { commitUpdateState, loadInitManifest } = require("../../core/init");
const { workspaceGuide } = require("../../core/language");
const { inspectManagedFiles, installManagedFiles, planManagedFiles } = require("../../core/managed-files");
const { planWorkspaceMaintenance } = require("../../core/migration");
const { inspectProjectPermissions } = require("../../core/permissions");
const { resolveWorkspaceTools } = require("../../core/tools");
const { createFileTransaction } = require("../../core/transaction");
const { success } = require("../result");
const { migrationData } = require("./init");

function verifyUpdatedManagedFiles(root, manifest, tools, capabilities, variables) {
  const inspection = inspectManagedFiles(root, manifest, tools, capabilities, variables);
  const incomplete = [
    ...inspection.managedOld.map((target) => ({ target, state: "managed-old" })),
    ...inspection.replaceable.map((target) => ({ target, state: "replaceable" })),
    ...inspection.missing.map((target) => ({ target, state: "missing" })),
    ...inspection.unknown.map((target) => ({ target, state: "unknown" })),
  ];
  if (incomplete.length > 0) {
    throw new WorkspaceError(
      "UPDATE_POSTCONDITION_FAILED",
      `Updated managed files failed verification: ${incomplete.map((entry) => `${entry.target} (${entry.state})`).join(", ")}`,
      { files: incomplete, remediation: "Run code-w doctor --json, review the reported files, and retry update." }
    );
  }
  return inspection;
}

function updateWorkspace(root, options = {}) {
  const manifest = loadInitManifest();
  const initialState = loadState(root);
  if (!initialState) {
    throw new WorkspaceError(
      "UPDATE_STATE_MISSING",
      "Local initialization state is missing; update can only run on an initialized workspace.",
      { file: statePath(root), remediation: "Re-run code-w init . --yes before updating this workspace." }
    );
  }
  const toolSelection = resolveWorkspaceTools({
    explicit: options.tools,
    state: initialState,
    manifestTools: manifest.tools,
  });
  const tools = toolSelection.tools;
  const migration = planWorkspaceMaintenance(root, {
    language: options.language,
    allowLegacy: true,
    defaultLanguage: false,
  });
  const language = migration.language.value;
  const config = loadConfig(root, { defaultLanguage: language });
  const nextConfig = { ...config, workspace: { ...config.workspace, language } };
  const capabilities = nextConfig.monitor.enable ? ["monitor"] : [];
  const variables = { WORKSPACE_LANGUAGE: language, WORKSPACE_USER_GUIDE: workspaceGuide(language) };
  let managedPlan;
  let obsoletePlan;
  try {
    managedPlan = planManagedFiles(root, manifest, tools, {
      force: options.force === true,
      capabilities,
      variables,
    });
    obsoletePlan = planObsoleteAssets(root, tools, { force: options.force === true });
  } catch (error) {
    if (options.language && /unknown changes/.test(error.message)) {
      throw new WorkspaceError("MANAGED_FILE_UNKNOWN", `${error.message}. No configuration or artifacts were changed.`, {
        remediation: `Review the file or re-run code-w update --language ${language} --force.`,
      });
    }
    throw error;
  }
  const transaction = createFileTransaction([
    configPath(root),
    projectConfigPath(root),
    statePath(root),
    ...managedPlan.plans.map((plan) => plan.target),
    ...obsoletePlan.map((plan) => path.join(root, plan.target)),
  ]);
  try {
    const obsoleteFiles = cleanupObsoleteAssets(root, tools, { force: options.force === true });
    options.injectFailure?.("after-obsolete-cleanup", obsoleteFiles);
    const managedFiles = installManagedFiles(root, manifest, tools, {
      force: options.force === true,
      capabilities,
      variables,
    });
    options.injectFailure?.("after-managed-install", managedFiles);
    saveConfig(root, nextConfig);
    options.injectFailure?.("after-config-save", nextConfig);
    verifyUpdatedManagedFiles(root, manifest, tools, capabilities, variables);
    const result = {
      language,
      tools: toolSelection,
      migration: migrationData(migration),
      obsoleteFiles,
      managedFiles,
      forcedUnknown: managedPlan.plans.filter((plan) => plan.reason === "unknown").map((plan) => plan.entry.target),
      diagnostics: [],
    };
    const previousTools = new Set(initialState.tools || []);
    const addedTools = tools.filter((tool) => !previousTools.has(tool));
    if (addedTools.length > 0 && nextConfig.projects.length > 0) {
      for (const inspection of inspectProjectPermissions({ root, tools: addedTools, projects: nextConfig.projects })) {
        if (inspection.missing.length === 0) continue;
        result.diagnostics.push({
          code: "WORKSPACE_PERMISSION_APPLY_REQUIRED",
          severity: "warning",
          message: `${inspection.tool} is selected but lacks authorization for ${inspection.missing.length} registered project director${inspection.missing.length === 1 ? "y" : "ies"}.`,
          tool: inspection.tool,
          directories: inspection.missing,
          file: inspection.target,
          remediation: "Review and run code-w permissions apply --yes.",
        });
      }
    }
    options.injectFailure?.("after-verify", result);
    const state = commitUpdateState(root, manifest, {
      tools,
      removeLegacyWorkspaceLanguage: true,
    });
    options.injectFailure?.("after-state-save", state);
    transaction.commit();
    return result;
  } catch (error) {
    transaction.rollback(error);
    throw error;
  }
}

function executeUpdate(invocation) {
  const result = updateWorkspace(invocation.root, invocation.options);
  const written = result.managedFiles.filter((entry) => entry.action === "write").length;
  return success("update", result, `Updated Code Workspace assets (${written} written). Tools: ${result.tools.tools.join(", ") || "none"} (${result.tools.source}).`, result.diagnostics);
}

module.exports = { executeUpdate, updateWorkspace };
