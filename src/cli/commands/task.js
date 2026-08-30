"use strict";

const yaml = require("js-yaml");

const { WorkspaceError } = require("../../core/errors");
const coordination = require("../../core/task-coordination");
const { confirm } = require("../confirmation");
const { success } = require("../result");

function commandFor(path) {
  return path.join(".");
}

function context(invocation) {
  const workspaceUuid = invocation.config?.workspace?.uuid;
  if (!workspaceUuid) throw new WorkspaceError("WORKSPACE_IDENTITY_INVALID", "Workspace identity is required for task coordination commands.", { remediation: "Run code-w doctor --json and repair workspace identity." });
  return {
    workspaceRoot: invocation.root,
    workspaceUuid,
    stateDirectory: invocation.options?.stateDirectory,
  };
}

function textBlock(value) {
  return yaml.dump(value, { lineWidth: -1, noRefs: true, sortKeys: false });
}

async function executeDecision(action, requestId, invocation) {
  const options = invocation.options || {};
  const base = context(invocation);
  const plan = coordination.planDecision(requestId, action, base);
  if (!(await confirm(`Apply task decision ${action} to ${requestId}?`, options))) throw new WorkspaceError("CLI_CANCELLED", "Task decision cancelled.");
  const applied = await coordination.applyDecision(plan, base);
  const inspected = coordination.inspectDecision(requestId, base);
  if (inspected.decision.status !== "RESOLVED" || inspected.decision.resolution !== action) {
    throw new WorkspaceError("TASK_DECISION_POSTCONDITION_FAILED", "Task decision was not fully persisted and verified.", { decisionRequestId: requestId, action, remediation: "Run task decision show and retry after inspecting the ledger." });
  }
  const retry = applied.retryRequired ? " Retry the original Agent operation." : "";
  return success(commandFor(["task", "decision", action]), { ...applied, inspected }, `Applied task decision ${action} for ${requestId}.${retry}`);
}

async function executeTask(invocation) {
  const path = invocation.definition.path;
  const action = path[1];
  const base = context(invocation);
  if (action === "list") {
    const result = coordination.inspectTasks(base);
    const text = result.tasks.length === 0 ? "No coordinated tasks." : result.tasks.map((task) => `${task.taskId}\t${task.provider}\t${task.status}\t${task.phase}\t${task.lastSeenAt}`).join("\n");
    return success("task.list", result, text);
  }
  if (action === "show") {
    const task = coordination.inspectTask(invocation.args[0], base);
    return success("task.show", { task }, textBlock(task));
  }
  if (action === "lock" && path[2] === "list") {
    const result = coordination.inspectLocks(base);
    const text = result.claims.length === 0 ? "No active task claims." : result.claims.filter((claim) => claim.enforcement).map((claim) => `${claim.claimId}\t${claim.type}\t${claim.taskId}\t${claim.scope.type}\t${claim.scope.path}`).join("\n");
    return success("task.lock.list", result, text);
  }
  if (action === "decision") {
    const verb = path[2];
    const requestId = invocation.args[0];
    if (verb === "show") {
      const result = coordination.inspectDecision(requestId, base);
      return success("task.decision.show", result, textBlock(result));
    }
    if (["keep", "approve", "release", "abandon"].includes(verb)) {
      const map = { keep: "KEEP", approve: "APPROVE_PROJECT_PARALLEL", release: "RELEASE_CLAIM", abandon: "ABANDON_TASK_AND_RELEASE" };
      return executeDecision(map[verb], requestId, invocation);
    }
  }
  throw new WorkspaceError("CLI_UNKNOWN_COMMAND", `Unknown task command: ${path.join(" ")}`);
}

module.exports = { executeTask };
