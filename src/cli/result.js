const { WorkspaceError } = require("../core/errors");

const RESULT_SCHEMA_VERSION = 1;

function commandName(command) {
  if (Array.isArray(command)) return command.join(".");
  return command ? String(command) : null;
}

function normalizeDiagnostic(entry) {
  if (!entry || typeof entry !== "object") {
    return { code: "CLI_DIAGNOSTIC_INVALID", severity: "error", message: String(entry) };
  }
  const { code, severity, message, details, ...rest } = entry;
  return {
    code: code || "CLI_ERROR",
    severity: severity || "error",
    message: message || "Unknown command diagnostic",
    ...rest,
    ...(details && typeof details === "object" ? details : {}),
  };
}

function commandResult(command, data = null, options = {}) {
  const diagnostics = (options.diagnostics || []).map(normalizeDiagnostic);
  const ok = options.ok ?? !diagnostics.some((entry) => entry.severity === "error");
  return {
    schemaVersion: RESULT_SCHEMA_VERSION,
    ok,
    command: commandName(command),
    data: data ?? null,
    diagnostics,
    text: options.text || "",
    renderTextOnError: options.renderTextOnError === true,
  };
}

function success(command, data = null, text = "", diagnostics = []) {
  return commandResult(command, data, { ok: true, text, diagnostics });
}

function fromDiagnostics(command, output, data = null, text = "") {
  return commandResult(command, data, {
    ok: !output.diagnostics.some((entry) => entry.severity === "error"),
    diagnostics: output.diagnostics,
    text,
  });
}

function failure(error, command = null) {
  const source = error instanceof Error ? error : new WorkspaceError("CLI_ERROR", String(error));
  return commandResult(command, null, {
    ok: false,
    diagnostics: [{
      code: source.code || "CLI_ERROR",
      severity: "error",
      message: source.message,
      details: source.details,
    }],
  });
}

function diagnosticFromError(error, details = {}) {
  const source = error instanceof Error ? error : new WorkspaceError("CLI_ERROR", String(error));
  return normalizeDiagnostic({
    code: source.code || "CLI_ERROR",
    severity: "error",
    message: source.message,
    details: {
      ...details,
      ...(source.details || {}),
    },
  });
}

function selectionResult(command, requested, results, options = {}) {
  const diagnostics = options.diagnostics || [];
  const summary = {
    total: results.length,
    succeeded: results.filter((entry) => entry.ok && entry.action !== "skip").length,
    skipped: results.filter((entry) => entry.ok && entry.action === "skip").length,
    failed: results.filter((entry) => !entry.ok).length,
  };
  return commandResult(command, {
    scope: "selection",
    requested,
    results,
    summary,
  }, {
    ok: summary.failed === 0 && !diagnostics.some((entry) => (entry.severity || "error") === "error"),
    diagnostics,
    text: options.text || "",
    renderTextOnError: true,
  });
}

function jsonEnvelope(result) {
  return {
    schemaVersion: result.schemaVersion,
    ok: result.ok,
    command: result.command,
    data: result.data,
    diagnostics: result.diagnostics,
  };
}

module.exports = {
  RESULT_SCHEMA_VERSION,
  commandName,
  commandResult,
  diagnosticFromError,
  failure,
  fromDiagnostics,
  jsonEnvelope,
  normalizeDiagnostic,
  selectionResult,
  success,
};
