#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");

const ALLOWED_WORKSPACE = new Set(["none", "optional", "required", "target"]);
const ALLOWED_CONFIG = new Set(["identity", "language", "projects", "complete"]);
const ALLOWED_INTERACTION = new Set(["never", "optional", "required"]);
const ALLOWED_EFFECTS = new Set(["read-only", "planned-write", "external"]);
const ALLOWED_OPTION_TYPES = new Set(["boolean", "string"]);

function problem(code, message, file = null) {
  return { code, message, file };
}

function validateOptions(definitions, owner) {
  const problems = [];
  if (!definitions || typeof definitions !== "object" || Array.isArray(definitions)) {
    return [problem("REGISTRY_OPTIONS_INVALID", `${owner} options must be an object`)];
  }
  for (const [name, definition] of Object.entries(definitions)) {
    if (!name || !definition || !ALLOWED_OPTION_TYPES.has(definition.type)) {
      problems.push(problem("REGISTRY_OPTION_INVALID", `${owner} option ${name || "<missing>"} must declare type boolean or string`));
    }
    if (definition?.required !== undefined && typeof definition.required !== "boolean") {
      problems.push(problem("REGISTRY_OPTION_REQUIRED_INVALID", `${owner} option ${name || "<missing>"} required field must be boolean`));
    }
    if (definition?.aliases !== undefined && (!Array.isArray(definition.aliases) || definition.aliases.some((alias) => typeof alias !== "string" || !alias))) {
      problems.push(problem("REGISTRY_OPTION_ALIAS_INVALID", `${owner} option ${name} aliases must be non-empty strings`));
    }
  }
  return problems;
}

function validateRegistry(commands, globalOptions = {}) {
  const problems = [...validateOptions(globalOptions, "global")];
  if (!Array.isArray(commands)) return [...problems, problem("REGISTRY_COMMANDS_INVALID", "COMMANDS must be an array")];
  const paths = new Set();
  for (const command of commands) {
    const label = Array.isArray(command?.path) ? command.path.join(" ") : "<invalid>";
    if (!Array.isArray(command?.path) || command.path.length === 0 || command.path.some((part) => typeof part !== "string" || !part)) {
      problems.push(problem("REGISTRY_PATH_INVALID", `${label} must have a non-empty string path`));
      continue;
    }
    if (paths.has(label)) problems.push(problem("REGISTRY_PATH_DUPLICATE", `Duplicate command path: ${label}`));
    paths.add(label);
    if (!Array.isArray(command.args)) {
      problems.push(problem("REGISTRY_ARGS_INVALID", `${label} args must be an array`));
    } else {
      const names = new Set();
      let optionalSeen = false;
      for (const [index, argument] of command.args.entries()) {
        if (!argument || typeof argument.name !== "string" || !argument.name || typeof argument.required !== "boolean") {
          problems.push(problem("REGISTRY_ARGUMENT_INVALID", `${label} arguments require name and boolean required fields`));
          continue;
        }
        if (argument.variadic !== undefined && typeof argument.variadic !== "boolean") {
          problems.push(problem("REGISTRY_ARGUMENT_VARIADIC_INVALID", `${label} argument ${argument.name} variadic must be boolean`));
        }
        if (argument.variadic && index !== command.args.length - 1) {
          problems.push(problem("REGISTRY_ARGUMENT_VARIADIC_ORDER_INVALID", `${label} variadic argument ${argument.name} must be last`));
        }
        if (names.has(argument.name)) problems.push(problem("REGISTRY_ARGUMENT_DUPLICATE", `${label} repeats argument ${argument.name}`));
        names.add(argument.name);
        if (!argument.required) optionalSeen = true;
        else if (optionalSeen) problems.push(problem("REGISTRY_ARGUMENT_ORDER_INVALID", `${label} places required argument ${argument.name} after an optional argument`));
      }
    }
    if (!ALLOWED_WORKSPACE.has(command.workspace)) problems.push(problem("REGISTRY_WORKSPACE_INVALID", `${label} has invalid workspace classification: ${command.workspace}`));
    if (!Array.isArray(command.config) || command.config.some((domain) => !ALLOWED_CONFIG.has(domain))) {
      problems.push(problem("REGISTRY_CONFIG_INVALID", `${label} has invalid configuration domains`));
    } else {
      if (command.config.includes("complete") && command.config.length !== 1) {
        problems.push(problem("REGISTRY_CONFIG_COMPLETE_MIXED", `${label} must not combine complete with projected domains`));
      }
      if (command.workspace === "none" && command.config.length > 0) {
        problems.push(problem("REGISTRY_CONFIG_WITHOUT_WORKSPACE", `${label} cannot load workspace configuration with workspace: none`));
      }
    }
    if (!ALLOWED_INTERACTION.has(command.interaction)) problems.push(problem("REGISTRY_INTERACTION_INVALID", `${label} has invalid interaction classification: ${command.interaction}`));
    if (!ALLOWED_EFFECTS.has(command.effects)) problems.push(problem("REGISTRY_EFFECTS_INVALID", `${label} has invalid effects classification: ${command.effects}`));
    if (command.effects === "read-only" && command.interaction !== "never") {
      problems.push(problem("REGISTRY_READ_ONLY_INTERACTIVE", `${label} is read-only and must use interaction: never`));
    }
    problems.push(...validateOptions(command.options, label));
    if (command.interaction === "required" && command.options?.yes?.type !== "boolean") {
      problems.push(problem("REGISTRY_CONFIRMATION_OPTION_MISSING", `${label} requires interaction and must declare boolean --yes`));
    }
  }
  return problems;
}

function optionToken(name) {
  return `--${name}`;
}

function aliasToken(alias) {
  return alias.length === 1 ? `-${alias}` : `--${alias}`;
}

function parseInvocation(parse, tokens) {
  return parse([process.execPath, "code-workspace", ...tokens]);
}

function validateParserContracts(commands, globalOptions, parse) {
  const problems = [];
  for (const command of commands) {
    const label = command.path.join(" ");
    const requiredArgs = command.args.filter((argument) => argument.required).map((argument) => `${argument.name}-value`);
    const requiredOptions = Object.entries(command.options).filter(([, definition]) => definition.required);
    const base = [
      ...command.path,
      ...requiredArgs,
    ];
    const baseWithOptions = [
      ...base,
      ...requiredOptions.flatMap(([name, definition]) => definition.type === "string" ? [optionToken(name), `${name}-value`] : [optionToken(name)]),
    ];
    try {
      const parsed = parseInvocation(parse, baseWithOptions);
      if (parsed.command?.path.join(" ") !== label) problems.push(problem("PARSER_COMMAND_MISMATCH", `${label} does not resolve to its registry definition`));
    } catch (error) {
      problems.push(problem("PARSER_COMMAND_REJECTED", `${label} cannot be parsed: ${error.code || error.message}`));
      continue;
    }
    for (const [name, definition] of Object.entries(command.options)) {
      const tokens = [...base, optionToken(name)];
      if (definition.type === "string") tokens.push(`${name}-value`);
      try {
        const parsed = parseInvocation(parse, tokens);
        if (!Object.prototype.hasOwnProperty.call(parsed.options, name)) {
          problems.push(problem("PARSER_OPTION_MISSING", `${label} did not parse --${name}`));
        }
      } catch (error) {
        problems.push(problem("PARSER_OPTION_REJECTED", `${label} rejected --${name}: ${error.code || error.message}`));
      }
      for (const alias of definition.aliases || []) {
        const aliasTokens = [...base, aliasToken(alias)];
        if (definition.type === "string") aliasTokens.push(`${name}-value`);
        try {
          const parsed = parseInvocation(parse, aliasTokens);
          if (!Object.prototype.hasOwnProperty.call(parsed.options, name)) {
            problems.push(problem("PARSER_ALIAS_MISSING", `${label} did not normalize ${aliasToken(alias)} to ${name}`));
          }
        } catch (error) {
          problems.push(problem("PARSER_ALIAS_REJECTED", `${label} rejected ${aliasToken(alias)}: ${error.code || error.message}`));
        }
      }
    }
    if (globalOptions.json?.type === "boolean") {
      try {
        const parsed = parseInvocation(parse, ["--json", ...baseWithOptions]);
        if (parsed.options.json !== true) problems.push(problem("PARSER_GLOBAL_OPTION_MISSING", `${label} did not accept leading --json`));
      } catch (error) {
        problems.push(problem("PARSER_GLOBAL_OPTION_REJECTED", `${label} rejected leading --json: ${error.code || error.message}`));
      }
    }
    for (const [name] of requiredOptions) {
      const missing = [...command.path, ...requiredArgs];
      try {
        parseInvocation(parse, missing);
        problems.push(problem("PARSER_REQUIRED_OPTION_NOT_ENFORCED", `${label} did not reject missing --${name}`));
      } catch (error) {
        if (error.code !== "CLI_OPTION_REQUIRED") {
          problems.push(problem("PARSER_REQUIRED_OPTION_REJECTED_INCORRECTLY", `${label} rejected missing --${name} as ${error.code || error.message}`));
        }
      }
    }
  }
  return problems;
}

function inspectCommandSource(file, source) {
  const problems = [];
  const relative = file.replace(/\\/g, "/");
  if (/require\(["']\.\.\/\.\.\/core\/fs["']\)/.test(source)) {
    problems.push(problem("COMMAND_IMPORTS_CORE_FS", "CLI command modules must not import core/fs directly", relative));
  }
  if (/\b(?:atomicWrite|readConfigDocument|renderConfigDocument)\b/.test(source)) {
    problems.push(problem("COMMAND_USES_RAW_PERSISTENCE", "CLI command modules must use a core domain API instead of raw configuration or atomic-write primitives", relative));
  }
  if (/\bfs\.(?:writeFileSync|appendFileSync|renameSync|unlinkSync|rmSync|rmdirSync|mkdirSync)\b/.test(source) ||
      /\bfs\.promises\.(?:writeFile|appendFile|rename|unlink|rm|rmdir|mkdir)\b/.test(source)) {
    problems.push(problem("COMMAND_WRITES_FILES_DIRECTLY", "CLI command modules must not mutate the filesystem directly", relative));
  }
  if (!/require\(["']\.\.\/result["']\)/.test(source) || !/\b(?:success|fromDiagnostics|commandResult)\s*\(/.test(source)) {
    problems.push(problem("COMMAND_RESULT_HELPER_MISSING", "CLI command modules must construct responses with shared result helpers", relative));
  }
  return problems;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function validateDispatchCoverage(commands, source) {
  const problems = [];
  for (const command of commands) {
    const label = command.path.join(" ");
    const exact = new RegExp(`key\\s*===\\s*["']${escapeRegExp(label)}["']`).test(source);
    const grouped = command.path.length > 1 && new RegExp(
      `key\\.startsWith\\(\\s*["']${escapeRegExp(`${command.path[0]} `)}["']\\s*\\)`
    ).test(source);
    if (!exact && !grouped) problems.push(problem("DISPATCH_HANDLER_MISSING", `${label} has no dispatch route`, "src/cli.js"));
  }
  return problems;
}

function collectMarkdownFiles(target, files = []) {
  if (!fs.existsSync(target)) return files;
  const stat = fs.statSync(target);
  if (stat.isDirectory()) {
    for (const name of fs.readdirSync(target)) collectMarkdownFiles(path.join(target, name), files);
  } else if (target.endsWith(".md")) files.push(target);
  return files;
}

function documentedCommandReferences(content) {
  const references = [];
  const normalized = content.replace(/\\\n\s*/g, " ");
  for (const line of normalized.split("\n")) {
    if (/^\s*(?:code-workspace|code-w|codew)\s+/.test(line)) {
      references.push(line.trim().replace(/^(?:code-workspace|code-w|codew)\s+/, ""));
    }
    for (const match of line.matchAll(/`(?:code-workspace|code-w|codew)\s+([^`]+)`/g)) references.push(match[1]);
  }
  return references.map((reference) => reference.trim().replace(/[.,;:]$/, ""));
}

function validateDocumentedCommands(root, validateCommandReference) {
  const problems = [];
  const files = [
    ...collectMarkdownFiles(path.join(root, "README.md")),
    ...collectMarkdownFiles(path.join(root, "README.zh-CN.md")),
    ...collectMarkdownFiles(path.join(root, "artifacts", "templates")),
    ...collectMarkdownFiles(path.join(root, "extensions")),
    ...collectMarkdownFiles(path.join(root, "docs", "nexus-extension-registry.zh-CN.md")),
    ...collectMarkdownFiles(path.join(root, "docs", "extension-development")),
  ];
  let checked = 0;
  for (const file of files) {
    const references = documentedCommandReferences(fs.readFileSync(file, "utf8"));
    for (const reference of references) {
      const result = validateCommandReference(reference);
      if (!result.valid) {
        problems.push(problem("DOCUMENTED_COMMAND_INVALID", `${reference}: ${result.reason}`, path.relative(root, file)));
      }
      checked += 1;
    }
  }
  if (checked === 0) problems.push(problem("DOCUMENTED_COMMANDS_MISSING", "No documented codew commands were checked"));
  return { problems, checked };
}

function validateExtensionPackContract(registry, commandSource, coreSource) {
  const definition = registry.COMMANDS.find((command) => command.path.join(" ") === "extension pack");
  const expected = {
    workspace: "none",
    config: [],
    interaction: "never",
    effects: "planned-write",
    args: [{ name: "source", required: true }],
    options: { output: { type: "string", required: true } },
  };
  const problems = [];
  if (!definition || JSON.stringify(definition, Object.keys(expected)) !== JSON.stringify(expected, Object.keys(expected))) {
    problems.push(problem("EXTENSION_PACK_REGISTRY_INVALID", "extension pack must declare the Workspace-independent planned-write contract"));
  }
  if (!/require\(["']\.\.\/\.\.\/core\/extension-package["']\)/.test(commandSource) || !/\b(?:packExtensionToDirectory|packExtensionSourceToDirectory)\s*\(/.test(commandSource)) {
    problems.push(problem("EXTENSION_PACK_COMMAND_LAYERING_INVALID", "extension pack command must orchestrate the core pack API", "src/cli/commands/extension.js"));
  }
  if (/\bfs\./.test(commandSource)) {
    problems.push(problem("EXTENSION_PACK_COMMAND_RAW_FS", "extension pack command must not access the filesystem directly", "src/cli/commands/extension.js"));
  }
  for (const [pattern, message] of [
    [/fs\.openSync\(target,\s*"wx"/, "extension pack must reserve the output without overwriting an existing target"],
    [/fs\.renameSync\(temporaryTarget,\s*target\)/, "extension pack must atomically rename the verified temporary tarball"],
    [/inspectExtensionTransportTarball\s*\(/, "extension pack must re-read and verify the temporary tarball"],
    [/EXTENSION_PACK_OUTPUT_EXISTS/, "extension pack must use the stable existing-output error"],
    [/fs\.rmSync\(temporaryRoot,\s*\{\s*recursive:\s*true,\s*force:\s*true\s*\}\)/, "extension pack must clean intermediate files after failure"],
  ]) {
    if (!pattern.test(coreSource)) {
      problems.push(problem("EXTENSION_PACK_IMPLEMENTATION_INVALID", message, "src/core/extension-package.js"));
    }
  }
  return problems;
}

function validateExtensionRegistryLifecycleContract(registry, commandSource, lifecycleSource) {
  const expected = {
    "extension search": {
      workspace: "required",
      config: ["identity", "language"],
      interaction: "required",
      effects: "planned-write",
      args: [{ name: "query", required: false }],
      options: { yes: { type: "boolean" } },
    },
    "extension info": {
      workspace: "none",
      config: [],
      interaction: "never",
      effects: "external",
      args: [{ name: "name", required: true }],
      options: {},
    },
    "extension install": {
      workspace: "required",
      config: ["identity", "language"],
      interaction: "required",
      effects: "planned-write",
      args: [{ name: "name", required: false, variadic: true }],
      options: {
        yes: { type: "boolean" },
        version: { type: "string" },
        "allow-deprecated": { type: "boolean" },
        offline: { type: "boolean" },
      },
    },
    "extension upgrade": {
      workspace: "required",
      config: ["identity", "language"],
      interaction: "required",
      effects: "planned-write",
      args: [{ name: "name", required: true, variadic: true }],
      options: {
        yes: { type: "boolean" },
        offline: { type: "boolean" },
      },
    },
  };
  const problems = [];
  for (const [label, contract] of Object.entries(expected)) {
    const definition = registry.COMMANDS.find((command) => command.path.join(" ") === label);
    if (!definition || JSON.stringify(definition, Object.keys(contract)) !== JSON.stringify(contract, Object.keys(contract))) {
      problems.push(problem("EXTENSION_LIFECYCLE_REGISTRY_INVALID", `${label} must declare the complete Registry lifecycle contract`));
    }
  }
  if (!/require\(["']\.\.\/\.\.\/core\/extension-registry-lifecycle["']\)/.test(commandSource)) {
    problems.push(problem("EXTENSION_LIFECYCLE_COMMAND_LAYERING_INVALID", "extension Registry commands must orchestrate the core lifecycle service", "src/cli/commands/extension.js"));
  }
  for (const forbidden of [/\.npmrc/, /\bAuthorization\b/, /\bnpm\s+pack\b/, /\btar\.list\b/, /\btar\.extract\b/]) {
    if (forbidden.test(commandSource)) {
      problems.push(problem("EXTENSION_LIFECYCLE_COMMAND_BOUNDARY_INVALID", "extension Registry command module must not parse npm config, Authorization, or tar payloads", "src/cli/commands/extension.js"));
    }
  }
  for (const [pattern, message] of [
    [/function prepareRegistryExtensionPlans/, "extension lifecycle must freeze remote candidates before Workspace activation"],
    [/function searchRegistryExtensions/, "extension lifecycle must provide search result conversion"],
    [/function getRegistryExtensionInfo/, "extension lifecycle must provide metadata info conversion"],
    [/EXTENSION_REGISTRY_PACKAGE_CONFLICT/, "extension lifecycle must detect same-version digest conflicts"],
    [/EXTENSION_SYSTEM_MANAGED/, "extension lifecycle must preserve system-extension boundaries"],
  ]) {
    if (!pattern.test(lifecycleSource)) {
      problems.push(problem("EXTENSION_LIFECYCLE_IMPLEMENTATION_INVALID", message, "src/core/extension-registry-lifecycle.js"));
    }
  }
  return problems;
}

function runChecks(root) {
  const registryFile = path.join(root, "src", "cli", "registry.js");
  const parserFile = path.join(root, "src", "cli", "parser.js");
  const registry = require(registryFile);
  const { parse } = require(parserFile);
  const problems = [
    ...validateRegistry(registry.COMMANDS, registry.GLOBAL_OPTIONS),
    ...validateParserContracts(registry.COMMANDS, registry.GLOBAL_OPTIONS, parse),
    ...validateDispatchCoverage(registry.COMMANDS, fs.readFileSync(path.join(root, "src", "cli.js"), "utf8")),
  ];
  const commandDirectory = path.join(root, "src", "cli", "commands");
  const commandFiles = fs.readdirSync(commandDirectory).filter((name) => name.endsWith(".js"));
  for (const name of commandFiles) {
    const file = path.join(commandDirectory, name);
    problems.push(...inspectCommandSource(path.relative(root, file), fs.readFileSync(file, "utf8")));
  }
  problems.push(...validateExtensionPackContract(
    registry,
    fs.readFileSync(path.join(commandDirectory, "extension.js"), "utf8"),
    fs.readFileSync(path.join(root, "src", "core", "extension-package.js"), "utf8")
  ));
  problems.push(...validateExtensionRegistryLifecycleContract(
    registry,
    fs.readFileSync(path.join(commandDirectory, "extension.js"), "utf8"),
    fs.readFileSync(path.join(root, "src", "core", "extension-registry-lifecycle.js"), "utf8")
  ));
  const documented = validateDocumentedCommands(root, registry.validateCommandReference);
  problems.push(...documented.problems);
  return {
    problems,
    stats: {
      commands: registry.COMMANDS.length,
      commandModules: commandFiles.length,
      documentedReferences: documented.checked,
    },
  };
}

function main() {
  const rootIndex = process.argv.indexOf("--root");
  const root = rootIndex >= 0 ? path.resolve(process.argv[rootIndex + 1]) : path.resolve(__dirname, "..");
  try {
    const result = runChecks(root);
    if (result.problems.length > 0) {
      process.stderr.write("CLI architecture guard failed:\n");
      for (const entry of result.problems) {
        process.stderr.write(`- [${entry.code}] ${entry.file ? `${entry.file}: ` : ""}${entry.message}\n`);
      }
      process.exitCode = 1;
      return;
    }
    process.stdout.write(
      `CLI architecture guard passed (${result.stats.commands} commands, ${result.stats.commandModules} command modules, ${result.stats.documentedReferences} documented references).\n`
    );
  } catch (error) {
    process.stderr.write(`CLI architecture guard failed to run: ${error.stack || error.message}\n`);
    process.exitCode = 1;
  }
}

if (require.main === module) main();

module.exports = {
  documentedCommandReferences,
  inspectCommandSource,
  runChecks,
  validateDispatchCoverage,
  validateDocumentedCommands,
  validateExtensionPackContract,
  validateExtensionRegistryLifecycleContract,
  validateParserContracts,
  validateRegistry,
};
