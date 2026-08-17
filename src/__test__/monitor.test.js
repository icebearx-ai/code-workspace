const assert = require("node:assert/strict");
const test = require("node:test");

const {
  DEFAULT_SESSION_INACTIVITY_MS,
  createMonitorServer,
  createMonitorStore,
  normalizeHookEvent,
  reportHookEvent,
} = require("../monitor");
const { renderMonitorPage } = require("../monitor/page");
const { DEFAULT_MONITOR_LANGUAGE, MONITOR_LOCALES, MONITOR_MESSAGES } = require("../monitor/i18n");

function leafKeys(value, prefix = "") {
  return Object.entries(value).flatMap(([key, entry]) => {
    const entryPath = prefix ? `${prefix}.${key}` : key;
    if (entry && typeof entry === "object" && !Array.isArray(entry)) return leafKeys(entry, entryPath);
    return [entryPath];
  });
}

test("monitor owns an extensible and internally consistent locale registry", () => {
  assert(MONITOR_LOCALES.length > 0);
  assert(MONITOR_MESSAGES[DEFAULT_MONITOR_LANGUAGE]);
  const expected = leafKeys(MONITOR_LOCALES[0].messages);
  for (const locale of MONITOR_LOCALES) assert.deepEqual(leafKeys(locale.messages), expected, locale.code);
});

const workspace = { name: "payments", uuid: "123e4567-e89b-42d3-a456-426614174000" };
const config = { workspace, monitor: { enable: true, url: "http://127.0.0.1:3211" } };

test("monitor dashboard is self-contained and consumes snapshot plus SSE APIs", () => {
  const page = renderMonitorPage();
  assert.match(page, /Code Workspace Monitor/);
  assert.match(page, /id="language-toggle"/);
  assert.match(page, /class="language-icon"/);
  assert.match(page, /mask:url\('\/assets\/i18n-icon\.svg'\)/);
  assert.doesNotMatch(page, /<select|language-select/);
  assert.match(page, /code-workspace-monitor-language/);
  assert.match(page, /"en-US"/);
  assert.match(page, /"zh-CN"/);
  assert.doesNotMatch(page, /__MONITOR_MESSAGES__|__MONITOR_LANGUAGES__|__DEFAULT_MONITOR_LANGUAGE__/);
  assert.match(page, /fetch\('\/api\/v1\/snapshot'/);
  assert.match(page, /EventSource\('\/api\/v1\/stream'\)/);
  assert.match(page, /执行视图/);
  assert.match(page, /panel-icon workspace-icon/);
  assert.match(page, /panel-icon execution-icon/);
  assert.match(page, /panel-icon signal-icon/);
  assert.match(page, /class="brand-mark"/);
  assert.match(page, /<img src="\/assets\/logo-vector\.svg" alt="">/);
  assert.doesNotMatch(page, /class="mark-signal"/);
  assert.match(page, /@media\(max-width:400px\)[\s\S]*?\.brand-copy\{display:none\}/);
  assert.match(page, /@media\(max-width:720px\)[\s\S]*?\.control-toggle\{width:32px/);
  assert.match(page, /@media\(max-width:600px\)\{\.metrics\{display:none\}/);
  assert.match(page, /function toggleLanguage\(\)/);
  assert.match(page, /next=current<0\?0:\(current\+1\)%LANGUAGES\.length/);
  assert.match(page, /id="sound-toggle"/);
  assert.match(page, /id="sound-toggle"[^>]*aria-pressed="true"/);
  assert.doesNotMatch(page, /id="beacons"|function showBeacon|function restoreBeacons/);
  assert.match(page, /classList\.add\('signal-arrived'\)/);
  assert.match(page, /alert-badge approval/);
  assert.match(page, /el\('button','workspace-menu-trigger','⋮'\)/);
  assert.match(page, /aria-haspopup','menu'/);
  assert.match(page, /function closeWorkspaceMenus\(returnFocus=false\)/);
  assert.match(page, /if\(event\.key==='Escape'\)closeWorkspaceMenus\(true\)/);
  assert.doesNotMatch(page, /workspace\.has-approval\{border-left-color/);
  assert.doesNotMatch(page, /workspace\.has-complete[^}]*border-left-color/);
  assert.match(page, /function workspaceStatus\(workspace,alert\)/);
  assert.match(page, /"RECENT_COMPLETE":"刚完成"/);
  assert.doesNotMatch(page, /top\.append\(status\(ss\.some/);
  assert.match(page, /function acknowledgeWorkspace\(uuid\)/);
  assert.match(page, /"approval":"待授权 \{count\}"/);
  assert.match(page, /"complete":"已完成 \{count\}"/);
  assert.match(page, /const message=\(template,values=\{\}\)=>/);
  assert.match(page, /function reconcileApprovals\(event\)/);
  assert.match(page, /event\.eventType==='tool\.completed'/);
  assert.match(page, /item\.turnId===event\.turn\?\.id&&item\.toolName===event\.tool\?\.name/);
  assert.match(page, /method:'DELETE'/);
  assert.match(page, /function removeSession\(workspace,session\)/);
  assert.match(page, /\/sessions\/'\+encodeURIComponent\(session\.id\)/);
  assert.match(page, /setInterval\(refresh,10000\)/);
  assert.match(page, /session\.status==='ACTIVE'/);
  assert.match(page, /"INACTIVE":"非活跃"/);
  assert.match(page, /超过 10 分钟未收到信号/);
  assert.match(page, /localStorage\.getItem\(SOUND_KEY\)!=='off'/);
  assert.match(page, /setAttribute\('aria-pressed',String\(state\.soundEnabled\)\)/);
  assert.match(page, /ALERT_KEY='code-workspace-monitor-workspace-alerts'/);
  assert.match(page, /LEGACY_INBOX_KEY='code-workspace-monitor-signal-inbox'/);
  assert.match(page, /function restoreAlerts\(\)/);
  assert.match(page, /\/assets\/request_tip\.mp3/);
  assert.match(page, /\/assets\/session_finish\.mp3/);
  assert.match(page, /event\.eventType==='approval\.requested'/);
  assert.match(page, /event\.eventType==='turn\.stopped'/);
  assert.match(page, /addEventListener\('update',handleUpdate\)/);
  assert.doesNotMatch(page, /createOscillator|function tone/);
  assert.doesNotMatch(page, /\.event\{[^}]*animation:/);
  assert.doesNotMatch(page, /https?:\/\//);
});

test("Codex hook normalization reports lifecycle metadata but excludes sensitive bodies", () => {
  const event = normalizeHookEvent({
    hook_event_name: "PostToolUse",
    session_id: "session-1",
    turn_id: "turn-1",
    cwd: "/workspace",
    tool_name: "exec_command",
    tool_use_id: "call-1",
    prompt: "secret prompt",
    tool_input: { token: "secret" },
    transcript_path: "/private/transcript.jsonl",
  }, config);
  assert.equal(event.eventType, "tool.completed");
  assert.deepEqual(event.workspace, workspace);
  assert.equal(event.tool.name, "exec_command");
  const serialized = JSON.stringify(event);
  assert.doesNotMatch(serialized, /secret prompt|secret|transcript/);
});

test("monitor store isolates equal session ids by workspace UUID", () => {
  const store = createMonitorStore();
  for (const [uuid, name] of [[workspace.uuid, "payments"], ["123e4567-e89b-42d3-a456-426614174001", "portal"]]) {
    store.accept({
      schemaVersion: 1,
      eventId: uuid,
      eventType: "turn.started",
      status: "RUNNING",
      timestamp: "2026-08-02T00:00:00.000Z",
      workspace: { uuid, name },
      session: { id: "same-session" },
      turn: { id: "same-turn" },
    });
  }
  assert.equal(store.snapshot().workspaces.length, 2);
  assert(store.snapshot().workspaces.every((entry) => entry.sessions["same-session"]));
});

test("monitor store projects inactive sessions at ten minutes and restores them on a new signal", () => {
  let now = new Date("2026-08-17T00:00:00.000Z");
  const store = createMonitorStore({ now: () => now });
  const baseEvent = {
    schemaVersion: 1,
    eventId: "event-1",
    eventType: "turn.started",
    status: "RUNNING",
    timestamp: "2020-01-01T00:00:00.000Z",
    workspace,
    session: { id: "session-1" },
    turn: { id: "turn-1" },
  };

  store.accept(baseEvent);
  now = new Date(now.getTime() + DEFAULT_SESSION_INACTIVITY_MS - 1);
  let snapshot = store.snapshot();
  assert.equal(snapshot.workspaces[0].sessions["session-1"].status, "ACTIVE");
  assert.equal(snapshot.workspaces[0].activeSessionCount, 1);
  assert.deepEqual(snapshot.summary, { workspaces: 1, sessions: 1, activeSessions: 1, turns: 1 });

  now = new Date(now.getTime() + 1);
  snapshot = store.snapshot();
  assert.equal(snapshot.workspaces[0].sessions["session-1"].status, "INACTIVE");
  assert.equal(snapshot.workspaces[0].sessionCount, 1);
  assert.equal(snapshot.workspaces[0].activeSessionCount, 0);
  assert.equal(snapshot.summary.sessions, 1);
  assert.equal(snapshot.summary.activeSessions, 0);

  store.accept({ ...baseEvent, eventId: "event-2", eventType: "tool.completed" });
  snapshot = store.snapshot();
  assert.equal(snapshot.workspaces[0].sessions["session-1"].status, "ACTIVE");
  assert.equal(snapshot.workspaces[0].sessions["session-1"].lastSignalAt, now.toISOString());

  store.accept({
    ...baseEvent,
    eventId: "event-3",
    eventType: "session.ended",
    status: "SESSION_ENDED",
    turn: null,
  });
  now = new Date(now.getTime() + DEFAULT_SESSION_INACTIVITY_MS * 2);
  snapshot = store.snapshot();
  assert.equal(snapshot.workspaces[0].sessions["session-1"].status, "ENDED");
  assert.equal(snapshot.summary.activeSessions, 0);
});

test("monitor store removes one session, its events, and publishes the deletion", () => {
  const store = createMonitorStore({ now: () => new Date("2026-08-17T00:00:00.000Z") });
  const messages = [];
  store.subscribers.add({ write: (message) => messages.push(message) });
  const event = (eventId, sessionId, turnId) => ({
    schemaVersion: 1,
    eventId,
    eventType: "turn.started",
    status: "RUNNING",
    workspace,
    session: { id: sessionId },
    turn: { id: turnId },
  });
  store.accept(event("event-1", "session-1", "turn-1"));
  store.accept({ ...event("event-2", "session-1", "turn-1"), eventType: "tool.completed" });
  store.accept(event("event-3", "session-2", "turn-2"));

  assert.deepEqual(store.removeSession(workspace.uuid, "missing"), {
    removed: false,
    workspaceUuid: workspace.uuid,
    sessionId: "missing",
  });
  assert.deepEqual(store.removeSession(workspace.uuid, "session-1"), {
    removed: true,
    workspaceUuid: workspace.uuid,
    sessionId: "session-1",
    removedEvents: 2,
  });
  let snapshot = store.snapshot();
  assert(!snapshot.workspaces[0].sessions["session-1"]);
  assert(snapshot.workspaces[0].sessions["session-2"]);
  assert.equal(snapshot.workspaces[0].eventCount, 1);
  assert.equal(snapshot.events.length, 1);
  assert.equal(snapshot.summary.sessions, 1);
  assert(messages.some((message) => message.includes('"sessionRemoved"')));

  store.removeSession(workspace.uuid, "session-2");
  snapshot = store.snapshot();
  assert.equal(snapshot.workspaces.length, 1);
  assert.equal(snapshot.workspaces[0].sessionCount, 0);
  assert.equal(snapshot.workspaces[0].activeSessionCount, 0);
  assert.equal(snapshot.workspaces[0].eventCount, 0);

  store.accept(event("event-4", "session-1", "turn-3"));
  snapshot = store.snapshot();
  assert.equal(snapshot.workspaces[0].sessions["session-1"].status, "ACTIVE");
});

test("removed monitor workspaces return when a new event arrives", () => {
  const store = createMonitorStore();
  const event = {
    schemaVersion: 1,
    eventId: "event-1",
    eventType: "turn.started",
    status: "RUNNING",
    timestamp: "2026-08-02T00:00:00.000Z",
    workspace,
    session: { id: "session-1" },
    turn: { id: "turn-1" },
  };
  store.accept(event);
  assert.deepEqual(store.removeWorkspace(workspace.uuid), { removed: true, workspaceUuid: workspace.uuid });
  assert.equal(store.snapshot().workspaces.length, 0);
  assert.equal(store.snapshot().events.length, 0);
  store.accept({ ...event, eventId: "event-2" });
  assert.equal(store.snapshot().workspaces[0].name, "payments");
});

test("global monitor accepts events without reading a workspace", async (t) => {
  const monitor = createMonitorServer({ port: 0, allowZero: true });
  try {
    await new Promise((resolve, reject) => {
      monitor.server.once("error", reject);
      monitor.server.listen(0, monitor.host, resolve);
    });
  } catch (error) {
    if (error.code === "EPERM") return t.skip("sandbox does not permit loopback listeners");
    throw error;
  }
  t.after(() => new Promise((resolve) => monitor.server.close(resolve)));
  const address = monitor.server.address();
  const base = `http://${address.address}:${address.port}`;
  for (const asset of ["request_tip.mp3", "session_finish.mp3"]) {
    const audio = await fetch(`${base}/assets/${asset}`);
    assert.equal(audio.status, 200);
    assert.equal(audio.headers.get("content-type"), "audio/mpeg");
    assert((await audio.arrayBuffer()).byteLength > 0);
  }
  for (const asset of ["logo-vector.svg", "i18n-icon.svg"]) {
    const image = await fetch(`${base}/assets/${asset}`);
    assert.equal(image.status, 200);
    assert.match(image.headers.get("content-type"), /^image\/svg\+xml/);
    assert.match(await image.text(), /<svg/);
  }
  assert.equal((await fetch(`${base}/assets/unknown.mp3`)).status, 404);
  const event = normalizeHookEvent({ hook_event_name: "UserPromptSubmit", session_id: "session-1", turn_id: "turn-1" }, config);
  const posted = await fetch(`${base}/api/v1/events`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(event),
  });
  assert.equal(posted.status, 202);
  const snapshot = await (await fetch(`${base}/api/v1/snapshot`)).json();
  assert.equal(snapshot.workspaces[0].name, "payments");
  assert.equal(snapshot.summary.activeSessions, 1);
  const removed = await fetch(`${base}/api/v1/workspaces/${encodeURIComponent(workspace.uuid)}/sessions/session-1`, {
    method: "DELETE",
  });
  assert.equal(removed.status, 200);
  assert.equal((await removed.json()).sessionId, "session-1");
  const afterRemoval = await (await fetch(`${base}/api/v1/snapshot`)).json();
  assert.equal(afterRemoval.workspaces[0].sessionCount, 0);
  assert.equal(afterRemoval.events.length, 0);
  assert.equal((await fetch(`${base}/api/v1/workspaces/${encodeURIComponent(workspace.uuid)}/sessions/session-1`, {
    method: "DELETE",
  })).status, 404);
});

test("hook reporting is disabled and failure-open", async () => {
  const disabled = await reportHookEvent({}, { ...config, monitor: { ...config.monitor, enable: false } }, {
    fetch: () => { throw new Error("must not run"); },
  });
  assert.equal(disabled.action, "skip");

  const unavailable = await reportHookEvent({ hook_event_name: "Stop", session_id: "session-1" }, config, {
    fetch: async () => { throw new Error("offline"); },
  });
  assert.equal(unavailable.action, "skip");
  assert.equal(unavailable.reason, "monitor unavailable");
});
