## 1. Change Validation Scope

- [x] 1.1 Add selected-project diagnostic aggregation for change validation so unrelated runtime drift does not block a change.
- [x] 1.2 Add `change validate --require-main-specs` with stable diagnostics for missing or ambiguously owned synchronized main specs.
- [x] 1.3 Add parser, JSON/text, isolation, and postcondition tests for the extended read-only command contract.

## 2. Native OpenSpec Patch Boundaries

- [x] 2.1 Replace inline branch recovery and direct registry edits with targeted verification and shared recovery-Skill delegation.
- [x] 2.2 Add repo-local planning-scope/root matching checks to workspace-workflow propose, apply, and archive behavior.
- [x] 2.3 Use change-scoped context and per-owner verification in apply.
- [x] 2.4 Use `change validate --require-main-specs` after archive spec sync.
- [x] 2.5 Mark parser-sensitive ownership headings and labels as non-translatable protocol tokens.

## 3. Managed Outputs and Documentation

- [x] 3.1 Regenerate all twelve compiled OpenSpec command/Skill outputs and both versioned patch files from the pinned 1.5.0 baseline.
- [x] 3.2 Update manifest source and desired-output checksums without weakening managed-file protections.
- [x] 3.3 Update README responsibility and workflow guidance to describe the thin-adapter boundary and repo-local store limitation.

## 4. Deterministic Verification

- [x] 4.1 Add semantic managed-output tests that reject direct Workspace config edits, inline branch switching, global preflight drift, unscoped apply context, and incorrect archive verification.
- [x] 4.2 Run OpenSpec validation, CLI architecture checks, patch consistency checks, the full test suite, and package dry-run checks.
