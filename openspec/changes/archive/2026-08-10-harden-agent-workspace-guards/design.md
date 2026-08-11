## Context

OpenSpec Workspace installs client-specific root instructions as managed files. Claude receives `CLAUDE.md`, but Codex currently receives the non-default filename `AGENT.md`; both files duplicate a 136-line policy. The policy embeds branch recovery inline and runs workspace-wide project verification during project selection. The existing managed-file state and obsolete-asset cleanup already provide the primitives needed for a safe filename migration, while project validation currently exposes only an all-project operation.

The implementation must preserve user-owned files, the stable CLI result/error model, selected-tool behavior, transaction rollback, and configuration-domain isolation. It must not add a standalone Agent contract-checking subsystem or any `PreToolUse` hook enforcement.

## Goals / Non-Goals

**Goals:**

- Install discoverable `AGENTS.md` and `CLAUDE.md` root instructions from one canonical source.
- Migrate unchanged managed `AGENT.md` safely and refuse to overwrite modified or unknown files.
- Reduce the root instruction to the frequently used workspace-selection and write-boundary policy.
- Provide branch mismatch recovery through one shared Skill installed for both clients.
- Support read-only `project verify [name]` without allowing unrelated branch drift to block the selected project.
- Preserve workspace-wide verification and the existing JSON envelope when no name is supplied.

**Non-Goals:**

- A standalone Agent entry contract script, real-client loading test suite, or release smoke-test harness.
- Cross-client `PreToolUse` hooks or OS-level write enforcement.
- Changing project registration, branch synchronization semantics, or workspace write authority.

## Decisions

### Use one canonical root template with manifest-owned static values

Create `artifacts/templates/agents/WORKSPACE_GUARD.md.template` and point both managed-file definitions at it. Each manifest entry supplies a static `ADD_PROJECTS_INVOCATION` render value. `renderManagedContent` combines invocation-time variables with entry render values; manifest-owned values take precedence so callers cannot accidentally render a Claude command into the Codex file. Render validation rejects non-string values and unresolved tokens.

This keeps client differences declarative and avoids maintaining two almost-identical source files. Keeping separate source templates was rejected because the existing parity test detects drift only after duplication has already occurred.

### Reuse obsolete managed-file cleanup for the filename migration

Change the Codex target to `AGENTS.md` and declare root `AGENT.md` obsolete. During update, an old file is removed only when state proves it is the unchanged managed version. A modified old file produces the existing obsolete-managed-file conflict unless force is explicitly authorized, and an unknown `AGENTS.md` is never overwritten implicitly. The existing update transaction remains responsible for restoring old target, new target, and state on failure.

Adding fallback discovery configuration was rejected because it would perpetuate a nonstandard filename and would not repair already generated workspaces.

### Keep root instructions operational and move recovery detail to a shared Skill

The canonical root file retains workspace identity, project discovery and selection, targeted verification, OpenSpec ownership, and the root write boundary. It tells the agent to invoke the installed `openspec-workspace-resolve-branch` Skill when `PROJECT_BRANCH_MISMATCH` occurs. The Skill owns dirty-worktree checks, the three recovery choices, explicit authorization, `project sync-branch`, re-verification, and stale-context invalidation.

The same Skill source is installed below both `.codex/skills/` and `.claude/skills/`. Duplicating the recovery procedure in root files was rejected because it consumes high-priority context on every turn.

### Add an optional positional name to the existing read-only command

The affected CLI contract is:

```yaml
command: project verify [name]
workspace: required
config: [projects]
interaction: never
effects: read-only
arguments:
  - name: name
    required: false
options: {}
writes: []
verification:
  - validate every project when name is absent
  - validate the selected project and configuration conflicts involving it when name is present
rollback: not applicable
```

The registry declares the optional argument and the handler consumes the parsed argument. The core exposes targeted validation built from shared project-inspection and conflict primitives. A named request fails with the existing project-not-found error. It checks the selected project's path, repository, and branch, plus duplicate/nested configuration conflicts involving that project, while ignoring runtime mismatches belonging only to unrelated projects.

The success data remains additive: `projects` is always present for compatibility, with `scope` and `project` identifying whether verification was workspace-wide or targeted. Introducing a separate command was rejected because this is a scope refinement of the same read-only operation.

### Use focused regression tests only

Tests cover managed migration/conflict behavior, canonical rendering, selected-tool Skill installation, parser behavior, targeted validation, JSON/text results, stable errors, and unrelated-domain isolation. They do not introduce a separate contract-test executable or real-client invocation suite.

## Risks / Trade-offs

- [Modified legacy `AGENT.md` remains beside the new target] → Fail with the existing conflict by default and require an explicit force decision instead of risking data loss.
- [A shorter root policy omits useful recovery detail] → Keep the full deterministic procedure in the installed shared Skill and retain an explicit mismatch trigger in the root file.
- [Targeted validation could miss global conflicts] → Reuse shared conflict detection and retain every diagnostic whose participants include the selected project.
- [Additive JSON fields affect strict consumers] → Preserve the envelope and `data.projects`; only add fields inside `data`.
- [Manifest rendering becomes more flexible] → Restrict static values to strings, define precedence, include the entry definition in the existing manifest fingerprint, and reject unresolved tokens.

## Migration Plan

1. Ship the canonical template, new Skill, manifest target/value changes, obsolete asset declaration, and renderer support in one release.
2. On `update`, remove an unchanged state-owned `AGENT.md`, install `AGENTS.md`, install the selected clients' recovery Skills, and commit state only after existing managed-file postconditions pass.
3. If any apply stage fails, use the existing update transaction to restore managed files and state.
4. Rollback is the prior package release; modified/unknown user files remain untouched throughout.

## Open Questions

None.
