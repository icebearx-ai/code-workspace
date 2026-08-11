## Why

The generated Codex workspace instruction currently uses `AGENT.md`, which is not the default Codex discovery filename, while the Claude and Codex instruction bodies duplicate the same policy and are difficult to keep aligned. Project selection also invokes workspace-wide verification, so an unrelated project branch mismatch can prevent otherwise valid work on the selected project.

## What Changes

- **BREAKING**: Generate the Codex root instruction as `AGENTS.md` and safely migrate managed `AGENT.md` files without overwriting user-owned content.
- Generate `CLAUDE.md` and `AGENTS.md` from one canonical instruction template with client-specific static substitutions.
- Keep root instructions concise and move branch mismatch recovery into a shared `openspec-workspace-resolve-branch` Skill installed for both clients.
- Extend `project verify` with an optional project name so agents can validate the selected project without being blocked by unrelated project branch mismatches.
- Preserve the current workspace-wide behavior when `project verify` is called without a project name.
- Add focused unit and regression coverage for the implemented migration, rendering, Skill installation, parsing, isolation, and verification behavior. This change intentionally excludes a standalone Agent entry contract test suite and cross-client `PreToolUse` write protection.

## Capabilities

### New Capabilities

- `agent-workspace-instructions`: Managed Claude and Codex workspace instructions share a canonical source, use client-discoverable filenames, and provide a shared branch-recovery Skill.
- `targeted-project-verification`: `project verify` can validate one selected project and its relevant conflicts while retaining workspace-wide verification by default.

### Modified Capabilities

None.

## Impact

- Affects the managed asset manifest, managed-file renderer and migration rules, Claude/Codex templates, generated Skills, doctor/update behavior, project command declaration and handler, project validation core, documentation, and adjacent tests.
- Existing generated workspaces may replace an unchanged managed `AGENT.md` with `AGENTS.md`; modified or unknown files remain protected by the existing managed-file conflict model.
- The CLI JSON success envelope remains stable and existing error codes remain the preferred compatibility boundary.
