const path = require("node:path");

const { cleanupObsoleteAssets, ensureWorkspaceSchemaSelection, planObsoleteAssets } = require("../../core/assets");
const {
  configPath,
  loadConfig,
  loadState,
  saveConfig,
  statePath,
} = require("../../core/config");
const { WorkspaceError } = require("../../core/errors");
const { commitUpdateState, detectOpenSpec, loadInitManifest, prepareOpenSpec } = require("../../core/init");
const { workspaceGuide } = require("../../core/language");
const { inspectManagedFiles, installManagedFiles, planManagedFiles } = require("../../core/managed-files");
const { planWorkspaceMaintenance } = require("../../core/migration");
const { resolveWorkspaceTools } = require("../../core/tools");
const { createFileTransaction } = require("../../core/transaction");
const { success } = require("../result");
const { migrationData } = require("./init");

function verifyUpdateOpenSpec(root, manifest, state, options = {}) {
  const expectedVersion = state.resources?.openspec?.version || null;
  const detected = detectOpenSpec(manifest.resources.openspec, { root, run: options.run });
  const activeVersion = detected.commandVersion;
  const compatible = Boolean(
    detected.globalVersion &&
    activeVersion &&
    detected.globalVersion === activeVersion &&
    manifest.resources.openspec.supportedVersions.includes(activeVersion) &&
    expectedVersion === activeVersion
  );
  if (!compatible) {
    throw new WorkspaceError(
      "UPDATE_OPENSPEC_REINITIALIZATION_REQUIRED",
      "The active OpenSpec installation does not match this initialized workspace; update does not install or switch OpenSpec.",
      {
        expectedVersion,
        detected,
        supportedVersions: manifest.resources.openspec.supportedVersions,
        remediation: `Re-run openspec-w init . --openspec-version ${manifest.resources.openspec.selectedVersion} --yes.`,
      }
    );
  }
  return detected;
}

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
      { files: incomplete, remediation: "Run openspec-w doctor --json, review the reported files, and retry update." }
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
      { file: statePath(root), remediation: "Re-run openspec-w init . --yes before updating this workspace." }
    );
  }
  verifyUpdateOpenSpec(root, manifest, initialState, options);
  const toolSelection = resolveWorkspaceTools({
    explicit: options.tools,
    state: initialState,
    manifestTools: manifest.resources.openspec.tools,
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
        remediation: `Review the file or re-run openspec-w update --language ${language} --force.`,
      });
    }
    throw error;
  }
  const transaction = createFileTransaction([
    configPath(root),
    statePath(root),
    ...managedPlan.plans.map((plan) => plan.target),
    ...obsoletePlan.map((plan) => path.join(root, plan.target)),
  ]);
  try {
    const preparation = prepareOpenSpec(root, manifest.resources.openspec, tools, { run: options.run });
    if (preparation.action === "init") {
      transaction.recordExternalEffect({
        kind: "upstream-command-output",
        command: "openspec init",
        targets: preparation.missing.map((file) => path.relative(root, file)),
        verified: preparation.verified === true,
      });
    }
    options.injectFailure?.("after-preparation", preparation);
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
    const schema = ensureWorkspaceSchemaSelection(root);
    options.injectFailure?.("after-schema-verify", schema);
    verifyUpdatedManagedFiles(root, manifest, tools, capabilities, variables);
    const result = {
      language,
      tools: toolSelection,
      migration: migrationData(migration),
      preparation,
      obsoleteFiles,
      managedFiles,
      forcedUnknown: managedPlan.plans.filter((plan) => plan.reason === "unknown").map((plan) => plan.entry.target),
      schema,
    };
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
  return success("update", result, `Updated OpenSpec Workspace assets (${written} written). Tools: ${result.tools.tools.join(", ") || "none"} (${result.tools.source}).`);
}

module.exports = { executeUpdate, updateWorkspace };
