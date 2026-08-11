function result() {
  return { errors: [], warnings: [], diagnostics: [] };
}

function add(target, severity, code, message, details = {}) {
  target.diagnostics.push({ code, severity, message, ...details });
  if (severity === "error") target.errors.push(message);
  if (severity === "warning") target.warnings.push(message);
}

function payload(target, extra = {}) {
  return {
    schemaVersion: 1,
    ok: target.errors.length === 0,
    diagnostics: target.diagnostics,
    ...extra,
  };
}

module.exports = { add, payload, result };
