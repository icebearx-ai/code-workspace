const path = require("node:path");

const { loadInitManifest } = require("../../core/init");
const { syncPermissions } = require("../../core/permissions");
const { doctorWorkspace } = require("../../core/doctor");
const { getLocale } = require("../../i18n");
const { validateProjects } = require("../../core/validation");
const { fromDiagnostics, success } = require("../result");

function executeLanguage(invocation) {
  const language = invocation.config.workspace.language;
  const locale = getLocale(language);
  return success("language", { language, label: locale.label, projectContext: locale.projectContext }, language);
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
  }, `Code Workspace is healthy (${output.config.projects.length} local projects).`);
}

module.exports = {
  executeDoctor,
  executeLanguage,
  executeSync,
};
