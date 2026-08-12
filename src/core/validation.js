const fs = require("node:fs");
const path = require("node:path");

const { add, result } = require("./diagnostics");
const { CURRENT_CONFIG_VERSION } = require("./config");
const { inspectGitWorktree } = require("./project");

function isSameOrDescendant(parent, candidate) {
  const relative = path.relative(parent, candidate);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

function diagnosticProjects(...values) {
  return [...new Set(values.flat().filter((value) => typeof value === "string" && value))];
}

function addExistingDiagnostic(output, diagnostic) {
  output.diagnostics.push(diagnostic);
  if (diagnostic.severity === "error") output.errors.push(diagnostic.message);
  if (diagnostic.severity === "warning") output.warnings.push(diagnostic.message);
}

function validateProjects(root, config) {
  const output = result();
  if (![1, CURRENT_CONFIG_VERSION].includes(config.schemaVersion)) {
    add(output, "error", "UNSUPPORTED_SCHEMA_VERSION", `Unsupported schemaVersion: ${config.schemaVersion}`);
  }
  if (!Array.isArray(config.projects)) {
    add(output, "error", "PROJECTS_NOT_ARRAY", "projects must be an array.");
    return output;
  }
  if (config.projects.length === 0) {
    add(output, "warning", "NO_PROJECTS", "No local projects are configured.");
    return output;
  }

  const rootRealPath = fs.realpathSync(root);
  const names = new Map();
  const inspected = [];

  config.projects.forEach((project, index) => {
    const label = project?.name || `#${index + 1}`;
    if (!project || typeof project !== "object" || Array.isArray(project)) {
      add(output, "error", "PROJECT_NOT_OBJECT", `Project ${label} must be a mapping.`);
      return;
    }
    for (const field of ["name", "location", "branch", "type", "context"]) {
      if (typeof project[field] !== "string" || !project[field].trim()) {
        add(output, "error", "PROJECT_FIELD_REQUIRED", `Project ${label} must contain a non-empty ${field}.`, { projectName: project.name || null, field });
      }
    }
    if (project.name) {
      const previous = names.get(project.name);
      if (previous) add(output, "error", "DUPLICATE_PROJECT_NAME", `Duplicate project name: ${project.name}`, {
        projectName: project.name,
        projects: diagnosticProjects(previous, project.name),
      });
      else names.set(project.name, project.name);
    }
    if (typeof project.location !== "string" || !path.isAbsolute(project.location)) {
      add(output, "error", "PROJECT_LOCATION_NOT_ABSOLUTE", `Project ${label} location must be absolute: ${project.location}`, { projectName: project.name || null });
      return;
    }
    try {
      const actual = inspectGitWorktree(project.location);
      if (isSameOrDescendant(actual.realPath, rootRealPath) || isSameOrDescendant(rootRealPath, actual.realPath)) {
        add(output, "error", "PROJECT_OVERLAPS_WORKSPACE", `Project ${label} must not overlap the workspace root: ${actual.realPath}`, { projectName: project.name || null });
      }
      if (project.branch && project.branch !== actual.branch) {
        add(output, "error", "PROJECT_BRANCH_MISMATCH", `Project ${label} configured branch ${project.branch} does not match actual branch ${actual.branch}.`, {
          projectName: project.name || null,
          configuredBranch: project.branch,
          actualBranch: actual.branch,
          location: actual.realPath,
        });
      }
      inspected.push({ name: label, projectName: project.name || null, realPath: actual.realPath });
    } catch (error) {
      add(output, "error", "PROJECT_INSPECTION_FAILED", `Project ${label} cannot be inspected: ${error.message}`, { projectName: project.name || null });
    }
  });

  for (let left = 0; left < inspected.length; left += 1) {
    for (let right = left + 1; right < inspected.length; right += 1) {
      const a = inspected[left];
      const b = inspected[right];
      if (a.realPath === b.realPath) {
        add(output, "error", "DUPLICATE_PROJECT_PATH", `Projects ${a.name} and ${b.name} resolve to the same directory: ${a.realPath}`, {
          projects: diagnosticProjects(a.projectName, b.projectName),
        });
      } else if (isSameOrDescendant(a.realPath, b.realPath) || isSameOrDescendant(b.realPath, a.realPath)) {
        add(output, "error", "NESTED_PROJECT_PATH", `Projects ${a.name} and ${b.name} must not be nested.`, {
          projects: diagnosticProjects(a.projectName, b.projectName),
        });
      }
    }
  }
  return output;
}

function validateProjectSelection(root, config, names) {
  const all = validateProjects(root, config);
  const output = result();
  const selected = new Set(names);
  for (const diagnostic of all.diagnostics) {
    const participants = diagnosticProjects(diagnostic.projectName, diagnostic.projects);
    const applies = participants.length === 0 || participants.some((name) => selected.has(name));
    if (applies) addExistingDiagnostic(output, diagnostic);
  }
  return output;
}

function validateProject(root, config, name) {
  return validateProjectSelection(root, config, [name]);
}

module.exports = {
  isSameOrDescendant,
  validateProject,
  validateProjectSelection,
  validateProjects,
};
