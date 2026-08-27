const fs = require("node:fs");
const path = require("node:path");
const yaml = require("js-yaml");

const { atomicWrite } = require("./fs");
const { WorkspaceError } = require("./errors");
const { LANGUAGE_CODES } = require("../i18n");

const LOCAL_DIRECTORY = ".code-workspace";
const CONFIG_FILE = "config.yaml";
const PROJECT_CONFIG_FILE = "config-projects.yaml";
const PROJECT_CONFIG_VERSION = 1;
const STATE_FILE = "state.json";
const DEFAULT_WORKSPACE_NAME = "code-workspace";
const DEFAULT_MONITOR_URL = "http://127.0.0.1:3211";
const CURRENT_CONFIG_VERSION = 2;
const MINIMUM_READABLE_CONFIG_VERSION = 0;
const CONFIG_RENDER_OPTIONS = Object.freeze({
  lineWidth: -1,
  noRefs: true,
  sortKeys: false,
  styles: { "!!str": "literal" },
});

const CONFIG_MIGRATIONS = new Map([
  [0, (value) => ({ ...value, schemaVersion: 1 })],
  [1, (value) => ({ ...value, schemaVersion: 2 })],
]);

function configPath(root) {
  return path.join(root, LOCAL_DIRECTORY, CONFIG_FILE);
}

function projectConfigPath(root) {
  return path.join(root, LOCAL_DIRECTORY, PROJECT_CONFIG_FILE);
}

function statePath(root) {
  return path.join(root, LOCAL_DIRECTORY, STATE_FILE);
}

function findWorkspaceRoot(start = process.cwd()) {
  let current = path.resolve(start);
  while (true) {
    if (fs.existsSync(configPath(current))) return current;
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

function requireWorkspaceRoot(start = process.cwd()) {
  const root = findWorkspaceRoot(start);
  if (!root) {
    throw new WorkspaceError(
      "WORKSPACE_NOT_FOUND",
      "No local Code Workspace found. Run `code-workspace init` first.",
      { start: path.resolve(start) }
    );
  }
  return root;
}

function normalizeWorkspaceIdentity(value) {
  if (value == null) return null;
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new WorkspaceError("WORKSPACE_IDENTITY_INVALID", "workspace must be an object");
  const name = String(value.name || "").trim();
  const uuid = String(value.uuid || "").trim();
  if (!name || [...name].length > 64 || /[\u0000-\u001f\u007f]/.test(name)) {
    throw new WorkspaceError("WORKSPACE_NAME_INVALID", "workspace.name must contain 1-64 characters without control characters");
  }
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(uuid)) {
    throw new WorkspaceError("WORKSPACE_UUID_INVALID", "workspace.uuid must be a UUID");
  }
  return { ...value, name, uuid };
}

function normalizeWorkspaceLanguage(value, options = {}) {
  const language = String(value || options.defaultLanguage || "").trim();
  if (!LANGUAGE_CODES.includes(language)) {
    const code = language ? "WORKSPACE_LANGUAGE_INVALID" : "WORKSPACE_LANGUAGE_MISSING";
    throw new WorkspaceError(code, `workspace.language must be one of: ${LANGUAGE_CODES.join(", ")}`, {
      actual: language || null,
      supported: LANGUAGE_CODES,
      remediation: `code-w update --language ${LANGUAGE_CODES[0]}`,
    });
  }
  return language;
}

function normalizeWorkspace(value, options = {}) {
  const identity = normalizeWorkspaceIdentity(value);
  if (!identity) return null;
  return { ...identity, language: normalizeWorkspaceLanguage(value.language, options) };
}

function normalizeMonitor(value) {
  const monitor = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const enable = monitor.enable === true;
  const rawUrl = String(monitor.url || DEFAULT_MONITOR_URL);
  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new WorkspaceError("MONITOR_CONFIG_INVALID", "monitor.url must be an absolute URL", { actual: rawUrl });
  }
  if (parsed.protocol !== "http:" || !["127.0.0.1", "localhost", "[::1]"].includes(parsed.hostname)) {
    throw new WorkspaceError("MONITOR_CONFIG_INVALID", "monitor.url must use HTTP and a loopback host", { actual: rawUrl });
  }
  if (parsed.username || parsed.password || parsed.search || parsed.hash || !["", "/"].includes(parsed.pathname)) {
    throw new WorkspaceError("MONITOR_CONFIG_INVALID", "monitor.url must not contain credentials, path, query, or fragment", { actual: rawUrl });
  }
  if (!parsed.port) parsed.port = "3211";
  const port = Number(parsed.port);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new WorkspaceError("MONITOR_CONFIG_INVALID", "monitor.url port must be between 1 and 65535", { actual: rawUrl });
  }
  return { ...monitor, enable, url: parsed.toString().replace(/\/$/, "") };
}

function normalizeProjects(value) {
  if (value == null) return [];
  if (!Array.isArray(value)) throw new WorkspaceError("PROJECT_REGISTRY_INVALID", "projects must be an array");
  return value.map((project) => {
    if (!project || typeof project !== "object" || Array.isArray(project)) return project;
    const { specPrefix: _legacySpecPrefix, ...normalized } = project;
    return normalized;
  });
}

function normalizeProjectReference(value, options = {}) {
  const file = options.file || null;
  if (value == null || (typeof value === "object" && !Array.isArray(value) && !Object.prototype.hasOwnProperty.call(value, "ref"))) {
    throw new WorkspaceError("PROJECT_CONFIG_REFERENCE_MISSING", "projects.ref must reference config-projects.yaml; no project configuration reference was provided", {
      file,
      remediation: "Set projects.ref to config-projects.yaml and move project records into .code-workspace/config-projects.yaml.",
    });
  }
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new WorkspaceError("PROJECT_CONFIG_INLINE_UNSUPPORTED", "projects must reference config-projects.yaml; inline project arrays are not supported", {
      file,
      remediation: "Set projects.ref to config-projects.yaml and move project records into .code-workspace/config-projects.yaml.",
    });
  }
  const ref = String(value.ref || "").trim();
  if (ref !== PROJECT_CONFIG_FILE) {
    throw new WorkspaceError("PROJECT_CONFIG_REFERENCE_INVALID", `projects.ref must be ${PROJECT_CONFIG_FILE}`, {
      file,
      ref: ref || null,
      expected: PROJECT_CONFIG_FILE,
      remediation: `Set projects.ref to ${PROJECT_CONFIG_FILE}.`,
    });
  }
  return { ref: PROJECT_CONFIG_FILE };
}

function readProjectConfigDocument(root) {
  const file = projectConfigPath(root);
  let stat;
  try {
    stat = fs.lstatSync(file);
  } catch (error) {
    if (error.code === "ENOENT") {
      throw new WorkspaceError("PROJECT_CONFIG_FILE_MISSING", `Missing project configuration: ${file}`, {
        file,
        remediation: "Create .code-workspace/config-projects.yaml with schemaVersion: 1 and projects: [].",
      });
    }
    throw new WorkspaceError("PROJECT_CONFIG_FILE_INVALID", `Cannot inspect project configuration ${file}: ${error.message}`, {
      file,
      cause: error.code || error.name,
    });
  }
  if (stat.isSymbolicLink()) {
    throw new WorkspaceError("PROJECT_CONFIG_FILE_INVALID", `Project configuration must be a regular file, not a symbolic link: ${file}`, {
      file,
      kind: "symbolic-link",
      remediation: "Replace the symbolic link with a regular .code-workspace/config-projects.yaml file.",
    });
  }
  if (!stat.isFile()) {
    throw new WorkspaceError("PROJECT_CONFIG_FILE_INVALID", `Project configuration must be a regular file: ${file}`, {
      file,
      kind: stat.isDirectory() ? "directory" : "special-file",
      remediation: "Create .code-workspace/config-projects.yaml as a regular file.",
    });
  }
  let value;
  try {
    value = yaml.load(fs.readFileSync(file, "utf8"));
  } catch (error) {
    if (error instanceof WorkspaceError) throw error;
    if (error.name === "YAMLException") {
      throw new WorkspaceError("PROJECT_CONFIG_FILE_PARSE_FAILED", `Cannot parse project configuration ${file}: ${error.message}`, {
        file,
      });
    }
    throw new WorkspaceError("PROJECT_CONFIG_FILE_INVALID", `Cannot read project configuration ${file}: ${error.message}`, {
      file,
      cause: error.code || error.name,
    });
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new WorkspaceError("PROJECT_CONFIG_FILE_INVALID", `Project configuration must be a YAML object: ${file}`, { file });
  }
  if (value.schemaVersion !== PROJECT_CONFIG_VERSION) {
    throw new WorkspaceError("PROJECT_CONFIG_SCHEMA_UNSUPPORTED", `Project configuration schemaVersion must be ${PROJECT_CONFIG_VERSION}: ${file}`, {
      file,
      version: value.schemaVersion ?? null,
      supported: PROJECT_CONFIG_VERSION,
    });
  }
  if (!Array.isArray(value.projects)) {
    throw new WorkspaceError("PROJECT_CONFIG_FILE_INVALID", `Project configuration projects must be an array: ${file}`, { file });
  }
  return {
    file,
    schemaVersion: PROJECT_CONFIG_VERSION,
    value: {
      ...value,
      projects: normalizeProjects(value.projects),
    },
  };
}

function configVersion(value) {
  const version = value?.schemaVersion ?? 0;
  if (!Number.isInteger(version) || version < MINIMUM_READABLE_CONFIG_VERSION) {
    throw new WorkspaceError("CONFIG_SCHEMA_VERSION_INVALID", `Invalid workspace config schemaVersion: ${version}`, { version });
  }
  if (version > CURRENT_CONFIG_VERSION) {
    throw new WorkspaceError("CONFIG_SCHEMA_VERSION_UNSUPPORTED", `Workspace config schemaVersion ${version} is newer than supported version ${CURRENT_CONFIG_VERSION}`, {
      version,
      supported: CURRENT_CONFIG_VERSION,
    });
  }
  return version;
}

function planConfigMigration(value) {
  const fromVersion = configVersion(value);
  let version = fromVersion;
  let migrated = { ...value };
  const steps = [];
  while (version < CURRENT_CONFIG_VERSION) {
    const migrate = CONFIG_MIGRATIONS.get(version);
    if (!migrate) {
      throw new WorkspaceError("CONFIG_MIGRATION_UNAVAILABLE", `No workspace config migration is registered for schemaVersion ${version}`, {
        version,
        targetVersion: CURRENT_CONFIG_VERSION,
      });
    }
    const next = version + 1;
    migrated = migrate(migrated);
    steps.push({ fromVersion: version, toVersion: next });
    version = next;
  }
  return {
    fromVersion,
    toVersion: CURRENT_CONFIG_VERSION,
    steps,
    changed: steps.length > 0,
    value: migrated,
  };
}

function readConfigDocument(root) {
  const file = configPath(root);
  if (!fs.existsSync(file)) throw new WorkspaceError("LOCAL_CONFIG_MISSING", `Missing local workspace config: ${file}`, { file });
  let value;
  try {
    value = yaml.load(fs.readFileSync(file, "utf8"));
  } catch (error) {
    throw new WorkspaceError("LOCAL_CONFIG_PARSE_FAILED", `Cannot parse local workspace config ${file}: ${error.message}`, { file });
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new WorkspaceError("LOCAL_CONFIG_INVALID", `Local workspace config must be a YAML object: ${file}`, { file });
  }
  return { file, value, schemaVersion: configVersion(value) };
}

function normalizeConfig(value, options = {}) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const migration = planConfigMigration(source);
  const config = migration.value;
  const projects = options.projects !== undefined ? normalizeProjects(options.projects) : normalizeProjects(config.projects);
  return {
    ...config,
    schemaVersion: configVersion(config),
    workspace: normalizeWorkspace(config.workspace, options),
    monitor: normalizeMonitor(config.monitor),
    projects,
  };
}

function loadConfig(root, options = {}) {
  const document = readConfigDocument(root);
  normalizeProjectReference(document.value.projects, { file: document.file });
  const projects = readProjectConfigDocument(root);
  return normalizeConfig(document.value, {
    ...options,
    projects: projects.value.projects,
    projectConfigFile: projects.file,
  });
}

function loadConfigProjection(root, domains, options = {}) {
  const document = readConfigDocument(root);
  const requested = new Set(domains || []);
  if (requested.has("complete")) return loadConfig(root, options);
  const projected = { schemaVersion: CURRENT_CONFIG_VERSION, sourceSchemaVersion: document.schemaVersion };
  const attachFile = (error) => {
    error.details = { ...(error.details || {}), file: document.file };
    throw error;
  };
  if (requested.has("identity")) {
    try {
      projected.workspace = normalizeWorkspaceIdentity(document.value.workspace);
    } catch (error) {
      attachFile(error);
    }
  }
  if (requested.has("language")) {
    try {
      projected.workspace = {
        ...(projected.workspace || {}),
        language: normalizeWorkspaceLanguage(document.value.workspace?.language, options),
      };
    } catch (error) {
      attachFile(error);
    }
  }
  if (requested.has("monitor")) {
    try {
      projected.monitor = normalizeMonitor(document.value.monitor);
    } catch (error) {
      attachFile(error);
    }
  }
  if (requested.has("projects")) {
    try {
      normalizeProjectReference(document.value.projects, { file: document.file });
      const projects = readProjectConfigDocument(root);
      projected.projects = projects.value.projects;
    } catch (error) {
      error.details = { ...(error.details || {}), configFile: document.file };
      throw error;
    }
  }
  return projected;
}

function loadConfigMigrationPlan(root) {
  const document = readConfigDocument(root);
  return { ...planConfigMigration(document.value), file: document.file };
}

function inspectConfigDomains(root, options = {}) {
  let document;
  try {
    document = readConfigDocument(root);
  } catch (error) {
    return {
      file: error.details?.file || configPath(root),
      schemaVersion: null,
      document: { valid: false, value: null, diagnostics: [error] },
      identity: { valid: false, value: null, diagnostics: [] },
      language: { valid: false, value: null, diagnostics: [] },
      monitor: { valid: false, value: null, diagnostics: [] },
      projects: { valid: false, value: null, diagnostics: [] },
    };
  }
  const inspect = (project) => {
    try {
      return { valid: true, value: project(), diagnostics: [] };
    } catch (error) {
      error.details = { ...(error.details || {}), configFile: document.file };
      return { valid: false, value: null, diagnostics: [error] };
    }
  };
  return {
    file: document.file,
    schemaVersion: document.schemaVersion,
    document: { valid: true, value: document.value, diagnostics: [] },
    identity: inspect(() => normalizeWorkspaceIdentity(document.value.workspace)),
    language: inspect(() => normalizeWorkspaceLanguage(document.value.workspace?.language, options)),
    monitor: inspect(() => normalizeMonitor(document.value.monitor)),
    projects: inspect(() => {
      normalizeProjectReference(document.value.projects, { file: document.file });
      const projectDocument = readProjectConfigDocument(root);
      return projectDocument.value.projects;
    }),
  };
}

function renderConfigDocument(value) {
  return yaml.dump(value, CONFIG_RENDER_OPTIONS);
}

function renderConfig(config) {
  const normalized = normalizeConfig(config);
  const { projectReference: _projectReference, ...withoutProjectReference } = normalized;
  return renderConfigDocument({
    ...withoutProjectReference,
    projects: { ref: PROJECT_CONFIG_FILE },
  });
}

function renderProjectConfig(projects) {
  return renderConfigDocument({ schemaVersion: PROJECT_CONFIG_VERSION, projects: normalizeProjects(projects) });
}

function saveConfig(root, config) {
  const normalized = normalizeConfig(config);
  saveProjectConfig(root, normalized.projects);
  atomicWrite(configPath(root), renderConfig(normalized));
}

function saveProjectConfig(root, projects) {
  atomicWrite(projectConfigPath(root), renderProjectConfig(projects));
}

function updateProjectBranch(root, update, options = {}) {
  const document = (options.readConfigDocument || readConfigDocument)(root);
  normalizeProjectReference(document.value.projects, { file: document.file });
  const projectDocument = (options.readProjectConfigDocument || readProjectConfigDocument)(root);
  const sourceProjects = projectDocument.value.projects;
  const sourceProject = sourceProjects.find((project) => project?.name === update.name);
  if (!sourceProject || sourceProject.branch !== update.before.registeredBranch) {
    throw new WorkspaceError(
      "PROJECT_BRANCH_ACCEPT_CONFLICT",
      `Registered branch changed while preparing to accept the actual branch for ${update.name}.`,
      {
        project: update.name,
        expectedState: update.before,
        observedState: {
          registeredBranch: sourceProject?.branch || null,
          actualBranch: update.before.actualBranch,
        },
      }
    );
  }
  const project = { ...sourceProject, branch: update.after.registeredBranch };
  const nextDocument = {
    ...projectDocument.value,
    projects: sourceProjects.map((entry) => entry?.name === update.name ? project : entry),
  };
  (options.atomicWrite || atomicWrite)(projectConfigPath(root), renderProjectConfig(nextDocument.projects));
  return project;
}

function loadState(root) {
  const file = statePath(root);
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function saveState(root, state) {
  atomicWrite(statePath(root), `${JSON.stringify(state, null, 2)}\n`);
}

function ensureLocalIgnore(root) {
  const file = path.join(root, ".gitignore");
  const current = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
  const lines = current.split(/\r?\n/);
  const ignored = lines.some((line) => {
    const value = line.trim();
    return value === LOCAL_DIRECTORY || value === `${LOCAL_DIRECTORY}/` || value === `/${LOCAL_DIRECTORY}/`;
  });
  if (ignored) return "skip";
  const prefix = current && !current.endsWith("\n") ? "\n" : "";
  atomicWrite(file, `${current}${prefix}\n# Code Workspace local configuration\n/${LOCAL_DIRECTORY}/\n`);
  return "write";
}

module.exports = {
  CONFIG_FILE,
  PROJECT_CONFIG_FILE,
  PROJECT_CONFIG_VERSION,
  CURRENT_CONFIG_VERSION,
  DEFAULT_MONITOR_URL,
  DEFAULT_WORKSPACE_NAME,
  LOCAL_DIRECTORY,
  MINIMUM_READABLE_CONFIG_VERSION,
  CONFIG_MIGRATIONS,
  STATE_FILE,
  configPath,
  ensureLocalIgnore,
  findWorkspaceRoot,
  loadConfig,
  inspectConfigDomains,
  loadConfigMigrationPlan,
  loadConfigProjection,
  loadState,
  normalizeConfig,
  normalizeMonitor,
  normalizeProjects,
  normalizeProjectReference,
  normalizeWorkspace,
  normalizeWorkspaceIdentity,
  normalizeWorkspaceLanguage,
  planConfigMigration,
  readConfigDocument,
  renderConfig,
  renderConfigDocument,
  renderProjectConfig,
  requireWorkspaceRoot,
  saveConfig,
  saveProjectConfig,
  readProjectConfigDocument,
  projectConfigPath,
  saveState,
  statePath,
  updateProjectBranch,
};
