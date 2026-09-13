#!/usr/bin/env node

const { main } = require("../src/cli");
const { hostJsonRequested } = require("../src/cli/parser");
const { renderResult } = require("../src/cli/renderer");
const { failure } = require("../src/cli/result");

const json = hostJsonRequested(process.argv);

main(process.argv)
  .then((result) => renderResult(result, { json }))
  .catch((error) => renderResult(failure(error), { json }));
