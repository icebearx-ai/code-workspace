const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { atomicWrite } = require("./fs");
const { WorkspaceError } = require("./errors");

const USER_CONFIG_SCHEMA_VERSION = 1;
const USER_CONFIG_DIRECTORY = ".code-workspace";
const USER_CONFIG_FILE = "config.json";

function userConfigPath(options = {}) {
  if (options.file) return path.resolve(String(options.file));
  const environment = options.environment || process.env;
  if (environment.CODE_WORKSPACE_CONFIG) return path.resolve(environment.CODE_WORKSPACE_CONFIG);
  const home = options.home || os.homedir();
  return path.join(home, USER_CONFIG_DIRECTORY, USER_CONFIG_FILE);
}

function emptyUserConfig() {
  return { schemaVersion: USER_CONFIG_SCHEMA_VERSION };
}

function readUserConfig(options = {}) {
  const file = userConfigPath(options);
  let stat;
  try {
    stat = fs.lstatSync(file);
  } catch (error) {
    if (error.code === "ENOENT") return { file, exists: false, value: emptyUserConfig() };
    throw new WorkspaceError("USER_CONFIG_READ_FAILED", `Cannot inspect user configuration: ${error.message}`, { file, cause: error.code || error.name });
  }
  if (stat.isSymbolicLink() || !stat.isFile()) {
    throw new WorkspaceError("USER_CONFIG_INVALID", "User configuration must be a regular file", {
      file,
      kind: stat.isSymbolicLink() ? "symbolic-link" : stat.isDirectory() ? "directory" : "special-file",
    });
  }
  let value;
  try {
    value = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (error) {
    throw new WorkspaceError("USER_CONFIG_PARSE_FAILED", `Cannot parse user configuration: ${error.message}`, { file });
  }
  if (!value || typeof value !== "object" || Array.isArray(value) || value.schemaVersion !== USER_CONFIG_SCHEMA_VERSION) {
    throw new WorkspaceError("USER_CONFIG_INVALID", `User configuration schemaVersion must be ${USER_CONFIG_SCHEMA_VERSION}`, {
      file,
      version: value?.schemaVersion ?? null,
      supported: USER_CONFIG_SCHEMA_VERSION,
    });
  }
  return { file, exists: true, value };
}

function updateUserConfig(mutator, options = {}) {
  const current = readUserConfig(options);
  const next = mutator(structuredClone(current.value));
  if (!next || typeof next !== "object" || Array.isArray(next) || next.schemaVersion !== USER_CONFIG_SCHEMA_VERSION) {
    throw new WorkspaceError("USER_CONFIG_INVALID", "User configuration mutation returned an invalid document", { file: current.file });
  }
  const content = `${JSON.stringify(next, null, 2)}\n`;
  try {
    atomicWrite(current.file, content);
    const persisted = readUserConfig(options);
    if (JSON.stringify(persisted.value) !== JSON.stringify(next)) {
      throw new WorkspaceError("USER_CONFIG_POSTCONDITION_FAILED", "User configuration did not persist the requested state", { file: current.file });
    }
    return persisted;
  } catch (error) {
    try {
      if (current.exists) atomicWrite(current.file, `${JSON.stringify(current.value, null, 2)}\n`);
      else if (fs.existsSync(current.file)) fs.unlinkSync(current.file);
    } catch (rollbackError) {
      throw new WorkspaceError("USER_CONFIG_ROLLBACK_FAILED", `User configuration update failed and rollback failed: ${rollbackError.message}`, {
        file: current.file,
        cause: error.code || error.name,
      });
    }
    throw error;
  }
}

module.exports = {
  USER_CONFIG_DIRECTORY,
  USER_CONFIG_FILE,
  USER_CONFIG_SCHEMA_VERSION,
  readUserConfig,
  updateUserConfig,
  userConfigPath,
};
