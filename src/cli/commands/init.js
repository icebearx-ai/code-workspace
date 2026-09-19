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
const { prepareRegistryExtensionPlans } = require("../../core/extension-registry-lifecycle");
const { compareVersions, loadInitManifest, minimumFromRange, runCommand } = require("../../core/init");
const { defaultExtensionStoreRoot } = require("../../core/extension-store");
const { initializeWorkspace } = require("../../core/initializer");
const { resolveWorkspaceTools } = require("../../core/tools");
const { collectInitPlan } = require("../../init/wizard");
const { createRegistryExtensionPicker, mapPickerPage } = require("../../init/registry-picker");
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
  const dependencies = invocation.dependencies || {};
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
  const systemRequestedExtensions = systemCatalogResult.catalog.filter((entry) => entry.latestSupported).map((entry) => entry.id);
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
    interactiveOrdinaryPreparation = await prepareRegistryExtensionPlans({
      ...dependencies,
      requested: selected.map((entry) => entry.id),
      tools: selectedTools || resolvedTools.tools,
      state: planningState,
      stateError: extensionStateInspection.error,
      extensionsRoot: dependencies.extensionsRoot,
      extensionStoreRoot: options.extensionStoreRoot || dependencies.extensionStoreRoot || defaultExtensionStoreRoot(),
      provider: dependencies.nexusProvider,
    });
    return interactiveOrdinaryPreparation.plans;
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
        extensionPicker: createRegistryExtensionPicker({ dependencies, state: extensionState, systemIds: new Set(systemRequestedExtensions) }),
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
  const requestedExtensions = [...new Set([...ordinaryRequestedExtensions, ...systemRequestedExtensions])];
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

module.exports = { createRegistryExtensionPicker, executeInit, mapPickerPage, migrationData, stateWithPlans };
