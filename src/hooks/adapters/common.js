"use strict";

const crypto = require("node:crypto");

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

const HOOK_ADAPTER_CONTRACT_VERSION = 1;
const HOOK_ADAPTER_METHODS = Object.freeze([
  "nativeEvents",
  "nativeEventName",
  "normalizeInput",
  "eventTypeForNative",
  "classifyTool",
  "renderDeclaration",
  "renderDecision",
  "renderAcknowledgement",
  "renderFailure",
  "renderResponse",
]);

// These helpers deliberately live behind the Provider adaptor boundary.  The
// coordination core only receives the normalized values below; a Provider
// with a different native wire format can implement its own normalizer without
// adding another branch to the core.
const READ_ONLY_TOOLS = Object.freeze(new Set([
  "Read", "Glob", "Grep", "LS", "ListFiles", "WebFetch", "WebSearch",
  "NotebookRead", "Task", "TodoRead", "GetDiagnostics",
]));

const EXACT_TOOLS = Object.freeze(new Set([
  "Edit", "Write", "NotebookEdit", "MultiEdit", "CreateFile", "DeleteFile", "Patch",
]));

const SHELL_READ_ONLY_COMMANDS = Object.freeze(new Set([
  "pwd", "ls", "cat", "head", "tail", "grep", "rg", "find", "nl", "wc",
  "sed", "awk", "cut", "sort", "uniq", "tr", "stat", "file", "du", "df",
  "git", "printf", "echo", "test", "[", "true", "false", "exit",
  "which", "type", "basename", "dirname", "realpath", "readlink",
]));

const SHELL_CONTROL_WORDS = new Set(["if", "then", "else", "elif", "fi"]);

function readToolInput(input) {
  return input && typeof input === "object" ? input : {};
}

function extractPaths(value) {
  const input = readToolInput(value);
  const paths = [];
  const add = (entry) => { if (typeof entry === "string" && entry.trim()) paths.push(entry.trim()); };
  for (const key of ["file_path", "filePath", "path", "target", "filename", "directory", "dir"]) add(input[key]);
  for (const key of ["paths", "files", "filePaths", "targets"]) if (Array.isArray(input[key])) input[key].forEach(add);
  if (Array.isArray(input.edits)) input.edits.forEach((edit) => add(edit?.file_path || edit?.filePath || edit?.path));
  if (Array.isArray(input.files)) input.files.forEach((edit) => add(typeof edit === "string" ? edit : edit?.path || edit?.file_path));
  return [...new Set(paths)];
}

function shellWords(command) {
  // This is intentionally a conservative tokenizer.  Commands containing
  // command substitution or shell redirection are not classified as safe.
  return command.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) || [];
}

function shellCommandIsReadOnly(command) {
  const value = String(command || "").trim();
  if (!value || /`|\$\(|(^|\s)(?:>>?|<<?|\d+>>?|&>)/.test(value)) return false;
  const segments = value
    .replace(/\|\|/g, "\n")
    .replace(/&&/g, "\n")
    .replace(/[;|]/g, "\n")
    .split("\n")
    .map((segment) => segment.trim())
    .filter(Boolean);
  if (segments.length === 0) return false;
  for (const segment of segments) {
    const words = shellWords(segment);
    while (words.length > 0 && SHELL_CONTROL_WORDS.has(words[0])) words.shift();
    if (words.length === 0) continue;
    const commandName = words[0];
    if (!SHELL_READ_ONLY_COMMANDS.has(commandName)) return false;
    if (commandName === "git") {
      const subcommand = words.find((word) => !word.startsWith("-") && word !== "git");
      if (!["status", "diff", "log", "show", "branch", "rev-parse", "ls-files", "ls-tree", "describe", "remote", "tag"].includes(subcommand)) return false;
    }
    if (commandName === "sed" && words.some((word) => ["-i", "-I", "--in-place"].includes(word) || word.startsWith("-i") || /\bw\s+/.test(word.replace(/^['\"]|['\"]$/g, "")))) return false;
    if (commandName === "awk" && /\bsystem\s*\(/.test(segment)) return false;
    if (commandName === "find" && words.some((word) => ["-delete", "-exec", "-execdir", "-ok", "-okdir"].includes(word))) return false;
  }
  return true;
}

function classifyTool(tool = {}) {
  const name = String(tool.name || tool.toolName || "");
  const input = readToolInput(tool.input || tool.toolInput);
  if (READ_ONLY_TOOLS.has(name)) return { kind: "read-only", scopes: [] };
  if (EXACT_TOOLS.has(name)) {
    const paths = extractPaths(input);
    if (paths.length === 0) return { kind: "unknown-write", scopes: [{ type: "PROJECT_WIDE" }] };
    return { kind: paths.length > 1 ? "multi-file" : "exact", scopes: paths.map((entry) => ({ type: "EXACT_FILE", path: entry })) };
  }
  if (/^(bash|shell|shell_command|local_shell|command|exec|exec_command|run|run_shell_command|terminal)$/i.test(name)) {
    const command = String(input.command || input.cmd || input.script || "").trim();
    if (shellCommandIsReadOnly(command)) return { kind: "read-only", scopes: [] };
    return { kind: "unknown-write", scopes: [{ type: "PROJECT_WIDE" }] };
  }
  // Unknown tools are never implicitly considered safe.
  return { kind: "unknown-write", scopes: [{ type: "PROJECT_WIDE" }] };
}

function firstValue(source, keys, fallback = null) {
  for (const key of keys) {
    const value = source?.[key];
    if (value !== undefined && value !== null && String(value).trim() !== "") return value;
  }
  return fallback;
}

function normalizeProviderInput(input, options = {}) {
  const source = input && typeof input === "object" ? input : {};
  const nativeEventName = String(firstValue(source, ["hook_event_name", "hookEventName", "event_name", "eventName", "type"], options.nativeEventName || "Unknown"));
  const nativeSessionId = firstValue(source, ["session_id", "sessionId", "session"], options.nativeSessionId || null);
  const operationId = firstValue(source, ["operation_id", "operationId", "tool_use_id", "tool_call_id", "toolUseId", "toolCallId"], null);
  const toolInput = firstValue(source, ["tool_input", "toolInput", "input"], source.tool?.input || {});
  const toolName = firstValue(source, ["tool_name", "toolName", "name"], source.tool?.name || null);
  return {
    nativeEventName,
    nativeSessionId,
    eventId: firstValue(source, ["event_id", "eventId", "eventID"], null),
    operationId,
    workspaceUuid: firstValue(source, ["workspace_uuid", "workspaceUuid"], options.workspaceUuid || null),
    cwd: firstValue(source, ["cwd", "working_directory", "workingDirectory"], process.cwd()),
    occurredAt: firstValue(source, ["occurred_at", "occurredAt"], null),
    agent: {
      isSubagent: source.is_subagent === true || source.isSubagent === true || source.agent?.isSubagent === true || Boolean(source.agent_id || source.agentId),
      agentId: firstValue(source, ["agent_id", "agentId"], source.agent?.agentId || null),
      agentType: firstValue(source, ["agent_type", "agentType"], source.agent?.agentType || null),
      parentSessionId: firstValue(source, ["parent_session_id", "parentSessionId"], source.agent?.parentSessionId || null),
    },
    tool: { callId: operationId, name: toolName, input: toolInput && typeof toolInput === "object" ? toolInput : {} },
    generation: source.generation,
    success: typeof source.success === "boolean" ? source.success : undefined,
    phase: source.phase,
    runtimeEvidence: firstValue(source, ["runtime_evidence", "runtimeEvidence"], {}),
    processEvidence: firstValue(source, ["process_evidence", "processEvidence"], null),
  };
}

function stableEventId(provider, input) {
  const source = input && typeof input === "object" ? input : {};
  return source.event_id || source.eventId || source.eventID || crypto.createHash("sha256").update(JSON.stringify(canonicalize({ provider, input: source }))).digest("hex");
}

function operationId(input) {
  const source = input && typeof input === "object" ? input : {};
  return source.operation_id || source.operationId || source.tool_use_id || source.tool_call_id || source.toolUseId || source.toolCallId || null;
}

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

module.exports = {
  ABSTRACT_HOOK_EVENTS,
  EVENT_ALIASES,
  HOOK_ADAPTER_CONTRACT_VERSION,
  HOOK_ADAPTER_METHODS,
  READ_ONLY_TOOLS,
  EXACT_TOOLS,
  normalizeAbstractEvent,
  normalizeProviderInput,
  stableEventId,
  operationId,
  classifyTool,
  extractPaths,
  canonicalize,
  canonicalJson,
};
