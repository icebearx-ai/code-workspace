#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");


function option(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

function copyOutput(outputRoot, source, target, replacements = {}) {
  const destination = path.join(outputRoot, ...target.split("/"));
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  let content = fs.readFileSync(path.join(__dirname, ...source.split("/")), "utf8");
  for (const [token, value] of Object.entries(replacements)) content = content.split(token).join(value);
  fs.writeFileSync(destination, content);
}

async function main() {
  const contextFile = option("--context");
  const outputRoot = option("--output");
  const resultFile = option("--result");
  if (!contextFile || !outputRoot || !resultFile) throw new Error("Usage: init.js --context <file> --output <directory> --result <file>");
  const context = JSON.parse(fs.readFileSync(contextFile, "utf8"));
  if (context.schemaVersion !== 1 || context.extensionSpecVersion !== 1 || context.extension?.id !== "zhuiyi-opensvn-mcp" || context.extension.version !== "0.2.0" || !Array.isArray(context.tools)) throw new Error("Invalid extension context");

  const outputs = [];
  const launcher = JSON.stringify(path.join(__dirname, "mcp-launcher.js"));
  copyOutput(outputRoot, "artifacts/gitignore", "gitignore");
  outputs.push({ id: "gitignore", source: "gitignore" });

  if (context.tools.includes("codex")) {
    copyOutput(outputRoot, "artifacts/codex/config.toml", "codex-config.toml", { "__CODE_WORKSPACE_MCP_LAUNCHER__": launcher });
    outputs.push({ id: "codex-config", source: "codex-config.toml" });
  }
  if (context.tools.includes("claude")) {
    copyOutput(outputRoot, "artifacts/claude/server.json", "claude-server.json", { "__CODE_WORKSPACE_MCP_LAUNCHER__": JSON.stringify(path.join(__dirname, "mcp-launcher.js")) });
    outputs.push({ id: "claude-config", source: "claude-server.json" });
  }

  fs.writeFileSync(resultFile, `${JSON.stringify({
    schemaVersion: 1,
    extensionSpecVersion: 1,
    extension: { id: "zhuiyi-opensvn-mcp", version: "0.2.0" },
    outputs,
  }, null, 2)}\n`, { mode: 0o600 });
}

main().catch((error) => {
  process.stderr.write(`${error.code ? `${error.code}: ` : ""}${error.message}\n`);
  process.exitCode = 1;
});
