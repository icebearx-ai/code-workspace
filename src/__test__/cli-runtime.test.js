const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");

const { parse } = require("../cli/parser");
const { buildCompletionSpec, renderBashCompletion, renderZshCompletion } = require("../cli/commands/completion");
const { COMMANDS, commandHelpRows, getCommand, validateCommandReference } = require("../cli/registry");
const { CURRENT_CONFIG_VERSION, loadConfigProjection, planConfigMigration } = require("../core/config");
const { resolveWorkspaceTools } = require("../core/tools");
const { createFileTransaction } = require("../core/transaction");
const { planWorkspaceMaintenance } = require("../core/migration");

const argv = (...args) => [process.execPath, "code-workspace", ...args];
const cli = path.resolve(__dirname, "..", "..", "bin", "code-workspace.js");

function temporaryRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "openspec-cli-runtime-"));
}

function writeConfig(root, content) {
  fs.mkdirSync(path.join(root, ".code-workspace"), { recursive: true });
  fs.writeFileSync(path.join(root, ".code-workspace", "config.yaml"), content);
}

function run(root, args) {
  return spawnSync(process.execPath, [cli, ...args], { cwd: root, encoding: "utf8" });
}

test("semantic parser keeps boolean options independent from positionals", () => {
  const before = parse(argv("init", "--yes", "."));
  const after = parse(argv("init", ".", "--yes"));
  assert.deepEqual({ args: before.args, options: before.options }, { args: ["."], options: { yes: true } });
  assert.deepEqual({ args: after.args, options: after.options }, { args: ["."], options: { yes: true } });
});

test("semantic parser accepts global JSON ordering and short port alias", () => {
  assert.equal(parse(argv("--json", "project", "list")).options.json, true);
  assert.equal(parse(argv("project", "list", "--json")).options.json, true);
  assert.equal(parse(argv("monitor", "-p", "8080")).options.port, "8080");
  assert.deepEqual(parse(argv("permissions", "apply", "--tools", "claude,codex", "--yes")).options, {
    tools: "claude,codex",
    yes: true,
  });
});

test("semantic parser rejects unknown options, duplicates, and extra arguments", () => {
  assert.throws(() => parse(argv("update", "--froce")), (error) =>
    error.code === "CLI_UNKNOWN_OPTION" && error.details.command === "update"
  );
  assert.throws(() => parse(argv("project", "list", "extra")), (error) => error.code === "CLI_EXTRA_ARGUMENT");
  assert.throws(() => parse(argv("project", "list", "--json", "--json")), (error) => error.code === "CLI_DUPLICATE_OPTION");
  assert.throws(() => parse(argv("project", "verify", "service", "extra")), (error) => error.code === "CLI_EXTRA_ARGUMENT");
  assert.throws(() => parse(argv("context", "--change", "add-health")), (error) => error.code === "CLI_UNKNOWN_COMMAND");
  assert.throws(() => parse(argv("project", "add", "/tmp/service", "--spec-prefix", "service")), (error) =>
    error.code === "CLI_UNKNOWN_OPTION" && error.details.command === "project.add" && error.details.option === "spec-prefix"
  );
});

test("semantic parser accepts targeted project verification with valid option ordering", () => {
  const before = parse(argv("project", "verify", "--json", "service"));
  const after = parse(argv("project", "verify", "service", "--json"));
  assert.deepEqual({ args: before.args, options: before.options }, { args: ["service"], options: { json: true } });
  assert.deepEqual({ args: after.args, options: after.options }, { args: ["service"], options: { json: true } });
});

test("semantic parser covers explicit boolean values, missing values, aliases, and -- paths", () => {
  assert.throws(() => parse(argv("project", "list", "--json=false")), (error) => error.code === "CLI_INVALID_OPTION_VALUE");
  assert.throws(() => parse(argv("project", "list", "--json", "false")), (error) => error.code === "CLI_EXTRA_ARGUMENT");
  assert.throws(() => parse(argv("update", "--tools")), (error) => error.code === "CLI_OPTION_VALUE_REQUIRED");
  assert.throws(() => parse(argv("monitor", "-p", "8080", "--port", "8081")), (error) => error.code === "CLI_DUPLICATE_OPTION");
  assert.deepEqual(parse(argv("project", "inspect", "--", "-repository")).args, ["-repository"]);
});

test("help bypasses required positional validation without weakening normal parsing", () => {
  assert.equal(parse(argv("project", "inspect", "--help")).options.help, true);
  assert.throws(() => parse(argv("project", "inspect")), (error) => error.code === "CLI_ARGUMENT_REQUIRED");
});

test("registry is the source for help and completion command paths", () => {
  for (const { usage } of commandHelpRows()) {
    const path = usage.replace(/\s+\[.*$/, "").replace(/\s+<.*$/, "").split(" ");
    assert(getCommand(path), usage);
  }
  const spec = buildCompletionSpec();
  assert.deepEqual(
    new Set(spec.children.find((entry) => entry.path.length === 0).values),
    new Set(COMMANDS.map((command) => command.path[0]))
  );
  assert.deepEqual(
    new Set(spec.children.find((entry) => entry.path.join(" ") === "project").values),
    new Set(COMMANDS.filter((command) => command.path[0] === "project").map((command) => command.path[1]))
  );
});

test("completion scripts include subcommands and command-specific options", () => {
  const spec = buildCompletionSpec();
  const bash = renderBashCompletion(spec);
  const zsh = renderZshCompletion(spec);
  for (const script of [bash, zsh]) {
    for (const subcommand of ["inspect", "add", "remove", "sync-branch", "list", "show", "verify"]) {
      assert.match(script, new RegExp(`['\"]?${subcommand}['\"]?`));
    }
    assert.match(script, /monitor/);
    assert.match(script, /report/);
    assert.match(script, /--projects-file/);
    assert.match(script, /--shell/);
    assert.match(script, /permissions/);
    assert.match(script, /apply/);
  }
  assert(!spec.children.find((entry) => entry.path.length === 0).values.includes("context"));
  const projectList = spec.commands.find((entry) => entry.path.join(" ") === "project list");
  const projectAdd = spec.commands.find((entry) => entry.path.join(" ") === "project add");
  assert(!projectList.options.includes("--projects-file"));
  assert(projectAdd.options.includes("--projects-file"));
  const permissionsApply = spec.commands.find((entry) => entry.path.join(" ") === "permissions apply");
  assert(permissionsApply.options.includes("--tools"));
  assert(permissionsApply.options.includes("--yes"));
  assert(!spec.children.find((entry) => entry.path.length === 0).values.includes("sync"));
});

test("completion returns the generated script in text and JSON modes", () => {
  const bash = run(os.tmpdir(), ["completion", "--shell", "bash"]);
  assert.equal(bash.status, 0, bash.stderr);
  assert.match(bash.stdout, /complete -F _code_workspace code-workspace code-w/);
  assert.match(bash.stdout, /inspect add remove sync-branch list show verify/);

  const zsh = run(os.tmpdir(), ["completion", "--shell", "zsh", "--json"]);
  assert.equal(zsh.status, 0, zsh.stderr);
  const envelope = JSON.parse(zsh.stdout);
  assert.equal(envelope.command, "completion");
  assert.equal(envelope.data.shell, "zsh");
  assert.match(envelope.data.script, /#compdef code-workspace code-w/);
  assert.match(envelope.data.script, /--shell/);
});

test("removed context command is rejected before workspace discovery", () => {
  const result = run(os.tmpdir(), ["context", "--json"]);
  assert.equal(result.status, 1);
  const envelope = JSON.parse(result.stdout);
  assert.equal(envelope.command, null);
  assert.equal(envelope.diagnostics[0].code, "CLI_UNKNOWN_COMMAND");
});

test("documentation references are validated by the real semantic parser", () => {
  assert.equal(validateCommandReference('project inspect "<path>" --json').valid, true);
  assert.equal(validateCommandReference('project sync-branch "<name>" --yes --json').valid, true);
  assert.equal(validateCommandReference("permissions apply --tools claude,codex --yes --json").valid, true);
  assert.equal(validateCommandReference("update --tools").valid, false);
  assert.match(validateCommandReference("update --froce").reason, /CLI_UNKNOWN_OPTION/);
});

test("project projections read legacy configuration without requiring language or writing files", () => {
  const root = temporaryRoot();
  const content = [
    "schemaVersion: 1",
    "workspace:",
    "  name: legacy",
    "  uuid: 123e4567-e89b-42d3-a456-426614174000",
    "monitor:",
    "  enable: false",
    "projects:",
    "  - name: portal",
    "    location: /tmp/portal",
    "    branch: main",
    "    type: frontend",
    "    context: legacy",
    "",
  ].join("\n");
  writeConfig(root, content);
  const file = path.join(root, ".code-workspace", "config.yaml");
  assert.equal(run(root, ["project", "list"]).status, 0);
  assert.equal(run(root, ["project", "show", "portal", "--json"]).status, 0);
  assert.equal(fs.readFileSync(file, "utf8"), content);
  assert.deepEqual(loadConfigProjection(root, ["projects"]).projects.map((project) => project.name), ["portal"]);
});

test("configuration projections isolate unrelated invalid domains", () => {
  const root = temporaryRoot();
  writeConfig(root, [
    "schemaVersion: 1",
    "workspace:",
    "  name: isolated",
    "  uuid: 123e4567-e89b-42d3-a456-426614174000",
    "  language: en-US",
    "monitor:",
    "  url: not-a-url",
    "projects: invalid",
    "",
  ].join("\n"));
  assert.equal(loadConfigProjection(root, ["identity"]).workspace.name, "isolated");
  assert.equal(loadConfigProjection(root, ["language"]).workspace.language, "en-US");
  assert.throws(() => loadConfigProjection(root, ["monitor"]), /absolute URL/);
  assert.throws(() => loadConfigProjection(root, ["projects"]), (error) => error.code === "PROJECT_REGISTRY_INVALID");
});

test("language projection rejects missing language with a structured diagnostic", () => {
  const root = temporaryRoot();
  writeConfig(root, "schemaVersion: 1\nworkspace:\n  name: legacy\n  uuid: 123e4567-e89b-42d3-a456-426614174000\nprojects: []\n");
  const result = run(root, ["language", "--json"]);
  assert.equal(result.status, 1);
  assert.equal(JSON.parse(result.stdout).diagnostics[0].code, "WORKSPACE_LANGUAGE_MISSING");
});

test("future configuration versions fail without rewriting the document", () => {
  const root = temporaryRoot();
  const content = "schemaVersion: 99\nprojects: []\n";
  writeConfig(root, content);
  const result = run(root, ["project", "list", "--json"]);
  assert.equal(result.status, 1);
  assert.equal(JSON.parse(result.stdout).diagnostics[0].code, "CONFIG_SCHEMA_VERSION_UNSUPPORTED");
  assert.equal(fs.readFileSync(path.join(root, ".code-workspace", "config.yaml"), "utf8"), content);
});

test("configuration migration registry plans v0 and v1 upgrades without mutating inputs", () => {
  const v0 = { projects: [] };
  const v1 = { schemaVersion: 1, projects: [] };
  const zeroPlan = planConfigMigration(v0);
  const onePlan = planConfigMigration(v1);
  assert.equal(zeroPlan.fromVersion, 0);
  assert.equal(zeroPlan.toVersion, CURRENT_CONFIG_VERSION);
  assert.deepEqual(zeroPlan.steps, [{ fromVersion: 0, toVersion: 1 }, { fromVersion: 1, toVersion: 2 }]);
  assert.deepEqual(onePlan.steps, [{ fromVersion: 1, toVersion: 2 }]);
  assert.equal(v0.schemaVersion, undefined);
  assert.equal(v1.schemaVersion, 1);
});

test("maintenance migration plan combines schema and legacy language actions without writing", () => {
  const root = temporaryRoot();
  const content = [
    "schemaVersion: 1",
    "workspace:",
    "  name: legacy-plan",
    "  uuid: 123e4567-e89b-42d3-a456-426614174000",
    "monitor:",
    "  enable: false",
    "projects: []",
    "",
  ].join("\n");
  writeConfig(root, content);
  fs.writeFileSync(path.join(root, ".code-workspace", "state.json"), `${JSON.stringify({ workspaceLanguage: "zh-CN" }, null, 2)}\n`);
  const plan = planWorkspaceMaintenance(root, { allowLegacy: true, defaultLanguage: false });
  assert.equal(plan.schema.fromVersion, 1);
  assert.equal(plan.schema.toVersion, CURRENT_CONFIG_VERSION);
  assert.equal(plan.language.value, "zh-CN");
  assert.equal(plan.language.source, "legacy-state");
  assert(plan.steps.some((step) => step.kind === "config-schema"));
  assert(plan.steps.some((step) => step.kind === "workspace-language"));
  assert(plan.steps.some((step) => step.kind === "state-cleanup"));
  assert.deepEqual(plan.writeTargets.sort(), [
    path.join(root, ".code-workspace", "config.yaml"),
    path.join(root, ".code-workspace", "state.json"),
  ].sort());
  assert.equal(fs.readFileSync(path.join(root, ".code-workspace", "config.yaml"), "utf8"), content);
  assert.equal(JSON.parse(fs.readFileSync(path.join(root, ".code-workspace", "state.json"), "utf8")).workspaceLanguage, "zh-CN");
});

test("versionless configuration is projected read-only", () => {
  const root = temporaryRoot();
  const content = "projects: []\n";
  writeConfig(root, content);
  const result = run(root, ["project", "list", "--json"]);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).data.projects.length, 0);
  assert.equal(fs.readFileSync(path.join(root, ".code-workspace", "config.yaml"), "utf8"), content);
});

test("tool resolution uses cli, workspace state, then manifest precedence", () => {
  const manifestTools = ["claude", "codex"];
  const state = { tools: ["codex"] };
  assert.deepEqual(resolveWorkspaceTools({ explicit: "none", state, manifestTools }), { tools: [], source: "cli" });
  assert.deepEqual(resolveWorkspaceTools({ state, manifestTools }), { tools: ["codex"], source: "workspace-state" });
  assert.deepEqual(resolveWorkspaceTools({ manifestTools }), { tools: manifestTools, source: "manifest" });
});

test("doctor retains valid projects when language is invalid", () => {
  const parent = temporaryRoot();
  const root = path.join(parent, "workspace");
  const repository = path.join(parent, "service");
  fs.mkdirSync(root);
  fs.mkdirSync(repository);
  spawnSync("git", ["init", "-b", "main"], { cwd: repository, stdio: "ignore" });
  writeConfig(root, [
    "schemaVersion: 2",
    "workspace:",
    "  name: tolerant",
    "  uuid: 123e4567-e89b-42d3-a456-426614174000",
    "  language: invalid",
    "monitor:",
    "  enable: false",
    "projects:",
    "  - name: service",
    `    location: ${repository}`,
    "    branch: stale",
    "    type: backend",
    "    context: service",
    "",
  ].join("\n"));
  const result = run(root, ["doctor", "--json"]);
  const envelope = JSON.parse(result.stdout);
  assert.equal(result.status, 1);
  assert(envelope.diagnostics.some((entry) => entry.code === "WORKSPACE_LANGUAGE_INVALID"));
  assert(envelope.diagnostics.some((entry) => entry.code === "PROJECT_BRANCH_MISMATCH"));
  assert(!envelope.diagnostics.some((entry) => entry.code === "WORKSPACE_IDENTITY_MISSING"));
});

test("registered JSON commands use one stable envelope", () => {
  const root = temporaryRoot();
  writeConfig(root, [
    "schemaVersion: 2",
    "workspace:",
    "  name: envelope",
    "  uuid: 123e4567-e89b-42d3-a456-426614174000",
    "  language: en-US",
    "monitor:",
    "  enable: false",
    "projects: []",
    "",
  ].join("\n"));
  for (const args of [["language", "--json"], ["project", "list", "--json"], ["completion", "--json"]]) {
    const result = run(root, args);
    assert.equal(result.status, 0, result.stderr);
    const envelope = JSON.parse(result.stdout);
    assert.deepEqual(Object.keys(envelope), ["schemaVersion", "ok", "command", "data", "diagnostics"]);
    assert.equal(envelope.ok, true);
    assert.equal(typeof envelope.command, "string");
    assert.equal(typeof envelope.data, "object");
    assert.deepEqual(envelope.diagnostics, []);
    assert.equal(result.stderr, "");
  }
});

test("JSON writes require confirmation before changing files", () => {
  const root = temporaryRoot();
  const content = [
    "schemaVersion: 2",
    "workspace:",
    "  name: confirmation",
    "  uuid: 123e4567-e89b-42d3-a456-426614174000",
    "  language: en-US",
    "monitor:",
    "  enable: false",
    "projects:",
    "  - name: service",
    "    location: /tmp/service",
    "    branch: main",
    "    type: backend",
    "    context: service",
    "",
  ].join("\n");
  writeConfig(root, content);
  const result = run(root, ["project", "remove", "service", "--json"]);
  assert.equal(result.status, 1);
  assert.equal(JSON.parse(result.stdout).diagnostics[0].code, "CLI_CONFIRMATION_REQUIRED");
  assert.equal(fs.readFileSync(path.join(root, ".code-workspace", "config.yaml"), "utf8"), content);
});

test("project sync-branch adopts the actual Git branch without touching permission files", () => {
  const parent = temporaryRoot();
  const root = path.join(parent, "workspace");
  const repository = path.join(parent, "service");
  fs.mkdirSync(root);
  fs.mkdirSync(repository);
  spawnSync("git", ["init", "-b", "main"], { cwd: repository, stdio: "ignore" });
  writeConfig(root, [
    "schemaVersion: 2",
    "workspace:",
    "  name: branch-sync",
    "  uuid: 123e4567-e89b-42d3-a456-426614174000",
    "monitor:",
    "  enable: false",
    "  url: not-a-valid-monitor-url",
    "projects:",
    "  - name: service",
    `    location: ${repository}`,
    "    branch: main",
    "    type: backend",
    "    context: service",
    "",
  ].join("\n"));
  const permissionsFile = path.join(root, ".codex", "config.toml");
  fs.mkdirSync(path.dirname(permissionsFile), { recursive: true });
  fs.writeFileSync(permissionsFile, "# preserve permissions\n");
  spawnSync("git", ["switch", "-c", "feature/sync"], { cwd: repository, stdio: "ignore" });

  const verifyBefore = run(root, ["project", "verify", "--json"]);
  assert.equal(verifyBefore.status, 1);
  const mismatch = JSON.parse(verifyBefore.stdout).diagnostics.find((entry) => entry.code === "PROJECT_BRANCH_MISMATCH");
  assert.equal(mismatch.configuredBranch, "main");
  assert.equal(mismatch.actualBranch, "feature/sync");

  const configFile = path.join(root, ".code-workspace", "config.yaml");
  const configBefore = fs.readFileSync(configFile);
  const permissionsBefore = fs.readFileSync(permissionsFile);
  const unconfirmed = run(root, ["project", "sync-branch", "service", "--json"]);
  assert.equal(unconfirmed.status, 1);
  assert.equal(JSON.parse(unconfirmed.stdout).diagnostics[0].code, "CLI_CONFIRMATION_REQUIRED");
  assert.deepEqual(fs.readFileSync(configFile), configBefore);

  const synchronized = run(root, ["project", "sync-branch", "service", "--yes", "--json"]);
  assert.equal(synchronized.status, 0, synchronized.stderr);
  const data = JSON.parse(synchronized.stdout).data;
  assert.equal(data.action, "update");
  assert.equal(data.previousBranch, "main");
  assert.equal(data.actualBranch, "feature/sync");
  assert.equal(data.project.branch, "feature/sync");
  assert.equal(loadConfigProjection(root, ["projects"]).projects[0].branch, "feature/sync");
  assert.match(fs.readFileSync(configFile, "utf8"), /url: not-a-valid-monitor-url/);
  assert.doesNotMatch(fs.readFileSync(configFile, "utf8"), /language:/);
  assert.deepEqual(fs.readFileSync(permissionsFile), permissionsBefore);
  assert.equal(run(root, ["project", "verify", "--json"]).status, 0);

  const committed = fs.readFileSync(configFile);
  const repeated = run(root, ["project", "sync-branch", "service", "--yes", "--json"]);
  assert.equal(repeated.status, 0, repeated.stderr);
  assert.equal(JSON.parse(repeated.stdout).data.action, "skip");
  assert.deepEqual(fs.readFileSync(configFile), committed);

  const missing = run(root, ["project", "sync-branch", "missing", "--yes", "--json"]);
  assert.equal(missing.status, 1);
  assert.equal(JSON.parse(missing.stdout).diagnostics[0].code, "PROJECT_NOT_FOUND");
});

test("project verify targets one project without unrelated branch or config-domain failures", () => {
  const parent = temporaryRoot();
  const root = path.join(parent, "workspace");
  const service = path.join(parent, "service");
  const other = path.join(parent, "other");
  fs.mkdirSync(root);
  fs.mkdirSync(service);
  fs.mkdirSync(other);
  spawnSync("git", ["init", "-b", "main"], { cwd: service, stdio: "ignore" });
  spawnSync("git", ["init", "-b", "main"], { cwd: other, stdio: "ignore" });
  const content = [
    "schemaVersion: 2",
    "workspace:",
    "  name: targeted-verify",
    "  uuid: 123e4567-e89b-42d3-a456-426614174000",
    "  language: invalid",
    "monitor:",
    "  url: not-a-valid-url",
    "projects:",
    "  - name: service",
    `    location: ${service}`,
    "    branch: main",
    "    type: backend",
    "    context: service",
    "  - name: other",
    `    location: ${other}`,
    "    branch: stale",
    "    type: backend",
    "    context: other",
    "",
  ].join("\n");
  writeConfig(root, content);
  const configFile = path.join(root, ".code-workspace", "config.yaml");

  const selected = run(root, ["project", "verify", "service", "--json"]);
  assert.equal(selected.status, 0, selected.stderr);
  const envelope = JSON.parse(selected.stdout);
  assert.deepEqual(Object.keys(envelope), ["schemaVersion", "ok", "command", "data", "diagnostics"]);
  assert.equal(envelope.command, "project.verify");
  assert.equal(envelope.data.scope, "project");
  assert.equal(envelope.data.project.name, "service");
  assert.deepEqual(envelope.data.projects.map((project) => project.name), ["service"]);
  assert.deepEqual(envelope.diagnostics, []);

  const selectedText = run(root, ["project", "verify", "service"]);
  assert.equal(selectedText.status, 0, selectedText.stderr);
  assert.match(selectedText.stdout, /Local project verification passed: service/);

  const unrelated = run(root, ["project", "verify", "other", "--json"]);
  assert.equal(unrelated.status, 1);
  assert(JSON.parse(unrelated.stdout).diagnostics.some((entry) => entry.code === "PROJECT_BRANCH_MISMATCH"));

  const workspaceWide = run(root, ["project", "verify", "--json"]);
  assert.equal(workspaceWide.status, 1);
  assert.equal(JSON.parse(workspaceWide.stdout).data.scope, "workspace");

  const missing = run(root, ["project", "verify", "missing", "--json"]);
  assert.equal(missing.status, 1);
  assert.equal(JSON.parse(missing.stdout).diagnostics[0].code, "PROJECT_NOT_FOUND");
  assert.equal(fs.readFileSync(configFile, "utf8"), content);
});

test("unknown commands are diagnosed before workspace discovery", () => {
  const result = run(temporaryRoot(), ["unknown", "--json"]);
  assert.equal(result.status, 1);
  const envelope = JSON.parse(result.stdout);
  const diagnostic = envelope.diagnostics[0];
  assert.equal(envelope.command, null);
  assert.equal(diagnostic.code, "CLI_UNKNOWN_COMMAND");
  assert.doesNotMatch(diagnostic.message, /Workspace/);

  const removed = run(temporaryRoot(), ["change", "validate", "example", "--json"]);
  assert.equal(removed.status, 1);
  assert.equal(JSON.parse(removed.stdout).diagnostics[0].code, "CLI_UNKNOWN_COMMAND");

  const removedValidate = run(temporaryRoot(), ["validate", "--json"]);
  assert.equal(removedValidate.status, 1);
  assert.equal(JSON.parse(removedValidate.stdout).diagnostics[0].code, "CLI_UNKNOWN_COMMAND");
});

test("known-command parse failures preserve the command in the JSON envelope", () => {
  const result = run(temporaryRoot(), ["update", "--froce", "--json"]);
  assert.equal(result.status, 1);
  assert.equal(result.stderr, "");
  const envelope = JSON.parse(result.stdout);
  assert.equal(envelope.command, "update");
  assert.equal(envelope.diagnostics[0].code, "CLI_UNKNOWN_OPTION");
});

test("legacy language absence does not block unrelated command matrix", () => {
  const root = temporaryRoot();
  const content = [
    "schemaVersion: 1",
    "workspace:",
    "  name: legacy-matrix",
    "  uuid: 123e4567-e89b-42d3-a456-426614174000",
    "monitor:",
    "  enable: false",
    "projects: []",
    "",
  ].join("\n");
  writeConfig(root, content);
  for (const args of [["project", "list"], ["project", "verify"], ["permissions", "apply"]]) {
    const result = run(root, [...args, "--json"]);
    assert.equal(result.status, 0, `${args.join(" ")}: ${result.stdout} ${result.stderr}`);
    assert(!JSON.parse(result.stdout).diagnostics.some((entry) => entry.code === "WORKSPACE_LANGUAGE_MISSING"));
  }
  assert.equal(fs.readFileSync(path.join(root, ".code-workspace", "config.yaml"), "utf8"), content);
});

test("project inspection is workspace-independent", () => {
  const root = temporaryRoot();
  spawnSync("git", ["init", "-b", "main"], { cwd: root, stdio: "ignore" });
  const result = run(os.tmpdir(), ["project", "inspect", root, "--json"]);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).data.project.branch, "main");
});

test("file transaction restores existing files and removes new files and directories", () => {
  const root = temporaryRoot();
  const existing = path.join(root, "existing.txt");
  const created = path.join(root, "new", "nested", "created.txt");
  fs.writeFileSync(existing, "before\n");
  const transaction = createFileTransaction([existing, created]);
  fs.writeFileSync(existing, "after\n");
  fs.mkdirSync(path.dirname(created), { recursive: true });
  fs.writeFileSync(created, "created\n");
  const error = new Error("fail");
  transaction.recordExternalEffect({ kind: "test", verified: true });
  transaction.rollback(error);
  assert.equal(fs.readFileSync(existing, "utf8"), "before\n");
  assert.equal(fs.existsSync(created), false);
  assert.equal(fs.existsSync(path.join(root, "new")), false);
  assert.equal(error.details.workspaceRolledBack, true);
  assert.deepEqual(error.details.externalEffects, [{ kind: "test", verified: true, status: "applied" }]);
  assert.deepEqual(error.details.effects.restored, [existing]);
  assert.deepEqual(error.details.effects.removed, [created]);
  assert.deepEqual(error.details.effects.retained, [{ kind: "test", verified: true, status: "applied", retained: true }]);
  assert.deepEqual(error.details.effects.rollbackFailures, []);
});

test("file transaction refuses to claim an unverified external effect", () => {
  const transaction = createFileTransaction([]);
  assert.throws(() => transaction.recordExternalEffect({ kind: "command", verified: false }), /unverified external effect/);
});

test("packaged skills and README files reference registered commands and options", () => {
  const roots = [
    path.resolve(__dirname, "..", "..", "README.md"),
    path.resolve(__dirname, "..", "..", "README.zh-CN.md"),
    path.resolve(__dirname, "..", "..", "artifacts", "templates"),
  ];
  const files = [];
  const visit = (target) => {
    if (fs.statSync(target).isDirectory()) {
      for (const name of fs.readdirSync(target)) visit(path.join(target, name));
    } else if (target.endsWith(".md")) files.push(target);
  };
  roots.forEach(visit);
  let checked = 0;
  for (const file of files) {
    const content = fs.readFileSync(file, "utf8").replace(/\\\n\s*/g, " ");
    const references = [];
    for (const line of content.split("\n")) {
      if (/^\s*code-(?:workspace|w)\s+/.test(line)) {
        references.push(line.trim().replace(/^code-(?:workspace|w)\s+/, ""));
      }
      for (const match of line.matchAll(/`code-(?:workspace|w)\s+([^`]+)`/g)) {
        references.push(match[1]);
      }
    }
    for (const rawReference of references) {
      const reference = rawReference.trim().replace(/[.,;:]$/, "");
      const result = validateCommandReference(reference);
      assert.equal(result.valid, true, `${path.relative(process.cwd(), file)}: ${reference} (${result.reason})`);
      checked += 1;
    }
  }
  assert(checked >= 20, `expected at least 20 command references, found ${checked}`);
  const addProjects = fs.readFileSync(
    path.resolve(__dirname, "..", "..", "artifacts", "templates", "codex", "skills", "code-workspace-add-projects", "SKILL.md"),
    "utf8"
  );
  assert.match(addProjects, /data\.language/);
  assert.match(addProjects, /data\.projectContext/);
  assert.match(addProjects, /`schemaVersion`, `ok`, `command`, `data`, and `diagnostics`/);
});
