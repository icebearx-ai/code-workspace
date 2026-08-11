## 1. Managed Agent Instructions

- [x] 1.1 Add manifest-owned static render values and validation to managed-file rendering.
- [x] 1.2 Replace duplicated Claude/Codex root sources with one concise canonical template that renders `CLAUDE.md` and `AGENTS.md`.
- [x] 1.3 Declare `AGENT.md` obsolete and verify safe update migration, conflicts, tool selection, and rollback behavior with focused regression tests.

## 2. Shared Branch Recovery

- [x] 2.1 Add the client-neutral `openspec-workspace-resolve-branch` Skill with safe inspection, explicit recovery choices, authorization, synchronization, and targeted re-verification.
- [x] 2.2 Install the shared Skill for selected Claude and Codex clients and update template/managed-file tests.

## 3. Targeted Project Verification

- [x] 3.1 Refactor project validation into shared inspection and relevant-conflict primitives while preserving workspace-wide behavior and stable diagnostics.
- [x] 3.2 Declare and implement the optional `project verify [name]` CLI contract with additive result data and project-not-found handling.
- [x] 3.3 Add parser, output, error, configuration-isolation, selected-project conflict, and unrelated-project runtime regression tests.

## 4. Documentation and Verification

- [x] 4.1 Update user-facing command and generated-asset documentation for `AGENTS.md`, the recovery Skill, and targeted verification.
- [x] 4.2 Run OpenSpec validation, CLI architecture checks, the test suite, and the complete project check; resolve all in-scope failures.
