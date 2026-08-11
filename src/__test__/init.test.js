const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const yaml = require("js-yaml");

const packageJson = require("../../package.json");

const {
  ensureOpenSpec,
  loadInitManifest,
  installWorkspaceDependencies,
  prepareOpenSpec,
} = require("../core/init");
const { collectWorkspaceSetup, initializeWorkspace } = require("../core/initializer");
const { createInitPlan, openSpecAction } = require("../init/plan");
const { collectInitPlan } = require("../init/wizard");

function temporaryRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "openspec-workspace-init-"));
}

function detectionRun(versionRef) {
  return (command, args) => {
    if (command === "npm" && args[0] === "list") {
      return { status: versionRef.value ? 0 : 1, stdout: JSON.stringify({ dependencies: versionRef.value ? { "@fission-ai/openspec": { version: versionRef.value } } : {} }) };
    }
    if (command === "openspec" && args[0] === "--version") {
      return { status: versionRef.value ? 0 : 1, stdout: versionRef.value || "" };
    }
    if (command === "npm" && args[0] === "install" && args[1] === "-g") {
      versionRef.value = args[2].split("@").at(-1);
      return { status: 0, stdout: "" };
    }
    throw new Error(`Unexpected command: ${command} ${args.join(" ")}`);
  };
}

test("init manifest validates package release and all artifact checksums", () => {
  const manifest = loadInitManifest();
  assert.equal(manifest.schemaVersion, 2);
  assert.equal(manifest.releaseVersion, packageJson.version);
  assert.equal(manifest.resources.openspec.selectedVersion, "1.5.0");
  assert.equal(manifest.sources.length, 4);
  assert.equal(manifest.managedFiles.length, 27);
  assert(manifest.managedFiles.every((entry) => entry.desired.sha256.length === 64));
});

test("OpenSpec detection skips a healthy supported installation", async () => {
  const version = { value: "1.5.0" };
  const result = await ensureOpenSpec(loadInitManifest().resources.openspec, {
    root: temporaryRoot(),
    run: detectionRun(version),
    interactive: false,
  });
  assert.equal(result.action, "skip");
  assert.equal(result.version, "1.5.0");
});

test("OpenSpec install verification failure reports the retained global package effect", async () => {
  let installed = false;
  let failure;
  await assert.rejects(ensureOpenSpec(loadInitManifest().resources.openspec, {
    root: temporaryRoot(),
    interactive: false,
    openspecVersion: "1.5.0",
    yes: true,
    run: (command, args) => {
      if (command === "npm" && args[0] === "list") {
        return {
          status: installed ? 0 : 1,
          stdout: JSON.stringify({ dependencies: installed ? { "@fission-ai/openspec": { version: "1.5.0" } } : {} }),
        };
      }
      if (command === "openspec" && args[0] === "--version") return { status: 0, stdout: "1.4.0" };
      if (command === "npm" && args[0] === "install") {
        installed = true;
        return { status: 0 };
      }
      throw new Error(`Unexpected command: ${command} ${args.join(" ")}`);
    },
  }), (error) => {
    failure = error;
    return error.code === "OPENSPEC_INSTALL_VERIFICATION_FAILED";
  });
  assert.equal(failure.details.effects.retained[0].kind, "global-package");
  assert.equal(failure.details.effects.retained[0].status, "applied");
  assert.equal(failure.details.effects.retained[0].requestedVersion, "1.5.0");
  assert.equal(failure.details.effects.retained[0].evidence.after.observed.commandVersion, "1.4.0");
});

test("init planning classifies exact OpenSpec version operations", () => {
  assert.equal(openSpecAction({ globalVersion: null, commandVersion: null }, "1.5.0"), "install");
  assert.equal(openSpecAction({ globalVersion: "1.5.0", commandVersion: "1.5.0" }, "1.5.0"), "skip");
  assert.equal(openSpecAction({ globalVersion: "1.4.0", commandVersion: "1.4.0" }, "1.5.0"), "switch");
  assert.equal(openSpecAction({ globalVersion: "1.5.0", commandVersion: "1.4.0" }, "1.5.0"), "repair");
  const plan = createInitPlan({
    root: "/workspace",
    workspace: { name: "payments", uuid: "workspace-id" },
    detected: { globalVersion: "1.4.0", commandVersion: "1.4.0" },
    selectedVersion: "1.5.0",
    tools: ["codex"],
    monitor: { enable: true, url: "http://127.0.0.1:3211" },
    language: "zh-CN",
  });
  assert.equal(plan.openspec.action, "switch");
  assert.equal(plan.openspec.selectedVersion, "1.5.0");
  assert.equal(plan.openspec.scope, "global");
  assert.equal(plan.language, "zh-CN");
});

test("interactive init collects and confirms a complete plan before writing files", async () => {
  const root = temporaryRoot();
  const calls = [];
  const answers = {
    text: ["payments"],
    select: ["zh-CN", "1.5.0"],
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
  const plan = await collectInitPlan(root, loadInitManifest(), {
    ui,
    run: detectionRun({ value: null }),
    nodeVersion: "24.0.0",
  });
  assert.equal(plan.workspace.name, "payments");
  assert.equal(plan.openspec.selectedVersion, "1.5.0");
  assert.equal(plan.openspec.action, "install");
  assert.equal(plan.language, "zh-CN");
  assert.deepEqual(plan.tools, ["codex"]);
  assert.equal(plan.monitor.enable, true);
  assert(calls.includes("Ready to initialize"));
  assert(!fs.existsSync(path.join(root, ".openspec-workspace")));
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
  const plan = await collectInitPlan(root, loadInitManifest(), {
    ui,
    run: detectionRun({ value: "1.5.0" }),
  });
  assert.deepEqual(offered.choices, [
    { value: "claude", label: "Claude Code" },
    { value: "codex", label: "Codex" },
  ]);
  assert.deepEqual(offered.initialValues, ["claude", "codex"]);
  assert.deepEqual(plan.tools, ["claude", "codex"]);
});

test("interactive init reads a v1 workspace through the legacy language compatibility path", async () => {
  const root = temporaryRoot();
  fs.mkdirSync(path.join(root, ".openspec-workspace"), { recursive: true });
  fs.writeFileSync(path.join(root, ".openspec-workspace", "config.yaml"), [
    "schemaVersion: 1",
    "workspace:",
    "  name: legacy-interactive",
    "  uuid: 123e4567-e89b-42d3-a456-426614174000",
    "monitor:",
    "  enable: false",
    "projects: []",
    "",
  ].join("\n"));
  fs.writeFileSync(path.join(root, ".openspec-workspace", "state.json"), `${JSON.stringify({ workspaceLanguage: "zh-CN" }, null, 2)}\n`);
  const ui = {
    intro() {},
    note() {},
    text: async () => { throw new Error("existing workspace name should be reused"); },
    select: async (_label, choices, initialIndex) => choices[initialIndex].value,
    multiselect: async () => { throw new Error("explicit tools should be reused"); },
    confirm: async () => true,
    close() {},
  };
  const plan = await collectInitPlan(root, loadInitManifest(), {
    ui,
    run: detectionRun({ value: "1.5.0" }),
    tools: ["codex"],
  });
  assert.equal(plan.workspace.name, "legacy-interactive");
  assert.equal(plan.language, "zh-CN");
  assert.deepEqual(plan.tools, ["codex"]);
});

test("OpenSpec preparation does not rerun upstream init just because tool files are absent", () => {
  const root = temporaryRoot();
  fs.mkdirSync(path.join(root, "openspec", "specs"), { recursive: true });
  fs.mkdirSync(path.join(root, "openspec", "changes", "archive"), { recursive: true });
  fs.writeFileSync(path.join(root, "openspec", "config.yaml"), "schema: spec-driven\n");
  const result = prepareOpenSpec(root, loadInitManifest().resources.openspec, ["claude", "codex"], {
    run: () => { throw new Error("upstream init must not run"); },
  });
  assert.deepEqual(result, { action: "skip", missing: [] });
});

test("fresh OpenSpec preparation initializes the selected native tool baselines", () => {
  const root = temporaryRoot();
  let call = null;
  const result = prepareOpenSpec(root, loadInitManifest().resources.openspec, ["claude", "codex"], {
    run: (command, args, options) => {
      call = { command, args, cwd: options.cwd };
      fs.mkdirSync(path.join(root, "openspec", "specs"), { recursive: true });
      fs.mkdirSync(path.join(root, "openspec", "changes", "archive"), { recursive: true });
      fs.writeFileSync(path.join(root, "openspec", "config.yaml"), "schema: spec-driven\n");
      return { status: 0 };
    },
  });
  assert.deepEqual(call, {
    command: "openspec",
    args: ["init", ".", "--tools", "claude,codex", "--profile", "core"],
    cwd: root,
  });
  assert.equal(result.action, "init");
  assert.equal(result.verified, true);
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

test("OpenSpec installation requires explicit non-interactive confirmation and is reverified", async () => {
  const openspec = loadInitManifest().resources.openspec;
  const missing = { value: null };
  await assert.rejects(
    ensureOpenSpec(openspec, {
      root: temporaryRoot(),
      run: detectionRun(missing),
      interactive: false,
      openspecVersion: "1.5.0",
    }),
    /requires confirmation/
  );

  const installed = { value: null };
  const result = await ensureOpenSpec(openspec, {
    root: temporaryRoot(),
    run: detectionRun(installed),
    interactive: false,
    openspecVersion: "1.5.0",
    yes: true,
  });
  assert.equal(result.action, "install");
  assert.equal(installed.value, "1.5.0");
});

test("workspace dependency installation only runs for a tool source checkout", () => {
  const root = temporaryRoot();
  fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ name: "unrelated-project" }));
  const skipped = installWorkspaceDependencies(root, {
    run: () => { throw new Error("must not run"); },
  });
  assert.equal(skipped.action, "skip");

  fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ name: "@icebearx-ai/openspec-workspace" }));
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
    name: "@icebearx-ai/openspec-workspace",
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
    name: "@icebearx-ai/openspec-workspace",
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
  assert.deepEqual(effect.evidence.after, { node_modules: true, "package-lock.json": true });
});

test("partial upstream init failure reports retained output without claiming verification", () => {
  const root = temporaryRoot();
  let failure;
  assert.throws(() => prepareOpenSpec(root, loadInitManifest().resources.openspec, ["codex"], {
    run: () => {
      fs.mkdirSync(path.join(root, "openspec", "specs"), { recursive: true });
      throw new Error("injected upstream failure");
    },
  }), (error) => {
    failure = error;
    return /injected upstream failure/.test(error.message);
  });
  const effect = failure.details.effects.retained[0];
  assert.equal(failure.code, "OPENSPEC_INIT_FAILED");
  assert.equal(effect.kind, "upstream-command-output");
  assert.equal(effect.status, "applied");
  assert.deepEqual(effect.targets, ["openspec/specs"]);
  assert.deepEqual(effect.scope, { root: "openspec", enumeration: "required-targets-only", complete: false });
});

test("upstream init postcondition failure reports created baseline targets", () => {
  const root = temporaryRoot();
  let failure;
  assert.throws(() => prepareOpenSpec(root, loadInitManifest().resources.openspec, ["codex"], {
    run: () => {
      fs.mkdirSync(path.join(root, "openspec", "specs"), { recursive: true });
      return { status: 0 };
    },
  }), (error) => {
    failure = error;
    return error.code === "OPENSPEC_INIT_POSTCONDITION_FAILED";
  });
  const effect = failure.details.effects.retained[0];
  assert.deepEqual(effect.targets, ["openspec/specs"]);
  assert.equal(effect.scope.complete, false);
  assert(failure.details.missing.includes("openspec/config.yaml"));
});

test("initializer rejects unsupported Node versions before mutating the target", async () => {
  const root = temporaryRoot();
  await assert.rejects(
    initializeWorkspace(root, { nodeVersion: "18.0.0", tools: [], interactive: false }),
    /Node 20\.19\.0 or newer/
  );
  assert(!fs.existsSync(path.join(root, ".openspec-workspace")));
});

test("non-interactive init migrates a versionless workspace and removes legacy language state", async () => {
  const root = temporaryRoot();
  fs.mkdirSync(path.join(root, "openspec", "specs"), { recursive: true });
  fs.mkdirSync(path.join(root, "openspec", "changes", "archive"), { recursive: true });
  const desiredConfig = fs.readFileSync(
    path.resolve(__dirname, "..", "..", "artifacts", "patches", "openspec", "1.5.0", "outputs", "openspec", "config.yaml"),
    "utf8"
  ).replace("{{WORKSPACE_LANGUAGE}}", "zh-CN");
  fs.writeFileSync(path.join(root, "openspec", "config.yaml"), desiredConfig);
  fs.mkdirSync(path.join(root, ".openspec-workspace"), { recursive: true });
  fs.writeFileSync(path.join(root, ".openspec-workspace", "config.yaml"), [
    "workspace:",
    "  name: legacy-yes",
    "  uuid: 123e4567-e89b-42d3-a456-426614174000",
    "monitor:",
    "  enable: false",
    "projects: []",
    "",
  ].join("\n"));
  fs.writeFileSync(path.join(root, ".openspec-workspace", "state.json"), `${JSON.stringify({ workspaceLanguage: "zh-CN" }, null, 2)}\n`);

  const result = await initializeWorkspace(root, {
    nodeVersion: "24.0.0",
    tools: [],
    interactive: false,
    openspecVersion: "1.5.0",
    yes: true,
    run: detectionRun({ value: "1.5.0" }),
  });
  assert.equal(result.migration.schema.fromVersion, 0);
  assert.equal(result.migration.language.source, "legacy-state+openspec-context");
  assert(result.migration.steps.some((step) => step.kind === "workspace-language"));
  const config = yaml.load(fs.readFileSync(path.join(root, ".openspec-workspace", "config.yaml"), "utf8"));
  assert.equal(config.schemaVersion, 2);
  assert.equal(config.workspace.language, "zh-CN");
  assert.equal(JSON.parse(fs.readFileSync(path.join(root, ".openspec-workspace", "state.json"), "utf8")).workspaceLanguage, undefined);
});

test("initializer rolls back workspace files and reports a retained verified external effect", async () => {
  const root = temporaryRoot();
  fs.mkdirSync(path.join(root, "openspec", "specs"), { recursive: true });
  fs.mkdirSync(path.join(root, "openspec", "changes", "archive"), { recursive: true });
  const configFile = path.join(root, "openspec", "config.yaml");
  const desiredConfig = fs.readFileSync(
    path.resolve(__dirname, "..", "..", "artifacts", "patches", "openspec", "1.5.0", "outputs", "openspec", "config.yaml"),
    "utf8"
  ).replace("{{WORKSPACE_LANGUAGE}}", "zh-CN");
  fs.writeFileSync(configFile, desiredConfig);

  const version = { value: null };
  let failure;
  await assert.rejects(
    initializeWorkspace(root, {
      nodeVersion: "24.0.0",
      tools: [],
      interactive: false,
      openspecVersion: "1.5.0",
      yes: true,
      run: detectionRun(version),
      onStage: (name) => {
        if (name === "Prepare local workspace configuration") throw new Error("injected workspace failure");
      },
    }),
    (error) => {
      failure = error;
      return /injected workspace failure/.test(error.message);
    }
  );

  assert.equal(fs.readFileSync(configFile, "utf8"), desiredConfig);
  assert.equal(fs.existsSync(path.join(root, "USER_GUIDE.md")), false);
  assert.equal(fs.existsSync(path.join(root, "openspec", "schemas")), false);
  assert.equal(fs.existsSync(path.join(root, ".openspec-workspace")), false);
  assert.equal(failure.details.workspaceRolledBack, true);
  assert.deepEqual(failure.details.externalEffects, [{
    kind: "global-package",
    name: "OpenSpec",
    version: "1.5.0",
    verified: true,
    status: "applied",
  }]);
  assert.equal(failure.details.effects.retained[0].status, "applied");
});
