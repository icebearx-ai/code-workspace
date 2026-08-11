## Context

OpenSpec Workspace intentionally leaves proposal/spec/design/tasks/apply/archive lifecycle ownership with OpenSpec. Its versioned patches should therefore add only multi-project selection, validation, context, and edit-boundary guards. The current 1.5.0 patch instead embeds branch mutation and registry persistence in six generated entry points, performs workspace-wide runtime validation for project-scoped work, and uses `project verify` as a spec-sync postcondition even though that command does not inspect specs.

The repository now has stronger primitives that the original patch did not have: targeted `project verify <name>`, `project sync-branch`, a shared branch-recovery Skill, standard JSON envelopes, and file transactions.

## Goals / Non-Goals

**Goals:**

- Make patched OpenSpec workflows thin consumers of Workspace CLI and shared Skills.
- Prevent unrelated project runtime drift from blocking a selected change.
- Provide a targeted, truthful archive sync postcondition.
- Reject ambiguous standalone-store use of `workspace-workflow`.
- Make patch safety rules deterministic and testable across Claude commands, Claude Skills, and Codex Skills.

**Non-Goals:**

- Add support for binding standalone OpenSpec stores to Workspace registries.
- Change OpenSpec's artifact lifecycle or archive mechanics.
- Add automatic branch creation, stashing, fetching, pulling, or destructive Git recovery.
- Replace Markdown artifacts with a new structured artifact format in this change.

## Decisions

### Keep the patch as a thin adapter

Patched workflows may call Workspace read-only commands, consume structured results, enforce project-owned edit roots, and delegate mismatch recovery. They must not serialize Workspace configuration or implement branch recovery inline.

Alternative considered: remove all native patches and rely only on root instructions. This would reduce maintenance but would lose workflow-specific apply/archive postconditions and ownership guidance.

### Delegate branch mismatch recovery

All patched entry points will direct the agent to `openspec-workspace-resolve-branch` when targeted verification returns `PROJECT_BRANCH_MISMATCH`. That Skill remains the only interactive recovery policy and uses `project sync-branch` for registry persistence.

### Scope change validation to participating projects

`change validate` will parse proposal and task ownership first, then retain project diagnostics only when they are global structural errors or involve an affected/task project. This preserves relevant name/prefix/path conflicts while ignoring unrelated branch drift. Full `validate` remains workspace-wide.

### Add an explicit archive-sync postcondition

`change validate` gains a boolean `--require-main-specs` option. When set, every delta spec ID for the change must exist under the main specs directory and still resolve to exactly one configured prefix. Archive workflows run this after successful spec sync.

Command contract:

```yaml
command: change validate
workspace: required
config: [projects]
interaction: never
effects: read-only
arguments:
  - name: name
    required: false
options:
  change: string
  require-main-specs: boolean
writes: []
verification:
  - proposal, task groups, delta specs, and affected project ownership agree
  - when requested, every delta spec has a main-spec output with one configured owner
rollback: N/A
```

### Make workspace workflow repo-local

When an OpenSpec action reports `schemaName: workspace-workflow`, the patched workflow must require a repo-local planning home and require Workspace `data.workspaceRoot` to equal `planningHome.root`. Standalone stores retain upstream behavior but cannot use Workspace orchestration until an explicit binding model exists.

### Keep protocol tokens stable across languages

`Affected Projects`, `Capabilities`, `New Capabilities`, `Modified Capabilities`, `Project`, `Capability`, and `Cross-project` are parser protocol tokens. Instructions will say that they must not be translated, while descriptions and prose remain localizable.

### Test compiled behavior, not only patch applicability

Managed-file tests will assert the absence of direct config edits and inline branch switches, the presence of shared-Skill delegation and targeted verification, scoped apply context, repo-local scope checks, and the correct archive postcondition in every compiled client entry point.

## Risks / Trade-offs

- **Existing standalone stores using `workspace-workflow` will stop instead of guessing a Workspace registry.** This is intentional fail-closed behavior until store binding is designed.
- **Targeted change validation still inspects the configured project set before filtering diagnostics.** This preserves conflict detection with minimal core churn; it removes unrelated failures from the result but does not optimize inspection cost.
- **The patch remains duplicated across OpenSpec-generated client surfaces.** Deterministic semantic assertions limit drift, while a future OpenSpec extension hook could eliminate the duplication.
- **Protocol-token instructions still rely on model compliance.** Deterministic validation detects violations; a future structured metadata format would be stronger.

