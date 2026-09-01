"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const { WorkspaceError } = require("./errors");
const { findWorkspaceRoot, loadConfigProjection } = require("./config");
const { beforeWrite, afterWrite, applyTaskEvent, taskIdFor } = require("./task-coordination");
const { getAdapter: getHookAdapter } = require("../hooks/adapters");
const {
  READ_ONLY_TOOLS,
  EXACT_TOOLS,
  extractPaths,
  classifyTool,
  stableEventId,
  operationId,
} = require("../hooks/adapters/common");

const PROTOCOL_SCHEMA_VERSION = 1;

function normalizeEnvelope(provider, input, options = {}) {
  const providerAdapter = getHookAdapter(provider);
  const source = input && typeof input === "object" ? input : {};
  if (typeof providerAdapter.normalizeInput !== "function") {
    throw new WorkspaceError("HOOK_ADAPTER_INVALID", `Hook adapter ${provider} does not implement normalizeInput.`);
  }
  const normalized = providerAdapter.normalizeInput(source, options) || {};
  const nativeEventName = String(normalized.nativeEventName || "Unknown");
  const session = normalized.nativeSessionId;
  if (!session) throw new WorkspaceError("HOOK_SESSION_ID_MISSING", "Hook input does not contain a native session id.");
  const eventId = normalized.eventId || stableEventId(provider, source);
  const op = normalized.operationId || null;
  const eventType = providerAdapter.eventTypeForNative(nativeEventName);
  if (!eventType) {
    throw new WorkspaceError("HOOK_EVENT_UNSUPPORTED", `Unsupported native Hook event for ${provider}: ${nativeEventName || "<missing>"}`, {
      provider,
      nativeEventName: nativeEventName || null,
    });
  }
  const tool = normalized.tool || { callId: op, name: null, input: {} };
  const agent = normalized.agent || { isSubagent: false, agentId: null, agentType: null, parentSessionId: null };
  const envelope = {
    schemaVersion: PROTOCOL_SCHEMA_VERSION,
    eventId,
    eventType,
    provider,
    nativeEventName,
    nativeSessionId: session,
    workspaceUuid: normalized.workspaceUuid || options.workspaceUuid || null,
    cwd: normalized.cwd || process.cwd(),
    occurredAt: normalized.occurredAt || new Date().toISOString(),
    agent,
    tool,
    operationId: op || (eventType === "write.before" || eventType === "write.after" ? crypto.createHash("sha256").update(`${eventId}\u0000${tool.name || ""}`).digest("hex") : null),
    generation: normalized.generation,
    success: eventType === "write.after" ? normalized.success !== false : undefined,
    phase: normalized.phase,
    runtimeEvidence: normalized.runtimeEvidence || {},
    processEvidence: normalized.processEvidence || null,
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

function renderNativeResponse(provider, eventType, result, context = {}) {
  const providerAdapter = getHookAdapter(provider);
  if (typeof providerAdapter.renderResponse === "function") {
    return providerAdapter.renderResponse({ eventType, result, ...context });
  }
  if (eventType === "write.before") return renderNativeDecision(provider, result);
  return providerAdapter.renderAcknowledgement(eventType, result, context);
}

function eventTypeForInput(provider, input, options = {}) {
  const providerAdapter = getHookAdapter(provider);
  try {
    const normalized = typeof providerAdapter.normalizeInput === "function" ? providerAdapter.normalizeInput(input, options) : {};
    const nativeEventName = normalized.nativeEventName || "Unknown";
    return providerAdapter.eventTypeForNative(nativeEventName) || null;
  } catch {
    return null;
  }
}

function createAdapter(provider, options = {}) {
  const providerAdapter = getHookAdapter(provider);
  return {
    provider,
    normalizeInput(input) {
      if (typeof providerAdapter.normalizeInput !== "function") throw new WorkspaceError("HOOK_ADAPTER_INVALID", `Hook adapter ${provider} does not implement normalizeInput.`);
      return providerAdapter.normalizeInput(input, options);
    },
    normalize(input) { return normalizeEnvelope(provider, input, options); },
    nativeEventName(input) {
      if (typeof providerAdapter.nativeEventName !== "function") return null;
      return providerAdapter.nativeEventName(input, options);
    },
    classifyTool(tool) {
      return typeof providerAdapter.classifyTool === "function" ? providerAdapter.classifyTool(tool) : classifyTool(tool);
    },
    render(result) { return renderNativeDecision(provider, result); },
    nativeEvents(event) { return providerAdapter.nativeEvents(event); },
    renderDeclaration(declaration) { return providerAdapter.renderDeclaration(declaration); },
    renderResponse(context) { return renderNativeResponse(provider, context?.eventType, context?.result, context); },
  };
}

async function processEnvelope(envelope, options = {}) {
  const adapter = createAdapter(envelope.provider, options);
  if (envelope.eventType === "write.before") {
    const capability = adapter.classifyTool(envelope.tool);
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
  const initialAdapter = createAdapter(provider, options);
  try {
    if (!effectiveOptions.workspaceUuid) {
      const normalizedInput = initialAdapter.normalizeInput(input);
      const root = effectiveOptions.workspaceRoot || findWorkspaceRoot(normalizedInput?.cwd || process.cwd());
      if (root) {
        const projection = loadConfigProjection(root, ["identity", "projects"]);
        effectiveOptions = { ...effectiveOptions, workspaceRoot: root, workspaceUuid: projection.workspace.uuid, projects: projection.projects };
      }
    }
  } catch (error) {
    const result = { decision: "RETRY_COORDINATION_FAILURE", error: { code: error.code || "HOOK_WORKSPACE_CONFIG_INVALID", message: error.message, details: error.details || {} }, remediation: "The coordination Hook could not load Workspace identity/projects; repair the Workspace configuration and retry." };
    const eventType = eventTypeForInput(provider, input, options);
    return { envelope: null, result, native: renderNativeResponse(provider, eventType, result, { input }) };
  }
  const adapter = createAdapter(provider, effectiveOptions);
  try {
    const envelope = adapter.normalize(input, effectiveOptions);
    if (!effectiveOptions.projectRealPath && Array.isArray(effectiveOptions.projects)) {
      const canonical = (value) => {
        const resolved = path.resolve(value);
        try { return fs.realpathSync.native(resolved); } catch { return resolved; }
      };
      const cwd = canonical(envelope.cwd || process.cwd());
      const matching = effectiveOptions.projects
        .map((project) => ({ ...project, realPath: project.realPath || project.location }))
        .map((project) => ({ ...project, realPath: project.realPath ? canonical(project.realPath) : null }))
        .filter((project) => project.realPath && (cwd === project.realPath || cwd.startsWith(`${project.realPath}${path.sep}`)))
        .sort((left, right) => right.realPath.length - left.realPath.length)[0];
      if (matching) effectiveOptions.projectRealPath = matching.realPath;
    }
    const capability = envelope.eventType === "write.before" ? adapter.classifyTool(envelope.tool) : null;
    if (envelope.eventType === "write.before" && capability?.kind !== "read-only" && Array.isArray(effectiveOptions.projects) && !effectiveOptions.projectRealPath) {
      throw new WorkspaceError("TASK_PROJECT_NOT_REGISTERED", "The Hook write target is not inside a registered Workspace project.", {
        cwd: envelope.cwd,
        remediation: "Register the project with code-w project add, then retry the Agent operation.",
      });
    }
    const result = await processEnvelope(envelope, effectiveOptions);
    return { envelope, result, native: renderNativeResponse(provider, envelope.eventType, result, { input, nativeEventName: envelope.nativeEventName }) };
  } catch (error) {
    const result = { decision: "RETRY_COORDINATION_FAILURE", error: { code: error.code || "HOOK_INTERNAL_ERROR", message: error.message, details: error.details || {} }, remediation: "The coordination Hook failed closed. Inspect the error and retry after fixing the workspace state." };
    const eventType = eventTypeForInput(provider, input, effectiveOptions);
    return { envelope: null, result, native: renderNativeResponse(provider, eventType, result, { input }) };
  }
}

async function runHookStdin(provider, options = {}) {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  let input;
  try { input = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"); }
  catch (error) {
    const adapter = createAdapter(provider, options);
    return adapter.renderResponse({ eventType: null, result: { decision: "RETRY_COORDINATION_FAILURE", remediation: `Invalid Hook JSON: ${error.message}` } });
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
