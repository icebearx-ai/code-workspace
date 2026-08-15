const { loadConfigProjection, requireWorkspaceRoot } = require("./core/config");
const { normalizeTools } = require("./core/tools");
const { WorkspaceError } = require("./core/errors");
const { parse } = require("./cli/parser");
const { failure } = require("./cli/result");
const { executeCompletion } = require("./cli/commands/completion");
const { executeHelp, executeVersion } = require("./cli/commands/help");
const { executeInit } = require("./cli/commands/init");
const { executeMonitor, readStdinJson } = require("./cli/commands/monitor");
const { executePermissions } = require("./cli/commands/permissions");
const { executeProject } = require("./cli/commands/project");
const { executeProjectBranch } = require("./cli/commands/project-branch");
const { executeUpdate, updateWorkspace } = require("./cli/commands/update");
const {
  executeDoctor,
  executeLanguage,
} = require("./cli/commands/workspace");

async function dispatch(invocation) {
  const key = invocation.definition.path.join(" ");
  if (key === "init") return executeInit(invocation);
  if (key === "monitor" || key === "monitor report") return executeMonitor(invocation);
  if (key.startsWith("project branch ")) return executeProjectBranch(invocation);
  if (key.startsWith("project ")) return executeProject(invocation);
  if (key === "update") return executeUpdate(invocation);
  if (key === "language") return executeLanguage(invocation);
  if (key === "permissions apply") return executePermissions(invocation);
  if (key === "doctor") return executeDoctor(invocation);
  if (key === "completion") return executeCompletion(invocation);
  if (key === "help") return executeHelp();
  if (key === "version") return executeVersion();
  throw Object.assign(new Error(`No handler is registered for command: ${key}`), { code: "CLI_HANDLER_MISSING" });
}

async function main(argv) {
  let command = null;
  try {
    const parsed = parse(argv);
    command = parsed.command?.path || null;
    if (parsed.options.version || parsed.command?.path[0] === "version") return executeVersion();
    if (parsed.options.help || !parsed.command || parsed.command.path[0] === "help") return executeHelp();
    const root = parsed.command.workspace === "required" ? requireWorkspaceRoot(process.cwd()) : process.cwd();
    const config = parsed.command.config.length > 0 && parsed.command.path[0] !== "doctor"
      ? loadConfigProjection(root, parsed.command.config)
      : null;
    return await dispatch({
      definition: parsed.command,
      args: parsed.args,
      options: parsed.options,
      root,
      config,
    });
  } catch (error) {
    if (error.code !== "CLI_UNKNOWN_COMMAND") command ||= error.details?.command || null;
    if (!error.code && command) {
      const commandText = Array.isArray(command) ? command.join("_") : String(command).replace(/\./g, "_");
      const code = `${commandText.replace(/[^a-z0-9_]/gi, "_").toUpperCase()}_FAILED`;
      error = new WorkspaceError(code, error.message, { cause: error.name });
    }
    return failure(error, command);
  }
}

function toolsOption(value) {
  return value === undefined ? ["claude", "codex"] : normalizeTools(value, "cli");
}

async function monitorCommand(action, options = {}) {
  return executeMonitor({ definition: { path: action ? ["monitor", action] : ["monitor"] }, options });
}

module.exports = { dispatch, main, monitorCommand, parse, readStdinJson, toolsOption, updateWorkspace };
