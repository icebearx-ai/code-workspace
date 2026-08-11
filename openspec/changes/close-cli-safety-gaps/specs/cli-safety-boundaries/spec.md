## ADDED Requirements

### Requirement: External effects are reported across failure boundaries
The CLI MUST report an external effect when an external command was invoked and may have changed state, even when the command itself fails or its command-specific postcondition verification fails. The report MUST distinguish verified workspace rollback from retained external state and MUST NOT claim that unverified external state was rolled back.

#### Scenario: Global installation verification fails
- **WHEN** the CLI invokes the global OpenSpec installation and the subsequent installed-version verification fails
- **THEN** the failure diagnostics include a retained global-package effect with `applied` or `possibly-applied` status and the observed version evidence

#### Scenario: Dependency installation partially changes the workspace
- **WHEN** workspace dependency installation fails after `node_modules` or a lockfile may have been changed
- **THEN** the failure diagnostics identify those paths as retained or possibly retained without claiming package-level completeness

#### Scenario: Upstream initialization misses a postcondition
- **WHEN** `openspec init` exits successfully but one or more required baseline targets are still missing
- **THEN** the command fails and reports the baseline targets that were created plus the incomplete enumeration scope

### Requirement: Maintenance migrations are auditable and write only at maintenance boundaries
The CLI SHALL expose one maintenance migration plan that combines configuration Schema steps with legacy workspace-language resolution. The plan MUST identify the selected language source, conflicts, and intended write targets. Read-only commands MUST NOT commit the plan; only init and update may persist it.

#### Scenario: Read-only command accesses a supported old configuration
- **WHEN** a read-only command requests a domain that is valid in a supported v0 or v1 configuration
- **THEN** the command reads that domain without rewriting the configuration or state

#### Scenario: Update migrates legacy language
- **WHEN** update reads a supported old configuration whose language is derived from legacy state or OpenSpec context
- **THEN** its result reports both Schema and language migration steps and commits the resolved language within the existing workspace file transaction

#### Scenario: Legacy language sources conflict
- **WHEN** legacy state and OpenSpec context specify different supported languages and no explicit language is supplied
- **THEN** init or update fails before workspace writes with a stable conflict code, source evidence, and an explicit remediation command

### Requirement: Known-command parse failures preserve command context
The machine-readable failure result MUST identify the normalized command when command resolution succeeded before an option or argument error occurred. Failures for an unknown command MAY keep the command field null.

#### Scenario: Known command contains an unknown option
- **WHEN** the user runs `openspec-w update --froce --json`
- **THEN** the JSON result has `command: "update"` and a `CLI_UNKNOWN_OPTION` diagnostic

#### Scenario: Command cannot be resolved
- **WHEN** the user runs an unknown top-level command in JSON mode
- **THEN** the JSON result has a `CLI_UNKNOWN_COMMAND` diagnostic and does not substitute a workspace discovery error

### Requirement: Write protection is proportional to effect scope
The CLI SHALL use atomic write plus post-write verification for a single managed file, file transactions for coordinated multi-file workspace changes, and postcondition verification plus retained-effect reporting for external commands.

#### Scenario: Permission synchronization writes one file
- **WHEN** sync changes the generated Codex permission file
- **THEN** it writes atomically, verifies the managed block after writing, and does not require a multi-file transaction wrapper

#### Scenario: Multi-file workspace command fails
- **WHEN** init, update, or project configuration fails after modifying tracked workspace files
- **THEN** the existing file transaction restores or removes tracked workspace files and reports any external effects separately
