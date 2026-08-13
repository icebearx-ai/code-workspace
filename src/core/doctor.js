const { CURRENT_CONFIG_VERSION, inspectConfigDomains, loadState } = require("./config");
const { add, result } = require("./diagnostics");
const { inspectManagedFiles } = require("./managed-files");
const { DEFAULT_WORKSPACE_LANGUAGE, workspaceGuide } = require("./language");
const { inspectProjectPermissions } = require("./permissions");
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
    add(output, "error", "WORKSPACE_IDENTITY_MISSING", "Local workspace name and UUID are missing. Re-run `code-w init .` to generate them.");
  }

  const toolSelection = options.toolSelection || resolveWorkspaceTools({
    explicit: options.tools,
    state: loadState(root),
    manifestTools: manifest.tools,
  });
  const tools = toolSelection.tools;
  const capabilities = options.capabilities || (inspection.monitor.valid && config.monitor?.enable ? ["monitor"] : []);
  if (inspection.monitor.valid && config.monitor?.enable && !tools.includes("codex")) {
    add(output, "error", "MONITOR_CODEX_REQUIRED", "Agent monitoring is enabled, but Codex is not one of the selected tools.");
  }
  const language = inspection.language.valid ? config.workspace?.language : null;
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
  if (inspection.projects.valid && config.projects.length > 0) {
    try {
      output.permissionInspection = inspectProjectPermissions({ root, tools, projects: config.projects });
      for (const tool of output.permissionInspection) {
        for (const directory of tool.missing) {
          add(output, "error", "WORKSPACE_PERMISSION_MISSING", `Registered project directory is not authorized for ${tool.tool}: ${directory}`, {
            tool: tool.tool,
            directory,
            file: tool.target,
            remediation: "Review and run code-w permissions apply --yes.",
          });
        }
      }
    } catch (error) {
      add(output, "error", error.code || "WORKSPACE_PERMISSION_INSPECTION_FAILED", error.message, error.details || {});
    }
  }

  const state = loadState(root);
  if (!options.allowIncompleteState) {
    if (!state || state.status !== "healthy") add(output, "error", "INIT_STATE_UNHEALTHY", "Local initialization state is missing or unhealthy.");
    else {
      if (state.appliedReleaseVersion !== manifest.releaseVersion) {
        add(output, "error", "INIT_RELEASE_OUTDATED", `Initialized release ${state.appliedReleaseVersion || "missing"} does not match package ${manifest.releaseVersion}.`);
      }
    }
  }

  return {
    ...output,
    config,
    tools,
    toolSelection,
    capabilities,
    language,
    configInspection: inspection,
    managedFiles: output.managedFileInspection?.files || [],
    permissions: output.permissionInspection || [],
  };
}

module.exports = { doctorWorkspace, merge };
