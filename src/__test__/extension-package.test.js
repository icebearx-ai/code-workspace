const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");
const tar = require("tar");

const { sha256 } = require("../core/fs");
const { directoryDigest } = require("../core/directory-digest");
const { inspectExtensionPackageDirectory } = require("../core/extensions");
const {
  EXTENSION_PACKAGE_PREFIX,
  buildExtensionTransportEnvelope,
  collectPackageFiles,
  extensionNpmPackageName,
  inspectExtensionTransportTarball,
  packExtensionToDirectory,
  validateExtensionTransportEnvelope,
} = require("../core/extension-package");

const cli = path.resolve(__dirname, "..", "..", "bin", "code-workspace.js");

function temporaryRoot(prefix = "code-workspace-extension-package-") {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function writeExtension(root, options = {}) {
  const id = options.id || "example-extension";
  const version = options.version || "1.0.0";
  const entry = options.entry === undefined ? "// packed but never executed\n" : options.entry;
  const manifest = {
    schemaVersion: 3,
    extensionSpecVersion: options.extensionSpecVersion || 1,
    experimental: true,
    id,
    name: options.name || "Example extension",
    description: options.description || "Example extension summary.",
    version,
    entry: "init.js",
    entrySha256: options.entrySha256 || sha256(Buffer.from(entry, "utf8")),
    timeoutMs: 1000,
    outputs: [{
      id: "example-output",
      kind: "file",
      ownership: "exclusive",
      target: options.target || `.example/${id}.txt`,
    }],
    ...(options.runtime ? { runtime: options.runtime } : {}),
  };
  fs.mkdirSync(root, { recursive: true });
  fs.writeFileSync(path.join(root, "init.js"), entry);
  fs.writeFileSync(path.join(root, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  if (options.extraFile) fs.writeFileSync(path.join(root, options.extraFile), options.extraContent || "extra\n");
  return { manifest, entry };
}

function outputEntries(root) {
  return fs.readdirSync(root, { withFileTypes: true }).map((entry) => entry.name).sort();
}

async function createTarballFromDirectory(source, outputFile, options = {}) {
  const staging = temporaryRoot("code-workspace-transport-stage-");
  try {
    const packageRoot = path.join(staging, "package");
    const extensionRoot = path.join(packageRoot, "extension");
    fs.mkdirSync(extensionRoot, { recursive: true });
    fs.cpSync(source, extensionRoot, { recursive: true });
    const inspected = inspectExtensionPackageDirectory(source);
    const envelope = options.envelope || buildExtensionTransportEnvelope(inspected);
    fs.writeFileSync(path.join(packageRoot, "package.json"), `${JSON.stringify(envelope, null, 2)}\n`);
    if (options.extraPath) fs.writeFileSync(path.join(packageRoot, options.extraPath), "extra\n");
    const files = [
      "package/package.json",
      ...collectPackageFiles(source).map((file) => `${EXTENSION_PACKAGE_PREFIX}/${file.relative}`),
      ...(options.extraPath ? [`package/${options.extraPath}`] : []),
    ];
    await tar.c({
      file: outputFile,
      cwd: staging,
      portable: false,
      mtime: new Date(0),
      noDirRecurse: true,
      jobs: 1,
      onWriteEntry(entry) {
        entry.uid = 0;
        entry.gid = 0;
        entry.uname = undefined;
        entry.gname = undefined;
      },
    }, files);
  } finally {
    fs.rmSync(staging, { recursive: true, force: true });
  }
}

test("extension pack creates a verified npm transport with the unchanged Extension digest", async () => {
  const source = temporaryRoot();
  const outputBase = temporaryRoot();
  const output = path.join(outputBase, "nested", "extensions");
  writeExtension(source);
  fs.mkdirSync(path.join(source, "assets"), { recursive: true });
  fs.writeFileSync(path.join(source, "assets", "asset.txt"), "asset\n");

  const result = await packExtensionToDirectory(source, output);
  assert.equal(result.npmName, "@codew-ext/example-extension");
  assert.equal(result.version, "1.0.0");
  assert.equal(result.packageSha256, directoryDigest(source));
  assert.match(result.tarball.integrity, /^sha512-[A-Za-z0-9+/]+={0,2}$/);
  assert.deepEqual(result.tarball.files, [
    "package/package.json",
    "package/extension/assets/asset.txt",
    "package/extension/init.js",
    "package/extension/manifest.json",
  ]);

  const verified = await inspectExtensionTransportTarball(result.tarball.path, {
  }).catch((error) => error);
  assert(!(verified instanceof Error), verified?.stack);
  assert.equal(verified.envelope.name, result.npmName);
  assert.equal(verified.envelope.codeWorkspace.packageSha256, result.packageSha256);
  assert.equal(verified.manifestSha256, result.manifestSha256);
  assert.equal(verified.entrySha256, result.entrySha256);
  assert.equal(verified.packageSha256, result.packageSha256);
  assert.deepEqual(outputEntries(output), ["codew-ext-example-extension-1.0.0.tgz"]);
  fs.rmSync(source, { recursive: true, force: true });
  fs.rmSync(outputBase, { recursive: true, force: true });
});

test("transport envelope rejects forbidden npm behavior and identity drift", () => {
  const source = temporaryRoot();
  writeExtension(source);
  const inspected = inspectExtensionPackageDirectory(source);
  const envelope = buildExtensionTransportEnvelope(inspected);
  assert.equal(envelope.name, extensionNpmPackageName(inspected.id));
  assert.equal(Object.hasOwn(envelope, "dependencies"), false);
  assert.equal(Object.hasOwn(envelope, "scripts"), false);

  const expected = {
    expectedId: inspected.id,
    expectedVersion: inspected.version,
    expectedExtensionSpecVersion: inspected.extensionSpecVersion,
    expectedPackageSha256: inspected.packageSha256,
  };
  const invalid = [
    { ...envelope, name: "@codew-ext/other-extension" },
    { ...envelope, version: "2.0.0" },
    { ...envelope, codeWorkspace: { ...envelope.codeWorkspace, extensionSpecVersion: 2 } },
    { ...envelope, codeWorkspace: { ...envelope.codeWorkspace, packageSha256: "a".repeat(64) } },
    { ...envelope, dependencies: { express: "5.0.0" } },
    { ...envelope, scripts: { install: "node extension/init.js" } },
  ];
  for (const value of invalid) {
    assert.throws(() => validateExtensionTransportEnvelope(value, expected), (error) =>
      error.code === "EXTENSION_NPM_IDENTITY_MISMATCH" ||
      error.code === "EXTENSION_NPM_PACKAGE_DIGEST_MISMATCH" ||
      error.code === "EXTENSION_NPM_ENVELOPE_FORBIDDEN_FIELD"
    );
  }
  fs.rmSync(source, { recursive: true, force: true });
});

test("extension pack rejects invalid manifests, entries, and unsupported Extension Specs", async () => {
  const cases = [
    { options: { entrySha256: "b".repeat(64) }, code: "EXTENSION_ENTRY_HASH_MISMATCH" },
    { options: { extensionSpecVersion: 2 }, code: "EXTENSION_SPEC_UNSUPPORTED" },
  ];
  for (const testCase of cases) {
    const source = temporaryRoot();
    const outputBase = temporaryRoot();
    const output = path.join(outputBase, "nested", "extensions");
    writeExtension(source, testCase.options);
    await assert.rejects(packExtensionToDirectory(source, output), (error) => error.code === testCase.code);
    assert.equal(fs.existsSync(output), false);
    fs.rmSync(source, { recursive: true, force: true });
    fs.rmSync(outputBase, { recursive: true, force: true });
  }

  const missing = temporaryRoot();
  writeExtension(missing);
  fs.unlinkSync(path.join(missing, "init.js"));
  await assert.rejects(packExtensionToDirectory(missing, temporaryRoot()), (error) => error.code === "EXTENSION_ENTRY_MISSING");
  fs.rmSync(missing, { recursive: true, force: true });
});

test("extension pack rejects unsafe source file types and package limits", async (t) => {
  const symlinkSource = temporaryRoot();
  writeExtension(symlinkSource);
  fs.symlinkSync(path.join(symlinkSource, "init.js"), path.join(symlinkSource, "linked.js"));
  t.after(() => fs.rmSync(symlinkSource, { recursive: true, force: true }));
  await assert.rejects(packExtensionToDirectory(symlinkSource, temporaryRoot()), (error) => error.code === "EXTENSION_OUTPUT_SYMLINK");

  const hardlinkSource = temporaryRoot();
  writeExtension(hardlinkSource);
  fs.linkSync(path.join(hardlinkSource, "init.js"), path.join(hardlinkSource, "linked.js"));
  t.after(() => fs.rmSync(hardlinkSource, { recursive: true, force: true }));
  await assert.rejects(packExtensionToDirectory(hardlinkSource, temporaryRoot()), (error) => error.code === "EXTENSION_PACKAGE_HARDLINK");

  if (process.platform !== "win32") {
    const fifoSource = temporaryRoot();
    writeExtension(fifoSource);
    spawnSync("mkfifo", [path.join(fifoSource, "special")]);
    t.after(() => fs.rmSync(fifoSource, { recursive: true, force: true }));
    await assert.rejects(packExtensionToDirectory(fifoSource, temporaryRoot()), (error) => error.code === "EXTENSION_OUTPUT_INVALID");
  }

  for (const limits of [{ maxFiles: 1 }, { maxFileBytes: 2 }, { maxTotalBytes: 2 }]) {
    const source = temporaryRoot();
    const output = temporaryRoot();
    writeExtension(source, { extraFile: "extra.txt" });
    await assert.rejects(packExtensionToDirectory(source, output, { limits }), (error) => error.code.startsWith("EXTENSION_PACKAGE_"));
    assert.deepEqual(outputEntries(output), []);
    fs.rmSync(source, { recursive: true, force: true });
    fs.rmSync(output, { recursive: true, force: true });
  }
});

test("transport reader rejects layout drift, duplicate paths, unsafe paths, and digest drift", async (t) => {
  const source = temporaryRoot();
  writeExtension(source);
  t.after(() => fs.rmSync(source, { recursive: true, force: true }));
  const inspected = inspectExtensionPackageDirectory(source);

  const digestTarball = path.join(temporaryRoot(), "digest.tgz");
  await createTarballFromDirectory(source, digestTarball, {
    envelope: {
      ...buildExtensionTransportEnvelope(inspected),
      codeWorkspace: { ...buildExtensionTransportEnvelope(inspected).codeWorkspace, packageSha256: "a".repeat(64) },
    },
  });
  t.after(() => fs.rmSync(digestTarball, { force: true }));
  await assert.rejects(inspectExtensionTransportTarball(digestTarball), (error) => error.code === "EXTENSION_NPM_PACKAGE_DIGEST_MISMATCH");

  const extraTarball = path.join(temporaryRoot(), "extra.tgz");
  await createTarballFromDirectory(source, extraTarball, { extraPath: "unwanted.txt" });
  t.after(() => fs.rmSync(extraTarball, { force: true }));
  await assert.rejects(inspectExtensionTransportTarball(extraTarball), (error) => error.code === "EXTENSION_PACKAGE_LAYOUT_INVALID");

  const duplicateRoot = temporaryRoot();
  const duplicateTarball = path.join(duplicateRoot, "duplicate.tgz");
  const firstTar = path.join(duplicateRoot, "first.tar");
  const secondTar = path.join(duplicateRoot, "second.tar");
  await createTarballFromDirectory(source, firstTar);
  await tar.c({ file: secondTar, cwd: source, prefix: EXTENSION_PACKAGE_PREFIX, portable: false, mtime: new Date(0), sync: true }, ["manifest.json"]);
  await tar.r({ file: firstTar, sync: true }, [`@${secondTar}`]);
  fs.renameSync(firstTar, duplicateTarball);
  t.after(() => fs.rmSync(duplicateRoot, { recursive: true, force: true }));
  await assert.rejects(inspectExtensionTransportTarball(duplicateTarball), (error) => error.code === "EXTENSION_PACKAGE_PATH_DUPLICATE");

  const escapeRoot = temporaryRoot();
  const escapeTarball = path.join(escapeRoot, "escape.tgz");
  const work = path.join(escapeRoot, "work");
  fs.mkdirSync(work, { recursive: true });
  fs.writeFileSync(path.join(escapeRoot, "escaped.txt"), "outside\n");
  await createTarballFromDirectory(source, escapeTarball);
  await tar.r({
    file: escapeTarball,
    cwd: work,
    preservePaths: true,
    portable: false,
    mtime: new Date(0),
    sync: true,
  }, ["../escaped.txt"]);
  t.after(() => fs.rmSync(escapeRoot, { recursive: true, force: true }));
  await assert.rejects(inspectExtensionTransportTarball(escapeTarball), (error) => error.code === "EXTENSION_PACKAGE_LAYOUT_INVALID");
});

test("extension pack preserves existing outputs and cleans every failure stage", async () => {
  const source = temporaryRoot();
  const output = temporaryRoot();
  writeExtension(source);
  const target = path.join(output, "codew-ext-example-extension-1.0.0.tgz");
  fs.writeFileSync(target, "preserve me\n");
  await assert.rejects(packExtensionToDirectory(source, output), (error) => error.code === "EXTENSION_PACK_OUTPUT_EXISTS");
  assert.equal(fs.readFileSync(target, "utf8"), "preserve me\n");

  const failureCases = [
    {
      stage: "after-create",
      createTarball: async () => {
        throw new Error("disk full");
      },
      code: "EXTENSION_TARBALL_CREATE_FAILED",
    },
    {
      stage: "after-verify",
      inspectTarball: async () => {
        throw new Error("corrupt gzip");
      },
      code: "EXTENSION_TARBALL_VERIFY_FAILED",
    },
    {
      stage: "before-rename",
      injectFailure: undefined,
      renameFailure: true,
    },
  ];
  for (const testCase of failureCases) {
    const failureOutput = temporaryRoot();
    const options = {
      ...(testCase.createTarball ? { createTarball: testCase.createTarball } : {}),
      ...(testCase.inspectTarball ? { inspectTarball: testCase.inspectTarball } : {}),
      injectFailure(stage) {
        if (stage === testCase.stage) throw new Error(stage);
      },
    };
    await assert.rejects(packExtensionToDirectory(source, failureOutput, options), (error) =>
      error.code === "EXTENSION_PACK_FAILED" || error.code === testCase.code || error.message.includes(testCase.stage)
    );
    assert.deepEqual(outputEntries(failureOutput), []);
    fs.rmSync(failureOutput, { recursive: true, force: true });
  }

  fs.rmSync(source, { recursive: true, force: true });
  fs.rmSync(output, { recursive: true, force: true });
});

test("extension pack detects a source package changed during archive creation", async (t) => {
  const source = temporaryRoot();
  const output = temporaryRoot();
  writeExtension(source);
  t.after(() => {
    fs.rmSync(source, { recursive: true, force: true });
    fs.rmSync(output, { recursive: true, force: true });
  });
  const createTarball = async (input) => {
    fs.writeFileSync(path.join(input.sourceRoot, "changed.txt"), "changed\n");
    return writeTransportTarballForTest(input);
  };
  await assert.rejects(packExtensionToDirectory(source, output, { createTarball }), (error) => error.code === "EXTENSION_PACKAGE_CHANGED");
  assert.deepEqual(outputEntries(output), []);
});

async function writeTransportTarballForTest(input) {
  await createTarballFromDirectory(input.sourceRoot, input.target);
}

test("extension pack CLI is workspace-independent and reports stable JSON diagnostics", () => {
  const source = temporaryRoot();
  const output = temporaryRoot();
  writeExtension(source, { entrySha256: "b".repeat(64) });
  const result = spawnSync(process.execPath, [cli, "extension", "pack", source, "--output", output, "--json"], {
    cwd: temporaryRoot(),
    encoding: "utf8",
  });
  assert.equal(result.status, 1);
  const envelope = JSON.parse(result.stdout);
  assert.equal(envelope.command, "extension.pack");
  assert.equal(envelope.diagnostics[0].code, "EXTENSION_ENTRY_HASH_MISMATCH");
  assert.deepEqual(outputEntries(output), []);
  fs.rmSync(source, { recursive: true, force: true });
  fs.rmSync(output, { recursive: true, force: true });
});
