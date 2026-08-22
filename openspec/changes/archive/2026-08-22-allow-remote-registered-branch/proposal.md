## Why

`project branch use-registered` currently rejects a registered branch that is not a local branch, even when a matching remote-tracking branch exists or can be fetched. This creates unnecessary manual Git work during branch reconciliation. The command should preserve its safe default while offering explicit remote acquisition for users who choose it.

## What Changes

- Keep the current local-only behavior as the default.
- Add `--allow-remote` to create a local tracking branch from a unique existing remote-tracking branch without fetching.
- Add `--remote <name>` to fetch the exact registered branch from an explicitly selected remote, create a local tracking branch, and switch to it.
- Show the complete external effect in the confirmation prompt before any fetch or branch creation.
- Return structured acquisition details and stable diagnostics for remote ambiguity, missing remotes, fetch failures, and retained created branches.
- Update the branch reconciliation Skill, documentation, specs, and tests.

## Capabilities

### New Capabilities

- None.

### Modified Capabilities

- `project-branch-reconciliation`: allow explicitly authorized remote-tracking branch creation and remote fetch during `use-registered` while retaining local-only default semantics.

## Impact

- CLI registry and branch command option validation.
- Core Git branch inspection, fetch, tracking-branch creation, verification, and retained-effect reporting.
- Branch reconciliation Skill prompts and invocation examples.
- README, flow documentation, OpenSpec delta specs, and CLI/core test suites.
