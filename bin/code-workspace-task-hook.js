#!/usr/bin/env node
"use strict";

const { runHookStdin } = require("../src/core/task-coordination-protocol");

const provider = String(process.argv[2] || "").toLowerCase();
let workspaceRoot = process.cwd();
for (let index = 3; index < process.argv.length; index += 1) {
  const argument = process.argv[index];
  if (argument === "--workspace-root-b64") {
    const encoded = process.argv[++index];
    try {
      workspaceRoot = Buffer.from(String(encoded || ""), "base64url").toString("utf8");
      if (!workspaceRoot) throw new Error("empty path");
    } catch {
      process.stdout.write(JSON.stringify({ decision: "block", reason: "Invalid task coordination Hook workspace root." }) + "\n");
      process.exitCode = 2;
      break;
    }
  } else if (argument === "--workspace-root") {
    workspaceRoot = String(process.argv[++index] || "");
  } else {
    process.stdout.write(JSON.stringify({ decision: "block", reason: `Unsupported task coordination Hook option: ${argument}` }) + "\n");
    process.exitCode = 2;
    break;
  }
}
if (!["codex", "claude"].includes(provider)) {
  process.stdout.write(JSON.stringify({ decision: "block", reason: "Unsupported task coordination Hook provider." }) + "\n");
  process.exitCode = 2;
} else if (process.exitCode !== 2) {
  runHookStdin(provider, { workspaceRoot })
    .then((output) => process.stdout.write(`${JSON.stringify(output)}\n`))
    .catch((error) => {
      process.stdout.write(`${JSON.stringify({ decision: "block", reason: `Task coordination Hook failed closed: ${error.message}` })}\n`);
      process.exitCode = 1;
    });
}
