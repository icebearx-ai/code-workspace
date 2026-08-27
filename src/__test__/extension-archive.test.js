const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const zlib = require("node:zlib");

const JIRA_EXTENSION_ROOT = path.resolve(__dirname, "..", "..", "extensions", "zhuiyi-jira-mcp", "0.1.0");
const release = require(path.join(JIRA_EXTENSION_ROOT, "release.json"));
const {
  download,
  extractTarGz,
  prepareRelease,
  safeRelativePath,
  validatePackage,
} = require(path.join(JIRA_EXTENSION_ROOT, "lib", "archive.js"));
const {
  applyExtensionUninstall,
  discoverExtensions,
  emptyExtensionState,
  executeExtension,
  loadExtensionState,
  planExtensionUninstall,
  resolveExtensionPlans,
  validateManifest,
  verifyExtensionOutput,
} = require("../core/extensions");
const { sha256 } = require("../core/fs");

function temporaryRoot(prefix = "code-workspace-jira-extension-test-") {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function octal(value, length) {
  return `${value.toString(8).padStart(length - 1, "0")}\0`;
}

function tarEntry(name, content = Buffer.alloc(0), type = "0", link = "") {
  const body = Buffer.isBuffer(content) ? content : Buffer.from(content);
  const header = Buffer.alloc(512);
  header.write(name, 0, 100, "utf8");
  header.write(octal(type === "5" ? 0o755 : 0o644, 8), 100, 8, "ascii");
  header.write(octal(0, 8), 108, 8, "ascii");
  header.write(octal(0, 8), 116, 8, "ascii");
  header.write(octal(type === "0" ? body.length : 0, 12), 124, 12, "ascii");
  header.write(octal(0, 12), 136, 12, "ascii");
  header.fill(0x20, 148, 156);
  header.write(type, 156, 1, "ascii");
  if (link) header.write(link, 157, 100, "utf8");
  header.write("ustar\0", 257, 6, "ascii");
  header.write("00", 263, 2, "ascii");
  let checksum = 0;
  for (const byte of header) checksum += byte;
  header.write(`${checksum.toString(8).padStart(6, "0")}\0 `, 148, 8, "ascii");
  return Buffer.concat([header, body, Buffer.alloc((512 - body.length % 512) % 512)]);
}

function writeArchive(entries) {
  const file = path.join(temporaryRoot(), "fixture.tar.gz");
  fs.writeFileSync(file, zlib.gzipSync(Buffer.concat([...entries, Buffer.alloc(1024)])));
  return file;
}

function packageArchive(options = {}) {
  const packageName = options.packageName || release.package.name;
  const packageVersion = options.packageVersion || release.package.version;
  return writeArchive([
    tarEntry(`${release.root}/`, "", "5"),
    tarEntry(`${release.root}/package.json`, `${JSON.stringify({ name: packageName, version: packageVersion })}\n`),
    tarEntry(`${release.root}/dist/`, "", "5"),
    tarEntry(`${release.root}/dist/index.js`, "process.exitCode = 0;\n"),
    tarEntry(`${release.root}/node_modules/`, "", "5"),
    tarEntry(`${release.root}/node_modules/zod/`, "", "5"),
    tarEntry(`${release.root}/node_modules/zod/package.json`, '{"name":"zod"}\n'),
  ]);
}

function jiraRepository() {
  const repository = temporaryRoot("code-workspace-jira-repository-");
  const versionRoot = path.join(repository, "zhuiyi-jira-mcp", "0.1.0");
  fs.cpSync(JIRA_EXTENSION_ROOT, versionRoot, { recursive: true });
  fs.writeFileSync(path.join(versionRoot, "lib", "archive.js"), [
    'const fs = require("node:fs");',
    'const path = require("node:path");',
    'async function prepareRelease(_release, outputRoot) {',
    '  fs.mkdirSync(path.join(outputRoot, "dist"), { recursive: true });',
    '  fs.mkdirSync(path.join(outputRoot, "node_modules", "zod"), { recursive: true });',
    '  fs.writeFileSync(path.join(outputRoot, "package.json"), JSON.stringify({ name: "zhuiyi-jira-mcp", version: "0.1.0" }) + "\\n");',
    '  fs.writeFileSync(path.join(outputRoot, "dist", "index.js"), "process.exitCode = 0;\\n");',
    '  fs.writeFileSync(path.join(outputRoot, "node_modules", "zod", "package.json"), "{\\"name\\":\\"zod\\"}\\n");',
    '}',
    'module.exports = { prepareRelease };',
    '',
  ].join("\n"));
  return repository;
}

function jiraPlan(tools = ["codex", "claude"]) {
  const repository = jiraRepository();
  const catalog = discoverExtensions({ extensionsRoot: repository });
  return resolveExtensionPlans(catalog, ["zhuiyi-jira-mcp"], { tools, state: emptyExtensionState() })[0];
}

function context(plan, tools = ["codex", "claude"]) {
  return {
    schemaVersion: 1,
    extensionSpecVersion: plan.extensionSpecVersion,
    extension: { id: plan.id, version: plan.version },
    workspace: { name: "test", uuid: "123e4567-e89b-42d3-a456-426614174000", language: "zh-CN" },
    tools,
  };
}

test("Jira manifest declares only generic outputs while private release metadata freezes download constraints", () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(JIRA_EXTENSION_ROOT, "manifest.json"), "utf8"));
  const validated = validateManifest(manifest, { protectedTargets: new Set() });
  assert.deepEqual(validated.outputs.map((output) => output.kind), ["directory", "text-block", "text-block", "json-member"]);
  assert.equal(validated.outputs.find((output) => output.id === "gitignore").target, ".gitignore");
  assert.deepEqual(validated.capabilities.networkHosts, ["gitee.com", "raw.giteeusercontent.com"]);
  assert.equal(release.url, "https://gitee.com/liutaigang/zhuiyi-jira-mcp/raw/master/release/zhuiyi-jira-mcp-0.1.0.tar.gz");
  assert.equal(release.sha256, "74785207a75d1f7ea74ea893533835720baed016509ef4401c9b20f3b59a4afa");
  assert.equal(release.package.name, "zhuiyi-jira-mcp");
  assert.equal(release.package.version, "0.1.0");
  assert.equal(release.entry, "dist/index.js");
  assert.deepEqual(release.allowedHosts, validated.capabilities.networkHosts);
});

test("Jira private archive extraction materializes safe internal links and rejects unsafe entries", () => {
  const safe = writeArchive([
    tarEntry("package/", "", "5"),
    tarEntry("package/bin/", "", "5"),
    tarEntry("package/lib/", "", "5"),
    tarEntry("package/lib/run.js", "ok\n"),
    tarEntry("package/bin/run", "", "2", "../lib/run.js"),
  ]);
  const output = temporaryRoot();
  extractTarGz(safe, output, { root: "package", maxFiles: 20, maxExtractBytes: 1024 });
  assert.equal(fs.lstatSync(path.join(output, "bin", "run")).isFile(), true);
  assert.equal(fs.readFileSync(path.join(output, "bin", "run"), "utf8"), "ok\n");

  for (const entries of [
    [tarEntry("package/../escape", "bad\n")],
    [tarEntry("package/device", "", "3")],
    [tarEntry("package/file", "one\n"), tarEntry("package/file", "two\n")],
    [tarEntry("other/file", "bad\n")],
  ]) {
    const archive = writeArchive(entries);
    assert.throws(() => extractTarGz(archive, temporaryRoot(), { root: "package", maxFiles: 20, maxExtractBytes: 1024 }), (error) => error.code === "JIRA_ARCHIVE_UNSAFE");
  }
  assert.throws(() => safeRelativePath("../escape"), (error) => error.code === "JIRA_ARCHIVE_UNSAFE");
});

test("Jira private release preparation verifies hash, package identity, entry, and limits", async () => {
  const archive = packageArchive();
  const archiveBytes = fs.readFileSync(archive);
  const digest = sha256(archiveBytes);
  const output = temporaryRoot();
  const prepared = await prepareRelease({ ...release, sha256: digest }, output, {
    archiveFile: archive,
    downloaded: { bytes: archiveBytes.length, sha256: digest, finalUrl: release.url },
  });
  assert.equal(prepared.sha256, digest);
  assert(fs.existsSync(path.join(output, "dist", "index.js")));
  validatePackage(output, release);

  await assert.rejects(prepareRelease(release, temporaryRoot(), {
    archiveFile: archive,
    downloaded: { bytes: archiveBytes.length, sha256: "0".repeat(64), finalUrl: release.url },
  }), (error) => error.code === "JIRA_ARCHIVE_HASH_MISMATCH");

  const wrongPackage = packageArchive({ packageVersion: "9.9.9" });
  const wrongBytes = fs.readFileSync(wrongPackage);
  await assert.rejects(prepareRelease({ ...release, sha256: sha256(wrongBytes) }, temporaryRoot(), {
    archiveFile: wrongPackage,
    downloaded: { bytes: wrongBytes.length, sha256: sha256(wrongBytes), finalUrl: release.url },
  }), (error) => error.code === "JIRA_PACKAGE_INVALID");

  assert.throws(() => extractTarGz(archive, temporaryRoot(), { ...release, maxFiles: 1 }), (error) => error.code === "JIRA_ARCHIVE_TOO_LARGE");
  await assert.rejects(download("http://example.invalid/archive.tar.gz", path.join(temporaryRoot(), "archive"), release), (error) => error.code === "JIRA_DOWNLOAD_FAILED");
  await assert.rejects(download("https://example.invalid/archive.tar.gz", path.join(temporaryRoot(), "archive"), release), (error) => error.code === "JIRA_DOWNLOAD_HOST_FORBIDDEN");
});

test("Jira release preparation removes its managed archive before Host staging verification", async () => {
  const archive = packageArchive();
  const archiveBytes = fs.readFileSync(archive);
  const digest = sha256(archiveBytes);
  const staging = temporaryRoot();
  const runtime = path.join(staging, "runtime");
  const managedArchive = path.join(staging, "zhuiyi-jira-mcp.tar.gz");
  fs.copyFileSync(archive, managedArchive);

  await prepareRelease({ ...release, sha256: digest }, runtime, {
    downloaded: { bytes: archiveBytes.length, sha256: digest, finalUrl: release.url },
  });

  assert.equal(fs.existsSync(managedArchive), false);
  const plan = {
    id: "zhuiyi-jira-mcp",
    version: "0.1.0",
    extensionSpecVersion: 1,
    artifacts: [{
      id: "runtime",
      kind: "directory",
      ownership: "exclusive",
      target: ".code-workspace/extensions/zhuiyi-jira-mcp/0.1.0",
    }],
  };
  const result = {
    schemaVersion: 1,
    extensionSpecVersion: 1,
    extension: { id: "zhuiyi-jira-mcp", version: "0.1.0" },
    outputs: [{ id: "runtime", source: "runtime" }],
  };
  assert.equal(verifyExtensionOutput(staging, result, plan).length, 1);
});

test("Jira init installs a generic runtime directory and shared Codex and Claude contributions", () => {
  const plan = jiraPlan();
  const root = temporaryRoot();
  fs.writeFileSync(path.join(root, ".gitignore"), "dist/\n");
  fs.writeFileSync(path.join(root, ".mcp.json"), `${JSON.stringify({ custom: true, mcpServers: { existing: { command: "existing" } } }, null, 2)}\n`);
  const result = executeExtension(root, plan, context(plan));
  assert.equal(result.status, "installed");
  assert(fs.existsSync(path.join(root, ".code-workspace", "extensions", "zhuiyi-jira-mcp", "0.1.0", "dist", "index.js")));
  const codex = fs.readFileSync(path.join(root, ".codex", "config.toml"), "utf8");
  assert.match(codex, /mcp_servers\.zhuiyi-jira/);
  assert.match(codex, /JIRA_COOKIE = ""/);
  assert.match(codex, /JIRA_ATTACHMENT_ALLOWED_TYPES = "pdf,png,jpg,jpeg,gif,webp,txt,md,csv,json,xml,doc,docx,xls,xlsx,ppt,pptx,html"/);
  assert.doesNotMatch(codex, /JIRA_TOKEN/);
  const claude = JSON.parse(fs.readFileSync(path.join(root, ".mcp.json"), "utf8"));
  assert.equal(claude.custom, true);
  assert.equal(claude.mcpServers.existing.command, "existing");
  assert.equal(claude.mcpServers["zhuiyi-jira"].command, "node");
  assert.equal(claude.mcpServers["zhuiyi-jira"].env.JIRA_COOKIE, "");
  assert.equal(claude.mcpServers["zhuiyi-jira"].env.JIRA_ATTACHMENT_ALLOWED_TYPES, "pdf,png,jpg,jpeg,gif,webp,txt,md,csv,json,xml,doc,docx,xls,xlsx,ppt,pptx,html");
  const gitignore = fs.readFileSync(path.join(root, ".gitignore"), "utf8");
  assert.match(gitignore, /^dist\/$/m);
  assert.match(gitignore, /BEGIN code-workspace-extension:zhuiyi-jira-mcp:gitignore/);
  assert.match(gitignore, /^\/\.jira-attachments\/$/m);
  const installed = loadExtensionState(root).extensions[plan.id].installed;
  assert.equal(installed.protocolVersion, 3);
  assert.equal(installed.extensionSpecVersion, 1);
  assert.deepEqual(installed.artifacts.map((artifact) => artifact.kind), ["directory", "text-block", "text-block", "json-member"]);
  assert.equal(executeExtension(root, plan, context(plan)).status, "skipped");

  fs.mkdirSync(path.join(root, ".jira-attachments"));
  fs.writeFileSync(path.join(root, ".jira-attachments", "retained.txt"), "user data\n");
  assert.equal(applyExtensionUninstall(planExtensionUninstall(root, plan.id)).status, "uninstalled");
  assert.equal(fs.existsSync(path.join(root, ".code-workspace", "extensions", "zhuiyi-jira-mcp", "0.1.0")), false);
  assert.equal(fs.readFileSync(path.join(root, ".jira-attachments", "retained.txt"), "utf8"), "user data\n");
  const retainedIgnore = fs.readFileSync(path.join(root, ".gitignore"), "utf8");
  assert.match(retainedIgnore, /^dist\/$/m);
  assert.doesNotMatch(retainedIgnore, /code-workspace-extension:zhuiyi-jira-mcp:gitignore|\.jira-attachments/);
  const retained = JSON.parse(fs.readFileSync(path.join(root, ".mcp.json"), "utf8"));
  assert.equal(retained.custom, true);
  assert.equal(retained.mcpServers.existing.command, "existing");
  assert.equal(retained.mcpServers["zhuiyi-jira"], undefined);
});

test("Jira uninstall rejects modified runtime or shared JSON contribution", () => {
  const runtimePlan = jiraPlan(["claude"]);
  const runtimeRoot = temporaryRoot();
  assert.equal(executeExtension(runtimeRoot, runtimePlan, context(runtimePlan, ["claude"])).status, "installed");
  fs.appendFileSync(path.join(runtimeRoot, ".code-workspace", "extensions", "zhuiyi-jira-mcp", "0.1.0", "dist", "index.js"), "// local\n");
  assert.throws(() => planExtensionUninstall(runtimeRoot, runtimePlan.id), (error) => error.code === "EXTENSION_ARTIFACT_MODIFIED");

  const jsonPlan = jiraPlan(["claude"]);
  const jsonRoot = temporaryRoot();
  assert.equal(executeExtension(jsonRoot, jsonPlan, context(jsonPlan, ["claude"])).status, "installed");
  const file = path.join(jsonRoot, ".mcp.json");
  const document = JSON.parse(fs.readFileSync(file, "utf8"));
  document.mcpServers["zhuiyi-jira"].command = "changed";
  fs.writeFileSync(file, `${JSON.stringify(document, null, 2)}\n`);
  assert.throws(() => planExtensionUninstall(jsonRoot, jsonPlan.id), (error) => error.code === "EXTENSION_JSON_MEMBER_MODIFIED");
  assert(fs.existsSync(path.join(jsonRoot, ".code-workspace", "extensions", "zhuiyi-jira-mcp", "0.1.0")));
});

test("Jira directory and shared configuration roll back together when state verification fails", () => {
  const plan = jiraPlan(["codex"]);
  const root = temporaryRoot();
  const result = executeExtension(root, plan, context(plan, ["codex"]), {
    injectFailure(stage) {
      if (stage === "after-state-save") throw new Error("injected state failure");
    },
  });
  assert.equal(result.status, "failed");
  assert.equal(fs.existsSync(path.join(root, ".code-workspace", "extensions", "zhuiyi-jira-mcp", "0.1.0")), false);
  assert.equal(fs.existsSync(path.join(root, ".codex", "config.toml")), false);
  assert.equal(loadExtensionState(root).extensions[plan.id].installed, null);
});

test("real Gitee Jira release matches the pinned archive and package contract", { skip: process.env.CODE_WORKSPACE_JIRA_E2E !== "1" }, async (t) => {
  const root = temporaryRoot("code-workspace-jira-e2e-");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const result = await prepareRelease(release, path.join(root, "runtime"));
  assert.equal(result.sha256, release.sha256);
  validatePackage(path.join(root, "runtime"), release);
});
