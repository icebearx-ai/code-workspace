const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const {
  assertRegisteredBranchSwitchAvailable,
  planRegisteredBranchAcquisition,
  inspectProjectBranch,
  inspectProjectBranchMatch,
  switchProjectToRegisteredBranch,
} = require("../core/project");

const project = {
  name: "service",
  location: "/workspace/service",
  branch: "main",
  type: "backend",
  context: "service",
};

function state(overrides = {}) {
  return {
    project: { name: "service", location: "/workspace/service" },
    registeredBranch: "main",
    actualBranch: "feature/work",
    matches: false,
    worktreeClean: true,
    registeredBranchExists: true,
    ...overrides,
  };
}

function observations(...values) {
  let index = 0;
  return () => {
    const value = values[Math.min(index, values.length - 1)];
    index += 1;
    return structuredClone(value);
  };
}

test("branch inspection maps registry and Git facts to the canonical state", () => {
  const inspected = inspectProjectBranch({ projects: [project] }, "service", {
    inspectGitWorktree: () => ({ realPath: "/workspace/service", branch: "feature/work" }),
    gitWorktreeClean: () => false,
    gitLocalBranchExists: (location, branch) => {
      assert.equal(location, project.location);
      assert.equal(branch, "main");
      return false;
    },
  });
  assert.deepEqual(inspected, state({ worktreeClean: false, registeredBranchExists: false }));

  assert.throws(
    () => inspectProjectBranch({ projects: [project] }, "missing"),
    (error) => error.code === "PROJECT_NOT_FOUND" && error.details.project === "missing"
  );
  assert.throws(
    () => inspectProjectBranch({ projects: [project] }, "service", {
      inspectGitWorktree: () => { throw Object.assign(new Error("injected Git failure"), { code: "GIT_COMMAND_FAILED" }); },
    }),
    (error) => error.code === "PROJECT_BRANCH_INSPECTION_FAILED"
      && error.details.project === "service"
      && error.details.location === project.location
      && error.details.cause === "GIT_COMMAND_FAILED"
      && /retry/.test(error.details.remediation)
  );
});

test("branch-match inspection observes only registered and actual branches", () => {
  let cleanChecked = false;
  let localBranchChecked = false;
  const inspected = inspectProjectBranchMatch({ projects: [project] }, "service", {
    inspectGitWorktree: () => ({ realPath: "/workspace/service-real", branch: "main" }),
    gitWorktreeClean: () => {
      cleanChecked = true;
      throw new Error("must not be called");
    },
    gitLocalBranchExists: () => {
      localBranchChecked = true;
      throw new Error("must not be called");
    },
  });
  assert.deepEqual(inspected, {
    project: { name: "service", location: "/workspace/service-real" },
    registeredBranch: "main",
    actualBranch: "main",
    matches: true,
  });
  assert.equal(cleanChecked, false);
  assert.equal(localBranchChecked, false);
});

test("registered-branch switching rejects dirty worktrees and missing local branches", () => {
  assert.throws(
    () => assertRegisteredBranchSwitchAvailable(state({ worktreeClean: false })),
    (error) => error.code === "PROJECT_WORKTREE_DIRTY"
      && error.details.registeredBranch === "main"
      && error.details.actualBranch === "feature/work"
      && /manually/.test(error.details.remediation)
  );
  assert.throws(
    () => assertRegisteredBranchSwitchAvailable(state({ registeredBranchExists: false })),
    (error) => error.code === "PROJECT_REGISTERED_BRANCH_MISSING"
      && error.details.registeredBranch === "main"
      && error.details.actualBranch === "feature/work"
      && /will not create or download/.test(error.details.remediation)
  );
});

test("remote acquisition requires explicit mode and rejects ambiguous candidates", () => {
  const missing = state({ registeredBranchExists: false, remoteBranchCandidates: [] });
  assert.throws(() => planRegisteredBranchAcquisition(missing), (error) => error.code === "PROJECT_REGISTERED_BRANCH_MISSING");
  assert.deepEqual(planRegisteredBranchAcquisition(missing, {
    allowRemote: true,
    gitRemoteTrackingBranches: () => [{ remote: "origin", remoteBranch: "origin/main" }],
    gitRemoteBranchHead: () => "head",
  }), {
    mode: "remote-tracking",
    remote: "origin",
    remoteBranch: "origin/main",
    targetHead: "head",
    localBranchCreated: true,
  });
  assert.throws(() => planRegisteredBranchAcquisition({
    ...missing,
    remoteBranchCandidates: [
      { remote: "origin", remoteBranch: "origin/main" },
      { remote: "upstream", remoteBranch: "upstream/main" },
    ],
  }, { allowRemote: true }), (error) => error.code === "PROJECT_BRANCH_REMOTE_AMBIGUOUS");
  assert.throws(() => planRegisteredBranchAcquisition(missing, { allowRemote: true, remote: "origin" }), (error) => error.code === "CLI_OPTION_CONFLICT");
});

test("remote-tracking acquisition creates a local branch and reports its source", () => {
  const calls = [];
  const result = switchProjectToRegisteredBranch(state({
    registeredBranchExists: false,
    remoteBranchCandidates: [{ remote: "origin", remoteBranch: "origin/main" }],
  }), {
    allowRemote: true,
    inspectProjectBranchState: observations(
      state({ registeredBranchExists: false, remoteBranchCandidates: [{ remote: "origin", remoteBranch: "origin/main" }] }),
      state({ registeredBranchExists: false, remoteBranchCandidates: [{ remote: "origin", remoteBranch: "origin/main" }] }),
      state({ actualBranch: "main", matches: true, registeredBranchExists: true }),
    ),
    createTrackingBranch: (location, branch, remoteBranch) => calls.push({ location, branch, remoteBranch }),
    gitRemoteBranchHead: () => "head",
  });
  assert.deepEqual(calls, [{ location: "/workspace/service", branch: "main", remoteBranch: "origin/main" }]);
  assert.deepEqual(result.acquisition, {
    mode: "remote-tracking",
    remote: "origin",
    remoteBranch: "origin/main",
    targetHead: "head",
    localBranchCreated: true,
  });
});

test("explicit remote acquisition fetches before creating the tracking branch", () => {
  const calls = [];
  const result = switchProjectToRegisteredBranch(state({ registeredBranchExists: false }), {
    remote: "origin",
    gitRemotes: () => ["origin"],
    inspectProjectBranchState: observations(
      state({ registeredBranchExists: false }),
      state({ registeredBranchExists: false }),
      state({ actualBranch: "main", matches: true, registeredBranchExists: true }),
    ),
    fetchRegisteredBranch: (location, remote, branch) => {
      calls.push(["fetch", location, remote, branch]);
      return { remote, remoteBranch: `${remote}/${branch}`, targetHead: "fetched-head" };
    },
    createTrackingBranch: (location, branch, remoteBranch) => calls.push(["create", location, branch, remoteBranch]),
  });
  assert.deepEqual(calls, [
    ["fetch", "/workspace/service", "origin", "main"],
    ["create", "/workspace/service", "main", "origin/main"],
  ]);
  assert.equal(result.acquisition.mode, "fetched");
  assert.equal(result.acquisition.targetHead, "fetched-head");
});

test("remote branch creation is reported as retained when post-switch verification fails", () => {
  const calls = [];
  assert.throws(() => switchProjectToRegisteredBranch(state({
    registeredBranchExists: false,
    remoteBranchCandidates: [{ remote: "origin", remoteBranch: "origin/main" }],
  }), {
    allowRemote: true,
    inspectProjectBranchState: observations(
      state({ registeredBranchExists: false, remoteBranchCandidates: [{ remote: "origin", remoteBranch: "origin/main" }] }),
      state({ registeredBranchExists: false, remoteBranchCandidates: [{ remote: "origin", remoteBranch: "origin/main" }] }),
      state({ actualBranch: "feature/work", matches: false, registeredBranchExists: false }),
    ),
    gitRemoteBranchHead: () => "head",
    createTrackingBranch: () => calls.push("create"),
    switchGitBranch: (location, branch) => calls.push(branch),
    injectFailure: (stage) => {
      if (stage === "after-switch") throw new Error("verification hook failed");
    },
  }), (error) => {
    assert.equal(error.code, "PROJECT_BRANCH_SWITCH_VERIFY_FAILED");
    assert.equal(error.details.compensation.succeeded, true);
    assert.equal(error.details.effects.retained[0].kind, "git-branch-created");
    return true;
  });
  assert.deepEqual(calls, ["create", "feature/work"]);
});

test("registered-branch switching compares the complete plan before applying Git", () => {
  let switched = false;
  assert.throws(() => switchProjectToRegisteredBranch(state(), {
    inspectProjectBranchState: () => state({ actualBranch: "feature/drift" }),
    switchGitBranch: () => { switched = true; },
  }), (error) => {
    assert.equal(error.code, "PROJECT_BRANCH_PLAN_STALE");
    assert.deepEqual(error.details.expectedState, { registeredBranch: "main", actualBranch: "feature/work" });
    assert.deepEqual(error.details.observedState, { registeredBranch: "main", actualBranch: "feature/drift" });
    return true;
  });
  assert.equal(switched, false);
});

test("registered-branch switching verifies a clean canonical after state", () => {
  const calls = [];
  const result = switchProjectToRegisteredBranch(state(), {
    inspectProjectBranchState: observations(
      state(),
      state({ actualBranch: "main", matches: true })
    ),
    switchGitBranch: (location, branch) => calls.push({ location, branch }),
  });
  assert.deepEqual(calls, [{ location: "/workspace/service", branch: "main" }]);
  assert.deepEqual(result.before, { registeredBranch: "main", actualBranch: "feature/work" });
  assert.deepEqual(result.after, { registeredBranch: "main", actualBranch: "main" });
  assert.equal(result.worktreeClean, true);
});

test("post-switch failures compensate to the original actual branch", () => {
  const calls = [];
  assert.throws(() => switchProjectToRegisteredBranch(state(), {
    inspectProjectBranchState: observations(
      state(),
      state({ actualBranch: "feature/work" })
    ),
    switchGitBranch: (location, branch) => calls.push({ location, branch }),
    injectFailure: (stage) => {
      if (stage === "after-switch") throw new Error("injected apply failure");
    },
  }), (error) => {
    assert.equal(error.code, "PROJECT_BRANCH_SWITCH_VERIFY_FAILED");
    assert.deepEqual(error.details.compensation, {
      attempted: true,
      succeeded: true,
      restoredState: { registeredBranch: "main", actualBranch: "feature/work" },
    });
    assert.equal(error.details.effects, undefined);
    return true;
  });
  assert.deepEqual(calls.map((entry) => entry.branch), ["main", "feature/work"]);
});

test("a failed Git switch attempt is compensated because an external effect may have occurred", () => {
  const calls = [];
  assert.throws(() => switchProjectToRegisteredBranch(state(), {
    inspectProjectBranchState: observations(
      state(),
      state({ actualBranch: "feature/work" })
    ),
    switchGitBranch: (location, branch) => {
      calls.push({ location, branch });
      if (branch === "main") throw Object.assign(new Error("hook failed after switch attempt"), { code: "GIT_COMMAND_FAILED" });
    },
  }), (error) => {
    assert.equal(error.code, "PROJECT_BRANCH_SWITCH_FAILED");
    assert.equal(error.details.compensation.succeeded, true);
    assert.deepEqual(error.details.compensation.restoredState, { registeredBranch: "main", actualBranch: "feature/work" });
    return true;
  });
  assert.deepEqual(calls.map((entry) => entry.branch), ["main", "feature/work"]);
});

test("branch switching exposes deterministic failure injection at apply, verify, and compensation stages", () => {
  const beforeCalls = [];
  assert.throws(() => switchProjectToRegisteredBranch(state(), {
    inspectProjectBranchState: observations(state()),
    switchGitBranch: (location, branch) => beforeCalls.push({ location, branch }),
    injectFailure: (stage) => {
      if (stage === "before-switch") throw new Error("injected before switch");
    },
  }), (error) => error.code === "PROJECT_BRANCH_SWITCH_FAILED");
  assert.deepEqual(beforeCalls, []);

  const verifyCalls = [];
  assert.throws(() => switchProjectToRegisteredBranch(state(), {
    inspectProjectBranchState: observations(
      state(),
      state({ actualBranch: "main", matches: true }),
      state({ actualBranch: "feature/work" })
    ),
    switchGitBranch: (location, branch) => verifyCalls.push({ location, branch }),
    injectFailure: (stage) => {
      if (stage === "after-verify") throw new Error("injected after verify");
    },
  }), (error) => error.code === "PROJECT_BRANCH_SWITCH_VERIFY_FAILED" && error.details.compensation.succeeded === true);
  assert.deepEqual(verifyCalls.map((entry) => entry.branch), ["main", "feature/work"]);

  assert.throws(() => switchProjectToRegisteredBranch(state(), {
    inspectProjectBranchState: observations(
      state(),
      state({ actualBranch: "main", matches: true })
    ),
    switchGitBranch: () => {},
    injectFailure: (stage) => {
      if (stage === "after-switch") throw new Error("trigger compensation");
      if (stage === "before-compensation") throw new Error("injected before compensation");
    },
  }), (error) => error.details.compensation.succeeded === false && error.details.effects.retained.length === 1);

  assert.throws(() => switchProjectToRegisteredBranch(state(), {
    inspectProjectBranchState: observations(
      state(),
      state({ actualBranch: "feature/work" }),
      state({ actualBranch: "feature/work" })
    ),
    switchGitBranch: () => {},
    injectFailure: (stage) => {
      if (stage === "after-switch") throw new Error("trigger compensation");
      if (stage === "after-compensation") throw new Error("injected after compensation");
    },
  }), (error) => error.details.compensation.succeeded === true && error.details.effects === undefined);
});

test("verification failure plus compensation failure reports a retained external effect", () => {
  const calls = [];
  assert.throws(() => switchProjectToRegisteredBranch(state(), {
    inspectProjectBranchState: observations(
      state(),
      state({ actualBranch: "main", matches: true, worktreeClean: false }),
      state({ actualBranch: "main", matches: true, worktreeClean: false })
    ),
    switchGitBranch: (location, branch) => {
      calls.push({ location, branch });
      if (branch === "feature/work") throw new Error("injected compensation failure");
    },
  }), (error) => {
    assert.equal(error.code, "PROJECT_BRANCH_SWITCH_VERIFY_FAILED");
    assert.equal(error.details.compensation.succeeded, false);
    assert.deepEqual(error.details.observedState, { registeredBranch: "main", actualBranch: "main" });
    assert.equal(error.details.effects.retained.length, 1);
    assert.equal(error.details.effects.retained[0].kind, "git-branch-switch");
    assert.equal(error.details.effects.retained[0].retained, true);
    assert.match(error.details.remediation, /Restore project service to branch feature\/work manually/);
    return true;
  });
  assert.deepEqual(calls.map((entry) => entry.branch), ["main", "feature/work"]);
});

test("branch switch implementation does not introduce hidden recovery Git operations", () => {
  const source = fs.readFileSync(path.resolve(__dirname, "..", "core", "project.js"), "utf8");
  for (const operation of ["fetch", "stash", "reset", "checkout"]) {
    assert.doesNotMatch(source, new RegExp(`runGit\\([^\\n]+[\"']${operation}[\"']`), operation);
  }
});
