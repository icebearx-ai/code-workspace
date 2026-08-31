const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");

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
  saveExtensionState,
  supportsExtensionSpec,
  applicableHooks,
  validateManifest,
  verifyExtensionOutput,
} = require("../core/extensions");
const { validateHookDeclarations } = require("../core/hooks");
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
  const rawOutputs = options.outputs || options.artifacts || [{
    id: "example-artifact",
    kind: "file",
    ownership: "exclusive",
    target,
    source: target,
    ...(options.tools ? { tools: options.tools } : {}),
  }];
  const resultOutputs = rawOutputs.map((output) => ({ id: output.id, source: output.source || output.output || output.target }));
  const outputs = rawOutputs.map((output) => {
    const { source, output: legacyOutput, sha256: legacySha256, ...manifestOutput } = output;
    if (manifestOutput.kind === "file" && manifestOutput.ownership === undefined) manifestOutput.ownership = "exclusive";
    return manifestOutput;
  });
  const body = options.script || defaultScript(resultOutputs[0].source, content);
  const resultFooter = options.rawScript ? "" : [
    'const extensionResultIndex = process.argv.indexOf("--result");',
    'const extensionResultFile = process.argv[extensionResultIndex + 1];',
    `require("node:fs").writeFileSync(extensionResultFile, JSON.stringify({ schemaVersion: 1, extensionSpecVersion: ${JSON.stringify(options.extensionSpecVersion || 1)}, extension: { id: ${JSON.stringify(id)}, version: ${JSON.stringify(version)} }, outputs: ${JSON.stringify(resultOutputs)} }, null, 2) + "\\n");`,
    "",
  ].join("\n");
  const script = `${body}${body.endsWith("\n") ? "" : "\n"}${resultFooter}`;
  fs.writeFileSync(path.join(versionRoot, "init.js"), script);
  fs.writeFileSync(path.join(versionRoot, "manifest.json"), `${JSON.stringify({
    schemaVersion: 3,
    extensionSpecVersion: options.extensionSpecVersion || 1,
    experimental: true,
    id,
    name: options.name || id,
    version,
    entry: "init.js",
    entrySha256: sha256(Buffer.from(script)),
    timeoutMs: options.timeoutMs || 1000,
    ...(options.networkHosts ? { capabilities: { networkHosts: options.networkHosts } } : {}),
    ...(options.hooks ? { hooks: options.hooks } : {}),
    outputs,
  }, null, 2)}\n`);
  return { id, version, target, content, versionRoot, outputs, resultOutputs };
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

function runCli(root, args) {
  return spawnSync(process.execPath, [cli, ...args], { cwd: root, encoding: "utf8" });
}

test("strict SemVer comparison is used only for extension version ordering", () => {
  assert.equal(compareSemver("1.0.0-beta.3", "1.0.0-beta.11"), -1);
  assert.equal(compareSemver("1.0.0", "1.0.0-rc.1"), 1);
  assert.equal(compareSemver("1.0.0+build.1", "1.0.0+build.2"), 0);
  assert.equal(supportsExtensionSpec(1), true);
  assert.equal(supportsExtensionSpec(2), false);
  assert.throws(() => parseSemver("01.0.0"), (error) => error.code === "EXTENSION_SEMVER_INVALID");
});

test("discovery selects the highest version using a Host-supported Extension Spec and freezes hashes", () => {
  const repository = temporaryRoot();
  writeExtension(repository, { version: "1.0.0", extensionSpecVersion: 1 });
  writeExtension(repository, { version: "1.2.0", extensionSpecVersion: 1 });
  writeExtension(repository, { version: "2.0.0", extensionSpecVersion: 2 });
  const catalog = discoverExtensions({ extensionsRoot: repository });
  assert.equal(catalog[0].latestSupported.version, "1.2.0");
  assert.equal(catalog[0].latestSupported.extensionSpecVersion, 1);
  assert.equal(catalog[0].latestSupported.manifestSha256, sha256(fs.readFileSync(path.join(repository, "example-extension", "1.2.0", "manifest.json"))));
  assert.match(catalog[0].latestSupported.packageSha256, /^[a-f0-9]{64}$/);
  assert(Object.isFrozen(catalog[0].latestSupported.manifest));
  assert.equal(catalog[0].versions[0].version, "2.0.0");
  assert.equal(catalog[0].versions[0].supported, false);

  const unsupportedRepository = temporaryRoot();
  writeExtension(unsupportedRepository, { version: "2.0.0", extensionSpecVersion: 2 });
  const unsupportedCatalog = discoverExtensions({ extensionsRoot: unsupportedRepository });
  assert.throws(
    () => resolveExtensionPlans(unsupportedCatalog, ["example-extension"], { tools: ["codex"], state: emptyExtensionState() }),
    (error) => error.code === "EXTENSION_SPEC_UNSUPPORTED" && error.details.supportedExtensionSpecVersions[0] === 1 && error.details.availableExtensionSpecVersions[0] === 2
  );
});

test("Extension Spec v1 manifest validation rejects unsafe, duplicate, core-owned, and invalid output declarations", () => {
  const base = {
    schemaVersion: 3,
    extensionSpecVersion: 1,
    experimental: true,
    id: "example-extension",
    name: "Example",
    version: "1.0.0",
    entry: "init.js",
    entrySha256: "b".repeat(64),
    timeoutMs: 1000,
    outputs: [{ id: "artifact-one", kind: "file", ownership: "exclusive", target: ".example/one.txt" }],
  };
  for (const target of ["../escape", "/absolute", "dir\\file", "dir//file", "dir/./file"]) {
    assert.throws(() => validateManifest({ ...base, outputs: [{ ...base.outputs[0], target }] }, { protectedTargets: new Set() }), (error) => error.code === "EXTENSION_ARTIFACT_TARGET_INVALID", target);
  }
  assert.throws(() => validateManifest({ ...base, outputs: [base.outputs[0], { ...base.outputs[0], id: "artifact-two" }] }, { protectedTargets: new Set() }), (error) => error.code === "EXTENSION_TARGET_CONFLICT");
  assert.throws(() => validateManifest({ ...base, outputs: [{ ...base.outputs[0], target: "AGENTS.md" }] }, { protectedTargets: new Set(["AGENTS.md"]) }), (error) => error.code === "EXTENSION_CORE_TARGET_FORBIDDEN");
  assert.throws(() => validateManifest({ ...base, outputs: [{ ...base.outputs[0], tools: ["unknown"] }] }, { protectedTargets: new Set() }), (error) => error.code === "EXTENSION_MANIFEST_INVALID");
  assert.throws(() => validateManifest({ ...base, outputs: [{ ...base.outputs[0], kind: "remote-archive" }] }, { protectedTargets: new Set() }), (error) => error.code === "EXTENSION_MANIFEST_INVALID");
  assert.throws(() => validateManifest({ ...base, outputs: [{ ...base.outputs[0], kind: "directory", target: ".code-workspace" }] }), (error) => error.code === "EXTENSION_CORE_TARGET_FORBIDDEN");
  assert.throws(() => validateManifest({
    ...base,
    outputs: [
      { id: "runtime", kind: "directory", ownership: "exclusive", target: ".example/runtime" },
      { id: "entry", kind: "file", ownership: "exclusive", target: ".example/runtime/index.js" },
    ],
  }, { protectedTargets: new Set() }), (error) => error.code === "EXTENSION_TARGET_CONFLICT");
  assert.throws(() => validateManifest({
    ...base,
    outputs: [
      { id: "servers", kind: "json-member", ownership: "shared", target: ".mcp.json", selector: "/mcpServers" },
      { id: "server", kind: "json-member", ownership: "shared", target: ".mcp.json", selector: "/mcpServers/example" },
    ],
  }, { protectedTargets: new Set() }), (error) => error.code === "EXTENSION_TARGET_CONFLICT");
  assert.doesNotThrow(() => validateManifest({
    ...base,
    outputs: [{ id: "config", kind: "text-block", ownership: "shared", target: ".codex/config.toml", format: "toml" }],
  }));
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

  const nestedRepository = temporaryRoot();
  writeExtension(nestedRepository, { id: "parent-owner", outputs: [{ id: "runtime", kind: "directory", ownership: "exclusive", target: ".shared/runtime", source: "runtime" }], script: outputScript({ "runtime/index.js": "parent\n" }) });
  writeExtension(nestedRepository, { id: "child-owner", target: ".shared/runtime/index.js" });
  assert.throws(() => resolveExtensionPlans(discoverExtensions({ extensionsRoot: nestedRepository }), ["parent-owner", "child-owner"], { tools: ["codex"], state: emptyExtensionState() }), (error) => error.code === "EXTENSION_TARGET_CONFLICT");

  const jsonRepository = temporaryRoot();
  writeExtension(jsonRepository, { id: "parent-json", outputs: [{ id: "servers", kind: "json-member", ownership: "shared", target: ".mcp.json", source: "server.json", selector: "/mcpServers" }], script: outputScript({ "server.json": "{}\n" }) });
  writeExtension(jsonRepository, { id: "child-json", outputs: [{ id: "server", kind: "json-member", ownership: "shared", target: ".mcp.json", source: "server.json", selector: "/mcpServers/example" }], script: outputScript({ "server.json": "{}\n" }) });
  assert.throws(() => resolveExtensionPlans(discoverExtensions({ extensionsRoot: jsonRepository }), ["parent-json", "child-json"], { tools: ["codex"], state: emptyExtensionState() }), (error) => error.code === "EXTENSION_TARGET_CONFLICT");
});

test("workspace target validation refuses symbolic-link traversal", (t) => {
  const root = temporaryRoot();
  const outside = temporaryRoot();
  fs.symlinkSync(outside, path.join(root, "linked"), "dir");
  t.after(() => fs.unlinkSync(path.join(root, "linked")));
  assert.throws(() => assertSafeWorkspaceTarget(root, "linked/file.txt"), (error) => error.code === "EXTENSION_ARTIFACT_SYMLINK");
});

test("context and result validation reject identity changes, unknown fields, duplicates, overlaps, and escapes", () => {
  const repository = temporaryRoot();
  const definition = writeExtension(repository);
  const extensionPlan = resolveExtensionPlans(discoverExtensions({ extensionsRoot: repository }), [definition.id], { tools: ["codex"], state: emptyExtensionState() })[0];
  const invalidContext = { ...context(extensionPlan), workspace: { ...context(extensionPlan).workspace, root: "/secret" } };
  assert.equal(executeExtension(temporaryRoot(), extensionPlan, invalidContext).code, "EXTENSION_CONTEXT_INVALID");
  assert.equal(executeExtension(temporaryRoot(), extensionPlan, { ...context(extensionPlan), extensionSpecVersion: 2 }).code, "EXTENSION_CONTEXT_INVALID");

  const root = temporaryRoot();
  fs.mkdirSync(path.join(root, "one"), { recursive: true });
  fs.writeFileSync(path.join(root, "one", "file.txt"), "one\n");
  fs.writeFileSync(path.join(root, "two.txt"), "two\n");
  const plan = {
    id: "example-extension",
    version: "1.0.0",
    extensionSpecVersion: 1,
    artifacts: [
      { id: "one", kind: "file", ownership: "exclusive", target: ".example/one.txt" },
      { id: "two", kind: "file", ownership: "exclusive", target: ".example/two.txt" },
    ],
  };
  const result = (outputs, extension = { id: plan.id, version: plan.version }) => ({ schemaVersion: 1, extensionSpecVersion: plan.extensionSpecVersion, extension, outputs });
  assert.throws(() => verifyExtensionOutput(root, result([{ id: "one", source: "one/file.txt" }, { id: "unknown", source: "two.txt" }]), plan), (error) => error.code === "EXTENSION_ARTIFACT_UNDECLARED");
  assert.throws(() => verifyExtensionOutput(root, result([{ id: "one", source: "one/file.txt" }, { id: "one", source: "two.txt" }]), plan), (error) => error.code === "EXTENSION_ARTIFACT_DUPLICATE");
  assert.throws(() => verifyExtensionOutput(root, result([{ id: "one", source: "one" }, { id: "two", source: "one/file.txt" }]), plan), (error) => error.code === "EXTENSION_ARTIFACT_DUPLICATE");
  assert.throws(() => verifyExtensionOutput(root, result([{ id: "one", source: "one/file.txt" }, { id: "two", source: "../escape" }]), plan), (error) => error.code === "EXTENSION_ARTIFACT_TARGET_INVALID");
  assert.throws(() => verifyExtensionOutput(root, result([{ id: "one", source: "one/file.txt" }, { id: "two", source: "two.txt" }], { id: "other-extension", version: "1.0.0" }), plan), (error) => error.code === "EXTENSION_RESULT_IDENTITY_MISMATCH");
  assert.throws(() => verifyExtensionOutput(root, { ...result([{ id: "one", source: "one/file.txt" }, { id: "two", source: "two.txt" }]), extensionSpecVersion: 2 }, plan), (error) => error.code === "EXTENSION_RESULT_INVALID");
});

test("result and staging verification reject missing, extra, and symlinked outputs while Host computes the digest", (t) => {
  const root = temporaryRoot();
  const artifact = { id: "artifact", kind: "file", ownership: "exclusive", target: "safe/file.txt" };
  const plan = { id: "example-extension", version: "1.0.0", extensionSpecVersion: 1, artifacts: [artifact] };
  const result = { schemaVersion: 1, extensionSpecVersion: plan.extensionSpecVersion, extension: { id: plan.id, version: plan.version }, outputs: [{ id: artifact.id, source: "safe/file.txt" }] };
  assert.throws(() => verifyExtensionOutput(root, result, plan), (error) => error.code === "EXTENSION_ARTIFACT_MISSING");
  fs.mkdirSync(path.join(root, "safe"));
  fs.writeFileSync(path.join(root, "safe", "extra.txt"), "extra\n");
  assert.throws(() => verifyExtensionOutput(root, result, plan), (error) => error.code === "EXTENSION_ARTIFACT_UNDECLARED");
  fs.unlinkSync(path.join(root, "safe", "extra.txt"));
  fs.writeFileSync(path.join(root, "safe", "file.txt"), "actual\n");
  assert.equal(verifyExtensionOutput(root, result, plan)[0].installedSha256, sha256(Buffer.from("actual\n")));
  fs.unlinkSync(path.join(root, "safe", "file.txt"));
  const outside = path.join(temporaryRoot(), "outside.txt");
  fs.writeFileSync(outside, "expected\n");
  fs.symlinkSync(outside, path.join(root, "safe", "file.txt"));
  t.after(() => fs.unlinkSync(path.join(root, "safe", "file.txt")));
  assert.throws(() => verifyExtensionOutput(root, result, plan), (error) => error.code === "EXTENSION_OUTPUT_SYMLINK");
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
  assert.equal(state.installed.protocolVersion, 3);
  assert.equal(state.installed.extensionSpecVersion, 1);
  assert.equal(state.installed.version, "1.0.0");
  assert.equal(state.lastAttempt.extensionSpecVersion, 1);
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

test("a directory target that appears while an extension is running is preserved", () => {
  const repository = temporaryRoot();
  const outputs = [{ id: "runtime", kind: "directory", ownership: "exclusive", target: ".example/runtime", source: "runtime" }];
  const definition = writeExtension(repository, { outputs, script: outputScript({ "runtime/index.js": "extension\n" }) });
  const plan = resolveExtensionPlans(discoverExtensions({ extensionsRoot: repository }), [definition.id], { tools: ["codex"], state: emptyExtensionState() })[0];
  const root = temporaryRoot();
  const result = executeExtension(root, plan, context(plan), {
    injectFailure(stage) {
      if (stage === "after-output-verify") {
        fs.mkdirSync(path.join(root, ".example", "runtime"), { recursive: true });
        fs.writeFileSync(path.join(root, ".example", "runtime", "user.txt"), "user\n");
      }
    },
  });
  assert.equal(result.code, "EXTENSION_TARGET_OCCUPIED");
  assert.equal(fs.readFileSync(path.join(root, ".example", "runtime", "user.txt"), "utf8"), "user\n");
  assert.equal(fs.existsSync(path.join(root, ".example", "runtime", "index.js")), false);
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
  assert.equal(persisted.extensions.crashing.lastAttempt.extensionSpecVersion, 1);
  assert.equal(persisted.extensions.working.lastAttempt.status, "installed");
  assert.equal(persisted.extensions.working.lastAttempt.extensionSpecVersion, 1);
});

test("a result missing an applicable output leaves real targets untouched and records the specific failure", () => {
  const repository = temporaryRoot();
  const script = [
    'const fs = require("node:fs");',
    'const result = process.argv[process.argv.indexOf("--result") + 1];',
    'fs.writeFileSync(result, JSON.stringify({ schemaVersion: 1, extensionSpecVersion: 1, extension: { id: "example-extension", version: "1.0.0" }, outputs: [] }));',
    '',
  ].join("\n");
  const definition = writeExtension(repository, { script, rawScript: true });
  const plan = resolveExtensionPlans(discoverExtensions({ extensionsRoot: repository }), [definition.id], { tools: ["codex"], state: emptyExtensionState() })[0];
  const root = temporaryRoot();
  const result = executeExtension(root, plan, context(plan));
  assert.equal(result.code, "EXTENSION_ARTIFACT_MISSING");
  assert.equal(fs.existsSync(path.join(root, definition.target)), false);
  assert.equal(loadExtensionState(root).extensions[definition.id].lastAttempt.code, "EXTENSION_ARTIFACT_MISSING");
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

test("Extension Spec v1 upgrade adds, replaces, and removes every generic output transactionally", () => {
  const repository = temporaryRoot();
  const outputsV1 = [
    { id: "old-file", kind: "file", ownership: "exclusive", target: ".example/old.txt", source: "old.txt" },
    { id: "runtime", kind: "directory", ownership: "exclusive", target: ".example/runtime", source: "runtime" },
    { id: "config", kind: "text-block", ownership: "shared", target: ".codex/config.toml", source: "config.toml", format: "toml" },
    { id: "server", kind: "json-member", ownership: "shared", target: ".mcp.json", source: "server.json", selector: "/mcpServers/example" },
  ];
  writeExtension(repository, {
    version: "1.0.0",
    outputs: outputsV1,
    script: outputScript({
      "old.txt": "old file\n",
      "runtime/index.js": "runtime one\n",
      "config.toml": '[mcp_servers.example]\ncommand = "one"\n',
      "server.json": '{"command":"one"}\n',
    }),
  });
  const planV1 = resolveExtensionPlans(discoverExtensions({ extensionsRoot: repository }), ["example-extension"], { tools: ["codex"], state: emptyExtensionState() })[0];
  const root = temporaryRoot();
  fs.mkdirSync(path.join(root, ".codex"), { recursive: true });
  fs.writeFileSync(path.join(root, ".codex", "config.toml"), 'model = "gpt-5"\n');
  fs.writeFileSync(path.join(root, ".mcp.json"), '{"custom":true}\n');
  assert.equal(executeExtension(root, planV1, context(planV1)).status, "installed");

  const outputsV2 = [
    { id: "new-file", kind: "file", ownership: "exclusive", target: ".example/new.txt", source: "new.txt" },
    { id: "runtime", kind: "directory", ownership: "exclusive", target: ".example/runtime", source: "runtime" },
    { id: "config", kind: "text-block", ownership: "shared", target: ".codex/config.toml", source: "config.toml", format: "toml" },
    { id: "server", kind: "json-member", ownership: "shared", target: ".mcp.json", source: "server.json", selector: "/mcpServers/example" },
  ];
  writeExtension(repository, {
    version: "1.1.0",
    outputs: outputsV2,
    script: outputScript({
      "new.txt": "new file\n",
      "runtime/index.js": "runtime two\n",
      "config.toml": '[mcp_servers.example]\ncommand = "two"\n',
      "server.json": '{"command":"two"}\n',
    }),
  });
  const planV2 = resolveExtensionPlans(discoverExtensions({ extensionsRoot: repository }), ["example-extension"], { tools: ["codex"], state: loadExtensionState(root) })[0];
  const failed = executeExtension(root, planV2, context(planV2), {
    injectFailure(stage) {
      if (stage === "after-state-save") throw new Error("injected v2 failure");
    },
  });
  assert.equal(failed.status, "failed");
  assert.equal(fs.readFileSync(path.join(root, ".example", "old.txt"), "utf8"), "old file\n");
  assert.equal(fs.readFileSync(path.join(root, ".example", "runtime", "index.js"), "utf8"), "runtime one\n");
  assert.match(fs.readFileSync(path.join(root, ".codex", "config.toml"), "utf8"), /command = "one"/);
  assert.equal(JSON.parse(fs.readFileSync(path.join(root, ".mcp.json"), "utf8")).mcpServers.example.command, "one");
  assert.equal(loadExtensionState(root).extensions[planV1.id].installed.version, "1.0.0");

  assert.equal(executeExtension(root, planV2, context(planV2)).status, "installed");
  assert.equal(fs.existsSync(path.join(root, ".example", "old.txt")), false);
  assert.equal(fs.readFileSync(path.join(root, ".example", "new.txt"), "utf8"), "new file\n");
  assert.equal(fs.readFileSync(path.join(root, ".example", "runtime", "index.js"), "utf8"), "runtime two\n");
  const config = fs.readFileSync(path.join(root, ".codex", "config.toml"), "utf8");
  assert.match(config, /model = "gpt-5"/);
  assert.match(config, /command = "two"/);
  assert.doesNotMatch(config, /command = "one"/);
  const mcp = JSON.parse(fs.readFileSync(path.join(root, ".mcp.json"), "utf8"));
  assert.equal(mcp.custom, true);
  assert.equal(mcp.mcpServers.example.command, "two");
  assert.deepEqual(loadExtensionState(root).extensions[planV2.id].installed.artifacts.map((artifact) => artifact.id), ["new-file", "runtime", "config", "server"]);

  applyExtensionUninstall(planExtensionUninstall(root, planV2.id));
  assert.equal(fs.existsSync(path.join(root, ".example", "new.txt")), false);
  assert.equal(fs.existsSync(path.join(root, ".example", "runtime")), false);
  assert.equal(fs.readFileSync(path.join(root, ".codex", "config.toml"), "utf8"), 'model = "gpt-5"\n\n');
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(root, ".mcp.json"), "utf8")), { custom: true });
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

test("stale extension helper files fail before executing the entry", () => {
  const repository = temporaryRoot();
  const definition = writeExtension(repository);
  fs.writeFileSync(path.join(definition.versionRoot, "helper.json"), "{}\n");
  const plan = resolveExtensionPlans(discoverExtensions({ extensionsRoot: repository }), [definition.id], { tools: ["codex"], state: emptyExtensionState() })[0];
  fs.writeFileSync(path.join(definition.versionRoot, "helper.json"), "{\"changed\":true}\n");
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

test("Host-managed text blocks and JSON members install and uninstall without removing user content", () => {
  const repository = temporaryRoot();
  const configOutput = "[mcp_servers.example]\ncommand = \"example\"\n";
  const serverOutput = JSON.stringify({ command: "node", args: ["server.js"] }, null, 2) + "\n";
  const staged = {
    "contributions/config.toml": configOutput,
    "contributions/server.json": serverOutput,
  };
  const outputs = [
    { id: "config", kind: "text-block", ownership: "shared", target: ".codex/config.toml", source: "contributions/config.toml", format: "toml", tools: ["codex"] },
    { id: "server", kind: "json-member", ownership: "shared", target: ".mcp.json", source: "contributions/server.json", selector: "/mcpServers/example", tools: ["codex"] },
  ];
  const definition = writeExtension(repository, { outputs, script: outputScript(staged) });
  const plan = resolveExtensionPlans(discoverExtensions({ extensionsRoot: repository }), [definition.id], { tools: ["codex"], state: emptyExtensionState() })[0];
  const root = temporaryRoot();
  fs.mkdirSync(path.join(root, ".codex"), { recursive: true });
  fs.writeFileSync(path.join(root, ".codex", "config.toml"), "model = \"gpt-5\"\n");
  fs.writeFileSync(path.join(root, ".mcp.json"), `${JSON.stringify({ project: "example", mcpServers: { other: { command: "other" } } }, null, 2)}\n`);

  assert.equal(executeExtension(root, plan, context(plan)).status, "installed");
  const config = fs.readFileSync(path.join(root, ".codex", "config.toml"), "utf8");
  assert.match(config, /model = "gpt-5"/);
  assert.match(config, /BEGIN code-workspace-extension:example-extension:config/);
  const installedMcp = JSON.parse(fs.readFileSync(path.join(root, ".mcp.json"), "utf8"));
  assert.equal(installedMcp.project, "example");
  assert.equal(installedMcp.mcpServers.other.command, "other");
  assert.equal(installedMcp.mcpServers.example.command, "node");

  fs.rmSync(repository, { recursive: true, force: true });
  const uninstallPlan = planExtensionUninstall(root, definition.id);
  const removed = applyExtensionUninstall(uninstallPlan);
  assert.equal(removed.status, "uninstalled");
  const remainingConfig = fs.readFileSync(path.join(root, ".codex", "config.toml"), "utf8");
  assert.match(remainingConfig, /model = "gpt-5"/);
  assert.doesNotMatch(remainingConfig, /code-workspace-extension/);
  const remainingMcp = JSON.parse(fs.readFileSync(path.join(root, ".mcp.json"), "utf8"));
  assert.equal(remainingMcp.project, "example");
  assert.equal(remainingMcp.mcpServers.other.command, "other");
  assert.equal(remainingMcp.mcpServers.example, undefined);
  assert.equal(loadExtensionState(root).extensions[definition.id], undefined);
});

test("uninstall rejects modified shared contributions and rolls back failures", () => {
  const repository = temporaryRoot();
  const configOutput = "[mcp_servers.example]\ncommand = \"example\"\n";
  const outputs = [{ id: "config", kind: "text-block", ownership: "shared", target: ".codex/config.toml", source: "config.toml", format: "toml", tools: ["codex"] }];
  const definition = writeExtension(repository, { outputs, script: outputScript({ "config.toml": configOutput }) });
  const plan = resolveExtensionPlans(discoverExtensions({ extensionsRoot: repository }), [definition.id], { tools: ["codex"], state: emptyExtensionState() })[0];
  const root = temporaryRoot();
  assert.equal(executeExtension(root, plan, context(plan)).status, "installed");
  const configFile = path.join(root, ".codex", "config.toml");
  fs.writeFileSync(configFile, fs.readFileSync(configFile, "utf8").replace('command = "example"', 'command = "changed"'));
  assert.throws(() => planExtensionUninstall(root, definition.id), (error) => error.code === "EXTENSION_TEXT_BLOCK_MODIFIED");
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

test("uninstall removes an extension-only JSON target", () => {
  const repository = temporaryRoot();
  const serverOutput = JSON.stringify({ command: "node" }, null, 2) + "\n";
  const outputs = [{ id: "server", kind: "json-member", ownership: "shared", target: ".mcp.json", source: "server.json", selector: "/mcpServers/example", tools: ["codex"] }];
  const definition = writeExtension(repository, { outputs, script: outputScript({ "server.json": serverOutput }) });
  const plan = resolveExtensionPlans(discoverExtensions({ extensionsRoot: repository }), [definition.id], { tools: ["codex"], state: emptyExtensionState() })[0];
  const root = temporaryRoot();
  assert.equal(executeExtension(root, plan, context(plan)).status, "installed");
  const targetFile = path.join(root, ".mcp.json");
  assert(fs.existsSync(targetFile));
  applyExtensionUninstall(planExtensionUninstall(root, definition.id));
  assert.equal(fs.existsSync(targetFile), false);
});

test("a second protocol extension installs through existing generic capabilities without Host changes", () => {
  const repository = temporaryRoot();
  writeExtension(repository, { id: "first-extension", target: ".example/first.txt", content: "first\n" });
  writeExtension(repository, {
    id: "second-extension",
    outputs: [
      { id: "runtime", kind: "directory", ownership: "exclusive", target: ".example/second", source: "runtime" },
      { id: "config", kind: "text-block", ownership: "shared", target: ".codex/config.toml", source: "config.toml", format: "toml" },
    ],
    script: outputScript({ "runtime/index.js": "second\n", "config.toml": '[second]\nenabled = true\n' }),
  });
  const plans = resolveExtensionPlans(discoverExtensions({ extensionsRoot: repository }), ["first-extension", "second-extension"], { tools: ["codex"], state: emptyExtensionState() });
  const root = temporaryRoot();
  const result = runExtensionBatch(root, plans, (plan) => context(plan));
  assert.deepEqual(result.results.map((entry) => entry.status), ["installed", "installed"]);
  assert.equal(fs.readFileSync(path.join(root, ".example", "first.txt"), "utf8"), "first\n");
  assert.equal(fs.readFileSync(path.join(root, ".example", "second", "index.js"), "utf8"), "second\n");
  assert.match(fs.readFileSync(path.join(root, ".codex", "config.toml"), "utf8"), /BEGIN code-workspace-extension:second-extension:config/);
});

test("abstract Hook declarations validate independently of native provider names", () => {
  const hooks = validateHookDeclarations([
    { id: "audit", event: "session.start", command: "code-workspace-hook-audit", tools: ["codex"], timeoutMs: 3 },
    { id: "write-audit", event: "write.before", command: "code-workspace-hook-write", matcher: "Edit" },
  ], "example-extension");
  assert.deepEqual(hooks.map((hook) => hook.event), ["task.started", "write.before"]);
  assert.deepEqual(hooks[0].tools, ["codex"]);
  assert.throws(() => validateHookDeclarations([{ id: "audit", event: "PreToolUse", command: "echo audit" }], "example-extension"), (error) => error.code === "HOOK_EVENT_UNSUPPORTED");
  assert.throws(() => validateHookDeclarations([{ id: "audit", event: "write.before", command: "echo\nunsafe" }], "example-extension"), (error) => error.code === "HOOK_DECLARATION_INVALID");
});

test("extension Hook declarations dynamically plug and unplug Codex and Claude adaptors", () => {
  const repository = temporaryRoot();
  const definition = writeExtension(repository, {
    id: "hook-plugin",
    outputs: [],
    script: outputScript({}),
    hooks: [
      { id: "activity", event: "task.activity", command: "code-workspace-plugin-activity", tools: ["codex", "claude"] },
      { id: "before-write", event: "write.before", command: "code-workspace-plugin-write", tools: ["codex", "claude"], matcher: "*", timeoutMs: 4 },
    ],
  });
  const root = temporaryRoot();
  fs.mkdirSync(path.join(root, ".codex"), { recursive: true });
  fs.mkdirSync(path.join(root, ".claude"), { recursive: true });
  const codexUser = { description: "user", hooks: { Stop: [{ hooks: [{ type: "command", command: "user-stop" }] }] } };
  const claudeUser = { permissions: { allow: ["Read"] } };
  fs.writeFileSync(path.join(root, ".codex", "hooks.json"), `${JSON.stringify(codexUser, null, 2)}\n`);
  fs.writeFileSync(path.join(root, ".claude", "settings.json"), `${JSON.stringify(claudeUser, null, 2)}\n`);
  const plan = resolveExtensionPlans(discoverExtensions({ extensionsRoot: repository }), [definition.id], { tools: ["codex", "claude"], state: emptyExtensionState() })[0];
  const result = runExtensionBatch(root, [plan], (entry) => ({ ...context(entry), tools: ["codex", "claude"] }));
  assert.equal(result.results[0].status, "installed");
  const codex = JSON.parse(fs.readFileSync(path.join(root, ".codex", "hooks.json"), "utf8"));
  const claude = JSON.parse(fs.readFileSync(path.join(root, ".claude", "settings.json"), "utf8"));
  assert.equal(codex.hooks.UserPromptSubmit.length, 1);
  assert.equal(codex.hooks.PermissionRequest.length, 1);
  assert.equal(codex.hooks.PreToolUse[0].matcher, "*");
  assert.equal(claude.hooks.PreToolUse[0].matcher, "*");
  assert.deepEqual(claude.permissions, claudeUser.permissions);
  assert.equal(loadExtensionState(root).extensions[definition.id].installed.hooks.length, 2);

  const uninstall = applyExtensionUninstall(planExtensionUninstall(root, definition.id));
  assert.equal(uninstall.status, "uninstalled");
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(root, ".codex", "hooks.json"), "utf8")), codexUser);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(root, ".claude", "settings.json"), "utf8")), claudeUser);
});

test("Hook ownership conflicts and local Hook drift fail closed", () => {
  const repository = temporaryRoot();
  const hook = { id: "activity", event: "task.activity", command: "same-hook", tools: ["codex"] };
  writeExtension(repository, { id: "first-hook", outputs: [], script: outputScript({}), hooks: [hook] });
  writeExtension(repository, { id: "second-hook", outputs: [], script: outputScript({}), hooks: [hook] });
  assert.throws(
    () => resolveExtensionPlans(discoverExtensions({ extensionsRoot: repository }), ["first-hook", "second-hook"], { tools: ["codex"], state: emptyExtensionState() }),
    (error) => error.code === "HOOK_DECLARATION_CONFLICT"
  );

  const singleRepository = temporaryRoot();
  const definition = writeExtension(singleRepository, { id: "drift-hook", outputs: [], script: outputScript({}), hooks: [hook] });
  const root = temporaryRoot();
  const plan = resolveExtensionPlans(discoverExtensions({ extensionsRoot: singleRepository }), [definition.id], { tools: ["codex"], state: emptyExtensionState() })[0];
  assert.equal(runExtensionBatch(root, [plan], (entry) => context(entry)).results[0].status, "installed");
  const file = path.join(root, ".codex", "hooks.json");
  const document = JSON.parse(fs.readFileSync(file, "utf8"));
  document.hooks.UserPromptSubmit[0].hooks[0].command = "changed-by-user";
  fs.writeFileSync(file, `${JSON.stringify(document, null, 2)}\n`);
  assert.throws(() => planExtensionUninstall(root, definition.id), (error) => error.code === "HOOK_CONTRIBUTION_MODIFIED");
  assert(loadExtensionState(root).extensions[definition.id].installed);
});

test("legacy installed file, Codex block, and Hook state can be uninstalled without the extension package", () => {
  const root = temporaryRoot();
  const extensionId = "legacy-extension";
  const fileTarget = ".legacy/file.txt";
  const fileContent = "legacy file\n";
  const configFragment = "[legacy]\nenabled = true\n";
  const managedHook = { matcher: "Bash", hooks: [{ type: "command", command: "echo managed" }] };
  const userHook = { matcher: "Read", hooks: [{ type: "command", command: "echo user" }] };
  fs.mkdirSync(path.join(root, ".legacy"), { recursive: true });
  fs.mkdirSync(path.join(root, ".codex"), { recursive: true });
  fs.writeFileSync(path.join(root, fileTarget), fileContent);
  fs.writeFileSync(path.join(root, ".codex", "config.toml"), [
    'model = "gpt-5"',
    '',
    `# BEGIN code-workspace-extension:${extensionId}:legacy-config`,
    configFragment.trimEnd(),
    `# END code-workspace-extension:${extensionId}:legacy-config`,
    '',
  ].join("\n"));
  fs.writeFileSync(path.join(root, ".codex", "hooks.json"), `${JSON.stringify({ hooks: { PreToolUse: [userHook, managedHook] } }, null, 2)}\n`);
  const state = emptyExtensionState();
  state.extensions[extensionId] = {
    installed: {
      version: "1.0.0",
      manifestSha256: "a".repeat(64),
      artifacts: [
        { id: "legacy-file", target: fileTarget, installedSha256: sha256(Buffer.from(fileContent)) },
        { id: "legacy-config", kind: "codex-config-block", target: ".codex/config.toml", installedSha256: sha256(Buffer.from(configFragment)) },
        { id: "legacy-hooks", kind: "codex-hooks", target: ".codex/hooks.json", installedSha256: "b".repeat(64), payload: { schemaVersion: 1, hooks: { PreToolUse: [managedHook] } } },
      ],
    },
    lastAttempt: { version: "1.0.0", status: "installed" },
  };
  saveExtensionState(root, state);

  const plan = planExtensionUninstall(root, extensionId);
  assert.equal(plan.action, "remove");
  assert.equal(applyExtensionUninstall(plan).status, "uninstalled");
  assert.equal(fs.existsSync(path.join(root, fileTarget)), false);
  const config = fs.readFileSync(path.join(root, ".codex", "config.toml"), "utf8");
  assert.match(config, /model = "gpt-5"/);
  assert.doesNotMatch(config, /legacy-extension|\[legacy\]/);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(root, ".codex", "hooks.json"), "utf8")).hooks.PreToolUse, [userHook]);
  assert.equal(loadExtensionState(root).extensions[extensionId], undefined);
});

test("installed protocol v2 remains readable and uninstallable after Extension Spec versioning", () => {
  const root = temporaryRoot();
  const extensionId = "legacy-v2-extension";
  const target = ".legacy-v2/file.txt";
  const content = "legacy v2\n";
  fs.mkdirSync(path.dirname(path.join(root, target)), { recursive: true });
  fs.writeFileSync(path.join(root, target), content);
  const state = emptyExtensionState();
  state.extensions[extensionId] = {
    installed: {
      protocolVersion: 2,
      version: "1.0.0",
      manifestSha256: "a".repeat(64),
      packageSha256: "b".repeat(64),
      artifacts: [{
        id: "legacy-file",
        kind: "file",
        ownership: "exclusive",
        target,
        installedSha256: sha256(Buffer.from(content)),
      }],
    },
    lastAttempt: { version: "1.0.0", status: "installed" },
  };
  saveExtensionState(root, state);

  assert.equal(loadExtensionState(root).extensions[extensionId].installed.protocolVersion, 2);
  assert.equal(applyExtensionUninstall(planExtensionUninstall(root, extensionId)).status, "uninstalled");
  assert.equal(fs.existsSync(path.join(root, target)), false);
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
  assert.deepEqual(parse(argv("init", "--extensions", "example-extension", ".", "--yes")).options.extensions, "example-extension");
  assert.deepEqual(parse(argv("init", ".", "--yes", "--extensions=none")).options.extensions, "none");
  const root = temporaryRoot();
  const result = runCli(root, ["init", ".", "--extensions", "example-extension@1.0.0", "--yes", "--json"]);
  assert.equal(result.status, 1);
  assert.equal(JSON.parse(result.stdout).diagnostics[0].code, "EXTENSION_VERSION_SELECTION_UNSUPPORTED");
  assert.equal(fs.existsSync(path.join(root, ".code-workspace")), false);
});

test("interactive init offers extension names and confirms frozen versions and manifest hashes", async () => {
  const root = temporaryRoot();
  const repository = temporaryRoot();
  writeExtension(repository, { id: "example-extension", version: "1.2.3", name: "Example Extension" });
  const catalog = discoverExtensions({ extensionsRoot: repository });
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
      return ["example-extension"];
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
  assert.deepEqual(offered.choices.map((entry) => entry.value), ["example-extension"]);
  assert.match(offered.choices[0].label, /latest supported: 1\.2\.3 · Extension Spec 1/);
  assert.equal(plan.extensions[0].version, "1.2.3");
  assert.match(readyLines.find((line) => line.startsWith("Extensions")), /[a-f0-9]{64}/);
});

test("interactive extension install lists built-ins and disables unsupported Extension Specs", async () => {
  const repository = temporaryRoot();
  writeExtension(repository, { id: "alpha", name: "Alpha", extensionSpecVersion: 1 });
  writeExtension(repository, { id: "beta", name: "Beta", extensionSpecVersion: 2 });
  const catalog = discoverExtensions({ extensionsRoot: repository });
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

test("extension install requires explicit names non-interactively and confirmation before writing", async () => {
  const root = temporaryRoot();
  assert.equal(runCli(root, ["init", ".", "--tools", "codex", "--extensions", "none", "--yes", "--json"]).status, 0);
  const noNames = runCli(root, ["extension", "install", "--yes", "--json"]);
  assert.equal(noNames.status, 1);
  assert.equal(JSON.parse(noNames.stdout).diagnostics[0].code, "EXTENSION_SELECTION_REQUIRED");

  const versioned = runCli(root, ["extension", "install", "example-extension@1.0.0", "--yes", "--json"]);
  assert.equal(versioned.status, 1);
  assert.equal(JSON.parse(versioned.stdout).diagnostics[0].code, "EXTENSION_VERSION_SELECTION_UNSUPPORTED");

  const repository = temporaryRoot();
  writeExtension(repository, { id: "example-extension" });
  await assert.rejects(executeExtensionInstall({
    root,
    args: ["example-extension"],
    options: { json: true },
    config: loadConfigProjection(root, ["identity", "language"]),
    dependencies: { extensionsRoot: repository, interactive: false },
  }), (error) => error.code === "CLI_CONFIRMATION_REQUIRED");
  assert.equal(fs.existsSync(extensionStatePath(root)), false);
});

test("standalone extension install is idempotent without rewriting core assets", async () => {
  const repository = temporaryRoot();
  const definition = writeExtension(repository, { id: "example-extension" });
  const root = temporaryRoot();
  assert.equal(runCli(root, ["init", ".", "--tools", "codex", "--extensions", "none", "--yes", "--json"]).status, 0);
  const coreFile = path.join(root, "AGENTS.md");
  const coreBefore = fs.readFileSync(coreFile, "utf8");
  const invocation = {
    root,
    args: [definition.id],
    options: { yes: true, json: true },
    config: loadConfigProjection(root, ["identity", "language"]),
    dependencies: { extensionsRoot: repository, interactive: false },
  };
  const installed = await executeExtensionInstall(invocation);
  assert.equal(installed.data.results[0].status, "installed");
  assert.equal(fs.readFileSync(coreFile, "utf8"), coreBefore);
  const repeated = await executeExtensionInstall(invocation);
  assert.deepEqual(repeated.data.summary, { total: 1, succeeded: 0, skipped: 1, failed: 0 });
});

test("standalone extension install preserves ordered best-effort results and fails when one extension fails", async () => {
  const repository = temporaryRoot();
  writeExtension(repository, { id: "broken", rawScript: true, script: 'process.stderr.write("broken\\n"); process.exit(2);\n' });
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
  assert.equal(result.diagnostics[0].code, "EXTENSION_INIT_FAILED");
  assert.equal(fs.existsSync(path.join(root, working.target)), true);
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
