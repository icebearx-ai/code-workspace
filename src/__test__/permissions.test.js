const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");

const { saveConfig, saveState } = require("../core/config");
const { doctorWorkspace } = require("../core/doctor");
const { loadInitManifest } = require("../core/init");
const {
  applyPermissionPlan,
  permissionAdapters,
  planPermissionChanges,
  resolvePermissionAdapters,
} = require("../core/permissions");
const { render: renderCodex } = require("../core/permissions/codex");

const packageRoot = path.resolve(__dirname, "..", "..");
const cli = path.join(packageRoot, "bin", "code-workspace.js");

function temporaryRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "code-workspace-permissions-"));
}

function run(cwd, args) {
  return spawnSync(process.execPath, [cli, ...args], { cwd, encoding: "utf8" });
}

function write(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

function gitRepository(parent, name) {
  const directory = path.join(parent, name);
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, "package.json"), JSON.stringify({ name }));
  spawnSync("git", ["init", "-b", "main"], { cwd: directory, stdio: "ignore" });
  return fs.realpathSync(directory);
}

function workspaceConfig(projects = []) {
  return {
    schemaVersion: 2,
    workspace: { name: "permission-test", uuid: "123e4567-e89b-42d3-a456-426614174000", language: "en-US" },
    monitor: { enable: false, url: "http://127.0.0.1:3211" },
    projects,
  };
}

test("Codex and Claude adapters share grant and revoke semantics while preserving unrelated settings", () => {
  const root = temporaryRoot();
  const extra = path.join(root, "extra");
  const project = path.join(root, "project");
  write(path.join(root, ".codex", "config.toml"), `${renderCodex([extra])}\n# user setting\nmodel = "example"\n`);
  write(path.join(root, ".claude", "settings.local.json"), `${JSON.stringify({
    theme: "dark",
    permissions: { additionalDirectories: [extra], allow: ["Read"] },
  }, null, 2)}\n`);

  const grant = planPermissionChanges({ root, tools: ["claude", "codex"], grants: [project, project] });
  assert.equal(grant.action, "write");
  const result = applyPermissionPlan(grant);
  assert(result.tools.every((entry) => entry.verified));
  assert.deepEqual(result.tools.map((entry) => entry.granted), [[project], [project]]);
  assert.match(fs.readFileSync(path.join(root, ".codex", "config.toml"), "utf8"), /model = "example"/);
  assert.match(fs.readFileSync(path.join(root, ".codex", "config.toml"), "utf8"), new RegExp(project.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  const claude = JSON.parse(fs.readFileSync(path.join(root, ".claude", "settings.local.json"), "utf8"));
  assert.equal(claude.theme, "dark");
  assert.deepEqual(claude.permissions.allow, ["Read"]);
  assert.deepEqual(claude.permissions.additionalDirectories, [extra, project]);

  const repeated = planPermissionChanges({ root, tools: ["claude", "codex"], grants: [project] });
  assert.equal(repeated.action, "skip");
  assert(repeated.plans.every((entry) => entry.unchanged.includes(project)));

  applyPermissionPlan(planPermissionChanges({ root, tools: ["claude", "codex"], revokes: [project] }));
  const retainedClaude = JSON.parse(fs.readFileSync(path.join(root, ".claude", "settings.local.json"), "utf8"));
  assert.deepEqual(retainedClaude.permissions.additionalDirectories, [extra]);
  const retainedCodex = fs.readFileSync(path.join(root, ".codex", "config.toml"), "utf8");
  assert.match(retainedCodex, new RegExp(extra.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert(!retainedCodex.includes(project));
});

test("Claude adapter rejects invalid settings without changing the file or recording ownership", () => {
  const root = temporaryRoot();
  const file = path.join(root, ".claude", "settings.local.json");
  write(file, '{"permissions":{"additionalDirectories":"invalid"}}\n');
  const before = fs.readFileSync(file, "utf8");
  assert.throws(
    () => planPermissionChanges({ root, tools: ["claude"], grants: [path.join(root, "project")] }),
    (error) => error.code === "CLAUDE_PERMISSION_CONFIG_INVALID" && error.details.field === "permissions.additionalDirectories"
  );
  assert.equal(fs.readFileSync(file, "utf8"), before);
  assert.equal(fs.existsSync(path.join(root, ".code-workspace", "state.json")), false);
});

test("permission adapter registry rejects tools without directory authorization capability", () => {
  assert.throws(
    () => resolvePermissionAdapters(["future-agent"]),
    (error) => error.code === "WORKSPACE_PERMISSION_TOOL_UNSUPPORTED" && error.details.tool === "future-agent"
  );
  assert.deepEqual([...permissionAdapters.keys()], ["claude", "codex"]);
});

test("stale plans fail before any selected permission target is written", () => {
  const root = temporaryRoot();
  const claudeFile = path.join(root, ".claude", "settings.local.json");
  const codexFile = path.join(root, ".codex", "config.toml");
  write(claudeFile, "{}\n");
  write(codexFile, "# user codex config\n");
  const plan = planPermissionChanges({ root, tools: ["claude", "codex"], grants: [path.join(root, "project")] });
  write(claudeFile, '{"changed":true}\n');
  const codexBefore = fs.readFileSync(codexFile, "utf8");
  assert.throws(() => applyPermissionPlan(plan), (error) => error.code === "WORKSPACE_PERMISSION_PLAN_STALE" && error.details.tool === "claude");
  assert.equal(fs.readFileSync(codexFile, "utf8"), codexBefore);
  assert.equal(fs.readFileSync(claudeFile, "utf8"), '{"changed":true}\n');
});

test("multi-tool permission failure restores every target", () => {
  const root = temporaryRoot();
  const claudeFile = path.join(root, ".claude", "settings.local.json");
  const codexFile = path.join(root, ".codex", "config.toml");
  write(claudeFile, '{"user":true}\n');
  write(codexFile, "# user codex config\n");
  const beforeClaude = fs.readFileSync(claudeFile);
  const beforeCodex = fs.readFileSync(codexFile);
  const plan = planPermissionChanges({ root, tools: ["codex", "claude"], grants: [path.join(root, "project")] });
  assert.throws(() => applyPermissionPlan(plan, {
    atomicWrite(file, content) {
      write(file, file === claudeFile ? content.replace("additionalDirectories", "corruptedDirectories") : content);
    },
  }), (error) => error.code === "WORKSPACE_PERMISSION_VERIFY_FAILED");
  assert.deepEqual(fs.readFileSync(claudeFile), beforeClaude);
  assert.deepEqual(fs.readFileSync(codexFile), beforeCodex);
});

test("permissions apply uses one confirmation boundary and returns the common result", () => {
  const parent = temporaryRoot();
  const root = path.join(parent, "workspace");
  const project = gitRepository(parent, "service");
  fs.mkdirSync(root);
  assert.equal(run(root, ["init", ".", "--tools", "claude,codex", "--yes", "--json"]).status, 0);
  const config = workspaceConfig([{ name: "service", location: project, branch: "main", type: "backend", context: "service" }]);
  saveConfig(root, config);
  const unconfirmed = run(root, ["permissions", "apply", "--json"]);
  assert.equal(unconfirmed.status, 1);
  assert.equal(JSON.parse(unconfirmed.stdout).diagnostics[0].code, "CLI_CONFIRMATION_REQUIRED");
  assert.equal(fs.existsSync(path.join(root, ".claude", "settings.local.json")), false);
  assert.equal(fs.existsSync(path.join(root, ".codex", "config.toml")), false);

  const applied = run(root, ["permissions", "apply", "--yes", "--json"]);
  assert.equal(applied.status, 0, applied.stderr);
  const data = JSON.parse(applied.stdout).data;
  assert.deepEqual(data.requestedTools, ["claude", "codex"]);
  assert(data.tools.every((entry) => entry.verified === true));
  assert.deepEqual(data.tools.flatMap((entry) => entry.granted), [project, project]);
  const repeated = run(root, ["permissions", "apply", "--json"]);
  assert.equal(repeated.status, 0, repeated.stderr);
  assert.equal(JSON.parse(repeated.stdout).data.action, "skip");

  const removed = run(root, ["sync", "--json"]);
  assert.equal(removed.status, 1);
  assert.equal(JSON.parse(removed.stdout).diagnostics[0].code, "CLI_UNKNOWN_COMMAND");
});

test("project remove explicitly revokes both tools while preserving unrelated Claude authorization", () => {
  const parent = temporaryRoot();
  const root = path.join(parent, "workspace");
  const project = gitRepository(parent, "service");
  const extra = path.join(parent, "personal");
  fs.mkdirSync(root);
  assert.equal(run(root, ["init", ".", "--tools", "claude,codex", "--yes", "--json"]).status, 0);
  const input = path.join(parent, "project.json");
  write(input, JSON.stringify({ name: "service", location: project, branch: "main", type: "backend", context: "service" }));
  assert.equal(run(root, ["project", "add", "--project-file", input, "--yes", "--json"]).status, 0);
  const claudeFile = path.join(root, ".claude", "settings.local.json");
  const claude = JSON.parse(fs.readFileSync(claudeFile, "utf8"));
  claude.permissions.additionalDirectories.unshift(extra);
  write(claudeFile, `${JSON.stringify(claude, null, 2)}\n`);

  const removed = run(root, ["project", "remove", "service", "--yes", "--json"]);
  assert.equal(removed.status, 0, removed.stderr);
  assert.deepEqual(JSON.parse(fs.readFileSync(claudeFile, "utf8")).permissions.additionalDirectories, [extra]);
  assert(!fs.readFileSync(path.join(root, ".codex", "config.toml"), "utf8").includes(project));
});

test("re-init preserves extra authorization, update is neutral, and doctor reports only missing projects", () => {
  const parent = temporaryRoot();
  const root = path.join(parent, "workspace");
  const project = gitRepository(parent, "service");
  const extra = path.join(parent, "personal");
  fs.mkdirSync(root);
  assert.equal(run(root, ["init", ".", "--tools", "claude", "--yes", "--json"]).status, 0);
  saveConfig(root, workspaceConfig([{ name: "service", location: project, branch: "main", type: "backend", context: "service" }]));
  write(path.join(root, ".claude", "settings.local.json"), `${JSON.stringify({ permissions: { additionalDirectories: [extra] } }, null, 2)}\n`);
  assert.equal(run(root, ["init", ".", "--tools", "claude", "--yes", "--json"]).status, 0);
  const afterInit = fs.readFileSync(path.join(root, ".claude", "settings.local.json"), "utf8");
  assert.deepEqual(JSON.parse(afterInit).permissions.additionalDirectories, [extra, project]);

  const updated = run(root, ["update", "--tools", "claude,codex", "--json"]);
  assert.equal(updated.status, 0, updated.stderr);
  assert.equal(fs.readFileSync(path.join(root, ".claude", "settings.local.json"), "utf8"), afterInit);
  assert.equal(fs.existsSync(path.join(root, ".codex", "config.toml")), false);
  assert(JSON.parse(updated.stdout).diagnostics.some((entry) => entry.code === "WORKSPACE_PERMISSION_APPLY_REQUIRED"));

  const doctor = doctorWorkspace(root, loadInitManifest());
  const missing = doctor.diagnostics.filter((entry) => entry.code === "WORKSPACE_PERMISSION_MISSING");
  assert.equal(missing.length, 1);
  assert.equal(missing[0].tool, "codex");
  assert(!doctor.diagnostics.some((entry) => entry.directory === extra));
});
