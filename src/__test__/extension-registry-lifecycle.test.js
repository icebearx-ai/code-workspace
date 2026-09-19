const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { directoryDigest } = require("../core/directory-digest");
const {
  emptyExtensionState,
  loadExtensionState,
  runExtensionBatch,
} = require("../core/extensions");
const {
  ensureStoredExtensionPackage,
  loadStoreRegistry,
} = require("../core/extension-store");
const {
  getRegistryExtensionInfo,
  listRegistryExtensionChoices,
  prepareRegistryExtensionPlans,
  resolveRegistryExtensionCandidate,
  searchRegistryExtensions,
} = require("../core/extension-registry-lifecycle");
const {
  collectRegistryExtensionInstallSelection,
  executeExtensionInfo,
  executeExtensionInstall,
  executeExtensionSearch,
  executeExtensionUpgrade,
} = require("../cli/commands/extension");

function temporaryRoot(prefix = "code-workspace-registry-lifecycle-") {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function writeExtension(root, options = {}) {
  const id = options.id || "example";
  const version = options.version || "1.0.0";
  const content = options.content || `${id}@${version}\n`;
  const script = options.script || [
    'const fs = require("node:fs");',
    'const path = require("node:path");',
    'const output = process.argv[process.argv.indexOf("--output") + 1];',
    'const result = process.argv[process.argv.indexOf("--result") + 1];',
    'const target = path.join(output, "artifact.txt");',
    'fs.mkdirSync(path.dirname(target), { recursive: true });',
    `fs.writeFileSync(target, ${JSON.stringify(content)});`,
    `fs.writeFileSync(result, JSON.stringify({ schemaVersion: 1, extensionSpecVersion: ${options.extensionSpecVersion || 1}, extension: { id: ${JSON.stringify(id)}, version: ${JSON.stringify(version)} }, outputs: [{ id: "artifact", source: "artifact.txt" }] }));`,
    "",
  ].join("\n");
  fs.mkdirSync(root, { recursive: true });
  fs.writeFileSync(path.join(root, "init.js"), script);
  fs.writeFileSync(path.join(root, "manifest.json"), `${JSON.stringify({
    schemaVersion: 3,
    extensionSpecVersion: options.extensionSpecVersion || 1,
    experimental: true,
    id,
    name: options.name || id,
    description: options.description || `${id} summary`,
    version,
    entry: "init.js",
    entrySha256: require("../core/fs").sha256(Buffer.from(script)),
    timeoutMs: 1000,
    outputs: [{ id: "artifact", kind: "file", ownership: "exclusive", target: `.example/${id}.txt` }],
  }, null, 2)}\n`);
  return { root, script, content };
}

function createFakeProvider(packages, options = {}) {
  const calls = [];
  const configuration = {
    registryOrigin: "https://nexus.example.com",
    repository: "extensions",
  };
  const metadata = {};
  for (const [id, definition] of Object.entries(packages)) {
    metadata[id] = {
      packageName: `@codew-ext/${id}`,
      extensionId: id,
      description: definition.description || `${id} summary`,
      versions: Object.entries(definition.versions || {}).map(([version, entry]) => {
        const packageSha256 = entry.packageSha256 || directoryDigest(entry.sourceRoot);
        return {
          version,
          extensionSpecVersion: entry.extensionSpecVersion || 1,
          packageSha256,
          transport: {
            name: `@codew-ext/${id}`,
            version,
            description: definition.description || `${id} summary`,
            keywords: ["code-workspace-extension"],
            codeWorkspace: {
              schemaVersion: 1,
              extensionId: id,
              extensionSpecVersion: entry.extensionSpecVersion || 1,
              packageRoot: "extension",
              packageSha256,
            },
            files: ["extension"],
          },
          deprecated: entry.deprecated === true,
          ...(entry.deprecatedReason ? { deprecatedReason: entry.deprecatedReason } : {}),
        };
      }),
    };
  }
  return {
    configuration,
    calls,
    async search(searchOptions = {}) {
      calls.push({ operation: "search", ...searchOptions });
      if (options.searchError) throw options.searchError;
      return {
        items: Object.keys(metadata).map((id) => ({ packageName: `@codew-ext/${id}`, extensionId: id })),
        continuationToken: options.continuationToken || null,
        complete: !options.continuationToken,
        pages: 1,
      };
    },
    async getPackageMetadata(id) {
      calls.push({ operation: "metadata", id });
      if (options.metadataError) throw options.metadataError;
      if (options.metadataErrors?.[id]) throw options.metadataErrors[id];
      const value = metadata[id];
      if (!value) {
        const error = new Error(`@codew-ext/${id} not found`);
        error.code = "EXTENSION_REGISTRY_PACKAGE_NOT_FOUND";
        throw error;
      }
      return value;
    },
    async import(id, version, importOptions = {}) {
      calls.push({ operation: "import", id, version });
      if (options.importError) throw options.importError;
      const entry = packages[id]?.versions?.[version];
      if (!entry?.sourceRoot) {
        const error = new Error(`@codew-ext/${id}@${version} not found`);
        error.code = "EXTENSION_REGISTRY_PACKAGE_NOT_FOUND";
        throw error;
      }
      return ensureStoredExtensionPackage({
        ...importOptions,
        sourceRoot: entry.sourceRoot,
        id,
        version,
        provenance: {
          kind: "nexus-npm",
          registryOrigin: configuration.registryOrigin,
          repository: configuration.repository,
          packageName: `@codew-ext/${id}`,
          archiveIntegrity: `sha512-${crypto.createHash("sha512").update(`${id}@${version}`).digest("base64")}`,
        },
      });
    },
  };
}

function context(plan) {
  return {
    schemaVersion: 1,
    extensionSpecVersion: plan.extensionSpecVersion,
    extension: { id: plan.id, version: plan.version },
    workspace: { name: "registry", uuid: "123e4567-e89b-42d3-a456-426614174000", language: "zh-CN" },
    tools: ["codex"],
  };
}

function invocation(root, args, options = {}, dependencies = {}) {
  return {
    root,
    args,
    options,
    config: {
      workspace: {
        name: "registry",
        uuid: "123e4567-e89b-42d3-a456-426614174000",
        language: "zh-CN",
      },
    },
    dependencies: { interactive: false, ...dependencies },
  };
}

test("Registry search and info convert metadata without secrets or raw payloads", async () => {
  const source = temporaryRoot();
  const versions = {};
  for (const definition of [
    { version: "2.0.0", deprecated: true, deprecatedReason: "broken" },
    { version: "1.2.0-beta.1" },
    { version: "1.1.0" },
    { version: "1.0.0", extensionSpecVersion: 2 },
  ]) {
    const root = path.join(source, definition.version);
    writeExtension(root, { version: definition.version, ...(definition.extensionSpecVersion ? { extensionSpecVersion: definition.extensionSpecVersion } : {}) });
    versions[definition.version] = { sourceRoot: root, ...definition };
  }
  const provider = createFakeProvider({
    example: { versions },
    other: { versions: { "1.0.0": { sourceRoot: path.join(source, "1.1.0") } } },
  });

  const search = await searchRegistryExtensions({ provider, query: "example", limit: 10 });
  assert.deepEqual(search.items.map((entry) => entry.extensionId), ["example"]);
  assert.equal(search.items[0].latestCandidate.version, "1.1.0");
  assert.equal(search.complete, true);
  assert.equal(search.truncated, false);
  assert.deepEqual(search.registry, { scope: "@codew-ext", origin: "https://nexus.example.com", repository: "extensions" });

  const info = await getRegistryExtensionInfo({ provider, name: "example" });
  assert.equal(info.packageName, "@codew-ext/example");
  assert.equal(info.defaultCandidate.version, "1.1.0");
  assert.deepEqual(info.versions.map((entry) => entry.version), ["2.0.0", "1.2.0-beta.1", "1.1.0", "1.0.0"]);
  assert.deepEqual(info.versions[0].eligibilityReasons, ["deprecated"]);
  assert.deepEqual(info.versions[1].eligibilityReasons, ["prerelease"]);
  assert.deepEqual(info.versions[2].eligibilityReasons, []);
  assert.deepEqual(info.versions[3].eligibilityReasons, ["unsupported-extension-spec"]);
  assert.equal(info.verification.level, "metadata-only");
  assert.doesNotMatch(JSON.stringify({ search, info }), /Authorization|token|npmrc/i);

  const truncated = await searchRegistryExtensions({ provider, query: "", limit: 1 });
  assert.equal(truncated.truncated, true);
  assert.equal(truncated.complete, false);
});

test("Registry version resolution merges providers and rejects unsafe defaults", async (t) => {
  const extensionsRoot = temporaryRoot();
  const remoteRoot = temporaryRoot();
  const versions = {};
  for (const definition of [
    { version: "2.0.0", deprecated: true },
    { version: "1.2.0-beta.1" },
    { version: "1.1.0" },
  ]) {
    const root = path.join(remoteRoot, definition.version);
    writeExtension(root, { version: definition.version });
    versions[definition.version] = { sourceRoot: root, ...definition };
  }
  const provider = createFakeProvider({ example: { versions } });
  t.after(() => {
    fs.rmSync(extensionsRoot, { recursive: true, force: true });
    fs.rmSync(remoteRoot, { recursive: true, force: true });
  });

  const resolved = await resolveRegistryExtensionCandidate({ name: "example", provider, extensionsRoot });
  assert.equal(resolved.selected.version, "1.1.0");
  assert.deepEqual(resolved.selected.sources, ["nexus"]);
  assert.equal(resolved.resolutionScope, "registry");

  await assert.rejects(
    () => resolveRegistryExtensionCandidate({ name: "example", provider, extensionsRoot, offline: true }),
    (error) => error.code === "EXTENSION_NOT_FOUND"
  );
  const callsBeforeOffline = provider.calls.length;
  assert.equal(provider.calls.length, callsBeforeOffline);

  await assert.rejects(
    () => resolveRegistryExtensionCandidate({ name: "example", provider, extensionsRoot, version: "2.0.0" }),
    (error) => error.code === "EXTENSION_REGISTRY_PACKAGE_DEPRECATED"
  );
  const deprecated = await resolveRegistryExtensionCandidate({ name: "example", provider, extensionsRoot, version: "2.0.0", allowDeprecated: true });
  assert.equal(deprecated.selected.version, "2.0.0");
  const prerelease = await resolveRegistryExtensionCandidate({ name: "example", provider, extensionsRoot, version: "1.2.0-beta.1" });
  assert.equal(prerelease.selected.version, "1.2.0-beta.1");

  const failingProvider = createFakeProvider(
    { example: { versions } },
    { metadataError: Object.assign(new Error("network unavailable"), { code: "EXTENSION_REGISTRY_NETWORK_FAILED" }) },
  );
  await assert.rejects(
    () => resolveRegistryExtensionCandidate({ name: "example", provider: failingProvider, extensionsRoot }),
    (error) => error.code === "EXTENSION_REGISTRY_NETWORK_FAILED"
  );
});

test("system extension resolution ignores a same-named Nexus package", async (t) => {
  const extensionsRoot = temporaryRoot();
  const systemRoot = path.join(extensionsRoot, "codew-workspace-guard", "1.0.0");
  writeExtension(systemRoot, { id: "codew-workspace-guard", version: "1.0.0" });
  const remoteRoot = temporaryRoot();
  writeExtension(path.join(remoteRoot, "9.0.0"), { id: "codew-workspace-guard", version: "9.0.0" });
  const provider = createFakeProvider({
    "codew-workspace-guard": { versions: { "9.0.0": { sourceRoot: path.join(remoteRoot, "9.0.0") } } },
  });
  t.after(() => {
    fs.rmSync(extensionsRoot, { recursive: true, force: true });
    fs.rmSync(remoteRoot, { recursive: true, force: true });
  });
  const resolved = await resolveRegistryExtensionCandidate({ name: "codew-workspace-guard", provider, extensionsRoot });
  assert.equal(resolved.system, true);
  assert.equal(resolved.provider, null);
  assert.equal(resolved.selected.version, "1.0.0");
  assert.deepEqual(resolved.selected.sources, ["builtin"]);
});

test("remote install preparation imports, plans, and activates a verified Store package", async (t) => {
  const extensionsRoot = temporaryRoot();
  const remoteRoot = temporaryRoot();
  writeExtension(path.join(remoteRoot, "1.1.0"), { version: "1.1.0", content: "example@1.1.0\n" });
  const provider = createFakeProvider({ example: { versions: { "1.1.0": { sourceRoot: path.join(remoteRoot, "1.1.0") } } } });
  const store = temporaryRoot();
  const workspace = temporaryRoot();
  t.after(() => {
    fs.rmSync(extensionsRoot, { recursive: true, force: true });
    fs.rmSync(remoteRoot, { recursive: true, force: true });
    fs.rmSync(store, { recursive: true, force: true });
    fs.rmSync(workspace, { recursive: true, force: true });
  });

  const preparation = await prepareRegistryExtensionPlans({
    requested: ["example"],
    tools: ["codex"],
    state: emptyExtensionState(),
    extensionsRoot,
    storeRoot: store,
    provider,
  });
  assert.deepEqual(preparation.failures, []);
  assert.equal(preparation.plans.length, 1);
  assert.equal(preparation.plans[0].version, "1.1.0");
  assert.equal(preparation.plans[0].source, "nexus");
  assert.equal(preparation.plans[0].packageSha256, directoryDigest(path.join(remoteRoot, "1.1.0")));

  const batch = runExtensionBatch(workspace, preparation.plans, context, {
    useExtensionStore: true,
    extensionStoreRoot: store,
  });
  assert.equal(batch.results[0].status, "installed");
  assert.equal(fs.readFileSync(path.join(workspace, ".example", "example.txt"), "utf8"), "example@1.1.0\n");
  assert.equal(loadExtensionState(workspace).extensions.example.installed.packageSha256, preparation.plans[0].packageSha256);
  assert.equal(loadStoreRegistry(store).packages["example@1.1.0"].provenance.kind, "nexus-npm");

  const offlinePreparation = await prepareRegistryExtensionPlans({
    requested: ["example"],
    version: "1.1.0",
    tools: ["codex"],
    state: emptyExtensionState(),
    extensionsRoot,
    storeRoot: store,
    provider: createFakeProvider({}, {
      metadataError: Object.assign(new Error("must not access network"), { code: "EXTENSION_REGISTRY_NETWORK_FAILED" }),
    }),
    offline: true,
  });
  assert.deepEqual(offlinePreparation.failures, []);
  assert.equal(offlinePreparation.plans.length, 1, JSON.stringify(offlinePreparation.failures));
  assert.equal(offlinePreparation.plans[0].source, "store");
  assert.equal(offlinePreparation.plans[0].resolutionScope, "local-only");

  const noRegistryHome = temporaryRoot();
  t.after(() => fs.rmSync(noRegistryHome, { recursive: true, force: true }));
  const localPreparation = await prepareRegistryExtensionPlans({
    requested: ["example"],
    tools: ["codex"],
    state: emptyExtensionState(),
    extensionsRoot,
    storeRoot: temporaryRoot(),
    home: noRegistryHome,
  });
  assert.equal(localPreparation.plans.length, 0);
  assert.equal(localPreparation.failures[0].code, "EXTENSION_NOT_FOUND");
});

test("extension install CLI resolves remote versions and preserves option safety", async (t) => {
  const extensionsRoot = temporaryRoot();
  writeExtension(path.join(extensionsRoot, "example", "1.0.0"), { version: "1.0.0" });
  const remoteRoot = temporaryRoot();
  writeExtension(path.join(remoteRoot, "1.1.0"), { version: "1.1.0", content: "example@1.1.0\n" });
  const provider = createFakeProvider({ example: { versions: { "1.1.0": { sourceRoot: path.join(remoteRoot, "1.1.0") } } } });
  const store = temporaryRoot();
  const root = temporaryRoot();
  t.after(() => {
    fs.rmSync(extensionsRoot, { recursive: true, force: true });
    fs.rmSync(remoteRoot, { recursive: true, force: true });
    fs.rmSync(store, { recursive: true, force: true });
    fs.rmSync(root, { recursive: true, force: true });
  });

  const installed = await executeExtensionInstall(invocation(root, ["example"], { yes: true, json: true }, {
    extensionsRoot,
    extensionStoreRoot: store,
    nexusProvider: provider,
  }));
  assert.equal(installed.ok, true);
  assert.deepEqual(installed.data.summary, { total: 1, succeeded: 1, skipped: 0, failed: 0 });
  assert.equal(installed.data.results[0].source, "nexus");
  assert.equal(installed.data.results[0].resolvedVersion, "1.1.0");
  assert.equal(loadExtensionState(root).extensions.example.installed.version, "1.1.0");

  const repeated = await executeExtensionInstall(invocation(root, ["example"], { yes: true, json: true, offline: true }, {
    extensionsRoot,
    extensionStoreRoot: store,
    nexusProvider: createFakeProvider({}, {
      metadataError: Object.assign(new Error("must not access network"), { code: "EXTENSION_REGISTRY_NETWORK_FAILED" }),
    }),
  }));
  assert.equal(repeated.ok, true);
  assert.deepEqual(repeated.data.summary, { total: 1, succeeded: 0, skipped: 1, failed: 0 });
  assert.equal(repeated.data.results[0].source, "store");

  await assert.rejects(
    () => executeExtensionInstall(invocation(temporaryRoot(), ["example", "other"], { version: "1.1.0", yes: true })),
    (error) => error.code === "EXTENSION_VERSION_SELECTION_INVALID"
  );
  await assert.rejects(
    () => executeExtensionInstall(invocation(temporaryRoot(), ["example"], { allowDeprecated: true, yes: true })),
    (error) => error.code === "EXTENSION_VERSION_SELECTION_INVALID"
  );
  await assert.rejects(
    () => executeExtensionInstall(invocation(temporaryRoot(), ["example@1.1.0"], { yes: true })),
    (error) => error.code === "EXTENSION_VERSION_SELECTION_UNSUPPORTED"
  );

  const failingRoot = temporaryRoot();
  t.after(() => fs.rmSync(failingRoot, { recursive: true, force: true }));
  const failing = await executeExtensionInstall(invocation(failingRoot, ["example"], { yes: true, json: true }, {
    extensionsRoot,
    extensionStoreRoot: temporaryRoot(),
    nexusProvider: createFakeProvider({}, {
      metadataError: Object.assign(new Error("network unavailable"), { code: "EXTENSION_REGISTRY_NETWORK_FAILED" }),
    }),
  }));
  assert.equal(failing.ok, false);
  assert.equal(failing.data.results[0].code, "EXTENSION_REGISTRY_NETWORK_FAILED");
  assert.equal(fs.existsSync(path.join(failingRoot, ".codew", "ext-manifest.json")), false);
});

test("extension upgrade CLI uses installed selection and current skip semantics", async (t) => {
  const extensionsRoot = temporaryRoot();
  const remoteRoot = temporaryRoot();
  writeExtension(path.join(remoteRoot, "example-1.0.0"), { version: "1.0.0", content: "example@1.0.0\n" });
  writeExtension(path.join(remoteRoot, "1.1.0"), { version: "1.1.0", content: "example@1.1.0\n" });
  writeExtension(path.join(remoteRoot, "other-1.0.0"), { id: "other", version: "1.0.0", content: "other@1.0.0\n" });
  const provider = createFakeProvider({
    example: { versions: {
      "1.0.0": { sourceRoot: path.join(remoteRoot, "example-1.0.0") },
      "1.1.0": { sourceRoot: path.join(remoteRoot, "1.1.0") },
    } },
    other: { versions: { "1.0.0": { sourceRoot: path.join(remoteRoot, "other-1.0.0") } } },
  });
  const store = temporaryRoot();
  const root = temporaryRoot();
  t.after(() => {
    fs.rmSync(extensionsRoot, { recursive: true, force: true });
    fs.rmSync(remoteRoot, { recursive: true, force: true });
    fs.rmSync(store, { recursive: true, force: true });
    fs.rmSync(root, { recursive: true, force: true });
  });

  const initial = await executeExtensionInstall(invocation(root, ["example"], {
    yes: true,
    json: true,
    version: "1.0.0",
  }, { extensionsRoot, extensionStoreRoot: store, nexusProvider: provider }));
  assert.equal(initial.ok, true, initial.text);
  const otherInitial = await executeExtensionInstall(invocation(root, ["other"], {
    yes: true,
    json: true,
    version: "1.0.0",
  }, { extensionsRoot, extensionStoreRoot: store, nexusProvider: provider }));
  assert.equal(otherInitial.ok, true, otherInitial.text);
  const coreFile = path.join(root, "USER_GUIDE.md");
  const runtimeData = path.join(root, ".codew", "runtime-data", "example.txt");
  fs.mkdirSync(path.dirname(runtimeData), { recursive: true });
  fs.writeFileSync(coreFile, "core content\n");
  fs.writeFileSync(runtimeData, "runtime user data\n");

  const upgraded = await executeExtensionUpgrade(invocation(root, ["example"], { yes: true, json: true }, {
    extensionsRoot,
    extensionStoreRoot: store,
    nexusProvider: provider,
  }));
  assert.equal(upgraded.ok, true, upgraded.text);
  assert.deepEqual(upgraded.data.summary, { total: 1, succeeded: 1, skipped: 0, failed: 0 });
  assert.equal(upgraded.data.results[0].source, "nexus");
  assert.equal(loadExtensionState(root).extensions.example.installed.version, "1.1.0");
  assert.equal(fs.readFileSync(path.join(root, ".example", "example.txt"), "utf8"), "example@1.1.0\n");
  assert.equal(fs.readFileSync(path.join(root, ".example", "other.txt"), "utf8"), "other@1.0.0\n");
  assert.equal(fs.readFileSync(coreFile, "utf8"), "core content\n");
  assert.equal(fs.readFileSync(runtimeData, "utf8"), "runtime user data\n");

  const current = await executeExtensionUpgrade(invocation(root, ["example"], { yes: true, json: true }, {
    extensionsRoot,
    extensionStoreRoot: store,
    nexusProvider: provider,
  }));
  assert.equal(current.ok, true);
  assert.deepEqual(current.data.summary, { total: 1, succeeded: 0, skipped: 1, failed: 0 });

  const rejected = await executeExtensionUpgrade(invocation(root, ["missing", "codew-workspace-guard"], { yes: true, json: true }, {
    extensionStoreRoot: store,
    nexusProvider: provider,
  }));
  assert.equal(rejected.ok, false);
  assert.deepEqual(rejected.data.requested, ["missing", "codew-workspace-guard"]);
  assert.deepEqual(rejected.data.results.map((entry) => entry.code), ["EXTENSION_NOT_INSTALLED", "EXTENSION_SYSTEM_MANAGED"]);
});

test("failed Workspace activation retains an unreferenced verified Store cache", async (t) => {
  const remoteRoot = temporaryRoot();
  const failingRoot = path.join(remoteRoot, "failing", "1.1.0");
  const keeperRoot = path.join(remoteRoot, "keeper", "1.0.0");
  writeExtension(failingRoot, {
    id: "failing",
    version: "1.1.0",
    script: "process.stderr.write(\"failing extension\\n\"); process.exit(2);\n",
  });
  writeExtension(keeperRoot, { id: "keeper", version: "1.0.0" });
  const provider = createFakeProvider({
    failing: { versions: { "1.1.0": { sourceRoot: failingRoot } } },
    keeper: { versions: { "1.0.0": { sourceRoot: keeperRoot } } },
  });
  const store = temporaryRoot();
  const root = temporaryRoot();
  t.after(() => {
    fs.rmSync(remoteRoot, { recursive: true, force: true });
    fs.rmSync(store, { recursive: true, force: true });
    fs.rmSync(root, { recursive: true, force: true });
  });

  const preparation = await prepareRegistryExtensionPlans({
    requested: ["failing", "keeper"],
    tools: ["codex"],
    state: emptyExtensionState(),
    storeRoot: store,
    provider,
  });
  assert.deepEqual(preparation.failures, []);
  const batch = runExtensionBatch(root, preparation.plans, context, {
    useExtensionStore: true,
    extensionStoreRoot: store,
  });
  assert.deepEqual(batch.results.map((entry) => [entry.id, entry.status]), [
    ["failing", "failed"],
    ["keeper", "installed"],
  ]);
  const registry = loadStoreRegistry(store);
  const failingReferences = registry.packages["failing@1.1.0"].references;
  assert.deepEqual(failingReferences, { workspaces: [], processes: [], transactions: [], pins: [] });
  assert.equal(fs.existsSync(path.join(store, "failing", "1.1.0", "manifest.json")), true);
  assert.deepEqual(registry.packages["keeper@1.0.0"].references.workspaces, [path.resolve(root)]);
});

test("search and info handlers use shared results and fail when Registry is unconfigured", async (t) => {
  const remoteRoot = temporaryRoot();
  writeExtension(path.join(remoteRoot, "1.1.0"), { version: "1.1.0" });
  const provider = createFakeProvider({ example: { versions: { "1.1.0": { sourceRoot: path.join(remoteRoot, "1.1.0") } } } });
  t.after(() => fs.rmSync(remoteRoot, { recursive: true, force: true }));

  const search = await executeExtensionSearch({
    args: ["example"],
    options: { json: true },
    dependencies: { provider },
  });
  assert.equal(search.command, "extension.search");
  assert.equal(search.ok, true);
  assert.deepEqual(search.data.items.map((entry) => entry.extensionId), ["example"]);
  assert.match(search.text, /example\s+@1\.1\.0/);

  const info = await executeExtensionInfo({
    args: ["example"],
    options: { json: true },
    dependencies: { provider },
  });
  assert.equal(info.command, "extension.info");
  assert.equal(info.ok, true);
  assert.equal(info.data.defaultCandidate.version, "1.1.0");
  assert.match(info.text, /Default candidate: 1\.1\.0/);

  const home = temporaryRoot();
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  await assert.rejects(
    () => executeExtensionSearch({ args: [], options: { json: true }, dependencies: { home } }),
    (error) => error.code === "EXTENSION_REGISTRY_NOT_CONFIGURED"
  );
  await assert.rejects(
    () => executeExtensionInfo({ args: ["example"], options: { json: true }, dependencies: { home } }),
    (error) => error.code === "EXTENSION_REGISTRY_NOT_CONFIGURED"
  );
});

test("interactive install choices merge Store and Nexus candidates", async (t) => {
  const extensionsRoot = temporaryRoot();
  writeExtension(path.join(extensionsRoot, "example", "1.0.0"), { version: "1.0.0" });
  const remoteRoot = temporaryRoot();
  writeExtension(path.join(remoteRoot, "1.1.0"), { version: "1.1.0" });
  writeExtension(path.join(remoteRoot, "9.0.0"), { id: "codew-workspace-guard", version: "9.0.0" });
  writeExtension(path.join(extensionsRoot, "codew-workspace-guard", "1.0.0"), { id: "codew-workspace-guard", version: "1.0.0" });
  const provider = createFakeProvider({
    example: { versions: { "1.1.0": { sourceRoot: path.join(remoteRoot, "1.1.0") } } },
    "codew-workspace-guard": { versions: { "9.0.0": { sourceRoot: path.join(remoteRoot, "9.0.0") } } },
  });
  const store = temporaryRoot();
  t.after(() => {
    fs.rmSync(extensionsRoot, { recursive: true, force: true });
    fs.rmSync(remoteRoot, { recursive: true, force: true });
    fs.rmSync(store, { recursive: true, force: true });
  });

  const choices = await listRegistryExtensionChoices({
    extensionsRoot,
    storeRoot: store,
    provider,
  });
  const example = choices.find((entry) => entry.id === "example");
  assert.equal(example.version, "1.1.0");
  assert.equal(example.source, "nexus");
  assert.equal(example.available, true);
  assert(!choices.some((entry) => entry.id === "example-system"));

  const selected = await collectRegistryExtensionInstallSelection(choices, emptyExtensionState(), {
    ui: {
      intro() {},
      close() {},
      multiselect: async (label, entries) => entries.filter((entry) => !entry.disabled).map((entry) => entry.value),
    },
  });
  assert.deepEqual(selected, ["example"]);

  const noRegistryHome = temporaryRoot();
  t.after(() => fs.rmSync(noRegistryHome, { recursive: true, force: true }));
  const localChoices = await listRegistryExtensionChoices({
    extensionsRoot,
    storeRoot: temporaryRoot(),
    home: noRegistryHome,
  });
  assert.deepEqual(localChoices, []);

});
