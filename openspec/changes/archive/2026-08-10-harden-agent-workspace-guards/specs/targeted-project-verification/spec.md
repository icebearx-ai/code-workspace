## ADDED Requirements

### Requirement: Optional project verification scope
The `project verify` command SHALL accept one optional project name while retaining workspace-wide verification when the name is absent.

#### Scenario: Verify all projects
- **WHEN** the command is invoked as `project verify` without a name
- **THEN** it validates every configured project with the existing workspace-wide behavior

#### Scenario: Verify one project
- **WHEN** the command is invoked as `project verify service`
- **THEN** it validates the configured project named `service` and conflicts involving that project

#### Scenario: Extra positional argument
- **WHEN** more than one project name is supplied
- **THEN** the shared parser rejects the invocation with `CLI_EXTRA_ARGUMENT`

### Requirement: Targeted runtime isolation
Targeted verification MUST report runtime diagnostics for the selected project and MUST NOT fail solely because an unrelated project has a branch or repository mismatch.

#### Scenario: Unrelated branch mismatch
- **WHEN** the selected project is valid and another configured project is on a different branch
- **THEN** targeted verification succeeds for the selected project

#### Scenario: Selected branch mismatch
- **WHEN** the selected project's configured and current branches differ
- **THEN** targeted verification fails with `PROJECT_BRANCH_MISMATCH`

### Requirement: Selected-project configuration conflicts
Targeted verification MUST retain configuration diagnostics whose participants include the selected project.

#### Scenario: Duplicate selected project name
- **WHEN** the selected project participates in a duplicate project-name conflict
- **THEN** targeted verification reports the duplicate-name diagnostic

#### Scenario: Nested selected project path
- **WHEN** the selected project participates in a forbidden nested-path conflict
- **THEN** targeted verification reports the nested-path diagnostic

### Requirement: Stable targeted verification results
The command SHALL use the shared result envelope and stable project error codes, SHALL load only the projects configuration domain, and SHALL not write workspace state.

#### Scenario: Target not found
- **WHEN** the requested project name is not configured
- **THEN** the command fails with the existing project-not-found error and remediation where available

#### Scenario: Targeted JSON success
- **WHEN** targeted verification succeeds with JSON output
- **THEN** `data.projects` remains present and `data.scope` plus `data.project` identify the targeted result

#### Scenario: Unrelated invalid configuration domain
- **WHEN** a non-project configuration domain is invalid but the projects projection is valid
- **THEN** targeted verification remains available
