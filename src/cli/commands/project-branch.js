const { configPath, loadConfigProjection, updateProjectBranch } = require("../../core/config");
const { WorkspaceError } = require("../../core/errors");
const {
  assertRegisteredBranchSwitchAvailable,
  canonicalBranchState,
  inspectProjectBranch,
  switchProjectToRegisteredBranch,
} = require("../../core/project");
const { createFileTransaction } = require("../../core/transaction");
const { confirm } = require("../confirmation");
const { success } = require("../result");

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

  const transaction = createFileTransaction([configPath(root)]);
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

async function executeProjectBranch(invocation) {
  const { args, config, options, root } = invocation;
  const action = invocation.definition.path[2];
  const command = `project.branch.${action}`;
  const dependencies = options.dependencies || {};
  if (action === "inspect") {
    const inspected = (dependencies.inspectProjectBranch || inspectProjectBranch)(config, args[0], dependencies);
    return success(command, inspected,
      `${inspected.project.name}\t${inspected.registeredBranch}\t${inspected.actualBranch}\t${inspected.matches ? "match" : "mismatch"}`);
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
    const inspected = (dependencies.inspectProjectBranch || inspectProjectBranch)(config, args[0], dependencies);
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
    assertRegisteredBranchSwitchAvailable(inspected);
    if (!(await confirm(
      `Switch project ${inspected.project.name} from actual branch ${inspected.actualBranch} to registered branch ${inspected.registeredBranch}?`,
      options
    ))) {
      throw branchError("CLI_CANCELLED", "Using the registered project branch was cancelled.");
    }
    const applied = (dependencies.switchProjectToRegisteredBranch || switchProjectToRegisteredBranch)(inspected, dependencies);
    return success(command, applied,
      `Switched ${inspected.project.name} to registered branch ${inspected.registeredBranch}`);
  }
  throw branchError("CLI_UNKNOWN_COMMAND", `Unknown project branch command: ${action || "<missing>"}`);
}

module.exports = {
  applyAcceptActual,
  assertAcceptPlanCurrent,
  executeProjectBranch,
  planAcceptActual,
};
