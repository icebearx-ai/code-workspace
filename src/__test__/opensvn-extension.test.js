const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const ROOT = path.resolve(__dirname, "..", "..");
const EXTENSION_ROOT = path.join(ROOT, "extensions", "zhuiyi-opensvn-mcp", "0.1.0");
const manifest = JSON.parse(fs.readFileSync(path.join(EXTENSION_ROOT, "manifest.json"), "utf8"));
const release = require(path.join(EXTENSION_ROOT, "release.json"));
const { validateManifest } = require("../core/extensions");
const { validatePackage, prepareRelease } = require(path.join(EXTENSION_ROOT, "lib", "archive.js"));

test("OpenSVN manifest and release metadata match the pinned package", () => {
  const validated = validateManifest(manifest, { protectedTargets: new Set() });
  assert.equal(validated.id, "zhuiyi-opensvn-mcp");
  assert.deepEqual(validated.outputs.map((output) => output.kind), ["directory", "text-block", "json-member"]);
  assert.equal(validated.outputs[0].target, ".code-workspace/extensions/zhuiyi-opensvn-mcp/0.1.0");
  assert.deepEqual(validated.capabilities.networkHosts, ["gitee.com"]);
  assert.equal(release.url, "https://gitee.com/liutaigang/zhuiyi-opensvn-mcp/repository/archive/0.1.0.tar.gz");
  assert.equal(release.root, "zhuiyi-opensvn-mcp-0.1.0");
  assert.equal(release.entry, "dist/index.js");
  assert.equal(release.package.name, "zhuiyi-opensvn-mcp");
  assert.equal(release.package.version, "0.1.0");
  assert.match(release.sha256, /^[a-f0-9]{64}$/);
});

test("OpenSVN Agent artifacts use the documented runtime contract without credentials", () => {
  const codex = fs.readFileSync(path.join(EXTENSION_ROOT, "artifacts", "codex", "config.toml"), "utf8");
  assert.match(codex, /mcp_servers\.zhuiyi_opensvn/);
  assert.match(codex, /SVN_AUTHORIZATION = ""/);
  assert.match(codex, /SVN_OUTPUT_DIR = "\."/);
  assert.match(codex, /SVN_MAX_RESOURCES = "200"/);
  assert.match(codex, /SVN_ALLOWED_HOSTS = "opssvn\.in\.wezhuiyi\.com"/);
  const claude = JSON.parse(fs.readFileSync(path.join(EXTENSION_ROOT, "artifacts", "claude", "server.json"), "utf8"));
  assert.deepEqual(claude.args, [".code-workspace/extensions/zhuiyi-opensvn-mcp/0.1.0/dist/index.js"]);
  assert.equal(claude.env.SVN_AUTHORIZATION, "");
  assert.equal(claude.env.SVN_OUTPUT_DIR, ".");
  assert.equal(claude.env.SVN_ALLOWED_HOSTS, "opssvn.in.wezhuiyi.com");
});

test("real Gitee OpenSVN release matches the pinned archive and package contract", { skip: process.env.CODE_WORKSPACE_OPENSVN_E2E !== "1" }, async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "code-workspace-opensvn-e2e-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const result = await prepareRelease(release, path.join(root, "runtime"));
  assert.equal(result.sha256, release.sha256);
  validatePackage(path.join(root, "runtime"), release);
});
