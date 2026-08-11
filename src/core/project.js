const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { WorkspaceError } = require("./errors");

const MANIFEST_FILES = [
  "package.json",
  "pom.xml",
  "build.gradle",
  "build.gradle.kts",
  "settings.gradle",
  "settings.gradle.kts",
  "go.mod",
  "Cargo.toml",
  "pyproject.toml",
  "requirements.txt",
  "Gemfile",
  "composer.json",
];

const README_FILES = [
  "README.md",
  "README.zh-CN.md",
];

function runGit(location, args) {
  const result = spawnSync("git", ["-C", location, ...args], {
    encoding: "utf8",
    timeout: 5000,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const detail = String(result.stderr || result.stdout || "").trim().split(/\r?\n/)[0];
    throw new WorkspaceError("GIT_COMMAND_FAILED", detail || `git ${args.join(" ")} failed`, { args });
  }
  return String(result.stdout || "").trim();
}

function inspectGitWorktree(input) {
  const location = path.resolve(input);
  if (!fs.existsSync(location)) throw new WorkspaceError("PROJECT_LOCATION_MISSING", `Project location does not exist: ${location}`, { location });
  if (!fs.statSync(location).isDirectory()) throw new WorkspaceError("PROJECT_LOCATION_NOT_DIRECTORY", `Project location is not a directory: ${location}`, { location });
  const topLevel = runGit(location, ["rev-parse", "--show-toplevel"]);
  const realPath = fs.realpathSync(location);
  const realTopLevel = fs.realpathSync(topLevel);
  if (realPath !== realTopLevel) {
    throw new WorkspaceError("PROJECT_LOCATION_NOT_WORKTREE_ROOT", `Project location must be the Git worktree root: ${location} (root: ${topLevel})`, { location, worktreeRoot: topLevel });
  }
  const branch = runGit(location, ["symbolic-ref", "--quiet", "--short", "HEAD"]);
  return { location, realPath, branch };
}

function inspectProject(input) {
  const git = inspectGitWorktree(input);
  const topLevelEntries = fs.readdirSync(git.realPath, { withFileTypes: true })
    .map((entry) => entry.name)
    .filter((name) => name !== ".git")
    .sort();
  const manifestFiles = MANIFEST_FILES.filter((file) => fs.existsSync(path.join(git.realPath, file)));
  const readmeFiles = README_FILES.filter((file) => fs.existsSync(path.join(git.realPath, file)));
  return {
    location: git.realPath,
    branch: git.branch,
    facts: {
      gitRoot: git.realPath,
      manifestFiles,
      readmeFiles,
      topLevelEntries,
    },
  };
}

module.exports = {
  MANIFEST_FILES,
  README_FILES,
  inspectGitWorktree,
  inspectProject,
  runGit,
};
