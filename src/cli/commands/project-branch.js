const { configPath, loadConfigProjection, resolveProjectConfigPath, updateProjectBranch } = require("../../core/config");
const { WorkspaceError } = require("../../core/errors");
const {
  assertRegisteredBranchSwitchAvailable,
  canonicalBranchState,
  inspectProjectBranch,
  inspectProjectBranchMatch,
  planRegisteredBranchAcquisition,
  switchProjectToRegisteredBranch,
} = require("../../core/project");
const { createFileTransaction } = require("../../core/transaction");
const { confirm } = require("../confirmation");
const { diagnosticFromError, fromDiagnostics, selectionResult, success } = require("../result");

function branchError(code, message, details = {}) {
  return new WorkspaceError(code, message, details);
}

function planAcceptActual(config, name, options = {}) {
  const inspected = (options.inspectProjectBranch || inspectProjectBranch)(config, name, options);
  return {
    action: inspected.matches ? "skip" : "update",
    project: inspected.project,
    before: canonicalBranchState(inspected),
    after: {
      registeredBranch: inspected.actualBranch,
      actualBranch: inspected.actualBranch,
    },
    worktreeClean: inspected.worktreeClean,
    registeredBranchExists: inspected.registeredBranchExists,
  };
}

function assertAcceptPlanCurrent(plan, observed) {
  const observedState = canonicalBranchState(observed);
  if (plan.before.registeredBranch === observedState.registeredBranch
      && plan.before.actualBranch === observedState.actualBranch) return;
  throw branchError(
    "PROJECT_BRANCH_PLAN_STALE",
    `Branch state changed while preparing to accept the actual branch for project ${plan.project.name}.`,
    {
      project: plan.project.name,
      location: plan.project.location,
      expectedState: plan.before,
      observedState,
      remediation: "Inspect the selected project branch state again before choosing a direction.",
    }
  );
}

function applyAcceptActual(root, plan, options = {}) {
  const load = options.loadConfigProjection || loadConfigProjection;
  const inspect = options.inspectProjectBranch || inspectProjectBranch;
  const currentConfig = load(root, ["projects"]);
  assertAcceptPlanCurrent(plan, inspect(currentConfig, plan.project.name, options));

  const transaction = createFileTransaction([configPath(root), resolveProjectConfigPath(root)]);
  try {
    (options.updateProjectBranch || updateProjectBranch)(root, {
      name: plan.project.name,
      before: plan.before,
      after: plan.after,
    }, options);
    options.injectFailure?.("after-config-save", plan);
    const persisted = load(root, ["projects"]);
    const observed = inspect(persisted, plan.project.name, options);
    const observedState = canonicalBranchState(observed);
    if (observedState.registeredBranch !== plan.after.registeredBranch
        || observedState.actualBranch !== plan.after.actualBranch) {
      throw branchError(
        "PROJECT_BRANCH_ACCEPT_VERIFY_FAILED",
        `Project ${plan.project.name} did not retain the planned registered and actual branch state.`,
        {
          project: plan.project.name,
          location: plan.project.location,
          expectedState: plan.after,
          observedState,
        }
      );
    }
    options.injectFailure?.("after-verify", observed);
    transaction.commit();
    return {
      action: "update",
      project: observed.project,
      before: plan.before,
      after: observedState,
      worktreeClean: observed.worktreeClean,
      registeredBranchExists: observed.registeredBranchExists,
    };
  } catch (error) {
    if (error.code === "PROJECT_BRANCH_ACCEPT_CONFLICT") {
      transaction.commit();
      throw error;
    }
    const failure = ["PROJECT_BRANCH_ACCEPT_CONFLICT", "PROJECT_BRANCH_ACCEPT_VERIFY_FAILED"].includes(error.code)
      ? error
      : branchError(
        "PROJECT_BRANCH_ACCEPT_FAILED",
        `Accepting the actual branch for project ${plan.project.name} was rolled back: ${error.message}`,
        {
          ...(error.details || {}),
          project: plan.project.name,
          location: plan.project.location,
          cause: error.code || error.name,
        }
      );
    transaction.rollback(failure);
    throw failure;
  }
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

function branchOperationOptions(options = {}, dependencies = {}) {
  return {
    ...dependencies,
    includeRemoteBranchCandidates: true,
    allowRemote: options.allowRemote ?? options["allow-remote"] ?? dependencies.allowRemote,
    remote: options.remote ?? dependencies.remote,
  };
}

function planUseRegistered(config, name, options = {}) {
  const inspected = (options.inspectProjectBranch || inspectProjectBranch)(config, name, { ...options, includeRemoteBranchCandidates: true });
  const acquisition = (options.planRegisteredBranchAcquisition || planRegisteredBranchAcquisition)(inspected, options);
  return { ...inspected, acquisition };
}

function useRegisteredConfirmation(plan) {
  const from = `${plan.project.name} from actual branch ${plan.actualBranch}`;
  if (plan.acquisition?.mode === "remote-tracking") {
    return `Create local branch ${plan.registeredBranch} tracking ${plan.acquisition.remoteBranch}, then switch ${from} to ${plan.registeredBranch}?`;
  }
  if (plan.acquisition?.mode === "fetched") {
    return `Fetch ${plan.acquisition.remote}/${plan.registeredBranch}, create local branch ${plan.registeredBranch} tracking ${plan.acquisition.remoteBranch}, then switch ${from} to ${plan.registeredBranch}?`;
  }
  return `Switch ${from} to registered branch ${plan.registeredBranch}?`;
}

function recordBatchFailure(slot, error, diagnostics) {
  diagnostics.push(diagnosticFromError(error, { project: slot.name }));
  slot.result = batchEntry(slot.name, false, "failed", null, error.message);
}

function branchMismatchError(inspected) {
  return branchError(
    "PROJECT_BRANCH_MISMATCH",
    `Project ${inspected.project.name} registered branch ${inspected.registeredBranch} does not match actual branch ${inspected.actualBranch}.`,
    {
      project: inspected.project.name,
      location: inspected.project.location,
      registeredBranch: inspected.registeredBranch,
      actualBranch: inspected.actualBranch,
      remediation: "Choose a branch reconciliation direction for the selected project, then retry branch verification.",
    }
  );
}

function batchBranchInspection(config, names, dependencies, diagnostics) {
  const slots = names.map((name) => ({ name }));
  for (const slot of slots) {
    try {
      const inspected = (dependencies.inspectProjectBranch || inspectProjectBranch)(config, slot.name, dependencies);
      slot.result = batchEntry(
        slot.name,
        true,
        "inspect",
        inspected,
        `${inspected.registeredBranch} -> ${inspected.actualBranch} (${inspected.matches ? "match" : "mismatch"})`
      );
    } catch (error) {
      recordBatchFailure(slot, error, diagnostics);
    }
  }
  return slots.map((slot) => slot.result);
}

function batchBranchVerification(config, names, dependencies, diagnostics) {
  const slots = names.map((name) => ({ name }));
  for (const slot of slots) {
    try {
      const inspected = (dependencies.inspectProjectBranchMatch || inspectProjectBranchMatch)(config, slot.name, dependencies);
      if (!inspected.matches) {
        const error = branchMismatchError(inspected);
        diagnostics.push(diagnosticFromError(error, { project: slot.name }));
        slot.result = batchEntry(slot.name, false, "failed", inspected, error.message);
        continue;
      }
      slot.result = batchEntry(
        slot.name,
        true,
        "verify",
        inspected,
        `registered and actual branches match: ${inspected.actualBranch}`
      );
    } catch (error) {
      recordBatchFailure(slot, error, diagnostics);
    }
  }
  return slots.map((slot) => slot.result);
}

async function batchAcceptActual(root, config, names, options, dependencies, diagnostics) {
  const slots = names.map((name) => ({ name }));
  for (const slot of slots) {
    try {
      slot.plan = planAcceptActual(config, slot.name, dependencies);
      if (slot.plan.action === "skip") {
        slot.result = batchEntry(
          slot.name,
          true,
          "skip",
          slot.plan,
          `registered and actual branches already match: ${slot.plan.after.actualBranch}`
        );
      }
    } catch (error) {
      recordBatchFailure(slot, error, diagnostics);
    }
  }
  const applicable = slots.filter((slot) => slot.plan?.action === "update");
  if (applicable.length > 0 && !(await confirm(
    [
      "Accept actual branches by updating these registered branches?",
      ...applicable.map((slot) => `- ${slot.name}: ${slot.plan.before.registeredBranch} -> ${slot.plan.after.registeredBranch}`),
    ].join("\n"),
    options
  ))) {
    throw branchError("CLI_CANCELLED", "Accepting the actual project branches was cancelled.");
  }
  for (const slot of applicable) {
    try {
      const applied = applyAcceptActual(root, slot.plan, dependencies);
      slot.result = batchEntry(
        slot.name,
        true,
        applied.action,
        applied,
        `accepted actual branch: ${slot.plan.before.registeredBranch} -> ${slot.plan.after.registeredBranch}`
      );
    } catch (error) {
      recordBatchFailure(slot, error, diagnostics);
    }
  }
  return slots.map((slot) => slot.result);
}

async function batchUseRegistered(config, names, options, dependencies, diagnostics) {
  const operationOptions = branchOperationOptions(options, dependencies);
  const slots = names.map((name) => ({ name }));
  for (const slot of slots) {
    try {
      slot.plan = planUseRegistered(config, slot.name, operationOptions);
      if (slot.plan.matches) {
        const skipped = {
          action: "skip",
          project: slot.plan.project,
          before: canonicalBranchState(slot.plan),
          after: canonicalBranchState(slot.plan),
          worktreeClean: slot.plan.worktreeClean,
          registeredBranchExists: slot.plan.registeredBranchExists,
        };
        slot.result = batchEntry(
          slot.name,
          true,
          "skip",
          skipped,
          `registered and actual branches already match: ${slot.plan.actualBranch}`
        );
      } else {
        if (slot.plan.acquisition?.mode === "local") assertRegisteredBranchSwitchAvailable(slot.plan);
      }
    } catch (error) {
      recordBatchFailure(slot, error, diagnostics);
    }
  }
  const applicable = slots.filter((slot) => slot.plan && !slot.result);
  if (applicable.length > 0 && !(await confirm(
    [
      "Switch these projects to their registered branches?",
      ...applicable.map((slot) => `- ${slot.name}: ${useRegisteredConfirmation(slot.plan)}`),
    ].join("\n"),
    options
  ))) {
    throw branchError("CLI_CANCELLED", "Using the registered project branches was cancelled.");
  }
  for (const slot of applicable) {
    try {
      const applied = (dependencies.switchProjectToRegisteredBranch || switchProjectToRegisteredBranch)(slot.plan, operationOptions);
      slot.result = batchEntry(
        slot.name,
        true,
        applied.action,
        applied,
        `switched to registered branch: ${slot.plan.registeredBranch}`
      );
    } catch (error) {
      recordBatchFailure(slot, error, diagnostics);
    }
  }
  return slots.map((slot) => slot.result);
}

async function executeProjectBranchSelection(invocation, action, command, dependencies) {
  const { config, options, root } = invocation;
  const selection = uniqueProjectSelection(invocation.args);
  const diagnostics = [...selection.diagnostics];
  let results;
  if (action === "inspect") {
    results = batchBranchInspection(config, selection.names, { ...dependencies, includeRemoteBranchCandidates: true }, diagnostics);
  } else if (action === "verify") {
    results = batchBranchVerification(config, selection.names, dependencies, diagnostics);
  } else if (action === "accept-actual") {
    results = await batchAcceptActual(root, config, selection.names, options, dependencies, diagnostics);
  } else if (action === "use-registered") {
    results = await batchUseRegistered(config, selection.names, options, dependencies, diagnostics);
  } else {
    throw branchError("CLI_UNKNOWN_COMMAND", `Unknown project branch command: ${action || "<missing>"}`);
  }
  return selectionResult(command, selection.requested, results, {
    diagnostics,
    text: batchText(results),
  });
}

async function executeProjectBranch(invocation) {
  const { args, config, options, root } = invocation;
  const action = invocation.definition.path[2];
  const command = `project.branch.${action}`;
  const dependencies = options.dependencies || {};
  const operationOptions = branchOperationOptions(options, dependencies);
  if (args.length > 1) return executeProjectBranchSelection(invocation, action, command, dependencies);
  if (action === "inspect") {
    const inspected = (dependencies.inspectProjectBranch || inspectProjectBranch)(config, args[0], { ...dependencies, includeRemoteBranchCandidates: true });
    return success(command, inspected,
      `${inspected.project.name}\t${inspected.registeredBranch}\t${inspected.actualBranch}\t${inspected.matches ? "match" : "mismatch"}`);
  }
  if (action === "verify") {
    const inspected = (dependencies.inspectProjectBranchMatch || inspectProjectBranchMatch)(config, args[0], dependencies);
    if (inspected.matches) {
      return success(command, inspected, `Branch verification passed for ${inspected.project.name}: ${inspected.actualBranch}`);
    }
    return fromDiagnostics(command, {
      diagnostics: [diagnosticFromError(branchMismatchError(inspected))],
    }, inspected, `Branch verification failed for ${inspected.project.name}.`);
  }
  if (action === "accept-actual") {
    const plan = planAcceptActual(config, args[0], dependencies);
    if (plan.action === "skip") {
      return success(command, plan, `Registered and actual branches already match for ${plan.project.name}: ${plan.after.actualBranch}`);
    }
    if (!(await confirm(
      `Accept actual branch for ${plan.project.name} by updating the registered branch from ${plan.before.registeredBranch} to ${plan.after.registeredBranch}?`,
      options
    ))) {
      throw branchError("CLI_CANCELLED", "Accepting the actual project branch was cancelled.");
    }
    const applied = applyAcceptActual(root, plan, dependencies);
    return success(command, applied,
      `Accepted actual branch for ${plan.project.name}: ${plan.before.registeredBranch} -> ${plan.after.registeredBranch}`);
  }
  if (action === "use-registered") {
    const inspected = planUseRegistered(config, args[0], operationOptions);
    if (inspected.matches) {
      const skipped = {
        action: "skip",
        project: inspected.project,
        before: canonicalBranchState(inspected),
        after: canonicalBranchState(inspected),
        worktreeClean: inspected.worktreeClean,
        registeredBranchExists: inspected.registeredBranchExists,
      };
      return success(command, skipped, `Registered and actual branches already match for ${inspected.project.name}: ${inspected.actualBranch}`);
    }
    if (inspected.acquisition?.mode === "local") assertRegisteredBranchSwitchAvailable(inspected);
    if (!(await confirm(
      useRegisteredConfirmation(inspected),
      options
    ))) {
      throw branchError("CLI_CANCELLED", "Using the registered project branch was cancelled.");
    }
    const applied = (dependencies.switchProjectToRegisteredBranch || switchProjectToRegisteredBranch)(inspected, operationOptions);
    return success(command, applied,
      `Switched ${inspected.project.name} to registered branch ${inspected.registeredBranch}`);
  }
  throw branchError("CLI_UNKNOWN_COMMAND", `Unknown project branch command: ${action || "<missing>"}`);
}

module.exports = {
  applyAcceptActual,
  assertAcceptPlanCurrent,
  batchAcceptActual,
  batchBranchInspection,
  batchBranchVerification,
  batchUseRegistered,
  executeProjectBranch,
  executeProjectBranchSelection,
  planAcceptActual,
  uniqueProjectSelection,
};
