const { configPath, loadConfigProjection, loadState, saveConfig } = require("./config");
const { WorkspaceError } = require("./errors");
const { loadInitManifest } = require("./init");
const { applyPermissionPlan, planPermissionChanges } = require("./permissions");
const { resolveWorkspaceTools } = require("./tools");
const { createFileTransaction } = require("./transaction");

function projectPermissionTools(root, options = {}) {
  return resolveWorkspaceTools({
    explicit: options.tools,
    state: loadState(root),
    manifestTools: loadInitManifest().tools,
  });
}

function fallbackPermissionPlan(root, nextConfig, options = {}) {
  const previous = (options.loadConfigProjection || loadConfigProjection)(root, ["projects"]);
  const previousLocations = new Set(previous.projects.map((project) => project.location));
  const nextLocations = new Set(nextConfig.projects.map((project) => project.location));
  return planPermissionChanges({
    root,
    tools: projectPermissionTools(root, options).tools,
    grants: [...nextLocations].filter((location) => !previousLocations.has(location)),
    revokes: [...previousLocations].filter((location) => !nextLocations.has(location)),
  }, options);
}

function applyProjectConfiguration(root, nextConfig, permissionPlan, options = {}) {
  if (!permissionPlan?.plans) {
    options = permissionPlan || options;
    permissionPlan = fallbackPermissionPlan(root, nextConfig, options);
  }
  const transaction = createFileTransaction([configPath(root), ...permissionPlan.targets]);
  try {
    (options.saveConfig || saveConfig)(root, nextConfig);
    options.injectFailure?.("after-config-save");
    const persisted = (options.loadConfigProjection || loadConfigProjection)(root, ["projects"]);
    if (JSON.stringify(persisted.projects) !== JSON.stringify(nextConfig.projects)) {
      throw new WorkspaceError("PROJECT_CONFIGURATION_VERIFY_FAILED", "Persisted project configuration does not match the confirmed plan.");
    }
    const permissions = (options.applyPermissionPlan || applyPermissionPlan)(permissionPlan, { ...options, transaction });
    options.injectFailure?.("after-permissions-sync");
    transaction.commit();
    return permissions;
  } catch (error) {
    transaction.rollback(error);
    throw new WorkspaceError(
      "PROJECT_CONFIGURATION_UPDATE_FAILED",
      `Project configuration update rolled back: ${error.message}`,
      { ...(error.details || {}), cause: error.code || error.name }
    );
  }
}

module.exports = { applyProjectConfiguration, projectPermissionTools };
