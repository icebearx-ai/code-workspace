const { loadConfigProjection, requireWorkspaceRoot } = require("../../core/config");
const { WorkspaceError } = require("../../core/errors");
const { randomUUID } = require("node:crypto");
const { executeExtensionRuntime } = require("../../core/extension-runtime");
const { ensureStoredExtensionPackage, defaultExtensionStoreRoot } = require("../../core/extension-store");
const { discoverExtensions } = require("../../core/extensions");
const { success } = require("../result");

const EVENT_DEFINITIONS = {
  UserPromptSubmit: ["turn.started", "RUNNING"], PermissionRequest: ["approval.requested", "WAITING_APPROVAL"],
  PostToolUse: ["tool.completed", "RUNNING"], SubagentStart: ["subagent.started", "RUNNING"],
  SubagentStop: ["subagent.stopped", "RUNNING"], Stop: ["turn.stopped", "STOPPED"], SessionEnd: ["session.ended", "SESSION_ENDED"],
};

function normalizeHookEvent(input, config) {
  const definition = EVENT_DEFINITIONS[input?.hook_event_name];
  if (!definition || typeof input.session_id !== "string") return null;
  return { schemaVersion: 1, eventId: randomUUID(), source: "codex", eventType: definition[0], status: definition[1], timestamp: new Date().toISOString(), workspace: { uuid: config.workspace.uuid, name: config.workspace.name }, session: { id: input.session_id }, turn: input.turn_id ? { id: input.turn_id } : null, context: { cwd: input.cwd || null, model: input.model || null, permissionMode: input.permission_mode || null }, tool: input.tool_name ? { name: input.tool_name, useId: input.tool_use_id || null } : null, subagent: input.agent_id ? { id: input.agent_id, type: input.agent_type || null } : null };
}

async function reportHookEvent(input, config, options = {}) {
  if (!config.monitor?.enable || !config.workspace) return { action: "skip", reason: "monitor disabled" };
  const event = normalizeHookEvent(input, config);
  if (!event) return { action: "skip", reason: "unsupported event" };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs || 300);
  try {
    const response = await (options.fetch || fetch)(`${config.monitor.url}/api/v1/events`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(event), signal: controller.signal });
    return { action: response.ok ? "report" : "skip", status: response.status, event };
  } catch { return { action: "skip", reason: "monitor unavailable", event }; }
  finally { clearTimeout(timer); }
}

function ensureMonitorPackage(storeRoot) {
  const monitor = discoverExtensions().find((entry) => entry.id === "monitor")?.latestSupported;
  if (!monitor) throw new WorkspaceError("MONITOR_EXTENSION_UNAVAILABLE", "The built-in Monitor extension is unavailable.");
  return ensureStoredExtensionPackage({ storeRoot, sourceRoot: monitor.sourceRoot, source: "builtin" });
}

async function readStdinJson(input = process.stdin) {
  const chunks = [];
  for await (const chunk of input) chunks.push(chunk);
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
  } catch (error) {
    throw new WorkspaceError("MONITOR_EVENT_INVALID", `Cannot parse monitor event JSON: ${error.message}`);
  }
}

async function executeMonitor(invocation) {
  const action = invocation.definition.path[1];
  if (action === "report") {
    try {
      const root = requireWorkspaceRoot(process.cwd());
      const report = await reportHookEvent(await readStdinJson(), loadConfigProjection(root, ["identity", "monitor"]));
      return success("monitor.report", report);
    } catch (error) {
      return success("monitor.report", { action: "skip", reason: "reporting failed open", errorCode: error.code || "MONITOR_REPORT_FAILED" });
    }
  }
  if (invocation.options.json) {
    throw new WorkspaceError("CLI_JSON_UNSUPPORTED", "The long-running monitor command does not support --json; use the dashboard API for machine-readable state.");
  }
  const storeRoot = invocation.dependencies?.extensionStoreRoot || defaultExtensionStoreRoot();
  ensureMonitorPackage(storeRoot);
  const argv = ["serve"];
  if (invocation.options.port !== undefined) argv.push("--port", String(invocation.options.port));
  const runtime = await executeExtensionRuntime({ id: "monitor", argv, extensionStoreRoot: storeRoot, json: false });
  const result = await runtime.result;
  return success("monitor", { extension: { id: runtime.plan.id, version: runtime.plan.version }, ...result });
}

module.exports = { executeMonitor, readStdinJson };
