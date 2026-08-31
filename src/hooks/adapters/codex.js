"use strict";

const { ABSTRACT_HOOK_EVENTS, normalizeAbstractEvent } = require("./common");

const provider = "codex";
const target = ".codex/hooks.json";
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
  return "task.activity";
}

function renderDecision(result) {
  const decision = result?.decision || "RETRY_COORDINATION_FAILURE";
  if (decision === "ALLOW") return { decision: "allow", hookSpecificOutput: { schemaVersion: 1, decision: "ALLOW" } };
  const reason = result?.remediation || "Task coordination blocked this operation.";
  return {
    decision: "block",
    reason,
    decisionRequestId: result?.decisionRequestId || null,
    hookSpecificOutput: { schemaVersion: 1, decision, decisionRequestId: result?.decisionRequestId || null },
  };
}

module.exports = { provider, target, ABSTRACT_HOOK_EVENTS, EVENT_MAP, nativeEvents, renderDeclaration, eventTypeForNative, renderDecision };
