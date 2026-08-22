const GLOBAL_OPTIONS = {
  help: { type: "boolean" },
  version: { type: "boolean" },
  json: { type: "boolean" },
};

const COMMAND_SUMMARIES = {
  init: "Initialize workspace (path defaults to current directory)",
  monitor: "Run the global multi-workspace Agent monitor",
  update: "Update Workspace-owned managed assets",
  language: "Print the workspace language",
  "project inspect": "Inspect a Git project without writing files",
  "project add": "Register a project (low-level skill command)",
  "project remove": "Remove a local project",
  "project branch inspect": "Inspect selected projects' registered and actual branches",
  "project branch verify": "Verify selected projects' registered and actual branches match",
  "project branch accept-actual": "Update selected registered branches from actual branches",
  "project branch use-registered": "Switch selected project worktrees to registered branches",
  "project branch update-latest": "Update selected enabled project branches to their latest upstream commits",
  "project list": "List local projects",
  "project show": "Show one local project",
  "project verify": "Validate all local projects or selected projects",
  "permissions apply": "Apply registered project directory authorization",
  doctor: "Report workspace health",
  completion: "Print shell completion script",
};

const COMMANDS = [
  { path: ["init"], args: [{ name: "path", required: false }], workspace: "target", config: [], interaction: "optional", effects: "planned-write", options: {
    tools: { type: "string" }, "workspace-name": { type: "string" }, language: { type: "string" },
    monitor: { type: "boolean" }, "no-monitor": { type: "boolean" }, "monitor-url": { type: "string" }, yes: { type: "boolean" }, force: { type: "boolean" },
  } },
  { path: ["monitor"], args: [], workspace: "none", config: [], interaction: "never", effects: "external", options: { port: { type: "string", aliases: ["p"] } } },
  { path: ["monitor", "report"], args: [], workspace: "optional", config: ["identity", "monitor"], interaction: "never", effects: "external", options: {} },
  { path: ["update"], args: [], workspace: "required", config: [], interaction: "optional", effects: "planned-write", options: {
    tools: { type: "string" }, language: { type: "string" }, force: { type: "boolean" },
  } },
  { path: ["language"], args: [], workspace: "required", config: ["language"], interaction: "never", effects: "read-only", options: {} },
  { path: ["project", "inspect"], args: [{ name: "path", required: true }], workspace: "none", config: [], interaction: "never", effects: "read-only", options: {} },
  { path: ["project", "add"], args: [{ name: "path", required: false }], workspace: "required", config: ["complete"], interaction: "required", effects: "planned-write", options: {
    "project-file": { type: "string" }, "projects-file": { type: "string" }, name: { type: "string" }, type: { type: "string" },
    context: { type: "string" }, "context-file": { type: "string" }, yes: { type: "boolean" },
  } },
  { path: ["project", "remove"], args: [{ name: "name", required: true }], workspace: "required", config: ["complete"], interaction: "required", effects: "planned-write", options: { yes: { type: "boolean" } } },
  { path: ["project", "branch", "inspect"], args: [{ name: "name", required: true, variadic: true }], workspace: "required", config: ["projects"], interaction: "never", effects: "read-only", options: {} },
  { path: ["project", "branch", "verify"], args: [{ name: "name", required: true, variadic: true }], workspace: "required", config: ["projects"], interaction: "never", effects: "read-only", options: {} },
  { path: ["project", "branch", "accept-actual"], args: [{ name: "name", required: true, variadic: true }], workspace: "required", config: ["projects"], interaction: "required", effects: "planned-write", options: { yes: { type: "boolean" } } },
  { path: ["project", "branch", "use-registered"], args: [{ name: "name", required: true, variadic: true }], workspace: "required", config: ["projects"], interaction: "required", effects: "external", options: { yes: { type: "boolean" } } },
  { path: ["project", "branch", "update-latest"], args: [{ name: "name", required: true, variadic: true }], workspace: "required", config: ["projects"], interaction: "never", effects: "external", options: {} },
  { path: ["project", "list"], args: [], workspace: "required", config: ["projects"], interaction: "never", effects: "read-only", options: {} },
  { path: ["project", "show"], args: [{ name: "name", required: false }], workspace: "required", config: ["projects"], interaction: "never", effects: "read-only", options: { name: { type: "string" } } },
  { path: ["project", "verify"], args: [{ name: "name", required: false, variadic: true }], workspace: "required", config: ["projects"], interaction: "never", effects: "read-only", options: {} },
  { path: ["permissions", "apply"], args: [], workspace: "required", config: ["projects"], interaction: "required", effects: "planned-write", options: {
    tools: { type: "string" }, yes: { type: "boolean" },
  } },
  { path: ["doctor"], args: [], workspace: "required", config: ["complete"], interaction: "never", effects: "read-only", options: {} },
  { path: ["completion"], args: [], workspace: "none", config: [], interaction: "never", effects: "read-only", options: { shell: { type: "string" } } },
  { path: ["help"], args: [], workspace: "none", config: [], interaction: "never", effects: "read-only", options: {} },
  { path: ["version"], args: [], workspace: "none", config: [], interaction: "never", effects: "read-only", options: {} },
];

const byPath = new Map(COMMANDS.map((command) => [command.path.join(" "), Object.freeze(command)]));

function getCommand(path) {
  return byPath.get(Array.isArray(path) ? path.join(" ") : String(path || "")) || null;
}

function commandHelpRows() {
  return COMMANDS
    .filter((command) => COMMAND_SUMMARIES[command.path.join(" ")])
    .map((command) => ({
      usage: [
        ...command.path,
        ...command.args.map((argument) => {
          const name = `${argument.name}${argument.variadic ? "..." : ""}`;
          return argument.required ? `<${name}>` : `[${name}]`;
        }),
      ].join(" "),
      summary: COMMAND_SUMMARIES[command.path.join(" ")],
      command,
    }));
}

function validateCommandReference(reference) {
  const tokens = [];
  const input = String(reference || "").trim();
  const pattern = /"([^"\\]*(?:\\.[^"\\]*)*)"|'([^'\\]*(?:\\.[^'\\]*)*)'|([^\s]+)/g;
  for (const match of input.matchAll(pattern)) tokens.push(match[1] ?? match[2] ?? match[3]);
  if (tokens.length === 0) return { valid: false, reason: "empty command reference" };
  const normalized = tokens.map((token) => /^<[^>]+>$/.test(token) ? "placeholder" : token);
  try {
    const parsed = require("./parser").parse([process.execPath, "code-workspace", ...normalized]);
    return {
      valid: true,
      command: parsed.command,
      options: Object.keys(parsed.options),
      args: parsed.args,
    };
  } catch (error) {
    return { valid: false, reason: `${error.code || "CLI_ERROR"}: ${error.message}` };
  }
}

module.exports = { COMMANDS: Object.freeze(COMMANDS), GLOBAL_OPTIONS: Object.freeze(GLOBAL_OPTIONS), commandHelpRows, getCommand, validateCommandReference };
