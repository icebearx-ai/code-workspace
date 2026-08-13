const { WorkspaceError } = require("../../core/errors");
const { COMMANDS, GLOBAL_OPTIONS } = require("../registry");
const { success } = require("../result");

const SUPPORTED_SHELLS = ["bash", "zsh"];

function optionToken(name) {
  return `--${name}`;
}

function aliasToken(alias) {
  return alias.length === 1 ? `-${alias}` : `--${alias}`;
}

function optionTokens(definitions) {
  return Object.entries(definitions).flatMap(([name, definition]) => [
    optionToken(name),
    ...(definition.aliases || []).map(aliasToken),
  ]);
}

function buildCompletionSpec(commands = COMMANDS, globalOptions = GLOBAL_OPTIONS) {
  const children = new Map();
  const addChild = (prefix, child) => {
    const key = prefix.join(" ");
    const values = children.get(key) || [];
    if (!values.includes(child)) values.push(child);
    children.set(key, values);
  };
  for (const command of commands) {
    for (let index = 0; index < command.path.length; index += 1) {
      addChild(command.path.slice(0, index), command.path[index]);
    }
  }
  const globals = optionTokens(globalOptions);
  return {
    globals,
    children: [...children.entries()].map(([key, values]) => ({
      path: key ? key.split(" ") : [],
      values,
    })),
    commands: commands.map((command) => ({
      path: [...command.path],
      options: [...new Set([...globals, ...optionTokens(command.options)])],
    })),
  };
}

function bashWords(values) {
  return values.join(" ").replace(/(["\\$`])/g, "\\$1");
}

function bashPathCondition(path) {
  return path.map((part, index) => `[[ "\${COMP_WORDS[$((command_index + ${index}))]}" == "${part}" ]]`).join(" && ");
}

function renderBashCompletion(spec) {
  const root = spec.children.find((entry) => entry.path.length === 0)?.values || [];
  const childBlocks = spec.children
    .filter((entry) => entry.path.length > 0)
    .map((entry) => [
      `  if (( depth == ${entry.path.length} )) && ${bashPathCondition(entry.path)} && [[ "$current" != -* ]]; then`,
      `    COMPREPLY=( $(compgen -W "${bashWords(entry.values)}" -- "$current") )`,
      "    return",
      "  fi",
    ].join("\n"))
    .join("\n");
  const optionBlocks = [...spec.commands]
    .sort((left, right) => right.path.length - left.path.length)
    .map((entry) => [
      `  if ${bashPathCondition(entry.path)}; then`,
      `    COMPREPLY=( $(compgen -W "${bashWords(entry.options)}" -- "$current") )`,
      "    return",
      "  fi",
    ].join("\n"))
    .join("\n");
  return [
    "_code_workspace() {",
    "  local current=\"${COMP_WORDS[COMP_CWORD]}\"",
    "  local command_index=1",
    "  local depth",
    "  COMPREPLY=()",
    "  while (( command_index < COMP_CWORD )); do",
    "    case \"${COMP_WORDS[command_index]}\" in",
    `      ${spec.globals.join("|")}) ((command_index += 1)) ;;`,
    "      *) break ;;",
    "    esac",
    "  done",
    "  depth=$((COMP_CWORD - command_index))",
    "  if [[ \"${COMP_WORDS[COMP_CWORD-1]}\" == \"--shell\" ]]; then",
    `    COMPREPLY=( $(compgen -W "${SUPPORTED_SHELLS.join(" ")}" -- "$current") )`,
    "    return",
    "  fi",
    "  if (( depth == 0 )); then",
    "    if [[ \"$current\" == -* ]]; then",
    `      COMPREPLY=( $(compgen -W "${bashWords(spec.globals)}" -- "$current") )`,
    "    else",
    `      COMPREPLY=( $(compgen -W "${bashWords(root)}" -- "$current") )`,
    "    fi",
    "    return",
    "  fi",
    childBlocks,
    "  if [[ \"$current\" != -* ]]; then return; fi",
    optionBlocks,
    "}",
    "complete -F _code_workspace code-workspace code-w",
  ].filter(Boolean).join("\n");
}

function zshQuote(value) {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function zshArray(values) {
  return values.map(zshQuote).join(" ");
}

function zshPathCondition(path) {
  return path.map((part, index) => `[[ "\${words[$((command_index + ${index}))]}" == ${zshQuote(part)} ]]`).join(" && ");
}

function renderZshCompletion(spec) {
  const root = spec.children.find((entry) => entry.path.length === 0)?.values || [];
  const childBlocks = spec.children
    .filter((entry) => entry.path.length > 0)
    .map((entry) => [
      `  if (( depth == ${entry.path.length} )) && ${zshPathCondition(entry.path)} && [[ "$current" != -* ]]; then`,
      `    candidates=( ${zshArray(entry.values)} )`,
      "    compadd -- \"${candidates[@]}\"",
      "    return",
      "  fi",
    ].join("\n"))
    .join("\n");
  const optionBlocks = [...spec.commands]
    .sort((left, right) => right.path.length - left.path.length)
    .map((entry) => [
      `  if ${zshPathCondition(entry.path)}; then`,
      `    candidates=( ${zshArray(entry.options)} )`,
      "    compadd -- \"${candidates[@]}\"",
      "    return",
      "  fi",
    ].join("\n"))
    .join("\n");
  return [
    "#compdef code-workspace code-w",
    "_code_workspace() {",
    "  local current=\"${words[CURRENT]}\"",
    "  local command_index=2",
    "  local depth",
    "  local -a candidates",
    "  while (( command_index < CURRENT )); do",
    "    case \"${words[command_index]}\" in",
    `      ${spec.globals.join("|")}) ((command_index += 1)) ;;`,
    "      *) break ;;",
    "    esac",
    "  done",
    "  depth=$((CURRENT - command_index))",
    "  if [[ \"${words[CURRENT-1]}\" == \"--shell\" ]]; then",
    `    candidates=( ${zshArray(SUPPORTED_SHELLS)} )`,
    "    compadd -- \"${candidates[@]}\"",
    "    return",
    "  fi",
    "  if (( depth == 0 )); then",
    "    if [[ \"$current\" == -* ]]; then",
    `      candidates=( ${zshArray(spec.globals)} )`,
    "    else",
    `      candidates=( ${zshArray(root)} )`,
    "    fi",
    "    compadd -- \"${candidates[@]}\"",
    "    return",
    "  fi",
    childBlocks,
    "  if [[ \"$current\" != -* ]]; then return; fi",
    optionBlocks,
    "}",
    "compdef _code_workspace code-workspace code-w",
  ].filter(Boolean).join("\n");
}

function executeCompletion(invocation) {
  const shell = invocation.options.shell || "zsh";
  const spec = buildCompletionSpec();
  const script = shell === "bash"
    ? renderBashCompletion(spec)
    : shell === "zsh"
      ? renderZshCompletion(spec)
      : null;
  if (!script) {
    throw new WorkspaceError("CLI_COMPLETION_SHELL_UNSUPPORTED", `Unsupported completion shell: ${shell}`, {
      actual: shell,
      supported: SUPPORTED_SHELLS,
    });
  }
  return success("completion", { shell, script }, script);
}

module.exports = {
  SUPPORTED_SHELLS,
  buildCompletionSpec,
  executeCompletion,
  renderBashCompletion,
  renderZshCompletion,
};
