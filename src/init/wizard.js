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

async function collectExtensionPlans(options, ui, tools) {
  if (options.extensions !== undefined) {
    const selected = normalizePickerSelections(options.extensions);
    if (typeof options.prepareExtensions === "function") return options.prepareExtensions(selected, tools);
    const catalog = options.extensionCatalog || [];
    return resolveExtensionPlans(catalog, selected.map((entry) => entry.id), {
      tools,
      state: options.extensionState,
    });
  }

  if (typeof options.extensionPicker === "function") {
    try {
      const selected = normalizePickerSelections(await options.extensionPicker({
        ui,
        selectedIds: options.initialExtensions || [],
        query: options.extensionQuery || "",
      }));
      if (typeof options.prepareExtensions === "function") return options.prepareExtensions(selected, tools);
      return selected;
    } catch (error) {
      ui.note("Extensions unavailable", [
        error.message || "The Nexus extension Registry could not be reached.",
        "Ordinary extensions will be skipped; core Workspace initialization can continue.",
      ]);
      return [];
    }
  }

  // Kept for direct callers that inject a catalog (production init no longer does).
  const extensionCatalog = options.extensionCatalog || [];
  const supportedExtensions = extensionCatalog.filter((entry) => entry.latestSupported);
  if (supportedExtensions.length === 0) return [];
  const extensionNames = await ui.multiselect(
    "Extensions (experimental, select any)",
    supportedExtensions.map((entry) => ({
      value: entry.id,
      label: formatExtensionChoice(entry),
    })),
    options.initialExtensions !== undefined ? options.initialExtensions : []
  );
  return resolveExtensionPlans(extensionCatalog, extensionNames, {
    tools,
    state: options.extensionState,
  });
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
  const extensions = [
    ...systemExtensions,
    ...(await collectExtensionPlans(options, ui, tools)),
  ];
  const workspace = existing?.workspace || { name, uuid: randomUUID() };
  const plan = createInitPlan({ root, workspace, tools, language, extensions });
  ui.note("Ready to initialize", [
    `Workspace  ${workspace.name}`,
    `Language   ${language}`,
    `Tools      ${tools.length ? tools.join(", ") : "none"}`,
    `Extensions ${extensions.length ? extensions.map((entry) => `${entry.id}@${entry.version} [Spec ${entry.extensionSpecVersion}] (${entry.manifestSha256})`).join(", ") : "none"}`,
  ]);
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
