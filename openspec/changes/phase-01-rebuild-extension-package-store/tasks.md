## 1. Package Store foundation

- [x] 1.1 Define the user-level Store path adapter and immutable `<extension>/<version>` layout.
- [x] 1.2 Implement Store package records with manifest, entry and full package digests.
- [x] 1.3 Implement the built-in package provider that imports packages from the published `extensions/` directory.
- [x] 1.4 Add package validation, atomic temporary import and per-package locking.

## 2. Workspace activation model

- [x] 2.1 Extend installed state to record exact package version and package digest without copying package sources.
- [x] 2.2 Resolve init execution from Store packages while preserving staging and output verification.
- [x] 2.3 Keep Workspace artifact, Hook, contribution and activation writes in one Workspace transaction.
- [x] 2.4 Decrease Store references after activation uninstall and expose a verifiable reference query.

## 3. Garbage collection and compatibility

- [x] 3.1 Track Workspace activation, in-flight transaction, explicit pin and runtime-reference metadata.
- [x] 3.2 Implement safe package GC that never removes referenced or locked packages.
- [x] 3.3 Preserve legacy installed protocol records and implement migration dry-run diagnostics.
- [x] 3.4 Add rollback handling for Store import success followed by Workspace activation failure.

## 4. Tests and regression

- [x] 4.1 Test same-version sharing, multi-version coexistence and concurrent import.
- [x] 4.2 Test Workspace install, upgrade, uninstall and package-missing behavior.
- [x] 4.3 Test GC with active Workspace, running-reference placeholder and failed cleanup.
- [x] 4.4 Run existing extension, init, artifact, Hook and package dry-run regressions.
