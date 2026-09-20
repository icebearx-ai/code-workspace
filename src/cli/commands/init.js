const path = require("node:path");

const { loadState, resolveWorkspaceDev } = require("../../core/config");
const { WorkspaceError } = require("../../core/errors");
const { acquireInitLock } = require("../../core/init-lock");
const {
  applyExtensionUninstall,
  discoverSystemExtensions,
  emptyExtensionState,
  inspectExtensionState,
  parseExtensionSelection,
  planExtensionUninstall,
  prepareExtensionPlans,
  runExtensionBatch,
} = require("../../core/extensions");
const { prepareRegistryExtensionPlans } = require("../../core/extension-registry-lifecycle");
const { DEFAULT_NEXUS_REGISTRY } = require("../../core/nexus-extension-provider");
const { compareVersions, loadInitManifest, minimumFromRange, runCommand } = require("../../core/init");
const { defaultExtensionStoreRoot } = require("../../core/extension-store");
const { initializeWorkspace } = require("../../core/initializer");
const { resolveWorkspaceTools } = require("../../core/tools");
const { collectInitPlan } = require("../../init/wizard");
const { createRegistryExtensionPicker, mapPickerPage } = require("../../init/registry-picker");
const { formatExtensionChanges } = require("../../init/extension-summary");
const { success } = require("../result");

function stateWithPlans(state, plans) {
  const next = structuredClone(state || emptyExtensionState());
  for (const plan of plans || []) {
    next.extensions[plan.id] = {
      installed: {
        system: plan.system === true,
        artifacts: plan.artifacts.map((artifact) => ({
          id: artifact.id,
          kind: artifact.kind,
          ownership: artifact.ownership,
          target: artifact.target,
          ...(artifact.selector ? { selector: artifact.selector } : {}),
        })),
        hooks: plan.hooks.map((hook) => ({ ...hook })),
      },
    };
  }
  return next;
}

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

function parseDevOption(value) {
  if (value === undefined) return undefined;
  if (value === "true") return true;
  if (value === "false") return false;
  throw new WorkspaceError("CLI_INVALID_OPTION_VALUE", "--dev requires true or false", {
    option: "dev",
    value,
    allowed: ["true", "false"],
  });
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
  const requestedDev = parseDevOption(options.dev);
  const dev = resolveWorkspaceDev(root, requestedDev);
  const dependencies = invocation.dependencies && Object.prototype.hasOwnProperty.call(invocation.dependencies, "defaultRegistryUrl")
    ? invocation.dependencies
    : { ...(invocation.dependencies || {}), defaultRegistryUrl: DEFAULT_NEXUS_REGISTRY };
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
  const interactive = dependencies.interactive ?? (!options.json && !options.yes && process.stdin.isTTY && process.stdout.isTTY);
  const inspectExtensions = true;
  const extensionStateInspection = inspectExtensions ? inspectExtensionState(root) : { state: emptyExtensionState(), error: null };
  const extensionState = extensionStateInspection.state;
  const systemCatalogResult = inspectExtensions ? discoverSystemExtensions({ tolerant: true }) : { catalog: [], invalid: [] };
  const systemExtensionIds = systemCatalogResult.catalog.filter((entry) => entry.latestSupported).map((entry) => entry.id);
  const systemRequestedExtensions = dev ? systemExtensionIds : [];
  const systemRemovalPlans = dev || extensionStateInspection.error
    ? []
    : Object.entries(extensionState.extensions)
      .filter(([id, entry]) => entry.installed?.system === true || systemExtensionIds.includes(id))
      .map(([id]) => planExtensionUninstall(root, id, { systemManaged: true }));
  let systemPreparation = { plans: [], failures: [], diagnostics: [] };
  let planningState = extensionState;
  const prepareSystemForTools = (tools) => {
    systemPreparation = prepareExtensionPlans(systemCatalogResult, systemRequestedExtensions, {
      tools,
      state: extensionState,
      stateError: extensionStateInspection.error,
    });
    planningState = stateWithPlans(extensionState, systemPreparation.plans);
    return systemPreparation.plans;
  };
  if (!interactive) prepareSystemForTools(resolvedTools.tools);
  let interactiveOrdinaryPreparation = { plans: [], failures: [], diagnostics: [] };
  const prepareOrdinaryExtensions = async (selected, selectedTools) => {
    const installSelections = selected.filter((entry) => entry.action !== "uninstall" && entry.action !== "keep");
    const uninstallSelections = selected.filter((entry) => entry.action === "uninstall");
    const uninstallPlans = uninstallSelections.map((entry) => planExtensionUninstall(root, entry.id));
    const installState = structuredClone(planningState);
    for (const entry of uninstallSelections) delete installState.extensions[entry.id];
    interactiveOrdinaryPreparation = await prepareRegistryExtensionPlans({
      ...dependencies,
      requested: installSelections.map((entry) => entry.id),
      tools: selectedTools || resolvedTools.tools,
      state: installState,
      stateError: extensionStateInspection.error,
      extensionsRoot: dependencies.extensionsRoot,
      extensionStoreRoot: options.extensionStoreRoot || dependencies.extensionStoreRoot || defaultExtensionStoreRoot(),
      provider: dependencies.nexusProvider,
    });
    interactiveOrdinaryPreparation.plans = interactiveOrdinaryPreparation.plans.map((plan) => ({
      ...plan,
      action: selected.find((entry) => entry.id === plan.id)?.action || "install",
    }));
    interactiveOrdinaryPreparation.uninstallPlans = uninstallPlans;
    return interactiveOrdinaryPreparation;
  };
  let plan = null;
  if (interactive) {
    try {
      plan = await collectInitPlan(root, manifest, {
        run,
        tools: options.tools !== undefined ? resolvedTools.tools : undefined,
        initialTools: resolvedTools.tools,
        workspaceName: options["workspace-name"],
        language: options.language,
        extensionState,
        extensions: explicitExtensions === null ? undefined : explicitExtensions,
        initialExtensions: explicitExtensions === null ? undefined : explicitExtensions,
        prepareSystemExtensions: prepareSystemForTools,
        prepareExtensions: prepareOrdinaryExtensions,
        extensionPicker: createRegistryExtensionPicker({ dependencies, state: extensionState, systemIds: new Set(systemExtensionIds) }),
        formatExtensionChanges,
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
    : plan ? plan.extensions.filter((entry) => entry.system !== true).map((entry) => entry.id) : [];
  const ordinaryRemovalPlans = plan?.extensionRemovals || [];
  const requestedExtensions = [...new Set([
    ...ordinaryRequestedExtensions,
    ...ordinaryRemovalPlans.map((entry) => typeof entry === "string" ? entry : entry.id),
    ...systemRequestedExtensions,
  ])];
  const extensionPreparation = { plans: [], failures: [], diagnostics: [] };
  if (interactive) {
    extensionPreparation.plans = [...systemPreparation.plans, ...interactiveOrdinaryPreparation.plans];
    extensionPreparation.failures = [...systemPreparation.failures, ...interactiveOrdinaryPreparation.failures];
    extensionPreparation.diagnostics = [...systemPreparation.diagnostics, ...interactiveOrdinaryPreparation.diagnostics];
  }
  if (!interactive && explicitExtensions !== null && explicitExtensions.length > 0) {
    const ordinary = await prepareRegistryExtensionPlans({
      ...dependencies,
      requested: explicitExtensions,
      tools,
      state: planningState,
      stateError: extensionStateInspection.error,
      extensionsRoot: dependencies.extensionsRoot,
      extensionStoreRoot: options.extensionStoreRoot || dependencies.extensionStoreRoot || defaultExtensionStoreRoot(),
      provider: dependencies.nexusProvider,
    });
    extensionPreparation.plans = [...systemPreparation.plans, ...ordinary.plans];
    extensionPreparation.failures = [...systemPreparation.failures, ...ordinary.failures];
    extensionPreparation.diagnostics = [...systemPreparation.diagnostics, ...ordinary.diagnostics];
  } else if (!interactive) {
    extensionPreparation.plans = systemPreparation.plans;
    extensionPreparation.failures = systemPreparation.failures;
    extensionPreparation.diagnostics = systemPreparation.diagnostics;
  }
  const extensionPlans = extensionPreparation.plans;
  const toolSelection = { tools, source: plan ? (options.tools !== undefined ? "cli" : "interactive") : resolvedTools.source };
  const result = await initializeWorkspace(root, {
    run,
    tools,
    dev,
    force: options.force === true,
    yes: plan ? true : options.yes === true,
    workspaceName: plan?.workspace.name || options["workspace-name"],
    workspaceUuid: plan?.workspace.uuid,
    language: plan?.language || options.language,
    interactive: false,
    initPlan: plan,
    onStage: null,
  });
  const systemRemovalResults = [];
  const systemRemovalDiagnostics = [];
  for (const removalPlan of systemRemovalPlans) {
    try {
      systemRemovalResults.push(applyExtensionUninstall(removalPlan, {
        systemManaged: true,
        extensionStoreRoot: options.extensionStoreRoot || dependencies.extensionStoreRoot || defaultExtensionStoreRoot(),
      }));
    } catch (error) {
      systemRemovalResults.push({
        id: removalPlan.id,
        version: removalPlan.version,
        status: "failed",
        code: error.code || "SYSTEM_EXTENSION_DISABLE_FAILED",
        message: error.message,
      });
      systemRemovalDiagnostics.push({
        code: "SYSTEM_EXTENSION_DISABLE_FAILED",
        severity: "warning",
        message: `System extension ${removalPlan.id} could not be disabled: ${error.message}`,
        extension: removalPlan.id,
        causeCode: error.code || null,
      });
    }
  }
  const ordinaryRemovalResults = [];
  const ordinaryRemovalDiagnostics = [];
  for (const removalPlan of ordinaryRemovalPlans) {
    const planToApply = typeof removalPlan === "string" ? planExtensionUninstall(root, removalPlan) : removalPlan;
    try {
      const removal = applyExtensionUninstall(planToApply, {
        extensionStoreRoot: options.extensionStoreRoot || dependencies.extensionStoreRoot || defaultExtensionStoreRoot(),
      });
      ordinaryRemovalResults.push({ ...removal, action: removal.status === "skipped" ? "skip" : "uninstall" });
    } catch (error) {
      ordinaryRemovalResults.push({ id: planToApply.id, version: planToApply.version || null, status: "failed", action: "uninstall", code: error.code || "EXTENSION_UNINSTALL_FAILED", message: error.message });
      ordinaryRemovalDiagnostics.push({ code: error.code || "EXTENSION_UNINSTALL_FAILED", severity: "warning", message: `Extension ${planToApply.id} failed to uninstall: ${error.message}`, extension: planToApply.id });
    }
  }
  const extensionBatch = runExtensionBatch(root, extensionPlans, (extension) => ({
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
    requested: [...new Set([...ordinaryRequestedExtensions, ...systemRequestedExtensions])],
    preFailures: extensionPreparation.failures,
    useExtensionStore: true,
    extensionStoreRoot: options.extensionStoreRoot || defaultExtensionStoreRoot(),
  });
  const extensionResultEntries = [...ordinaryRemovalResults, ...extensionBatch.results];
  const extensionResult = {
    requested: requestedExtensions,
    results: extensionResultEntries,
    summary: {
      installed: extensionResultEntries.filter((entry) => entry.status === "installed").length,
      uninstalled: extensionResultEntries.filter((entry) => entry.status === "uninstalled").length,
      skipped: extensionResultEntries.filter((entry) => entry.status === "skipped").length,
      failed: extensionResultEntries.filter((entry) => entry.status === "failed").length,
    },
  };
  const extensionDiagnostics = [
    ...(dev === false && extensionStateInspection.error ? [{
      code: "SYSTEM_EXTENSION_DISABLE_SKIPPED",
      severity: "warning",
      message: `System extension cleanup was skipped because extension state could not be read: ${extensionStateInspection.error.message}`,
      causeCode: extensionStateInspection.error.code || null,
    }] : []),
    ...systemRemovalDiagnostics,
    ...ordinaryRemovalDiagnostics,
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
    dev: result.workspaceConfig.workspace.dev,
    language: result.language,
    tools: toolSelection,
    migration: migrationData(result.migration),
    permissions: result.permissions,
    verification: result.verification,
    plan: result.initPlan,
    stages: result.stages.map((stage) => stage.name),
    systemExtensions: {
      enabled: dev,
      results: systemRemovalResults,
    },
    extensions: extensionResult,
  };
  const lines = [
    "Code Workspace is ready.",
    `Workspace: ${result.workspaceConfig.workspace.name} (${result.workspaceConfig.workspace.uuid})`,
    `Language: ${result.language}`,
    `Tools: ${tools.length ? tools.join(", ") : "none"} (${toolSelection.source})`,
    `Extensions: ${extensionResult.summary.installed} installed, ${extensionResult.summary.uninstalled || 0} uninstalled, ${extensionResult.summary.skipped} skipped, ${extensionResult.summary.failed} failed`,
  ];
  if (result.workspaceConfig.workspace.dev !== false && (result.localConfig.action === "write" || result.permissions.action === "skip")) {
    lines.push(tools.length > 0
      ? "Add local projects with the `codew-add-projects` skill."
      : "Add local projects with `code-workspace project inspect`, then register a complete project record.");
  }
  return success("init", data, lines.join("\n"), extensionDiagnostics);
}

module.exports = { createRegistryExtensionPicker, executeInit, mapPickerPage, migrationData, parseDevOption, stateWithPlans };
