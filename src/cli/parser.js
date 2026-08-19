const { WorkspaceError } = require("../core/errors");
const { COMMANDS, GLOBAL_OPTIONS, getCommand } = require("./registry");

const aliasEntries = Object.entries(GLOBAL_OPTIONS).flatMap(([name, definition]) =>
  (definition.aliases || []).map((alias) => [alias, name])
);

function optionName(token) {
  if (token === "-p") return "p";
  if (!token.startsWith("--") || token === "--") return null;
  return token.slice(2).split("=", 1)[0];
}

function commandCandidates(first) {
  return COMMANDS.filter((command) => command.path[0] === first).sort((left, right) => right.path.length - left.path.length);
}

function resolveCommand(tokens) {
  let index = 0;
  const leadingOptions = {};
  while (index < tokens.length && optionName(tokens[index])) {
    const token = tokens[index];
    const rawName = optionName(token);
    const name = new Map(aliasEntries).get(rawName) || rawName;
    const definition = GLOBAL_OPTIONS[name];
    if (!definition) throw new WorkspaceError("CLI_UNKNOWN_OPTION", `Unknown global option: ${token.split("=")[0]}`, { option: rawName });
    if (token.includes("=")) throw new WorkspaceError("CLI_INVALID_OPTION_VALUE", `Boolean option --${name} does not accept a value`, { option: name });
    leadingOptions[name] = true;
    index += 1;
  }
  if (index >= tokens.length) return { command: null, index, leadingOptions };
  const candidates = commandCandidates(tokens[index]);
  const command = candidates.find((candidate) => candidate.path.every((part, offset) => tokens[index + offset] === part));
  if (!command) throw new WorkspaceError("CLI_UNKNOWN_COMMAND", `Unknown command: ${tokens[index]}`, { command: tokens[index] });
  return { command, index: index + command.path.length, leadingOptions };
}

function parseOption(token, definitions, tokens, index) {
  const rawName = optionName(token);
  const aliases = Object.entries(definitions).flatMap(([name, definition]) => (definition.aliases || []).map((alias) => [alias, name]));
  const name = new Map(aliases).get(rawName) || rawName;
  const definition = definitions[name];
  if (!definition) throw new WorkspaceError("CLI_UNKNOWN_OPTION", `Unknown option for this command: ${token.split("=")[0]}`, { option: rawName });
  const equal = token.indexOf("=");
  if (definition.type === "boolean") {
    if (equal >= 0) throw new WorkspaceError("CLI_INVALID_OPTION_VALUE", `Boolean option --${name} does not accept a value`, { option: name });
    return { name, value: true, next: index + 1 };
  }
  const value = equal >= 0 ? token.slice(equal + 1) : tokens[index + 1];
  if (!value || (equal < 0 && value.startsWith("-"))) {
    throw new WorkspaceError("CLI_OPTION_VALUE_REQUIRED", `--${name} requires a value`, { option: name });
  }
  return { name, value, next: equal >= 0 ? index + 1 : index + 2 };
}

function parse(argv) {
  const tokens = argv.slice(2);
  const resolved = resolveCommand(tokens);
  if (!resolved.command) return { command: null, positionals: [], args: [], options: resolved.leadingOptions };
  try {
    const definitions = { ...GLOBAL_OPTIONS, ...resolved.command.options };
    const options = { ...resolved.leadingOptions };
    const args = [];
    let positionalOnly = false;
    for (let index = resolved.index; index < tokens.length;) {
      const token = tokens[index];
      if (token === "--") {
        positionalOnly = true;
        index += 1;
        continue;
      }
      if (!positionalOnly && token.startsWith("-")) {
        const parsed = parseOption(token, definitions, tokens, index);
        if (Object.prototype.hasOwnProperty.call(options, parsed.name)) {
          throw new WorkspaceError("CLI_DUPLICATE_OPTION", `Option provided more than once: --${parsed.name}`, { option: parsed.name });
        }
        options[parsed.name] = parsed.value;
        index = parsed.next;
        continue;
      }
      args.push(token);
      index += 1;
    }
    const required = resolved.command.args.filter((argument) => argument.required).length;
    if (!options.help && args.length < required) {
      const missing = resolved.command.args[args.length]?.name || "argument";
      throw new WorkspaceError("CLI_ARGUMENT_REQUIRED", `${resolved.command.path.join(" ")} requires <${missing}>`, { argument: missing });
    }
    const variadic = resolved.command.args.at(-1)?.variadic === true;
    if (!options.help && !variadic && args.length > resolved.command.args.length) {
      throw new WorkspaceError("CLI_EXTRA_ARGUMENT", `Unexpected argument for ${resolved.command.path.join(" ")}: ${args[resolved.command.args.length]}`, { argument: args[resolved.command.args.length] });
    }
    return {
      command: resolved.command,
      args,
      options,
      positionals: [...resolved.command.path, ...args],
    };
  } catch (error) {
    error.details = {
      ...(error.details || {}),
      command: resolved.command.path.join("."),
    };
    throw error;
  }
}

module.exports = { parse, resolveCommand };
