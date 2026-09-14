const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { discoverExtensions, executeExtension, emptyExtensionState, resolveExtensionPlans, planExtensionUninstall, applyExtensionUninstall } = require("../core/extensions");
const { ensureStoredExtensionPackage, listPackageReferences } = require("../core/extension-store");
const { resolveExtensionRuntime, runServiceRuntime, saveRuntimeServiceRegistry } = require("../core/extension-runtime");

function temp(prefix) { return fs.mkdtempSync(path.join(os.tmpdir(), prefix)); }
function workspace(root, name, uuid) {
  fs.mkdirSync(path.join(root, ".code-workspace"), { recursive: true });
  fs.writeFileSync(path.join(root, ".code-workspace", "config.yaml"), `schemaVersion: 2\nworkspace:\n  name: ${name}\n  uuid: ${uuid}\n  language: en-US\nmonitor:\n  enable: true\n  url: http://127.0.0.1:3211\nprojects:\n  ref: config-projects.yaml\n`);
  fs.writeFileSync(path.join(root, ".code-workspace", "config-projects.yaml"), "schemaVersion: 1\nprojects: []\n");
}

test("Monitor extension is global-service plus workspace activation and has no core Monitor import", () => {
  const entry = discoverExtensions().find((item) => item.id === "monitor");
  assert(entry?.latestSupported);
  assert.equal(entry.latestSupported.manifest.runtime.scope, "global");
  assert.equal(entry.latestSupported.manifest.runtime.service.id, "monitor");
  assert.equal(entry.latestSupported.manifest.runtime.service.compatibilityGroup, "v1");
  const source = fs.readFileSync(path.join(entry.latestSupported.sourceRoot, "monitor.js"), "utf8");
  assert.doesNotMatch(source, /src[\\/]monitor/);
});

test("two Workspaces can activate Monitor against one Store package and uninstall independently", () => {
  const store = temp("monitor-store-");
  const a = temp("monitor-a-");
  const b = temp("monitor-b-");
  workspace(a, "A", "123e4567-e89b-42d3-a456-426614174000");
  workspace(b, "B", "123e4567-e89b-42d3-a456-426614174001");
  const catalog = discoverExtensions();
  const plan = (root) => resolveExtensionPlans(catalog, ["monitor"], { tools: ["codex"], state: emptyExtensionState() })[0];
  const execute = (root) => executeExtension(root, plan(root), { schemaVersion: 1, extensionSpecVersion: 1, extension: { id: "monitor", version: plan(root).version }, workspace: { name: path.basename(root), uuid: root === a ? "123e4567-e89b-42d3-a456-426614174000" : "123e4567-e89b-42d3-a456-426614174001", language: "en-US" }, tools: ["codex"] }, { extensionStoreRoot: store, useExtensionStore: true });
  const first = execute(a); const second = execute(b);
  assert.equal(first.status, "installed"); assert.equal(second.status, "installed");
  assert.equal(listPackageReferences(store)[0].references.workspaces.length, 2);
  const uninstall = applyExtensionUninstall(planExtensionUninstall(a, "monitor"), { extensionStoreRoot: store });
  assert.equal(uninstall.status, "uninstalled");
  assert.equal(fs.existsSync(path.join(b, ".code-workspace", "config-monitor.yaml")), true);
  assert.equal(listPackageReferences(store)[0].references.workspaces.length, 1);
});

test("Monitor runtime resolves globally without a Workspace activation", () => {
  const store = temp("monitor-runtime-store-");
  const source = discoverExtensions().find((item) => item.id === "monitor").latestSupported.sourceRoot;
  ensureStoredExtensionPackage({ storeRoot: store, sourceRoot: source, source: "builtin" });
  const runtime = resolveExtensionRuntime({ id: "monitor", storeRoot: store });
  assert.equal(runtime.runtime.service.id, "monitor");
  assert.equal(runtime.runtime.service.compatibilityGroup, "v1");
});

test("Monitor singleton rejects an incompatible running service group", () => {
  const store = temp("monitor-conflict-");
  const source = discoverExtensions().find((item) => item.id === "monitor").latestSupported.sourceRoot;
  ensureStoredExtensionPackage({ storeRoot: store, sourceRoot: source, source: "builtin" });
  saveRuntimeServiceRegistry(store, { schemaVersion: 1, services: {
    monitor: { extensionId: "monitor", version: "1.0.0", pid: process.pid, compatibilityGroup: "v2", reference: "existing" },
  } });
  const plan = resolveExtensionRuntime({ id: "monitor", storeRoot: store });
  assert.throws(() => runServiceRuntime(plan, ["serve"], { stdio: "ignore" }), (error) => error.code === "EXTENSION_SERVICE_COMPATIBILITY_CONFLICT");
});
