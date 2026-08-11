## MODIFIED Requirements

### Requirement: Concise root policy and shared branch recovery
The generated root instructions and patched OpenSpec workflow entry points SHALL retain project selection, targeted verification, OpenSpec ownership, and workspace write-boundary rules, and SHALL delegate branch mismatch recovery to an installed `openspec-workspace-resolve-branch` Skill rather than duplicating the recovery procedure.

#### Scenario: Branch mismatch during project selection
- **WHEN** targeted verification returns `PROJECT_BRANCH_MISMATCH`
- **THEN** the root instruction or patched workflow directs the agent to use the shared branch recovery Skill rather than embedding the full recovery procedure

#### Scenario: Recovery Skill installation
- **WHEN** Codex or Claude is selected
- **THEN** the system installs the same branch recovery Skill content in that client's Skill directory

#### Scenario: Patched OpenSpec entry point
- **WHEN** a native OpenSpec propose, explore, apply, or archive entry point needs branch recovery
- **THEN** it delegates to the installed recovery Skill and does not directly write Workspace registry files

### Requirement: Recovery requires an explicit safe choice
The branch recovery Skill MUST inspect the worktree and branch state, present the supported recovery choices, require explicit user authorization before a mutation, and re-run targeted verification after recovery. Other generated instructions MUST NOT bypass these recovery preconditions.

#### Scenario: Dirty worktree
- **WHEN** branch recovery discovers uncommitted changes
- **THEN** the Skill does not switch branches automatically and asks the user to choose a safe recovery action

#### Scenario: Configuration branch synchronization
- **WHEN** the user explicitly chooses to accept the project's current branch
- **THEN** the Skill uses `project sync-branch`, re-runs `project verify <name>`, and invalidates stale branch-dependent context

#### Scenario: Inline recovery attempt
- **WHEN** a patched workflow receives a project branch mismatch
- **THEN** it must not treat a branch selection alone as authorization to bypass the shared Skill's worktree and local-branch checks
