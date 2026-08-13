const { loadState } = require("../../core/config");
const { loadInitManifest } = require("../../core/init");
const { applyPermissionPlan, formatPermissionPlan, planPermissionChanges } = require("../../core/permissions");
const { resolveWorkspaceTools } = require("../../core/tools");
const { validateProjects } = require("../../core/validation");
const { confirm } = require("../confirmation");
const { fromDiagnostics, success } = require("../result");

async function executePermissions(invocation) {
  const command = "permissions.apply";
  const validation = validateProjects(invocation.root, invocation.config);
  if (validation.errors.length > 0) return fromDiagnostics(command, validation);
  const toolSelection = resolveWorkspaceTools({
    explicit: invocation.options.tools,
    state: loadState(invocation.root),
    manifestTools: loadInitManifest().tools,
  });
  const plan = planPermissionChanges({
    root: invocation.root,
    tools: toolSelection.tools,
    grants: invocation.config.projects.map((project) => project.location),
  });
  const planText = formatPermissionPlan(plan);
  if (plan.action === "write" && !(await confirm(`${planText}\nApply these Agent authorization changes?`, invocation.options))) {
    const error = new Error("Agent authorization changes cancelled.");
    error.code = "CLI_CANCELLED";
    throw error;
  }
  const result = applyPermissionPlan(plan, invocation.options.dependencies);
  return success(command, { ...result, toolSelection }, plan.action === "skip" ? planText : `${planText}\nAgent authorization changes applied and verified.`, validation.diagnostics);
}

module.exports = { executePermissions };
