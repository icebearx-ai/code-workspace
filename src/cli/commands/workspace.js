const { loadInitManifest } = require("../../core/init");
const { doctorWorkspace } = require("../../core/doctor");
const { getLocale } = require("../../i18n");
const { fromDiagnostics, success } = require("../result");

function executeLanguage(invocation) {
  const language = invocation.config.workspace.language;
  const locale = getLocale(language);
  return success("language", { language, label: locale.label, projectContext: locale.projectContext }, language);
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
};
