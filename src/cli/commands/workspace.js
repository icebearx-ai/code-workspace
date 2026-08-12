const path = require("node:path");

const { loadInitManifest } = require("../../core/init");
const { parseAffectedProjects } = require("../../core/markdown");
const { syncPermissions } = require("../../core/permissions");
const { doctorWorkspace } = require("../../core/doctor");
const { WorkspaceError } = require("../../core/errors");
const { getLocale } = require("../../i18n");
const { validateChange, validateProjects, validateWorkspace } = require("../../core/validation");
const { fromDiagnostics, success } = require("../result");

function executeLanguage(invocation) {
  const language = invocation.config.workspace.language;
  const locale = getLocale(language);
  return success("language", { language, label: locale.label, projectContext: locale.projectContext }, language);
}

function executeContext(invocation) {
  const { config, options, root } = invocation;
  let projects = config.projects;
  if (options.project) projects = projects.filter((project) => project.name === options.project);
  let change = null;
  if (options.change) {
    const proposal = path.join(root, "openspec", "changes", options.change, "proposal.md");
    const affectedProjects = parseAffectedProjects(proposal);
    change = { name: options.change, affectedProjects };
    projects = projects.filter((project) => affectedProjects.includes(project.name));
  }
  const lines = ["# OpenSpec Workspace Context", "", `Workspace: ${root}`];
  if (change) lines.push(`Change: ${change.name}`, `Affected Projects: ${change.affectedProjects.join(", ")}`);
  for (const project of projects) {
    lines.push("", `## ${project.name}`, "", `- Type: ${project.type}`, `- Location: ${project.location}`, `- Branch: ${project.branch}`, `- Spec prefix: ${project.specPrefix}`, "", project.context);
  }
  return success("context", { workspaceRoot: root, change, projects }, lines.join("\n"));
}

function executeChangeValidate(invocation) {
  const name = invocation.args[0] || invocation.options.change;
  const requireMainSpecs = invocation.options["require-main-specs"] === true;
  const output = validateChange(invocation.root, invocation.config, name, { requireMainSpecs });
  return fromDiagnostics("change.validate", output, { change: name, requireMainSpecs },
    requireMainSpecs ? "OpenSpec change and synchronized main specs validation passed." : "OpenSpec change validation passed.");
}

function executeValidate(invocation) {
  const output = validateWorkspace(invocation.root, invocation.config);
  return fromDiagnostics("validate", output, null, "OpenSpec Workspace validation passed.");
}

function executeSync(invocation) {
  const output = validateProjects(invocation.root, invocation.config);
  if (output.errors.length > 0) return fromDiagnostics("sync", output);
  const synced = syncPermissions(invocation.root, invocation.config.projects);
  const relative = path.relative(invocation.root, synced.file);
  return success("sync", synced, `Workspace permissions ${synced.action === "write" ? "synchronized" : "already current"}: ${relative} (${synced.writableRoots} writable roots)`, output.diagnostics);
}

function executeDoctor(invocation) {
  const output = doctorWorkspace(invocation.root, loadInitManifest());
  return fromDiagnostics("doctor", output, {
    projects: output.config.projects.length,
    tools: output.toolSelection,
    capabilities: output.capabilities,
  }, `OpenSpec Workspace is healthy (${output.config.projects.length} local projects).`);
}

function executeCompletion(invocation, commands) {
  const shell = invocation.options.shell || "zsh";
  if (shell === "bash") {
    return success("completion", { shell }, `_openspec_workspace() {\n  local current="\${COMP_WORDS[COMP_CWORD]}"\n  COMPREPLY=( $(compgen -W "${commands.join(" ")}" -- "$current") )\n}\ncomplete -F _openspec_workspace openspec-workspace openspec-w`);
  }
  if (shell === "zsh") {
    return success("completion", { shell }, `#compdef openspec-workspace openspec-w\n_arguments '1:command:(${commands.join(" ")})' '*::arg:->args'`);
  }
  throw new WorkspaceError("CLI_COMPLETION_SHELL_UNSUPPORTED", `Unsupported completion shell: ${shell}`, { actual: shell, supported: ["bash", "zsh"] });
}

module.exports = {
  executeChangeValidate,
  executeCompletion,
  executeContext,
  executeDoctor,
  executeLanguage,
  executeSync,
  executeValidate,
};
