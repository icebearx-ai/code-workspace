const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");

const { inspectExtensionTransportTarball } = require("../core/extension-package");
const { parse } = require("../cli/parser");

const cli = path.resolve(__dirname, "..", "..", "bin", "code-workspace.js");

function temporaryRoot(prefix = "code-workspace-scaffold-") {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function run(args, cwd) {
  const result = spawnSync(process.execPath, [cli, ...args], { cwd, encoding: "utf8" });
  return { ...result, envelope: result.stdout ? JSON.parse(result.stdout) : null };
}

test("extension init creates a capability-neutral package shell", async () => {
  const root = temporaryRoot();
  const source = path.join(root, "example-extension");
  const output = path.join(root, "dist");
  try {
    const created = run(["extension", "init", source, "--yes", "--json"], root);
    assert.equal(created.status, 0);
    assert.equal(created.envelope.command, "extension.init");
    assert.equal(created.envelope.data.action, "created");
    assert.deepEqual(["package.json", "extension/manifest.json", "extension/init.js"].sort(), created.envelope.data.files);
    assert.deepEqual(fs.readdirSync(source).sort(), ["extension", "package.json"]);
    const shellManifest = JSON.parse(fs.readFileSync(path.join(source, "extension", "manifest.json"), "utf8"));
    assert.equal(shellManifest.outputs, undefined);
    assert.equal(shellManifest.hooks, undefined);
    assert.equal(shellManifest.runtime, undefined);
    const incomplete = run(["extension", "pack", source, "--output", output, "--json"], root);
    assert.equal(incomplete.status, 1);
    assert.equal(incomplete.envelope.diagnostics[0].code, "EXTENSION_MANIFEST_INVALID");
    shellManifest.outputs = [{ id: "generated-output", kind: "file", ownership: "exclusive", target: "generated/example-extension.md" }];
    fs.writeFileSync(path.join(source, "extension", "manifest.json"), `${JSON.stringify(shellManifest, null, 2)}\n`);
    assert.equal(run(["extension", "digest", "update", source, "--yes", "--json"], root).status, 0);
    const packed = run(["extension", "pack", source, "--output", output, "--json"], root);
    assert.equal(packed.status, 0);
    assert.deepEqual(packed.envelope.data.tarball.files, [
      "package/package.json",
      "package/extension/init.js",
      "package/extension/manifest.json",
    ]);
    const verified = await inspectExtensionTransportTarball(packed.envelope.data.tarball.path);
    assert.equal(verified.envelope.name, "@codew-ext/example-extension");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("extension digest update refreshes entry and package digests and is idempotent", () => {
  const root = temporaryRoot();
  const source = path.join(root, "digest-extension");
  try {
    assert.equal(run(["extension", "init", source, "--yes", "--json"], root).status, 0);
    const entry = path.join(source, "extension", "init.js");
    fs.appendFileSync(entry, "\n// changed\n");
    const updated = run(["extension", "digest", "update", source, "--yes", "--json"], root);
    assert.equal(updated.status, 0);
    assert.equal(updated.envelope.data.action, "updated");
    assert.deepEqual(updated.envelope.data.updatedFiles, ["extension/manifest.json", "package.json"]);
    const repeated = run(["extension", "digest", "update", source, "--yes", "--json"], root);
    assert.equal(repeated.status, 0);
    assert.equal(repeated.envelope.data.action, "skip");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("extension pack rejects stale digests and suggests digest update", () => {
  const root = temporaryRoot();
  const source = path.join(root, "stale-extension");
  try {
    assert.equal(run(["extension", "init", source, "--yes", "--json"], root).status, 0);
    const manifestFile = path.join(source, "extension", "manifest.json");
    const manifest = JSON.parse(fs.readFileSync(manifestFile, "utf8"));
    manifest.outputs = [{ id: "generated-output", kind: "file", ownership: "exclusive", target: "generated/stale-extension.md" }];
    fs.writeFileSync(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`);
    assert.equal(run(["extension", "digest", "update", source, "--yes", "--json"], root).status, 0);
    fs.appendFileSync(path.join(source, "extension", "init.js"), "\n// stale\n");
    const result = run(["extension", "pack", source, "--output", path.join(root, "dist"), "--json"], root);
    assert.equal(result.status, 1);
    assert.equal(result.envelope.diagnostics[0].code, "EXTENSION_ENTRY_HASH_MISMATCH");
    assert.match(result.envelope.diagnostics[0].remediation, /digest update/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("extension init refuses a non-empty target without modifying it", () => {
  const root = temporaryRoot();
  const source = path.join(root, "occupied-extension");
  try {
    fs.mkdirSync(source, { recursive: true });
    fs.writeFileSync(path.join(source, "keep.txt"), "keep\n");
    const result = run(["extension", "init", source, "--yes", "--json"], root);
    assert.equal(result.status, 1);
    assert.equal(result.envelope.diagnostics[0].code, "EXTENSION_INIT_TARGET_EXISTS");
    assert.deepEqual(fs.readdirSync(source), ["keep.txt"]);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("extension scaffold commands have workspace-independent parser contracts", () => {
  const argv = (...tokens) => [process.execPath, "codew", ...tokens];
  assert.deepEqual(parse(argv("extension", "init", "./demo", "--id", "demo", "--yes")).args, ["./demo"]);
  assert.equal(parse(argv("extension", "digest", "update", "./demo", "--yes")).command.path.join(" "), "extension digest update");
  assert.throws(() => parse(argv("extension", "digest", "update", "a", "b")), (error) => error.code === "CLI_EXTRA_ARGUMENT");
  assert.throws(() => parse(argv("extension", "init", "./demo", "--unknown")), (error) => error.code === "CLI_UNKNOWN_OPTION");
});
