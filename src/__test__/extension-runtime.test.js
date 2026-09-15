const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { parse, hostJsonRequested } = require("../cli/parser");
const { sha256 } = require("../core/fs");
const { directoryDigest } = require("../core/directory-digest");
const { ensureStoredExtensionPackage, listPackageReferences } = require("../core/extension-store");
const {
  executeExtensionRuntime,
  loadRuntimeServiceRegistry,
  resolveExtensionRuntime,
  runOneshotRuntime,
  runServiceRuntime,
  saveRuntimeServiceRegistry,
  serviceRegistryPath,
} = require("../core/extension-runtime");

function temporaryRoot(prefix = "code-workspace-extension-runtime-test-") {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function writeRuntimePackage(root, options = {}) {
  const id = options.id || "runtime-example";
  const version = options.version || "1.0.0";
  const mode = options.mode || "oneshot";
  const scope = options.scope || "global";
  const versionRoot = path.join(root, id, version);
  fs.mkdirSync(versionRoot, { recursive: true });
  fs.writeFileSync(path.join(versionRoot, "init.js"), "// installation entry\n");
  const runtimeSource = options.runtimeSource || [
    "const fs = require('node:fs');",
    "const context = JSON.parse(fs.readFileSync(process.env.CODE_WORKSPACE_RUNTIME_CONTEXT, 'utf8'));",
    "if (context.mode === 'service') { fs.writeFileSync(context.readiness.file, 'ready\\n'); setInterval(() => {}, 1000); }",
    "else process.stdout.write(JSON.stringify({ schemaVersion: 1, runtimeProtocolVersion: 1, extension: { id: context.extension.id, version: context.extension.version }, data: { argv: process.argv.slice(2), hasWorkspaceRoot: JSON.stringify(context).includes('workspaceRoot') }, diagnostics: [], text: 'ok' }));",
  ].join("\n");
  fs.writeFileSync(path.join(versionRoot, "runtime.js"), runtimeSource);
  const runtime = {
    runtimeProtocolVersion: options.runtimeProtocolVersion || 1,
    entry: "runtime.js",
    entrySha256: sha256(Buffer.from(runtimeSource)),
    scope,
    mode,
    timeoutMs: options.timeoutMs || 1000,
    ...(mode === "oneshot" ? { maxOutputBytes: options.maxOutputBytes || 65536 } : {
      service: { id: options.serviceId || `${id}-service`, compatibilityGroup: options.compatibilityGroup || "v1", singleton: "user" },
    }),
  };
  const manifest = {
    schemaVersion: 3,
    extensionSpecVersion: 1,
    experimental: true,
    id,
    name: id,
    description: "Runtime test extension.",
    version,
    entry: "init.js",
    entrySha256: sha256(Buffer.from("// installation entry\n")),
    timeoutMs: 1000,
    runtime,
  };
  fs.writeFileSync(path.join(versionRoot, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  return versionRoot;
}

test("ext parser keeps extension argv opaque after the extension id", () => {
  const parseArgs = (args) => parse([process.execPath, "codew", ...args]);
  assert.deepEqual(parseArgs(["ext", "example", "status", "--json", "-p", "8080"]).args, ["example", "status", "--json", "-p", "8080"]);
  assert.equal(parseArgs(["ext", "--json", "example", "status"]).options.json, true);
  assert.equal(hostJsonRequested([process.execPath, "codew", "ext", "example", "--json"]), false);
  assert.equal(hostJsonRequested([process.execPath, "codew", "ext", "--json", "example"]), true);
});

test("oneshot runtime resolves from Store and returns a validated envelope", () => {
  const source = temporaryRoot();
  const store = temporaryRoot();
  const packageDir = writeRuntimePackage(source);
  const stored = ensureStoredExtensionPackage({ sourceRoot: packageDir, storeRoot: store });
  const plan = resolveExtensionRuntime({ id: "runtime-example", storeRoot: store });
  assert.equal(plan.packageSha256, stored.packageSha256);
  const result = runOneshotRuntime(plan, ["status", "--json"], { tempRoot: temporaryRoot() });
  assert.deepEqual(result.data.argv, ["status", "--json"]);
  assert.equal(result.data.hasWorkspaceRoot, false);
  assert.deepEqual(listPackageReferences(store), [{
    ...listPackageReferences(store)[0],
    references: { workspaces: [], processes: [], transactions: [], pins: [] },
  }]);
});

test("workspace runtime requires activation and service runtime releases references", async () => {
  const source = temporaryRoot();
  const store = temporaryRoot();
  const workspace = temporaryRoot();
  const packageDir = writeRuntimePackage(source, { id: "workspace-runtime", scope: "workspace" });
  const stored = ensureStoredExtensionPackage({ sourceRoot: packageDir, storeRoot: store });
  assert.throws(() => resolveExtensionRuntime({ id: "workspace-runtime", workspaceRoot: workspace, storeRoot: store }), (error) => error.code === "EXTENSION_RUNTIME_ACTIVATION_REQUIRED");
  fs.mkdirSync(path.join(workspace, ".codew"), { recursive: true });
  fs.writeFileSync(path.join(workspace, ".codew", "ext-manifest.json"), `${JSON.stringify({ schemaVersion: 1, experimental: true, extensions: { "workspace-runtime": { installed: { protocolVersion: 3, extensionSpecVersion: 1, version: "1.0.0", manifestSha256: stored.manifestSha256, packageSha256: stored.packageSha256, artifacts: [] } } } }, null, 2)}\n`);
  const plan = resolveExtensionRuntime({ id: "workspace-runtime", workspaceRoot: workspace, storeRoot: store });
  assert.equal(plan.runtime.scope, "workspace");

  const serviceSource = temporaryRoot();
  const serviceStore = temporaryRoot();
  const serviceDir = writeRuntimePackage(serviceSource, { id: "service-runtime", mode: "service", scope: "global", timeoutMs: 1000 });
  ensureStoredExtensionPackage({ sourceRoot: serviceDir, storeRoot: serviceStore });
  const servicePlan = resolveExtensionRuntime({ id: "service-runtime", storeRoot: serviceStore });
  const running = runServiceRuntime(servicePlan, [], { tempRoot: temporaryRoot(), stdio: "ignore" });
  await new Promise((resolve) => setTimeout(resolve, 100));
  const registry = loadRuntimeServiceRegistry(serviceStore);
  assert.equal(registry.services["service-runtime-service"].ready, true);
  process.kill(registry.services["service-runtime-service"].pid, "SIGTERM");
  const result = await running;
  assert.equal(result.status, "stopped");
  assert.deepEqual(loadRuntimeServiceRegistry(serviceStore).services, {});
  assert.deepEqual(listPackageReferences(serviceStore)[0].references.processes, []);
});

test("global runtime does not require workspace state", () => {
  const source = temporaryRoot();
  const store = temporaryRoot();
  writeRuntimePackage(source, { id: "global-runtime", scope: "global" });
  ensureStoredExtensionPackage({ sourceRoot: path.join(source, "global-runtime", "1.0.0"), storeRoot: store });
  const plan = resolveExtensionRuntime({ id: "global-runtime", workspaceRoot: temporaryRoot(), storeRoot: store });
  assert.equal(plan.runtime.scope, "global");
});

test("oneshot runtime rejects timeout, output overflow and identity mismatch", () => {
  const cases = [
    {
      id: "runtime-timeout",
      options: { timeoutMs: 50, runtimeSource: "while (true) {}" },
      code: "EXTENSION_RUNTIME_TIMEOUT",
    },
    {
      id: "runtime-output",
      options: { timeoutMs: 5000, maxOutputBytes: 1024, runtimeSource: "process.stdout.write('x'.repeat(2000));" },
      code: "EXTENSION_RUNTIME_OUTPUT_LIMIT",
    },
    {
      id: "runtime-identity",
      options: { runtimeSource: "process.stdout.write(JSON.stringify({ schemaVersion: 1, runtimeProtocolVersion: 1, extension: { id: 'other', version: '1.0.0' }, data: {} }));" },
      code: "EXTENSION_RUNTIME_RESULT_IDENTITY_MISMATCH",
    },
  ];
  for (const { id, options, code } of cases) {
    const source = temporaryRoot();
    const store = temporaryRoot();
    writeRuntimePackage(source, { id, ...options });
    ensureStoredExtensionPackage({ sourceRoot: path.join(source, id, "1.0.0"), storeRoot: store });
    const plan = resolveExtensionRuntime({ id, storeRoot: store });
    assert.throws(() => runOneshotRuntime(plan, [], { tempRoot: temporaryRoot() }), (error) => error.code === code);
  }
});

test("service registry path stays inside the Store", () => {
  const store = temporaryRoot();
  assert.equal(serviceRegistryPath(store), path.join(store, ".runtime-services.json"));
  assert.equal(directoryDigest(path.dirname(serviceRegistryPath(store))), directoryDigest(store));
});

test("runtime capability and entry drift fail before process startup", () => {
  const unsupportedSource = temporaryRoot();
  const unsupportedStore = temporaryRoot();
  writeRuntimePackage(unsupportedSource, { id: "unsupported-runtime", runtimeProtocolVersion: 2 });
  ensureStoredExtensionPackage({ sourceRoot: path.join(unsupportedSource, "unsupported-runtime", "1.0.0"), storeRoot: unsupportedStore });
  assert.throws(() => resolveExtensionRuntime({ id: "unsupported-runtime", storeRoot: unsupportedStore }), (error) => error.code === "EXTENSION_RUNTIME_CAPABILITY_UNSUPPORTED");

  const staleSource = temporaryRoot();
  const staleStore = temporaryRoot();
  const stalePackage = writeRuntimePackage(staleSource, { id: "stale-runtime" });
  ensureStoredExtensionPackage({ sourceRoot: stalePackage, storeRoot: staleStore });
  fs.appendFileSync(path.join(staleStore, "stale-runtime", "1.0.0", "runtime.js"), "\n// drift\n");
  assert.throws(() => resolveExtensionRuntime({ id: "stale-runtime", storeRoot: staleStore }), (error) => error.code === "EXTENSION_RUNTIME_PACKAGE_STALE" || error.code === "EXTENSION_RUNTIME_ENTRY_STALE");
});

test("singleton services reject an incompatible running compatibility group", () => {
  const source = temporaryRoot();
  const store = temporaryRoot();
  const packageDir = writeRuntimePackage(source, { id: "compat-runtime", mode: "service", compatibilityGroup: "group-b" });
  ensureStoredExtensionPackage({ sourceRoot: packageDir, storeRoot: store });
  saveRuntimeServiceRegistry(store, { schemaVersion: 1, services: {
    "compat-runtime-service": {
      extensionId: "compat-runtime", version: "1.0.0", pid: process.pid,
      compatibilityGroup: "group-a", reference: "existing",
    },
  } });
  const plan = resolveExtensionRuntime({ id: "compat-runtime", storeRoot: store });
  assert.throws(() => runServiceRuntime(plan, [], { stdio: "ignore" }), (error) => error.code === "EXTENSION_SERVICE_COMPATIBILITY_CONFLICT");
});
