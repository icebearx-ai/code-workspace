#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
}

function option(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

try {
  const contextFile = option("--context");
  const outputRoot = option("--output");
  if (!contextFile || !outputRoot) throw new Error("Usage: init.js --context <file> --output <directory>");
  const context = JSON.parse(fs.readFileSync(contextFile, "utf8"));
  if (context.schemaVersion !== 1 || context.extension?.id !== "openspec-workspace" || !Array.isArray(context.tools)) {
    throw new Error("Invalid extension context");
  }
  const definitions = {
    codex: {
      source: path.join(__dirname, "artifacts", "codex", "SKILL.md"),
      target: ".codex/skills/code-workspace-openspec-propose/SKILL.md",
    },
    claude: {
      source: path.join(__dirname, "artifacts", "claude", "SKILL.md"),
      target: ".claude/skills/code-workspace-openspec-propose/SKILL.md",
    },
  };
  for (const tool of context.tools) {
    const definition = definitions[tool];
    if (!definition) continue;
    const target = path.join(outputRoot, ...definition.target.split("/"));
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(definition.source, target);
  }
} catch (error) {
  fail(error.message);
}
