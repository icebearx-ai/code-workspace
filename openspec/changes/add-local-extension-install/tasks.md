## 1. CLI contract

- [x] 1.1 Register `extension install --local <tarball>` with required Workspace, `--local`, `--yes`, and planned-write semantics.
- [x] 1.2 Route the local mode through the existing extension install handler and add text/JSON result contracts.

## 2. Local package import

- [x] 2.1 Add local tarball verification, safe extraction, integrity calculation, and temporary-directory cleanup.
- [x] 2.2 Extend Store provenance and import behavior for `source: local`, idempotent reuse, and digest conflicts.
- [x] 2.3 Reuse normal extension planning, confirmation, Workspace transaction, and rollback behavior.

## 3. Tests and documentation

- [x] 3.1 Add parser and CLI tests for valid paths, directories, missing files, unknown options, and JSON errors.
- [x] 3.2 Add Store and lifecycle tests for valid install, cancellation, idempotency, conflicts, and rollback.
- [x] 3.3 Update extension development documentation with the local tarball workflow.
- [x] 3.4 Run architecture, full test, OpenSpec, and package checks.
