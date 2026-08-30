"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");
const test = require("node:test");

const c = require("../core/task-coordination");
const protocol = require("../core/task-coordination-protocol");
const managed = require("../core/task-coordination-managed");

const UUID = "11111111-1111-4111-8111-111111111111";

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "task-coordination-"));
  const project = path.join(root, "project");
  fs.mkdirSync(project, { recursive: true });
  spawnSync("git", ["init", "-q", "-b", "main"], { cwd: project });
  fs.writeFileSync(path.join(project, "a.txt"), "a\n");
  fs.writeFileSync(path.join(project, "b.txt"), "b\n");
  spawnSync("git", ["add", "."], { cwd: project });
  spawnSync("git", ["-c", "user.email=test@example.com", "-c", "user.name=test", "commit", "-qm", "fixture"], { cwd: project });
  return { root, project, stateDirectory: path.join(os.tmpdir(), `task-coordination-state-${process.pid}-${Math.random().toString(16).slice(2)}`), workspaceUuid: UUID, projectRealPath: project };
}

function event(fx, session, eventId, tool = "Edit") {
  return { workspaceUuid: fx.workspaceUuid, provider: "codex", nativeSessionId: session, eventId, tool: { name: tool }, cwd: fx.root };
}

test("task coordination schema and external state paths are strict and isolated", () => {
  const fx = fixture();
  const paths = c.resolveStateDirectory(fx);
  assert.equal(paths.workspaceRoot, fs.realpathSync(fx.root));
  assert.match(paths.workspaceHash, /^[0-9a-f]{64}$/);
  assert.equal(paths.ledgerPath.startsWith(fx.root), false);
  assert.throws(() => c.normalizeTask({ workspaceUuid: UUID, provider: "codex", nativeSessionId: "s", generation: 1, status: "BROKEN" }), /Unknown task status/);
});

test("scope normalization canonicalizes aliases and rejects escape", () => {
  const fx = fixture();
  assert.equal(c.canonicalProjectTarget(fx.project, "a.txt"), fs.realpathSync(path.join(fx.project, "a.txt")));
  assert.throws(() => c.canonicalProjectTarget(fx.project, "../outside"), (error) => error.code === "TASK_PATH_OUTSIDE_PROJECT");
  const tree = c.normalizeScopes(fx.project, [{ type: "DIRECTORY_TREE", path: "src" }, { type: "DIRECTORY_TREE", path: "src" }]);
  assert.equal(tree.length, 1);
  assert.equal(c.scopeOverlaps(tree[0], { type: "EXACT_FILE", projectRealPath: fx.project, path: path.join(fx.project, "src", "x.js") }), true);
});

test("task lifecycle assigns generations, keeps Stop active, and revokes abandoned generations", async () => {
  const fx = fixture();
  const base = { ...fx, activityThresholdMs: 1000 };
  await c.applyTaskEvent({ ...base, event: { ...event(fx, "session", "start"), eventType: "task.started" } });
  await c.applyTaskEvent({ ...base, event: { ...event(fx, "session", "stop"), eventType: "task.turn-ended", phase: "WAITING" } });
  assert.equal(c.inspectTasks(base).tasks[0].status, c.ACTIVE);
  const ended = await c.applyTaskEvent({ ...base, event: { ...event(fx, "session", "end"), eventType: "task.ended" } });
  assert.equal(Object.values(ended.tasks)[0].status, c.ENDED);
  await c.applyTaskEvent({ ...base, event: { ...event(fx, "session", "start-2"), eventType: "task.started" } });
  const tasks = c.inspectTasks(base).tasks;
  assert.equal(tasks.filter((task) => task.nativeSessionId === "session").length, 2);
  assert.equal(tasks.find((task) => task.generation === 2).status, c.ACTIVE);
});

test("same file is strongly denied while non-overlapping files require one project confirmation", async () => {
  const fx = fixture();
  const base = { ...fx };
  const first = await c.beforeWrite({ ...base, event: event(fx, "a", "before-a"), scopes: ["a.txt"], operationId: "op-a" });
  assert.equal(first.decision, "ALLOW");
  const same = await c.beforeWrite({ ...base, event: event(fx, "b", "before-b"), scopes: ["a.txt"], operationId: "op-b" });
  assert.equal(same.decision, "DENY_FILE_CONFLICT");
  const different = await c.beforeWrite({ ...base, event: event(fx, "c", "before-c"), scopes: ["b.txt"], operationId: "op-c" });
  assert.equal(different.decision, "CONFIRM_PROJECT");
  const plan = c.planDecision(different.decisionRequestId, "APPROVE_PROJECT_PARALLEL", base);
  await c.applyDecision(plan, base);
  const allowed = await c.beforeWrite({ ...base, event: event(fx, "c", "before-c-retry"), scopes: ["b.txt"], operationId: "op-c" });
  assert.equal(allowed.decision, "ALLOW");
});

test("write-after converts changed files to dirty claims and is idempotent", async () => {
  const fx = fixture();
  const before = await c.beforeWrite({ ...fx, event: event(fx, "a", "before"), scopes: ["a.txt"], operationId: "op" });
  fs.writeFileSync(path.join(fx.project, "a.txt"), "changed\n");
  const after = await c.afterWrite({ ...fx, event: { ...event(fx, "a", "after"), success: true }, operationId: before.operationId });
  assert.equal(after.claims.some((claim) => claim.type === "DIRTY_CLAIM" && claim.enforcement), true);
  const duplicate = await c.afterWrite({ ...fx, event: { ...event(fx, "a", "after"), success: true }, operationId: before.operationId });
  assert.equal(duplicate.action, "duplicate");
});

test("UNKNOWN reservation requires generation abandon and rejects stale events", async () => {
  const fx = fixture();
  const before = await c.beforeWrite({ ...fx, event: event(fx, "a", "before"), scopes: ["a.txt"], operationId: "op" });
  const paths = c.resolveStateDirectory(fx);
  const ledger = c.readLedger(paths);
  const task = ledger.tasks[before.taskId];
  task.status = c.UNKNOWN;
  c.writeLedger(paths, { ...ledger, ledgerRevision: ledger.ledgerRevision + 1 });
  const conflict = await c.beforeWrite({ ...fx, event: event(fx, "b", "before-b"), scopes: ["a.txt"], operationId: "op-b" });
  assert.equal(conflict.decision, "UNKNOWN_OWNER_DECISION_REQUIRED");
  const plan = c.planDecision(conflict.decisionRequestId, "ABANDON_TASK_AND_RELEASE", fx);
  const applied = await c.applyDecision(plan, fx);
  assert.equal(applied.applied, true);
  await assert.rejects(() => c.beforeWrite({ ...fx, event: { ...event(fx, "a", "late"), generation: 1 }, scopes: ["a.txt"], operationId: "late" }), (error) => error.code === "TASK_GENERATION_REVOKED");
});

test("provider adapters normalize Codex and Claude events to the same core envelope", () => {
  const codex = protocol.normalizeEnvelope("codex", { hook_event_name: "PreToolUse", session_id: "s", cwd: "/tmp", tool_name: "Edit", tool_input: { file_path: "a.js" }, workspace_uuid: UUID });
  const claude = protocol.normalizeEnvelope("claude", { hook_event_name: "PreToolUse", session_id: "s", cwd: "/tmp", tool_name: "Edit", tool_input: { file_path: "a.js" }, workspace_uuid: UUID });
  assert.equal(codex.eventType, "write.before");
  assert.equal(claude.eventType, codex.eventType);
  assert.deepEqual(protocol.classifyTool(codex.tool).scopes, protocol.classifyTool(claude.tool).scopes);
  assert.equal(protocol.renderNativeDecision("codex", { decision: "DENY_FILE_CONFLICT" }).decision, "block");
});

test("multi-range reservations are atomic and PROJECT_WIDE is bidirectionally exclusive", async () => {
  const fx = fixture();
  const owner = await c.beforeWrite({ ...fx, event: event(fx, "owner", "owner-before"), scopes: ["a.txt"], operationId: "owner-op" });
  const multi = await c.beforeWrite({ ...fx, event: event(fx, "multi", "multi-before"), scopes: ["b.txt", "a.txt"], operationId: "multi-op" });
  assert.equal(multi.decision, "DENY_FILE_CONFLICT");
  assert.equal(c.inspectLocks(fx).claims.filter((claim) => claim.taskId === multi.taskId).length, 0);
  const wide = await c.beforeWrite({ ...fx, event: event(fx, "wide", "wide-before", "Bash"), scopes: [{ type: "PROJECT_WIDE" }], operationId: "wide-op" });
  assert.equal(wide.decision, "DENY_UNKNOWN_WRITE_SCOPE");
  assert.equal(owner.decision, "ALLOW");
});

test("parallel before-write calls serialize on one ledger mutex", async () => {
  const fx = fixture();
  const results = await Promise.all([
    c.beforeWrite({ ...fx, event: event(fx, "one", "parallel-one"), scopes: ["a.txt"], operationId: "one" }),
    c.beforeWrite({ ...fx, event: event(fx, "two", "parallel-two"), scopes: ["a.txt"], operationId: "two" }),
  ]);
  assert.equal(results.filter((result) => result.decision === "ALLOW").length, 1);
  assert.equal(results.some((result) => result.decision === "DENY_FILE_CONFLICT"), true);
});

test("active dirty claims release after clean, while UNKNOWN claims stay for adjudication", async () => {
  const fx = fixture();
  const before = await c.beforeWrite({ ...fx, event: event(fx, "active", "active-before"), scopes: ["a.txt"], operationId: "active-op" });
  fs.writeFileSync(path.join(fx.project, "a.txt"), "dirty\n");
  await c.afterWrite({ ...fx, event: { ...event(fx, "active", "active-after"), success: true }, operationId: before.operationId });
  spawnSync("git", ["add", "a.txt"], { cwd: fx.project });
  spawnSync("git", ["-c", "user.email=test@example.com", "-c", "user.name=test", "commit", "-qm", "clean"], { cwd: fx.project });
  await c.reconcileClaims(fx);
  assert.equal(c.inspectLocks(fx).claims.some((claim) => claim.taskId === before.taskId && claim.enforcement), false);
});

test("decision plan becomes stale and abandon refuses a known live process", async () => {
  const fx = fixture();
  const before = await c.beforeWrite({ ...fx, event: event(fx, "owner", "owner-before"), scopes: ["a.txt"], operationId: "owner-op" });
  const paths = c.resolveStateDirectory(fx);
  const ledger = c.readLedger(paths);
  ledger.tasks[before.taskId].status = c.UNKNOWN;
  ledger.tasks[before.taskId].runtimeEvidence = { process: { alive: true, pid: 123 } };
  c.writeLedger(paths, { ...ledger, ledgerRevision: ledger.ledgerRevision + 1 });
  const conflict = await c.beforeWrite({ ...fx, event: event(fx, "requester", "requester-before"), scopes: ["a.txt"], operationId: "requester-op" });
  const plan = c.planDecision(conflict.decisionRequestId, "ABANDON_TASK_AND_RELEASE", fx);
  const changed = c.readLedger(paths);
  changed.tasks[before.taskId].runtimeEvidence.process.alive = false;
  c.writeLedger(paths, { ...changed, ledgerRevision: changed.ledgerRevision + 1 });
  await assert.rejects(() => c.applyDecision(plan, fx), (error) => error.code === "TASK_DECISION_STALE");
});

test("coordination managed Hook fragments are idempotent and preserve user settings", () => {
  const fx = fixture();
  const settings = path.join(fx.root, ".claude", "settings.json");
  fs.mkdirSync(path.dirname(settings), { recursive: true });
  fs.writeFileSync(settings, JSON.stringify({ permissions: { allow: ["Read"] }, hooks: { PreToolUse: [{ matcher: "Custom", hooks: [{ type: "command", command: "echo user" }] }] } }));
  const first = managed.installCoordinationHooks(fx.root, ["claude"]);
  const second = managed.installCoordinationHooks(fx.root, ["claude"]);
  assert.equal(first[0].action, "write");
  assert.equal(second[0].action, "skip");
  const output = JSON.parse(fs.readFileSync(settings, "utf8"));
  assert.deepEqual(output.permissions, { allow: ["Read"] });
  assert.equal(output.hooks.PreToolUse.some((entry) => entry.hooks?.some((hook) => /task-hook claude/.test(hook.command))), true);
});

function worker(input) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(__dirname, "..", "..", "scripts", "task-coordination-worker.js")], { stdio: ["pipe", "pipe", "pipe"] });
    let output = "";
    child.stdout.on("data", (chunk) => { output += chunk; });
    child.on("error", reject);
    child.on("close", () => {
      try { resolve(JSON.parse(output)); } catch (error) { reject(error); }
    });
    child.stdin.end(JSON.stringify(input));
  });
}

test("multi-process harness gives one winner for the same file", async () => {
  const fx = fixture();
  const input = (session, eventId, operationId) => ({ ...fx, event: event(fx, session, eventId), scopes: ["a.txt"], operationId });
  const results = await Promise.all([worker(input("p1", "p1", "p1")), worker(input("p2", "p2", "p2"))]);
  assert.equal(results.filter((entry) => entry.ok && entry.result.decision === "ALLOW").length, 1);
  assert.equal(results.some((entry) => entry.ok && entry.result.decision === "DENY_FILE_CONFLICT"), true);
});

test("before/after failpoints fail closed without committing half a claim", async () => {
  const fx = fixture();
  await assert.rejects(() => c.beforeWrite({ ...fx, event: event(fx, "fail", "fail"), scopes: ["a.txt"], operationId: "fail", injectFailure: (stage) => { if (stage === "write-before-decision") throw new Error("injected"); } }));
  assert.equal(c.inspectLocks(fx).claims.length, 0);
});
