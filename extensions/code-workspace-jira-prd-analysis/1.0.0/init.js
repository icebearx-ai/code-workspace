#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");

const EXTENSION_ID = "code-workspace-jira-prd-analysis";
const EXTENSION_VERSION = "1.0.0";

function option(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

function copyAsset(outputRoot, source, target) {
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
  if (
    context.schemaVersion !== 1 ||
    context.extensionSpecVersion !== 1 ||
    context.extension?.id !== EXTENSION_ID ||
    context.extension.version !== EXTENSION_VERSION ||
    !Array.isArray(context.tools)
  ) {
    throw new Error("Invalid extension context");
  }

  const outputs = [];
  if (context.tools.includes("codex")) {
    copyAsset(outputRoot, "assets/SKILL.md", "codex/SKILL.md");
    copyAsset(outputRoot, "assets/codex/openai.yaml", "codex/agents/openai.yaml");
    outputs.push({ id: "codex-skill", source: "codex/SKILL.md" });
    outputs.push({ id: "codex-openai", source: "codex/agents/openai.yaml" });
  }
  if (context.tools.includes("claude")) {
    copyAsset(outputRoot, "assets/SKILL.md", "claude/SKILL.md");
    outputs.push({ id: "claude-skill", source: "claude/SKILL.md" });
  }
  if (outputs.length === 0) throw new Error("No supported Agent tools selected");

  fs.writeFileSync(resultFile, `${JSON.stringify({
    schemaVersion: 1,
    extensionSpecVersion: 1,
    extension: { id: EXTENSION_ID, version: EXTENSION_VERSION },
    outputs,
  }, null, 2)}\n`, { mode: 0o600 });
}

try {
  main();
} catch (error) {
  process.stderr.write(`${error.code ? `${error.code}: ` : ""}${error.message}\n`);
  process.exitCode = 1;
}
