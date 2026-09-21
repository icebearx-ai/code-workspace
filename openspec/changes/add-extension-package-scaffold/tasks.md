## 1. Core package-root validation

- [x] 1.1 Add package-root inspection that reads and validates `package.json` plus `extension/` without mutating source files.
- [x] 1.2 Add a source-envelope tarball writer that preserves validated `package.json` bytes and archives only `package/extension/**`.
- [x] 1.3 Preserve the existing legacy directory pack path for internal system-extension packaging.

## 2. Scaffold and digest services

- [x] 2.1 Implement package scaffold generation with manifest, init entry, envelope, README, deterministic defaults, and atomic commit.
- [x] 2.2 Implement digest synchronization in the required entry-first then package-digest order with atomic persistence.
- [x] 2.3 Add stable errors for target conflicts, invalid metadata, stale digests, and failed cleanup.

## 3. CLI integration

- [x] 3.1 Register `extension init` and `extension digest update` contracts and help summaries.
- [x] 3.2 Dispatch both commands through focused CLI handlers using shared confirmation and result helpers.
- [x] 3.3 Switch public `extension pack` to package-root validation while retaining internal legacy callers.
- [x] 3.4 Update completion and extension-development documentation with the new layout and commands.

## 4. Verification

- [x] 4.1 Add parser and architecture-contract tests for new commands and option/error behavior.
- [x] 4.2 Add scaffold, digest idempotency, atomic failure, and non-empty-target tests.
- [x] 4.3 Add package-root pack tests for exact tarball contents, source immutability, stale identity, and stale digest failures.
- [x] 4.4 Run CLI architecture checks, the complete test suite, and package checks; fix all regressions.
