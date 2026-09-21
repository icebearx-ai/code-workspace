## ADDED Requirements

### Requirement: Init creates a capability-neutral shell
The CLI SHALL create a package root containing `package.json`, empty `README.md`, a `.gitignore` containing `/dist`, `extension/manifest.json`, and `extension/init.js` for a default extension init, without declaring outputs, hooks, or runtime capabilities.

#### Scenario: Create an empty shell
- **WHEN** a user runs `codew extension init ./example-extension --yes`
- **THEN** the command creates the five package files, with an empty README.md and `.gitignore` containing `/dist`, and does not create output artifacts or target declarations.

#### Scenario: Collect generic metadata interactively
- **WHEN** init runs in an interactive TTY without an explicit id, name, description, or version
- **THEN** it asks only for those generic metadata fields and never asks which extension capability to provide.

### Requirement: Pack remains strict for incomplete shells
The pack command SHALL reject a shell manifest until it declares at least one outputs, hooks, or runtime capability.

#### Scenario: Pack an incomplete shell
- **WHEN** a shell has no outputs, hooks, or runtime
- **THEN** pack fails with a diagnostic explaining that a capability must be added before packaging.

### Requirement: Digest update supports shell manifests
The digest update command SHALL update entrySha256 and packageSha256 for a capability-neutral shell without requiring a complete capability declaration.

#### Scenario: Update shell digests
- **WHEN** a user changes the shell init.js and runs digest update
- **THEN** both digests are updated atomically while the shell remains capability-neutral.
