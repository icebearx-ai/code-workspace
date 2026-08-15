---
name: code-workspace-resolve-branch
description: Resolve a selected Code Workspace project's `PROJECT_BRANCH_MISMATCH` before project work. Use this Skill whenever targeted verification reports a registered/actual branch mismatch; it gathers canonical facts, asks for one explicit direction, delegates both automatic directions to the CLI, and re-verifies only that project.
---

# Resolve a Workspace Project Branch

Resolve only the already selected registered project. Keep project work paused until targeted verification succeeds.

## Inspect canonical facts

Run from the Workspace:

```bash
code-w project branch inspect "<project.name>" --json
```

Require a successful standard envelope whose `data` contains all of: `project.name`, `project.location`, `registeredBranch`, `actualBranch`, `matches`, `worktreeClean`, and `registeredBranchExists`. If the command fails or a fact is missing, report its diagnostics and stop; do not infer or independently inspect missing values.

If `matches` is already true, skip the choice and proceed to targeted re-verification.

## Ask for exactly one direction

Use the following template exactly. Replace only the `{placeholders}` with inspected values. Set choice 1 availability to `available` only when `worktreeClean` and `registeredBranchExists` are both true; otherwise use `unavailable: dirty worktree` or `unavailable: registered branch is not available locally` as determined by the returned facts. Do not recommend a default direction.

```text
Project branch mismatch detected. Project work is paused.

Project: {projectName}
Location: {projectLocation}
Registered branch (Code Workspace expected state): {registeredBranch}
Actual branch (Git checked-out state): {actualBranch}
Worktree: {clean|dirty}
Registered branch available locally: {yes|no}

Choose exactly one:
1. Use the registered branch.
   Effect: switch the project from {actualBranch} to {registeredBranch};
   the Code Workspace registry does not change.
   Availability: {available|unavailable: reason}
2. Accept the actual branch.
   Effect: update the registered branch from {registeredBranch} to
   {actualBranch}; the project worktree does not change.
3. Resolve manually.
   Effect: project work remains paused until you finish and confirm.

Reply with 1, 2, or 3. No Git or Workspace state will change before your choice.
```

Do not mutate any state before the user explicitly replies with one choice.

## Apply the chosen direction through the CLI

- For choice 1, proceed only when it is available, then run `code-w project branch use-registered "<project.name>" --yes --json`.
- For choice 2, run `code-w project branch accept-actual "<project.name>" --yes --json`.
- For choice 3, remain paused until the user confirms manual resolution is complete. Do not reuse any pre-resolution branch facts.

If an automatic CLI command fails, report its structured diagnostics and stop. Do not fall back to direct Git commands, direct Workspace configuration editing, or an improvised recovery direction.

## Reverify only the selected project

After an automatic command succeeds, or after the user confirms manual resolution, discard cached branch-dependent context and run only:

```bash
code-w project verify "<project.name>" --json
```

Resume selected-project work only when this targeted result has `ok: true`. Otherwise report the diagnostics and keep the project paused. Do not run `project list`, workspace-wide `project verify`, or inspect any other registered project.
