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
  assert.deepEqual(parse(argv("project", "verify", "service", "extra")).args, ["service", "extra"]);
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
  assert.deepEqual(parse(argv("project", "verify", "service", "api", "--json")).args, ["service", "api"]);
});

test("extension install is an optional variadic planned-write contract", () => {
  const definition = getCommand("extension install");
  assert(definition);
  assert.equal(definition.workspace, "required");
  assert.deepEqual(definition.config, ["identity", "language"]);
  assert.equal(definition.interaction, "required");
  assert.equal(definition.effects, "planned-write");
  assert.deepEqual(definition.args, [{ name: "name", required: false, variadic: true }]);
  assert.deepEqual(Object.keys(definition.options), ["yes"]);
  assert.deepEqual(parse(argv("extension", "install")).args, []);
  assert.deepEqual(parse(argv("extension", "install", "alpha", "beta", "--yes", "--json")).args, ["alpha", "beta"]);
  assert.deepEqual(parse(argv("extension", "install", "--yes", "alpha")).args, ["alpha"]);
  assert.throws(() => parse(argv("extension", "install", "alpha", "--force")), (error) => error.code === "CLI_UNKNOWN_OPTION");
});

test("project branch commands are registry-driven three-segment contracts", () => {
  const contracts = {
    "project branch inspect": { interaction: "never", effects: "read-only", options: [] },
    "project branch verify": { interaction: "never", effects: "read-only", options: [] },
    "project branch accept-actual": { interaction: "required", effects: "planned-write", options: ["yes"] },
    "project branch use-registered": { interaction: "required", effects: "external", options: ["yes", "allow-remote", "remote"] },
    "project branch update-latest": { interaction: "never", effects: "external", options: [] },
  };
  for (const [commandPath, expected] of Object.entries(contracts)) {
    const definition = getCommand(commandPath);
    assert(definition, commandPath);
    assert.equal(definition.workspace, "required");
    assert.deepEqual(definition.config, ["projects"]);
    assert.equal(definition.interaction, expected.interaction);
    assert.equal(definition.effects, expected.effects);
    assert.equal(definition.args[0].variadic, true);
    assert.deepEqual(Object.keys(definition.options), expected.options);
    const tokens = commandPath.split(" ");
    const before = parse(argv(...tokens, "--json", "service", ...(expected.options.includes("yes") ? ["--yes"] : [])));
    const after = parse(argv(...tokens, "service", ...(expected.options.includes("yes") ? ["--yes"] : []), "--json"));
    assert.deepEqual(before.args, ["service"]);
    assert.deepEqual(before.options, after.options);
    assert.deepEqual(parse(argv(...tokens, "service", "api", "web")).args, ["service", "api", "web"]);
  }
  assert.throws(() => parse(argv("project", "branch", "inspect", "service", "--yes")), (error) => error.code === "CLI_UNKNOWN_OPTION");
  assert.throws(() => parse(argv("project", "branch", "use-registered", "service", "--force")), (error) => error.code === "CLI_UNKNOWN_OPTION");
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
    for (const subcommand of ["inspect", "add", "remove", "branch", "list", "show", "verify"]) {
      assert.match(script, new RegExp(`['\"]?${subcommand}['\"]?`));
    }
    assert.match(script, /monitor/);
    assert.match(script, /report/);
    assert.match(script, /--projects-file/);
    assert.match(script, /--shell/);
    assert.match(script, /permissions/);
    assert.match(script, /apply/);
    assert.match(script, /accept-actual/);
    assert.match(script, /use-registered/);
    assert.match(script, /update-latest/);
    assert.match(script, /install/);
    assert.match(script, /uninstall/);
    assert.doesNotMatch(script, /sync-branch/);
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
  assert.deepEqual(
    new Set(spec.children.find((entry) => entry.path.join(" ") === "project branch").values),
    new Set(["inspect", "verify", "accept-actual", "use-registered", "update-latest"])
  );
});

test("completion returns the generated script in text and JSON modes", () => {
  const bash = run(os.tmpdir(), ["completion", "--shell", "bash"]);
  assert.equal(bash.status, 0, bash.stderr);
  assert.match(bash.stdout, /complete -F _code_workspace code-workspace code-w/);
  assert.doesNotMatch(bash.stdout, /sync-branch/);
  assert.match(bash.stdout, /accept-actual/);
  assert.match(bash.stdout, /use-registered/);

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

test("removed project sync-branch command is rejected before workspace discovery", () => {
  const result = run(os.tmpdir(), ["project", "sync-branch", "service", "--json"]);
  assert.equal(result.status, 1);
  const envelope = JSON.parse(result.stdout);
  assert.equal(envelope.command, null);
  assert.equal(envelope.diagnostics[0].code, "CLI_UNKNOWN_COMMAND");
  assert.doesNotMatch(envelope.diagnostics[0].message, /Workspace/);
});

test("documentation references are validated by the real semantic parser", () => {
  assert.equal(validateCommandReference('project inspect "<path>" --json').valid, true);
  assert.equal(validateCommandReference('project sync-branch "<name>" --yes --json').valid, false);
  assert.equal(validateCommandReference('project branch inspect "<name>" --json').valid, true);
  assert.equal(validateCommandReference('project branch inspect "<name>" "<name>" --json').valid, true);
  assert.equal(validateCommandReference('project branch verify "<name>" --json').valid, true);
  assert.equal(validateCommandReference('project branch verify "<name>" "<name>" --json').valid, true);
  assert.equal(validateCommandReference('project branch accept-actual "<name>" --yes --json').valid, true);
  assert.equal(validateCommandReference('project branch use-registered "<name>" --yes --json').valid, true);
  assert.equal(validateCommandReference('project branch update-latest "<name>" --json').valid, true);
  assert.equal(validateCommandReference("permissions apply --tools claude,codex --yes --json").valid, true);
  assert.equal(validateCommandReference("extension install <name> <name> --yes --json").valid, true);
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

test("project branch inspect and accept-actual are targeted, canonical, and transactional", () => {
  const parent = temporaryRoot();
  const root = path.join(parent, "workspace");
  const repository = path.join(parent, "service");
  fs.mkdirSync(root);
  fs.mkdirSync(repository);
  fs.writeFileSync(path.join(repository, "tracked.txt"), "initial\n");
  spawnSync("git", ["init", "-b", "main"], { cwd: repository, stdio: "ignore" });
  spawnSync("git", ["add", "tracked.txt"], { cwd: repository, stdio: "ignore" });
  spawnSync("git", ["-c", "user.name=Code Workspace", "-c", "user.email=workspace@example.invalid", "commit", "-m", "initial"], { cwd: repository, stdio: "ignore" });
  spawnSync("git", ["switch", "-c", "feature/work"], { cwd: repository, stdio: "ignore" });
  const content = [
    "schemaVersion: 2",
    "workspace:",
    "  name: branch-inspect",
    "  uuid: 123e4567-e89b-42d3-a456-426614174000",
    "  language: invalid",
    "monitor:",
    "  url: not-a-valid-url",
    "projects:",
    "  - name: service",
    `    location: ${repository}`,
    "    branch: main",
    "    type: backend",
    "    context: service",
    "  - name: unreachable",
    `    location: ${path.join(parent, "does-not-exist")}`,
    "    branch: stale",
    "    type: backend",
    "    context: unreachable",
    "",
  ].join("\n");
  writeConfig(root, content);
  const configFile = path.join(root, ".code-workspace", "config.yaml");

  const inspection = run(root, ["project", "branch", "inspect", "service", "--json"]);
  assert.equal(inspection.status, 0, inspection.stderr);
  const inspectionEnvelope = JSON.parse(inspection.stdout);
  assert.equal(inspectionEnvelope.command, "project.branch.inspect");
  assert.deepEqual(inspectionEnvelope.data, {
    project: { name: "service", location: fs.realpathSync(repository) },
    registeredBranch: "main",
    actualBranch: "feature/work",
    matches: false,
    worktreeClean: true,
    registeredBranchExists: true,
    remoteBranchCandidates: [],
  });
  assert.doesNotMatch(JSON.stringify(inspectionEnvelope.data), /configuredBranch|previousBranch|expectedBranch|requestedBranch|savedBranch/);
  const inspectionText = run(root, ["project", "branch", "inspect", "service"]);
  assert.equal(inspectionText.status, 0, inspectionText.stderr);
  assert.match(inspectionText.stdout, /service\s+main\s+feature\/work\s+mismatch/);

  const missing = run(root, ["project", "branch", "inspect", "missing", "--json"]);
  assert.equal(missing.status, 1);
  assert.equal(JSON.parse(missing.stdout).diagnostics[0].code, "PROJECT_NOT_FOUND");

  const unconfirmed = run(root, ["project", "branch", "accept-actual", "service", "--json"]);
  assert.equal(unconfirmed.status, 1);
  assert.equal(JSON.parse(unconfirmed.stdout).diagnostics[0].code, "CLI_CONFIRMATION_REQUIRED");
  assert.equal(fs.readFileSync(configFile, "utf8"), content);

  const accepted = run(root, ["project", "branch", "accept-actual", "service", "--yes", "--json"]);
  assert.equal(accepted.status, 0, accepted.stderr);
  const acceptedEnvelope = JSON.parse(accepted.stdout);
  assert.equal(acceptedEnvelope.command, "project.branch.accept-actual");
  assert.deepEqual(acceptedEnvelope.data.before, { registeredBranch: "main", actualBranch: "feature/work" });
  assert.deepEqual(acceptedEnvelope.data.after, { registeredBranch: "feature/work", actualBranch: "feature/work" });
  assert.deepEqual(Object.keys(acceptedEnvelope), ["schemaVersion", "ok", "command", "data", "diagnostics"]);
  assert.equal(loadConfigProjection(root, ["projects"]).projects.find((entry) => entry.name === "service").branch, "feature/work");
  assert.match(fs.readFileSync(configFile, "utf8"), /url: not-a-valid-url/);
  assert.match(fs.readFileSync(configFile, "utf8"), /language: invalid/);

  const matched = run(root, ["project", "branch", "inspect", "service", "--json"]);
  assert.equal(matched.status, 0, matched.stderr);
  assert.equal(JSON.parse(matched.stdout).data.matches, true);

  const committed = fs.readFileSync(configFile);
  const repeated = run(root, ["project", "branch", "accept-actual", "service", "--json"]);
  assert.equal(repeated.status, 0, repeated.stderr);
  assert.equal(JSON.parse(repeated.stdout).data.action, "skip");
  assert.deepEqual(fs.readFileSync(configFile), committed);
});

test("project branch verify checks only branch equality and supports best-effort batches", () => {
  const parent = temporaryRoot();
  const root = path.join(parent, "workspace");
  const matched = path.join(root, "matched");
  const mismatched = path.join(parent, "mismatched");
  fs.mkdirSync(root);
  fs.mkdirSync(matched);
  fs.mkdirSync(mismatched);
  for (const repository of [matched, mismatched]) {
    fs.writeFileSync(path.join(repository, "tracked.txt"), "initial\n");
    spawnSync("git", ["init", "-b", "main"], { cwd: repository, stdio: "ignore" });
    spawnSync("git", ["add", "tracked.txt"], { cwd: repository, stdio: "ignore" });
    spawnSync("git", ["-c", "user.name=Code Workspace", "-c", "user.email=workspace@example.invalid", "commit", "-m", "initial"], { cwd: repository, stdio: "ignore" });
  }
  spawnSync("git", ["switch", "-c", "feature/work"], { cwd: mismatched, stdio: "ignore" });
  fs.writeFileSync(path.join(matched, "untracked.txt"), "branch verification ignores cleanliness\n");
  const project = (name, location) => [
    `  - name: ${name}`,
    `    location: ${location}`,
    "    branch: main",
    "    type: backend",
    `    context: ${name}`,
  ].join("\n");
  writeConfig(root, [
    "schemaVersion: 2",
    "workspace:",
    "  name: branch-verify",
    "  uuid: 123e4567-e89b-42d3-a456-426614174000",
    "monitor:",
    "  enable: false",
    "projects:",
    project("matched", matched),
    project("mismatched", mismatched),
    "",
  ].join("\n"));

  const singleSuccess = run(root, ["project", "branch", "verify", "matched", "--json"]);
  assert.equal(singleSuccess.status, 0, singleSuccess.stderr);
  const successEnvelope = JSON.parse(singleSuccess.stdout);
  assert.equal(successEnvelope.command, "project.branch.verify");
  assert.deepEqual(successEnvelope.data, {
    project: { name: "matched", location: fs.realpathSync(matched) },
    registeredBranch: "main",
    actualBranch: "main",
    matches: true,
  });

  const broadVerification = run(root, ["project", "verify", "matched", "--json"]);
  assert.equal(broadVerification.status, 1);
  assert(JSON.parse(broadVerification.stdout).diagnostics.some((entry) => entry.code === "PROJECT_OVERLAPS_WORKSPACE"));

  const singleMismatch = run(root, ["project", "branch", "verify", "mismatched", "--json"]);
  assert.equal(singleMismatch.status, 1);
  const mismatchEnvelope = JSON.parse(singleMismatch.stdout);
  assert.equal(mismatchEnvelope.command, "project.branch.verify");
  assert.equal(mismatchEnvelope.data.matches, false);
  assert.equal(mismatchEnvelope.diagnostics[0].code, "PROJECT_BRANCH_MISMATCH");
  assert.deepEqual({
    registeredBranch: mismatchEnvelope.diagnostics[0].registeredBranch,
    actualBranch: mismatchEnvelope.diagnostics[0].actualBranch,
  }, { registeredBranch: "main", actualBranch: "feature/work" });

  const batch = run(root, ["project", "branch", "verify", "mismatched", "missing", "matched", "--json"]);
  assert.equal(batch.status, 1);
  const batchEnvelope = JSON.parse(batch.stdout);
  assert.equal(batchEnvelope.data.scope, "selection");
  assert.deepEqual(batchEnvelope.data.results.map((entry) => [entry.project, entry.ok, entry.data?.matches]), [
    ["mismatched", false, false],
    ["missing", false, undefined],
    ["matched", true, true],
  ]);
  assert.deepEqual(batchEnvelope.data.summary, { total: 3, succeeded: 1, skipped: 0, failed: 2 });
  assert.deepEqual(batchEnvelope.diagnostics.map((entry) => entry.code), ["PROJECT_BRANCH_MISMATCH", "PROJECT_NOT_FOUND"]);

  const commaSeparated = run(root, ["project", "branch", "verify", "matched,mismatched", "--json"]);
  assert.equal(commaSeparated.status, 1);
  assert.equal(JSON.parse(commaSeparated.stdout).diagnostics[0].code, "PROJECT_NOT_FOUND");
});

test("project branch use-registered enforces safety and leaves configuration unchanged", () => {
  const parent = temporaryRoot();
  const root = path.join(parent, "workspace");
  const repository = path.join(parent, "service");
  fs.mkdirSync(root);
  fs.mkdirSync(repository);
  fs.writeFileSync(path.join(repository, "tracked.txt"), "initial\n");
  spawnSync("git", ["init", "-b", "main"], { cwd: repository, stdio: "ignore" });
  spawnSync("git", ["add", "tracked.txt"], { cwd: repository, stdio: "ignore" });
  spawnSync("git", ["-c", "user.name=Code Workspace", "-c", "user.email=workspace@example.invalid", "commit", "-m", "initial"], { cwd: repository, stdio: "ignore" });
  spawnSync("git", ["switch", "-c", "feature/work"], { cwd: repository, stdio: "ignore" });
  const render = (registeredBranch) => [
    "schemaVersion: 2",
    "workspace:",
    "  name: branch-switch",
    "  uuid: 123e4567-e89b-42d3-a456-426614174000",
    "monitor:",
    "  url: not-a-valid-url",
    "projects:",
    "  - name: service",
    `    location: ${repository}`,
    `    branch: ${registeredBranch}`,
    "    type: backend",
    "    context: service",
    "",
  ].join("\n");
  writeConfig(root, render("main"));
  const configFile = path.join(root, ".code-workspace", "config.yaml");
  const configBefore = fs.readFileSync(configFile);

  const unconfirmed = run(root, ["project", "branch", "use-registered", "service", "--json"]);
  assert.equal(unconfirmed.status, 1);
  assert.equal(JSON.parse(unconfirmed.stdout).diagnostics[0].code, "CLI_CONFIRMATION_REQUIRED");
  assert.equal(spawnSync("git", ["branch", "--show-current"], { cwd: repository, encoding: "utf8" }).stdout.trim(), "feature/work");

  const switched = run(root, ["project", "branch", "use-registered", "service", "--yes", "--json"]);
  assert.equal(switched.status, 0, switched.stderr);
  const envelope = JSON.parse(switched.stdout);
  assert.equal(envelope.command, "project.branch.use-registered");
  assert.deepEqual(envelope.data.before, { registeredBranch: "main", actualBranch: "feature/work" });
  assert.deepEqual(envelope.data.after, { registeredBranch: "main", actualBranch: "main" });
  assert.equal(spawnSync("git", ["branch", "--show-current"], { cwd: repository, encoding: "utf8" }).stdout.trim(), "main");
  assert.deepEqual(fs.readFileSync(configFile), configBefore);

  const repeated = run(root, ["project", "branch", "use-registered", "service", "--json"]);
  assert.equal(repeated.status, 0, repeated.stderr);
  assert.equal(JSON.parse(repeated.stdout).data.action, "skip");

  spawnSync("git", ["switch", "feature/work"], { cwd: repository, stdio: "ignore" });
  fs.writeFileSync(path.join(repository, "uncommitted.txt"), "dirty\n");
  const dirty = run(root, ["project", "branch", "use-registered", "service", "--yes", "--json"]);
  assert.equal(dirty.status, 1);
  assert.equal(JSON.parse(dirty.stdout).diagnostics[0].code, "PROJECT_WORKTREE_DIRTY");
  assert.equal(spawnSync("git", ["branch", "--show-current"], { cwd: repository, encoding: "utf8" }).stdout.trim(), "feature/work");
  fs.unlinkSync(path.join(repository, "uncommitted.txt"));

  writeConfig(root, render("missing-local"));
  const missing = run(root, ["project", "branch", "use-registered", "service", "--yes", "--json"]);
  assert.equal(missing.status, 1);
  assert.equal(JSON.parse(missing.stdout).diagnostics[0].code, "PROJECT_REGISTERED_BRANCH_MISSING");
  assert.equal(spawnSync("git", ["branch", "--show-current"], { cwd: repository, encoding: "utf8" }).stdout.trim(), "feature/work");
});

test("project branch use-registered can explicitly use a remote-tracking branch or fetch a remote", () => {
  const parent = temporaryRoot();
  const root = path.join(parent, "workspace");
  const source = path.join(parent, "source");
  const remote = path.join(parent, "origin.git");
  const repository = path.join(parent, "service");
  fs.mkdirSync(root);
  fs.mkdirSync(source);
  fs.writeFileSync(path.join(source, "tracked.txt"), "initial\n");
  spawnSync("git", ["init", "-b", "main"], { cwd: source, stdio: "ignore" });
  spawnSync("git", ["add", "tracked.txt"], { cwd: source, stdio: "ignore" });
  spawnSync("git", ["-c", "user.name=Code Workspace", "-c", "user.email=workspace@example.invalid", "commit", "-m", "initial"], { cwd: source, stdio: "ignore" });
  spawnSync("git", ["clone", "--bare", source, remote], { stdio: "ignore" });

  spawnSync("git", ["clone", remote, repository], { stdio: "ignore" });
  spawnSync("git", ["switch", "-c", "feature/work"], { cwd: repository, stdio: "ignore" });
  spawnSync("git", ["branch", "-D", "main"], { cwd: repository, stdio: "ignore" });
  writeConfig(root, [
    "schemaVersion: 2",
    "workspace:",
    "  name: remote-branch",
    "  uuid: 123e4567-e89b-42d3-a456-426614174000",
    "monitor:",
    "  url: http://127.0.0.1:3211",
    "projects:",
    `  - name: service\n    location: ${repository}\n    branch: main\n    type: backend\n    context: service`,
    "",
  ].join("\n"));

  const conflicting = run(root, ["project", "branch", "use-registered", "service", "--allow-remote", "--remote", "origin", "--yes", "--json"]);
  assert.equal(conflicting.status, 1);
  assert.equal(JSON.parse(conflicting.stdout).diagnostics[0].code, "CLI_OPTION_CONFLICT");
  assert.equal(spawnSync("git", ["branch", "--show-current"], { cwd: repository, encoding: "utf8" }).stdout.trim(), "feature/work");

  const unconfirmed = run(root, ["project", "branch", "use-registered", "service", "--allow-remote", "--json"]);
  assert.equal(unconfirmed.status, 1);
  assert.equal(JSON.parse(unconfirmed.stdout).diagnostics[0].code, "CLI_CONFIRMATION_REQUIRED");
  assert.equal(spawnSync("git", ["branch", "--show-current"], { cwd: repository, encoding: "utf8" }).stdout.trim(), "feature/work");

  const tracked = run(root, ["project", "branch", "use-registered", "service", "--allow-remote", "--yes", "--json"]);
  assert.equal(tracked.status, 0, tracked.stderr);
  const trackedEnvelope = JSON.parse(tracked.stdout);
  assert.equal(trackedEnvelope.data.acquisition.mode, "remote-tracking");
  assert.equal(trackedEnvelope.data.acquisition.remoteBranch, "origin/main");
  assert.equal(spawnSync("git", ["branch", "--show-current"], { cwd: repository, encoding: "utf8" }).stdout.trim(), "main");

  const fetchRoot = path.join(parent, "fetch-workspace");
  const fetchRepository = path.join(parent, "fetch-service");
  fs.mkdirSync(fetchRoot);
  spawnSync("git", ["clone", remote, fetchRepository], { stdio: "ignore" });
  spawnSync("git", ["switch", "-c", "feature/work"], { cwd: fetchRepository, stdio: "ignore" });
  spawnSync("git", ["branch", "-D", "main"], { cwd: fetchRepository, stdio: "ignore" });
  spawnSync("git", ["update-ref", "-d", "refs/remotes/origin/main"], { cwd: fetchRepository, stdio: "ignore" });
  writeConfig(fetchRoot, [
    "schemaVersion: 2",
    "workspace:",
    "  name: fetch-branch",
    "  uuid: 123e4567-e89b-42d3-a456-426614174001",
    "monitor:",
    "  url: http://127.0.0.1:3212",
    "projects:",
    `  - name: service\n    location: ${fetchRepository}\n    branch: main\n    type: backend\n    context: service`,
    "",
  ].join("\n"));
  const fetched = run(fetchRoot, ["project", "branch", "use-registered", "service", "--remote", "origin", "--yes", "--json"]);
  assert.equal(fetched.status, 0, fetched.stderr);
  assert.equal(JSON.parse(fetched.stdout).data.acquisition.mode, "fetched");
  assert.equal(spawnSync("git", ["branch", "--show-current"], { cwd: fetchRepository, encoding: "utf8" }).stdout.trim(), "main");
});

test("batch branch commands continue after project failures and report one ordered summary", () => {
  const parent = temporaryRoot();
  const root = path.join(parent, "workspace");
  fs.mkdirSync(root);
  const makeRepository = (name, actualBranch, dirty = false) => {
    const repository = path.join(parent, name);
    fs.mkdirSync(repository);
    fs.writeFileSync(path.join(repository, "tracked.txt"), "initial\n");
    spawnSync("git", ["init", "-b", "main"], { cwd: repository, stdio: "ignore" });
    spawnSync("git", ["add", "tracked.txt"], { cwd: repository, stdio: "ignore" });
    spawnSync("git", ["-c", "user.name=Code Workspace", "-c", "user.email=workspace@example.invalid", "commit", "-m", "initial"], { cwd: repository, stdio: "ignore" });
    if (actualBranch !== "main") spawnSync("git", ["switch", "-c", actualBranch], { cwd: repository, stdio: "ignore" });
    if (dirty) fs.writeFileSync(path.join(repository, "uncommitted.txt"), "dirty\n");
    return repository;
  };
  const switchable = makeRepository("switchable", "feature/switch");
  const dirty = makeRepository("dirty", "feature/dirty", true);
  const acceptable = makeRepository("acceptable", "feature/accept");
  const matched = makeRepository("matched", "main");
  const project = (name, location) => [
    `  - name: ${name}`,
    `    location: ${location}`,
    "    branch: main",
    "    type: backend",
    `    context: ${name}`,
  ].join("\n");
  writeConfig(root, [
    "schemaVersion: 2",
    "workspace:",
    "  name: branch-batch",
    "  uuid: 123e4567-e89b-42d3-a456-426614174000",
    "monitor:",
    "  url: http://127.0.0.1:3211",
    "projects:",
    project("switchable", switchable),
    project("dirty", dirty),
    project("acceptable", acceptable),
    project("matched", matched),
    "",
  ].join("\n"));

  const inspected = run(root, ["project", "branch", "inspect", "switchable", "missing", "dirty", "--json"]);
  assert.equal(inspected.status, 1);
  const inspectedEnvelope = JSON.parse(inspected.stdout);
  assert.equal(inspectedEnvelope.data.scope, "selection");
  assert.deepEqual(inspectedEnvelope.data.requested, ["switchable", "missing", "dirty"]);
  assert.deepEqual(inspectedEnvelope.data.results.map((entry) => [entry.project, entry.ok]), [
    ["switchable", true],
    ["missing", false],
    ["dirty", true],
  ]);
  assert.deepEqual(inspectedEnvelope.data.summary, { total: 3, succeeded: 2, skipped: 0, failed: 1 });
  assert.equal(inspectedEnvelope.diagnostics.find((entry) => entry.project === "missing").code, "PROJECT_NOT_FOUND");

  const commaSeparated = run(root, ["project", "branch", "inspect", "switchable,dirty", "--json"]);
  assert.equal(commaSeparated.status, 1);
  assert.equal(JSON.parse(commaSeparated.stdout).diagnostics[0].code, "PROJECT_NOT_FOUND");

  const inspectedText = run(root, ["project", "branch", "inspect", "missing", "matched"]);
  assert.equal(inspectedText.status, 1);
  assert.match(inspectedText.stderr, /Unknown local project: missing/);
  assert.match(inspectedText.stdout, /OK\s+matched/);
  assert.match(inspectedText.stdout, /failed=1/);

  const unconfirmed = run(root, ["project", "branch", "use-registered", "switchable", "dirty", "--json"]);
  assert.equal(unconfirmed.status, 1);
  assert.equal(JSON.parse(unconfirmed.stdout).diagnostics[0].code, "CLI_CONFIRMATION_REQUIRED");
  assert.equal(spawnSync("git", ["branch", "--show-current"], { cwd: switchable, encoding: "utf8" }).stdout.trim(), "feature/switch");

  const switched = run(root, ["project", "branch", "use-registered", "dirty", "switchable", "missing", "--yes", "--json"]);
  assert.equal(switched.status, 1);
  const switchedEnvelope = JSON.parse(switched.stdout);
  assert.deepEqual(switchedEnvelope.data.results.map((entry) => [entry.project, entry.ok, entry.action]), [
    ["dirty", false, "failed"],
    ["switchable", true, "switch"],
    ["missing", false, "failed"],
  ]);
  assert.deepEqual(switchedEnvelope.data.summary, { total: 3, succeeded: 1, skipped: 0, failed: 2 });
  assert.equal(spawnSync("git", ["branch", "--show-current"], { cwd: dirty, encoding: "utf8" }).stdout.trim(), "feature/dirty");
  assert.equal(spawnSync("git", ["branch", "--show-current"], { cwd: switchable, encoding: "utf8" }).stdout.trim(), "main");

  const accepted = run(root, ["project", "branch", "accept-actual", "missing", "acceptable", "--yes", "--json"]);
  assert.equal(accepted.status, 1);
  const acceptedEnvelope = JSON.parse(accepted.stdout);
  assert.deepEqual(acceptedEnvelope.data.results.map((entry) => [entry.project, entry.ok, entry.action]), [
    ["missing", false, "failed"],
    ["acceptable", true, "update"],
  ]);
  assert.equal(loadConfigProjection(root, ["projects"]).projects.find((entry) => entry.name === "acceptable").branch, "feature/accept");

  const verified = run(root, ["project", "verify", "dirty", "switchable", "missing", "matched", "--json"]);
  assert.equal(verified.status, 1);
  const verifiedEnvelope = JSON.parse(verified.stdout);
  assert.equal(verifiedEnvelope.data.scope, "selection");
  assert.deepEqual(verifiedEnvelope.data.results.map((entry) => [entry.project, entry.ok]), [
    ["dirty", false],
    ["switchable", true],
    ["missing", false],
    ["matched", true],
  ]);
  assert.deepEqual(verifiedEnvelope.data.summary, { total: 4, succeeded: 2, skipped: 0, failed: 2 });

  const duplicate = run(root, ["project", "branch", "inspect", "matched", "matched", "--json"]);
  assert.equal(duplicate.status, 0, duplicate.stderr);
  const duplicateEnvelope = JSON.parse(duplicate.stdout);
  assert.equal(duplicateEnvelope.data.results.length, 1);
  assert.equal(duplicateEnvelope.diagnostics[0].code, "CLI_DUPLICATE_ARGUMENT");
  assert.equal(duplicateEnvelope.diagnostics[0].severity, "warning");
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
    "  - name: unreachable",
    `    location: ${path.join(parent, "does-not-exist")}`,
    "    branch: stale",
    "    type: backend",
    "    context: unreachable",
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
  const unrelatedMismatch = JSON.parse(unrelated.stdout).diagnostics.find((entry) => entry.code === "PROJECT_BRANCH_MISMATCH");
  assert.deepEqual({
    registeredBranch: unrelatedMismatch.registeredBranch,
    actualBranch: unrelatedMismatch.actualBranch,
  }, { registeredBranch: "stale", actualBranch: "main" });
  assert.equal("configuredBranch" in unrelatedMismatch, false);

  const unreachableSelected = run(root, ["project", "verify", "unreachable", "--json"]);
  assert.equal(unreachableSelected.status, 1);
  assert(JSON.parse(unreachableSelected.stdout).diagnostics.some((entry) => entry.code === "PROJECT_INSPECTION_FAILED"));

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
    path.resolve(__dirname, "..", "..", "docs", "code-workspace-flow.zh-CN.md"),
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

test("final branch migration leaves no legacy public contract in implementation or managed documentation", () => {
  const repositoryRoot = path.resolve(__dirname, "..", "..");
  const files = [
    "src/cli/registry.js",
    "src/cli/commands/project.js",
    "src/cli/commands/project-branch.js",
    "src/core/config.js",
    "src/core/project.js",
    "src/core/validation.js",
    "README.md",
    "README.zh-CN.md",
    "docs/code-workspace-flow.zh-CN.md",
    "artifacts/templates/agents/WORKSPACE_GUARD.md.template",
    "artifacts/templates/agents/skills/code-workspace-resolve-branch/SKILL.md",
    "artifacts/templates/user-guide/en-US.md",
    "artifacts/templates/user-guide/zh-CN.md",
  ];
  const forbidden = [
    ["sync", "branch"].join("-"),
    ...[
      ["configured", "Branch"],
      ["previous", "Branch"],
      ["expected", "Branch"],
      ["requested", "Branch"],
      ["saved", "Branch"],
    ].map((parts) => parts.join("")),
  ];
  for (const relative of files) {
    const source = fs.readFileSync(path.join(repositoryRoot, relative), "utf8");
    for (const value of forbidden) assert.doesNotMatch(source, new RegExp(value), `${relative}: ${value}`);
  }

  const help = run(os.tmpdir(), ["help"]);
  const completion = run(os.tmpdir(), ["completion", "--shell", "bash"]);
  assert.equal(help.status, 0, help.stderr);
  assert.equal(completion.status, 0, completion.stderr);
  for (const value of forbidden) {
    assert.doesNotMatch(help.stdout, new RegExp(value), `help: ${value}`);
    assert.doesNotMatch(completion.stdout, new RegExp(value), `completion: ${value}`);
  }

  const userGuides = [
    "artifacts/templates/user-guide/en-US.md",
    "artifacts/templates/user-guide/zh-CN.md",
  ];
  const forbiddenGuideDetails = [
    /code-w project branch/,
    /`project branch (?:inspect|verify|accept-actual|use-registered)/,
    /registeredBranch/,
    /actualBranch/,
    /projects\[\]\.branch/,
    /worktreeClean/,
    /registeredBranchExists/,
  ];
  for (const relative of userGuides) {
    const source = fs.readFileSync(path.join(repositoryRoot, relative), "utf8");
    assert.match(source, /code-workspace-resolve-branch/, `${relative}: missing user-facing branch Skill`);
    for (const pattern of forbiddenGuideDetails) {
      assert.doesNotMatch(source, pattern, `${relative}: ${pattern}`);
    }
  }
});
