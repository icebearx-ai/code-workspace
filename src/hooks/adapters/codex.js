"use strict";

const {
  ABSTRACT_HOOK_EVENTS,
  HOOK_ADAPTER_CONTRACT_VERSION,
  normalizeAbstractEvent,
  normalizeProviderInput,
  classifyTool,
} = require("./common");

const provider = "codex";
const contractVersion = HOOK_ADAPTER_CONTRACT_VERSION;
const target = ".codex/hooks.json";
const coordinationTemplate = "artifacts/templates/codex/task-coordination-hooks.json";
const coordinationArtifact = ".codex/task-coordination-hooks.json";
const EVENT_MAP = Object.freeze({
  "task.started": ["SessionStart"],
  "task.activity": ["UserPromptSubmit", "PermissionRequest"],
  "write.before": ["PreToolUse"],
  "write.after": ["PostToolUse"],
  "task.turn-ended": ["Stop"],
  "task.ended": ["SessionEnd"],
  "task.subagent-started": ["SubagentStart"],
  "task.subagent-ended": ["SubagentStop"],
});

function nativeEvents(event) {
  return EVENT_MAP[normalizeAbstractEvent(event)] || [];
}

function nativeEventName(input, options = {}) {
  return normalizeProviderInput(input, options).nativeEventName;
}

function normalizeInput(input, options = {}) {
  const normalized = normalizeProviderInput(input, options);
  if (/Failure$/i.test(normalized.nativeEventName)) normalized.success = false;
  return normalized;
}

function renderEntry(declaration) {
  const hook = { type: "command", command: declaration.command };
  if (declaration.timeoutMs !== undefined) hook.timeout = declaration.timeoutMs;
  const entry = { hooks: [hook] };
  if (declaration.matcher !== undefined) entry.matcher = declaration.matcher;
  return entry;
}

function renderDeclaration(declaration) {
  const entry = renderEntry(declaration);
  return Object.fromEntries(nativeEvents(declaration.event).map((event) => [event, [structuredClone(entry)]]));
}

function eventTypeForNative(nativeEventName) {
  if (/^SessionStart$/i.test(nativeEventName)) return "task.started";
  if (/^SessionEnd$/i.test(nativeEventName)) return "task.ended";
  if (/^Stop(?:Failure)?$/i.test(nativeEventName)) return "task.turn-ended";
  if (/^PermissionRequest$/i.test(nativeEventName) || /^UserPromptSubmit$/i.test(nativeEventName)) return "task.activity";
  if (/^PreToolUse$/i.test(nativeEventName)) return "write.before";
  if (/^PostToolUse(?:Failure)?$/i.test(nativeEventName)) return "write.after";
  if (/^SubagentStart$/i.test(nativeEventName)) return "task.subagent-started";
  if (/^SubagentStop$/i.test(nativeEventName)) return "task.subagent-ended";
  return null;
}

function renderDecision(result) {
  const decision = result?.decision || "RETRY_COORDINATION_FAILURE";
  if (decision === "ALLOW") {
    return { hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "allow" } };
  }
  const reason = String(result?.remediation || "Task coordination blocked this operation.").trim() || "Task coordination blocked this operation.";
  return {
    decision: "block",
    reason,
    hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: reason },
  };
}

function renderAcknowledgement() {
  return {};
}

function renderFailure(result) {
  const reason = String(result?.remediation || "Task coordination Hook failed closed.").trim() || "Task coordination Hook failed closed.";
  return { decision: "block", reason };
}

function renderResponse({ eventType, result } = {}) {
  if (!eventType) return renderFailure(result);
  return eventType === "write.before" ? renderDecision(result) : renderAcknowledgement(eventType, result);
}

module.exports = {
  provider,
  contractVersion,
  target,
  coordinationTemplate,
  coordinationArtifact,
  ABSTRACT_HOOK_EVENTS,
  EVENT_MAP,
  nativeEvents,
  nativeEventName,
  normalizeInput,
  classifyTool,
  renderDeclaration,
  eventTypeForNative,
  renderDecision,
  renderAcknowledgement,
  renderFailure,
  renderResponse,
};
