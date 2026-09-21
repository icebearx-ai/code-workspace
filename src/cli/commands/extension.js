const path = require("node:path");
const { LOCAL_DIRECTORY, loadState } = require("../../core/config");
const { WorkspaceError } = require("../../core/errors");
const {
  applyExtensionUninstall,
  EXTENSION_STATE_FILE,
  discoverSystemExtensions,
  inspectExtensionState,
  normalizeExtensionNames,
  parseSemver,
  planExtensionUninstall,
  runExtensionBatch,
} = require("../../core/extensions");
const { loadInitManifest } = require("../../core/init");
const { acquireInitLock } = require("../../core/init-lock");
const { defaultExtensionStoreRoot } = require("../../core/extension-store");
const { packExtensionSourceToDirectory } = require("../../core/extension-package");
const { digestUpdate, scaffoldExtensionPackage } = require("../../core/extension-scaffold");
const { resolveExtensionSettings } = require("../../core/extension-settings");
const { DEFAULT_NEXUS_REGISTRY } = require("../../core/nexus-extension-provider");
const {
  getRegistryExtensionInfo,
  listRegistryExtensionChoices,
  prepareRegistryExtensionPlans,
  searchRegistryExtensions,
} = require("../../core/extension-registry-lifecycle");
const { resolveWorkspaceTools } = require("../../core/tools");
const { createInteractiveUi, formatExtensionChoice } = require("../../init/ui");
const { createRegistryExtensionPicker } = require("../../init/registry-picker");
const { formatExtensionChanges } = require("../../init/extension-summary");
const { confirm } = require("../confirmation");
const { selectionResult, success } = require("../result");

function registryDependencies(dependencies = {}) {
  if (Object.prototype.hasOwnProperty.call(dependencies, "defaultRegistryUrl")) return dependencies;
  return { ...dependencies, defaultRegistryUrl: DEFAULT_NEXUS_REGISTRY };
}

function formatUninstallPlan(plan) {
  if (plan.action === "skip") return `Extension ${plan.id} is not installed.`;
  return [
    `Uninstall extension ${plan.id}@${plan.version}:`,
    ...plan.targets.map((target) => `  REMOVE ${target}`),
    `  REMOVE ${LOCAL_DIRECTORY}/${EXTENSION_STATE_FILE} entry`,
  ].join("\n");
}

function formatInstallPlan(plans, options = {}) {
  return formatExtensionChanges(plans.map((plan) => ({ ...plan, source: plan.source || "local" })), [], {
    title: options.title,
    actionFor: options.actionFor,
    action: options.action,
  });
}

function formatRegistrySearchText(result) {
  if (result.items.length === 0) return "No extensions matched the query.";
  return [
    ...result.items.map((entry) => `${entry.extensionId}  ${entry.latestCandidate ? `@${entry.latestCandidate.version}` : "(no default candidate)"}  ${entry.description}`),
    result.truncated ? `Results are truncated at ${result.limit}.` : "",
  ].filter(Boolean).join("\n");
}

function formatRegistryInfoText(result) {
  const lines = [
    `${result.packageName}`,
    result.description,
    `Default candidate: ${result.defaultCandidate ? `${result.defaultCandidate.version} (Extension Spec ${result.defaultCandidate.extensionSpecVersion})` : "none"}`,
    "Versions:",
    ...result.versions.map((entry) => `  ${entry.version}  spec ${entry.extensionSpecVersion}${entry.prerelease ? "  prerelease" : ""}${entry.deprecated ? "  deprecated" : ""}${entry.metadataCompatible ? "" : "  unsupported spec"}`),
    "Compatibility shown here is metadata-only; the tarball and Extension package are verified before installation.",
  ];
  return lines.join("\n");
}

async function collectRegistryExtensionInstallSelection(choices, state, options = {}) {
  const ui = options.ui || await createInteractiveUi({
    ...options,
    cancelCode: "EXTENSION_INSTALL_CANCELLED",
    cancelMessage: "Extension installation cancelled. No changes were made.",
  });
  const installed = new Set(Object.entries(state.extensions || {}).filter(([, value]) => value.installed).map(([id]) => id));
  const selectable = choices.map((entry) => entry.available);
  const choicesForUi = choices.map((entry) => ({
    value: entry.id,
    label: formatExtensionChoice({
      ...entry,
      description: `${entry.description} · ${entry.source || "unavailable"}${entry.version ? ` · ${entry.version}` : ""}`,
    }, { includeId: true, installed: installed.has(entry.id) }),
    ...(entry.available ? {} : { disabled: true }),
  }));
  ui.intro("Code Workspace extensions");
  if (selectable.length === 0) {
    ui.close("No extensions are available.");
    return [];
  }
  const selected = await ui.multiselect("Extensions (select any)", choicesForUi, []);
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
    extensionSpecVersion: entry.extensionSpecVersion,
    ...(entry.reason ? { reason: entry.reason } : {}),
    ...(entry.artifacts ? { artifacts: entry.artifacts } : {}),
    ...(entry.hooks ? { hooks: entry.hooks } : {}),
    ...(entry.code ? { code: entry.code } : {}),
    ...(entry.message ? { message: entry.message } : {}),
    ...(entry.statePersisted !== undefined ? { statePersisted: entry.statePersisted } : {}),
  };
}

function lifecycleResultEntry(entry, action) {
  const result = installResultEntry(entry);
  return {
    ...result,
    action: entry.status === "skipped" ? "skip" : action,
    requestedVersion: entry.requestedVersion || null,
    resolvedVersion: entry.version,
    source: entry.source || null,
    offline: entry.offline === true,
  };
}

function lifecycleResultText(results, action) {
  const actionFor = typeof action === "function" ? action : () => action;
  const lines = results.map((entry) => entry.status === "installed"
    ? `${actionFor(entry) === "upgrade" || actionFor(entry) === "update" ? "Updated" : "Installed"} ${entry.name || entry.id}@${entry.version}.`
    : entry.status === "uninstalled"
      ? `Uninstalled ${entry.name || entry.id}${entry.version ? `@${entry.version}` : ""}.`
      : entry.status === "skipped"
      ? `Skipped ${entry.name || entry.id}${entry.version ? `@${entry.version}` : ""}: already current.`
      : `Failed ${entry.name || entry.id}${entry.version ? `@${entry.version}` : ""}: ${entry.message}`);
  const installed = results.filter((entry) => entry.status === "installed").length;
  const uninstalled = results.filter((entry) => entry.status === "uninstalled").length;
  const skipped = results.filter((entry) => entry.status === "skipped").length;
  const failed = results.filter((entry) => entry.status === "failed").length;
  const hasUpdate = results.some((entry) => actionFor(entry) === "upgrade" || actionFor(entry) === "update");
  lines.push(`Extensions: ${installed} ${hasUpdate ? "applied" : "installed"}, ${uninstalled} uninstalled, ${skipped} skipped, ${failed} failed.`);
  return lines.join("\n");
}

function uninstallResultEntry(entry) {
  return {
    name: entry.id,
    ok: entry.status !== "failed",
    action: entry.status === "skipped" ? "skip" : "uninstall",
    status: entry.status,
    version: entry.version || null,
    ...(entry.reason ? { reason: entry.reason } : {}),
    ...(entry.removed ? { removed: entry.removed } : {}),
    ...(entry.code ? { code: entry.code } : {}),
    ...(entry.message ? { message: entry.message } : {}),
  };
}

function sameUninstallTarget(expected, current) {
  return expected.id === current.id
    && expected.version === current.version
    && (expected.packageSha256 || null) === (current.packageSha256 || null)
    && JSON.stringify(expected.targets || []) === JSON.stringify(current.targets || []);
}

function refreshUninstallPlan(root, frozenPlan) {
  const currentPlan = planExtensionUninstall(root, frozenPlan.id);
  if (currentPlan.action !== frozenPlan.action || !sameUninstallTarget(frozenPlan, currentPlan)) {
    throw new WorkspaceError("EXTENSION_STATE_CONFLICT", `Extension ${frozenPlan.id} changed after confirmation.`, {
      extension: frozenPlan.id,
      remediation: "Re-run extension search and review the current extension selection.",
    });
  }
  return currentPlan;
}

function validateInstallOptions(invocation) {
  if (invocation.options.version) {
    if (invocation.args.length !== 1) {
      throw new WorkspaceError("EXTENSION_VERSION_SELECTION_INVALID", "--version requires exactly one extension name", {
        names: invocation.args,
        remediation: "Use extension install <name> --version <exact-semver>, or omit --version for a batch.",
      });
    }
    parseSemver(invocation.options.version);
  }
  if (invocation.options.allowDeprecated && !invocation.options.version) {
    throw new WorkspaceError("EXTENSION_VERSION_SELECTION_INVALID", "--allow-deprecated requires an exact --version", {
      remediation: "Use extension install <name> --version <exact-semver> --allow-deprecated.",
    });
  }
}

function decorateBatchResults(batch, plans, options) {
  const planById = new Map(plans.map((plan) => [plan.id, plan]));
  return batch.results.map((entry) => ({
    ...entry,
    requestedVersion: planById.get(entry.id)?.requestedVersion || null,
    source: planById.get(entry.id)?.source || null,
    offline: options.offline === true,
  }));
}

async function executeExtensionInstall(invocation) {
  const command = "extension.install";
  const dependencies = registryDependencies(invocation.dependencies || {});
  validateInstallOptions(invocation);
  const interactive = dependencies.interactive ?? (!invocation.options.json && invocation.options.yes !== true && process.stdin.isTTY && process.stdout.isTTY);
  let requested = invocation.args.length > 0 ? normalizeExtensionNames(invocation.args) : null;
  if (requested === null && !interactive) {
    throw new WorkspaceError("EXTENSION_SELECTION_REQUIRED", "Extension installation requires one or more extension names outside interactive mode.", {
      remediation: "Pass one or more extension names, for example: codew extension install <extension-name> --yes",
    });
  }

  const systemCatalogResult = discoverSystemExtensions({ tolerant: true, ...(dependencies.extensionsRoot ? { extensionsRoot: dependencies.extensionsRoot } : {}) });
  const systemIds = new Set(systemCatalogResult.catalog.map((entry) => entry.id));
  const requestedSystemId = requested?.find((id) => systemIds.has(id));
  if (requestedSystemId) {
    throw new WorkspaceError("EXTENSION_SYSTEM_MANAGED", `System extension is managed automatically by init: ${requestedSystemId}`, { extension: requestedSystemId });
  }
  const stateInspection = inspectExtensionState(invocation.root);
  if (requested === null) {
    try {
      if (dependencies.collectRegistryExtensionInstallSelection) {
        const choices = await (dependencies.listRegistryExtensionChoices || listRegistryExtensionChoices)({
          ...dependencies,
          extensionsRoot: dependencies.extensionsRoot,
          extensionStoreRoot: dependencies.extensionStoreRoot || defaultExtensionStoreRoot(),
          provider: dependencies.nexusProvider,
          offline: invocation.options.offline,
        });
        requested = await dependencies.collectRegistryExtensionInstallSelection(choices, stateInspection.state, dependencies);
      } else {
        const choices = await listRegistryExtensionChoices({
          ...dependencies,
          extensionsRoot: dependencies.extensionsRoot,
          extensionStoreRoot: dependencies.extensionStoreRoot || defaultExtensionStoreRoot(),
          provider: dependencies.nexusProvider,
          offline: invocation.options.offline,
        });
        requested = await collectRegistryExtensionInstallSelection(choices, stateInspection.state, dependencies);
      }
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
  const preparation = await prepareRegistryExtensionPlans({
    ...dependencies,
    requested,
    tools,
    state: stateInspection.state,
    stateError: stateInspection.error,
    extensionsRoot: dependencies.extensionsRoot,
    extensionStoreRoot: dependencies.extensionStoreRoot || defaultExtensionStoreRoot(),
    provider: dependencies.nexusProvider,
    version: invocation.options.version,
    allowDeprecated: invocation.options.allowDeprecated,
    offline: invocation.options.offline,
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
    extensionSpecVersion: extension.extensionSpecVersion,
    extension: { id: extension.id, version: extension.version },
    workspace: { name: workspace.name, uuid: workspace.uuid, language: workspace.language },
    tools,
  }), {
    requested,
    preFailures: preparation.failures,
    useExtensionStore: true,
    extensionStoreRoot: dependencies.extensionStoreRoot || defaultExtensionStoreRoot(),
  });
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
  const results = decorateBatchResults(batch, preparation.plans, invocation.options);
  return selectionResult(command, requested, results.map((entry) => lifecycleResultEntry(entry, "install")), {
    diagnostics,
    text: lifecycleResultText(results, "install"),
  });
}

async function executeExtensionSearch(invocation) {
  const dependencies = registryDependencies(invocation.dependencies || {});
  const interactive = dependencies.interactive ?? (!invocation.options.json && invocation.options.yes !== true && process.stdin.isTTY && process.stdout.isTTY);
  if (!interactive) {
    const result = await searchRegistryExtensions({
      query: invocation.args[0] || "",
      ...dependencies,
    });
    return success("extension.search", result, formatRegistrySearchText(result), result.diagnostics || []);
  }

  const workspace = invocation.config?.workspace;
  if (!workspace) {
    throw new WorkspaceError("WORKSPACE_CONFIG_REQUIRED", "Interactive extension search requires an initialized Workspace.", {
      remediation: "Run `codew init <path>` first, or use `codew extension search <query> --json` for read-only Registry results.",
    });
  }
  const stateInspection = inspectExtensionState(invocation.root);
  const systemIds = new Set(discoverSystemExtensions({
    tolerant: true,
    ...(dependencies.extensionsRoot ? { extensionsRoot: dependencies.extensionsRoot } : {}),
  }).catalog.map((entry) => entry.id));
  const ui = dependencies.ui || await createInteractiveUi({
    ...dependencies,
    cancelCode: "EXTENSION_SEARCH_CANCELLED",
    cancelMessage: "Extension search cancelled. No changes were made.",
  });
  ui.intro?.("Code Workspace extension search");
  const selected = await createRegistryExtensionPicker({
    dependencies,
    state: stateInspection.state,
    systemIds,
  })({
    ui,
    query: invocation.args[0] || "",
  });
  if (!selected.length) {
    ui.close?.("No extensions selected. No changes were made.");
    return success("extension.search", {
      action: "skip",
      scope: "selection",
      requested: [],
      results: [],
      summary: { total: 0, succeeded: 0, skipped: 0, failed: 0 },
    }, "No extensions selected. No changes were made.");
  }
  const requested = normalizeExtensionNames(selected.map((entry) => entry.id));
  const actionById = new Map(selected.map((entry) => [entry.id, entry.action || "install"]));
  const installSelections = selected.filter((entry) => entry.action !== "uninstall" && entry.action !== "keep");
  const uninstallSelections = selected.filter((entry) => entry.action === "uninstall");
  const planningState = structuredClone(stateInspection.state);
  for (const entry of uninstallSelections) delete planningState.extensions[entry.id];
  const tools = resolveWorkspaceTools({ state: loadState(invocation.root), manifestTools: loadInitManifest().tools }).tools;
  const preparation = installSelections.length > 0
    ? await prepareRegistryExtensionPlans({
      ...dependencies,
      requested: installSelections.map((entry) => entry.id),
      tools,
      state: planningState,
      stateError: stateInspection.error,
      extensionsRoot: dependencies.extensionsRoot,
      extensionStoreRoot: dependencies.extensionStoreRoot || defaultExtensionStoreRoot(),
      provider: dependencies.nexusProvider,
    })
    : { plans: [], failures: [], diagnostics: [] };
  preparation.plans = preparation.plans.map((plan) => ({ ...plan, action: actionById.get(plan.id) || "install" }));
  const uninstallPlans = [];
  const uninstallPreparationFailures = [];
  for (const entry of uninstallSelections) {
    try {
      uninstallPlans.push(planExtensionUninstall(invocation.root, entry.id));
    } catch (error) {
      uninstallPreparationFailures.push({ id: entry.id, version: null, status: "failed", code: error.code || "EXTENSION_UNINSTALL_FAILED", message: error.message, statePersisted: false, phase: "prepare" });
    }
  }
  const effectiveUninstallPlans = uninstallPlans.filter((plan) => plan.action !== "skip");
  if (preparation.plans.length > 0 || effectiveUninstallPlans.length > 0) {
    const planText = formatExtensionChanges(preparation.plans, effectiveUninstallPlans, {
      actionFor: (plan) => actionById.get(plan.id) || "install",
    });
    if (!(await (dependencies.confirm || confirm)(`${planText}\nContinue?`, invocation.options))) {
      throw new WorkspaceError("CLI_CANCELLED", "Extension search selection cancelled.");
    }
  }
  const uninstallResults = [];
  for (const plan of effectiveUninstallPlans) {
    try {
      const currentPlan = refreshUninstallPlan(invocation.root, plan);
      uninstallResults.push({ ...applyExtensionUninstall(currentPlan, {
        ...(dependencies || {}),
        extensionStoreRoot: dependencies.extensionStoreRoot || defaultExtensionStoreRoot(),
      }), action: "uninstall" });
    } catch (error) {
      uninstallResults.push({ id: plan.id, version: plan.version, status: "failed", action: "uninstall", code: error.code || "EXTENSION_UNINSTALL_FAILED", message: error.message });
    }
  }
  const batch = runExtensionBatch(invocation.root, preparation.plans, (extension) => ({
    schemaVersion: 1,
    extensionSpecVersion: extension.extensionSpecVersion,
    extension: { id: extension.id, version: extension.version },
    workspace: { name: workspace.name, uuid: workspace.uuid, language: workspace.language },
    tools,
  }), {
    requested: installSelections.map((entry) => entry.id),
    preFailures: [...preparation.failures, ...uninstallPreparationFailures],
    useExtensionStore: true,
    extensionStoreRoot: dependencies.extensionStoreRoot || defaultExtensionStoreRoot(),
  });
  const failedIds = new Set(batch.results.filter((entry) => entry.status === "failed").map((entry) => entry.id));
  const diagnostics = [
    ...preparation.diagnostics.filter((entry) => !entry.extension || !failedIds.has(entry.extension)),
    ...batch.results.filter((entry) => entry.status === "failed").map((entry) => ({
      code: entry.code || "EXTENSION_SEARCH_APPLY_FAILED",
      severity: "error",
      message: entry.message || `Extension ${entry.id} failed to apply.`,
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
    ...uninstallResults.filter((entry) => entry.status === "failed").map((entry) => ({
      code: entry.code || "EXTENSION_UNINSTALL_FAILED",
      severity: "error",
      message: entry.message || `Extension ${entry.id} failed to uninstall.`,
      extension: entry.id,
      version: entry.version,
    })),
  ];
  const installedResults = decorateBatchResults(batch, preparation.plans, invocation.options);
  const resultById = new Map([
    ...installedResults.map((entry) => [entry.id, entry]),
    ...uninstallResults.map((entry) => [entry.id, entry]),
    ...uninstallPreparationFailures.map((entry) => [entry.id, entry]),
  ]);
  const rawResults = selected.map((selection) => {
    if (selection.action === "keep") {
      return { id: selection.id, version: stateInspection.state.extensions[selection.id]?.installed?.version || null, status: "skipped", reason: "already-installed", action: "skip" };
    }
    const entry = resultById.get(selection.id);
    return entry || { id: selection.id, status: "failed", message: "Extension operation did not run." };
  });
  const results = rawResults.map((entry) => lifecycleResultEntry(entry, entry.action || actionById.get(entry.id) || "install"));
  ui.close?.("Extension selection applied.");
  return selectionResult("extension.search", requested, results, {
    diagnostics,
    text: lifecycleResultText(results, (entry) => entry.action || actionById.get(entry.id) || "install"),
  });
}

async function executeExtensionInfo(invocation) {
  const result = await getRegistryExtensionInfo({
    name: invocation.args[0],
    ...registryDependencies(invocation.dependencies || {}),
  });
  return success("extension.info", result, formatRegistryInfoText(result));
}

async function executeExtensionUpgrade(invocation) {
  const command = "extension.upgrade";
  const dependencies = registryDependencies(invocation.dependencies || {});
  const requested = normalizeExtensionNames(invocation.args);
  const stateInspection = inspectExtensionState(invocation.root);
  const systemIds = new Set(discoverSystemExtensions({ tolerant: true, ...(dependencies.extensionsRoot ? { extensionsRoot: dependencies.extensionsRoot } : {}) }).catalog.map((entry) => entry.id));
  const preFailures = [];
  for (const id of requested) {
    if (systemIds.has(id)) {
      preFailures.push({ id, version: null, status: "failed", code: "EXTENSION_SYSTEM_MANAGED", message: `System extension is managed automatically by init: ${id}`, statePersisted: false, phase: "prepare" });
    } else if (!stateInspection.state.extensions[id]?.installed) {
      preFailures.push({ id, version: null, status: "failed", code: "EXTENSION_NOT_INSTALLED", message: `Extension is not installed: ${id}`, statePersisted: false, phase: "prepare" });
    }
  }
  const eligible = requested.filter((id) => !preFailures.some((entry) => entry.id === id));
  const preparation = await prepareRegistryExtensionPlans({
    ...dependencies,
    requested: eligible,
    tools: resolveWorkspaceTools({ state: loadState(invocation.root), manifestTools: loadInitManifest().tools }).tools,
    state: stateInspection.state,
    stateError: eligible.length > 0 ? stateInspection.error : null,
    extensionsRoot: dependencies.extensionsRoot,
    extensionStoreRoot: dependencies.extensionStoreRoot || defaultExtensionStoreRoot(),
    provider: dependencies.nexusProvider,
    offline: invocation.options.offline,
  });
  if (preparation.plans.length > 0) {
    const planText = formatInstallPlan(preparation.plans).replace(/^Install /, "Upgrade ");
    if (!(await (dependencies.confirm || confirm)(`${planText}\nContinue?`, invocation.options))) {
      throw new WorkspaceError("CLI_CANCELLED", "Extension upgrade cancelled.");
    }
  }
  const workspace = invocation.config.workspace;
  const tools = resolveWorkspaceTools({ state: loadState(invocation.root), manifestTools: loadInitManifest().tools }).tools;
  const batch = runExtensionBatch(invocation.root, preparation.plans, (extension) => ({
    schemaVersion: 1,
    extensionSpecVersion: extension.extensionSpecVersion,
    extension: { id: extension.id, version: extension.version },
    workspace: { name: workspace.name, uuid: workspace.uuid, language: workspace.language },
    tools,
  }), {
    requested,
    preFailures: [...preFailures, ...preparation.failures],
    useExtensionStore: true,
    extensionStoreRoot: dependencies.extensionStoreRoot || defaultExtensionStoreRoot(),
  });
  const failedIds = new Set(batch.results.filter((entry) => entry.status === "failed").map((entry) => entry.id));
  const diagnostics = [
    ...preparation.diagnostics.filter((entry) => !entry.extension || !failedIds.has(entry.extension)),
    ...batch.results.filter((entry) => entry.status === "failed").map((entry) => ({
      code: entry.code || "EXTENSION_UPGRADE_FAILED",
      severity: "error",
      message: entry.message || `Extension ${entry.id} failed to upgrade.`,
      extension: entry.id,
      version: entry.version,
    })),
  ];
  const results = decorateBatchResults(batch, preparation.plans, invocation.options);
  return selectionResult(command, requested, results.map((entry) => lifecycleResultEntry(entry, "upgrade")), {
    diagnostics,
    text: lifecycleResultText(results, "upgrade"),
  });
}

async function executeExtensionUninstall(invocation) {
  const command = "extension.uninstall";
  const plan = planExtensionUninstall(invocation.root, invocation.args[0]);
  const planText = formatUninstallPlan(plan);
  if (plan.action === "remove" && !(await confirm(`${planText}\nContinue?`, invocation.options))) {
    throw new WorkspaceError("CLI_CANCELLED", "Extension uninstall cancelled.");
  }
  const result = applyExtensionUninstall(plan, {
    ...(invocation.dependencies || {}),
    extensionStoreRoot: invocation.dependencies?.extensionStoreRoot || defaultExtensionStoreRoot(),
  });
  const text = result.status === "skipped" ? planText : `${planText}\nExtension uninstalled and verified.`;
  return success(command, { ...result, targets: plan.targets }, text);
}

async function executeExtensionPack(invocation) {
  const command = "extension.pack";
  const dependencies = invocation.dependencies || {};
  const settings = resolveExtensionSettings(dependencies);
  const result = await packExtensionSourceToDirectory(invocation.args[0], invocation.options.output, {
    ...dependencies,
    scope: dependencies.scope || settings.values.scope,
  });
  return success(
    command,
    result,
    `Packed ${result.npmName}@${result.version} to ${result.tarball.path}.`
  );
}

async function collectExtensionInitOptions(invocation, target) {
  const options = { ...invocation.options };
  const interactive = !options.json && options.yes !== true && process.stdin.isTTY && process.stdout.isTTY;
  if (!interactive) return options;
  const ui = await createInteractiveUi({
    cancelCode: "EXTENSION_INIT_CANCELLED",
    cancelMessage: "Extension initialization cancelled. No changes were made.",
  });
  const defaultId = path.basename(path.resolve(target)).toLowerCase();
  ui.intro("Create Code Workspace extension package");
  if (options.id === undefined) options.id = await ui.text("Extension id", defaultId);
  const defaultName = String(options.id || defaultId).split("-").map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(" ");
  if (options.name === undefined) options.name = await ui.text("Extension name", defaultName);
  if (options.description === undefined) options.description = await ui.text("Description", "Code Workspace extension.");
  if (options.version === undefined) options.version = await ui.text("Version", "0.1.0");
  ui.close("Extension metadata ready.");
  return options;
}

async function executeExtensionInit(invocation) {
  const command = "extension.init";
  const target = invocation.args[0] || ".";
  const options = await collectExtensionInitOptions(invocation, target);
  const pathText = path.resolve(target);
  const planText = `Create extension package shell in ${pathText}:\n  CREATE package.json\n  CREATE extension/manifest.json\n  CREATE extension/init.js\nContinue?`;
  if (!(await confirm(planText, options))) throw new WorkspaceError("CLI_CANCELLED", "Extension package initialization cancelled.");
  const result = scaffoldExtensionPackage(target, options);
  const text = result.action === "skip"
    ? `Extension package is already current: ${result.path}.`
    : `Created extension package shell in ${result.path}.\nNext: add outputs, hooks, or runtime to extension/manifest.json.`;
  return success(command, result, text);
}

async function executeExtensionDigestUpdate(invocation) {
  const command = "extension.digest.update";
  const target = invocation.args[0] || ".";
  if (!(await confirm(`Update extension digests in ${path.resolve(target)}?`, invocation.options))) {
    throw new WorkspaceError("CLI_CANCELLED", "Extension digest update cancelled.");
  }
  const result = digestUpdate(target);
  return success(command, result, result.action === "skip"
    ? `Extension digests are already current: ${result.path}.`
    : `Updated extension digests in ${result.path}.`);
}

async function executeExtension(invocation) {
  const command = invocation.definition.path.join(".");
  if (command === "extension.pack") return await executeExtensionPack(invocation);
  if (command === "extension.init") return await executeExtensionInit(invocation);
  if (command === "extension.digest.update") return await executeExtensionDigestUpdate(invocation);
  if (command === "extension.search") {
    const dependencies = invocation.dependencies || {};
    const interactive = dependencies.interactive ?? (!invocation.options.json && invocation.options.yes !== true && process.stdin.isTTY && process.stdout.isTTY);
    if (!interactive) return await executeExtensionSearch(invocation);
    const releaseLock = await (dependencies.acquireInitLock || acquireInitLock)(invocation.root);
    try {
      return await executeExtensionSearch(invocation);
    } finally {
      await releaseLock();
    }
  }
  if (command === "extension.info") return await executeExtensionInfo(invocation);
  const releaseLock = await (invocation.dependencies?.acquireInitLock || acquireInitLock)(invocation.root);
  try {
    if (command === "extension.install") return await executeExtensionInstall(invocation);
    if (command === "extension.upgrade") return await executeExtensionUpgrade(invocation);
    if (command === "extension.uninstall") return await executeExtensionUninstall(invocation);
    throw new WorkspaceError("CLI_HANDLER_MISSING", `Unsupported extension action: ${command}`);
  } finally {
    await releaseLock();
  }
}

module.exports = {
  collectRegistryExtensionInstallSelection,
  executeExtension,
  executeExtensionInstall,
  executeExtensionPack,
  executeExtensionInit,
  executeExtensionDigestUpdate,
  executeExtensionSearch,
  executeExtensionInfo,
  executeExtensionUninstall,
  executeExtensionUpgrade,
  formatInstallPlan,
  formatUninstallPlan,
};
