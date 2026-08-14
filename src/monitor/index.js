const http = require("node:http");
const { randomUUID } = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { renderMonitorPage } = require("./page");

const DEFAULT_MONITOR_HOST = "127.0.0.1";
const DEFAULT_MONITOR_PORT = 3211;
const MONITOR_ASSETS = new Map([
  ["/assets/request_tip.mp3", { file: path.join(__dirname, "..", "..", "assets", "request_tip.mp3"), type: "audio/mpeg" }],
  ["/assets/session_finish.mp3", { file: path.join(__dirname, "..", "..", "assets", "session_finish.mp3"), type: "audio/mpeg" }],
  ["/assets/logo-vector.svg", { file: path.join(__dirname, "..", "..", "assets", "logo-vector.svg"), type: "image/svg+xml; charset=utf-8" }],
  ["/assets/i18n-icon.svg", { file: path.join(__dirname, "..", "..", "assets", "i18n-icon.svg"), type: "image/svg+xml; charset=utf-8" }],
]);

const EVENT_DEFINITIONS = {
  UserPromptSubmit: ["turn.started", "RUNNING"],
  PermissionRequest: ["approval.requested", "WAITING_APPROVAL"],
  PostToolUse: ["tool.completed", "RUNNING"],
  SubagentStart: ["subagent.started", "RUNNING"],
  SubagentStop: ["subagent.stopped", "RUNNING"],
  Stop: ["turn.stopped", "STOPPED"],
  SessionEnd: ["session.ended", "SESSION_ENDED"],
};

function validatePort(value, options = {}) {
  const port = Number(value ?? DEFAULT_MONITOR_PORT);
  const minimum = options.allowZero ? 0 : 1;
  if (!Number.isInteger(port) || port < minimum || port > 65535) throw new Error("Monitor port must be between 1 and 65535");
  return port;
}

function normalizeHookEvent(input, config) {
  const definition = EVENT_DEFINITIONS[input?.hook_event_name];
  if (!definition || typeof input.session_id !== "string") return null;
  return {
    schemaVersion: 1,
    eventId: randomUUID(),
    source: "codex",
    eventType: definition[0],
    status: definition[1],
    timestamp: new Date().toISOString(),
    workspace: { uuid: config.workspace.uuid, name: config.workspace.name },
    session: { id: input.session_id },
    turn: input.turn_id ? { id: input.turn_id } : null,
    context: {
      cwd: input.cwd || null,
      model: input.model || null,
      permissionMode: input.permission_mode || null,
    },
    tool: input.tool_name ? { name: input.tool_name, useId: input.tool_use_id || null } : null,
    subagent: input.agent_id ? { id: input.agent_id, type: input.agent_type || null } : null,
  };
}

function validEvent(event) {
  return Boolean(
    event?.schemaVersion === 1 &&
    typeof event.eventId === "string" &&
    typeof event.eventType === "string" &&
    typeof event.status === "string" &&
    typeof event.workspace?.uuid === "string" &&
    typeof event.workspace?.name === "string" &&
    typeof event.session?.id === "string"
  );
}

function createMonitorStore(options = {}) {
  const maxEvents = Number(options.maxEvents || 1000);
  if (!Number.isInteger(maxEvents) || maxEvents < 1) throw new Error("maxEvents must be a positive integer");
  const events = [];
  const workspaces = new Map();
  const subscribers = new Set();

  function publish(message) {
    const payload = `event: update\ndata: ${JSON.stringify(message)}\n\n`;
    for (const response of subscribers) response.write(payload);
  }

  function accept(event) {
    if (!validEvent(event)) throw new Error("invalid event payload");
    if (events.some((current) => current.eventId === event.eventId)) return { duplicate: true };
    const now = event.timestamp || new Date().toISOString();
    const previous = workspaces.get(event.workspace.uuid) || {
      uuid: event.workspace.uuid,
      name: event.workspace.name,
      sessions: {},
      eventCount: 0,
      firstSeenAt: now,
    };
    const session = previous.sessions[event.session.id] || { id: event.session.id, turns: {}, status: "ACTIVE", firstSeenAt: now };
    const turnId = event.turn?.id;
    if (turnId) {
      const turn = session.turns[turnId] || { id: turnId, eventCount: 0, startedAt: now };
      turn.status = event.status;
      turn.eventCount += 1;
      turn.updatedAt = now;
      turn.tool = event.tool;
      turn.subagent = event.subagent;
      session.turns[turnId] = turn;
    }
    if (event.status === "SESSION_ENDED") session.status = "ENDED";
    session.updatedAt = now;
    previous.name = event.workspace.name;
    previous.sessions[event.session.id] = session;
    previous.eventCount += 1;
    previous.updatedAt = now;
    workspaces.set(previous.uuid, previous);
    events.unshift(event);
    if (events.length > maxEvents) events.length = maxEvents;
    publish({ event, workspace: previous });
    return { duplicate: false, workspaceUuid: previous.uuid };
  }

  function removeWorkspace(uuid) {
    if (!workspaces.delete(uuid)) return { removed: false, workspaceUuid: uuid };
    for (let index = events.length - 1; index >= 0; index -= 1) {
      if (events[index].workspace.uuid === uuid) events.splice(index, 1);
    }
    publish({ workspaceRemoved: uuid });
    return { removed: true, workspaceUuid: uuid };
  }

  function snapshot() {
    return {
      workspaces: [...workspaces.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
      events: events.slice(),
      serverTime: new Date().toISOString(),
    };
  }

  return { accept, events, removeWorkspace, snapshot, subscribers, workspaces };
}

async function readJson(request, limit = 256_000) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > limit) throw new Error("request body is too large");
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
}

function sendJson(response, status, body) {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  response.end(JSON.stringify(body));
}

function sendHtml(response, body) {
  response.writeHead(200, {
    "content-type": "text/html; charset=utf-8",
    "cache-control": "no-store",
    "content-security-policy": "default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; media-src 'self'",
    "x-content-type-options": "nosniff",
  });
  response.end(body);
}

function sendAsset(response, asset) {
  const body = fs.readFileSync(asset.file);
  response.writeHead(200, {
    "content-type": asset.type,
    "content-length": body.length,
    "cache-control": "public, max-age=3600",
    "x-content-type-options": "nosniff",
  });
  response.end(body);
}

function createMonitorServer(options = {}) {
  const host = options.host || DEFAULT_MONITOR_HOST;
  const port = validatePort(options.port, { allowZero: options.allowZero === true });
  const store = options.store || createMonitorStore(options);
  const server = http.createServer(async (request, response) => {
    const url = new URL(request.url, `http://${request.headers.host || `${host}:${port}`}`);
    try {
      if (request.method === "GET" && url.pathname === "/") return sendHtml(response, renderMonitorPage());
      if (request.method === "GET" && MONITOR_ASSETS.has(url.pathname)) return sendAsset(response, MONITOR_ASSETS.get(url.pathname));
      if (request.method === "GET" && url.pathname === "/api/v1/health") return sendJson(response, 200, { ok: true });
      if (request.method === "GET" && url.pathname === "/api/v1/snapshot") return sendJson(response, 200, store.snapshot());
      if (request.method === "GET" && url.pathname === "/api/v1/workspaces") return sendJson(response, 200, { workspaces: store.snapshot().workspaces });
      if (request.method === "GET" && url.pathname === "/api/v1/events") return sendJson(response, 200, { events: store.snapshot().events });
      if (request.method === "DELETE" && url.pathname.startsWith("/api/v1/workspaces/")) {
        const uuid = decodeURIComponent(url.pathname.slice("/api/v1/workspaces/".length));
        if (!uuid || uuid.includes("/")) return sendJson(response, 404, { error: "not found" });
        const result = store.removeWorkspace(uuid);
        return sendJson(response, result.removed ? 200 : 404, result.removed ? result : { error: "workspace not found" });
      }
      if (request.method === "GET" && url.pathname === "/api/v1/stream") {
        response.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" });
        response.write(": connected\n\n");
        store.subscribers.add(response);
        request.on("close", () => store.subscribers.delete(response));
        return;
      }
      if (request.method === "POST" && url.pathname === "/api/v1/events") {
        const result = store.accept(await readJson(request));
        return sendJson(response, result.duplicate ? 200 : 202, { accepted: true, ...result });
      }
      return sendJson(response, 404, { error: "not found" });
    } catch (error) {
      return sendJson(response, 400, { error: error.message });
    }
  });
  return { host, port, server, store };
}

function startMonitor(options = {}) {
  const monitor = createMonitorServer(options);
  return new Promise((resolve, reject) => {
    const onError = (error) => {
      monitor.server.off("listening", onListening);
      reject(error);
    };
    const onListening = () => {
      monitor.server.off("error", onError);
      resolve(monitor);
    };
    monitor.server.once("error", onError);
    monitor.server.once("listening", onListening);
    monitor.server.listen(monitor.port, monitor.host);
  });
}

async function reportHookEvent(input, config, options = {}) {
  if (!config.monitor?.enable || !config.workspace) return { action: "skip", reason: "monitor disabled" };
  const event = normalizeHookEvent(input, config);
  if (!event) return { action: "skip", reason: "unsupported event" };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs || 300);
  try {
    const response = await (options.fetch || fetch)(`${config.monitor.url}/api/v1/events`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(event),
      signal: controller.signal,
    });
    return { action: response.ok ? "report" : "skip", status: response.status, event };
  } catch {
    return { action: "skip", reason: "monitor unavailable", event };
  } finally {
    clearTimeout(timer);
  }
}

module.exports = {
  DEFAULT_MONITOR_HOST,
  DEFAULT_MONITOR_PORT,
  EVENT_DEFINITIONS,
  createMonitorServer,
  createMonitorStore,
  normalizeHookEvent,
  reportHookEvent,
  startMonitor,
  validatePort,
  validEvent,
};
