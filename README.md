# Code Workspace

Code Workspace is a local multi-project registry and safety layer for Claude Code and Codex. It manages workspace identity, project locations and branches, agent instructions, writable-root permissions, validation, and optional monitoring.

## Requirements

- Node.js 20.19.0 or newer
- Git repositories for projects you register

## Install

```bash
npm install -g @icebearx-ai/code-workspace
```

The package provides `code-workspace` and the shorter alias `code-w`.

## Initialize

Interactive initialization:

```bash
code-workspace init .
```

Non-interactive initialization:

```bash
code-workspace init . \
  --tools claude,codex \
  --language en-US \
  --yes
```

Use `--tools claude`, `--tools codex`, or `--tools none` to override the default tool selection. Codex monitoring is enabled by default when Codex is selected; use `--no-monitor` to disable it.

Initialization writes only Workspace-owned state and integrations:

- `.code-workspace/config.yaml` and `.code-workspace/state.json`
- `USER_GUIDE.md`
- `CLAUDE.md` and/or `AGENTS.md`
- Workspace-specific commands and skills whose names start with `code-workspace-` or use the `/code-workspace` namespace
- `.codex/hooks.json` when monitoring is enabled

It does not create `openspec/`, install native `/opsx` commands, or install native `openspec-*` skills.

## Register projects

Inspecting a repository is read-only:

```bash
code-workspace project inspect /absolute/path/to/project --json
```

Claude Code users can invoke:

```text
/code-workspace:add-projects /absolute/path/to/project-a /absolute/path/to/project-b
```

Codex users can invoke `$code-workspace-add-projects` with the same explicit paths. For low-level automation, prepare a complete project record and run:

```bash
code-workspace project add --projects-file projects.json --yes --json
```

The registry stores each project's name, real location, registered branch, type, and context. The registered branch is the Code Workspace expected state; the actual branch is observed from the selected Git worktree. Workspace never guesses a path from a conversation or automatically decides which branch is authoritative.

## Daily commands

```bash
code-workspace project list --json
code-workspace project show payments --json
code-workspace project verify payments --json
code-workspace project branch inspect payments --json
code-workspace project branch verify payments --json
code-workspace project branch use-registered payments --yes --json
code-workspace project branch accept-actual payments --yes --json
code-workspace permissions apply --yes --json
code-workspace doctor --json
```

`project branch inspect` reports `registeredBranch`, `actualBranch`, whether they match, worktree cleanliness, and local registered-branch availability for only the named project. `project branch verify` is the narrower assertion used after reconciliation: it checks only whether the registered and actual branches match, without running overall project-health validation. A `PROJECT_BRANCH_MISMATCH` diagnostic uses `registeredBranch`, `actualBranch`, and `location`; consumers of older branch diagnostic/result fields must migrate to this canonical state contract.

The two reconciliation directions are deliberately separate:

- `project branch use-registered` switches the selected worktree to its registered branch. It requires confirmation, a clean worktree, and an existing local branch.
- `project branch accept-actual` updates only the selected registry record so its registered branch accepts the actual branch. Existing branch-adoption scripts should migrate to this command.

Both commands detect plan drift and verify postconditions. Code Workspace never creates or downloads a branch and never performs fetch, stash, reset, commit, production-code edits, or conflict resolution.

`permissions apply` shows the complete authorization plan for the selected Agent tools, requires confirmation when changes are needed, applies and verifies the requested grants, and reports the result per tool. Agent directory access remains a user authorization. The command adds missing registered-project access but does not revoke additional directories; use `project remove` or edit the Agent settings explicitly to revoke access.

## Update and language

```bash
code-workspace update --json
code-workspace update --language zh-CN --json
code-workspace language --json
```

`update` refreshes only Workspace-owned managed assets and never changes Agent directory authorization. Unknown local edits stop the batch before writes; review them or pass `--force` explicitly.

## Monitor

```bash
code-workspace monitor --port 3211
```

The monitor binds to loopback, combines events from multiple initialized workspaces, and keeps hook reporting failure-open. Review and trust project hooks in Codex before relying on reports.

## Completion

```bash
code-workspace completion --shell zsh
code-workspace completion --shell bash
```

`completion` prints a script generated from the full command registry, including subcommands and command-specific options. It does not install the script or modify shell configuration. With `--json`, the script is returned in `data.script`.

## Development

```bash
npm install
npm test
npm run check
npm run pack:check
```

The release manifest contains only Workspace-owned asset sources and managed files. Checksums make installation and update deterministic.
