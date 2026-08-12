const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { loadConfig, saveConfig } = require("../core/config");
const { doctorWorkspace } = require("../core/doctor");
const { sha256 } = require("../core/fs");
const { MANIFEST_FILE, loadInitManifest } = require("../core/init");
const { INITIALIZATION_STAGE_IDS, initializeWorkspace } = require("../core/initializer");
const { syncPermissions } = require("../core/permissions");
const { applyProjectBranchSync, applyProjectConfiguration } = require("../cli/commands/project");
const { updateWorkspace } = require("../cli/commands/update");
const { failure } = require("../cli/result");
const { renderResult } = require("../cli/renderer");

function temporaryRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "openspec-runtime-failure-"));
}

function forbiddenRun(command, args = []) {
  throw new Error(`Unexpected command: ${command} ${args.join(" ")}`);
}

function prepareBaseline(root) {
  fs.mkdirSync(path.join(root, "openspec", "specs"), { recursive: true });
  const desired = "schema: user-owned\n";
  fs.writeFileSync(path.join(root, "openspec", "config.yaml"), desired);
  return desired;
}

test("init restores tracked workspace state after every stable stage", async () => {
  const root = temporaryRoot();
  const baseline = prepareBaseline(root);
  for (const stageId of Object.values(INITIALIZATION_STAGE_IDS)) {
    let failure;
    await assert.rejects(initializeWorkspace(root, {
      nodeVersion: "24.0.0",
      tools: [],
      interactive: false,
      run: forbiddenRun,
      injectFailure: (current) => {
        if (current === stageId) throw new Error(`injected ${stageId}`);
      },
    }), (error) => {
      failure = error;
      return error.message === `injected ${stageId}`;
    });
    assert.equal(failure.details.workspaceRolledBack, true, stageId);
    assert.equal(fs.readFileSync(path.join(root, "openspec", "config.yaml"), "utf8"), baseline, stageId);
    assert.equal(fs.existsSync(path.join(root, ".openspec-workspace")), false, stageId);
    assert.equal(fs.existsSync(path.join(root, "USER_GUIDE.md")), false, stageId);
    assert.equal(fs.existsSync(path.join(root, "openspec", "schemas")), false, stageId);
  }
});

test("update restores config, state, and managed files after each apply stage", async () => {
  const root = temporaryRoot();
  prepareBaseline(root);
  await initializeWorkspace(root, {
    nodeVersion: "24.0.0",
    tools: [],
    interactive: false,
    run: forbiddenRun,
    language: "zh-CN",
  });
  const stateFile = path.join(root, ".openspec-workspace", "state.json");
  const previousReleaseState = JSON.parse(fs.readFileSync(stateFile, "utf8"));
  previousReleaseState.appliedReleaseVersion = "0.1.0-beta.10";
  previousReleaseState.appliedManifestSha256 = "beta.10-manifest";
  fs.writeFileSync(stateFile, `${JSON.stringify(previousReleaseState, null, 2)}\n`);
  const files = [
    path.join(root, ".openspec-workspace", "config.yaml"),
    stateFile,
    path.join(root, "USER_GUIDE.md"),
    path.join(root, "openspec", "config.yaml"),
  ];
  const baseline = new Map(files.map((file) => [file, fs.readFileSync(file)]));
  const stages = [
    "after-obsolete-cleanup",
    "after-managed-install",
    "after-config-save",
    "after-state-save",
    "after-verify",
  ];
  for (const stageId of stages) {
    let failure;
    assert.throws(() => updateWorkspace(root, {
      tools: "none",
      language: "en-US",
      run: forbiddenRun,
      injectFailure: (current) => {
        if (current === stageId) throw new Error(`injected ${stageId}`);
      },
    }), (error) => {
      failure = error;
      return error.message === `injected ${stageId}`;
    });
    assert.equal(failure.details.workspaceRolledBack, true, stageId);
    for (const [file, content] of baseline) assert.deepEqual(fs.readFileSync(file), content, `${stageId}: ${file}`);
  }
});

test("update rolls back the AGENT.md to AGENTS.md migration as one transaction", async () => {
  const root = temporaryRoot();
  prepareBaseline(root);
  await initializeWorkspace(root, {
    nodeVersion: "24.0.0",
    tools: ["codex"],
    interactive: false,
    run: forbiddenRun,
    language: "zh-CN",
  });
  const stateFile = path.join(root, ".openspec-workspace", "state.json");
  const state = JSON.parse(fs.readFileSync(stateFile, "utf8"));
  const legacyContent = Buffer.from("legacy managed Codex instructions\n");
  delete state.managedFiles["AGENTS.md"];
  state.managedFiles["AGENT.md"] = {
    artifactId: "workspace-codex-instructions",
    installedSha256: sha256(legacyContent),
  };
  fs.unlinkSync(path.join(root, "AGENTS.md"));
  fs.writeFileSync(path.join(root, "AGENT.md"), legacyContent);
  fs.writeFileSync(stateFile, `${JSON.stringify(state, null, 2)}\n`);
  const stateBefore = fs.readFileSync(stateFile);

  let failure;
  assert.throws(() => updateWorkspace(root, {
    tools: "codex",
    run: forbiddenRun,
    injectFailure: (stage) => {
      if (stage === "after-managed-install") throw new Error("injected migration failure");
    },
  }), (error) => {
    failure = error;
    return error.message === "injected migration failure";
  });
  assert.equal(failure.details.workspaceRolledBack, true);
  assert.deepEqual(fs.readFileSync(path.join(root, "AGENT.md")), legacyContent);
  assert.equal(fs.existsSync(path.join(root, "AGENTS.md")), false);
  assert.deepEqual(fs.readFileSync(stateFile), stateBefore);
});

test("update verifies managed-file postconditions before committing release state", async () => {
  const root = temporaryRoot();
  prepareBaseline(root);
  await initializeWorkspace(root, {
    nodeVersion: "24.0.0",
    tools: [],
    interactive: false,
    run: forbiddenRun,
    language: "zh-CN",
  });
  const files = [
    path.join(root, ".openspec-workspace", "config.yaml"),
    path.join(root, ".openspec-workspace", "state.json"),
    path.join(root, "USER_GUIDE.md"),
    path.join(root, "openspec", "config.yaml"),
  ];
  const baseline = new Map(files.map((file) => [file, fs.readFileSync(file)]));

  let injected = false;
  assert.throws(() => updateWorkspace(root, {
    tools: "none",
    language: "en-US",
    run: forbiddenRun,
    injectFailure: (stage) => {
      if (stage === "after-managed-install" && !injected) {
        injected = true;
        fs.appendFileSync(path.join(root, "USER_GUIDE.md"), "\npost-write drift\n");
      }
    },
  }), (error) => error.code === "UPDATE_POSTCONDITION_FAILED");

  for (const [file, content] of baseline) assert.deepEqual(fs.readFileSync(file), content, file);
});

test("update commits release metadata while preserving initialized workspace state", async () => {
  const root = temporaryRoot();
  prepareBaseline(root);
  await initializeWorkspace(root, {
    nodeVersion: "24.0.0",
    tools: [],
    interactive: false,
    run: forbiddenRun,
    language: "zh-CN",
  });

  const config = loadConfig(root);
  const expectedProjects = [{
    name: "service",
    specPrefix: "service",
    location: "/tmp/service",
    branch: "main",
    type: "backend",
    context: "preserve this project context",
  }];
  saveConfig(root, { ...config, projects: expectedProjects });

  const stateFile = path.join(root, ".openspec-workspace", "state.json");
  const previous = JSON.parse(fs.readFileSync(stateFile, "utf8"));
  const expectedManagedFiles = structuredClone(previous.managedFiles);
  previous.appliedReleaseVersion = "0.1.0-beta.10";
  delete previous.appliedManifestSha256;
  previous.workspaceLanguage = "zh-CN";
  previous.customState = { preserve: true };
  fs.writeFileSync(stateFile, `${JSON.stringify(previous, null, 2)}\n`);

  const manifest = loadInitManifest();
  const result = updateWorkspace(root, { run: forbiddenRun });
  const state = JSON.parse(fs.readFileSync(stateFile, "utf8"));
  assert.equal(state.appliedReleaseVersion, manifest.releaseVersion);
  assert.equal(state.appliedManifestSha256, sha256(fs.readFileSync(MANIFEST_FILE)));
  assert.equal(state.status, "healthy");
  assert.equal(state.workspaceLanguage, undefined);
  assert.deepEqual(state.customState, { preserve: true });
  assert.deepEqual(state.tools, []);
  assert.deepEqual(state.managedFiles, expectedManagedFiles);
  assert.deepEqual(loadConfig(root).projects, expectedProjects);
  assert.equal(loadConfig(root).workspace.uuid, config.workspace.uuid);
  assert.equal(loadConfig(root).workspace.language, "zh-CN");
  assert.deepEqual(result.tools, { tools: [], source: "workspace-state" });

  const committed = fs.readFileSync(stateFile);
  updateWorkspace(root, { run: forbiddenRun });
  assert.deepEqual(fs.readFileSync(stateFile), committed);
});

test("update clears the release mismatch reported by doctor", async () => {
  const root = temporaryRoot();
  prepareBaseline(root);
  await initializeWorkspace(root, {
    nodeVersion: "24.0.0",
    tools: [],
    interactive: false,
    run: forbiddenRun,
    language: "zh-CN",
  });
  const stateFile = path.join(root, ".openspec-workspace", "state.json");
  const previous = JSON.parse(fs.readFileSync(stateFile, "utf8"));
  previous.appliedReleaseVersion = "0.1.0-beta.10";
  previous.appliedManifestSha256 = "beta.10-manifest";
  fs.writeFileSync(stateFile, `${JSON.stringify(previous, null, 2)}\n`);

  const manifest = loadInitManifest();
  const before = doctorWorkspace(root, manifest, { run: forbiddenRun });
  assert(before.diagnostics.some((entry) => entry.code === "INIT_RELEASE_OUTDATED"));

  updateWorkspace(root, { run: forbiddenRun });
  const after = doctorWorkspace(root, manifest, { run: forbiddenRun });
  assert.equal(after.diagnostics.some((entry) => entry.code === "INIT_RELEASE_OUTDATED"), false);
  assert.deepEqual(after.errors, []);
});

test("update never manufactures a healthy state and rejects missing initialization state", async () => {
  const root = temporaryRoot();
  prepareBaseline(root);
  await initializeWorkspace(root, {
    nodeVersion: "24.0.0",
    tools: [],
    interactive: false,
    run: forbiddenRun,
    language: "zh-CN",
  });
  const stateFile = path.join(root, ".openspec-workspace", "state.json");
  const unhealthy = JSON.parse(fs.readFileSync(stateFile, "utf8"));
  unhealthy.status = "needs-repair";
  unhealthy.appliedReleaseVersion = "0.1.0-beta.10";
  fs.writeFileSync(stateFile, `${JSON.stringify(unhealthy, null, 2)}\n`);

  updateWorkspace(root, { run: forbiddenRun });
  const updated = JSON.parse(fs.readFileSync(stateFile, "utf8"));
  assert.equal(updated.status, "needs-repair");
  assert.equal(updated.appliedReleaseVersion, loadInitManifest().releaseVersion);

  fs.unlinkSync(stateFile);
  assert.throws(
    () => updateWorkspace(root, { run: forbiddenRun }),
    (error) => error.code === "UPDATE_STATE_MISSING" && /openspec-w init/.test(error.details.remediation)
  );
  assert.equal(fs.existsSync(stateFile), false);
});

test("project configuration restores config and permissions at each write boundary", () => {
  const root = temporaryRoot();
  const config = {
    schemaVersion: 2,
    workspace: { name: "failure-test", uuid: "123e4567-e89b-42d3-a456-426614174000", language: "en-US" },
    monitor: { enable: false, url: "http://127.0.0.1:3211" },
    projects: [],
  };
  saveConfig(root, config);
  const permissionsFile = path.join(root, ".codex", "config.toml");
  fs.mkdirSync(path.dirname(permissionsFile), { recursive: true });
  fs.writeFileSync(permissionsFile, "# user configuration\n");
  const configFile = path.join(root, ".openspec-workspace", "config.yaml");
  const baselineConfig = fs.readFileSync(configFile);
  const baselinePermissions = fs.readFileSync(permissionsFile);
  const next = {
    ...config,
    projects: [{ name: "service", specPrefix: "service", location: "/tmp/service", branch: "main", type: "backend", context: "service" }],
  };
  for (const stageId of ["after-config-save", "after-permissions-sync"]) {
    let failure;
    assert.throws(() => applyProjectConfiguration(root, next, {
      injectFailure: (current) => {
        if (current === stageId) throw new Error(`injected ${stageId}`);
      },
    }), (error) => {
      failure = error;
      return error.code === "PROJECT_CONFIGURATION_UPDATE_FAILED";
    });
    assert.equal(failure.details.workspaceRolledBack, true, stageId);
    assert.deepEqual(fs.readFileSync(configFile), baselineConfig, stageId);
    assert.deepEqual(fs.readFileSync(permissionsFile), baselinePermissions, stageId);
  }
});

test("project branch synchronization rolls back its only workspace write", () => {
  const root = temporaryRoot();
  const project = {
    name: "service",
    specPrefix: "service",
    location: "/tmp/service",
    branch: "main",
    type: "backend",
    context: "service",
  };
  const config = {
    schemaVersion: 2,
    workspace: { name: "branch-sync", uuid: "123e4567-e89b-42d3-a456-426614174000", language: "en-US" },
    monitor: { enable: false, url: "http://127.0.0.1:3211" },
    projects: [project],
  };
  saveConfig(root, config);
  const configFile = path.join(root, ".openspec-workspace", "config.yaml");
  const permissionsFile = path.join(root, ".codex", "config.toml");
  fs.mkdirSync(path.dirname(permissionsFile), { recursive: true });
  fs.writeFileSync(permissionsFile, "# untouched permissions\n");
  const baselineConfig = fs.readFileSync(configFile);
  const baselinePermissions = fs.readFileSync(permissionsFile);
  const plan = { action: "update", project, previousBranch: "main", actualBranch: "feature/sync" };

  for (const stageId of ["after-config-save", "after-verify"]) {
    let failure;
    assert.throws(() => applyProjectBranchSync(root, plan, {
      inspectGitWorktree: () => ({ branch: "feature/sync" }),
      injectFailure: (current) => {
        if (current === stageId) throw new Error(`injected ${stageId}`);
      },
    }), (error) => {
      failure = error;
      return error.code === "PROJECT_BRANCH_SYNC_FAILED";
    });
    assert.equal(failure.details.workspaceRolledBack, true, stageId);
    assert.deepEqual(fs.readFileSync(configFile), baselineConfig, stageId);
    assert.deepEqual(fs.readFileSync(permissionsFile), baselinePermissions, stageId);
  }

  let raceFailure;
  assert.throws(() => applyProjectBranchSync(root, plan, {
    inspectGitWorktree: () => ({ branch: "feature/changed-again" }),
  }), (error) => {
    raceFailure = error;
    return error.code === "PROJECT_BRANCH_SYNC_VERIFY_FAILED";
  });
  assert.equal(raceFailure.details.workspaceRolledBack, true);
  assert.deepEqual(fs.readFileSync(configFile), baselineConfig);
  assert.deepEqual(fs.readFileSync(permissionsFile), baselinePermissions);
});

test("permission synchronization verifies its single atomic write with a stable JSON failure", () => {
  const root = temporaryRoot();
  let verificationError;
  assert.throws(() => syncPermissions(root, [], {
    atomicWrite: (file, content) => {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, content.replace("# END workspace-permissions:openspec-workspace", "# corrupted managed block"));
    },
  }), (error) => {
    verificationError = error;
    return error.code === "WORKSPACE_PERMISSIONS_VERIFY_FAILED";
  });
  assert.match(verificationError.details.remediation, /openspec-w sync/);

  let stdout = "";
  let stderr = "";
  const previousExitCode = process.exitCode;
  process.exitCode = 0;
  try {
    renderResult(failure(verificationError, "sync"), {
      json: true,
      stdout: { write: (value) => { stdout += value; } },
      stderr: { write: (value) => { stderr += value; } },
    });
    const envelope = JSON.parse(stdout);
    assert.equal(envelope.command, "sync");
    assert.equal(envelope.diagnostics[0].code, "WORKSPACE_PERMISSIONS_VERIFY_FAILED");
    assert.equal(stderr, "");
    assert.equal(process.exitCode, 1);
  } finally {
    process.exitCode = previousExitCode ?? 0;
  }
});
