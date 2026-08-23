const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");

const {
  acquireInitLock,
  readInitLockConfig,
  STALE_ENV,
  UPDATE_ENV,
} = require("../core/init-lock");

const cli = path.resolve(__dirname, "..", "..", "bin", "code-workspace.js");

function temporaryRoot(prefix = "code-workspace-init-lock-test-") {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

test("init lock uses project configuration names and validates the timing relationship", () => {
  assert.deepEqual(readInitLockConfig({ env: {
    [UPDATE_ENV]: "5000",
    [STALE_ENV]: "30000",
  } }), { update: 5000, stale: 30000 });
  assert.throws(() => readInitLockConfig({ env: {
    [UPDATE_ENV]: "20000",
    [STALE_ENV]: "30000",
  } }), (error) => error.code === "INIT_LOCK_CONFIG_INVALID");
  assert.throws(() => readInitLockConfig({ env: {
    [UPDATE_ENV]: "invalid",
    [STALE_ENV]: "30000",
  } }), (error) => error.code === "INIT_LOCK_CONFIG_INVALID");
});

test("the same Workspace rejects a second init lock without waiting and releases cleanly", async () => {
  const root = temporaryRoot();
  const config = { update: 5000, stale: 30000 };
  const release = await acquireInitLock(root, { config });
  try {
    await assert.rejects(acquireInitLock(root, { config }), (error) => error.code === "INIT_ALREADY_RUNNING");
  } finally {
    await release();
  }
  const releaseAgain = await acquireInitLock(root, { config });
  await releaseAgain();
});

test("different Workspaces can hold init locks concurrently", async () => {
  const config = { update: 5000, stale: 30000 };
  const first = await acquireInitLock(temporaryRoot("code-workspace-init-lock-a-"), { config });
  const second = await acquireInitLock(temporaryRoot("code-workspace-init-lock-b-"), { config });
  await first();
  await second();
});

test("lock heartbeat continues while the init thread is synchronously blocked", async () => {
  const root = temporaryRoot("code-workspace-init-lock-blocked-");
  const config = { update: 1000, stale: 3000 };
  const release = await acquireInitLock(root, { config });
  try {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5000);
    await assert.rejects(acquireInitLock(root, { config }), (error) => error.code === "INIT_ALREADY_RUNNING");
  } finally {
    await release();
  }
});

test("CLI reports INIT_ALREADY_RUNNING before writing the Workspace", async () => {
  const root = temporaryRoot();
  const release = await acquireInitLock(root, { config: { update: 5000, stale: 30000 } });
  try {
    const result = spawnSync(process.execPath, [
      cli,
      "init",
      root,
      "--tools",
      "none",
      "--extensions",
      "none",
      "--yes",
      "--json",
    ], { cwd: root, encoding: "utf8" });
    assert.equal(result.status, 1);
    const envelope = JSON.parse(result.stdout);
    assert.equal(envelope.ok, false);
    assert.equal(envelope.diagnostics[0].code, "INIT_ALREADY_RUNNING");
    assert.equal(fs.existsSync(path.join(root, ".code-workspace")), false);
  } finally {
    await release();
  }
});

test("extension install and uninstall share the Workspace operation lock", async () => {
  const root = temporaryRoot();
  const initialized = spawnSync(process.execPath, [
    cli,
    "init",
    root,
    "--tools",
    "codex",
    "--extensions",
    "none",
    "--yes",
    "--json",
  ], { cwd: root, encoding: "utf8" });
  assert.equal(initialized.status, 0, initialized.stderr);
  const release = await acquireInitLock(root, { config: { update: 5000, stale: 30000 } });
  try {
    for (const args of [
      ["extension", "install", "openspec-workspace", "--yes", "--json"],
      ["extension", "uninstall", "openspec-workspace", "--yes", "--json"],
    ]) {
      const result = spawnSync(process.execPath, [cli, ...args], { cwd: root, encoding: "utf8" });
      assert.equal(result.status, 1);
      assert.equal(JSON.parse(result.stdout).diagnostics[0].code, "INIT_ALREADY_RUNNING");
    }
  } finally {
    await release();
  }
});
