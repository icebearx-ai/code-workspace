const fs = require("node:fs");
const path = require("node:path");

const { verifyWorkspaceSchemaSelection } = require("./assets");
const { CURRENT_CONFIG_VERSION, inspectConfigDomains, loadState } = require("./config");
const { add, result } = require("./diagnostics");
const { detectOpenSpec } = require("./init");
const { inspectManagedFiles } = require("./managed-files");
const { DEFAULT_WORKSPACE_LANGUAGE, readOpenSpecLanguage, workspaceGuide } = require("./language");
const { START: PERMISSIONS_START } = require("./permissions");
const { validateProjects } = require("./validation");
const { resolveWorkspaceTools } = require("./tools");

function merge(target, source) {
  target.errors.push(...source.errors);
  target.warnings.push(...source.warnings);
  target.diagnostics.push(...source.diagnostics);
}

function doctorWorkspace(root, manifest, options = {}) {
  const output = result();
  const inspection = inspectConfigDomains(root);
  const config = {
    schemaVersion: CURRENT_CONFIG_VERSION,
    workspace: inspection.identity.value
      ? { ...inspection.identity.value, ...(inspection.language.valid ? { language: inspection.language.value } : {}) }
      : null,
    monitor: inspection.monitor.value,
    projects: inspection.projects.value || [],
  };
  const domainErrors = [inspection.document, inspection.identity, inspection.language, inspection.monitor, inspection.projects]
    .flatMap((domain) => domain.diagnostics || []);
  for (const error of domainErrors) {
    add(output, "error", error.code || "LOCAL_CONFIG_INVALID", error.message, error.details || {});
  }
  if (inspection.projects.valid) {
    merge(output, validateProjects(root, config));
  }

  if (inspection.identity.valid && !config.workspace) {
    add(output, "error", "WORKSPACE_IDENTITY_MISSING", "Local workspace name and UUID are missing. Re-run `openspec-w init .` to generate them.");
  }

  const openspec = manifest.resources.openspec;
  const detected = detectOpenSpec(openspec, { root, run: options.run });
  if (!detected.globalVersion || !detected.commandVersion) {
    add(output, "error", "OPENSPEC_NOT_INSTALLED", "OpenSpec global package and command must both be available.", detected);
  } else if (detected.globalVersion !== detected.commandVersion) {
    add(output, "error", "OPENSPEC_VERSION_MISMATCH", `OpenSpec global version ${detected.globalVersion} does not match command version ${detected.commandVersion}.`, detected);
  } else if (!openspec.supportedVersions.includes(detected.commandVersion)) {
    add(output, "error", "OPENSPEC_VERSION_UNSUPPORTED", `Unsupported OpenSpec version: ${detected.commandVersion}.`, detected);
  }

  const toolSelection = options.toolSelection || resolveWorkspaceTools({
    explicit: options.tools,
    state: loadState(root),
    manifestTools: openspec.tools,
  });
  const tools = toolSelection.tools;
  const capabilities = options.capabilities || (inspection.monitor.valid && config.monitor?.enable ? ["monitor"] : []);
  if (inspection.monitor.valid && config.monitor?.enable && !tools.includes("codex")) {
    add(output, "error", "MONITOR_CODEX_REQUIRED", "Agent monitoring is enabled, but Codex is not one of the selected tools.");
  }
  let language = null;
  try {
    language = inspection.language.valid ? config.workspace?.language : null;
    const configured = readOpenSpecLanguage(root);
    if (language && configured.language !== language) {
      add(output, "error", "WORKSPACE_LANGUAGE_DERIVATION_MISMATCH", `OpenSpec context language ${configured.language} does not match configured workspace language ${language}.`);
    }
    if (configured.legacy) {
      add(output, "warning", "WORKSPACE_LANGUAGE_LEGACY", "OpenSpec context uses the legacy Chinese language marker. Run `openspec-w update` to migrate it.");
    }
  } catch (error) {
    add(output, "error", "WORKSPACE_LANGUAGE_INVALID", error.message);
  }
  try {
    if (!inspection.language.valid) {
      add(output, "warning", "MANAGED_FILE_CHECK_SKIPPED", "Managed file content verification was skipped because workspace.language is invalid.", {
        prerequisite: "workspace.language",
      });
    } else {
      const managed = inspectManagedFiles(root, manifest, tools, capabilities, {
        WORKSPACE_LANGUAGE: language || DEFAULT_WORKSPACE_LANGUAGE,
        WORKSPACE_USER_GUIDE: workspaceGuide(language || DEFAULT_WORKSPACE_LANGUAGE),
      });
      for (const file of [...managed.managedOld, ...managed.replaceable]) {
        add(output, "error", "MANAGED_FILE_OUTDATED", `Managed file is not at the desired version: ${file}`);
      }
      for (const file of managed.missing) {
        add(output, "error", "MANAGED_FILE_MISSING", `Managed file target is missing: ${file}`);
      }
      for (const file of managed.unknown) {
        add(output, "error", "MANAGED_FILE_UNKNOWN", `Managed file contains unknown changes: ${file}`);
      }
      output.managedFileInspection = managed;
    }
  } catch (error) {
    add(output, "error", "MANAGED_FILE_MANIFEST_INVALID", error.message);
  }
  const schema = verifyWorkspaceSchemaSelection(root);
  for (const message of schema.errors) add(output, "error", "WORKSPACE_SCHEMA_INVALID", message);

  if (inspection.projects.valid && config.projects.length > 0) {
    const codexConfig = path.join(root, ".codex", "config.toml");
    if (!fs.existsSync(codexConfig) || !fs.readFileSync(codexConfig, "utf8").includes(PERMISSIONS_START)) {
      add(output, "error", "WORKSPACE_PERMISSIONS_MISSING", "Codex writable roots have not been synchronized.");
    }
  }

  const state = loadState(root);
  if (!options.allowIncompleteState) {
    if (!state || state.status !== "healthy") add(output, "error", "INIT_STATE_UNHEALTHY", "Local initialization state is missing or unhealthy.");
    else {
      if (state.appliedReleaseVersion !== manifest.releaseVersion) {
        add(output, "error", "INIT_RELEASE_OUTDATED", `Initialized release ${state.appliedReleaseVersion || "missing"} does not match package ${manifest.releaseVersion}.`);
      }
      if (state.resources?.openspec?.version !== detected.commandVersion) {
        add(output, "error", "INIT_OPENSPEC_STATE_MISMATCH", "Initialization state does not match the active OpenSpec version.");
      }
    }
  }

  return {
    ...output,
    config,
    detectedOpenSpec: detected,
    tools,
    toolSelection,
    capabilities,
    language,
    configInspection: inspection,
    managedFiles: output.managedFileInspection?.files || [],
  };
}

module.exports = { doctorWorkspace, merge };
