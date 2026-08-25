#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");

const { prepareRelease } = require("./lib/archive");
const release = require("./release.json");

function option(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

function copyOutput(outputRoot, source, target) {
  const destination = path.join(outputRoot, ...target.split("/"));
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.copyFileSync(path.join(__dirname, ...source.split("/")), destination);
}

async function main() {
  const contextFile = option("--context");
  const outputRoot = option("--output");
  const resultFile = option("--result");
  if (!contextFile || !outputRoot || !resultFile) throw new Error("Usage: init.js --context <file> --output <directory> --result <file>");
  const context = JSON.parse(fs.readFileSync(contextFile, "utf8"));
  if (context.schemaVersion !== 1 || context.extensionSpecVersion !== 1 || context.extension?.id !== "zhuiyi-jira-mcp" || context.extension.version !== "0.1.0" || !Array.isArray(context.tools)) throw new Error("Invalid extension context");

  const outputs = [];
  const runtime = path.join(outputRoot, "runtime");
  await prepareRelease(release, runtime);
  outputs.push({ id: "runtime", source: "runtime" });

  if (context.tools.includes("codex")) {
    copyOutput(outputRoot, "artifacts/codex/config.toml", "codex-config.toml");
    outputs.push({ id: "codex-config", source: "codex-config.toml" });
  }
  if (context.tools.includes("claude")) {
    copyOutput(outputRoot, "artifacts/claude/server.json", "claude-server.json");
    outputs.push({ id: "claude-config", source: "claude-server.json" });
  }

  fs.writeFileSync(resultFile, `${JSON.stringify({
    schemaVersion: 1,
    extensionSpecVersion: 1,
    extension: { id: "zhuiyi-jira-mcp", version: "0.1.0" },
    outputs,
  }, null, 2)}\n`, { mode: 0o600 });
}

main().catch((error) => {
  process.stderr.write(`${error.code ? `${error.code}: ` : ""}${error.message}\n`);
  process.exitCode = 1;
});
