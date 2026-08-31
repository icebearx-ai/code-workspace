"use strict";

// Abstract events are intentionally provider-neutral.  A provider adaptor
// expands these into the native event names accepted by its Hook runner.
const ABSTRACT_HOOK_EVENTS = Object.freeze([
  "task.started",
  "task.activity",
  "write.before",
  "write.after",
  "task.turn-ended",
  "task.ended",
  "task.subagent-started",
  "task.subagent-ended",
]);

const EVENT_ALIASES = Object.freeze({
  "session.start": "task.started",
  "session.activity": "task.activity",
  "session.end": "task.ended",
  "turn.end": "task.turn-ended",
  "subagent.start": "task.subagent-started",
  "subagent.end": "task.subagent-ended",
  "pre-write": "write.before",
  "post-write": "write.after",
});

function normalizeAbstractEvent(value) {
  const event = String(value || "").trim();
  const normalized = EVENT_ALIASES[event] || event;
  if (!ABSTRACT_HOOK_EVENTS.includes(normalized)) {
    const error = new Error(`Unsupported abstract Hook event: ${event || "<missing>"}`);
    error.code = "HOOK_EVENT_UNSUPPORTED";
    error.details = { event: event || null, supported: ABSTRACT_HOOK_EVENTS.slice() };
    throw error;
  }
  return normalized;
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]));
}

function canonicalJson(value) {
  return JSON.stringify(canonicalize(value));
}

module.exports = { ABSTRACT_HOOK_EVENTS, EVENT_ALIASES, normalizeAbstractEvent, canonicalize, canonicalJson };
