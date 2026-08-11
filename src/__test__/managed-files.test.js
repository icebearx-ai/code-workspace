const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");

const { saveState } = require("../core/config");
const { sha256 } = require("../core/fs");
const { loadInitManifest } = require("../core/init");
const {
  inspectManagedFiles,
  installManagedFiles,
  loadManagedManifest,
} = require("../core/managed-files");
const { checkPatchSource } = require("../../scripts/check-patches");
const { workspaceGuide } = require("../core/language");

function baseline(tools = ["claude", "codex"]) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "managed-files-"));
  const result = spawnSync("openspec", [
    "init",
    ".",
    "--tools",
    tools.join(","),
    "--profile",
    "core",
  ], { cwd: root, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  return root;
}

test("templates and patch outputs share one idempotent managed-file mechanism", () => {
  const root = baseline();
  const manifest = loadInitManifest();
  const first = installManagedFiles(root, manifest, ["claude", "codex"]);
  assert.equal(first.length, 26);
  assert.equal(first.filter((entry) => entry.action === "write").length, 26);

  const second = installManagedFiles(root, manifest, ["claude", "codex"]);
  assert.equal(second.filter((entry) => entry.action === "write").length, 0);
  const inspected = inspectManagedFiles(root, manifest, ["claude", "codex"]);
  assert.equal(inspected.current.length, 26);
  assert.deepEqual(inspected.managedOld, []);
  assert.deepEqual(inspected.replaceable, []);
  assert.deepEqual(inspected.unknown, []);
  assert(inspected.files.some((entry) => entry.provenance.kind === "template"));
  assert(inspected.files.some((entry) => entry.provenance.kind === "patch"));
});

test("managed-file planning prevents partial writes when one target is unknown", () => {
  const root = baseline();
  const manifest = loadInitManifest();
  const firstTarget = path.join(root, ".claude", "commands", "opsx", "apply.md");
  const firstBaseline = fs.readFileSync(firstTarget, "utf8");
  const unknownTarget = path.join(root, ".codex", "skills", "openspec-propose", "SKILL.md");
  fs.appendFileSync(unknownTarget, "\nunknown local edit\n");

  assert.throws(
    () => installManagedFiles(root, manifest, ["claude", "codex"]),
    /Managed file contains unknown changes/
  );
  assert.equal(fs.readFileSync(firstTarget, "utf8"), firstBaseline);
  assert(!fs.existsSync(path.join(root, ".codex", "skills", "openspec-workspace-add-projects", "SKILL.md")));
});

test("a previous installed fingerprint is a safe generic upgrade input", () => {
  const root = baseline(["codex"]);
  const manifest = loadInitManifest();
  const entry = manifest.managedFiles.find((item) => item.id === "workspace-codex-add-projects-skill");
  const target = path.join(root, entry.target);
  const previous = Buffer.from("previous managed output\n");
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, previous);
  saveState(root, {
    schemaVersion: 2,
    managedFiles: {
      [entry.target]: {
        artifactId: entry.id,
        installedSha256: sha256(previous),
      },
    },
  });

  const result = installManagedFiles(root, manifest, ["codex"]);
  const upgraded = result.find((item) => item.id === entry.id);
  assert.equal(upgraded.reason, "managed-old");
  assert.equal(sha256(fs.readFileSync(target)), entry.desired.sha256);
});

test("managed files respect selected tools while tool-neutral schema files remain managed", () => {
  const root = baseline(["codex"]);
  const manifest = loadInitManifest();
  const result = installManagedFiles(root, manifest, ["codex"]);
  assert.equal(result.length, 14);
  assert(!result.some((entry) => entry.target.startsWith(".claude/")));
  assert(!result.some((entry) => entry.target === "CLAUDE.md"));
  assert(result.some((entry) => entry.target === "AGENTS.md"));
  assert(!result.some((entry) => entry.target === "AGENT.md"));
  assert(result.some((entry) => entry.target === ".codex/skills/openspec-workspace-resolve-branch/SKILL.md"));
  assert(result.some((entry) => entry.target === "USER_GUIDE.md"));
  assert(!result.some((entry) => entry.target === "USER_GUIDE.zh-CN.md"));
  assert(result.some((entry) => entry.target === "openspec/schemas/workspace-workflow/schema.yaml"));
});

test("changing the selected tools removes previously managed tool assets", () => {
  const root = baseline(["codex"]);
  const manifest = loadInitManifest();
  installManagedFiles(root, manifest, ["codex"]);
  assert(fs.existsSync(path.join(root, "AGENTS.md")));
  const changed = installManagedFiles(root, manifest, []);
  assert(changed.some((entry) => entry.target === "AGENTS.md" && entry.action === "remove"));
  assert(!fs.existsSync(path.join(root, "AGENTS.md")));
  assert(!fs.existsSync(path.join(root, ".codex", "skills", "openspec-workspace-add-projects", "SKILL.md")));
  assert(!fs.existsSync(path.join(root, ".codex", "skills", "openspec-workspace-resolve-branch", "SKILL.md")));
  assert(fs.existsSync(path.join(root, "USER_GUIDE.md")));
});

test("workspace guide uses the selected workspace language at one stable target", () => {
  const root = baseline(["codex"]);
  const manifest = loadInitManifest();
  installManagedFiles(root, manifest, ["codex"], {
    variables: { WORKSPACE_LANGUAGE: "en-US", WORKSPACE_USER_GUIDE: workspaceGuide("en-US") },
  });
  assert.match(fs.readFileSync(path.join(root, "USER_GUIDE.md"), "utf8"), /^# OpenSpec Workspace User Guide/m);
  assert(!fs.existsSync(path.join(root, "USER_GUIDE.zh-CN.md")));
});

test("Codex monitor hooks are capability-gated and idempotent", () => {
  const root = baseline(["codex"]);
  const manifest = loadInitManifest();
  const disabled = installManagedFiles(root, manifest, ["codex"]);
  assert.equal(disabled.length, 14);
  assert(!fs.existsSync(path.join(root, ".codex", "hooks.json")));

  const enabled = installManagedFiles(root, manifest, ["codex"], { capabilities: ["monitor"] });
  assert.equal(enabled.length, 15);
  assert.equal(enabled.find((entry) => entry.target === ".codex/hooks.json").action, "write");
  const repeated = installManagedFiles(root, manifest, ["codex"], { capabilities: ["monitor"] });
  assert.equal(repeated.find((entry) => entry.target === ".codex/hooks.json").action, "skip");
});

test("one canonical template renders both workspace instructions with platform-specific add commands", () => {
  const root = baseline();
  const manifest = loadInitManifest();
  installManagedFiles(root, manifest, ["claude", "codex"]);
  const source = fs.readFileSync(path.join(__dirname, "..", "..", "artifacts", "templates", "agents", "WORKSPACE_GUARD.md.template"), "utf8");
  const claude = fs.readFileSync(path.join(root, "CLAUDE.md"), "utf8");
  const codex = fs.readFileSync(path.join(root, "AGENTS.md"), "utf8");
  const normalize = (content) => content
    .replace("/opswx:add-projects /absolute/path/to/project", "<add-projects>")
    .replace("$openspec-workspace-add-projects /absolute/path/to/project", "<add-projects>");
  assert.equal(normalize(claude), normalize(codex));
  assert.match(source, /\{\{ADD_PROJECTS_INVOCATION\}\}/);
  assert.equal(source.trimEnd().split("\n").length <= 80, true);
  for (const content of [claude, codex]) {
    assert.match(content, /The workspace is not a project/);
    assert.match(content, /openspec-w project list --json/);
    assert.match(content, /openspec-w project verify "<project\.name>" --json/);
    assert.match(content, /openspec-workspace-resolve-branch/);
    assert.match(content, /PROJECT_BRANCH_MISMATCH/);
    assert.match(content, /MUST NOT guess a project path/);
    assert.match(content, /MUST NOT directly create, edit, move, or delete files under the workspace root outside `openspec\/`/);
    assert.doesNotMatch(content, /OpenSpec owns|Cross-project|Every capability|proposal|archive workflow/);
  }
  assert.match(claude, /\/opswx:add-projects \/absolute\/path\/to\/project/);
  assert.doesNotMatch(claude, /\$openspec-workspace-add-projects/);
  assert.match(codex, /\$openspec-workspace-add-projects \/absolute\/path\/to\/project/);
  assert.doesNotMatch(codex, /\/opswx:add-projects/);
});

test("Claude selection installs only the Claude root instruction template", () => {
  const root = baseline(["claude"]);
  const manifest = loadInitManifest();
  const result = installManagedFiles(root, manifest, ["claude"]);
  assert(result.some((entry) => entry.target === "CLAUDE.md"));
  assert(!result.some((entry) => entry.target === "AGENTS.md"));
  assert(result.some((entry) => entry.target === ".claude/skills/openspec-workspace-resolve-branch/SKILL.md"));
  assert(fs.existsSync(path.join(root, "CLAUDE.md")));
  assert(!fs.existsSync(path.join(root, "AGENTS.md")));
});

test("manifest-owned render values must be declared strings", () => {
  const manifest = loadInitManifest();
  const modified = JSON.parse(JSON.stringify(manifest));
  const entry = modified.managedFiles.find((item) => item.id === "workspace-codex-instructions");
  entry.render.values.ADD_PROJECTS_INVOCATION = true;
  const file = path.join(os.tmpdir(), `managed-render-${process.pid}-${Date.now()}.json`);
  fs.writeFileSync(file, `${JSON.stringify(modified, null, 2)}\n`);
  try {
    assert.throws(() => loadManagedManifest(file), /Invalid managed file render value/);
  } finally {
    fs.unlinkSync(file);
  }
});

test("compiled patch outputs match the reviewed patch and generated OpenSpec baseline", () => {
  const manifest = loadInitManifest();
  assert.deepEqual(
    manifest.sources.filter((source) => source.kind === "patch").map((source) => checkPatchSource(manifest, source)),
    [12, 1]
  );
});

test("compiled OpenSpec workflows preserve Workspace safety boundaries", () => {
  const root = path.resolve(__dirname, "..", "..", "artifacts", "patches", "openspec", "1.5.0", "outputs");
  const files = [
    ["claude", "commands", "opsx", "apply.md"],
    ["claude", "commands", "opsx", "archive.md"],
    ["claude", "commands", "opsx", "explore.md"],
    ["claude", "commands", "opsx", "propose.md"],
    ["claude", "skills", "openspec-apply-change", "SKILL.md"],
    ["claude", "skills", "openspec-archive-change", "SKILL.md"],
    ["claude", "skills", "openspec-explore", "SKILL.md"],
    ["claude", "skills", "openspec-propose", "SKILL.md"],
    ["codex", "skills", "openspec-apply-change", "SKILL.md"],
    ["codex", "skills", "openspec-archive-change", "SKILL.md"],
    ["codex", "skills", "openspec-explore", "SKILL.md"],
    ["codex", "skills", "openspec-propose", "SKILL.md"],
  ];
  const contents = files.map((segments) => fs.readFileSync(path.join(root, ...segments), "utf8"));
  for (const content of contents) {
    assert.doesNotMatch(content, /git -C "<location>" switch/);
    assert.doesNotMatch(content, /update only that project's `branch` field/);
  }
  assert(contents.filter((content) => /openspec-workspace-resolve-branch/.test(content)).length >= 9);
  assert(contents.filter((content) => /planningHome\.kind: "repo"/.test(content)).length >= 9);
  assert(contents.filter((content) => /change validate "<name>" --require-main-specs --json/.test(content)).length === 3);
});

test("the unified manifest rejects passive source fingerprint changes before installation", () => {
  const manifest = loadInitManifest();
  const modified = JSON.parse(JSON.stringify(manifest));
  modified.managedFiles[0].desired.sha256 = "0".repeat(64);
  const file = path.join(os.tmpdir(), `managed-manifest-${process.pid}-${Date.now()}.json`);
  fs.writeFileSync(file, `${JSON.stringify(modified, null, 2)}\n`);
  try {
    assert.throws(() => loadManagedManifest(file), /source checksum mismatch/);
  } finally {
    fs.unlinkSync(file);
  }
});
