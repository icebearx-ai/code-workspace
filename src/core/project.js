const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { WorkspaceError } = require("./errors");
const { attachRetainedEffects } = require("./transaction");

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

function executeGit(location, args) {
  const result = spawnSync("git", ["-C", location, ...args], {
    encoding: "utf8",
    timeout: 5000,
  });
  if (result.error) {
    throw new WorkspaceError("GIT_COMMAND_FAILED", result.error.message, {
      location,
      args,
      cause: result.error.code || result.error.name,
    });
  }
  return result;
}

function runGit(location, args) {
  const result = executeGit(location, args);
  if (result.status !== 0) {
    const detail = String(result.stderr || result.stdout || "").trim().split(/\r?\n/)[0];
    throw new WorkspaceError("GIT_COMMAND_FAILED", detail || `git ${args.join(" ")} failed`, {
      location,
      args,
      exitCode: result.status,
    });
  }
  return String(result.stdout || "").trim();
}

function gitWorktreeClean(location) {
  return runGit(location, ["status", "--porcelain"]) === "";
}

function gitLocalBranchExists(location, branch) {
  const args = ["show-ref", "--verify", "--quiet", `refs/heads/${branch}`];
  const result = executeGit(location, args);
  if (result.status === 0) return true;
  if (result.status === 1) return false;
  const detail = String(result.stderr || result.stdout || "").trim().split(/\r?\n/)[0];
  throw new WorkspaceError("GIT_COMMAND_FAILED", detail || `git ${args.join(" ")} failed`, {
    location,
    args,
    exitCode: result.status,
  });
}

function switchGitBranch(location, branch) {
  runGit(location, ["switch", "--", branch]);
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

function canonicalBranchState(value) {
  return {
    registeredBranch: value.registeredBranch,
    actualBranch: value.actualBranch,
  };
}

function findRegisteredProject(config, name) {
  const project = config.projects.find((entry) => entry?.name === name);
  if (!project) {
    throw new WorkspaceError("PROJECT_NOT_FOUND", `Unknown local project: ${name}`, {
      project: name,
    });
  }
  return project;
}

function inspectProjectBranchState(project, options = {}) {
  try {
    const actual = (options.inspectGitWorktree || inspectGitWorktree)(project.location);
    const worktreeClean = (options.gitWorktreeClean || gitWorktreeClean)(project.location);
    const registeredBranchExists = actual.branch === project.branch
      || (options.gitLocalBranchExists || gitLocalBranchExists)(project.location, project.branch);
    return {
      project: {
        name: project.name,
        location: actual.realPath || project.location,
      },
      registeredBranch: project.branch,
      actualBranch: actual.branch,
      matches: project.branch === actual.branch,
      worktreeClean,
      registeredBranchExists,
    };
  } catch (error) {
    if (error.code === "PROJECT_BRANCH_INSPECTION_FAILED") throw error;
    throw new WorkspaceError(
      "PROJECT_BRANCH_INSPECTION_FAILED",
      `Cannot inspect branch state for project ${project.name}: ${error.message}`,
      {
        project: project.name,
        location: project.location,
        cause: error.code || error.name,
        remediation: "Inspect the selected Git worktree and retry the command.",
      }
    );
  }
}

function inspectProjectBranch(config, name, options = {}) {
  return inspectProjectBranchState(findRegisteredProject(config, name), options);
}

function inspectProjectBranchMatch(config, name, options = {}) {
  const project = findRegisteredProject(config, name);
  try {
    const actual = (options.inspectGitWorktree || inspectGitWorktree)(project.location);
    return {
      project: {
        name: project.name,
        location: actual.realPath || project.location,
      },
      registeredBranch: project.branch,
      actualBranch: actual.branch,
      matches: project.branch === actual.branch,
    };
  } catch (error) {
    if (error.code === "PROJECT_BRANCH_INSPECTION_FAILED") throw error;
    throw new WorkspaceError(
      "PROJECT_BRANCH_INSPECTION_FAILED",
      `Cannot inspect branch state for project ${project.name}: ${error.message}`,
      {
        project: project.name,
        location: project.location,
        cause: error.code || error.name,
        remediation: "Inspect the selected Git worktree and retry the command.",
      }
    );
  }
}

function assertRegisteredBranchSwitchAvailable(state) {
  if (!state.worktreeClean) {
    throw new WorkspaceError(
      "PROJECT_WORKTREE_DIRTY",
      `Project ${state.project.name} has uncommitted changes; its registered branch cannot be selected automatically.`,
      {
        project: state.project.name,
        location: state.project.location,
        ...canonicalBranchState(state),
        remediation: "Commit, discard, or otherwise resolve the selected worktree changes manually, then retry.",
      }
    );
  }
  if (!state.registeredBranchExists) {
    throw new WorkspaceError(
      "PROJECT_REGISTERED_BRANCH_MISSING",
      `Registered branch ${state.registeredBranch} does not exist locally for project ${state.project.name}.`,
      {
        project: state.project.name,
        location: state.project.location,
        ...canonicalBranchState(state),
        remediation: "Create or fetch the registered branch manually, then retry; Code Workspace will not create or download it.",
      }
    );
  }
  return state;
}

function sameBranchPlan(expected, observed) {
  return expected.registeredBranch === observed.registeredBranch
    && expected.actualBranch === observed.actualBranch
    && expected.worktreeClean === observed.worktreeClean
    && expected.registeredBranchExists === observed.registeredBranchExists;
}

function staleBranchPlanError(expected, observed) {
  return new WorkspaceError(
    "PROJECT_BRANCH_PLAN_STALE",
    `Branch state changed while preparing to switch project ${expected.project.name}.`,
    {
      project: expected.project.name,
      location: expected.project.location,
      expectedState: canonicalBranchState(expected),
      observedState: canonicalBranchState(observed),
      expectedSafety: {
        worktreeClean: expected.worktreeClean,
        registeredBranchExists: expected.registeredBranchExists,
      },
      observedSafety: {
        worktreeClean: observed.worktreeClean,
        registeredBranchExists: observed.registeredBranchExists,
      },
      remediation: "Inspect the selected project branch state again before choosing a direction.",
    }
  );
}

function switchProjectToRegisteredBranch(plan, options = {}) {
  assertRegisteredBranchSwitchAvailable(plan);
  if (plan.matches) {
    return {
      action: "skip",
      project: plan.project,
      before: canonicalBranchState(plan),
      after: canonicalBranchState(plan),
      worktreeClean: plan.worktreeClean,
      registeredBranchExists: plan.registeredBranchExists,
    };
  }
  const project = {
    name: plan.project.name,
    location: plan.project.location,
    branch: plan.registeredBranch,
  };
  const observe = () => (options.inspectProjectBranchState || inspectProjectBranchState)(project, options);
  const switchBranch = options.switchGitBranch || switchGitBranch;
  const observedBefore = observe();
  if (!sameBranchPlan(plan, observedBefore)) throw staleBranchPlanError(plan, observedBefore);
  assertRegisteredBranchSwitchAvailable(observedBefore);

  let switched = false;
  try {
    options.injectFailure?.("before-switch", observedBefore);
    switched = true;
    try {
      switchBranch(project.location, plan.registeredBranch);
    } catch (switchError) {
      throw new WorkspaceError(
        "PROJECT_BRANCH_SWITCH_FAILED",
        `Could not switch project ${project.name} to its registered branch: ${switchError.message}`,
        {
          project: project.name,
          location: project.location,
          expectedState: {
            registeredBranch: plan.registeredBranch,
            actualBranch: plan.registeredBranch,
          },
          observedState: canonicalBranchState(observedBefore),
          cause: switchError.code || switchError.name,
        }
      );
    }
    options.injectFailure?.("after-switch", observedBefore);
    const observedAfter = observe();
    const expectedAfter = {
      registeredBranch: plan.registeredBranch,
      actualBranch: plan.registeredBranch,
    };
    if (observedAfter.actualBranch !== expectedAfter.actualBranch || !observedAfter.worktreeClean) {
      throw new WorkspaceError(
        "PROJECT_BRANCH_SWITCH_VERIFY_FAILED",
        `Project ${project.name} did not reach the registered branch in a clean state.`,
        {
          project: project.name,
          location: project.location,
          expectedState: expectedAfter,
          observedState: canonicalBranchState(observedAfter),
          expectedWorktreeClean: true,
          observedWorktreeClean: observedAfter.worktreeClean,
        }
      );
    }
    options.injectFailure?.("after-verify", observedAfter);
    return {
      action: "switch",
      project: observedAfter.project,
      before: canonicalBranchState(plan),
      after: canonicalBranchState(observedAfter),
      worktreeClean: observedAfter.worktreeClean,
      registeredBranchExists: observedAfter.registeredBranchExists,
    };
  } catch (error) {
    if (!switched) {
      if (["PROJECT_BRANCH_PLAN_STALE", "PROJECT_WORKTREE_DIRTY", "PROJECT_REGISTERED_BRANCH_MISSING"].includes(error.code)) throw error;
      throw new WorkspaceError(
        "PROJECT_BRANCH_SWITCH_FAILED",
        `Could not switch project ${project.name} to its registered branch: ${error.message}`,
        {
          project: project.name,
          location: project.location,
          expectedState: {
            registeredBranch: plan.registeredBranch,
            actualBranch: plan.registeredBranch,
          },
          observedState: canonicalBranchState(observedBefore),
          cause: error.code || error.name,
          remediation: "Inspect the selected worktree and resolve the Git error manually before retrying.",
        }
      );
    }

    const failure = ["PROJECT_BRANCH_SWITCH_FAILED", "PROJECT_BRANCH_SWITCH_VERIFY_FAILED"].includes(error.code)
      ? error
      : new WorkspaceError(
        "PROJECT_BRANCH_SWITCH_VERIFY_FAILED",
        `Project ${project.name} branch switch could not be verified: ${error.message}`,
        {
          project: project.name,
          location: project.location,
          expectedState: {
            registeredBranch: plan.registeredBranch,
            actualBranch: plan.registeredBranch,
          },
          cause: error.code || error.name,
        }
      );
    try {
      options.injectFailure?.("before-compensation", failure);
      switchBranch(project.location, plan.actualBranch);
      const compensated = observe();
      if (compensated.actualBranch !== plan.actualBranch || !compensated.worktreeClean) {
        throw new Error("Compensation did not restore the original clean branch state");
      }
      options.injectFailure?.("after-compensation", compensated);
      failure.details = {
        ...(failure.details || {}),
        observedState: failure.details?.observedState || canonicalBranchState(compensated),
        compensation: {
          attempted: true,
          succeeded: true,
          restoredState: canonicalBranchState(compensated),
        },
      };
      throw failure;
    } catch (compensationError) {
      if (compensationError === failure) throw failure;
      let retainedObservation = null;
      try {
        retainedObservation = observe();
      } catch {
        retainedObservation = null;
      }
      if (retainedObservation?.actualBranch === plan.actualBranch && retainedObservation.worktreeClean) {
        failure.details = {
          ...(failure.details || {}),
          observedState: failure.details?.observedState || canonicalBranchState(retainedObservation),
          compensation: {
            attempted: true,
            succeeded: true,
            restoredState: canonicalBranchState(retainedObservation),
            verificationCause: compensationError.code || compensationError.name,
          },
        };
        throw failure;
      }
      const retainedState = retainedObservation ? canonicalBranchState(retainedObservation) : null;
      failure.details = {
        ...(failure.details || {}),
        observedState: retainedState || failure.details?.observedState || null,
        compensation: {
          attempted: true,
          succeeded: false,
          cause: compensationError.code || compensationError.name,
          message: compensationError.message,
        },
        remediation: `Restore project ${project.name} to branch ${plan.actualBranch} manually, verify a clean worktree, then retry targeted verification.`,
      };
      throw attachRetainedEffects(failure, [{
        kind: "git-branch-switch",
        status: "possibly-applied",
        retained: true,
        project: project.name,
        location: project.location,
        expectedState: canonicalBranchState(plan),
        observedState: retainedState,
        remediation: failure.details.remediation,
      }]);
    }
  }
}

module.exports = {
  MANIFEST_FILES,
  README_FILES,
  assertRegisteredBranchSwitchAvailable,
  canonicalBranchState,
  findRegisteredProject,
  gitLocalBranchExists,
  gitWorktreeClean,
  inspectGitWorktree,
  inspectProject,
  inspectProjectBranch,
  inspectProjectBranchMatch,
  inspectProjectBranchState,
  runGit,
  sameBranchPlan,
  switchGitBranch,
  switchProjectToRegisteredBranch,
};
