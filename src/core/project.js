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

function executeGit(location, args, options = {}) {
  const result = spawnSync("git", ["-C", location, ...args], {
    encoding: "utf8",
    timeout: options.timeout || 5000,
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

function runGit(location, args, options = {}) {
  const result = executeGit(location, args, options);
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

function gitRemoteTrackingBranches(location, branch, options = {}) {
  const prefix = "refs/remotes/";
  const result = executeGit(location, ["for-each-ref", "--format=%(refname)", "refs/remotes"], options);
  if (result.status !== 0) {
    const detail = String(result.stderr || result.stdout || "").trim().split(/\r?\n/)[0];
    throw new WorkspaceError("GIT_COMMAND_FAILED", detail || "git for-each-ref failed", {
      location,
      args: ["for-each-ref", "--format=%(refname)", "refs/remotes"],
      exitCode: result.status,
    });
  }
  const suffix = `/${branch}`;
  return String(result.stdout || "").trim().split(/\r?\n/)
    .filter((ref) => ref.startsWith(prefix) && ref.endsWith(suffix))
    .map((ref) => {
      const remoteBranch = ref.slice(prefix.length);
      return {
        remote: remoteBranch.slice(0, -suffix.length),
        remoteBranch,
      };
    })
    .filter((entry) => entry.remote && entry.remoteBranch !== `${entry.remote}/HEAD`);
}

function gitRemotes(location, options = {}) {
  return runGit(location, ["remote"], options).split(/\r?\n/).filter(Boolean);
}

function gitRemoteBranchHead(location, remoteBranch, options = {}) {
  return runGit(location, ["rev-parse", `refs/remotes/${remoteBranch}`], options);
}

function fetchRegisteredBranch(location, remote, branch, options = {}) {
  try {
    if (!gitRemotes(location, options).includes(remote)) {
      throw new WorkspaceError("PROJECT_BRANCH_REMOTE_MISSING", `Configured Git remote does not exist: ${remote}.`, {
        location,
        remote,
        branch,
        remediation: "Choose an existing Git remote, then retry.",
      });
    }
    runGit(location, [
      "fetch",
      "--no-tags",
      remote,
      `refs/heads/${branch}:refs/remotes/${remote}/${branch}`,
    ], { ...options, timeout: options.fetchTimeout || 30000 });
  } catch (error) {
    if (error.code === "PROJECT_BRANCH_REMOTE_MISSING") throw error;
    throw new WorkspaceError("PROJECT_BRANCH_FETCH_FAILED", `Could not fetch ${remote}/${branch}: ${error.message}`, {
      location,
      remote,
      branch,
      cause: error.code || error.name,
      remediation: "Check network access and Git credentials, then retry.",
    });
  }
  return {
    remote,
    remoteBranch: `${remote}/${branch}`,
    targetHead: gitRemoteBranchHead(location, `${remote}/${branch}`, options),
  };
}

function createTrackingBranch(location, branch, remoteBranch, options = {}) {
  try {
    runGit(location, ["switch", "--track", "-c", branch, remoteBranch], options);
  } catch (error) {
    throw new WorkspaceError("PROJECT_BRANCH_CREATE_FAILED", `Could not create local branch ${branch} tracking ${remoteBranch}: ${error.message}`, {
      location,
      branch,
      remoteBranch,
      cause: error.code || error.name,
      remediation: "Inspect the local Git branches and resolve the conflict manually before retrying.",
    });
  }
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
    const result = {
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
    if (options.includeRemoteBranchCandidates) {
      result.remoteBranchCandidates = (options.gitRemoteTrackingBranches || gitRemoteTrackingBranches)(project.location, project.branch, options);
    }
    return result;
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

function assertRemoteOptions(options = {}) {
  if (options.allowRemote === true && options.remote !== undefined) {
    throw new WorkspaceError("CLI_OPTION_CONFLICT", "--allow-remote and --remote cannot be used together.", {
      options: ["allow-remote", "remote"],
      remediation: "Use --allow-remote for an existing remote-tracking branch, or --remote <name> to fetch.",
    });
  }
}

function planRegisteredBranchAcquisition(state, options = {}) {
  assertRemoteOptions(options);
  if (state.registeredBranchExists) {
    return {
      mode: "local",
      remote: null,
      remoteBranch: null,
      targetHead: null,
      localBranchCreated: false,
    };
  }
  if (options.remote !== undefined) {
    const remotes = options.gitRemotes ? options.gitRemotes(state.project.location, options) : gitRemotes(state.project.location, options);
    if (!remotes.includes(options.remote)) {
      throw new WorkspaceError("PROJECT_BRANCH_REMOTE_MISSING", `Configured Git remote does not exist: ${options.remote}.`, {
        project: state.project.name,
        location: state.project.location,
        remote: options.remote,
        registeredBranch: state.registeredBranch,
        remediation: "Choose an existing Git remote, then retry.",
      });
    }
    return {
      mode: "fetched",
      remote: options.remote,
      remoteBranch: `${options.remote}/${state.registeredBranch}`,
      targetHead: null,
      localBranchCreated: true,
    };
  }
  if (options.allowRemote === true) {
    const candidates = options.gitRemoteTrackingBranches
      ? options.gitRemoteTrackingBranches(state.project.location, state.registeredBranch, options)
      : (state.remoteBranchCandidates || []);
    if (candidates.length > 1) {
      throw new WorkspaceError("PROJECT_BRANCH_REMOTE_AMBIGUOUS", `Multiple remote-tracking branches match ${state.registeredBranch} for project ${state.project.name}.`, {
        project: state.project.name,
        location: state.project.location,
        registeredBranch: state.registeredBranch,
        candidates,
        remediation: "Specify --remote <name> to select a remote and fetch explicitly.",
      });
    }
    if (candidates.length === 1) {
      const candidate = candidates[0];
      return {
        mode: "remote-tracking",
        remote: candidate.remote,
        remoteBranch: candidate.remoteBranch,
        targetHead: (options.gitRemoteBranchHead || gitRemoteBranchHead)(state.project.location, candidate.remoteBranch, options),
        localBranchCreated: true,
      };
    }
    throw new WorkspaceError("PROJECT_BRANCH_REMOTE_UNAVAILABLE", `No remote-tracking branch exists locally for ${state.registeredBranch} in project ${state.project.name}.`, {
      project: state.project.name,
      location: state.project.location,
      registeredBranch: state.registeredBranch,
      remediation: "Use --remote <name> to fetch the registered branch, or create/fetch it manually.",
    });
  }
  assertRegisteredBranchSwitchAvailable(state);
  return null;
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
  const acquisition = plan.acquisition || planRegisteredBranchAcquisition(plan, options);
  if (acquisition?.mode === "local") assertRegisteredBranchSwitchAvailable(plan);
  else if (!plan.worktreeClean) assertRegisteredBranchSwitchAvailable(plan);
  if (plan.matches) {
    return {
      action: "skip",
      project: plan.project,
      before: canonicalBranchState(plan),
      after: canonicalBranchState(plan),
      worktreeClean: plan.worktreeClean,
      registeredBranchExists: plan.registeredBranchExists,
      acquisition,
    };
  }
  const project = {
    name: plan.project.name,
    location: plan.project.location,
    branch: plan.registeredBranch,
  };
  const observe = () => (options.inspectProjectBranchState || inspectProjectBranchState)(project, options);
  const switchBranch = options.switchGitBranch || switchGitBranch;
  let createdLocalBranch = false;
  const observedBefore = observe();
  if (!sameBranchPlan(plan, observedBefore)) throw staleBranchPlanError(plan, observedBefore);
  if (!observedBefore.worktreeClean) assertRegisteredBranchSwitchAvailable(observedBefore);

  let effectiveAcquisition = { ...acquisition };
  if (effectiveAcquisition.mode === "fetched") {
    const fetched = (options.fetchRegisteredBranch || fetchRegisteredBranch)(project.location, effectiveAcquisition.remote, plan.registeredBranch, options);
    effectiveAcquisition = { ...effectiveAcquisition, ...fetched };
  }
  if (effectiveAcquisition.mode === "remote-tracking" || effectiveAcquisition.mode === "fetched") {
    const remoteBranch = effectiveAcquisition.remoteBranch;
    const targetHead = effectiveAcquisition.targetHead || (options.gitRemoteBranchHead || gitRemoteBranchHead)(project.location, remoteBranch, options);
    effectiveAcquisition = { ...effectiveAcquisition, targetHead };
    const afterFetch = observe();
    if (effectiveAcquisition.mode === "remote-tracking") {
      const candidate = afterFetch.remoteBranchCandidates?.find((entry) => entry.remoteBranch === remoteBranch);
      const observedHead = candidate && (options.gitRemoteBranchHead || gitRemoteBranchHead)(project.location, remoteBranch, options);
      if (!candidate || observedHead !== targetHead) throw staleBranchPlanError(plan, afterFetch);
    }
    if (afterFetch.registeredBranchExists) {
      throw new WorkspaceError("PROJECT_BRANCH_PLAN_STALE", `Project ${project.name} acquired a local branch while preparing to switch.`, {
        project: project.name,
        location: project.location,
        registeredBranch: plan.registeredBranch,
        remediation: "Inspect the selected project branch state again before retrying.",
      });
    }
  }

  let switched = false;
  try {
    options.injectFailure?.("before-switch", observedBefore);
    switched = true;
    try {
      if (effectiveAcquisition.mode === "remote-tracking" || effectiveAcquisition.mode === "fetched") {
        (options.createTrackingBranch || createTrackingBranch)(project.location, plan.registeredBranch, effectiveAcquisition.remoteBranch, options);
        createdLocalBranch = true;
      } else {
        switchBranch(project.location, plan.registeredBranch);
      }
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
      acquisition: effectiveAcquisition,
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
      if (createdLocalBranch) {
        const retainedEffect = {
          kind: "git-branch-created",
          status: "possibly-applied",
          retained: true,
          project: project.name,
          location: project.location,
          branch: plan.registeredBranch,
          remoteBranch: effectiveAcquisition.remoteBranch,
          remediation: `Remove local branch ${plan.registeredBranch} manually only after verifying it is no longer needed.`,
        };
        failure.details = {
          ...(failure.details || {}),
          retainedEffects: [retainedEffect],
        };
        attachRetainedEffects(failure, [retainedEffect]);
      }
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
      if (createdLocalBranch) {
        const retainedEffect = {
          kind: "git-branch-created",
          status: "possibly-applied",
          retained: true,
          project: project.name,
          location: project.location,
          branch: plan.registeredBranch,
          remoteBranch: effectiveAcquisition.remoteBranch,
          remediation: `Remove local branch ${plan.registeredBranch} manually only after verifying it is no longer needed.`,
        };
        failure.details.retainedEffects = [retainedEffect];
        failure.details.effects = {
          ...(failure.details.effects || {}),
          retained: [
            ...(failure.details.effects?.retained || []),
            retainedEffect,
          ],
        };
      }
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
  gitRemoteBranchHead,
  gitRemoteTrackingBranches,
  gitRemotes,
  gitWorktreeClean,
  fetchRegisteredBranch,
  createTrackingBranch,
  inspectGitWorktree,
  inspectProject,
  inspectProjectBranch,
  inspectProjectBranchMatch,
  inspectProjectBranchState,
  planRegisteredBranchAcquisition,
  assertRemoteOptions,
  runGit,
  sameBranchPlan,
  switchGitBranch,
  switchProjectToRegisteredBranch,
};
