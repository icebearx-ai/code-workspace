const path = require("node:path");

const { WorkspaceError } = require("../errors");
const { createFileTransaction } = require("../transaction");
const { claudePermissionAdapter } = require("./claude");
const { codexPermissionAdapter } = require("./codex");

const permissionAdapters = new Map([
  [claudePermissionAdapter.id, claudePermissionAdapter],
  [codexPermissionAdapter.id, codexPermissionAdapter],
]);

function normalizeDirectories(values, label) {
  const normalized = [];
  for (const value of values || []) {
    if (typeof value !== "string" || !value.trim() || !path.isAbsolute(value.trim())) {
      throw new WorkspaceError("WORKSPACE_PERMISSION_DIRECTORY_INVALID", `${label} directories must be non-empty absolute paths.`, {
        label,
        directory: value ?? null,
      });
    }
    const directory = path.resolve(value.trim());
    if (!normalized.includes(directory)) normalized.push(directory);
  }
  return normalized;
}

function resolvePermissionAdapters(tools) {
  return [...new Set(tools || [])].map((tool) => {
    const adapter = permissionAdapters.get(tool);
    if (!adapter) {
      throw new WorkspaceError(
        "WORKSPACE_PERMISSION_TOOL_UNSUPPORTED",
        `Agent tool does not support workspace directory authorization: ${tool}`,
        { tool, remediation: "Select a permission-capable tool or install a Code Workspace release that supports it." }
      );
    }
    return adapter;
  });
}

function permissionTargets(root, tools) {
  return resolvePermissionAdapters(tools).flatMap((adapter) => adapter.targets(root));
}

function planPermissionChanges({ root, tools, grants = [], revokes = [] }, options = {}) {
  const normalizedGrants = normalizeDirectories(grants, "grant");
  const normalizedRevokes = normalizeDirectories(revokes, "revoke");
  const overlap = normalizedGrants.filter((directory) => normalizedRevokes.includes(directory));
  if (overlap.length > 0) {
    throw new WorkspaceError("WORKSPACE_PERMISSION_REQUEST_CONFLICT", `Directories cannot be granted and revoked in one request: ${overlap.join(", ")}`, {
      directories: overlap,
    });
  }
  const adapters = resolvePermissionAdapters(tools);
  if (normalizedGrants.length === 0 && normalizedRevokes.length === 0) {
    const plans = adapters.map((adapter) => {
      const target = adapter.targets(root)[0];
      return { tool: adapter.id, target, targets: [target], action: "skip", granted: [], revoked: [], unchanged: [], passive: true };
    });
    return {
      root: path.resolve(root),
      tools: adapters.map((adapter) => adapter.id),
      requested: { grants: [], revokes: [] },
      action: "skip",
      targets: plans.flatMap((plan) => plan.targets),
      plans,
    };
  }
  const plans = adapters.map((adapter) => {
    const current = adapter.inspect(root, options);
    return adapter.plan({ root, current, grants: normalizedGrants, revokes: normalizedRevokes });
  });
  return {
    root: path.resolve(root),
    tools: adapters.map((adapter) => adapter.id),
    requested: { grants: normalizedGrants, revokes: normalizedRevokes },
    action: plans.some((plan) => plan.action === "write") ? "write" : "skip",
    targets: plans.flatMap((plan) => plan.targets),
    plans,
  };
}

function permissionResult(plan) {
  return {
    action: plan.action,
    requestedTools: plan.tools,
    requested: plan.requested,
    tools: plan.plans.map((toolPlan) => ({
      tool: toolPlan.tool,
      target: path.relative(plan.root, toolPlan.target),
      action: toolPlan.action,
      granted: toolPlan.granted,
      revoked: toolPlan.revoked,
      unchanged: toolPlan.unchanged,
      verified: true,
    })),
  };
}

function applyPermissionPlan(plan, options = {}) {
  const transaction = options.transaction || createFileTransaction(plan.targets);
  const ownsTransaction = !options.transaction;
  try {
    for (const toolPlan of plan.plans) {
      if (toolPlan.passive) continue;
      const adapter = permissionAdapters.get(toolPlan.tool);
      adapter.assertCurrent(toolPlan, options);
    }
    for (const toolPlan of plan.plans) {
      if (toolPlan.action === "skip") continue;
      const adapter = permissionAdapters.get(toolPlan.tool);
      adapter.apply(toolPlan, options);
      options.injectFailure?.(`after-${toolPlan.tool}-permission-write`, toolPlan);
    }
    for (const toolPlan of plan.plans) {
      if (toolPlan.action === "skip") continue;
      const adapter = permissionAdapters.get(toolPlan.tool);
      adapter.verify(toolPlan, options);
      options.injectFailure?.(`after-${toolPlan.tool}-permission-verify`, toolPlan);
    }
    if (ownsTransaction) transaction.commit();
    return permissionResult(plan);
  } catch (error) {
    if (ownsTransaction) transaction.rollback(error);
    throw error;
  }
}

function inspectProjectPermissions({ root, tools, projects }, options = {}) {
  const directories = normalizeDirectories((projects || []).map((project) => project.location), "project");
  return resolvePermissionAdapters(tools).map((adapter) => {
    const current = adapter.inspect(root, options);
    const authorized = new Set(current.directories);
    return {
      tool: adapter.id,
      target: path.relative(path.resolve(root), current.file),
      directories: current.directories,
      missing: directories.filter((directory) => !authorized.has(directory)),
    };
  });
}

function formatPermissionPlan(plan) {
  const lines = [];
  for (const toolPlan of plan.plans) {
    for (const directory of toolPlan.granted) lines.push(`  GRANT  ${directory} (${toolPlan.tool})`);
    for (const directory of toolPlan.revoked) lines.push(`  REVOKE ${directory} (${toolPlan.tool})`);
  }
  if (lines.length === 0) return "No Agent authorization changes are required.";
  return ["Agent authorization changes:", ...lines, "Affected files:", ...plan.plans.filter((entry) => entry.action === "write").map((entry) => `  ${path.relative(plan.root, entry.target)}`)].join("\n");
}

module.exports = {
  applyPermissionPlan,
  formatPermissionPlan,
  inspectProjectPermissions,
  normalizeDirectories,
  permissionAdapters,
  permissionTargets,
  planPermissionChanges,
  resolvePermissionAdapters,
};
