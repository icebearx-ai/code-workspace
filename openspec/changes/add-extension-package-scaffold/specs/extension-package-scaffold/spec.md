## ADDED Requirements

### Requirement: Extension init creates a compliant package root
The CLI SHALL provide `extension init [path]` and create a package root containing `package.json`, `extension/manifest.json`, `extension/init.js`, and `README.md`.

#### Scenario: Create a package with defaults
- **WHEN** a user runs `codew extension init ./my-extension --yes`
- **THEN** the command creates the package-root layout, derives the extension id from the directory name, writes valid identity metadata, and returns the created absolute path.

#### Scenario: Create a package with explicit metadata
- **WHEN** a user supplies `--id`, `--name`, `--description`, or `--version`
- **THEN** the generated manifest and transport envelope use those values consistently.

#### Scenario: Reject a non-empty target
- **WHEN** the target directory contains files that are not the planned scaffold output
- **THEN** the command fails with a stable target-exists diagnostic and leaves all existing files unchanged.

#### Scenario: Generated package is immediately packable
- **WHEN** scaffold creation succeeds
- **THEN** `extension/manifest.json` and `package.json` pass current envelope and manifest validation and `extension pack` can package the result without manual edits.

### Requirement: Digest update synchronizes package metadata
The CLI SHALL provide `extension digest update [path]` and update only `extension/manifest.json.entrySha256` and `package.json.codeWorkspace.packageSha256` using the current package contents.

#### Scenario: Update after entry changes
- **WHEN** `extension/init.js` changes and the user runs `codew extension digest update <path>`
- **THEN** the command writes the new entry digest and a package digest computed after that manifest update.

#### Scenario: Update is idempotent
- **WHEN** both stored digests already match the current files
- **THEN** the command returns a skip/already-current result and does not rewrite either file.

#### Scenario: Update failure is atomic
- **WHEN** validation or persistence fails during digest update
- **THEN** neither metadata file is left partially updated.

### Requirement: Public extension pack validates and packages an existing package root
The CLI SHALL treat `extension pack <source> --output <directory>` as a read-only source operation that validates an existing package-root envelope and writes a tarball without modifying the source.

#### Scenario: Package a valid source root
- **WHEN** source contains a valid `package.json` and `extension/` tree
- **THEN** the command writes a tarball containing exactly `package/package.json` and `package/extension/**`, with no README or unrelated root files.

#### Scenario: Reject envelope identity drift
- **WHEN** package name, version, extension id, extension spec, or package digest disagrees with the extension manifest or directory
- **THEN** packing fails with a stable identity or digest diagnostic and no output tarball remains.

#### Scenario: Reject stale entry digest
- **WHEN** `manifest.entrySha256` does not match `extension/init.js`
- **THEN** packing fails and suggests running `extension digest update`.

#### Scenario: Preserve source envelope
- **WHEN** packing succeeds
- **THEN** the source `package.json` and all source extension files remain byte-for-byte unchanged.

### Requirement: Digest and pack commands are workspace-independent
The commands SHALL load no workspace configuration and SHALL work from any current working directory.

#### Scenario: Run outside a workspace
- **WHEN** a user invokes either command from a directory without a Code Workspace configuration
- **THEN** command recognition and execution proceed using the explicit package path.
