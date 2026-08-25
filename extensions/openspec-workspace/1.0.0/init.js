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
  const resultFile = option("--result");
  if (!contextFile || !outputRoot || !resultFile) throw new Error("Usage: init.js --context <file> --output <directory> --result <file>");
  const context = JSON.parse(fs.readFileSync(contextFile, "utf8"));
  if (context.schemaVersion !== 1 || context.extensionSpecVersion !== 1 || context.extension?.id !== "openspec-workspace" || !Array.isArray(context.tools)) {
    throw new Error("Invalid extension context");
  }
  const definitions = {
    codex: {
      id: "codex-propose-skill",
      source: path.join(__dirname, "artifacts", "codex", "SKILL.md"),
      target: ".codex/skills/code-workspace-openspec-propose/SKILL.md",
    },
    claude: {
      id: "claude-propose-skill",
      source: path.join(__dirname, "artifacts", "claude", "SKILL.md"),
      target: ".claude/skills/code-workspace-openspec-propose/SKILL.md",
    },
  };
  const outputs = [];
  for (const tool of context.tools) {
    const definition = definitions[tool];
    if (!definition) continue;
    const target = path.join(outputRoot, ...definition.target.split("/"));
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(definition.source, target);
    outputs.push({ id: definition.id, source: definition.target });
  }
  fs.writeFileSync(resultFile, `${JSON.stringify({
    schemaVersion: 1,
    extensionSpecVersion: 1,
    extension: { id: "openspec-workspace", version: "1.0.0" },
    outputs,
  }, null, 2)}\n`, { mode: 0o600 });
} catch (error) {
  fail(error.message);
}
