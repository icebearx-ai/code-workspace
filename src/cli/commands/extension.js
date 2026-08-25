const { loadState } = require("../../core/config");
const { WorkspaceError } = require("../../core/errors");
const {
  applyExtensionUninstall,
  discoverExtensions,
  inspectExtensionState,
  normalizeExtensionNames,
  planExtensionUninstall,
  prepareExtensionPlans,
  runExtensionBatch,
} = require("../../core/extensions");
const { loadInitManifest } = require("../../core/init");
const { acquireInitLock } = require("../../core/init-lock");
const { resolveWorkspaceTools } = require("../../core/tools");
const { createInteractiveUi } = require("../../init/ui");
const { confirm } = require("../confirmation");
const { selectionResult, success } = require("../result");

function formatUninstallPlan(plan) {
  if (plan.action === "skip") return `Extension ${plan.id} is not installed.`;
  return [
    `Uninstall extension ${plan.id}@${plan.version}:`,
    ...plan.targets.map((target) => `  REMOVE ${target}`),
    "  REMOVE .code-workspace/ext-manifest.json entry",
  ].join("\n");
}

function formatInstallPlan(plans) {
  return [
    `Install ${plans.length} extension${plans.length === 1 ? "" : "s"}:`,
    ...plans.flatMap((plan) => [
      `  ${plan.id}@${plan.version} (manifest ${plan.manifestSha256})`,
      ...(plan.capabilities.networkHosts || []).map((host) => `    NETWORK https://${host}`),
      ...plan.artifacts.map((artifact) => `    WRITE ${artifact.target} (${artifact.kind})`),
    ]),
  ].join("\n");
}

async function collectExtensionInstallSelection(catalog, state, options = {}) {
  const ui = options.ui || await createInteractiveUi({
    ...options,
    cancelCode: "EXTENSION_INSTALL_CANCELLED",
    cancelMessage: "Extension installation cancelled. No changes were made.",
  });
  const installed = new Set(Object.entries(state.extensions || {}).filter(([, value]) => value.installed).map(([id]) => id));
  const choices = catalog.map((entry) => ({
    value: entry.id,
    label: `${entry.id} · ${entry.name} · ${entry.latestCompatible ? `latest compatible: ${entry.latestCompatible.version}` : "no compatible version"}${installed.has(entry.id) ? " · installed" : ""}`,
    ...(entry.latestCompatible ? {} : { disabled: true }),
  }));
  ui.intro("Code Workspace extensions");
  if (choices.length === 0) {
    ui.close("No built-in extensions are available.");
    return [];
  }
  const selected = await ui.multiselect("Extensions (select any)", choices, []);
  ui.close(selected.length > 0 ? "Extension selection ready." : "No extensions selected.");
  return normalizeExtensionNames(selected);
}

function installResultEntry(entry) {
  const failed = entry.status === "failed";
  return {
    name: entry.id,
    ok: !failed,
    action: entry.status === "skipped" ? "skip" : "install",
    status: entry.status,
    version: entry.version,
    ...(entry.reason ? { reason: entry.reason } : {}),
    ...(entry.artifacts ? { artifacts: entry.artifacts } : {}),
    ...(entry.code ? { code: entry.code } : {}),
    ...(entry.message ? { message: entry.message } : {}),
    ...(entry.statePersisted !== undefined ? { statePersisted: entry.statePersisted } : {}),
  };
}

function installResultText(results) {
  const lines = results.map((entry) => entry.status === "installed"
    ? `Installed ${entry.id}@${entry.version}.`
    : entry.status === "skipped"
      ? `Skipped ${entry.id}@${entry.version}: already current.`
      : `Failed ${entry.id}${entry.version ? `@${entry.version}` : ""}: ${entry.message}`);
  const installed = results.filter((entry) => entry.status === "installed").length;
  const skipped = results.filter((entry) => entry.status === "skipped").length;
  const failed = results.filter((entry) => entry.status === "failed").length;
  lines.push(`Extensions: ${installed} installed, ${skipped} skipped, ${failed} failed.`);
  return lines.join("\n");
}

async function executeExtensionInstall(invocation) {
  const command = "extension.install";
  const dependencies = invocation.dependencies || {};
  const interactive = dependencies.interactive ?? (!invocation.options.json && invocation.options.yes !== true && process.stdin.isTTY && process.stdout.isTTY);
  let requested = invocation.args.length > 0 ? normalizeExtensionNames(invocation.args) : null;
  if (requested === null && !interactive) {
    throw new WorkspaceError("EXTENSION_SELECTION_REQUIRED", "Extension installation requires one or more extension names outside interactive mode.", {
      remediation: "Pass one or more names, for example: code-w extension install openspec-workspace --yes",
    });
  }

  const catalogResult = discoverExtensions({ tolerant: true, ...(dependencies.extensionsRoot ? { extensionsRoot: dependencies.extensionsRoot } : {}) });
  const stateInspection = inspectExtensionState(invocation.root);
  if (requested === null) {
    try {
      requested = await (dependencies.collectExtensionInstallSelection || collectExtensionInstallSelection)(catalogResult.catalog, stateInspection.state, dependencies);
    } catch (error) {
      if (error.code === "EXTENSION_INSTALL_CANCELLED") {
        return success(command, { action: "cancel", scope: "selection", requested: [], results: [], summary: { total: 0, succeeded: 0, skipped: 0, failed: 0 } }, "Extension installation cancelled. No changes were made.");
      }
      throw error;
    }
  }
  if (requested.length === 0) {
    return success(command, { action: "skip", scope: "selection", requested: [], results: [], summary: { total: 0, succeeded: 0, skipped: 0, failed: 0 } }, "No extensions selected. No changes were made.");
  }

  const tools = resolveWorkspaceTools({ state: loadState(invocation.root), manifestTools: loadInitManifest().tools }).tools;
  const preparation = prepareExtensionPlans(catalogResult, requested, {
    tools,
    state: stateInspection.state,
    stateError: stateInspection.error,
  });
  if (preparation.plans.length > 0) {
    const planText = formatInstallPlan(preparation.plans);
    if (!(await (dependencies.confirm || confirm)(`${planText}\nContinue?`, invocation.options))) {
      throw new WorkspaceError("CLI_CANCELLED", "Extension installation cancelled.");
    }
  }
  const workspace = invocation.config.workspace;
  const batch = runExtensionBatch(invocation.root, preparation.plans, (extension) => ({
    schemaVersion: 1,
    extension: { id: extension.id, version: extension.version },
    workspace: { name: workspace.name, uuid: workspace.uuid, language: workspace.language },
    tools,
  }), { requested, preFailures: preparation.failures });
  const failedIds = new Set(batch.results.filter((entry) => entry.status === "failed").map((entry) => entry.id));
  const diagnostics = [
    ...preparation.diagnostics.filter((entry) => !entry.extension || !failedIds.has(entry.extension)),
    ...batch.results.filter((entry) => entry.status === "failed").map((entry) => ({
      code: entry.code || "EXTENSION_INSTALL_FAILED",
      severity: "error",
      message: entry.message || `Extension ${entry.id} failed to install.`,
      extension: entry.id,
      version: entry.version,
    })),
    ...batch.results.flatMap((entry) => (entry.warnings || []).map((warning) => ({
      code: warning.code,
      severity: "warning",
      message: warning.message,
      extension: entry.id,
      version: entry.version,
    }))),
  ];
  return selectionResult(command, requested, batch.results.map(installResultEntry), {
    diagnostics,
    text: installResultText(batch.results),
  });
}

async function executeExtensionUninstall(invocation) {
  const command = "extension.uninstall";
  const plan = planExtensionUninstall(invocation.root, invocation.args[0]);
  const planText = formatUninstallPlan(plan);
  if (plan.action === "remove" && !(await confirm(`${planText}\nContinue?`, invocation.options))) {
    throw new WorkspaceError("CLI_CANCELLED", "Extension uninstall cancelled.");
  }
  const result = applyExtensionUninstall(plan, invocation.dependencies);
  const text = result.status === "skipped" ? planText : `${planText}\nExtension uninstalled and verified.`;
  return success(command, { ...result, targets: plan.targets }, text);
}

async function executeExtension(invocation) {
  const command = invocation.definition.path.join(".");
  const releaseLock = await (invocation.dependencies?.acquireInitLock || acquireInitLock)(invocation.root);
  try {
    if (command === "extension.install") return await executeExtensionInstall(invocation);
    if (command === "extension.uninstall") return await executeExtensionUninstall(invocation);
    throw new WorkspaceError("CLI_HANDLER_MISSING", `Unsupported extension action: ${command}`);
  } finally {
    await releaseLock();
  }
}

module.exports = {
  collectExtensionInstallSelection,
  executeExtension,
  executeExtensionInstall,
  executeExtensionUninstall,
  formatInstallPlan,
  formatUninstallPlan,
};
