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

function validateSchemaAndRegistry(output, config) {
  if (![1, CURRENT_CONFIG_VERSION].includes(config.schemaVersion)) {
    add(output, "error", "UNSUPPORTED_SCHEMA_VERSION", `Unsupported schemaVersion: ${config.schemaVersion}`);
  }
  if (!Array.isArray(config.projects)) {
    add(output, "error", "PROJECTS_NOT_ARRAY", "projects must be an array.");
    return false;
  }
  return true;
}

function validateProjectFields(output, project, label) {
  if (!project || typeof project !== "object" || Array.isArray(project)) {
    add(output, "error", "PROJECT_NOT_OBJECT", `Project ${label} must be a mapping.`);
    return false;
  }
  for (const field of ["name", "location", "branch", "type", "context"]) {
    if (typeof project[field] !== "string" || !project[field].trim()) {
      add(output, "error", "PROJECT_FIELD_REQUIRED", `Project ${label} must contain a non-empty ${field}.`, { projectName: project.name || null, field });
    }
  }
  if (typeof project.location !== "string" || !path.isAbsolute(project.location)) {
    add(output, "error", "PROJECT_LOCATION_NOT_ABSOLUTE", `Project ${label} location must be absolute: ${project.location}`, { projectName: project.name || null });
    return false;
  }
  return true;
}

function inspectValidatedProject(output, rootRealPath, project, label, inspect) {
  try {
    const actual = inspect(project.location);
    if (isSameOrDescendant(actual.realPath, rootRealPath) || isSameOrDescendant(rootRealPath, actual.realPath)) {
      add(output, "error", "PROJECT_OVERLAPS_WORKSPACE", `Project ${label} must not overlap the workspace root: ${actual.realPath}`, { projectName: project.name || null });
    }
    if (project.branch && project.branch !== actual.branch) {
      add(output, "error", "PROJECT_BRANCH_MISMATCH", `Project ${label} registered branch ${project.branch} does not match actual branch ${actual.branch}.`, {
        projectName: project.name || null,
        registeredBranch: project.branch,
        actualBranch: actual.branch,
        location: actual.realPath,
      });
    }
    return actual;
  } catch (error) {
    add(output, "error", "PROJECT_INSPECTION_FAILED", `Project ${label} cannot be inspected: ${error.message}`, {
      projectName: project.name || null,
      location: project.location,
      cause: error.code || error.name,
    });
    return null;
  }
}

function validateProjects(root, config) {
  const output = result();
  if (!validateSchemaAndRegistry(output, config)) return output;
  if (config.projects.length === 0) {
    add(output, "warning", "NO_PROJECTS", "No local projects are configured.");
    return output;
  }

  const rootRealPath = fs.realpathSync(root);
  const names = new Map();
  const inspected = [];

  config.projects.forEach((project, index) => {
    const label = project?.name || `#${index + 1}`;
    if (!validateProjectFields(output, project, label)) return;
    if (project.name) {
      const previous = names.get(project.name);
      if (previous) add(output, "error", "DUPLICATE_PROJECT_NAME", `Duplicate project name: ${project.name}`, {
        projectName: project.name,
        projects: diagnosticProjects(previous, project.name),
      });
      else names.set(project.name, project.name);
    }
    const actual = inspectValidatedProject(output, rootRealPath, project, label, inspectGitWorktree);
    if (actual) {
      inspected.push({ name: label, projectName: project.name || null, realPath: actual.realPath });
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

function validateProject(root, config, name, options = {}) {
  const output = result();
  if (!validateSchemaAndRegistry(output, config)) return output;
  const matches = config.projects
    .map((project, index) => ({ project, index }))
    .filter(({ project }) => project && typeof project === "object" && !Array.isArray(project) && project.name === name);
  if (matches.length === 0) {
    add(output, "error", "PROJECT_NOT_FOUND", `Unknown local project: ${name}`, { projectName: name });
    return output;
  }
  const { project, index } = matches[0];
  const label = project.name || `#${index + 1}`;
  if (!validateProjectFields(output, project, label)) return output;
  if (matches.length > 1) {
    add(output, "error", "DUPLICATE_PROJECT_NAME", `Duplicate project name: ${name}`, {
      projectName: name,
      projects: [name],
    });
  }

  const rootRealPath = fs.realpathSync(root);
  inspectValidatedProject(output, rootRealPath, project, label, options.inspectGitWorktree || inspectGitWorktree);
  const targetPath = path.resolve(project.location);
  config.projects.forEach((other, otherIndex) => {
    if (otherIndex === index || !other || typeof other !== "object" || Array.isArray(other)) return;
    if (typeof other.location !== "string" || !path.isAbsolute(other.location)) return;
    const otherPath = path.resolve(other.location);
    if (targetPath === otherPath) {
      add(output, "error", "DUPLICATE_PROJECT_PATH", `Projects ${label} and ${other.name || `#${otherIndex + 1}`} use the same registered directory: ${targetPath}`, {
        projectName: name,
        projects: diagnosticProjects(name, other.name),
      });
    } else if (isSameOrDescendant(targetPath, otherPath) || isSameOrDescendant(otherPath, targetPath)) {
      add(output, "error", "NESTED_PROJECT_PATH", `Projects ${label} and ${other.name || `#${otherIndex + 1}`} must not be nested.`, {
        projectName: name,
        projects: diagnosticProjects(name, other.name),
      });
    }
  });
  return output;
}

function validateProjectSelection(root, config, names, options = {}) {
  const output = result();
  for (const name of names) {
    const selected = validateProject(root, config, name, options);
    for (const diagnostic of selected.diagnostics) addExistingDiagnostic(output, diagnostic);
  }
  return output;
}

module.exports = {
  isSameOrDescendant,
  validateProject,
  validateProjectSelection,
  validateProjects,
};
