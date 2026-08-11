const fs = require("node:fs");
const path = require("node:path");
const { randomUUID } = require("node:crypto");

const { DEFAULT_MONITOR_URL, DEFAULT_WORKSPACE_NAME, configPath, loadConfig } = require("../core/config");
const { detectOpenSpec } = require("../core/init");
const { DEFAULT_WORKSPACE_LANGUAGE, SUPPORTED_LANGUAGES, resolveWorkspaceLanguage } = require("../core/language");
const { createInitPlan } = require("./plan");
const { createInteractiveUi } = require("./ui");

async function collectInitPlan(root, manifest, options = {}) {
  const ui = options.ui || await createInteractiveUi(options);
  const openspec = manifest.resources.openspec;
  const detected = detectOpenSpec(openspec, { root, run: options.run });
  ui.intro();
  ui.note("Environment", [
    `Node.js ${options.nodeVersion || process.versions.node}`,
    detected.commandVersion ? `OpenSpec ${detected.commandVersion} detected` : "OpenSpec not installed",
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
  const versionChoices = openspec.supportedVersions.map((version) => ({
    value: version,
    label: [version, version === openspec.selectedVersion ? "Recommended" : "", version === detected.commandVersion ? "Installed" : ""].filter(Boolean).join(" · "),
  }));
  const requestedVersion = options.openspecVersion;
  if (requestedVersion && !openspec.supportedVersions.includes(requestedVersion)) {
    throw new Error(`Unsupported OpenSpec version ${requestedVersion}; choose ${openspec.supportedVersions.join(", ")}`);
  }
  const initialVersion = requestedVersion && openspec.supportedVersions.includes(requestedVersion)
    ? openspec.supportedVersions.indexOf(requestedVersion)
    : Math.max(0, openspec.supportedVersions.indexOf(openspec.selectedVersion));
  const selectedVersion = requestedVersion || await ui.select("OpenSpec version", versionChoices, initialVersion);

  const toolChoices = [
    { value: "claude", label: "Claude Code" },
    { value: "codex", label: "Codex" },
  ];
  const tools = options.tools || await ui.multiselect(
    "Agent tools (select any)",
    toolChoices,
    options.initialTools || ["claude", "codex"]
  );
  let monitorEnabled = options.monitor !== undefined ? options.monitor : existing?.monitor?.enable;
  if (tools.includes("codex") && monitorEnabled === undefined) monitorEnabled = await ui.confirm("Enable Codex Agent monitor?", true);
  const monitor = {
    enable: tools.includes("codex") && monitorEnabled === true,
    url: options.monitorUrl || existing?.monitor?.url || DEFAULT_MONITOR_URL,
  };
  const workspace = existing?.workspace || { name, uuid: randomUUID() };
  const plan = createInitPlan({ root, workspace, detected, selectedVersion, tools, monitor, language });
  const transition = plan.openspec.action === "skip"
    ? `${selectedVersion} · already installed`
    : `${plan.openspec.detectedVersion || "not installed"} → ${selectedVersion} · global npm package`;
  ui.note("Ready to initialize", [
    `Workspace  ${workspace.name}`,
    `OpenSpec   ${transition}`,
    `Language   ${language}`,
    `Tools      ${tools.length ? tools.join(", ") : "none"}`,
    `Monitor    ${monitor.enable ? monitor.url : "disabled"}`,
  ]);
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
