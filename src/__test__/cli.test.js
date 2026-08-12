const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { createHash } = require("node:crypto");
const test = require("node:test");
const yaml = require("js-yaml");

const packageRoot = path.resolve(__dirname, "..", "..");
const cli = path.join(packageRoot, "bin", "openspec-workspace.js");

function temporaryRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "openspec-workspace-cli-"));
}

function run(cwd, args) {
  return spawnSync(process.execPath, [cli, ...args], { cwd, encoding: "utf8" });
}

function jsonData(result) {
  const envelope = JSON.parse(result.stdout);
  assert.equal(envelope.schemaVersion, 1);
  assert.equal(typeof envelope.ok, "boolean");
  assert(Object.prototype.hasOwnProperty.call(envelope, "command"));
  assert(Object.prototype.hasOwnProperty.call(envelope, "data"));
  assert(Array.isArray(envelope.diagnostics));
  return envelope.data;
}

function loadWorkspaceYaml(root) {
  return yaml.load(fs.readFileSync(path.join(root, ".openspec-workspace", "config.yaml"), "utf8"));
}

function gitRepository(parent, name) {
  const directory = path.join(parent, name);
  fs.mkdirSync(path.join(directory, "src"), { recursive: true });
  fs.writeFileSync(path.join(directory, "package.json"), JSON.stringify({ name, dependencies: { react: "18.0.0" } }));
  spawnSync("git", ["init", "-b", "main"], { cwd: directory, stdio: "ignore" });
  return directory;
}

test("init installs only workspace-owned integrations and does not create openspec content", () => {
  const root = temporaryRoot();
  const result = run(root, ["init", ".", "--tools", "claude,codex", "--yes", "--json"]);
  assert.equal(result.status, 0, result.stderr);
  const output = jsonData(result);
  assert.deepEqual(output.stages, [
    "Configure workspace identity",
    "Validate manifest",
    "Install workspace dependencies",
    "Remove obsolete managed files",
    "Install managed files",
    "Prepare local workspace configuration",
    "Synchronize Codex workspace permissions",
    "Run strict workspace doctor",
    "Commit local initialization state",
    "Verify local initialization state",
  ]);
  assert.equal(output.openspec, undefined);
  assert.equal(output.language, "zh-CN");
  assert(fs.existsSync(path.join(root, ".openspec-workspace", "config.yaml")));
  assert.equal(output.workspace.name, "openspec-workspace");
  assert.match(output.workspace.uuid, /^[0-9a-f-]{36}$/);
  assert.deepEqual(output.monitor, { enable: true, url: "http://127.0.0.1:3211" });
  assert(fs.existsSync(path.join(root, ".codex", "hooks.json")));
  assert.match(fs.readFileSync(path.join(root, ".gitignore"), "utf8"), /\.openspec-workspace\//);
  const expected = [
    ".claude/commands/opswx/add-projects.md",
    ".claude/skills/openspec-workspace-add-projects/SKILL.md",
    ".claude/skills/openspec-workspace-resolve-branch/SKILL.md",
    ".codex/skills/openspec-workspace-add-projects/SKILL.md",
    ".codex/skills/openspec-workspace-resolve-branch/SKILL.md",
    ".codex/hooks.json",
    "CLAUDE.md",
    "AGENTS.md",
    "USER_GUIDE.md",
  ];
  for (const file of expected) assert(fs.existsSync(path.join(root, file)), file);
  assert.equal(output.managedFiles.filter((entry) => entry.action === "write").length, 9);
  assert.equal(output.workspace.language, "zh-CN");
  assert.match(fs.readFileSync(path.join(root, "USER_GUIDE.md"), "utf8"), /OpenSpec Workspace 用户指南/);
  assert.equal(fs.existsSync(path.join(root, "openspec")), false);
  const claudeInstructions = fs.readFileSync(path.join(root, "CLAUDE.md"), "utf8");
  const codexInstructions = fs.readFileSync(path.join(root, "AGENTS.md"), "utf8");
  assert.match(claudeInstructions, /The workspace is not a project/);
  assert.match(claudeInstructions, /\/opswx:add-projects \/absolute\/path\/to\/project/);
  assert.match(codexInstructions, /The workspace is not a project/);
  assert.match(codexInstructions, /\$openspec-workspace-add-projects \/absolute\/path\/to\/project/);
  for (const instructions of [claudeInstructions, codexInstructions]) {
    assert.match(instructions, /openspec-w project list --json/);
    assert.match(instructions, /openspec-w project verify "<project\.name>" --json/);
    assert.match(instructions, /openspec-workspace-resolve-branch/);
    assert.doesNotMatch(instructions, /OpenSpec owns|Cross-project|Every capability/);
  }
  const addProjectsSkill = fs.readFileSync(path.join(root, ".codex", "skills", "openspec-workspace-add-projects", "SKILL.md"), "utf8");
  const resolveBranchSkill = fs.readFileSync(path.join(root, ".codex", "skills", "openspec-workspace-resolve-branch", "SKILL.md"), "utf8");
  const addProjectsCommand = fs.readFileSync(path.join(root, ".claude", "commands", "opswx", "add-projects.md"), "utf8");
  assert.match(addProjectsSkill, /project inspect ["']?<path>["']? --json/);
  assert.match(addProjectsSkill, /project add --projects-file/);
  assert.match(addProjectsSkill, /explicitly invokes `\$openspec-workspace-add-projects`/);
  assert.match(addProjectsSkill, /\$openspec-workspace-add-projects \/absolute\/path\/to\/project-a \/absolute\/path\/to\/project-b/);
  assert.match(addProjectsSkill, /Do not infer this invocation/);
  assert.match(addProjectsSkill, /openspec-workspace language --json/);
  assert.match(addProjectsSkill, /corresponding label returned in `data\.projectContext`/);
  assert.match(addProjectsSkill, /standard envelope fields `schemaVersion`, `ok`, `command`, `data`, and `diagnostics`/);
  assert.doesNotMatch(addProjectsSkill, /For `zh-CN`|For `en-US`/);
  assert.match(resolveBranchSkill, /project sync-branch "<project\.name>" --yes --json/);
  assert.match(resolveBranchSkill, /project verify "<project\.name>" --json/);
  assert.match(addProjectsCommand, /project inspect ["']?<path>["']? --json/);
  assert.match(addProjectsCommand, /explicitly invokes `\/opswx:add-projects`/);
  assert.match(addProjectsCommand, /\/opswx:add-projects \/absolute\/path\/to\/project-a \/absolute\/path\/to\/project-b/);
  assert.match(addProjectsCommand, /The values in `\$ARGUMENTS` are the project paths/);
  assert.match(addProjectsCommand, /Do not infer this invocation/);
  assert.match(addProjectsCommand, /openspec-workspace language --json/);
  assert(!fs.existsSync(path.join(root, ".claude", "commands", "opsxw", "explore.md")));
  assert(!fs.existsSync(path.join(root, ".codex", "skills", "openspec-workspace-explore", "SKILL.md")));
  const state = JSON.parse(fs.readFileSync(path.join(root, ".openspec-workspace", "state.json"), "utf8"));
  assert.equal(state.status, "healthy");
  assert.deepEqual(state.tools, ["claude", "codex"]);
  assert.equal(state.workspaceLanguage, undefined);
});

test("workspace language command reports the configured workspace language", () => {
  const root = temporaryRoot();
  const initialized = run(root, ["init", ".", "--tools", "none", "--language", "en-US", "--yes", "--json"]);
  assert.equal(initialized.status, 0, initialized.stderr);
  assert.equal(jsonData(initialized).language, "en-US");
  assert.equal(yaml.load(fs.readFileSync(path.join(root, ".openspec-workspace", "config.yaml"), "utf8")).workspace.language, "en-US");
  assert.equal(fs.existsSync(path.join(root, "openspec")), false);

  const plain = run(root, ["language"]);
  assert.equal(plain.status, 0, plain.stderr);
  assert.equal(plain.stdout, "en-US\n");

  const json = run(root, ["language", "--json"]);
  assert.equal(json.status, 0, json.stderr);
  assert.deepEqual(jsonData(json), {
    language: "en-US",
    label: "English",
    projectContext: {
      responsibility: "Responsibility",
      technologyStack: "Technology stack",
      codeLocations: "Code locations",
      projectBoundary: "Project boundary",
    },
  });
});

test("init defaults its target path to the current directory", () => {
  const root = temporaryRoot();
  const result = run(root, ["init", "--tools", "none", "--yes", "--json"]);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(jsonData(result).root, fs.realpathSync(root));
  assert(fs.existsSync(path.join(root, ".openspec-workspace", "config.yaml")));
});

test("update changes workspace language and its derived managed artifacts", () => {
  const root = temporaryRoot();
  assert.equal(run(root, ["init", ".", "--tools", "none", "--language", "zh-CN", "--yes", "--json"]).status, 0);
  assert.match(fs.readFileSync(path.join(root, "USER_GUIDE.md"), "utf8"), /^# OpenSpec Workspace 用户指南/m);

  const updated = run(root, ["update", "--tools", "none", "--language", "en-US", "--json"]);
  assert.equal(updated.status, 0, updated.stderr);
  const output = jsonData(updated);
  assert.equal(output.language, "en-US");
  assert.equal(yaml.load(fs.readFileSync(path.join(root, ".openspec-workspace", "config.yaml"), "utf8")).workspace.language, "en-US");
  assert.match(fs.readFileSync(path.join(root, "USER_GUIDE.md"), "utf8"), /^# OpenSpec Workspace User Guide/m);
  assert.equal(fs.existsSync(path.join(root, "openspec")), false);
  assert(!fs.existsSync(path.join(root, "USER_GUIDE.zh-CN.md")));

  const repeated = run(root, ["update", "--tools", "none", "--json"]);
  assert.equal(repeated.status, 0, repeated.stderr);
  assert.equal(jsonData(repeated).language, "en-US");
});

test("language update leaves existing project context unchanged", () => {
  const root = temporaryRoot();
  assert.equal(run(root, ["init", ".", "--tools", "none", "--language", "zh-CN", "--yes", "--json"]).status, 0);
  const configFile = path.join(root, ".openspec-workspace", "config.yaml");
  const config = loadWorkspaceYaml(root);
  config.projects.push({
    name: "portal",
    location: "/tmp/portal",
    branch: "main",
    type: "frontend",
    context: "职责：保持原有中文内容。",
  });
  fs.writeFileSync(configFile, yaml.dump(config));

  const updated = run(root, ["update", "--tools", "none", "--language", "en-US", "--json"]);
  assert.equal(updated.status, 0, updated.stderr);
  assert.equal(loadWorkspaceYaml(root).projects[0].context, "职责：保持原有中文内容。");
});

test("language update protects local guide changes and suggests force without partial writes", () => {
  const root = temporaryRoot();
  assert.equal(run(root, ["init", ".", "--tools", "none", "--language", "zh-CN", "--yes", "--json"]).status, 0);
  const guide = path.join(root, "USER_GUIDE.md");
  fs.appendFileSync(guide, "\nlocal guide edit\n");

  const blocked = run(root, ["update", "--tools", "none", "--language", "en-US"]);
  assert.equal(blocked.status, 1);
  assert.match(blocked.stderr, /No configuration or artifacts were changed/);
  assert.match(blocked.stderr, /update --language en-US --force/);
  assert.equal(loadWorkspaceYaml(root).workspace.language, "zh-CN");
  assert.match(fs.readFileSync(guide, "utf8"), /local guide edit/);

  const forced = run(root, ["update", "--tools", "none", "--language", "en-US", "--force", "--json"]);
  assert.equal(forced.status, 0, forced.stderr);
  assert.deepEqual(jsonData(forced).forcedUnknown, ["USER_GUIDE.md"]);
  assert.equal(loadWorkspaceYaml(root).workspace.language, "en-US");
  assert.doesNotMatch(fs.readFileSync(guide, "utf8"), /local guide edit/);
});

test("language update protects an obsolete localized guide with local changes", () => {
  const root = temporaryRoot();
  assert.equal(run(root, ["init", ".", "--tools", "none", "--language", "zh-CN", "--yes", "--json"]).status, 0);
  const relative = "USER_GUIDE.zh-CN.md";
  const target = path.join(root, relative);
  const managedContent = "previous localized guide\n";
  fs.writeFileSync(target, `${managedContent}local edit\n`);
  const stateFile = path.join(root, ".openspec-workspace", "state.json");
  const state = JSON.parse(fs.readFileSync(stateFile, "utf8"));
  state.managedFiles[relative] = { installedSha256: createHash("sha256").update(managedContent).digest("hex") };
  fs.writeFileSync(stateFile, `${JSON.stringify(state, null, 2)}\n`);

  const blocked = run(root, ["update", "--tools", "none", "--language", "en-US"]);
  assert.equal(blocked.status, 1);
  assert.match(blocked.stderr, /Obsolete managed file contains unknown changes/);
  assert.equal(loadWorkspaceYaml(root).workspace.language, "zh-CN");
  assert.match(fs.readFileSync(target, "utf8"), /local edit/);
});

test("update migrates legacy workspace language state", () => {
  const root = temporaryRoot();
  assert.equal(run(root, ["init", ".", "--tools", "none", "--language", "zh-CN", "--yes", "--json"]).status, 0);
  const configFile = path.join(root, ".openspec-workspace", "config.yaml");
  const stateFile = path.join(root, ".openspec-workspace", "state.json");
  const legacyConfig = yaml.load(fs.readFileSync(configFile, "utf8"));
  legacyConfig.schemaVersion = 1;
  delete legacyConfig.workspace.language;
  fs.writeFileSync(configFile, yaml.dump(legacyConfig));
  const state = JSON.parse(fs.readFileSync(stateFile, "utf8"));
  state.workspaceLanguage = "zh-CN";
  fs.writeFileSync(stateFile, `${JSON.stringify(state, null, 2)}\n`);

  const migrated = run(root, ["update", "--tools", "none", "--json"]);
  assert.equal(migrated.status, 0, migrated.stderr);
  assert.equal(jsonData(migrated).migration.fromVersion, 1);
  assert.equal(jsonData(migrated).migration.language.source, "legacy-state");
  assert(jsonData(migrated).migration.steps.some((step) => step.kind === "workspace-language"));
  assert.equal(loadWorkspaceYaml(root).schemaVersion, 2);
  assert.equal(loadWorkspaceYaml(root).workspace.language, "zh-CN");
  assert.equal(JSON.parse(fs.readFileSync(stateFile, "utf8")).workspaceLanguage, undefined);
});

test("doctor rejects a modified workspace-owned skill", () => {
  const root = temporaryRoot();
  assert.equal(run(root, ["init", ".", "--tools", "codex", "--yes", "--json"]).status, 0);
  const target = path.join(root, ".codex", "skills", "openspec-workspace-add-projects", "SKILL.md");
  fs.appendFileSync(target, "\nlocal modification\n");
  const result = run(root, ["doctor", "--json"]);
  assert.equal(result.status, 1);
  const output = JSON.parse(result.stdout);
  assert(output.diagnostics.some((entry) => entry.code === "MANAGED_FILE_UNKNOWN"));
});

test("update and doctor preserve the workspace tool selection when --tools is omitted", () => {
  const root = temporaryRoot();
  const initialized = run(root, ["init", ".", "--tools", "codex", "--yes", "--json"]);
  assert.equal(initialized.status, 0, initialized.stderr);
  const updated = run(root, ["update", "--json"]);
  assert.equal(updated.status, 0, updated.stderr);
  assert.deepEqual(jsonData(updated).tools, { tools: ["codex"], source: "workspace-state" });
  assert(!fs.existsSync(path.join(root, "CLAUDE.md")));
  assert(!fs.existsSync(path.join(root, ".claude", "commands", "opswx", "add-projects.md")));
  const doctor = run(root, ["doctor", "--json"]);
  assert.equal(doctor.status, 0, doctor.stderr);
  assert.deepEqual(jsonData(doctor).tools, { tools: ["codex"], source: "workspace-state" });
});

test("init optionally installs Codex monitor hooks with a named workspace", () => {
  const root = temporaryRoot();
  const result = run(root, [
    "init", ".", "--tools", "codex", "--monitor",
    "--monitor-url", "http://127.0.0.1:8080",
    "--workspace-name", "payments", "--yes", "--json",
  ]);
  assert.equal(result.status, 0, result.stderr);
  const output = jsonData(result);
  assert.equal(output.workspace.name, "payments");
  assert.equal(output.monitor.enable, true);
  assert.equal(output.monitor.url, "http://127.0.0.1:8080");
  assert(fs.existsSync(path.join(root, ".codex", "hooks.json")));
  assert.equal(output.managedFiles.filter((entry) => entry.action === "write").length, 5);

  const repeated = run(root, ["init", ".", "--tools", "codex", "--monitor", "--yes", "--json"]);
  assert.equal(repeated.status, 0, repeated.stderr);
  const next = jsonData(repeated);
  assert.deepEqual(next.workspace, output.workspace);
  assert.equal(next.managedFiles.filter((entry) => entry.action === "write").length, 0);
});

test("project inspect is read-only and project add registers an explicit record", () => {
  const parent = temporaryRoot();
  const workspace = path.join(parent, "workspace");
  fs.mkdirSync(workspace);
  const repository = gitRepository(parent, "portal");
  assert.equal(run(workspace, ["init", ".", "--tools", "claude", "--yes", "--json"]).status, 0);
  const configBefore = fs.readFileSync(path.join(workspace, ".openspec-workspace", "config.yaml"), "utf8");
  const inspection = run(workspace, ["project", "inspect", repository, "--json"]);
  assert.equal(inspection.status, 0, inspection.stderr);
  const inspectionOutput = jsonData(inspection);
  assert.equal(inspectionOutput.kind, "project-inspection");
  assert.equal(inspectionOutput.project.location, fs.realpathSync(repository));
  assert.equal(inspectionOutput.project.branch, "main");
  assert.deepEqual(inspectionOutput.project.facts.manifestFiles, ["package.json"]);
  assert.equal(fs.readFileSync(path.join(workspace, ".openspec-workspace", "config.yaml"), "utf8"), configBefore);

  const projectFile = path.join(parent, "portal.json");
  fs.writeFileSync(projectFile, JSON.stringify({
    schemaVersion: 1,
    projects: [{
      name: "portal",
      location: fs.realpathSync(repository),
      branch: "main",
      type: "frontend",
      context: "职责：门户页面和交互。\n技术栈：React。\n代码定位：src。\n项目边界：负责门户前端。",
    }],
  }));
  const added = run(workspace, ["project", "add", "--projects-file", projectFile, "--yes", "--json"]);
  assert.equal(added.status, 0, added.stderr);
  assert.equal(jsonData(added).project.name, "portal");

  const repeated = run(workspace, ["project", "add", "--projects-file", projectFile, "--yes", "--json"]);
  assert.equal(repeated.status, 0, repeated.stderr);
  assert.equal(jsonData(repeated).action, "skip");

  const listed = run(workspace, ["project", "list", "--json"]);
  assert.equal(listed.status, 0, listed.stderr);
  assert.equal(jsonData(listed).projects.length, 1);

  const context = run(workspace, ["context", "--json"]);
  assert.equal(context.status, 0, context.stderr);
  assert.equal(jsonData(context).projects[0].name, "portal");
  assert.equal("change" in jsonData(context), false);

  assert.equal(run(workspace, ["project", "verify", "--json"]).status, 0);
  const sync = run(workspace, ["sync", "--json"]);
  assert.equal(sync.status, 0, sync.stderr);
  assert.match(fs.readFileSync(path.join(workspace, ".codex", "config.toml"), "utf8"), /workspace-permissions:openspec-workspace/);
});

test("project add rejects incomplete records and keeps JSON errors machine-readable", () => {
  const parent = temporaryRoot();
  const workspace = path.join(parent, "workspace");
  fs.mkdirSync(workspace);
  const repository = gitRepository(parent, "portal");
  assert.equal(run(workspace, ["init", ".", "--tools", "none", "--yes", "--json"]).status, 0);

  const incomplete = run(workspace, ["project", "add", repository, "--yes", "--json"]);
  assert.equal(incomplete.status, 1);
  const output = JSON.parse(incomplete.stdout);
  assert.equal(output.ok, false);
  assert.equal(output.diagnostics[0].code, "PROJECT_INPUT_FIELD_REQUIRED");
  assert.match(output.diagnostics[0].message, /name/);
});

test("project add validates duplicate names across a batch before writing any project", () => {
  const parent = temporaryRoot();
  const workspace = path.join(parent, "workspace");
  fs.mkdirSync(workspace);
  const frontend = gitRepository(parent, "frontend");
  const backend = gitRepository(parent, "backend");
  assert.equal(run(workspace, ["init", ".", "--tools", "none", "--yes", "--json"]).status, 0);

  const projectsFile = path.join(parent, "projects.json");
  fs.writeFileSync(projectsFile, JSON.stringify({
    schemaVersion: 1,
    projects: [
      {
        name: "shared",
        location: fs.realpathSync(frontend),
        branch: "main",
        type: "frontend",
        context: "职责：前端。",
      },
      {
        name: "shared",
        location: fs.realpathSync(backend),
        branch: "main",
        type: "backend",
        context: "职责：后端。",
      },
    ],
  }));

  const result = run(workspace, ["project", "add", "--projects-file", projectsFile, "--yes", "--json"]);
  assert.equal(result.status, 1);
  assert(JSON.parse(result.stdout).diagnostics.some((entry) => entry.code === "DUPLICATE_PROJECT_NAME"));
  const listed = run(workspace, ["project", "list", "--json"]);
  assert.deepEqual(jsonData(listed).projects, []);
});

test("update protects locally modified managed assets unless forced", () => {
  const root = temporaryRoot();
  assert.equal(run(root, ["init", ".", "--tools", "claude", "--yes", "--json"]).status, 0);
  const target = path.join(root, ".claude", "commands", "opswx", "add-projects.md");
  fs.appendFileSync(target, "\nlocal edit\n");
  const blocked = run(root, ["update", "--tools", "claude"]);
  assert.equal(blocked.status, 1);
  assert.match(blocked.stderr, /unknown changes/);
  const forced = run(root, ["update", "--tools", "claude", "--force"]);
  assert.equal(forced.status, 0, forced.stderr);
  assert.doesNotMatch(fs.readFileSync(target, "utf8"), /local edit/);
  const doctor = run(root, ["doctor", "--json"]);
  assert.equal(doctor.status, 0, doctor.stderr);
  assert.equal(JSON.parse(doctor.stdout).ok, true);
});

test("update leaves existing openspec records untouched", () => {
  const root = temporaryRoot();
  const configTarget = path.join(root, "openspec", "config.yaml");
  const specTarget = path.join(root, "openspec", "specs", "payments", "spec.md");
  fs.mkdirSync(path.dirname(specTarget), { recursive: true });
  fs.writeFileSync(configTarget, "schema: user-owned\n");
  fs.writeFileSync(specTarget, "# Existing record\n");
  assert.equal(run(root, ["init", ".", "--tools", "codex", "--yes", "--json"]).status, 0);
  const beforeConfig = fs.readFileSync(configTarget);
  const beforeSpec = fs.readFileSync(specTarget);

  const updated = run(root, ["update", "--language", "en-US", "--json"]);
  assert.equal(updated.status, 0, updated.stderr);
  assert.deepEqual(fs.readFileSync(configTarget), beforeConfig);
  assert.deepEqual(fs.readFileSync(specTarget), beforeSpec);
  assert(!jsonData(updated).managedFiles.some((entry) => entry.target.startsWith("openspec/")));
});

test("update removes obsolete workspace aliases tracked by an earlier release", () => {
  const root = temporaryRoot();
  assert.equal(run(root, ["init", ".", "--tools", "claude,codex", "--yes", "--json"]).status, 0);
  const relative = ".claude/commands/opsxw/add-projects.md";
  const target = path.join(root, relative);
  const content = "obsolete managed command\n";
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content);
  const stateFile = path.join(root, ".openspec-workspace", "state.json");
  const state = JSON.parse(fs.readFileSync(stateFile, "utf8"));
  state.managedFiles[relative] = { sha256: createHash("sha256").update(content).digest("hex") };
  fs.writeFileSync(stateFile, `${JSON.stringify(state, null, 2)}\n`);

  const updated = run(root, ["update", "--tools", "claude,codex"]);
  assert.equal(updated.status, 0, updated.stderr);
  assert(!fs.existsSync(target));
  const next = JSON.parse(fs.readFileSync(stateFile, "utf8"));
  assert.equal(next.managedFiles[relative], undefined);
});

test("update migrates an unchanged managed AGENT.md to AGENTS.md", () => {
  const root = temporaryRoot();
  assert.equal(run(root, ["init", ".", "--tools", "codex", "--yes", "--json"]).status, 0);
  const stateFile = path.join(root, ".openspec-workspace", "state.json");
  const state = JSON.parse(fs.readFileSync(stateFile, "utf8"));
  const legacyContent = "legacy managed Codex instructions\n";
  delete state.managedFiles["AGENTS.md"];
  state.managedFiles["AGENT.md"] = {
    artifactId: "workspace-codex-instructions",
    installedSha256: createHash("sha256").update(legacyContent).digest("hex"),
  };
  fs.unlinkSync(path.join(root, "AGENTS.md"));
  fs.writeFileSync(path.join(root, "AGENT.md"), legacyContent);
  fs.writeFileSync(stateFile, `${JSON.stringify(state, null, 2)}\n`);

  const updated = run(root, ["update", "--tools", "codex", "--json"]);
  assert.equal(updated.status, 0, updated.stderr);
  assert(!fs.existsSync(path.join(root, "AGENT.md")));
  assert(fs.existsSync(path.join(root, "AGENTS.md")));
  const data = jsonData(updated);
  assert(data.obsoleteFiles.some((entry) => entry.target === "AGENT.md" && entry.action === "remove"));
  assert(data.managedFiles.some((entry) => entry.target === "AGENTS.md" && entry.action === "write"));
  const next = JSON.parse(fs.readFileSync(stateFile, "utf8"));
  assert.equal(next.managedFiles["AGENT.md"], undefined);
  assert(next.managedFiles["AGENTS.md"]);
});

test("update protects modified legacy and unknown new Codex instruction targets", () => {
  const legacyRoot = temporaryRoot();
  assert.equal(run(legacyRoot, ["init", ".", "--tools", "codex", "--yes", "--json"]).status, 0);
  const legacyStateFile = path.join(legacyRoot, ".openspec-workspace", "state.json");
  const legacyState = JSON.parse(fs.readFileSync(legacyStateFile, "utf8"));
  const managedContent = "legacy managed Codex instructions\n";
  delete legacyState.managedFiles["AGENTS.md"];
  legacyState.managedFiles["AGENT.md"] = {
    artifactId: "workspace-codex-instructions",
    installedSha256: createHash("sha256").update(managedContent).digest("hex"),
  };
  fs.unlinkSync(path.join(legacyRoot, "AGENTS.md"));
  fs.writeFileSync(path.join(legacyRoot, "AGENT.md"), `${managedContent}local edit\n`);
  fs.writeFileSync(legacyStateFile, `${JSON.stringify(legacyState, null, 2)}\n`);

  const modifiedLegacy = run(legacyRoot, ["update", "--tools", "codex", "--json"]);
  assert.equal(modifiedLegacy.status, 1);
  assert(JSON.parse(modifiedLegacy.stdout).diagnostics.some((entry) => entry.code === "OBSOLETE_MANAGED_FILE_UNKNOWN"));
  assert(fs.existsSync(path.join(legacyRoot, "AGENT.md")));
  assert(!fs.existsSync(path.join(legacyRoot, "AGENTS.md")));

  const newTargetRoot = temporaryRoot();
  assert.equal(run(newTargetRoot, ["init", ".", "--tools", "codex", "--yes", "--json"]).status, 0);
  const newTargetStateFile = path.join(newTargetRoot, ".openspec-workspace", "state.json");
  const newTargetState = JSON.parse(fs.readFileSync(newTargetStateFile, "utf8"));
  delete newTargetState.managedFiles["AGENTS.md"];
  fs.writeFileSync(newTargetStateFile, `${JSON.stringify(newTargetState, null, 2)}\n`);
  fs.writeFileSync(path.join(newTargetRoot, "AGENTS.md"), "user-owned instructions\n");

  const unknownNew = run(newTargetRoot, ["update", "--tools", "codex", "--json"]);
  assert.equal(unknownNew.status, 1);
  assert(JSON.parse(unknownNew.stdout).diagnostics.some((entry) => entry.code === "MANAGED_FILE_UNKNOWN"));
  assert.equal(fs.readFileSync(path.join(newTargetRoot, "AGENTS.md"), "utf8"), "user-owned instructions\n");
});
