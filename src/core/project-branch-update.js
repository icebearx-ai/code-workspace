const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const { WorkspaceError } = require("./errors");
const { attachRetainedEffects } = require("./transaction");
const { findRegisteredProject, gitWorktreeClean, inspectGitWorktree } = require("./project");
const { loadConfigProjection } = require("./config");

const DEFAULT_GIT_TIMEOUT = 30000;

function canonicalLocation(location) {
  try {
    return fs.realpathSync(location);
  } catch {
    return path.resolve(location);
  }
}

function executeGit(location, args, options = {}) {
  const result = spawnSync("git", ["-C", location, ...args], {
    encoding: "utf8",
    timeout: options.timeout || DEFAULT_GIT_TIMEOUT,
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

function projectUpdateError(code, message, project, details = {}) {
  return new WorkspaceError(code, message, {
    project: project.name,
    location: project.location,
    registeredBranch: project.branch,
    ...details,
  });
}

function updateProjectPolicy(project) {
  if (project.updateLatest === undefined) return false;
  if (typeof project.updateLatest !== "boolean") {
    throw projectUpdateError(
      "PROJECT_UPDATE_LATEST_INVALID",
      `Project ${project.name} updateLatest must be a boolean when present.`,
      project,
      { field: "updateLatest", actual: project.updateLatest }
    );
  }
  return project.updateLatest;
}

function gitHead(location, ref = "HEAD", options = {}) {
  return runGit(location, ["rev-parse", ref], options);
}

function gitUpstream(location, branch, options = {}) {
  const upstreamResult = executeGit(location, ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}"], options);
  const upstreamError = String(upstreamResult.stderr || upstreamResult.stdout || "");
  if (upstreamResult.status === 1 || /no upstream|upstream/i.test(upstreamError)) {
    throw new WorkspaceError("PROJECT_BRANCH_UPSTREAM_MISSING", `Project branch ${branch} has no configured upstream.`, {
      location,
      branch,
      remediation: "Configure an upstream branch manually, then retry.",
    });
  }
  if (upstreamResult.status !== 0) {
    const detail = String(upstreamResult.stderr || upstreamResult.stdout || "").trim();
    throw new WorkspaceError("GIT_COMMAND_FAILED", detail || "git rev-parse upstream failed", {
      location,
      branch,
      args: ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}"],
      exitCode: upstreamResult.status,
    });
  }
  const upstream = String(upstreamResult.stdout || "").trim();
  let remote;
  let merge;
  try {
    remote = runGit(location, ["config", "--get", `branch.${branch}.remote`], options);
    merge = runGit(location, ["config", "--get", `branch.${branch}.merge`], options);
  } catch (error) {
    throw new WorkspaceError("PROJECT_BRANCH_UPSTREAM_MISSING", `Project branch ${branch} has no configured upstream.`, {
      location,
      branch,
      upstream,
      cause: error.code || error.name,
      remediation: "Configure an upstream branch manually, then retry.",
    });
  }
  if (!remote || !merge) {
    throw new WorkspaceError("PROJECT_BRANCH_UPSTREAM_MISSING", `Project branch ${branch} has no configured upstream.`, {
      location,
      branch,
      upstream: upstream || null,
      remediation: "Configure an upstream branch manually, then retry.",
    });
  }
  return { name: upstream, remote, merge };
}

function inspectLatestBranchState(project, options = {}) {
  const inspect = options.inspectGitWorktree || inspectGitWorktree;
  const clean = options.gitWorktreeClean || gitWorktreeClean;
  try {
    const actual = inspect(project.location);
    const worktreeClean = clean(project.location);
    const head = (options.gitHead || gitHead)(project.location, "HEAD", options);
    let upstream = null;
    try {
      upstream = (options.gitUpstream || gitUpstream)(project.location, actual.branch, options);
    } catch (error) {
      if (error.code !== "PROJECT_BRANCH_UPSTREAM_MISSING") throw error;
      upstream = null;
    }
    return {
      project: {
        name: project.name,
        location: actual.realPath || project.location,
      },
      registeredBranch: project.branch,
      actualBranch: actual.branch,
      matches: project.branch === actual.branch,
      worktreeClean,
      head,
      upstream,
    };
  } catch (error) {
    if (error.code === "PROJECT_UPDATE_LATEST_INVALID" || error.code === "PROJECT_BRANCH_UPSTREAM_MISSING") throw error;
    throw projectUpdateError(
      "PROJECT_BRANCH_UPDATE_INSPECTION_FAILED",
      `Cannot inspect latest-branch state for project ${project.name}: ${error.message}`,
      project,
      {
        actualBranch: error.details?.actualBranch || null,
        cause: error.code || error.name,
        remediation: "Inspect the selected Git worktree and retry the command.",
      }
    );
  }
}

function sameUpdatePlan(expected, observed) {
  return expected.registeredBranch === observed.registeredBranch
    && expected.actualBranch === observed.actualBranch
    && expected.worktreeClean === observed.worktreeClean
    && expected.head === observed.head
    && expected.upstream?.name === observed.upstream?.name;
}

function staleUpdatePlanError(project, expected, observed) {
  return projectUpdateError(
    "PROJECT_BRANCH_UPDATE_PLAN_STALE",
    `Project ${project.name} changed while preparing its latest-branch update.`,
    project,
    {
      expectedState: expected,
      observedState: observed,
      remediation: "Reinspect the selected project and retry the latest-branch update.",
    }
  );
}

function assertUpdatePreconditions(project, state) {
  if (!state.matches) {
    throw projectUpdateError(
      "PROJECT_BRANCH_MISMATCH",
      `Project ${project.name} registered branch ${state.registeredBranch} does not match actual branch ${state.actualBranch}.`,
      project,
      {
        actualBranch: state.actualBranch,
        remediation: "Resolve the branch mismatch first, then retry the latest-branch update.",
      }
    );
  }
  if (!state.worktreeClean) {
    throw projectUpdateError(
      "PROJECT_WORKTREE_DIRTY",
      `Project ${project.name} has uncommitted changes; its latest branch cannot be updated automatically.`,
      project,
      {
        actualBranch: state.actualBranch,
        remediation: "Commit, discard, or otherwise resolve the selected worktree changes manually, then retry.",
      }
    );
  }
  if (!state.upstream) {
    throw projectUpdateError(
      "PROJECT_BRANCH_UPSTREAM_MISSING",
      `Project branch ${state.actualBranch} has no configured upstream.`,
      project,
      {
        actualBranch: state.actualBranch,
        remediation: "Configure an upstream branch manually, then retry.",
      }
    );
  }
}

function planLatestBranchUpdate(config, name, options = {}) {
  const project = (options.findRegisteredProject || findRegisteredProject)(config, name);
  const enabled = updateProjectPolicy(project);
  if (!enabled) {
    return {
      action: "skip",
      reason: "disabled",
      project: { name: project.name, location: project.location },
      updateLatest: false,
      registeredBranch: project.branch,
    };
  }
  const state = (options.inspectLatestBranchState || inspectLatestBranchState)(project, options);
  assertUpdatePreconditions(project, state);
  const targetHead = state.upstream
    ? (options.gitHead || gitHead)(project.location, state.upstream.name, options)
    : null;
  return {
    action: "update",
    reason: null,
    project: state.project,
    updateLatest: true,
    registeredBranch: state.registeredBranch,
    actualBranch: state.actualBranch,
    worktreeClean: state.worktreeClean,
    beforeHead: state.head,
    targetHead,
    upstream: state.upstream.name,
    upstreamRemote: state.upstream.remote,
    upstreamMerge: state.upstream.merge,
  };
}

function fetchUpstream(location, upstream, options = {}) {
  try {
    (options.runGit || runGit)(location, ["fetch", "--no-tags", upstream.remote, upstream.merge], options);
  } catch (error) {
    throw new WorkspaceError(
      "PROJECT_BRANCH_FETCH_FAILED",
      `Could not fetch upstream ${upstream.name}: ${error.message}`,
      {
        location,
        upstream: upstream.name,
        remote: upstream.remote,
        merge: upstream.merge,
        cause: error.code || error.name,
        remediation: "Check network access and Git credentials, then retry.",
      }
    );
  }
}

function assertFastForward(location, beforeHead, targetHead, project, options = {}) {
  const result = (options.executeGit || executeGit)(location, ["merge-base", "--is-ancestor", beforeHead, targetHead], options);
  if (result.status === 0) return;
  if (result.status === 1) {
    throw projectUpdateError(
      "PROJECT_BRANCH_NOT_FAST_FORWARD",
      `Project ${project.name} cannot fast-forward from ${beforeHead.slice(0, 12)} to ${targetHead.slice(0, 12)}.`,
      project,
      {
        actualBranch: project.branch,
        beforeHead,
        targetHead,
        remediation: "Resolve the local/remote divergence manually, then retry.",
      }
    );
  }
  const detail = String(result.stderr || result.stdout || "").trim();
  throw new WorkspaceError("GIT_COMMAND_FAILED", detail || "git merge-base failed", {
    location,
    args: ["merge-base", "--is-ancestor", beforeHead, targetHead],
    exitCode: result.status,
  });
}

function applyLatestBranchUpdate(root, plan, options = {}) {
  const project = {
    name: plan.project.name,
    location: plan.project.location,
    branch: plan.registeredBranch,
    updateLatest: plan.updateLatest,
  };
  if (plan.action === "skip" && plan.reason === "disabled") return plan;

  const load = options.loadConfigProjection || loadConfigProjection;
  const currentConfig = load(root, ["projects"]);
  let currentProject;
  try {
    currentProject = (options.findRegisteredProject || findRegisteredProject)(currentConfig, project.name);
  } catch (error) {
    if (error.code === "PROJECT_NOT_FOUND") throw staleUpdatePlanError(project, plan, { configChanged: true, cause: error.code });
    throw error;
  }
  if (
    updateProjectPolicy(currentProject) !== true
    || currentProject.branch !== plan.registeredBranch
    || typeof currentProject.location !== "string"
    || canonicalLocation(currentProject.location) !== canonicalLocation(plan.project.location)
  ) {
    throw staleUpdatePlanError(project, plan, { configChanged: true });
  }

  const observe = () => (options.inspectLatestBranchState || inspectLatestBranchState)(project, options);
  const before = observe();
  assertUpdatePreconditions(project, before);
  if (before.head !== plan.beforeHead || before.upstream?.name !== plan.upstream) {
    throw staleUpdatePlanError(project, plan, before);
  }
  fetchUpstream(project.location, before.upstream, options);
  const afterFetch = observe();
  const targetHead = (options.gitHead || gitHead)(project.location, before.upstream.name, options);
  if (!sameUpdatePlan(before, afterFetch)) throw staleUpdatePlanError(project, before, afterFetch);
  assertFastForward(project.location, before.head, targetHead, project, options);
  if (targetHead === before.head) {
    return {
      ...plan,
      action: "skip",
      reason: "already-latest",
      targetHead,
      afterHead: before.head,
      fetched: true,
      fastForwarded: false,
    };
  }

  let mergeAttempted = false;
  try {
    options.injectFailure?.("before-merge", { before, targetHead });
    mergeAttempted = true;
    (options.runGit || runGit)(project.location, ["merge", "--ff-only", targetHead], options);
    options.injectFailure?.("after-merge", { before, targetHead });
    const after = observe();
    if (after.actualBranch !== project.branch || !after.worktreeClean || after.head !== targetHead) {
      throw projectUpdateError(
        "PROJECT_BRANCH_UPDATE_VERIFY_FAILED",
        `Project ${project.name} did not reach the fetched upstream HEAD in a clean state.`,
        project,
        {
          actualBranch: after.actualBranch,
          beforeHead: before.head,
          targetHead,
          afterHead: after.head,
          observedState: after,
          remediation: "Inspect the current project HEAD and restore the intended state manually before retrying.",
        }
      );
    }
    options.injectFailure?.("after-verify", after);
    return {
      ...plan,
      action: "update",
      targetHead,
      afterHead: after.head,
      fetched: true,
      fastForwarded: true,
      worktreeClean: after.worktreeClean,
    };
  } catch (error) {
    const after = (() => {
      try { return observe(); } catch { return null; }
    })();
    const changed = mergeAttempted && after && after.head !== before.head;
    const failure = error.code === "PROJECT_BRANCH_UPDATE_VERIFY_FAILED"
      ? error
      : projectUpdateError(
        "PROJECT_BRANCH_UPDATE_FAILED",
        `Could not fast-forward project ${project.name}: ${error.message}`,
        project,
        {
          beforeHead: before.head,
          targetHead,
          afterHead: after?.head || null,
          actualBranch: after?.actualBranch || before.actualBranch,
          cause: error.code || error.name,
          remediation: "Inspect the selected worktree and resolve the Git error manually before retrying.",
        }
      );
    if (changed) {
      throw attachRetainedEffects(failure, [{
        kind: "git-fast-forward",
        status: "possibly-applied",
        retained: true,
        project: project.name,
        location: project.location,
        beforeHead: before.head,
        targetHead,
        observedState: after,
        remediation: failure.details.remediation,
      }]);
    }
    throw failure;
  }
}

module.exports = {
  DEFAULT_GIT_TIMEOUT,
  applyLatestBranchUpdate,
  assertFastForward,
  assertUpdatePreconditions,
  fetchUpstream,
  gitHead,
  gitUpstream,
  inspectLatestBranchState,
  planLatestBranchUpdate,
  runGit,
  updateProjectPolicy,
};
