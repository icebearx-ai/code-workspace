const path = require("node:path");

const { loadState } = require("../../core/config");
const { WorkspaceError } = require("../../core/errors");
const { acquireInitLock } = require("../../core/init-lock");
const {
  discoverSystemExtensions,
  emptyExtensionState,
  inspectExtensionState,
  parseExtensionSelection,
  prepareExtensionPlans,
  runExtensionBatch,
} = require("../../core/extensions");
const { compareVersions, loadInitManifest, minimumFromRange, runCommand } = require("../../core/init");
const { defaultExtensionStoreRoot } = require("../../core/extension-store");
const { initializeWorkspace } = require("../../core/initializer");
const { resolveWorkspaceTools } = require("../../core/tools");
const { collectInitPlan } = require("../../init/wizard");
const { success } = require("../result");

function migrationData(plan) {
  if (!plan) return null;
  return {
    fromVersion: plan.schema.fromVersion,
    toVersion: plan.schema.toVersion,
    changed: plan.changed,
    steps: plan.steps,
    schemaSteps: plan.schema.steps,
    language: plan.language,
    writeTargets: plan.writeTargets,
  };
}

async function executeInit(invocation) {
  const root = path.resolve(invocation.args[0] || ".");
  const releaseInitLock = await acquireInitLock(root);
  try {
    return await executeInitUnlocked(invocation, root);
  } finally {
    await releaseInitLock();
  }
}

async function executeInitUnlocked(invocation, root) {
  const { options } = invocation;
  if (options.json && options.yes !== true) {
    throw new WorkspaceError("CLI_CONFIRMATION_REQUIRED", "Workspace initialization requires explicit confirmation in JSON mode.", {
      remediation: "Re-run with --yes.",
    });
  }
  const run = options.json
    ? (command, commandArgs, runOptions = {}) => runCommand(command, commandArgs, { ...runOptions, capture: true })
    : runCommand;
  const manifest = loadInitManifest();
  const minimumNode = minimumFromRange(manifest.requirements.node);
  if (compareVersions(process.versions.node, minimumNode) < 0) {
    throw new WorkspaceError("NODE_VERSION_UNSUPPORTED", `Node ${minimumNode} or newer is required; found ${process.versions.node}`, {
      actual: process.versions.node,
      required: minimumNode,
    });
  }
  const existingState = loadState(root);
  const explicitExtensions = parseExtensionSelection(options.extensions);
  const resolvedTools = resolveWorkspaceTools({
    explicit: options.tools,
    state: existingState,
    manifestTools: manifest.tools,
  });
  const interactive = !options.json && !options.yes && process.stdin.isTTY && process.stdout.isTTY;
  const inspectExtensions = true;
  const extensionStateInspection = inspectExtensions ? inspectExtensionState(root) : { state: emptyExtensionState(), error: null };
  const extensionState = extensionStateInspection.state;
  // Ordinary extensions are resolved from Nexus/Store by the registry picker.
  // This phase deliberately removes the package-local ordinary catalog from init;
  // only the system catalog remains here until the shared picker is wired in.
  const defaultExtensions = [];
  const extensionCatalogResult = { catalog: [], invalid: [] };
  const systemCatalogResult = inspectExtensions ? discoverSystemExtensions({ tolerant: true }) : { catalog: [], invalid: [] };
  const combinedCatalogResult = {
    catalog: [...extensionCatalogResult.catalog, ...systemCatalogResult.catalog],
    invalid: [...extensionCatalogResult.invalid, ...systemCatalogResult.invalid],
  };
  const duplicateIds = new Set();
  for (const entry of combinedCatalogResult.catalog) {
    if (duplicateIds.has(entry.id)) throw new WorkspaceError("EXTENSION_ID_CONFLICT", `Extension id is declared by both ordinary and system repositories: ${entry.id}`, { extension: entry.id });
    duplicateIds.add(entry.id);
  }
  const extensionCatalog = extensionStateInspection.error && interactive ? [] : extensionCatalogResult.catalog;
  if (interactive && explicitExtensions !== null) {
    prepareExtensionPlans(combinedCatalogResult, explicitExtensions, { tools: resolvedTools.tools, state: extensionState, stateError: extensionStateInspection.error });
  }
  const interactiveExplicitExtensions = explicitExtensions === null
    ? undefined
    : explicitExtensions.filter((id) => extensionCatalog.some((entry) => entry.id === id && entry.latestSupported));
  let plan = null;
  if (interactive) {
    try {
      plan = await collectInitPlan(root, manifest, {
        run,
        tools: options.tools !== undefined ? resolvedTools.tools : undefined,
        initialTools: resolvedTools.tools,
        workspaceName: options["workspace-name"],
        language: options.language,
        extensionCatalog,
        extensionState,
        extensions: interactiveExplicitExtensions,
        initialExtensions: explicitExtensions === null ? undefined : interactiveExplicitExtensions,
      });
    } catch (error) {
      if (error.code === "INIT_CANCELLED") {
        return success("init", { action: "cancel" }, "Initialization cancelled. No changes were made.");
      }
      throw error;
    }
  }
  const tools = plan?.tools || resolvedTools.tools;
  const ordinaryRequestedExtensions = explicitExtensions !== null
    ? explicitExtensions
    : plan ? plan.extensions.map((entry) => entry.id) : defaultExtensions;
  const systemRequestedExtensions = systemCatalogResult.catalog.filter((entry) => entry.latestSupported).map((entry) => entry.id);
  const requestedExtensions = [...new Set([...ordinaryRequestedExtensions, ...systemRequestedExtensions])];
  const extensionPreparation = prepareExtensionPlans(combinedCatalogResult, requestedExtensions, { tools, state: extensionState, stateError: extensionStateInspection.error });
  const extensionPlans = extensionPreparation.plans;
  const toolSelection = { tools, source: plan ? (options.tools !== undefined ? "cli" : "interactive") : resolvedTools.source };
  const result = await initializeWorkspace(root, {
    run,
    tools,
    force: options.force === true,
    yes: plan ? true : options.yes === true,
    workspaceName: plan?.workspace.name || options["workspace-name"],
    workspaceUuid: plan?.workspace.uuid,
    language: plan?.language || options.language,
    interactive: false,
    initPlan: plan,
    onStage: null,
  });
  const extensionResult = runExtensionBatch(root, extensionPlans, (extension) => ({
    schemaVersion: 1,
    extensionSpecVersion: extension.extensionSpecVersion,
    extension: { id: extension.id, version: extension.version },
    workspace: {
      name: result.workspaceConfig.workspace.name,
      uuid: result.workspaceConfig.workspace.uuid,
      language: result.language,
    },
    tools,
  }), {
    requested: requestedExtensions,
    preFailures: extensionPreparation.failures,
    useExtensionStore: true,
    extensionStoreRoot: options.extensionStoreRoot || defaultExtensionStoreRoot(),
  });
  const extensionDiagnostics = [
    ...extensionPreparation.diagnostics,
    ...extensionResult.results
    .filter((entry) => entry.status === "failed")
    .map((entry) => ({
      code: "EXTENSION_INIT_FAILED",
      severity: "warning",
      message: `Extension ${entry.id}@${entry.version} failed: ${entry.message}`,
      extension: entry.id,
      version: entry.version,
      causeCode: entry.code,
    })),
  ];
  for (const entry of extensionResult.results) {
    for (const warning of entry.warnings || []) {
      extensionDiagnostics.push({
        code: warning.code,
        severity: "warning",
        message: warning.message,
        extension: entry.id,
        version: entry.version,
      });
    }
  }
  const data = {
    root: result.root,
    releaseVersion: result.manifest.releaseVersion,
    nodeVersion: result.nodeVersion,
    dependencies: result.dependencies,
    obsoleteFiles: result.obsoleteFiles,
    managedFiles: result.managedFiles,
    localConfig: result.localConfig,
    workspace: result.workspaceConfig.workspace,
    language: result.language,
    tools: toolSelection,
    migration: migrationData(result.migration),
    permissions: result.permissions,
    verification: result.verification,
    plan: result.initPlan,
    stages: result.stages.map((stage) => stage.name),
    extensions: extensionResult,
  };
  const lines = [
    "Code Workspace is ready.",
    `Workspace: ${result.workspaceConfig.workspace.name} (${result.workspaceConfig.workspace.uuid})`,
    `Language: ${result.language}`,
    `Tools: ${tools.length ? tools.join(", ") : "none"} (${toolSelection.source})`,
    `Extensions: ${extensionResult.summary.installed} installed, ${extensionResult.summary.skipped} skipped, ${extensionResult.summary.failed} failed`,
  ];
  if (result.localConfig.action === "write" || result.permissions.action === "skip") {
    lines.push(tools.length > 0
      ? "Add local projects with the `codew-add-projects` skill."
      : "Add local projects with `code-workspace project inspect`, then register a complete project record.");
  }
  return success("init", data, lines.join("\n"), extensionDiagnostics);
}

module.exports = { executeInit, migrationData };
