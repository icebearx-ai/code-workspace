## ADDED Requirements

### Requirement: Thin native workflow adapter
Versioned native OpenSpec workflow patches MUST preserve OpenSpec lifecycle ownership and MUST limit Workspace behavior to project discovery, targeted validation, ownership context, edit boundaries, and delegation to Workspace-owned recovery operations.

#### Scenario: Branch mismatch in a patched workflow
- **WHEN** targeted project verification returns `PROJECT_BRANCH_MISMATCH`
- **THEN** the patched workflow delegates to `openspec-workspace-resolve-branch`
- **THEN** it does not directly edit `.openspec-workspace/config.yaml` or embed an unconditional Git branch switch

#### Scenario: Ordinary OpenSpec workflow
- **WHEN** an action does not use `workspace-workflow`
- **THEN** the native OpenSpec workflow proceeds without Workspace project orchestration

### Requirement: Repo-local workspace planning scope
The `workspace-workflow` extension MUST operate only when OpenSpec reports a repo-local planning home whose root equals the Workspace root returned by the Workspace context command.

#### Scenario: Matching repo-local roots
- **WHEN** `schemaName` is `workspace-workflow`, `planningHome.kind` is `repo`, and both roots match
- **THEN** the patched workflow may consume Workspace project context

#### Scenario: Standalone store scope
- **WHEN** a `workspace-workflow` action resolves from a standalone OpenSpec store or the roots do not match
- **THEN** the patched workflow stops before project-specific artifact or production edits and reports the unsupported scope

### Requirement: Relevant-project verification
Patched OpenSpec workflows MUST select registered projects before project-specific work and MUST use targeted verification for every selected or change-affected project without failing solely because an unrelated project has runtime drift.

#### Scenario: Unrelated branch mismatch during propose
- **WHEN** the proposed change selects project `service` and another registered project has a branch mismatch
- **THEN** `service` can be verified and proposal generation is not blocked by the unrelated mismatch

#### Scenario: Selected branch mismatch
- **WHEN** a selected project has a branch mismatch
- **THEN** the workflow stops project work and invokes the shared recovery Skill for that project

### Requirement: Change-scoped implementation context
The apply extension MUST obtain project locations with `context --change <name> --json`, verify that the returned change and Workspace root match the OpenSpec action context, and refresh that context after branch recovery.

#### Scenario: Apply a two-project change
- **WHEN** a validated change affects two registered projects
- **THEN** apply uses only those two project records and edits production files only under each task owner's registered location

### Requirement: Truthful archive sync postcondition
After successful main-spec synchronization, the archive extension MUST verify that every delta spec for the change exists as a main spec and resolves to exactly one configured project owner before moving the change.

#### Scenario: Missing synchronized main spec
- **WHEN** a delta spec has no corresponding main spec after synchronization
- **THEN** archive stops with a stable main-spec postcondition diagnostic

#### Scenario: Successful synchronized ownership validation
- **WHEN** every delta spec exists under main specs and has one configured prefix owner
- **THEN** archive may proceed to the OpenSpec-owned move operation

### Requirement: Stable workspace protocol tokens
Workspace workflow instructions MUST identify parser-sensitive Markdown headings and field labels as invariant protocol tokens that are not translated by the workspace language setting.

#### Scenario: Chinese workspace artifacts
- **WHEN** the workspace language is `zh-CN`
- **THEN** artifact prose may be Chinese while ownership headings, ownership field labels, project names, capability IDs, and `Cross-project` remain unchanged

### Requirement: Deterministic patch safety checks
Release checks MUST validate both patch applicability and the safety semantics of every compiled patched command and Skill.

#### Scenario: Unsafe compiled instruction
- **WHEN** a compiled patched workflow directs an agent to edit Workspace configuration directly or duplicates branch-switch recovery
- **THEN** the deterministic test suite fails

