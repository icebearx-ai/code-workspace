## 1. CLI contract and planning

- [x] 1.1 Register `--allow-remote` and `--remote <name>` for `project branch use-registered`; validate conflicts and preserve default behavior.
- [x] 1.2 Extend branch planning and confirmation text with acquisition mode, remote, and target head.

## 2. Core Git operations

- [x] 2.1 Inspect unique remote-tracking candidates without network access.
- [x] 2.2 Implement exact branch fetch, remote validation, tracking-branch creation, and stable errors in the core layer.
- [x] 2.3 Extend switch verification, compensation, and retained-effect reporting for created branches.

## 3. Skill and documentation

- [x] 3.1 Update branch reconciliation Skill to use `--allow-remote` when a unique remote-tracking branch is available and explain explicit fetch mode.
- [x] 3.2 Update README, flow documentation, and OpenSpec references with the new interaction and safety contract.

## 4. Tests and checks

- [x] 4.1 Add parser, option-conflict, local compatibility, remote-tracking, and explicit-fetch tests.
- [x] 4.2 Add failure, compensation, retained-effect, batch, text/JSON, and Skill/documentation contract tests.
- [x] 4.3 Run CLI architecture checks, unit tests, and packaging checks.
