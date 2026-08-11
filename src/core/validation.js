const fs = require("node:fs");
const path = require("node:path");

const { add, result } = require("./diagnostics");
const { CURRENT_CONFIG_VERSION } = require("./config");
const { inspectGitWorktree } = require("./project");
const {
  parseAffectedProjects,
  parseProposalCapabilities,
  parseTaskProjects,
} = require("./markdown");

const SPEC_PREFIX = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
const CAPABILITY = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

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

function mergeDiagnostics(output, source) {
  for (const diagnostic of source.diagnostics) addExistingDiagnostic(output, diagnostic);
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
  const prefixes = new Map();
  const inspected = [];

  config.projects.forEach((project, index) => {
    const label = project?.name || `#${index + 1}`;
    if (!project || typeof project !== "object" || Array.isArray(project)) {
      add(output, "error", "PROJECT_NOT_OBJECT", `Project ${label} must be a mapping.`);
      return;
    }
    for (const field of ["name", "specPrefix", "location", "branch", "type", "context"]) {
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
    if (project.specPrefix) {
      if (!SPEC_PREFIX.test(project.specPrefix)) {
        add(output, "error", "INVALID_SPEC_PREFIX", `Project ${label} specPrefix must be kebab-case: ${project.specPrefix}`, { projectName: project.name || null });
      }
      const previous = prefixes.get(project.specPrefix);
      if (previous) {
        previous.projects.push(project.name || null);
        add(output, "error", "DUPLICATE_SPEC_PREFIX", `Duplicate project specPrefix: ${project.specPrefix}`, {
          projectName: project.name || null,
          projects: diagnosticProjects(previous.projects),
        });
      } else {
        prefixes.set(project.specPrefix, { label, projects: [project.name || null] });
      }
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

  const prefixEntries = [...prefixes.entries()];
  for (let left = 0; left < prefixEntries.length; left += 1) {
    for (let right = left + 1; right < prefixEntries.length; right += 1) {
      const [a, aOwner] = prefixEntries[left];
      const [b, bOwner] = prefixEntries[right];
      if (a.startsWith(`${b}-`) || b.startsWith(`${a}-`)) {
        add(output, "error", "OVERLAPPING_SPEC_PREFIX", `Project specPrefix namespaces overlap: ${aOwner.label} (${a}) and ${bOwner.label} (${b})`, {
          projects: diagnosticProjects(aOwner.projects, bOwner.projects),
        });
      }
    }
  }

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

function listSpecIds(directory) {
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && fs.existsSync(path.join(directory, entry.name, "spec.md")))
    .map((entry) => entry.name)
    .sort();
}

function validateSpecOwnership(root, projects, output) {
  for (const specId of listSpecIds(path.join(root, "openspec", "specs"))) {
    const matches = projects.filter((project) => specId.startsWith(`${project.specPrefix}-`));
    if (matches.length === 0) add(output, "error", "UNKNOWN_SPEC_OWNER", `Main spec has unknown project prefix: ${specId}`, { specId });
    else if (matches.length > 1) add(output, "error", "AMBIGUOUS_SPEC_OWNER", `Main spec matches multiple project prefixes: ${specId}`, {
      specId,
      projects: diagnosticProjects(matches.map((project) => project.name)),
    });
  }
}

function validateChangeMainSpecs(root, projects, capabilities, deltaIds, output) {
  const declaredOwners = new Map(capabilities.map((capability) => [capability.id, capability.project]));
  for (const specId of deltaIds) {
    const file = path.join(root, "openspec", "specs", specId, "spec.md");
    if (!fs.existsSync(file)) {
      add(output, "error", "MAIN_SPEC_MISSING_AFTER_SYNC", `Synchronized main spec is missing for change capability: ${specId}`, {
        specId,
        file,
      });
      continue;
    }
    const matches = projects.filter((project) => typeof project?.specPrefix === "string" && specId.startsWith(`${project.specPrefix}-`));
    if (matches.length === 0) {
      add(output, "error", "UNKNOWN_SPEC_OWNER", `Synchronized main spec has unknown project prefix: ${specId}`, { specId, file });
    } else if (matches.length > 1) {
      add(output, "error", "AMBIGUOUS_SPEC_OWNER", `Synchronized main spec matches multiple project prefixes: ${specId}`, {
        specId,
        file,
        projects: diagnosticProjects(matches.map((project) => project.name)),
      });
    } else if (declaredOwners.get(specId) && matches[0].name !== declaredOwners.get(specId)) {
      add(output, "error", "MAIN_SPEC_OWNER_MISMATCH", `Synchronized main spec owner does not match the change declaration: ${specId}`, {
        specId,
        file,
        projectName: declaredOwners.get(specId),
        actualProjectName: matches[0].name,
      });
    }
  }
}

function validateChange(root, config, changeName, options = {}) {
  const output = result();
  if (!changeName) {
    add(output, "error", "CHANGE_REQUIRED", "Missing required change name.");
    return output;
  }
  const changeRoot = path.join(root, "openspec", "changes", changeName);
  const proposal = path.join(changeRoot, "proposal.md");
  const tasks = path.join(changeRoot, "tasks.md");
  if (!fs.existsSync(changeRoot)) {
    add(output, "error", "CHANGE_NOT_FOUND", `Change does not exist: ${changeName}`);
    return output;
  }
  if (!fs.existsSync(proposal)) add(output, "error", "PROPOSAL_MISSING", `Change ${changeName} has no proposal.md.`);
  if (!fs.existsSync(tasks)) add(output, "error", "TASKS_MISSING", `Change ${changeName} has no tasks.md.`);

  const affected = parseAffectedProjects(proposal);
  const taskProjects = parseTaskProjects(tasks);
  const participantNames = diagnosticProjects(affected, taskProjects);
  mergeDiagnostics(output, validateProjectSelection(root, config, participantNames));
  const projects = Array.isArray(config.projects) ? config.projects : [];
  const names = new Set(projects.map((project) => project?.name).filter(Boolean));
  if (fs.existsSync(proposal) && affected.length === 0) add(output, "error", "AFFECTED_PROJECTS_MISSING", `Change ${changeName} must declare at least one Affected Project.`);
  if (fs.existsSync(tasks) && taskProjects.length === 0) add(output, "error", "PROJECT_TASK_GROUPS_MISSING", `Change ${changeName} must contain at least one project task group.`);
  for (const name of affected) if (!names.has(name)) add(output, "error", "UNKNOWN_AFFECTED_PROJECT", `Change ${changeName} proposal references unknown local project: ${name}`);
  for (const name of taskProjects) if (!names.has(name)) add(output, "error", "UNKNOWN_TASK_PROJECT", `Change ${changeName} tasks reference unknown local project: ${name}`);
  for (const name of affected.filter((name) => !taskProjects.includes(name))) add(output, "error", "AFFECTED_PROJECT_WITHOUT_TASKS", `Change ${changeName} affected project is missing a task group: ${name}`);
  for (const name of taskProjects.filter((name) => !affected.includes(name))) add(output, "error", "TASK_PROJECT_NOT_AFFECTED", `Change ${changeName} task group is missing from Affected Projects: ${name}`);

  const capabilities = parseProposalCapabilities(proposal);
  for (const line of capabilities.invalidLines) add(output, "error", "INVALID_CAPABILITY_ENTRY", `Change ${changeName} has invalid capability entry: ${line}`);
  const byName = new Map(projects.map((project) => [project.name, project]));
  const declared = new Set();
  for (const capability of capabilities.entries) {
    if (declared.has(capability.id)) add(output, "error", "DUPLICATE_CAPABILITY", `Change ${changeName} declares capability more than once: ${capability.id}`);
    declared.add(capability.id);
    const project = byName.get(capability.project);
    if (!project) continue;
    const prefix = `${project.specPrefix}-`;
    const local = capability.id.startsWith(prefix) ? capability.id.slice(prefix.length) : "";
    if (!local || !CAPABILITY.test(local)) add(output, "error", "CAPABILITY_PREFIX_MISMATCH", `Capability ${capability.id} must use project ${project.name} prefix ${prefix}`);
    if (!affected.includes(project.name)) add(output, "error", "CAPABILITY_PROJECT_NOT_AFFECTED", `Capability ${capability.id} belongs to a project not listed in Affected Projects: ${project.name}`);
  }
  const deltaIds = listSpecIds(path.join(changeRoot, "specs"));
  for (const id of declared) if (!deltaIds.includes(id)) add(output, "error", "DELTA_SPEC_MISSING", `Change ${changeName} capability is missing delta spec: ${id}`);
  for (const id of deltaIds) if (!declared.has(id)) add(output, "error", "UNDECLARED_DELTA_SPEC", `Change ${changeName} has undeclared delta spec: ${id}`);
  if (options.requireMainSpecs === true) validateChangeMainSpecs(root, projects, capabilities.entries, deltaIds, output);
  return output;
}

function listChanges(root) {
  const directory = path.join(root, "openspec", "changes");
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((name) => name !== "archive")
    .sort();
}

function validateWorkspace(root, config) {
  const output = validateProjects(root, config);
  if (output.errors.length > 0) return output;
  validateSpecOwnership(root, config.projects, output);
  for (const changeName of listChanges(root)) {
    const change = validateChange(root, config, changeName);
    output.errors.push(...change.errors.filter((message) => !output.errors.includes(message)));
    output.warnings.push(...change.warnings.filter((message) => !output.warnings.includes(message)));
    output.diagnostics.push(...change.diagnostics.filter((entry) => !output.diagnostics.some((current) => current.code === entry.code && current.message === entry.message)));
  }
  return output;
}

module.exports = {
  isSameOrDescendant,
  listChanges,
  validateChange,
  validateChangeMainSpecs,
  validateProject,
  validateProjectSelection,
  validateProjects,
  validateSpecOwnership,
  validateWorkspace,
};
