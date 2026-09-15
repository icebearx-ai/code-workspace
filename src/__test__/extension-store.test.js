const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  addPackageReference,
  ensureStoredExtensionPackage,
  gcExtensionPackages,
  listPackageReferences,
  packageRoot,
  removeWorkspaceReference,
} = require("../core/extension-store");
const {
  discoverExtensions,
  emptyExtensionState,
  executeExtension,
  loadExtensionState,
  planExtensionUninstall,
  applyExtensionUninstall,
  planExtensionStoreMigration,
  resolveExtensionPlans,
} = require("../core/extensions");
const { directoryDigest } = require("../core/directory-digest");
const { sha256 } = require("../core/fs");

function temporaryRoot(prefix = "code-workspace-extension-store-test-") {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function writePackage(root, { id = "example", version = "1.0.0", content = `${id}@${version}\n` } = {}) {
  const versionRoot = path.join(root, id, version);
  fs.mkdirSync(versionRoot, { recursive: true });
  const script = [
    'const fs = require("node:fs");',
    'const path = require("node:path");',
    'const output = process.argv[process.argv.indexOf("--output") + 1];',
    'const result = process.argv[process.argv.indexOf("--result") + 1];',
    'const target = path.join(output, "artifact.txt");',
    'fs.mkdirSync(path.dirname(target), { recursive: true });',
    `fs.writeFileSync(target, ${JSON.stringify(content)});`,
    `fs.writeFileSync(result, JSON.stringify({ schemaVersion: 1, extensionSpecVersion: 1, extension: { id: ${JSON.stringify(id)}, version: ${JSON.stringify(version)} }, outputs: [{ id: "artifact", source: "artifact.txt" }] }));`,
    "",
  ].join("\n");
  fs.writeFileSync(path.join(versionRoot, "init.js"), script);
  fs.writeFileSync(path.join(versionRoot, "manifest.json"), `${JSON.stringify({
    schemaVersion: 3,
    extensionSpecVersion: 1,
    experimental: true,
    id,
    name: id,
    description: "Store test extension.",
    version,
    entry: "init.js",
    entrySha256: sha256(Buffer.from(script)),
    timeoutMs: 1000,
    outputs: [{ id: "artifact", kind: "file", ownership: "exclusive", target: ".example/artifact.txt" }],
  }, null, 2)}\n`);
  return versionRoot;
}

function context(plan) {
  return {
    schemaVersion: 1,
    extensionSpecVersion: plan.extensionSpecVersion,
    extension: { id: plan.id, version: plan.version },
    workspace: { name: "test", uuid: "123e4567-e89b-42d3-a456-426614174000", language: "zh-CN" },
    tools: ["codex"],
  };
}

test("Store package providers reject missing source roots explicitly", () => {
  assert.throws(() => ensureStoredExtensionPackage({ storeRoot: temporaryRoot() }), (error) => error.code === "EXTENSION_STORE_SOURCE_MISSING");
});

test("Store imports immutable built-in packages and supports multiple versions", () => {
  const source = temporaryRoot();
  const store = temporaryRoot();
  const one = writePackage(source, { version: "1.0.0" });
  const two = writePackage(source, { version: "2.0.0" });
  const first = ensureStoredExtensionPackage({ sourceRoot: one, storeRoot: store });
  const second = ensureStoredExtensionPackage({ sourceRoot: two, storeRoot: store });
  assert.equal(first.packageSha256, directoryDigest(packageRoot(store, "example", "1.0.0")));
  assert.equal(second.packageSha256, directoryDigest(packageRoot(store, "example", "2.0.0")));
  assert(fs.existsSync(path.join(store, "example", "1.0.0", "manifest.json")));
  assert(fs.existsSync(path.join(store, "example", "2.0.0", "manifest.json")));
});

test("Store references protect packages from GC and release after Workspace uninstall", () => {
  const source = temporaryRoot();
  const store = temporaryRoot();
  const packageDir = writePackage(source);
  ensureStoredExtensionPackage({ sourceRoot: packageDir, storeRoot: store });
  addPackageReference(store, "example", "1.0.0", "workspaces", "/workspace-a");
  assert.deepEqual(gcExtensionPackages(store).removed, []);
  removeWorkspaceReference(store, "example", "1.0.0", "/workspace-a");
  assert.deepEqual(gcExtensionPackages(store).removed, ["example@1.0.0"]);
  assert.equal(listPackageReferences(store).length, 0);
});

test("running and transactional references keep a package until both are released", () => {
  const source = temporaryRoot();
  const store = temporaryRoot();
  ensureStoredExtensionPackage({ sourceRoot: writePackage(source), storeRoot: store });
  addPackageReference(store, "example", "1.0.0", "processes", "pid-1");
  addPackageReference(store, "example", "1.0.0", "transactions", "tx-1");
  assert.deepEqual(gcExtensionPackages(store).removed, []);
  const refs = listPackageReferences(store)[0].references;
  assert.deepEqual(refs.processes, ["pid-1"]);
  assert.deepEqual(refs.transactions, ["tx-1"]);
});

test("migration planning reports ready and unavailable package states without writing", () => {
  const source = temporaryRoot();
  const store = temporaryRoot();
  const workspace = temporaryRoot();
  const packageDir = writePackage(source);
  const plan = resolveExtensionPlans(discoverExtensions({ extensionsRoot: source }), ["example"], { tools: ["codex"], state: emptyExtensionState() })[0];
  const state = emptyExtensionState();
  state.extensions.example = { installed: { version: plan.version, manifestSha256: "a".repeat(64), packageSha256: plan.packageSha256, artifacts: [] } };
  fs.mkdirSync(path.join(workspace, ".codew"), { recursive: true });
  fs.writeFileSync(path.join(workspace, ".codew", "ext-manifest.json"), `${JSON.stringify(state)}\n`);
  const ready = planExtensionStoreMigration(workspace, "example", { extensionsRoot: source, extensionStoreRoot: store });
  assert.equal(ready.status, "ready");
  fs.rmSync(packageDir, { recursive: true, force: true });
  const blocked = planExtensionStoreMigration(workspace, "example", { extensionsRoot: source, extensionStoreRoot: store });
  assert.equal(blocked.status, "blocked");
  assert.equal(blocked.code, "EXTENSION_STORE_PACKAGE_UNAVAILABLE");
});

test("Extension init executes from Store and records Workspace activation reference", () => {
  const source = temporaryRoot();
  const store = temporaryRoot();
  const workspace = temporaryRoot();
  const packageDir = writePackage(source);
  const plan = resolveExtensionPlans(discoverExtensions({ extensionsRoot: source }), ["example"], { tools: ["codex"], state: emptyExtensionState() })[0];
  const result = executeExtension(workspace, plan, context(plan), { useExtensionStore: true, extensionStoreRoot: store });
  assert.equal(result.status, "installed");
  assert.equal(fs.readFileSync(path.join(workspace, ".example", "artifact.txt"), "utf8"), "example@1.0.0\n");
  assert.equal(fs.existsSync(path.join(workspace, "example", "1.0.0")), false);
  assert.deepEqual(listPackageReferences(store)[0].references.workspaces, [path.resolve(workspace)]);
  assert.equal(loadExtensionState(workspace).extensions.example.installed.packageSha256, plan.packageSha256);

  const uninstall = applyExtensionUninstall(planExtensionUninstall(workspace, "example"), { extensionStoreRoot: store });
  assert.equal(uninstall.status, "uninstalled");
  assert.deepEqual(listPackageReferences(store)[0].references.workspaces, []);
  assert.equal(packageDir.endsWith(path.join("example", "1.0.0")), true);
});

test("Extension execution can reuse a Store package after the built-in source is gone", () => {
  const source = temporaryRoot();
  const store = temporaryRoot();
  const workspace = temporaryRoot();
  const packageDir = writePackage(source);
  const plan = resolveExtensionPlans(discoverExtensions({ extensionsRoot: source }), ["example"], { tools: ["codex"], state: emptyExtensionState() })[0];
  ensureStoredExtensionPackage({ sourceRoot: packageDir, storeRoot: store });
  fs.rmSync(packageDir, { recursive: true, force: true });

  const result = executeExtension(workspace, plan, context(plan), { useExtensionStore: true, extensionStoreRoot: store });

  assert.equal(result.status, "installed");
  assert.equal(fs.readFileSync(path.join(workspace, ".example", "artifact.txt"), "utf8"), "example@1.0.0\n");
});
