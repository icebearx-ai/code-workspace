#!/usr/bin/env node

const { main } = require("../src/cli");
const { renderResult } = require("../src/cli/renderer");
const { failure } = require("../src/cli/result");

const json = process.argv.some((arg) => arg === "--json" || arg.startsWith("--json="));

main(process.argv)
  .then((result) => renderResult(result, { json }))
  .catch((error) => renderResult(failure(error), { json }));
