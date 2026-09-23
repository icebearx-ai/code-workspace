## ADDED Requirements

### Requirement: Install a local extension tarball
The CLI SHALL extend `extension install` with a `--local <tarball>` mode that accepts one local `.tgz` tarball and installs it into the current Workspace after complete transport verification.

#### Scenario: Install a valid local tarball
- **WHEN** a user runs `codew extension install --local ./dist/example.tgz --yes` in an initialized Workspace
- **THEN** the CLI verifies the tarball, imports the Extension package into the local Store, applies the normal Workspace installation transaction, and reports the installed extension identity and digest.

#### Scenario: Reject a source directory
- **WHEN** a user passes a package directory instead of a `.tgz` file
- **THEN** the command fails with a stable local-archive error before changing Store or Workspace state.

### Requirement: Preserve tarball and package integrity
The command SHALL validate the transport envelope, manifest, entry digest, package digest, safe paths, file types, and package limits before any persistent mutation.

#### Scenario: Reject an invalid or tampered tarball
- **WHEN** the tarball is missing, malformed, tampered, or contains an unsafe entry
- **THEN** the command fails with a structured diagnostic and leaves Store and Workspace state unchanged.

### Requirement: Keep local Store packages immutable
The command SHALL record local packages with local provenance and SHALL NOT replace an existing package with the same id and version but a different package digest.

#### Scenario: Reuse an identical local package
- **WHEN** the Store already contains the same id, version, and package digest
- **THEN** the command reuses the stored package and proceeds idempotently without replacing files.

#### Scenario: Reject a digest conflict
- **WHEN** the Store already contains the same id and version with a different package digest
- **THEN** the command fails with a package conflict diagnostic and leaves the existing package unchanged.

### Requirement: Use shared confirmation and lifecycle behavior
The command SHALL use the existing extension installation plan, confirmation, transaction, rollback, state persistence, and uninstall lifecycle.

#### Scenario: Cancel before mutation
- **WHEN** the user declines the installation confirmation
- **THEN** the command reports cancellation and does not import or install the package.

### Requirement: Keep install modes unambiguous
The CLI SHALL reject Registry-only arguments and extra extension names when `--local` is present, while preserving the existing Registry behavior when `--local` is absent.

#### Scenario: Reject mixed local and Registry arguments
- **WHEN** a user runs `codew extension install my-extension --local ./dist/example.tgz --yes` or passes `--version` with `--local`
- **THEN** the command fails with a stable mode-conflict diagnostic before importing or installing anything.
