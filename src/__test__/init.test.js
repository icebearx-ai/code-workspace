const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const yaml = require("js-yaml");

const packageJson = require("../../package.json");

const { loadInitManifest, installWorkspaceDependencies } = require("../core/init");
const { collectWorkspaceSetup, initializeWorkspace } = require("../core/initializer");
const { createInitPlan } = require("../init/plan");
const { collectInitPlan } = require("../init/wizard");

function temporaryRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "code-workspace-init-"));
}

test("init manifest describes only workspace-owned assets", () => {
  const manifest = loadInitManifest();
  assert.equal(manifest.schemaVersion, 2);
  assert.equal(manifest.releaseVersion, packageJson.version);
  assert.deepEqual(manifest.tools, ["claude", "codex"]);
  assert.equal(manifest.sources.length, 2);
  assert.equal(manifest.managedFiles.length, 9);
  assert(manifest.sources.every((entry) => entry.kind === "asset"));
  assert(manifest.managedFiles.every((entry) => entry.desired.sha256.length === 64));
  assert.equal(manifest.resources, undefined);
});

test("init planning contains workspace settings without an upstream package plan", () => {
  const plan = createInitPlan({
    root: "/workspace",
    workspace: { name: "payments", uuid: "workspace-id" },
    tools: ["codex"],
    monitor: { enable: true, url: "http://127.0.0.1:3211" },
    language: "zh-CN",
  });
  assert.equal(plan.openspec, undefined);
  assert.equal(plan.language, "zh-CN");
  assert.deepEqual(plan.tools, ["codex"]);
});

test("interactive init collects and confirms a complete workspace plan before writing files", async () => {
  const root = temporaryRoot();
  const calls = [];
  const answers = {
    text: ["payments"],
    select: ["zh-CN"],
    multiselect: [["codex"]],
    confirm: [true, true],
  };
  const ui = {
    intro: () => calls.push("intro"),
    note: (title) => calls.push(title),
    text: async () => answers.text.shift(),
    select: async () => answers.select.shift(),
    multiselect: async () => answers.multiselect.shift(),
    confirm: async () => answers.confirm.shift(),
    close: (message) => calls.push(message),
  };
  const plan = await collectInitPlan(root, loadInitManifest(), { ui, nodeVersion: "24.0.0" });
  assert.equal(plan.workspace.name, "payments");
  assert.equal(plan.openspec, undefined);
  assert.equal(plan.language, "zh-CN");
  assert.deepEqual(plan.tools, ["codex"]);
  assert.equal(plan.monitor.enable, true);
  assert(calls.includes("Ready to initialize"));
  assert(!fs.existsSync(path.join(root, ".code-workspace")));
});

test("interactive init offers independent Claude Code and Codex selections", async () => {
  const root = temporaryRoot();
  let offered = null;
  const ui = {
    intro() {},
    note() {},
    text: async () => "payments",
    select: async (_label, choices) => choices[0].value,
    multiselect: async (label, choices, initialValues) => {
      offered = { label, choices, initialValues };
      return ["claude", "codex"];
    },
    confirm: async () => true,
    close() {},
  };
  const plan = await collectInitPlan(root, loadInitManifest(), { ui });
  assert.deepEqual(offered.choices, [
    { value: "claude", label: "Claude Code" },
    { value: "codex", label: "Codex" },
  ]);
  assert.deepEqual(offered.initialValues, ["claude", "codex"]);
  assert.deepEqual(plan.tools, ["claude", "codex"]);
});

test("interactive init reads a v1 workspace through the legacy language compatibility path", async () => {
  const root = temporaryRoot();
  fs.mkdirSync(path.join(root, ".code-workspace"), { recursive: true });
  fs.writeFileSync(path.join(root, ".code-workspace", "config.yaml"), [
    "schemaVersion: 1",
    "workspace:",
    "  name: legacy-interactive",
    "  uuid: 123e4567-e89b-42d3-a456-426614174000",
    "monitor:",
    "  enable: false",
    "projects: []",
    "",
  ].join("\n"));
  fs.writeFileSync(path.join(root, ".code-workspace", "state.json"), `${JSON.stringify({ workspaceLanguage: "zh-CN" }, null, 2)}\n`);
  const ui = {
    intro() {},
    note() {},
    text: async () => { throw new Error("existing workspace name should be reused"); },
    select: async (_label, choices, initialIndex) => choices[initialIndex].value,
    multiselect: async () => { throw new Error("explicit tools should be reused"); },
    confirm: async () => true,
    close() {},
  };
  const plan = await collectInitPlan(root, loadInitManifest(), { ui, tools: ["codex"] });
  assert.equal(plan.workspace.name, "legacy-interactive");
  assert.equal(plan.language, "zh-CN");
  assert.deepEqual(plan.tools, ["codex"]);
});

test("new Codex workspaces enable monitoring by default and allow opt-out", async () => {
  const enabled = await collectWorkspaceSetup(temporaryRoot(), { tools: ["codex"], interactive: false });
  assert.equal(enabled.monitor.enable, true);
  assert.equal(enabled.workspace.language, "zh-CN");
  const disabled = await collectWorkspaceSetup(temporaryRoot(), { tools: ["codex"], monitor: false, interactive: false });
  assert.equal(disabled.monitor.enable, false);
  const withoutCodex = await collectWorkspaceSetup(temporaryRoot(), { tools: ["claude"], interactive: false });
  assert.equal(withoutCodex.monitor.enable, false);
});

test("workspace dependency installation only runs for a tool source checkout", () => {
  const root = temporaryRoot();
  fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ name: "unrelated-project" }));
  const skipped = installWorkspaceDependencies(root, { run: () => { throw new Error("must not run"); } });
  assert.equal(skipped.action, "skip");

  fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ name: packageJson.name }));
  const calls = [];
  const installed = installWorkspaceDependencies(root, {
    run: (command, args, options) => {
      calls.push({ command, args, cwd: options.cwd });
      return { status: 0 };
    },
  });
  assert.equal(installed.action, "install");
  assert.deepEqual(calls, [{ command: "npm", args: ["install"], cwd: root }]);
});

test("workspace dependency installation verifies declared packages before reporting success", () => {
  const root = temporaryRoot();
  fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({
    name: packageJson.name,
    dependencies: { "example-dependency": "1.0.0" },
  }));
  assert.throws(() => installWorkspaceDependencies(root, { run: () => ({ status: 0 }) }), /verification failed/);

  const installed = installWorkspaceDependencies(root, {
    run: () => {
      const directory = path.join(root, "node_modules", "example-dependency");
      fs.mkdirSync(directory, { recursive: true });
      fs.writeFileSync(path.join(directory, "package.json"), "{}");
      return { status: 0 };
    },
  });
  assert.equal(installed.verified, true);
  assert.deepEqual(installed.retainedPaths, ["node_modules"]);
});

test("workspace dependency installation reports retained roots when npm fails after writing", () => {
  const root = temporaryRoot();
  fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({
    name: packageJson.name,
    dependencies: { "example-dependency": "1.0.0" },
  }));
  let failure;
  assert.throws(() => installWorkspaceDependencies(root, {
    run: () => {
      fs.mkdirSync(path.join(root, "node_modules"), { recursive: true });
      fs.writeFileSync(path.join(root, "package-lock.json"), "{}\n");
      throw new Error("injected npm failure");
    },
  }), (error) => {
    failure = error;
    return error.code === "WORKSPACE_DEPENDENCY_INSTALL_FAILED";
  });
  const effect = failure.details.effects.retained[0];
  assert.equal(effect.status, "applied");
  assert.deepEqual(effect.targets, ["node_modules", "package-lock.json"]);
});

test("initializer rejects unsupported Node versions before mutating the target", async () => {
  const root = temporaryRoot();
  await assert.rejects(
    initializeWorkspace(root, { nodeVersion: "18.0.0", tools: [], interactive: false }),
    /Node 20\.19\.0 or newer/
  );
  assert(!fs.existsSync(path.join(root, ".code-workspace")));
});

test("non-interactive init migrates legacy state without consulting openspec files", async () => {
  const root = temporaryRoot();
  const openspecFile = path.join(root, "openspec", "config.yaml");
  fs.mkdirSync(path.dirname(openspecFile), { recursive: true });
  fs.writeFileSync(openspecFile, "schema: user-owned\nlanguage: intentionally-ignored\n");
  fs.mkdirSync(path.join(root, ".code-workspace"), { recursive: true });
  fs.writeFileSync(path.join(root, ".code-workspace", "config.yaml"), [
    "workspace:",
    "  name: legacy-yes",
    "  uuid: 123e4567-e89b-42d3-a456-426614174000",
    "monitor:",
    "  enable: false",
    "projects: []",
    "",
  ].join("\n"));
  fs.writeFileSync(path.join(root, ".code-workspace", "state.json"), `${JSON.stringify({ workspaceLanguage: "zh-CN" }, null, 2)}\n`);

  const result = await initializeWorkspace(root, {
    nodeVersion: "24.0.0",
    tools: [],
    interactive: false,
    run: (command) => { throw new Error(`unexpected command: ${command}`); },
  });
  assert.equal(result.migration.schema.fromVersion, 0);
  assert.equal(result.migration.language.source, "legacy-state");
  assert(result.migration.steps.some((step) => step.kind === "workspace-language"));
  const config = yaml.load(fs.readFileSync(path.join(root, ".code-workspace", "config.yaml"), "utf8"));
  assert.equal(config.schemaVersion, 2);
  assert.equal(config.workspace.language, "zh-CN");
  const state = JSON.parse(fs.readFileSync(path.join(root, ".code-workspace", "state.json"), "utf8"));
  assert.equal(state.workspaceLanguage, undefined);
  assert.deepEqual(state.tools, []);
  assert.equal(fs.readFileSync(openspecFile, "utf8"), "schema: user-owned\nlanguage: intentionally-ignored\n");
});

test("initializer neither invokes an openspec executable nor creates an openspec directory", async () => {
  const root = temporaryRoot();
  await initializeWorkspace(root, {
    nodeVersion: "24.0.0",
    tools: [],
    interactive: false,
    run: (command) => { throw new Error(`unexpected command: ${command}`); },
  });
  assert.equal(fs.existsSync(path.join(root, "openspec")), false);
});

test("initializer rolls back workspace-owned files after a local stage failure", async () => {
  const root = temporaryRoot();
  let failure;
  await assert.rejects(
    initializeWorkspace(root, {
      nodeVersion: "24.0.0",
      tools: [],
      interactive: false,
      onStage: (name) => {
        if (name === "Prepare local workspace configuration") throw new Error("injected workspace failure");
      },
    }),
    (error) => {
      failure = error;
      return /injected workspace failure/.test(error.message);
    }
  );
  assert.equal(fs.existsSync(path.join(root, "USER_GUIDE.md")), false);
  assert.equal(fs.existsSync(path.join(root, ".code-workspace")), false);
  assert.equal(fs.existsSync(path.join(root, "openspec")), false);
  assert.equal(failure.details.workspaceRolledBack, true);
  assert.equal(failure.details.externalEffects, undefined);
});
