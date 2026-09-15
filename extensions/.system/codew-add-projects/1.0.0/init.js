#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");

const ID = "codew-add-projects";
const VERSION = "1.0.0";

function option(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

function copy(outputRoot, source, target) {
  const destination = path.join(outputRoot, ...target.split("/"));
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.copyFileSync(path.join(__dirname, ...source.split("/")), destination);
}

function main() {
  const contextFile = option("--context");
  const outputRoot = option("--output");
  const resultFile = option("--result");
  if (!contextFile || !outputRoot || !resultFile) throw new Error("Usage: init.js --context <file> --output <directory> --result <file>");
  const context = JSON.parse(fs.readFileSync(contextFile, "utf8"));
  if (context.schemaVersion !== 1 || context.extensionSpecVersion !== 1 || context.extension?.id !== ID || context.extension.version !== VERSION) throw new Error("Invalid extension context");
  const outputs = [];
  if (context.tools.includes("codex")) {
    copy(outputRoot, "assets/SKILL.md", "codex/SKILL.md");
    copy(outputRoot, "assets/codex/openai.yaml", "codex/agents/openai.yaml");
    outputs.push({ id: "codex-skill", source: "codex/SKILL.md" }, { id: "codex-openai", source: "codex/agents/openai.yaml" });
  }
  if (context.tools.includes("claude")) {
    copy(outputRoot, "assets/SKILL.md", "claude/SKILL.md");
    copy(outputRoot, "assets/claude/add-projects.md", "claude/commands/codew/add-projects.md");
    outputs.push({ id: "claude-skill", source: "claude/SKILL.md" }, { id: "claude-command", source: "claude/commands/codew/add-projects.md" });
  }
  fs.writeFileSync(resultFile, `${JSON.stringify({ schemaVersion: 1, extensionSpecVersion: 1, extension: { id: ID, version: VERSION }, outputs }, null, 2)}\n`, { mode: 0o600 });
}

try { main(); } catch (error) { process.stderr.write(`${error.message}\n`); process.exitCode = 1; }
