#!/usr/bin/env node
"use strict";

const { runHookStdin } = require("../src/core/task-coordination-protocol");

const provider = String(process.argv[2] || "").toLowerCase();
if (!["codex", "claude"].includes(provider)) {
  process.stdout.write(JSON.stringify({ decision: "block", reason: "Unsupported task coordination Hook provider." }) + "\n");
  process.exitCode = 2;
} else {
  runHookStdin(provider, { workspaceRoot: process.cwd() })
    .then((output) => process.stdout.write(`${JSON.stringify(output)}\n`))
    .catch((error) => {
      process.stdout.write(`${JSON.stringify({ decision: "block", reason: `Task coordination Hook failed closed: ${error.message}` })}\n`);
      process.exitCode = 1;
    });
}
