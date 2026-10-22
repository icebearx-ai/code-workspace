const path = require("node:path");

const { loadConfig } = require("../../core/config");
const { loadInitManifest } = require("../../core/init");
const { doctorWorkspace } = require("../../core/doctor");
const { resolveWorkspaceTools } = require("../../core/tools");
const { success } = require("../result");

async function executeContext(invocation) {
  const root = path.resolve(invocation.root);
  const manifest = loadInitManifest();
  const config = loadConfig(root);
  const toolSelection = resolveWorkspaceTools({
    state: invocation.config?.state,
    manifestTools: manifest.tools,
  });
  const tools = toolSelection.tools;
  const language = config.workspace?.language || "zh-CN";
  const doctor = doctorWorkspace(root, manifest, { tools, run: () => ({ status: 0, stdout: "", stderr: "" }) });

  const projects = config.projects.map((project) => ({
    name: project.name,
    location: project.location,
    registeredBranch: project.branch,
    type: project.type,
    context: project.context,
    updateLatest: project.updateLatest === true,
  }));

  const permissions = doctor.permissions.map((entry) => ({
    tool: entry.tool,
    status: entry.missing.length === 0 ? "ok" : "missing",
    missingDirectories: entry.missing,
  }));

  const health = doctor.errors.length === 0 ? "ok" : doctor.errors.length === 1 && doctor.errors[0].code === "INIT_RELEASE_OUTDATED" ? "outdated" : "error";
  const diagnostics = doctor.diagnostics || [];

  return success("context", {
    workspace: {
      name: config.workspace?.name || null,
      uuid: config.workspace?.uuid || null,
      language,
    },
    tools: { tools, source: toolSelection.source },
    projects,
    permissions,
    health,
  }, formatContextText(projects, health), diagnostics);
}

function formatContextText(projects, health) {
  const lines = [`Workspace health: ${health}`];
  if (projects.length === 0) {
    lines.push("No projects registered.");
  } else {
    for (const project of projects) {
      lines.push(`- ${project.name} (${project.type || "unknown"}) → ${project.location}`);
    }
  }
  return lines.join("\n");
}

module.exports = { executeContext };
