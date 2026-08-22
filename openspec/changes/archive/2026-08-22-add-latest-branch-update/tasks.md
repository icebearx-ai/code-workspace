## 1. Configuration and core contracts

- [x] 1.1 Validate optional `projects[].updateLatest` as a boolean while preserving missing-field compatibility and rejecting invalid values with a stable diagnostic.
- [x] 1.2 Add core project-branch update planning and Git observation APIs for upstream resolution, clean-worktree checks, HEAD snapshots, and fast-forward eligibility.

## 2. Git update implementation

- [x] 2.1 Implement fetch of the configured upstream and resolve the target HEAD without guessing a remote or changing upstream configuration.
- [x] 2.2 Implement fast-forward-only application with stale-state checks before the external effect and complete postcondition verification after it.
- [x] 2.3 Report stable errors for disabled projects, branch mismatch, dirty worktrees, missing upstream, fetch failure, non-fast-forward state, stale plans, and retained verification effects; never run reset/stash/rebase compensation.

## 3. CLI command

- [x] 3.1 Register and route `project branch update-latest <name...>` with `projects`-only loading, `interaction: never`, and `effects: external`.
- [x] 3.2 Implement single-project result contracts for disabled, already-latest, successful fast-forward, and failure outcomes.
- [x] 3.3 Implement ordered best-effort multi-project processing, duplicate warnings, structured diagnostics, and selection summaries.

## 4. Workspace Agent integration

- [x] 4.1 Update Workspace Guard templates and flow documentation to run `project branch update-latest` after branch reconciliation and before project work, including the already-matching branch path.
- [x] 4.2 Keep `code-workspace-resolve-branch` Skill unchanged; document the latest-version handoff in Workspace Guard instead of modifying the Skill.
- [x] 4.3 Correct configuration governance wording: users may manually edit `config.yaml`, while AI/Agent must not directly edit it; document `updateLatest` as a user-managed policy.

## 5. Tests and verification

- [x] 5.1 Add configuration and core unit tests for missing/boolean/invalid `updateLatest` values and Git observation/planning behavior.
- [x] 5.2 Add local-remote integration tests for disabled, already-latest, fast-forward, dirty, missing-upstream, fetch-failure, diverged, stale-plan, and postcondition-failure cases.
- [x] 5.3 Add CLI parser, JSON/text, batch, architecture-isolation, and Guard asset tests; verify the resolve-branch Skill, project add/update, and branch configure contracts remain unchanged.
- [x] 5.4 Run `node scripts/check-cli-architecture.js`, `npm test`, and `npm run check`; resolve all failures before marking the change complete.
