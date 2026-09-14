#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");

function option(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

function main() {
  const contextFile = option("--context");
  const outputRoot = option("--output");
  const resultFile = option("--result");
  if (!contextFile || !outputRoot || !resultFile) throw new Error("Usage: init.js --context <file> --output <directory> --result <file>");
  const context = JSON.parse(fs.readFileSync(contextFile, "utf8"));
  if (context.schemaVersion !== 1 || context.extensionSpecVersion !== 1 || context.extension?.id !== "monitor" || !context.extension.version || !context.workspace || !Array.isArray(context.tools)) throw new Error("Invalid monitor extension context");
  fs.mkdirSync(outputRoot, { recursive: true });
  const config = {
    schemaVersion: 1,
    enable: true,
    url: "http://127.0.0.1:3211",
    workspace: context.workspace,
    service: { id: "monitor", compatibilityGroup: "v1" },
  };
  const source = "monitor-reporting.json";
  fs.writeFileSync(path.join(outputRoot, source), `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
  const outputs = [{ id: "reporting-config", source }];
  fs.writeFileSync(resultFile, `${JSON.stringify({
    schemaVersion: 1,
    extensionSpecVersion: 1,
    extension: { id: "monitor", version: context.extension.version },
    outputs,
  }, null, 2)}\n`, { mode: 0o600 });
}

main();
