const packageJson = require("../../../package.json");
const { SUPPORTED_LANGUAGES } = require("../../core/language");
const { commandHelpRows, GLOBAL_OPTIONS } = require("../registry");
const { success } = require("../result");

function optionUsage(name, definition) {
  const aliases = (definition.aliases || []).map((alias) => `-${alias}`).join(", ");
  const long = `--${name}${definition.type === "string" ? ` <${name}>` : ""}`;
  return aliases ? `${aliases}, ${long}` : long;
}

function helpText() {
  const rows = commandHelpRows();
  const commands = rows.map(({ usage, summary }) => `  ${usage.padEnd(36)}${summary}`).join("\n");
  const commandOptions = rows
    .filter(({ command }) => Object.keys(command.options).length > 0)
    .map(({ command }) => {
      const label = command.path.join(" ");
      const options = Object.entries(command.options).map(([name, definition]) => `    ${optionUsage(name, definition)}`).join("\n");
      return `  ${label}:\n${options}`;
    })
    .join("\n");
  const globalOptions = Object.entries(GLOBAL_OPTIONS).map(([name, definition]) => optionUsage(name, definition)).join(", ");
  const languages = SUPPORTED_LANGUAGES.map((entry) => entry.value).join("|");
  return `OpenSpec Workspace ${packageJson.version}\n\nUsage: openspec-workspace [command] [options]\n\nCommands:\n${commands}\n\nCommand options:\n${commandOptions}\n\nWorkspace languages: ${languages}\nGlobal options: ${globalOptions}`;
}

function executeHelp() {
  return success("help", { version: packageJson.version, commands: commandHelpRows().map(({ usage, summary }) => ({ usage, summary })) }, helpText());
}

function executeVersion() {
  return success("version", { version: packageJson.version }, packageJson.version);
}

module.exports = { executeHelp, executeVersion, helpText, optionUsage };
