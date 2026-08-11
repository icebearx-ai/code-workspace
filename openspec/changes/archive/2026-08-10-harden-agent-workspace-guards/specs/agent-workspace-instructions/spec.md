## ADDED Requirements

### Requirement: Client-discoverable root instructions
The system SHALL install the Codex root instruction as `AGENTS.md` and the Claude root instruction as `CLAUDE.md` according to the selected tools.

#### Scenario: Codex workspace initialization
- **WHEN** a workspace is initialized with Codex selected
- **THEN** the system installs `AGENTS.md` and does not install root `AGENT.md`

#### Scenario: Claude workspace initialization
- **WHEN** a workspace is initialized with Claude selected
- **THEN** the system installs `CLAUDE.md` and does not install a Codex root instruction unless Codex is also selected

### Requirement: Safe Codex filename migration
The system MUST migrate a state-owned unchanged root `AGENT.md` to `AGENTS.md` without overwriting user-owned or modified content.

#### Scenario: Unchanged managed legacy file
- **WHEN** update finds an unchanged `AGENT.md` recorded as managed by the prior release and no conflicting `AGENTS.md`
- **THEN** the system removes `AGENT.md`, installs `AGENTS.md`, and records the new managed target

#### Scenario: Modified managed legacy file
- **WHEN** update finds a previously managed `AGENT.md` whose content no longer matches managed state
- **THEN** the system reports the existing obsolete-managed-file conflict and does not silently delete the file

#### Scenario: Unknown new target
- **WHEN** update finds an `AGENTS.md` that is not owned by managed state
- **THEN** the system refuses to overwrite it without existing explicit force authorization

### Requirement: Canonical cross-client instruction source
The system SHALL render `CLAUDE.md` and `AGENTS.md` from one canonical root template using manifest-declared client-specific values.

#### Scenario: Platform-specific add-project instruction
- **WHEN** the canonical template is rendered for each selected client
- **THEN** each output contains that client's add-project invocation while all client-neutral policy originates from the same source

#### Scenario: Invalid static render value
- **WHEN** a managed-file definition supplies a non-string static render value or leaves a template token unresolved
- **THEN** manifest loading or rendering fails before the managed file is installed

### Requirement: Concise root policy and shared branch recovery
The generated root instructions SHALL retain project selection, targeted verification, OpenSpec ownership, and workspace write-boundary rules, and SHALL delegate branch mismatch recovery to an installed `openspec-workspace-resolve-branch` Skill.

#### Scenario: Branch mismatch during project selection
- **WHEN** targeted verification returns `PROJECT_BRANCH_MISMATCH`
- **THEN** the root instruction directs the agent to use the shared branch recovery Skill rather than embedding the full recovery procedure

#### Scenario: Recovery Skill installation
- **WHEN** Codex or Claude is selected
- **THEN** the system installs the same branch recovery Skill content in that client's Skill directory

### Requirement: Recovery requires an explicit safe choice
The branch recovery Skill MUST inspect the worktree and branch state, present the supported recovery choices, require explicit user authorization before a mutation, and re-run targeted verification after recovery.

#### Scenario: Dirty worktree
- **WHEN** branch recovery discovers uncommitted changes
- **THEN** the Skill does not switch branches automatically and asks the user to choose a safe recovery action

#### Scenario: Configuration branch synchronization
- **WHEN** the user explicitly chooses to accept the project's current branch
- **THEN** the Skill uses `project sync-branch`, re-runs `project verify <name>`, and invalidates stale branch-dependent context

