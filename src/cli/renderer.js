const { jsonEnvelope } = require("./result");

function renderResult(result, options = {}) {
  const stdout = options.stdout || process.stdout;
  const stderr = options.stderr || process.stderr;
  if (options.json) {
    stdout.write(`${JSON.stringify(jsonEnvelope(result), null, 2)}\n`);
  } else {
    for (const diagnostic of result.diagnostics) {
      const stream = diagnostic.severity === "warning" ? stderr : diagnostic.severity === "error" ? stderr : stdout;
      stream.write(`${diagnostic.severity === "warning" ? "WARN" : diagnostic.severity === "error" ? "ERROR" : "INFO"} ${diagnostic.message}\n`);
      if (diagnostic.remediation) stream.write(`REMEDIATION ${diagnostic.remediation}\n`);
    }
    if (result.ok && result.text) stdout.write(result.text.endsWith("\n") ? result.text : `${result.text}\n`);
  }
  if (!result.ok) process.exitCode = 1;
  return result;
}

module.exports = { renderResult };
