const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");

const { saveConfig } = require("../core/config");
const {
  applyLatestBranchUpdate,
  gitHead,
  inspectLatestBranchState,
  planLatestBranchUpdate,
} = require("../core/project-branch-update");
const { validateProjects } = require("../core/validation");

const cli = path.resolve(__dirname, "..", "..", "bin", "code-workspace.js");

function temporaryRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "code-workspace-latest-"));
}

function git(cwd, args) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (result.status !== 0) throw new Error(`${args.join(" ")}: ${result.stderr || result.stdout}`);
  return String(result.stdout || "").trim();
}

function run(root, args) {
  return spawnSync(process.execPath, [cli, ...args], { cwd: root, encoding: "utf8" });
}

function commit(cwd, message) {
  git(cwd, ["add", "."]);
  git(cwd, ["-c", "user.name=Code Workspace", "-c", "user.email=workspace@example.invalid", "commit", "-m", message]);
}

function projectConfig(root, projects) {
  saveConfig(root, {
    schemaVersion: 2,
    workspace: { name: "latest", uuid: "123e4567-e89b-42d3-a456-426614174000", language: "en-US" },
    monitor: { enable: false, url: "http://127.0.0.1:3211" },
    projects,
  });
}

function createRemoteFixture(parent, name = "service") {
  const remote = path.join(parent, `${name}.git`);
  const repository = path.join(parent, name);
  git(parent, ["init", "--bare", remote]);
  fs.mkdirSync(repository);
  git(repository, ["init", "-b", "main"]);
  fs.writeFileSync(path.join(repository, "tracked.txt"), "one\n");
  commit(repository, "initial");
  git(repository, ["remote", "add", "origin", remote]);
  git(repository, ["push", "-u", "origin", "main"]);
  return { remote, repository };
}

function projectRecord(repository, updateLatest = true, name = "service") {
  return { name, location: repository, branch: "main", type: "backend", context: name, updateLatest };
}

test("updateLatest policy treats missing as disabled and rejects invalid values", () => {
  let inspected = false;
  const config = { projects: [{ ...projectRecord("/tmp/service"), updateLatest: undefined }] };
  const disabled = planLatestBranchUpdate(config, "service", {
    inspectLatestBranchState: () => { inspected = true; throw new Error("must not inspect disabled project"); },
  });
  assert.equal(disabled.action, "skip");
  assert.equal(disabled.reason, "disabled");
  assert.equal(inspected, false);
  assert.throws(
    () => planLatestBranchUpdate({ projects: [{ ...projectRecord("/tmp/service"), updateLatest: "true" }] }, "service"),
    (error) => error.code === "PROJECT_UPDATE_LATEST_INVALID" && error.details.field === "updateLatest"
  );
});

test("project validation reports invalid updateLatest values", () => {
  const parent = temporaryRoot();
  const workspace = path.join(parent, "workspace");
  fs.mkdirSync(workspace);
  const fixture = createRemoteFixture(parent);
  const output = validateProjects(workspace, {
    schemaVersion: 2,
    projects: [{ ...projectRecord(fixture.repository), updateLatest: "yes" }],
  });
  const diagnostic = output.diagnostics.find((entry) => entry.code === "PROJECT_UPDATE_LATEST_INVALID");
  assert.equal(diagnostic.projectName, "service");
  assert.equal(diagnostic.field, "updateLatest");
});

test("latest branch update fast-forwards to upstream and skips when already current", () => {
  const parent = temporaryRoot();
  const root = path.join(parent, "workspace");
  fs.mkdirSync(root);
  const fixture = createRemoteFixture(parent);
  const oldHead = git(fixture.repository, ["rev-parse", "HEAD"]);
  fs.writeFileSync(path.join(fixture.repository, "tracked.txt"), "two\n");
  commit(fixture.repository, "second");
  git(fixture.repository, ["push"]);
  git(fixture.repository, ["reset", "--hard", oldHead]);
  projectConfig(root, [projectRecord(fixture.repository)]);

  const first = run(root, ["project", "branch", "update-latest", "service", "--json"]);
  assert.equal(first.status, 0, first.stderr);
  const firstEnvelope = JSON.parse(first.stdout);
  assert.equal(firstEnvelope.data.action, "update");
  assert.equal(firstEnvelope.data.fastForwarded, true);
  assert.equal(firstEnvelope.data.beforeHead, oldHead);
  assert.equal(firstEnvelope.data.afterHead, git(fixture.repository, ["rev-parse", "HEAD"]));

  const second = run(root, ["project", "branch", "update-latest", "service", "--json"]);
  assert.equal(second.status, 0, second.stderr);
  const secondEnvelope = JSON.parse(second.stdout);
  assert.equal(secondEnvelope.data.action, "skip");
  assert.equal(secondEnvelope.data.reason, "already-latest");
  assert.equal(secondEnvelope.data.fetched, true);
});

test("latest branch update rejects dirty worktrees and non-fast-forward state", () => {
  const parent = temporaryRoot();
  const root = path.join(parent, "workspace");
  fs.mkdirSync(root);
  const fixture = createRemoteFixture(parent);
  projectConfig(root, [projectRecord(fixture.repository)]);
  fs.writeFileSync(path.join(fixture.repository, "dirty.txt"), "dirty\n");
  const dirty = run(root, ["project", "branch", "update-latest", "service", "--json"]);
  assert.equal(dirty.status, 1);
  assert.equal(JSON.parse(dirty.stdout).diagnostics[0].code, "PROJECT_WORKTREE_DIRTY");
  fs.unlinkSync(path.join(fixture.repository, "dirty.txt"));

  fs.writeFileSync(path.join(fixture.repository, "tracked.txt"), "local\n");
  commit(fixture.repository, "local-only");
  const writer = path.join(parent, "writer");
  git(parent, ["clone", fixture.remote, writer]);
  fs.writeFileSync(path.join(writer, "tracked.txt"), "remote\n");
  commit(writer, "remote-only");
  git(writer, ["push"]);
  const diverged = run(root, ["project", "branch", "update-latest", "service", "--json"]);
  assert.equal(diverged.status, 1);
  assert.equal(JSON.parse(diverged.stdout).diagnostics[0].code, "PROJECT_BRANCH_NOT_FAST_FORWARD");
});

test("latest branch update reports missing upstream and keeps project add contract unchanged", () => {
  const parent = temporaryRoot();
  const root = path.join(parent, "workspace");
  fs.mkdirSync(root);
  const repository = path.join(parent, "service");
  fs.mkdirSync(repository);
  git(repository, ["init", "-b", "main"]);
  fs.writeFileSync(path.join(repository, "tracked.txt"), "one\n");
  commit(repository, "initial");
  projectConfig(root, [projectRecord(repository)]);
  const result = run(root, ["project", "branch", "update-latest", "service", "--json"]);
  assert.equal(result.status, 1);
  assert.equal(JSON.parse(result.stdout).diagnostics[0].code, "PROJECT_BRANCH_UPSTREAM_MISSING");
  const inspected = inspectLatestBranchState(projectRecord(repository));
  assert.equal(inspected.actualBranch, "main");
});

test("latest branch update batches in order, skips disabled projects, and warns on duplicates", () => {
  const parent = temporaryRoot();
  const root = path.join(parent, "workspace");
  fs.mkdirSync(root);
  const enabled = createRemoteFixture(parent, "enabled");
  const disabled = createRemoteFixture(parent, "disabled");
  projectConfig(root, [
    projectRecord(enabled.repository, true, "enabled"),
    projectRecord(disabled.repository, false, "disabled"),
  ]);
  const result = run(root, ["project", "branch", "update-latest", "enabled", "disabled", "enabled", "--json"]);
  assert.equal(result.status, 0, result.stderr);
  const envelope = JSON.parse(result.stdout);
  assert.deepEqual(envelope.data.requested, ["enabled", "disabled", "enabled"]);
  assert.deepEqual(envelope.data.results.map((entry) => [entry.project, entry.action]), [["enabled", "skip"], ["disabled", "skip"]]);
  assert.deepEqual(envelope.data.summary, { total: 2, succeeded: 0, skipped: 2, failed: 0 });
  assert.equal(envelope.diagnostics[0].code, "CLI_DUPLICATE_ARGUMENT");
});

test("latest branch update reports fetch failure and stale plans", () => {
  const parent = temporaryRoot();
  const root = path.join(parent, "workspace");
  fs.mkdirSync(root);
  const fixture = createRemoteFixture(parent);
  const project = projectRecord(fixture.repository);
  projectConfig(root, [project]);
  const config = { projects: [project] };
  const plan = planLatestBranchUpdate(config, "service");
  fs.rmSync(fixture.remote, { recursive: true, force: true });
  assert.throws(
    () => applyLatestBranchUpdate(root, plan),
    (error) => error.code === "PROJECT_BRANCH_FETCH_FAILED"
  );

  const stalePlan = planLatestBranchUpdate(config, "service");
  saveConfig(root, {
    schemaVersion: 2,
    workspace: { name: "latest", uuid: "123e4567-e89b-42d3-a456-426614174000", language: "en-US" },
    monitor: { enable: false, url: "http://127.0.0.1:3211" },
    projects: [{ ...project, branch: "other" }],
  });
  assert.throws(
    () => applyLatestBranchUpdate(root, stalePlan),
    (error) => error.code === "PROJECT_BRANCH_UPDATE_PLAN_STALE"
  );
});

test("latest branch update reports retained effects when postconditions fail", () => {
  const parent = temporaryRoot();
  const root = path.join(parent, "workspace");
  fs.mkdirSync(root);
  const fixture = createRemoteFixture(parent);
  const project = projectRecord(fixture.repository);
  projectConfig(root, [project]);
  const plan = planLatestBranchUpdate({ projects: [project] }, "service");
  const writer = path.join(parent, "writer");
  git(parent, ["clone", fixture.remote, writer]);
  fs.writeFileSync(path.join(writer, "tracked.txt"), "remote\n");
  commit(writer, "remote-only");
  git(writer, ["push"]);
  const before = inspectLatestBranchState(project);
  const targetHead = git(writer, ["rev-parse", "HEAD"]);
  let inspections = 0;
  assert.throws(
    () => applyLatestBranchUpdate(root, plan, {
      inspectLatestBranchState: () => {
        inspections += 1;
        return inspections < 3 ? before : { ...before, actualBranch: "unexpected", head: targetHead };
      },
      gitHead,
    }),
    (error) => {
      assert.equal(error.code, "PROJECT_BRANCH_UPDATE_VERIFY_FAILED");
      assert.equal(error.details.effects.retained[0].kind, "git-fast-forward");
      return true;
    }
  );
});
