#!/usr/bin/env node
"use strict";

const { beforeWrite } = require("../src/core/task-coordination");

const chunks = [];
process.stdin.on("data", (chunk) => chunks.push(chunk));
process.stdin.on("end", async () => {
  try {
    const input = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
    const result = await beforeWrite(input);
    process.stdout.write(`${JSON.stringify({ ok: true, result })}\n`);
  } catch (error) {
    process.stdout.write(`${JSON.stringify({ ok: false, error: { code: error.code || "TASK_COORDINATION_FAILED", message: error.message, details: error.details || {} } })}\n`);
    process.exitCode = 1;
  }
});
