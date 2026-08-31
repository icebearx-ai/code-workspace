const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");

const { configPath, loadConfig, loadConfigProjection, projectConfigPath, readProjectConfigDocument, saveConfig, updateProjectBranch } = require("../core/config");
const { inspectProject } = require("../core/project");
const { validateProject, validateProjects } = require("../core/validation");

function temporaryRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "code-workspace-test-"));
}

function gitRepository(parent, name, files = {}) {
  const directory = path.join(parent, name);
  fs.mkdirSync(directory, { recursive: true });
  for (const [file, content] of Object.entries(files)) {
    const target = path.join(directory, file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content);
  }
  spawnSync("git", ["init", "-b", "main"], { cwd: directory, stdio: "ignore" });
  return directory;
}

test("local config preserves unrestricted multiline context", () => {
  const root = temporaryRoot();
  const config = {
    schemaVersion: 2,
    workspace: { name: "example-workspace", uuid: "123e4567-e89b-42d3-a456-426614174000", language: "zh-CN" },
    monitor: { enable: false, url: "http://127.0.0.1:3211" },
    projects: [{
      name: "example",
      location: "/tmp/example",
      branch: "main",
      type: "unusual-project-type",
      context: "职责：Example\n\n任意 Markdown：\n- one\n- two",
    }],
  };
  saveConfig(root, config);
  assert.deepEqual(loadConfig(root), config);
  assert.match(fs.readFileSync(projectConfigPath(root), "utf8"), /context: \|-\n\s+职责：Example/);
});

test("legacy project specPrefix is ignored and removed on explicit save", () => {
  const root = temporaryRoot();
  const file = configPath(root);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, [
    "schemaVersion: 2",
    "workspace:",
    "  name: legacy-prefix",
    "  uuid: 123e4567-e89b-42d3-a456-426614174000",
    "  language: en-US",
    "monitor:",
    "  enable: false",
    "projects:",
    "  ref: config-projects.yaml",
    "",
  ].join("\n"));
  fs.writeFileSync(projectConfigPath(root), [
    "schemaVersion: 1",
    "projects:",
    "  - name: service",
    "    specPrefix: legacy-service",
    "    location: /tmp/service",
    "    branch: main",
    "    type: backend",
    "    context: service",
    "",
  ].join("\n"));
  const loaded = loadConfig(root);
  assert.equal("specPrefix" in loaded.projects[0], false);
  saveConfig(root, loaded);
  assert.doesNotMatch(fs.readFileSync(projectConfigPath(root), "utf8"), /specPrefix/);
});

test("project configuration reference accepts a custom safe filename and rejects unsafe paths", () => {
  const root = temporaryRoot();
  const file = configPath(root);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, [
    "schemaVersion: 2",
    "workspace:",
    "  name: references",
    "  uuid: 123e4567-e89b-42d3-a456-426614174000",
    "  language: en-US",
    "projects:",
    "  ref: team-projects.yaml",
    "",
  ].join("\n"));
  const customProjectFile = path.join(root, ".code-workspace", "team-projects.yaml");
  fs.writeFileSync(customProjectFile, "schemaVersion: 1\nprojects: []\n");
  assert.deepEqual(loadConfigProjection(root, ["projects"]).projects, []);

  fs.writeFileSync(file, fs.readFileSync(file, "utf8").replace("team-projects.yaml", "../team-projects.yaml"));
  assert.throws(() => loadConfigProjection(root, ["projects"]), (error) => error.code === "PROJECT_CONFIG_REFERENCE_INVALID");

  fs.writeFileSync(file, fs.readFileSync(file, "utf8").replace("../team-projects.yaml", "./team-projects.yaml"));
  assert.throws(() => loadConfigProjection(root, ["projects"]), (error) => error.code === "PROJECT_CONFIG_REFERENCE_INVALID");

  for (const invalidRef of ["/tmp/team-projects.yaml", "https://example.invalid/projects.yaml", "team-*.yaml", "config.yaml", "CONFIG.YAML", "state.json"]) {
    fs.writeFileSync(file, fs.readFileSync(file, "utf8").replace("./team-projects.yaml", invalidRef));
    assert.throws(() => loadConfigProjection(root, ["projects"]), (error) => error.code === "PROJECT_CONFIG_REFERENCE_INVALID");
    fs.writeFileSync(file, fs.readFileSync(file, "utf8").replace(invalidRef, "./team-projects.yaml"));
  }

  fs.writeFileSync(file, fs.readFileSync(file, "utf8").replace("./team-projects.yaml", "team-projects.yaml"));
  fs.unlinkSync(customProjectFile);
  assert.throws(() => loadConfigProjection(root, ["projects"]), (error) => error.code === "PROJECT_CONFIG_FILE_MISSING");

  fs.mkdirSync(customProjectFile);
  assert.throws(() => loadConfigProjection(root, ["projects"]), (error) => error.code === "PROJECT_CONFIG_FILE_INVALID");
  fs.rmdirSync(customProjectFile);
  fs.writeFileSync(customProjectFile, "schemaVersion: 1\nprojects: [\n");
  assert.throws(() => loadConfigProjection(root, ["projects"]), (error) => error.code === "PROJECT_CONFIG_FILE_PARSE_FAILED");
});

test("inline project arrays are rejected without merging or inferring a project file", () => {
  const root = temporaryRoot();
  const file = configPath(root);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, [
    "schemaVersion: 2",
    "workspace:",
    "  name: inline",
    "  uuid: 123e4567-e89b-42d3-a456-426614174000",
    "  language: en-US",
    "projects:",
    "  - name: legacy",
    "    location: /tmp/legacy",
    "    branch: main",
    "    type: backend",
    "    context: legacy",
    "",
  ].join("\n"));
  assert.throws(() => loadConfig(root), (error) => error.code === "PROJECT_CONFIG_INLINE_UNSUPPORTED");
  assert.equal(fs.existsSync(projectConfigPath(root)), false);
});

test("configuration writes preserve the referenced custom project filename", () => {
  const root = temporaryRoot();
  const customRef = "registry-team.yaml";
  const project = { name: "service", location: "/tmp/service", branch: "main", type: "backend", context: "service" };
  saveConfig(root, {
    schemaVersion: 2,
    workspace: { name: "custom-save", uuid: "123e4567-e89b-42d3-a456-426614174000", language: "en-US" },
    monitor: { enable: false, url: "http://127.0.0.1:3211" },
    projects: [project],
  }, { ref: customRef });
  assert.equal(readProjectConfigDocument(root).file, path.join(root, ".code-workspace", customRef));
  const loaded = loadConfig(root);
  loaded.projects[0].branch = "feature/custom";
  saveConfig(root, loaded);
  assert.deepEqual(loadConfig(root).projects, [{ ...project, branch: "feature/custom" }]);
  assert.deepEqual(loadConfigProjection(root, ["projects"]).projects, [{ ...project, branch: "feature/custom" }]);
  assert.equal(fs.existsSync(path.join(root, ".code-workspace", "config-projects.yaml")), false);
  assert.equal(fs.existsSync(path.join(root, ".code-workspace", customRef)), true);
  assert.match(fs.readFileSync(configPath(root), "utf8"), new RegExp(`ref: ${customRef}`));
  assert.throws(() => saveConfig(root, loaded, { ref: "../outside.yaml" }), (error) => error.code === "PROJECT_CONFIG_REFERENCE_INVALID");
});

test("missing project reference reports a remediation tied to the main config", () => {
  const root = temporaryRoot();
  const file = configPath(root);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, "schemaVersion: 2\nworkspace: {}\n");
  assert.throws(() => loadConfigProjection(root, ["projects"]), (error) => {
    assert.equal(error.code, "PROJECT_CONFIG_REFERENCE_MISSING");
    assert.equal(error.details.file, file);
    assert.match(error.details.remediation, /config-projects\.yaml/);
    return true;
  });
});

test("monitor configuration is loopback-only and canonical", () => {
  const root = temporaryRoot();
  saveConfig(root, {
    workspace: { name: "team", uuid: "123e4567-e89b-42d3-a456-426614174000", language: "en-US" },
    monitor: { enable: true, url: "http://localhost:8080/" },
  });
  assert.deepEqual(loadConfig(root).monitor, { enable: true, url: "http://localhost:8080" });
  assert.throws(() => saveConfig(root, {
    workspace: { name: "team", uuid: "123e4567-e89b-42d3-a456-426614174000", language: "en-US" },
    monitor: { enable: true, url: "https://example.com" },
  }), /loopback host/);
});

test("workspace language is required, validated, and preserved", () => {
  const root = temporaryRoot();
  const workspace = { name: "team", uuid: "123e4567-e89b-42d3-a456-426614174000", language: "en-US" };
  saveConfig(root, { workspace });
  assert.deepEqual(loadConfig(root).workspace, workspace);
  assert.match(fs.readFileSync(configPath(root), "utf8"), /language: en-US/);
  assert.throws(() => saveConfig(root, { workspace: { ...workspace, language: "fr-FR" } }), /workspace\.language/);
  assert.throws(() => saveConfig(root, { workspace: { name: workspace.name, uuid: workspace.uuid } }), /workspace\.language/);
});

test("targeted project branch updates preserve unrelated config domains and reject stale plans", () => {
  const root = temporaryRoot();
  const file = configPath(root);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, [
    "schemaVersion: 2",
    "workspace:",
    "  name: branch-sync",
    "  uuid: 123e4567-e89b-42d3-a456-426614174000",
    "monitor:",
    "  enable: false",
    "  url: not-a-valid-monitor-url",
    "projects:",
    "  ref: config-projects.yaml",
    "",
  ].join("\n"));
  fs.writeFileSync(projectConfigPath(root), [
    "schemaVersion: 1",
    "projects:",
    "  - name: service",
    "    location: /tmp/service",
    "    branch: main",
    "    type: backend",
    "    context: |-",
    "      first line",
    "      second line",
    "",
  ].join("\n"));

  const updated = updateProjectBranch(root, {
    name: "service",
    before: { registeredBranch: "main", actualBranch: "feature/sync" },
    after: { registeredBranch: "feature/sync", actualBranch: "feature/sync" },
  });
  assert.equal(updated.branch, "feature/sync");
  const persisted = fs.readFileSync(projectConfigPath(root), "utf8");
  assert.match(persisted, /branch: feature\/sync/);
  assert.match(persisted, /context: \|-\n\s+first line\n\s+second line/);
  assert.match(fs.readFileSync(file, "utf8"), /url: not-a-valid-monitor-url/);
  assert.doesNotMatch(fs.readFileSync(file, "utf8"), /language:/);

  assert.throws(() => updateProjectBranch(root, {
    name: "service",
    before: { registeredBranch: "main", actualBranch: "feature/stale" },
    after: { registeredBranch: "feature/stale", actualBranch: "feature/stale" },
  }), (error) => {
    assert.equal(error.code, "PROJECT_BRANCH_ACCEPT_CONFLICT");
    assert.deepEqual(error.details.expectedState, { registeredBranch: "main", actualBranch: "feature/stale" });
    assert.deepEqual(error.details.observedState, { registeredBranch: "feature/sync", actualBranch: "feature/stale" });
    return true;
  });
  assert.equal(fs.readFileSync(projectConfigPath(root), "utf8"), persisted);
});

test("public branch implementation does not reintroduce legacy branch-state fields", () => {
  const sourceFiles = [
    path.resolve(__dirname, "..", "core", "config.js"),
    path.resolve(__dirname, "..", "core", "validation.js"),
    path.resolve(__dirname, "..", "cli", "commands", "project.js"),
  ];
  const forbidden = [
    ["configured", "Branch"],
    ["previous", "Branch"],
    ["expected", "Branch"],
    ["requested", "Branch"],
    ["saved", "Branch"],
  ].map((parts) => parts.join(""));
  for (const file of sourceFiles) {
    const source = fs.readFileSync(file, "utf8");
    for (const field of forbidden) assert.doesNotMatch(source, new RegExp(`\\b${field}\\b`), `${file}: ${field}`);
  }
});

test("repository inspection reports only stable Git and file facts", () => {
  const parent = temporaryRoot();
  const repository = gitRepository(parent, "web-console", {
    "package.json": JSON.stringify({ dependencies: { vue: "2.7.0" }, devDependencies: { vite: "5.0.0" } }),
    "src/index.js": "",
  });
  const inspection = inspectProject(repository);
  assert.equal(inspection.location, fs.realpathSync(repository));
  assert.equal(inspection.branch, "main");
  assert.deepEqual(inspection.facts.manifestFiles, ["package.json"]);
  assert.deepEqual(inspection.facts.topLevelEntries, ["package.json", "src"]);
  assert.equal("type" in inspection, false);
  assert.equal("context" in inspection, false);
});

test("project validation accepts extended context and checks actual branches", () => {
  const parent = temporaryRoot();
  const workspace = path.join(parent, "workspace");
  fs.mkdirSync(workspace);
  const repository = gitRepository(parent, "service", { "pom.xml": "<project><source>1.8</source><artifactId>spring-boot</artifactId></project>" });
  const project = {
    name: "service",
    location: fs.realpathSync(repository),
    branch: "main",
    type: "backend",
    context: "自由文本\n\n额外约定：允许扩展。",
  };
  const valid = validateProjects(workspace, { schemaVersion: 1, projects: [project] });
  assert.deepEqual(valid.errors, []);

  const invalid = validateProjects(workspace, {
    schemaVersion: 1,
    projects: [{ ...project, branch: "another-branch" }],
  });
  const mismatch = invalid.diagnostics.find((entry) => entry.code === "PROJECT_BRANCH_MISMATCH");
  assert.deepEqual(
    {
      registeredBranch: mismatch.registeredBranch,
      actualBranch: mismatch.actualBranch,
      location: mismatch.location,
    },
    {
      registeredBranch: "another-branch",
      actualBranch: "main",
      location: fs.realpathSync(repository),
    }
  );
  assert.equal("configuredBranch" in mismatch, false);
});

test("targeted project validation ignores unrelated runtime drift and retains selected conflicts", () => {
  const parent = temporaryRoot();
  const workspace = path.join(parent, "workspace");
  fs.mkdirSync(workspace);
  const serviceRepository = gitRepository(parent, "service");
  const otherRepository = gitRepository(parent, "other");
  const service = {
    name: "service",
    location: fs.realpathSync(serviceRepository),
    branch: "main",
    type: "backend",
    context: "service",
  };
  const other = {
    name: "other",
    location: fs.realpathSync(otherRepository),
    branch: "stale",
    type: "backend",
    context: "other",
  };

  assert.deepEqual(validateProject(workspace, { schemaVersion: 2, projects: [service, other] }, "service").errors, []);
  assert(validateProject(workspace, { schemaVersion: 2, projects: [service, other] }, "other").diagnostics.some((entry) =>
    entry.code === "PROJECT_BRANCH_MISMATCH" && entry.projectName === "other"
  ));

  const duplicatePath = validateProject(workspace, {
    schemaVersion: 2,
    projects: [service, { ...other, location: service.location }],
  }, "service");
  assert(duplicatePath.diagnostics.some((entry) =>
    entry.code === "DUPLICATE_PROJECT_PATH" && entry.projects.includes("service")
  ));

  const duplicateName = validateProject(workspace, {
    schemaVersion: 2,
    projects: [service, { ...other, name: "service" }],
  }, "service");
  assert(duplicateName.diagnostics.some((entry) => entry.code === "DUPLICATE_PROJECT_NAME"));

  const parentRepository = gitRepository(parent, "parent-project");
  const childRepository = gitRepository(parentRepository, "child-project");
  const nested = validateProject(workspace, {
    schemaVersion: 2,
    projects: [
      { ...service, location: fs.realpathSync(parentRepository) },
      { ...other, location: fs.realpathSync(childRepository), branch: "main" },
    ],
  }, "service");
  assert(nested.diagnostics.some((entry) =>
    entry.code === "NESTED_PROJECT_PATH" && entry.projects.includes("service")
  ));
});

test("targeted validation never inspects unselected worktrees", () => {
  const parent = temporaryRoot();
  const workspace = path.join(parent, "workspace");
  fs.mkdirSync(workspace);
  const serviceRepository = gitRepository(parent, "service");
  const service = {
    name: "service",
    location: fs.realpathSync(serviceRepository),
    branch: "main",
    type: "backend",
    context: "service",
  };
  const unreachable = {
    name: "unreachable",
    location: path.join(parent, "does-not-exist"),
    branch: "stale",
    type: "backend",
    context: "must remain unobserved",
  };
  const inspected = [];
  const inspectGitWorktree = (location) => {
    inspected.push(location);
    assert.equal(location, service.location);
    return { location, realPath: location, branch: "main" };
  };

  const selected = validateProject(workspace, { schemaVersion: 2, projects: [service, unreachable] }, "service", { inspectGitWorktree });
  assert.deepEqual(selected.errors, []);
  assert.deepEqual(inspected, [service.location]);

  inspected.length = 0;
  const missing = validateProject(workspace, { schemaVersion: 2, projects: [service, unreachable] }, "missing", { inspectGitWorktree });
  assert(missing.diagnostics.some((entry) => entry.code === "PROJECT_NOT_FOUND"));
  assert.deepEqual(inspected, []);

  inspected.length = 0;
  const conflict = validateProject(workspace, {
    schemaVersion: 2,
    projects: [service, { ...unreachable, location: path.join(service.location, "nested") }],
  }, "service", { inspectGitWorktree });
  assert(conflict.diagnostics.some((entry) => entry.code === "NESTED_PROJECT_PATH" && entry.projects.includes("unreachable")));
  assert.deepEqual(inspected, [service.location]);
});
