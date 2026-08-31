"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const { WorkspaceError } = require("./errors");
const { findWorkspaceRoot, loadConfigProjection } = require("./config");
const { beforeWrite, afterWrite, applyTaskEvent, DECISIONS, SCOPE_TYPES, eventKey, taskIdFor } = require("./task-coordination");
const { getAdapter: getHookAdapter } = require("../hooks/adapters");

const PROTOCOL_SCHEMA_VERSION = 1;

function stableJson(value) {
  if (Array.isArray(value)) return value.map(stableJson);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableJson(value[key])]));
}

function stableEventId(provider, input) {
  return input.event_id || input.eventId || input.eventID || crypto.createHash("sha256").update(JSON.stringify(stableJson({ provider, input }))).digest("hex");
}

function operationId(input) {
  return input.operation_id || input.operationId || input.tool_use_id || input.tool_call_id || input.toolUseId || input.toolCallId || null;
}

const READ_ONLY_TOOLS = new Set(["Read", "Glob", "Grep", "LS", "ListFiles", "WebFetch", "WebSearch", "NotebookRead", "Task", "TodoRead", "GetDiagnostics"]);
const EXACT_TOOLS = new Set(["Edit", "Write", "NotebookEdit", "MultiEdit", "CreateFile", "DeleteFile", "Patch"]);

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

function classifyTool(tool = {}) {
  const name = String(tool.name || tool.toolName || "");
  const input = readToolInput(tool.input || tool.toolInput);
  if (READ_ONLY_TOOLS.has(name)) return { kind: "read-only", scopes: [] };
  if (EXACT_TOOLS.has(name)) {
    const paths = extractPaths(input);
    if (paths.length === 0) return { kind: "unknown-write", scopes: [{ type: "PROJECT_WIDE" }] };
    return { kind: paths.length > 1 ? "multi-file" : "exact", scopes: paths.map((entry) => ({ type: "EXACT_FILE", path: entry })) };
  }
  if (/^(bash|shell|command|exec|run|terminal)$/i.test(name)) {
    const command = String(input.command || input.cmd || input.script || "").trim();
    if (/^(pwd|ls(?:\s|$)|cat\s|head\s|tail\s|grep\s|git\s+(status|diff|log|show|branch)|printf\s|echo\s)/i.test(command)) return { kind: "read-only", scopes: [] };
    return { kind: "unknown-write", scopes: [{ type: "PROJECT_WIDE" }] };
  }
  // Unknown tools are never implicitly considered safe.
  return { kind: "unknown-write", scopes: [{ type: "PROJECT_WIDE" }] };
}

function normalizeEnvelope(provider, input, options = {}) {
  const providerAdapter = getHookAdapter(provider);
  const source = input && typeof input === "object" ? input : {};
  const nativeEventName = source.hook_event_name || source.hookEventName || source.event_name || source.eventName || source.type || options.nativeEventName || "Unknown";
  const session = source.session_id || source.sessionId || source.session || options.nativeSessionId;
  if (!session) throw new WorkspaceError("HOOK_SESSION_ID_MISSING", "Hook input does not contain a native session id.");
  const eventId = stableEventId(provider, source);
  const op = operationId(source);
  const eventType = providerAdapter.eventTypeForNative(nativeEventName);
  const tool = {
    callId: op,
    name: source.tool_name || source.toolName || source.name || source.tool?.name || null,
    input: source.tool_input || source.toolInput || source.input || source.tool?.input || {},
  };
  const agent = {
    isSubagent: source.is_subagent === true || source.isSubagent === true || source.agent?.isSubagent === true || Boolean(source.agent_id || source.agentId),
    agentId: source.agent_id || source.agentId || source.agent?.agentId || null,
    agentType: source.agent_type || source.agentType || source.agent?.agentType || null,
    parentSessionId: source.parent_session_id || source.parentSessionId || source.agent?.parentSessionId || null,
  };
  const envelope = {
    schemaVersion: PROTOCOL_SCHEMA_VERSION,
    eventId,
    eventType,
    provider,
    nativeEventName,
    nativeSessionId: session,
    workspaceUuid: source.workspace_uuid || source.workspaceUuid || options.workspaceUuid || null,
    cwd: source.cwd || process.cwd(),
    occurredAt: source.occurred_at || source.occurredAt || new Date().toISOString(),
    agent,
    tool,
    operationId: op || (eventType === "write.before" || eventType === "write.after" ? crypto.createHash("sha256").update(`${eventId}\u0000${tool.name || ""}`).digest("hex") : null),
    generation: source.generation,
    success: eventType === "write.after" ? !(/Failure$/i.test(nativeEventName)) && source.success !== false : undefined,
    phase: source.phase,
    runtimeEvidence: source.runtime_evidence || source.runtimeEvidence || {},
    processEvidence: source.process_evidence || source.processEvidence || null,
  };
  if (!envelope.workspaceUuid && options.workspaceConfig?.workspace?.uuid) envelope.workspaceUuid = options.workspaceConfig.workspace.uuid;
  if (!envelope.workspaceUuid) throw new WorkspaceError("HOOK_WORKSPACE_UUID_MISSING", "Hook input does not contain workspaceUuid and no workspace identity was supplied.");
  return envelope;
}

function renderNativeDecision(provider, result) {
  const providerAdapter = getHookAdapter(provider);
  const decision = result?.decision || "RETRY_COORDINATION_FAILURE";
  const reason = result?.remediation || ({
    DENY_FILE_CONFLICT: "File range is owned by an active task; retry after it finishes.",
    DENY_UNKNOWN_WRITE_SCOPE: "The tool's write scope cannot be proven safe while another task participates in this project.",
    CONFIRM_PROJECT: "Project parallel write confirmation is required; resolve the decision request and retry.",
    UNKNOWN_OWNER_DECISION_REQUIRED: "An UNKNOWN task owns an overlapping range; inspect and resolve the decision request, then retry.",
    RETRY_COORDINATION_FAILURE: "Task coordination is temporarily unavailable; retry the operation.",
  })[decision] || "Task coordination blocked this operation.";
  return providerAdapter.renderDecision({ ...result, decision, remediation: reason });
}

function createAdapter(provider, options = {}) {
  const providerAdapter = getHookAdapter(provider);
  return {
    provider,
    normalize(input) { return normalizeEnvelope(provider, input, options); },
    classifyTool,
    render(result) { return renderNativeDecision(provider, result); },
    nativeEvents(event) { return providerAdapter.nativeEvents(event); },
    renderDeclaration(declaration) { return providerAdapter.renderDeclaration(declaration); },
  };
}

async function processEnvelope(envelope, options = {}) {
  const adapter = createAdapter(envelope.provider, options);
  if (envelope.eventType === "write.before") {
    const capability = classifyTool(envelope.tool);
    if (capability.kind === "read-only") {
      await applyTaskEvent({ ...options, event: { ...envelope, eventType: "task.activity" } });
      return { decision: "ALLOW", taskId: taskIdFor({ workspaceUuid: envelope.workspaceUuid, provider: envelope.provider, nativeSessionId: envelope.agent.parentSessionId || envelope.nativeSessionId, generation: envelope.generation || 1 }) };
    }
    return beforeWrite({ ...options, event: envelope, projectRealPath: options.projectRealPath || options.project?.realPath || envelope.cwd, scopes: capability.scopes });
  }
  if (envelope.eventType === "write.after") return afterWrite({ ...options, event: envelope, operationId: envelope.operationId });
  return applyTaskEvent({ ...options, event: envelope });
}

async function runHook(provider, input, options = {}) {
  let effectiveOptions = { ...options };
  try {
    if (!effectiveOptions.workspaceUuid) {
      const root = effectiveOptions.workspaceRoot || findWorkspaceRoot(input?.cwd || process.cwd());
      if (root) {
        const projection = loadConfigProjection(root, ["identity", "projects"]);
        effectiveOptions = { ...effectiveOptions, workspaceRoot: root, workspaceUuid: projection.workspace.uuid, projects: projection.projects };
      }
    }
  } catch (error) {
    const adapter = createAdapter(provider, options);
    const result = { decision: "RETRY_COORDINATION_FAILURE", error: { code: error.code || "HOOK_WORKSPACE_CONFIG_INVALID", message: error.message, details: error.details || {} }, remediation: "The coordination Hook could not load Workspace identity/projects; repair the Workspace configuration and retry." };
    return { envelope: null, result, native: adapter.render(result) };
  }
  const adapter = createAdapter(provider, effectiveOptions);
  try {
    const envelope = adapter.normalize(input, effectiveOptions);
    if (!effectiveOptions.projectRealPath && Array.isArray(effectiveOptions.projects)) {
      const cwd = path.resolve(envelope.cwd || process.cwd());
      const matching = effectiveOptions.projects
        .map((project) => ({ ...project, realPath: project.realPath || project.location }))
        .filter((project) => project.realPath && (cwd === path.resolve(project.realPath) || cwd.startsWith(`${path.resolve(project.realPath)}${path.sep}`)))
        .sort((left, right) => right.realPath.length - left.realPath.length)[0];
      if (matching) effectiveOptions.projectRealPath = matching.realPath;
    }
    if (envelope.eventType === "write.before" && Array.isArray(effectiveOptions.projects) && !effectiveOptions.projectRealPath) {
      throw new WorkspaceError("TASK_PROJECT_NOT_REGISTERED", "The Hook write target is not inside a registered Workspace project.", {
        cwd: envelope.cwd,
        remediation: "Register the project with code-w project add, then retry the Agent operation.",
      });
    }
    const result = await processEnvelope(envelope, effectiveOptions);
    return { envelope, result, native: adapter.render(result) };
  } catch (error) {
    const result = { decision: "RETRY_COORDINATION_FAILURE", error: { code: error.code || "HOOK_INTERNAL_ERROR", message: error.message, details: error.details || {} }, remediation: "The coordination Hook failed closed. Inspect the error and retry after fixing the workspace state." };
    return { envelope: null, result, native: adapter.render(result) };
  }
}

async function runHookStdin(provider, options = {}) {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  let input;
  try { input = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"); }
  catch (error) {
    const adapter = createAdapter(provider, options);
    return adapter.render({ decision: "RETRY_COORDINATION_FAILURE", remediation: `Invalid Hook JSON: ${error.message}` });
  }
  const output = await runHook(provider, input, options);
  return output.native;
}

module.exports = {
  PROTOCOL_SCHEMA_VERSION,
  READ_ONLY_TOOLS,
  EXACT_TOOLS,
  stableEventId,
  operationId,
  extractPaths,
  classifyTool,
  normalizeEnvelope,
  renderNativeDecision,
  createAdapter,
  processEnvelope,
  runHook,
  runHookStdin,
};
