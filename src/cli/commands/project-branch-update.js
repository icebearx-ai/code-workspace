const { WorkspaceError } = require("../../core/errors");
const {
  applyLatestBranchUpdate,
  planLatestBranchUpdate,
} = require("../../core/project-branch-update");
const {
  diagnosticFromError,
  selectionResult,
  success,
} = require("../result");

function updateError(code, message, details = {}) {
  return new WorkspaceError(code, message, details);
}

function uniqueProjectSelection(args) {
  const requested = [...args];
  const names = [];
  const diagnostics = [];
  const seen = new Set();
  for (const name of requested) {
    if (!seen.has(name)) {
      seen.add(name);
      names.push(name);
      continue;
    }
    diagnostics.push({
      code: "CLI_DUPLICATE_ARGUMENT",
      severity: "warning",
      message: `Project ${name} was provided more than once; later occurrences were ignored.`,
      project: name,
      argument: "name",
    });
  }
  return { requested, names, diagnostics };
}

function batchEntry(project, ok, action, data, message) {
  return { project, ok, action, data: data || null, message };
}

function batchText(results) {
  const lines = results.map((entry) => `${entry.ok ? (entry.action === "skip" ? "SKIP" : "OK") : "FAILED"}\t${entry.project}\t${entry.message}`);
  const succeeded = results.filter((entry) => entry.ok && entry.action !== "skip").length;
  const skipped = results.filter((entry) => entry.ok && entry.action === "skip").length;
  const failed = results.filter((entry) => !entry.ok).length;
  return [...lines, `Summary\ttotal=${results.length}\tsucceeded=${succeeded}\tskipped=${skipped}\tfailed=${failed}`].join("\n");
}

function recordFailure(slot, error, diagnostics) {
  diagnostics.push(diagnosticFromError(error, { project: slot.name }));
  slot.result = batchEntry(slot.name, false, "failed", null, error.message);
}

function resultMessage(data) {
  if (data.action === "skip" && data.reason === "disabled") return "latest-branch update disabled";
  if (data.action === "skip" && data.reason === "already-latest") return `already latest: ${data.afterHead || data.targetHead}`;
  return `fast-forwarded ${data.project?.name || "project"}: ${data.beforeHead} -> ${data.afterHead}`;
}

function executeSingle(invocation, dependencies) {
  const { config, root, args } = invocation;
  const plan = (dependencies.planLatestBranchUpdate || planLatestBranchUpdate)(config, args[0], dependencies);
  const applied = (dependencies.applyLatestBranchUpdate || applyLatestBranchUpdate)(root, plan, dependencies);
  return success("project.branch.update-latest", applied, resultMessage(applied));
}

function executeBatch(invocation, dependencies) {
  const { config, root } = invocation;
  const selection = uniqueProjectSelection(invocation.args);
  const diagnostics = [...selection.diagnostics];
  const slots = selection.names.map((name) => ({ name }));
  for (const slot of slots) {
    try {
      slot.plan = (dependencies.planLatestBranchUpdate || planLatestBranchUpdate)(config, slot.name, dependencies);
    } catch (error) {
      recordFailure(slot, error, diagnostics);
    }
  }
  for (const slot of slots.filter((entry) => entry.plan && !entry.result)) {
    try {
      const applied = (dependencies.applyLatestBranchUpdate || applyLatestBranchUpdate)(root, slot.plan, dependencies);
      slot.result = batchEntry(slot.name, true, applied.action, applied, resultMessage(applied));
    } catch (error) {
      recordFailure(slot, error, diagnostics);
    }
  }
  return selectionResult("project.branch.update-latest", selection.requested, slots.map((slot) => slot.result), {
    diagnostics,
    text: batchText(slots.map((slot) => slot.result)),
  });
}

function executeProjectBranchUpdateLatest(invocation) {
  const dependencies = invocation.options.dependencies || {};
  if (invocation.args.length > 1) return executeBatch(invocation, dependencies);
  if (invocation.args.length !== 1) throw updateError("CLI_ARGUMENT_REQUIRED", "project branch update-latest requires <name>", { argument: "name" });
  return executeSingle(invocation, dependencies);
}

module.exports = {
  batchText,
  executeProjectBranchUpdateLatest,
  executeBatch,
  executeSingle,
  uniqueProjectSelection,
};
