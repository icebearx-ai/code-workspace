## 1. Core configuration source

- [x] 1.1 Add the fixed `config-projects.yaml` path, reference normalization, project-file parsing, rendering, and stable diagnostics.
- [x] 1.2 Make complete and projected configuration loads resolve the external project file and reject inline project arrays.
- [x] 1.3 Update saves and targeted branch mutation to write the project file while preserving main workspace settings.

## 2. Initialization and transaction integration

- [x] 2.1 Initialize an empty `config-projects.yaml` and include it in initialization snapshots and verification.
- [x] 2.2 Include the project file in project configuration, branch, update, and rollback transaction targets.
- [x] 2.3 Preserve permission planning and postcondition checks against resolved projects.

## 3. Validation, doctor, and documentation

- [x] 3.1 Adapt project validation and Doctor diagnostics to external project-file failures.
- [x] 3.2 Update README.md and README.zh-CN.md with the mandatory split format and examples.
- [x] 3.3 Update relevant architecture/flow documentation and generated test expectations.

## 4. Tests and verification

- [x] 4.1 Add configuration reference, missing/invalid file, and inline-format rejection tests.
- [x] 4.2 Update project, branch, init, update, permission, and rollback tests for the external file.
- [x] 4.3 Run architecture guard, targeted tests, full test suite, packaging check, and `git diff --check`.
