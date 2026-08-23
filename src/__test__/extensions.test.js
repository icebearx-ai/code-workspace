const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");
const yaml = require("js-yaml");

const { parse } = require("../cli/parser");
const {
  collectExtensionInstallSelection,
  executeExtensionInstall,
} = require("../cli/commands/extension");
const { collectInitPlan } = require("../init/wizard");
const { loadConfigProjection } = require("../core/config");
const { loadInitManifest } = require("../core/init");
const { installManagedFiles } = require("../core/managed-files");
const {
  assertSafeWorkspaceTarget,
  applyExtensionUninstall,
  compareSemver,
  discoverExtensions,
  emptyExtensionState,
  executeExtension,
  extensionStatePath,
  inspectExtensionState,
  loadExtensionState,
  normalizeExtensionNames,
  parseExtensionSelection,
  parseSemver,
  planExtensionUninstall,
  prepareExtensionPlans,
  resolveExtensionPlans,
  runExtensionBatch,
  satisfiesSemverRange,
  saveExtensionState,
  validateManifest,
  verifyExtensionOutput,
} = require("../core/extensions");
const { atomicWrite, sha256 } = require("../core/fs");

const cli = path.resolve(__dirname, "..", "..", "bin", "code-workspace.js");
const argv = (...args) => [process.execPath, "code-workspace", ...args];

function temporaryRoot(prefix = "code-workspace-extension-test-") {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function defaultScript(target, content) {
  return [
    'const fs = require("node:fs");',
    'const path = require("node:path");',
    'const outputIndex = process.argv.indexOf("--output");',
    'const contextIndex = process.argv.indexOf("--context");',
    'const output = process.argv[outputIndex + 1];',
    'const context = JSON.parse(fs.readFileSync(process.argv[contextIndex + 1], "utf8"));',
    'if (context.workspace && Object.prototype.hasOwnProperty.call(context.workspace, "root")) throw new Error("workspace root leaked");',
    `const target = path.join(output, ...${JSON.stringify(target)}.split("/"));`,
    'fs.mkdirSync(path.dirname(target), { recursive: true });',
    `fs.writeFileSync(target, ${JSON.stringify(content)});`,
    "",
  ].join("\n");
}

function outputScript(outputs) {
  return [
    'const fs = require("node:fs");',
    'const path = require("node:path");',
    'const outputIndex = process.argv.indexOf("--output");',
    'const output = process.argv[outputIndex + 1];',
    `const files = ${JSON.stringify(outputs)};`,
    'for (const [relative, content] of Object.entries(files)) {',
    '  const target = path.join(output, ...relative.split("/"));',
    '  fs.mkdirSync(path.dirname(target), { recursive: true });',
    '  fs.writeFileSync(target, content);',
    '}',
    '',
  ].join("\n");
}

function writeExtension(repository, options = {}) {
  const id = options.id || "example-extension";
  const version = options.version || "1.0.0";
  const target = options.target || `.example/${id}.txt`;
  const content = options.content || `${id}@${version}\n`;
  const versionRoot = path.join(repository, id, version);
  fs.mkdirSync(versionRoot, { recursive: true });
  const script = options.script || defaultScript(target, content);
  fs.writeFileSync(path.join(versionRoot, "init.js"), script);
  const artifacts = options.artifacts || [{
    id: "example-artifact",
    kind: "file",
    target,
    output: target,
    sha256: options.sha256 || sha256(Buffer.from(content)),
    ...(options.tools ? { tools: options.tools } : {}),
  }];
  fs.writeFileSync(path.join(versionRoot, "manifest.json"), `${JSON.stringify({
    schemaVersion: 1,
    experimental: true,
    id,
    name: options.name || id,
    version,
    entry: "init.js",
    entrySha256: sha256(Buffer.from(script)),
    codeWorkspace: options.codeWorkspace || ">=0.1.0-beta.3 <0.2.0",
    timeoutMs: options.timeoutMs || 1000,
    artifacts,
  }, null, 2)}\n`);
  return { id, version, target, content, versionRoot };
}

function context(plan) {
  return {
    schemaVersion: 1,
    extension: { id: plan.id, version: plan.version },
    workspace: { name: "test", uuid: "123e4567-e89b-42d3-a456-426614174000", language: "zh-CN" },
    tools: ["codex"],
  };
}

function runCli(root, args) {
  return spawnSync(process.execPath, [cli, ...args], { cwd: root, encoding: "utf8" });
}

test("strict SemVer comparison includes prerelease precedence and compatibility ranges", () => {
  assert.equal(compareSemver("1.0.0-beta.3", "1.0.0-beta.11"), -1);
  assert.equal(compareSemver("1.0.0", "1.0.0-rc.1"), 1);
  assert.equal(compareSemver("1.0.0+build.1", "1.0.0+build.2"), 0);
  assert.equal(satisfiesSemverRange("0.1.0-beta.3", ">=0.1.0-beta.3 <0.2.0"), true);
  assert.equal(satisfiesSemverRange("0.2.0", ">=0.1.0-beta.3 <0.2.0"), false);
  assert.throws(() => parseSemver("01.0.0"), (error) => error.code === "EXTENSION_SEMVER_INVALID");
  assert.throws(() => satisfiesSemverRange("1.0.0", "^1.0.0"), (error) => error.code === "EXTENSION_SEMVER_RANGE_INVALID");
});

test("discovery selects the highest compatible version and freezes the manifest hash", () => {
  const repository = temporaryRoot();
  writeExtension(repository, { version: "1.0.0", codeWorkspace: ">=1.0.0 <2.0.0" });
  writeExtension(repository, { version: "1.2.0", codeWorkspace: ">=1.0.0 <2.0.0" });
  writeExtension(repository, { version: "2.0.0", codeWorkspace: ">=2.0.0 <3.0.0" });
  const catalog = discoverExtensions({ extensionsRoot: repository, codeWorkspaceVersion: "1.5.0" });
  assert.equal(catalog[0].latestCompatible.version, "1.2.0");
  assert.equal(catalog[0].latestCompatible.manifestSha256, sha256(fs.readFileSync(path.join(repository, "example-extension", "1.2.0", "manifest.json"))));
  assert(Object.isFrozen(catalog[0].latestCompatible.manifest));
});

test("manifest validation rejects unsafe, duplicate, core-owned, and invalid artifact declarations", () => {
  const base = {
    schemaVersion: 1,
    experimental: true,
    id: "example-extension",
    name: "Example",
    version: "1.0.0",
    entry: "init.js",
    entrySha256: "b".repeat(64),
    codeWorkspace: ">=0.1.0-beta.3 <0.2.0",
    timeoutMs: 1000,
    artifacts: [{ id: "artifact-one", kind: "file", target: ".example/one.txt", output: ".example/one.txt", sha256: "a".repeat(64) }],
  };
  for (const target of ["../escape", "/absolute", "dir\\file", "dir//file", "dir/./file"]) {
    assert.throws(() => validateManifest({ ...base, artifacts: [{ ...base.artifacts[0], target }] }), (error) => error.code === "EXTENSION_ARTIFACT_TARGET_INVALID", target);
  }
  assert.throws(() => validateManifest({ ...base, artifacts: [base.artifacts[0], { ...base.artifacts[0], id: "artifact-two", output: ".example/two.txt" }] }), (error) => error.code === "EXTENSION_TARGET_CONFLICT");
  assert.throws(() => validateManifest({ ...base, artifacts: [{ ...base.artifacts[0], target: "AGENTS.md" }] }), (error) => error.code === "EXTENSION_CORE_TARGET_FORBIDDEN");
  assert.throws(() => validateManifest({ ...base, artifacts: [{ ...base.artifacts[0], tools: ["unknown"] }] }), (error) => error.code === "EXTENSION_MANIFEST_INVALID");
});

test("selection accepts names only and plans reject extension ownership conflicts", () => {
  assert.deepEqual(parseExtensionSelection("alpha,beta-extension"), ["alpha", "beta-extension"]);
  assert.deepEqual(normalizeExtensionNames(["alpha", "beta-extension"]), ["alpha", "beta-extension"]);
  assert.deepEqual(parseExtensionSelection("none"), []);
  assert.throws(() => parseExtensionSelection("alpha@1.0.0"), (error) => error.code === "EXTENSION_VERSION_SELECTION_UNSUPPORTED");
  assert.throws(() => parseExtensionSelection("alpha,alpha"), (error) => error.code === "EXTENSION_SELECTION_INVALID");
  assert.throws(() => normalizeExtensionNames(["alpha,beta"]), (error) => error.code === "EXTENSION_NAME_INVALID");

  const repository = temporaryRoot();
  writeExtension(repository, { id: "alpha", target: ".example/shared.txt" });
  writeExtension(repository, { id: "beta", target: ".example/shared.txt" });
  const catalog = discoverExtensions({ extensionsRoot: repository });
  assert.throws(() => resolveExtensionPlans(catalog, ["alpha", "beta"], { tools: ["codex"], state: emptyExtensionState() }), (error) => error.code === "EXTENSION_TARGET_CONFLICT");
});

test("workspace target validation refuses symbolic-link traversal", (t) => {
  const root = temporaryRoot();
  const outside = temporaryRoot();
  fs.symlinkSync(outside, path.join(root, "linked"), "dir");
  t.after(() => fs.unlinkSync(path.join(root, "linked")));
  assert.throws(() => assertSafeWorkspaceTarget(root, "linked/file.txt"), (error) => error.code === "EXTENSION_ARTIFACT_SYMLINK");
});

test("output verification rejects missing, extra, symlinked, and hash-mismatched files", (t) => {
  const root = temporaryRoot();
  const artifact = { id: "artifact", target: "safe/file.txt", sha256: sha256(Buffer.from("expected\n")) };
  assert.throws(() => verifyExtensionOutput(root, [artifact]), (error) => error.code === "EXTENSION_ARTIFACT_MISSING");
  fs.mkdirSync(path.join(root, "safe"));
  fs.writeFileSync(path.join(root, "safe", "extra.txt"), "extra\n");
  assert.throws(() => verifyExtensionOutput(root, [artifact]), (error) => error.code === "EXTENSION_ARTIFACT_UNDECLARED");
  fs.unlinkSync(path.join(root, "safe", "extra.txt"));
  fs.writeFileSync(path.join(root, "safe", "file.txt"), "wrong\n");
  assert.throws(() => verifyExtensionOutput(root, [artifact]), (error) => error.code === "EXTENSION_ARTIFACT_HASH_MISMATCH");
  fs.unlinkSync(path.join(root, "safe", "file.txt"));
  const outside = path.join(temporaryRoot(), "outside.txt");
  fs.writeFileSync(outside, "expected\n");
  fs.symlinkSync(outside, path.join(root, "safe", "file.txt"));
  t.after(() => fs.unlinkSync(path.join(root, "safe", "file.txt")));
  assert.throws(() => verifyExtensionOutput(root, [artifact]), (error) => error.code === "EXTENSION_OUTPUT_SYMLINK");
});

test("extension execution installs verified output, persists state, cleans staging, and then skips", () => {
  const repository = temporaryRoot();
  const definition = writeExtension(repository);
  const plan = resolveExtensionPlans(discoverExtensions({ extensionsRoot: repository }), [definition.id], { tools: ["codex"], state: emptyExtensionState() })[0];
  const root = temporaryRoot();
  const tempParent = temporaryRoot("code-workspace-extension-staging-");
  const installed = executeExtension(root, plan, context(plan), { tempRoot: tempParent });
  assert.equal(installed.status, "installed");
  assert.equal(fs.readFileSync(path.join(root, definition.target), "utf8"), definition.content);
  assert.deepEqual(fs.readdirSync(tempParent), []);
  const state = loadExtensionState(root).extensions[definition.id];
  assert.equal(state.installed.version, "1.0.0");
  assert.equal(state.lastAttempt.status, "installed");
  assert.equal(executeExtension(root, plan, context(plan)).status, "skipped");
});

test("staging cleanup failure is reported without interrupting the installed result", () => {
  const repository = temporaryRoot();
  const definition = writeExtension(repository);
  const plan = resolveExtensionPlans(discoverExtensions({ extensionsRoot: repository }), [definition.id], { tools: ["codex"], state: emptyExtensionState() })[0];
  const root = temporaryRoot();
  const result = executeExtension(root, plan, context(plan), {
    rmSync() {
      throw new Error("injected cleanup failure");
    },
  });
  assert.equal(result.status, "installed");
  assert.equal(result.warnings[0].code, "EXTENSION_STAGING_CLEANUP_FAILED");
});

test("an occupied or locally modified target is never overwritten", () => {
  const repository = temporaryRoot();
  const definition = writeExtension(repository);
  const plan = resolveExtensionPlans(discoverExtensions({ extensionsRoot: repository }), [definition.id], { tools: ["codex"], state: emptyExtensionState() })[0];
  const root = temporaryRoot();
  fs.mkdirSync(path.dirname(path.join(root, definition.target)), { recursive: true });
  fs.writeFileSync(path.join(root, definition.target), "user content\n");
  const occupied = executeExtension(root, plan, context(plan));
  assert.equal(occupied.code, "EXTENSION_TARGET_OCCUPIED");
  assert.equal(fs.readFileSync(path.join(root, definition.target), "utf8"), "user content\n");

  fs.unlinkSync(path.join(root, definition.target));
  assert.equal(executeExtension(root, plan, context(plan)).status, "installed");
  fs.writeFileSync(path.join(root, definition.target), "local edit\n");
  const modified = executeExtension(root, plan, context(plan));
  assert.equal(modified.code, "EXTENSION_ARTIFACT_MODIFIED");
  assert.equal(fs.readFileSync(path.join(root, definition.target), "utf8"), "local edit\n");
});

test("crash and timeout failures are recorded while a batch continues", () => {
  const repository = temporaryRoot();
  writeExtension(repository, { id: "crashing", script: 'process.stderr.write("boom\\n"); process.exit(2);\n' });
  writeExtension(repository, { id: "timeout", timeoutMs: 30, script: "setInterval(() => {}, 1000);\n" });
  writeExtension(repository, { id: "working" });
  const state = emptyExtensionState();
  const plans = resolveExtensionPlans(discoverExtensions({ extensionsRoot: repository }), ["crashing", "timeout", "working"], { tools: ["codex"], state });
  const root = temporaryRoot();
  const result = runExtensionBatch(root, plans, (plan) => context(plan));
  assert.deepEqual(result.results.map((entry) => [entry.id, entry.status, entry.code]), [
    ["crashing", "failed", "EXTENSION_INIT_FAILED"],
    ["timeout", "failed", "EXTENSION_INIT_TIMEOUT"],
    ["working", "installed", undefined],
  ]);
  assert.deepEqual(result.summary, { installed: 1, skipped: 0, failed: 2 });
  const persisted = loadExtensionState(root);
  assert.equal(persisted.extensions.crashing.installed, null);
  assert.equal(persisted.extensions.crashing.lastAttempt.status, "failed");
  assert.equal(persisted.extensions.working.lastAttempt.status, "installed");
});

test("hash mismatch leaves real targets untouched and records the specific failure", () => {
  const repository = temporaryRoot();
  const definition = writeExtension(repository, { sha256: "f".repeat(64) });
  const plan = resolveExtensionPlans(discoverExtensions({ extensionsRoot: repository }), [definition.id], { tools: ["codex"], state: emptyExtensionState() })[0];
  const root = temporaryRoot();
  const result = executeExtension(root, plan, context(plan));
  assert.equal(result.code, "EXTENSION_ARTIFACT_HASH_MISMATCH");
  assert.equal(fs.existsSync(path.join(root, definition.target)), false);
  assert.equal(loadExtensionState(root).extensions[definition.id].lastAttempt.code, "EXTENSION_ARTIFACT_HASH_MISMATCH");
});

test("upgrade failure restores old artifacts and installed state while recording the new attempt", () => {
  const repository = temporaryRoot();
  const definition = writeExtension(repository, { content: "new\n" });
  const plan = resolveExtensionPlans(discoverExtensions({ extensionsRoot: repository }), [definition.id], { tools: ["codex"], state: emptyExtensionState() })[0];
  const root = temporaryRoot();
  const target = path.join(root, definition.target);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, "old\n");
  const oldState = emptyExtensionState();
  oldState.extensions[definition.id] = {
    installed: {
      version: "0.9.0",
      manifestSha256: "a".repeat(64),
      artifacts: [{ id: "example-artifact", target: definition.target, installedSha256: sha256(Buffer.from("old\n")) }],
    },
    lastAttempt: { version: "0.9.0", status: "installed" },
  };
  saveExtensionState(root, oldState);
  const result = executeExtension(root, plan, context(plan), {
    injectFailure(stage) {
      if (stage === "after-state-save") throw new Error("injected state verification failure");
    },
  });
  assert.equal(result.status, "failed");
  assert.equal(fs.readFileSync(target, "utf8"), "old\n");
  const state = loadExtensionState(root).extensions[definition.id];
  assert.equal(state.installed.version, "0.9.0");
  assert.equal(state.lastAttempt.version, "1.0.0");
  assert.equal(state.lastAttempt.status, "failed");
});

test("postcondition drift is detected before commit and rolled back", () => {
  const repository = temporaryRoot();
  const definition = writeExtension(repository);
  const plan = resolveExtensionPlans(discoverExtensions({ extensionsRoot: repository }), [definition.id], { tools: ["codex"], state: emptyExtensionState() })[0];
  const root = temporaryRoot();
  let drifted = false;
  const result = executeExtension(root, plan, context(plan), {
    injectFailure(stage) {
      if (stage === "after-state-save" && !drifted) {
        drifted = true;
        fs.appendFileSync(path.join(root, definition.target), "drift\n");
      }
    },
  });
  assert.equal(result.code, "EXTENSION_POSTCONDITION_FAILED");
  assert.equal(fs.existsSync(path.join(root, definition.target)), false);
  assert.equal(loadExtensionState(root).extensions[definition.id].lastAttempt.code, "EXTENSION_POSTCONDITION_FAILED");
});

test("state persistence failure rolls back artifacts and reports that the failed attempt was not persisted", () => {
  const repository = temporaryRoot();
  const definition = writeExtension(repository);
  const plan = resolveExtensionPlans(discoverExtensions({ extensionsRoot: repository }), [definition.id], { tools: ["codex"], state: emptyExtensionState() })[0];
  const root = temporaryRoot();
  const result = executeExtension(root, plan, context(plan), {
    atomicWrite(file, content) {
      if (path.basename(file) === "ext-manifest.json") throw new Error("injected state write failure");
      atomicWrite(file, content);
    },
  });
  assert.equal(result.status, "failed");
  assert.equal(result.statePersisted, false);
  assert.equal(fs.existsSync(path.join(root, definition.target)), false);
  assert.equal(fs.existsSync(extensionStatePath(root)), false);
});

test("runtime state corruption remains isolated to one failed extension result", () => {
  const repository = temporaryRoot();
  const definition = writeExtension(repository);
  const plan = resolveExtensionPlans(discoverExtensions({ extensionsRoot: repository }), [definition.id], { tools: ["codex"], state: emptyExtensionState() })[0];
  const root = temporaryRoot();
  fs.mkdirSync(path.dirname(extensionStatePath(root)), { recursive: true });
  fs.writeFileSync(extensionStatePath(root), "corrupt\n");
  const result = runExtensionBatch(root, [plan], (entry) => context(entry));
  assert.equal(result.results[0].status, "failed");
  assert.equal(result.results[0].statePersisted, false);
  assert.deepEqual(result.summary, { installed: 0, skipped: 0, failed: 1 });
});

test("rollback failure is surfaced with a stable code and does not throw out of the batch", () => {
  const repository = temporaryRoot();
  const definition = writeExtension(repository);
  const plan = resolveExtensionPlans(discoverExtensions({ extensionsRoot: repository }), [definition.id], { tools: ["codex"], state: emptyExtensionState() })[0];
  const root = temporaryRoot();
  const result = executeExtension(root, plan, context(plan), {
    createFileTransaction() {
      return {
        commit() {},
        rollback(error) {
          error.details = { ...(error.details || {}), workspaceRolledBack: false, rollbackErrors: ["injected rollback failure"] };
        },
      };
    },
    injectFailure(stage) {
      if (stage === "after-artifact-write") throw new Error("injected install failure");
    },
  });
  assert.equal(result.code, "EXTENSION_ROLLBACK_INCOMPLETE");
  assert.equal(result.status, "failed");
});

test("stale frozen manifests fail before executing their entry", () => {
  const repository = temporaryRoot();
  const definition = writeExtension(repository);
  const plan = resolveExtensionPlans(discoverExtensions({ extensionsRoot: repository }), [definition.id], { tools: ["codex"], state: emptyExtensionState() })[0];
  fs.appendFileSync(plan.manifestFile, " \n");
  const root = temporaryRoot();
  const result = executeExtension(root, plan, context(plan));
  assert.equal(result.code, "EXTENSION_PLAN_STALE");
  assert.equal(fs.existsSync(path.join(root, definition.target)), false);
});

test("stale frozen entries fail before execution and child environments omit parent PWD", () => {
  const repository = temporaryRoot();
  const target = ".example/environment.txt";
  const content = "clean\n";
  const script = [
    'const fs = require("node:fs");',
    'const path = require("node:path");',
    'const output = process.argv[process.argv.indexOf("--output") + 1];',
    'const target = path.join(output, ".example", "environment.txt");',
    'fs.mkdirSync(path.dirname(target), { recursive: true });',
    'fs.writeFileSync(target, process.env.PWD === undefined ? "clean\\n" : "leaked\\n");',
    "",
  ].join("\n");
  const definition = writeExtension(repository, { target, content, script });
  const catalog = discoverExtensions({ extensionsRoot: repository });
  const plan = resolveExtensionPlans(catalog, [definition.id], { tools: ["codex"], state: emptyExtensionState() })[0];
  const root = temporaryRoot();
  assert.equal(executeExtension(root, plan, context(plan)).status, "installed");
  assert.equal(fs.readFileSync(path.join(root, target), "utf8"), content);

  fs.appendFileSync(plan.entryFile, "\n// changed\n");
  const staleRoot = temporaryRoot();
  const stale = executeExtension(staleRoot, plan, context(plan));
  assert.equal(stale.code, "EXTENSION_PLAN_STALE");
  assert.equal(fs.existsSync(path.join(staleRoot, target)), false);
});

test("tolerant discovery and state inspection isolate extension preparation failures", () => {
  const repository = temporaryRoot();
  writeExtension(repository, { id: "working" });
  const invalidRoot = path.join(repository, "broken", "1.0.0");
  fs.mkdirSync(invalidRoot, { recursive: true });
  fs.writeFileSync(path.join(invalidRoot, "init.js"), "process.exit(0);\n");
  fs.writeFileSync(path.join(invalidRoot, "manifest.json"), "{}\n");
  const discovered = discoverExtensions({ extensionsRoot: repository, tolerant: true });
  assert.deepEqual(discovered.catalog.map((entry) => entry.id), ["working"]);
  assert.equal(discovered.invalid[0].id, "broken");
  const prepared = prepareExtensionPlans(discovered, ["working"], { tools: ["codex"], state: emptyExtensionState() });
  assert.equal(prepared.plans.length, 1);
  assert.equal(prepared.diagnostics.length, 1);
  const broken = prepareExtensionPlans(discovered, ["broken"], { tools: ["codex"], state: emptyExtensionState() });
  assert.equal(broken.failures[0].id, "broken");

  const root = temporaryRoot();
  fs.mkdirSync(path.dirname(extensionStatePath(root)), { recursive: true });
  fs.writeFileSync(extensionStatePath(root), "invalid\n");
  const inspected = inspectExtensionState(root);
  assert(inspected.error);
  const stateFailure = prepareExtensionPlans(discovered, ["working"], { tools: ["codex"], state: inspected.state, stateError: inspected.error });
  assert.equal(stateFailure.failures[0].code, "EXTENSION_STATE_PARSE_FAILED");
});

test("Host-managed config blocks and Hooks install and uninstall without removing core or user content", () => {
  const repository = temporaryRoot();
  const configOutput = "[mcp_servers.example]\ncommand = \"example\"\n";
  const hooksOutput = JSON.stringify({
    schemaVersion: 1,
    hooks: {
      SessionStart: [{ matcher: "*", hooks: [{ type: "command", command: "example hook", timeout: 5 }] }],
    },
  }, null, 2) + "\n";
  const outputs = {
    "contributions/config.toml": configOutput,
    "contributions/hooks.json": hooksOutput,
  };
  const artifacts = [
    { id: "config", kind: "codex-config-block", output: "contributions/config.toml", sha256: sha256(Buffer.from(configOutput)), tools: ["codex"] },
    { id: "hooks", kind: "codex-hooks", output: "contributions/hooks.json", sha256: sha256(Buffer.from(hooksOutput)), tools: ["codex"] },
  ];
  const definition = writeExtension(repository, { artifacts, script: outputScript(outputs) });
  const plan = resolveExtensionPlans(discoverExtensions({ extensionsRoot: repository }), [definition.id], { tools: ["codex"], state: emptyExtensionState() })[0];
  const root = temporaryRoot();
  fs.mkdirSync(path.join(root, ".codex"), { recursive: true });
  fs.writeFileSync(path.join(root, ".codex", "config.toml"), "model = \"gpt-5\"\n");
  const coreHooks = fs.readFileSync(path.resolve(__dirname, "..", "..", "artifacts", "templates", "codex", "hooks.json"));
  fs.writeFileSync(path.join(root, ".codex", "hooks.json"), coreHooks);

  assert.equal(executeExtension(root, plan, context(plan)).status, "installed");
  const config = fs.readFileSync(path.join(root, ".codex", "config.toml"), "utf8");
  assert.match(config, /model = "gpt-5"/);
  assert.match(config, /BEGIN code-workspace-extension:example-extension:config/);
  const installedHooks = JSON.parse(fs.readFileSync(path.join(root, ".codex", "hooks.json"), "utf8"));
  assert(installedHooks.hooks.UserPromptSubmit);
  assert(installedHooks.hooks.SessionStart);
  const managed = installManagedFiles(root, loadInitManifest(), ["codex"], { capabilities: ["monitor"], extensionState: loadExtensionState(root) });
  assert.equal(managed.find((entry) => entry.target === ".codex/hooks.json").action, "skip");

  fs.rmSync(repository, { recursive: true, force: true });
  const uninstallPlan = planExtensionUninstall(root, definition.id);
  const removed = applyExtensionUninstall(uninstallPlan);
  assert.equal(removed.status, "uninstalled");
  const remainingConfig = fs.readFileSync(path.join(root, ".codex", "config.toml"), "utf8");
  assert.match(remainingConfig, /model = "gpt-5"/);
  assert.doesNotMatch(remainingConfig, /code-workspace-extension/);
  const remainingHooks = JSON.parse(fs.readFileSync(path.join(root, ".codex", "hooks.json"), "utf8"));
  assert(remainingHooks.hooks.UserPromptSubmit);
  assert.equal(remainingHooks.hooks.SessionStart, undefined);
  assert.equal(loadExtensionState(root).extensions[definition.id], undefined);
});

test("uninstall rejects modified shared contributions and rolls back failures", () => {
  const repository = temporaryRoot();
  const configOutput = "[mcp_servers.example]\ncommand = \"example\"\n";
  const artifacts = [{ id: "config", kind: "codex-config-block", output: "config.toml", sha256: sha256(Buffer.from(configOutput)), tools: ["codex"] }];
  const definition = writeExtension(repository, { artifacts, script: outputScript({ "config.toml": configOutput }) });
  const plan = resolveExtensionPlans(discoverExtensions({ extensionsRoot: repository }), [definition.id], { tools: ["codex"], state: emptyExtensionState() })[0];
  const root = temporaryRoot();
  assert.equal(executeExtension(root, plan, context(plan)).status, "installed");
  const configFile = path.join(root, ".codex", "config.toml");
  fs.writeFileSync(configFile, fs.readFileSync(configFile, "utf8").replace('command = "example"', 'command = "changed"'));
  assert.throws(() => planExtensionUninstall(root, definition.id), (error) => error.code === "EXTENSION_CONFIG_BLOCK_MODIFIED");
  assert(loadExtensionState(root).extensions[definition.id].installed);

  fs.writeFileSync(configFile, fs.readFileSync(configFile, "utf8").replace('command = "changed"', 'command = "example"'));
  const uninstallPlan = planExtensionUninstall(root, definition.id);
  assert.throws(() => applyExtensionUninstall(uninstallPlan, {
    injectFailure(stage) {
      if (stage === "after-uninstall-state") throw new Error("injected uninstall failure");
    },
  }), /injected uninstall failure/);
  assert.match(fs.readFileSync(configFile, "utf8"), /code-workspace-extension/);
  assert(loadExtensionState(root).extensions[definition.id].installed);
});

test("uninstall removes an extension-only Hook target", () => {
  const repository = temporaryRoot();
  const hooksOutput = JSON.stringify({
    schemaVersion: 1,
    hooks: { Stop: [{ hooks: [{ type: "command", command: "example stop" }] }] },
  }, null, 2) + "\n";
  const artifacts = [{ id: "hooks", kind: "codex-hooks", output: "hooks.json", sha256: sha256(Buffer.from(hooksOutput)), tools: ["codex"] }];
  const definition = writeExtension(repository, { artifacts, script: outputScript({ "hooks.json": hooksOutput }) });
  const plan = resolveExtensionPlans(discoverExtensions({ extensionsRoot: repository }), [definition.id], { tools: ["codex"], state: emptyExtensionState() })[0];
  const root = temporaryRoot();
  assert.equal(executeExtension(root, plan, context(plan)).status, "installed");
  const hooksFile = path.join(root, ".codex", "hooks.json");
  assert(fs.existsSync(hooksFile));
  applyExtensionUninstall(planExtensionUninstall(root, definition.id));
  assert.equal(fs.existsSync(hooksFile), false);
});

test("ext-manifest rejects core claims and duplicate ownership from persisted state", () => {
  const root = temporaryRoot();
  const artifact = { id: "artifact", target: ".example/shared.txt", installedSha256: "a".repeat(64) };
  const state = emptyExtensionState();
  state.extensions.alpha = { installed: { version: "1.0.0", manifestSha256: "b".repeat(64), artifacts: [artifact] }, lastAttempt: { version: "1.0.0", status: "installed" } };
  state.extensions.beta = { installed: { version: "1.0.0", manifestSha256: "c".repeat(64), artifacts: [artifact] }, lastAttempt: { version: "1.0.0", status: "installed" } };
  saveExtensionState(root, state);
  assert.throws(() => loadExtensionState(root), (error) => error.code === "EXTENSION_STATE_INVALID");
  state.extensions.beta.installed.artifacts[0] = { ...artifact, target: "AGENTS.md" };
  saveExtensionState(root, state);
  assert.throws(() => loadExtensionState(root), (error) => error.code === "EXTENSION_STATE_INVALID");
});

test("init parser accepts extension option ordering and CLI rejects version syntax before writing", () => {
  assert.deepEqual(parse(argv("init", "--extensions", "openspec-workspace", ".", "--yes")).options.extensions, "openspec-workspace");
  assert.deepEqual(parse(argv("init", ".", "--yes", "--extensions=none")).options.extensions, "none");
  const root = temporaryRoot();
  const result = runCli(root, ["init", ".", "--extensions", "openspec-workspace@1.0.0", "--yes", "--json"]);
  assert.equal(result.status, 1);
  assert.equal(JSON.parse(result.stdout).diagnostics[0].code, "EXTENSION_VERSION_SELECTION_UNSUPPORTED");
  assert.equal(fs.existsSync(path.join(root, ".code-workspace")), false);
});

test("interactive init offers extension names and confirms frozen versions and manifest hashes", async () => {
  const root = temporaryRoot();
  const catalog = discoverExtensions();
  let offered;
  let readyLines;
  const ui = {
    intro() {},
    note(title, lines) {
      if (title === "Ready to initialize") readyLines = lines;
    },
    text: async () => "interactive",
    select: async (_label, choices) => choices[0].value,
    multiselect: async (label, choices, initialValues) => {
      offered = { label, choices, initialValues };
      return ["openspec-workspace"];
    },
    confirm: async () => true,
    close() {},
  };
  const plan = await collectInitPlan(root, loadInitManifest(), {
    ui,
    tools: ["codex"],
    extensionCatalog: catalog,
    extensionState: emptyExtensionState(),
  });
  assert.equal(offered.label, "Extensions (experimental, select any)");
  assert.deepEqual(offered.choices.map((entry) => entry.value), ["openspec-workspace"]);
  assert.match(offered.choices[0].label, /latest compatible: 1\.0\.0/);
  assert.equal(plan.extensions[0].version, "1.0.0");
  assert.match(readyLines.find((line) => line.startsWith("Extensions")), /[a-f0-9]{64}/);
});

test("interactive extension install lists all valid built-ins and disables incompatible versions", async () => {
  const repository = temporaryRoot();
  writeExtension(repository, { id: "alpha", name: "Alpha", codeWorkspace: ">=1.0.0 <2.0.0" });
  writeExtension(repository, { id: "beta", name: "Beta", codeWorkspace: ">=2.0.0 <3.0.0" });
  const catalog = discoverExtensions({ extensionsRoot: repository, codeWorkspaceVersion: "1.5.0" });
  let intro;
  let offered;
  let closed;
  const selected = await collectExtensionInstallSelection(catalog, {
    extensions: { alpha: { installed: { version: "1.0.0" } } },
  }, { ui: {
    intro: (message) => { intro = message; },
    multiselect: async (label, choices, initialValues) => {
      offered = { label, choices, initialValues };
      return ["alpha"];
    },
    close: (message) => { closed = message; },
  } });
  assert.equal(intro, "Code Workspace extensions");
  assert.equal(offered.label, "Extensions (select any)");
  assert.deepEqual(offered.initialValues, []);
  assert.deepEqual(offered.choices.map((entry) => entry.value), ["alpha", "beta"]);
  assert.match(offered.choices[0].label, /installed/);
  assert.equal(offered.choices[1].disabled, true);
  assert.deepEqual(selected, ["alpha"]);
  assert.equal(closed, "Extension selection ready.");
});

test("interactive extension install treats ESC and empty selection as successful no-op exits", async () => {
  const root = temporaryRoot();
  const cancelled = await executeExtensionInstall({
    root,
    args: [],
    options: {},
    dependencies: {
      interactive: true,
      collectExtensionInstallSelection: async () => {
        throw Object.assign(new Error("cancelled"), { code: "EXTENSION_INSTALL_CANCELLED" });
      },
    },
  });
  assert.equal(cancelled.ok, true);
  assert.equal(cancelled.data.action, "cancel");
  assert.equal(fs.existsSync(extensionStatePath(root)), false);

  const skipped = await executeExtensionInstall({
    root,
    args: [],
    options: {},
    dependencies: { interactive: true, collectExtensionInstallSelection: async () => [] },
  });
  assert.equal(skipped.ok, true);
  assert.equal(skipped.data.action, "skip");
  assert.equal(fs.existsSync(extensionStatePath(root)), false);
});

test("extension install requires explicit names non-interactively and confirmation before writing", () => {
  const root = temporaryRoot();
  assert.equal(runCli(root, ["init", ".", "--tools", "codex", "--extensions", "none", "--yes", "--json"]).status, 0);
  const noNames = runCli(root, ["extension", "install", "--yes", "--json"]);
  assert.equal(noNames.status, 1);
  assert.equal(JSON.parse(noNames.stdout).diagnostics[0].code, "EXTENSION_SELECTION_REQUIRED");

  const versioned = runCli(root, ["extension", "install", "openspec-workspace@1.0.0", "--yes", "--json"]);
  assert.equal(versioned.status, 1);
  assert.equal(JSON.parse(versioned.stdout).diagnostics[0].code, "EXTENSION_VERSION_SELECTION_UNSUPPORTED");

  const target = path.join(root, ".codex", "skills", "code-workspace-openspec-propose", "SKILL.md");
  const unconfirmed = runCli(root, ["extension", "install", "openspec-workspace", "--json"]);
  assert.equal(unconfirmed.status, 1);
  assert.equal(JSON.parse(unconfirmed.stdout).diagnostics[0].code, "CLI_CONFIRMATION_REQUIRED");
  assert.equal(fs.existsSync(target), false);

  const textInstalled = runCli(root, ["extension", "install", "openspec-workspace", "--yes"]);
  assert.equal(textInstalled.status, 0, textInstalled.stderr);
  assert.match(textInstalled.stdout, /Installed openspec-workspace@1\.0\.0\./);
});

test("CLI reinstalls an uninstalled extension and repeated install is idempotent without rewriting core assets", () => {
  const root = temporaryRoot();
  assert.equal(runCli(root, ["init", ".", "--tools", "codex", "--extensions", "none", "--yes", "--json"]).status, 0);
  const coreFile = path.join(root, "AGENTS.md");
  const coreBefore = fs.readFileSync(coreFile, "utf8");
  const target = path.join(root, ".codex", "skills", "code-workspace-openspec-propose", "SKILL.md");

  const installed = runCli(root, ["extension", "install", "openspec-workspace", "--yes", "--json"]);
  assert.equal(installed.status, 0, installed.stderr);
  assert.equal(JSON.parse(installed.stdout).data.results[0].status, "installed");
  assert(fs.existsSync(target));
  assert.equal(fs.readFileSync(coreFile, "utf8"), coreBefore);

  assert.equal(runCli(root, ["extension", "uninstall", "openspec-workspace", "--yes", "--json"]).status, 0);
  assert.equal(fs.existsSync(target), false);
  const reinstalled = runCli(root, ["extension", "install", "openspec-workspace", "--yes", "--json"]);
  assert.equal(reinstalled.status, 0, reinstalled.stderr);
  assert.equal(JSON.parse(reinstalled.stdout).data.results[0].status, "installed");
  const repeated = runCli(root, ["extension", "install", "openspec-workspace", "--yes", "--json"]);
  assert.equal(repeated.status, 0, repeated.stderr);
  assert.deepEqual(JSON.parse(repeated.stdout).data.summary, { total: 1, succeeded: 0, skipped: 1, failed: 0 });
});

test("standalone extension install preserves ordered best-effort results and fails when one extension fails", async () => {
  const repository = temporaryRoot();
  writeExtension(repository, { id: "broken", sha256: "0".repeat(64) });
  const working = writeExtension(repository, { id: "working" });
  const root = temporaryRoot();
  assert.equal(runCli(root, ["init", ".", "--tools", "codex", "--extensions", "none", "--yes", "--json"]).status, 0);
  const result = await executeExtensionInstall({
    root,
    args: ["broken", "working"],
    options: { yes: true, json: true },
    config: loadConfigProjection(root, ["identity", "language"]),
    dependencies: { extensionsRoot: repository },
  });
  assert.equal(result.ok, false);
  assert.deepEqual(result.data.requested, ["broken", "working"]);
  assert.deepEqual(result.data.results.map((entry) => entry.status), ["failed", "installed"]);
  assert.deepEqual(result.data.summary, { total: 2, succeeded: 1, skipped: 0, failed: 1 });
  assert.equal(result.diagnostics[0].code, "EXTENSION_ARTIFACT_HASH_MISMATCH");
  assert.equal(fs.existsSync(path.join(root, working.target)), true);
});

test("extension install loads only identity and language configuration domains", () => {
  const root = temporaryRoot();
  assert.equal(runCli(root, ["init", ".", "--tools", "codex", "--extensions", "none", "--yes", "--json"]).status, 0);
  const configFile = path.join(root, ".code-workspace", "config.yaml");
  const config = yaml.load(fs.readFileSync(configFile, "utf8"));
  config.monitor = { url: "not-a-url" };
  config.projects = "invalid";
  fs.writeFileSync(configFile, yaml.dump(config));
  const installed = runCli(root, ["extension", "install", "openspec-workspace", "--yes", "--json"]);
  assert.equal(installed.status, 0, installed.stderr);
  assert.equal(JSON.parse(installed.stdout).data.results[0].status, "installed");
});

test("CLI installs an explicit extension, defaults to it on re-init, and none does not uninstall", () => {
  const root = temporaryRoot();
  const first = runCli(root, ["init", ".", "--tools", "codex", "--extensions", "openspec-workspace", "--yes", "--json"]);
  assert.equal(first.status, 0, first.stderr);
  const firstEnvelope = JSON.parse(first.stdout);
  assert.equal(firstEnvelope.data.extensions.results[0].status, "installed");
  const target = path.join(root, ".codex", "skills", "code-workspace-openspec-propose", "SKILL.md");
  assert(fs.existsSync(target));

  const repeated = runCli(root, ["init", ".", "--tools", "codex", "--yes", "--json"]);
  assert.equal(repeated.status, 0, repeated.stderr);
  assert.deepEqual(JSON.parse(repeated.stdout).data.extensions.summary, { installed: 0, skipped: 1, failed: 0 });

  const none = runCli(root, ["init", ".", "--tools", "codex", "--extensions", "none", "--yes", "--json"]);
  assert.equal(none.status, 0, none.stderr);
  assert.deepEqual(JSON.parse(none.stdout).data.extensions.requested, []);
  assert(fs.existsSync(target));
  assert.equal(loadExtensionState(root).extensions["openspec-workspace"].installed.version, "1.0.0");
});

test("explicit none isolates core re-init from an unreadable extension state", () => {
  const root = temporaryRoot();
  assert.equal(runCli(root, ["init", ".", "--tools", "none", "--extensions", "none", "--yes", "--json"]).status, 0);
  fs.writeFileSync(extensionStatePath(root), "not json\n");
  const repeated = runCli(root, ["init", ".", "--tools", "none", "--extensions", "none", "--yes", "--json"]);
  assert.equal(repeated.status, 0, repeated.stderr);
  assert.deepEqual(JSON.parse(repeated.stdout).data.extensions.requested, []);
  assert.equal(fs.readFileSync(extensionStatePath(root), "utf8"), "not json\n");
});

test("ordinary core re-init survives an unreadable extension state with a warning", () => {
  const root = temporaryRoot();
  assert.equal(runCli(root, ["init", ".", "--tools", "none", "--extensions", "none", "--yes", "--json"]).status, 0);
  fs.writeFileSync(extensionStatePath(root), "not json\n");
  const repeated = runCli(root, ["init", ".", "--tools", "none", "--yes", "--json"]);
  assert.equal(repeated.status, 0, repeated.stderr);
  const envelope = JSON.parse(repeated.stdout);
  assert.equal(envelope.ok, true);
  assert(envelope.diagnostics.some((entry) => entry.code === "EXTENSION_STATE_PARSE_FAILED"));
});

test("CLI uninstalls a bundled extension transactionally and is idempotent", () => {
  const root = temporaryRoot();
  const installed = runCli(root, ["init", ".", "--tools", "codex", "--extensions", "openspec-workspace", "--yes", "--json"]);
  assert.equal(installed.status, 0, installed.stderr);
  const target = path.join(root, ".codex", "skills", "code-workspace-openspec-propose", "SKILL.md");
  assert(fs.existsSync(target));
  const removed = runCli(root, ["extension", "uninstall", "openspec-workspace", "--yes", "--json"]);
  assert.equal(removed.status, 0, removed.stderr);
  assert.equal(JSON.parse(removed.stdout).data.status, "uninstalled");
  assert.equal(fs.existsSync(target), false);
  assert.equal(loadExtensionState(root).extensions["openspec-workspace"], undefined);
  const repeated = runCli(root, ["extension", "uninstall", "openspec-workspace", "--yes", "--json"]);
  assert.equal(repeated.status, 0, repeated.stderr);
  assert.equal(JSON.parse(repeated.stdout).data.status, "skipped");
});

test("CLI reports an extension failure as a warning without failing successful core init", () => {
  const root = temporaryRoot();
  const first = runCli(root, ["init", ".", "--tools", "codex", "--extensions", "openspec-workspace", "--yes", "--json"]);
  assert.equal(first.status, 0, first.stderr);
  const target = path.join(root, ".codex", "skills", "code-workspace-openspec-propose", "SKILL.md");
  fs.appendFileSync(target, "\nlocal edit\n");
  const repeated = runCli(root, ["init", ".", "--tools", "codex", "--yes", "--json"]);
  assert.equal(repeated.status, 0, repeated.stderr);
  const envelope = JSON.parse(repeated.stdout);
  assert.equal(envelope.ok, true);
  assert.deepEqual(envelope.data.extensions.summary, { installed: 0, skipped: 0, failed: 1 });
  assert.equal(envelope.data.extensions.results[0].code, "EXTENSION_ARTIFACT_MODIFIED");
  assert.equal(envelope.diagnostics[0].code, "EXTENSION_INIT_FAILED");
  assert.equal(envelope.diagnostics[0].severity, "warning");
  assert.equal(envelope.diagnostics[0].causeCode, "EXTENSION_ARTIFACT_MODIFIED");
  assert.match(fs.readFileSync(target, "utf8"), /local edit/);
});

test("a core init failure never starts the requested extension", () => {
  const root = temporaryRoot();
  fs.writeFileSync(path.join(root, "AGENTS.md"), "user-owned instructions\n");
  const result = runCli(root, ["init", ".", "--tools", "codex", "--extensions", "openspec-workspace", "--yes", "--json"]);
  assert.equal(result.status, 1);
  assert.equal(fs.existsSync(path.join(root, ".codex", "skills", "code-workspace-openspec-propose", "SKILL.md")), false);
  assert.equal(fs.existsSync(extensionStatePath(root)), false);
});
