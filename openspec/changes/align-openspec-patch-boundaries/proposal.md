## Why

The OpenSpec 1.5.0 workflow patches predate the current targeted-verification and shared branch-recovery design. They now duplicate unsafe recovery behavior, bypass the Workspace CLI for registry writes, use an incorrect archive postcondition, and can bind a standalone OpenSpec store to the wrong Workspace root.

## What Changes

- Reduce native OpenSpec workflow patches to a thin multi-project adapter.
- Delegate branch mismatch recovery to the shared `openspec-workspace-resolve-branch` Skill and prohibit direct workspace-state edits.
- Select and verify only relevant registered projects before project-specific work.
- Bind `workspace-workflow` actions to the current repo-local planning home and reject standalone-store ambiguity.
- Use change-scoped context during apply and a real spec-ownership postcondition after archive sync.
- Add deterministic checks that reject unsafe or contradictory patched instructions.
- Clarify which Markdown headings and labels are stable protocol tokens across workspace languages.

## Capabilities

### New Capabilities

- `openspec-patch-boundaries`: Defines the responsibility, safety, scope, and verification contract for versioned native OpenSpec workflow patches.

### Modified Capabilities

- `agent-workspace-instructions`: Align patched OpenSpec entry points with targeted project verification and the shared branch-recovery Skill.

## Impact

- `artifacts/patches/openspec/1.5.0/commands-skills.patch` and its twelve compiled outputs.
- `artifacts/patches/openspec/1.5.0/config-yaml.patch` and compiled config output.
- Workspace workflow schema instructions and managed-file semantic tests.
- Project/change validation behavior and adjacent CLI tests where targeted scope is required.
- README responsibility and workflow documentation.
