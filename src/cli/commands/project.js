const fs = require("node:fs");
const path = require("node:path");
const yaml = require("js-yaml");

const { WorkspaceError } = require("../../core/errors");
const { formatPermissionPlan, planPermissionChanges } = require("../../core/permissions");
const { inspectGitWorktree, inspectProject } = require("../../core/project");
const { applyProjectConfiguration, projectPermissionTools } = require("../../core/project-configuration");
const { validateProject, validateProjects } = require("../../core/validation");
const { confirm } = require("../confirmation");
const { fromDiagnostics, selectionResult, success } = require("../result");

const PROJECT_FIELDS = ["name", "location", "branch", "type", "context"];

function projectError(code, message, details = {}) {
  return new WorkspaceError(code, message, details);
}

function assertNoProjectConflict(config, project) {
  const conflict = config.projects.find((current) =>
    current.name === project.name || path.resolve(current.location) === project.location
  );
  if (!conflict) return;
  if (PROJECT_FIELDS.every((field) => conflict[field] === project[field])) return "skip";
  throw projectError("PROJECT_CONFLICT", `Project conflicts with existing local entry: ${conflict.name}`, { project: project.name, conflict: conflict.name });
}

function readJsonFile(input, label) {
  const file = path.resolve(input);
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (error) {
    throw projectError("PROJECT_INPUT_READ_FAILED", `Cannot read ${label} ${file}: ${error.message}`, { file });
  }
}

function readTextFile(input, label) {
  const file = path.resolve(input);
  try {
    return fs.readFileSync(file, "utf8").trim();
  } catch (error) {
    throw projectError("PROJECT_INPUT_READ_FAILED", `Cannot read ${label} ${file}: ${error.message}`, { file });
  }
}

function normalizeProjectRecord(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw projectError("PROJECT_INPUT_INVALID", "Project input must be a JSON object.");
  }
  const unknown = Object.keys(value).filter((field) => !PROJECT_FIELDS.includes(field));
  if (unknown.length > 0) throw projectError("PROJECT_INPUT_UNKNOWN_FIELD", `Project input contains unknown fields: ${unknown.join(", ")}`, { fields: unknown });
  const project = {};
  for (const field of PROJECT_FIELDS) {
    if (typeof value[field] !== "string" || !value[field].trim()) {
      throw projectError("PROJECT_INPUT_FIELD_REQUIRED", `Project input requires a non-empty ${field}.`, { field });
    }
    project[field] = value[field].trim();
  }
  if (!path.isAbsolute(project.location)) {
    throw projectError("PROJECT_LOCATION_NOT_ABSOLUTE", `Project location must be absolute: ${project.location}`, { location: project.location });
  }
  const actual = inspectGitWorktree(project.location);
  if (project.branch !== actual.branch) {
    throw projectError("PROJECT_BRANCH_MISMATCH", `Project ${project.name} registered branch ${project.branch} does not match actual branch ${actual.branch}.`, {
      project: project.name,
      registeredBranch: project.branch,
      actualBranch: actual.branch,
      location: actual.realPath,
    });
  }
  project.location = actual.realPath;
  return project;
}

function projectRecordsFromInput(args, options) {
  if (options["project-file"] && options["projects-file"]) {
    throw projectError("PROJECT_INPUT_MODE_CONFLICT", "Use only one of --project-file or --projects-file.");
  }
  if (options["project-file"]) {
    if (args.length > 0) throw projectError("PROJECT_INPUT_MODE_CONFLICT", "project add does not accept a path with --project-file.");
    const input = readJsonFile(options["project-file"], "--project-file");
    if (input.schemaVersion != null && input.schemaVersion !== 1) {
      throw projectError("PROJECT_INPUT_SCHEMA_UNSUPPORTED", `Unsupported project input schemaVersion: ${input.schemaVersion}`, { version: input.schemaVersion });
    }
    const project = input.project || (input.schemaVersion == null ? input : Object.fromEntries(
      Object.entries(input).filter(([field]) => field !== "schemaVersion")
    ));
    return [normalizeProjectRecord(project)];
  }
  if (options["projects-file"]) {
    if (args.length > 0) throw projectError("PROJECT_INPUT_MODE_CONFLICT", "project add does not accept paths with --projects-file.");
    const input = readJsonFile(options["projects-file"], "--projects-file");
    if (input.schemaVersion != null && input.schemaVersion !== 1) {
      throw projectError("PROJECT_INPUT_SCHEMA_UNSUPPORTED", `Unsupported projects input schemaVersion: ${input.schemaVersion}`, { version: input.schemaVersion });
    }
    const projects = Array.isArray(input) ? input : input.projects;
    if (!Array.isArray(projects) || projects.length === 0) {
      throw projectError("PROJECT_INPUT_INVALID", "--projects-file must contain a non-empty projects array.");
    }
    return projects.map(normalizeProjectRecord);
  }
  const location = args[0];
  if (!location) throw projectError("PROJECT_PATH_REQUIRED", "project add requires a project path or project JSON file.");
  if (options.context && options["context-file"]) throw projectError("PROJECT_INPUT_MODE_CONFLICT", "Use only one of --context or --context-file.");
  const context = options["context-file"] ? readTextFile(options["context-file"], "--context-file") : options.context;
  const actual = inspectGitWorktree(location);
  return [normalizeProjectRecord({
    name: options.name,
    location: actual.realPath,
    branch: actual.branch,
    type: options.type,
    context,
  })];
}

function verifyProjectSelection(root, config, requested) {
  const names = [];
  const seen = new Set();
  const diagnostics = [];
  for (const name of requested) {
    if (!seen.has(name)) {
      seen.add(name);
      names.push(name);
    } else {
      diagnostics.push({
        code: "CLI_DUPLICATE_ARGUMENT",
        severity: "warning",
        message: `Project ${name} was provided more than once; later occurrences were ignored.`,
        project: name,
        argument: "name",
      });
    }
  }
  const results = names.map((name) => {
    const project = config.projects.find((entry) => entry?.name === name) || null;
    const output = validateProject(root, config, name);
    diagnostics.push(...output.diagnostics.map((entry) => ({
      ...entry,
      project: entry.project || entry.projectName || name,
    })));
    const ok = output.errors.length === 0;
    return {
      project: name,
      ok,
      action: ok ? "verify" : "failed",
      data: project ? { project } : null,
      message: ok ? "verification passed" : output.errors[0] || "verification failed",
    };
  });
  const succeeded = results.filter((entry) => entry.ok).length;
  const failed = results.length - succeeded;
  const text = [
    ...results.map((entry) => `${entry.ok ? "OK" : "FAILED"}\t${entry.project}\t${entry.message}`),
    `Summary\ttotal=${results.length}\tsucceeded=${succeeded}\tskipped=0\tfailed=${failed}`,
  ].join("\n");
  return selectionResult("project.verify", requested, results, { diagnostics, text });
}

async function executeProject(invocation) {
  const { args, config, options, root } = invocation;
  const action = invocation.definition.path[1];
  const command = `project.${action}`;
  if (action === "inspect") {
    const inspection = inspectProject(args[0]);
    return success(command, { kind: "project-inspection", project: inspection }, yaml.dump(inspection, { lineWidth: -1, noRefs: true, sortKeys: false }));
  }
  if (action === "list") {
    const text = config.projects.length === 0
      ? "No local projects configured."
      : config.projects.map((project) => `${project.name}\t${project.type}\t${project.branch}\t${project.location}`).join("\n");
    return success(command, { projects: config.projects }, text);
  }
  if (action === "show") {
    const name = options.name || args[0];
    const project = config.projects.find((entry) => entry.name === name);
    if (!project) throw projectError("PROJECT_NOT_FOUND", `Unknown local project: ${name || "<missing>"}`, { project: name || null });
    return success(command, { project }, yaml.dump(project, { lineWidth: -1, noRefs: true, sortKeys: false, styles: { "!!str": "literal" } }));
  }
  if (action === "verify") {
    if (args.length === 0) {
      const output = validateProjects(root, config);
      return fromDiagnostics(command, output, {
        scope: "workspace",
        project: null,
        projects: config.projects,
      }, "Local projects verification passed.");
    }
    if (args.length > 1) return verifyProjectSelection(root, config, args);
    const name = args[0];
    const project = config.projects.find((entry) => entry?.name === name);
    if (!project) throw projectError("PROJECT_NOT_FOUND", `Unknown local project: ${name}`, { project: name });
    const output = validateProject(root, config, name);
    return fromDiagnostics(command, output, {
      scope: "project",
      project,
      projects: [project],
    }, `Local project verification passed: ${name}.`);
  }
  if (action === "add") {
    const candidates = projectRecordsFromInput(args, options);
    const additions = [];
    const skipped = [];
    const planned = [...config.projects];
    for (const project of candidates) {
      const status = assertNoProjectConflict(config, project);
      if (status === "skip") skipped.push(project);
      else {
        additions.push(project);
        planned.push(project);
      }
    }
    if (additions.length === 0) {
      return success(command, { action: "skip", project: skipped.length === 1 ? skipped[0] : null, projects: [], skipped, permissions: null },
        skipped.map((project) => `Project already current: ${project.name}`).join("\n"));
    }
    const next = { ...config, projects: planned };
    const output = validateProjects(root, next);
    if (output.errors.length > 0) return fromDiagnostics(command, output, { projects: additions, skipped });
    const toolSelection = projectPermissionTools(root, options);
    const permissionPlan = planPermissionChanges({
      root,
      tools: toolSelection.tools,
      grants: additions.map((project) => project.location),
    }, options.dependencies);
    const names = additions.map((project) => project.name).join(", ");
    if (!(await confirm(`Add local project${additions.length === 1 ? "" : "s"} ${names}?\n${formatPermissionPlan(permissionPlan)}`, options))) {
      throw projectError("CLI_CANCELLED", "Project addition cancelled.");
    }
    const permissions = applyProjectConfiguration(root, next, permissionPlan, options.dependencies);
    return success(command, { action: "add", project: additions.length === 1 ? additions[0] : null, projects: additions, skipped, permissions, toolSelection },
      [...additions.map((project) => `Added local project: ${project.name}`), ...skipped.map((project) => `Project already current: ${project.name}`)].join("\n"));
  }
  if (action === "remove") {
    const name = args[0];
    const existing = config.projects.find((entry) => entry.name === name);
    if (!existing) throw projectError("PROJECT_NOT_FOUND", `Unknown local project: ${name}`, { project: name });
    const next = { ...config, projects: config.projects.filter((entry) => entry.name !== name) };
    const toolSelection = projectPermissionTools(root, options);
    const permissionPlan = planPermissionChanges({
      root,
      tools: toolSelection.tools,
      revokes: [existing.location],
    }, options.dependencies);
    if (!(await confirm(`Remove local project ${name}?\n${formatPermissionPlan(permissionPlan)}`, options))) throw projectError("CLI_CANCELLED", "Project removal cancelled.");
    const permissions = applyProjectConfiguration(root, next, permissionPlan, options.dependencies);
    return success(command, { action: "remove", project: existing, permissions, toolSelection }, `Removed local project: ${name}`);
  }
  throw projectError("CLI_UNKNOWN_COMMAND", `Unknown project command: ${action || "<missing>"}`);
}

module.exports = {
  PROJECT_FIELDS,
  applyProjectConfiguration,
  executeProject,
  normalizeProjectRecord,
  projectRecordsFromInput,
  projectPermissionTools,
  verifyProjectSelection,
};
