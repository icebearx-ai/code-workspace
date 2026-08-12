const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const yaml = require("js-yaml");

const repositoryRoot = path.resolve(__dirname, "..", "..");
const guardRoot = path.join(repositoryRoot, ".codex", "skills", "cli-architecture-guard");
const { COMMANDS } = require("../cli/registry");
const {
  inspectCommandSource,
  runChecks,
  validateDispatchCoverage,
  validateRegistry,
} = require(path.join(repositoryRoot, "scripts", "check-cli-architecture.js"));

test("CLI architecture guard accepts the current command framework", () => {
  const result = runChecks(repositoryRoot);
  assert.deepEqual(result.problems, []);
  assert.equal(result.stats.commands, COMMANDS.length);
  assert(result.stats.documentedReferences >= 20);
});

test("CLI architecture guard rejects incomplete command contracts", () => {
  const problems = validateRegistry([{
    path: ["project", "unsafe"],
    args: [],
    workspace: "required",
    config: ["complete", "projects"],
    interaction: "required",
    effects: "planned-write",
    options: {},
  }]);
  const codes = new Set(problems.map((entry) => entry.code));
  assert(codes.has("REGISTRY_CONFIG_COMPLETE_MIXED"));
  assert(codes.has("REGISTRY_CONFIRMATION_OPTION_MISSING"));
});

test("CLI architecture guard rejects raw persistence in command modules", () => {
  const problems = inspectCommandSource("src/cli/commands/unsafe.js", [
    "const fs = require(\"node:fs\");",
    "const { atomicWrite } = require(\"../../core/fs\");",
    "const { readConfigDocument } = require(\"../../core/config\");",
    "fs.writeFileSync(\"config.yaml\", \"unsafe\");",
    "",
  ].join("\n"));
  const codes = new Set(problems.map((entry) => entry.code));
  assert(codes.has("COMMAND_IMPORTS_CORE_FS"));
  assert(codes.has("COMMAND_USES_RAW_PERSISTENCE"));
  assert(codes.has("COMMAND_WRITES_FILES_DIRECTLY"));
});

test("CLI architecture guard rejects registered commands without a dispatch route", () => {
  const problems = validateDispatchCoverage(
    [{ path: ["project", "listed"] }, { path: ["orphan"] }],
    'if (key.startsWith("project ")) return executeProject(invocation);'
  );
  assert.deepEqual(problems.map((entry) => entry.code), ["DISPATCH_HANDLER_MISSING"]);
  assert.match(problems[0].message, /orphan/);
});

test("CLI architecture guard skill consumes repository-owned architecture checks", () => {
  const skill = fs.readFileSync(path.join(guardRoot, "SKILL.md"), "utf8");
  const reference = fs.readFileSync(path.join(repositoryRoot, "docs", "cli-architecture.md"), "utf8");
  const evals = JSON.parse(fs.readFileSync(path.join(guardRoot, "evals", "evals.json"), "utf8"));
  const packageJson = JSON.parse(fs.readFileSync(path.join(repositoryRoot, "package.json"), "utf8"));
  const frontmatter = yaml.load(skill.match(/^---\n([\s\S]*?)\n---/)[1]);
  assert.deepEqual(Object.keys(frontmatter), ["name", "description"]);
  assert.equal(frontmatter.name, "cli-architecture-guard");
  assert.match(skill, /Read `docs\/cli-architecture\.md`/);
  assert.match(skill, /node scripts\/check-cli-architecture\.js/);
  assert.match(skill, /npm run cli:architecture-check/);
  assert.match(skill, /CLI architecture guard: PASS\|FAIL/);
  assert.match(reference, /inspect\n→ plan\n→ validate plan/);
  assert.equal(packageJson.scripts["cli:architecture-check"], "node scripts/check-cli-architecture.js");
  assert.doesNotMatch(packageJson.scripts["cli:architecture-check"], /\.codex/);
  assert.equal(evals.skill_name, "cli-architecture-guard");
  assert.equal(evals.evals.length, 3);
});
