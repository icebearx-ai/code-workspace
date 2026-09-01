#!/usr/bin/env node
"use strict";

const { runHookStdin } = require("../src/core/task-coordination-protocol");
const { getAdapter } = require("../src/hooks/adapters");

const provider = String(process.argv[2] || "").toLowerCase();
let adapter = null;
try {
  adapter = getAdapter(provider);
} catch {
  // Keep the provider error below provider-neutral because no native renderer
  // is available for an unknown provider.
}

function writeFailure(reason) {
  const output = adapter?.renderFailure
    ? adapter.renderFailure({ remediation: reason })
    : { decision: "block", reason };
  process.stdout.write(`${JSON.stringify(output)}\n`);
}

let workspaceRoot = process.cwd();
for (let index = 3; index < process.argv.length; index += 1) {
  const argument = process.argv[index];
  if (argument === "--workspace-root-b64") {
    const encoded = process.argv[++index];
    try {
      workspaceRoot = Buffer.from(String(encoded || ""), "base64url").toString("utf8");
      if (!workspaceRoot) throw new Error("empty path");
    } catch {
      writeFailure("Invalid task coordination Hook workspace root.");
      process.exitCode = 2;
      break;
    }
  } else if (argument === "--workspace-root") {
    workspaceRoot = String(process.argv[++index] || "");
  } else {
    writeFailure(`Unsupported task coordination Hook option: ${argument}`);
    process.exitCode = 2;
    break;
  }
}
if (!adapter) {
  writeFailure("Unsupported task coordination Hook provider.");
  process.exitCode = 2;
} else if (process.exitCode !== 2) {
  runHookStdin(provider, { workspaceRoot })
    .then((output) => process.stdout.write(`${JSON.stringify(output)}\n`))
    .catch((error) => {
      writeFailure(`Task coordination Hook failed closed: ${error.message}`);
      process.exitCode = 1;
    });
}
