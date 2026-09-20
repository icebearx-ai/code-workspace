const fs = require("node:fs");
const path = require("node:path");
const { randomUUID } = require("node:crypto");

const { DEFAULT_WORKSPACE_NAME, configPath, loadConfig } = require("../core/config");
const { DEFAULT_WORKSPACE_LANGUAGE, SUPPORTED_LANGUAGES, resolveWorkspaceLanguage } = require("../core/language");
const { createInitPlan } = require("./plan");
const { createInteractiveUi, formatExtensionChoice } = require("./ui");
const { formatPermissionPlan, planPermissionChanges } = require("../core/permissions");
const { resolveExtensionPlans } = require("../core/extensions");

function normalizePickerSelections(value) {
  if (value && !Array.isArray(value) && Array.isArray(value.selections)) value = value.selections;
  return Array.from(value || [], (entry) => {
    if (typeof entry === "string") return { id: entry, action: "install" };
    return { id: entry.id, action: entry.action || "install" };
  }).filter((entry) => entry.id);
}

function normalizePreparedExtensions(value, selected = []) {
  const prepared = Array.isArray(value) ? { plans: value } : (value || {});
  return {
    plans: Array.from(prepared.plans || []),
    uninstallPlans: Array.isArray(prepared.uninstallPlans)
      ? Array.from(prepared.uninstallPlans)
      : selected.filter((entry) => entry.action === "uninstall").map((entry) => entry.id),
  };
}

async function collectExtensionPlans(options, ui, tools) {
  if (options.extensions !== undefined) {
    const selected = normalizePickerSelections(options.extensions);
    if (typeof options.prepareExtensions === "function") return normalizePreparedExtensions(await options.prepareExtensions(selected, tools), selected);
    const catalog = options.extensionCatalog || [];
    return { plans: resolveExtensionPlans(catalog, selected.filter((entry) => entry.action !== "uninstall" && entry.action !== "keep").map((entry) => entry.id), {
      tools,
      state: options.extensionState,
    }), uninstallPlans: [] };
  }

  if (typeof options.extensionPicker === "function") {
    try {
      const selected = normalizePickerSelections(await options.extensionPicker({
        ui,
        selectedIds: options.initialExtensions || [],
        query: options.extensionQuery || "",
      }));
      if (typeof options.prepareExtensions === "function") return normalizePreparedExtensions(await options.prepareExtensions(selected, tools), selected);
      return { plans: selected.filter((entry) => entry.action !== "uninstall" && entry.action !== "keep"), uninstallPlans: selected.filter((entry) => entry.action === "uninstall").map((entry) => entry.id) };
    } catch (error) {
      ui.note("Extensions unavailable", [
        error.message || "The Nexus extension Registry could not be reached.",
        "Ordinary extensions will be skipped; core Workspace initialization can continue.",
      ]);
      return { plans: [], uninstallPlans: [] };
    }
  }

  // Kept for direct callers that inject a catalog (production init no longer does).
  const extensionCatalog = options.extensionCatalog || [];
  const supportedExtensions = extensionCatalog.filter((entry) => entry.latestSupported);
  if (supportedExtensions.length === 0) return { plans: [], uninstallPlans: [] };
  const extensionNames = await ui.multiselect(
    "Extensions (experimental, select any)",
    supportedExtensions.map((entry) => ({
      value: entry.id,
      label: formatExtensionChoice(entry),
    })),
    options.initialExtensions !== undefined ? options.initialExtensions : []
  );
  return { plans: resolveExtensionPlans(extensionCatalog, extensionNames, {
    tools,
    state: options.extensionState,
  }), uninstallPlans: [] };
}

async function collectInitPlan(root, manifest, options = {}) {
  const ui = options.ui || await createInteractiveUi(options);
  ui.intro();
  ui.note("Environment", [
    `Node.js ${options.nodeVersion || process.versions.node}`,
    `Target ${root}`,
  ]);

  const requestedLanguage = options.language;
  const existingLanguage = resolveWorkspaceLanguage(root, {
    language: requestedLanguage,
    defaultLanguage: DEFAULT_WORKSPACE_LANGUAGE,
    allowLegacy: true,
  });
  const existing = fs.existsSync(configPath(root)) ? loadConfig(root, { defaultLanguage: existingLanguage }) : null;
  const name = existing?.workspace?.name || options.workspaceName || await ui.text("Workspace name", DEFAULT_WORKSPACE_NAME);
  const languageChoices = SUPPORTED_LANGUAGES.map((entry) => ({
    value: entry.value,
    label: `${entry.label} · ${entry.value}`,
  }));
  const language = requestedLanguage || await ui.select(
    "Workspace language",
    languageChoices,
    Math.max(0, languageChoices.findIndex((entry) => entry.value === existingLanguage))
  );
  const toolChoices = [
    { value: "claude", label: "Claude Code" },
    { value: "codex", label: "Codex" },
  ];
  const tools = options.tools || await ui.multiselect(
    "Agent tools (select any)",
    toolChoices,
    options.initialTools || ["claude", "codex"]
  );
  const systemExtensions = typeof options.prepareSystemExtensions === "function"
    ? await options.prepareSystemExtensions(tools)
    : (options.systemExtensions || []);
  const ordinary = await collectExtensionPlans(options, ui, tools);
  const extensions = [
    ...systemExtensions,
    ...ordinary.plans,
  ];
  const workspace = existing?.workspace || { name, uuid: randomUUID() };
  const extensionRemovals = ordinary.uninstallPlans || [];
  const plan = createInitPlan({ root, workspace, tools, language, extensions, extensionRemovals });
  const extensionChanges = [
    ...extensions.map((entry) => `${entry.action === "update" ? "Update" : "Install"} ${entry.id}@${entry.version}`),
    ...extensionRemovals.map((entry) => typeof entry === "string" ? `Uninstall ${entry}` : `Uninstall ${entry.id}@${entry.version}`),
  ];
  ui.note("Ready to initialize", [
    `Workspace  ${workspace.name}`,
    `Language   ${language}`,
    `Tools      ${tools.length ? tools.join(", ") : "none"}`,
    `Extensions ${extensions.length ? extensions.map((entry) => `${entry.id}@${entry.version} [Spec ${entry.extensionSpecVersion}] (${entry.manifestSha256})`).join(", ") : "none"}`,
    `Changes    ${extensionChanges.length ? extensionChanges.join(", ") : "none"}`,
  ]);
  if (extensionChanges.length) {
    const formatted = typeof options.formatExtensionChanges === "function"
      ? options.formatExtensionChanges(extensions, extensionRemovals)
      : extensionChanges.join("\n");
    ui.note("Extension changes", formatted.split("\n"));
  }
  if (existing?.projects?.length) {
    const permissionPlan = planPermissionChanges({
      root,
      tools,
      grants: existing.projects.map((project) => project.location),
    });
    ui.note("Agent authorization", formatPermissionPlan(permissionPlan).split("\n"));
  }
  if (!await ui.confirm("Continue?", true)) {
    (ui.cancel || ui.close)("Initialization cancelled. No changes were made.");
    const error = new Error("Initialization cancelled. No changes were made.");
    error.code = "INIT_CANCELLED";
    throw error;
  }
  ui.close("Plan confirmed. Starting initialization…");
  return plan;
}

module.exports = { collectInitPlan };
