# OpenSpec Workspace

OpenSpec Workspace is a local multi-project registry and safety layer for Claude Code and Codex. It manages workspace identity, project locations and branches, agent instructions, writable-root permissions, validation, and optional monitoring.

It is standalone. It does not install, detect, invoke, or version-manage another OpenSpec package or executable. Existing files under `openspec/` remain user-owned and are not read or written by Workspace.

## Requirements

- Node.js 20.19.0 or newer
- Git repositories for projects you register

## Install

```bash
npm install -g @icebearx-ai/openspec-workspace
```

The package provides `openspec-workspace` and the shorter alias `openspec-w`.

## Initialize

Interactive initialization:

```bash
openspec-workspace init .
```

Non-interactive initialization:

```bash
openspec-workspace init . \
  --tools claude,codex \
  --language en-US \
  --yes
```

Use `--tools claude`, `--tools codex`, or `--tools none` to override the default tool selection. Codex monitoring is enabled by default when Codex is selected; use `--no-monitor` to disable it.

Initialization writes only Workspace-owned state and integrations:

- `.openspec-workspace/config.yaml` and `.openspec-workspace/state.json`
- `USER_GUIDE.md`
- `CLAUDE.md` and/or `AGENTS.md`
- Workspace-specific commands and skills whose names start with `openspec-workspace-` or use the `/opswx` namespace
- `.codex/hooks.json` when monitoring is enabled

It does not create `openspec/`, install native `/opsx` commands, or install native `openspec-*` skills.

## Register projects

Inspecting a repository is read-only:

```bash
openspec-workspace project inspect /absolute/path/to/project --json
```

Claude Code users can invoke:

```text
/opswx:add-projects /absolute/path/to/project-a /absolute/path/to/project-b
```

Codex users can invoke `$openspec-workspace-add-projects` with the same explicit paths. For low-level automation, prepare a complete project record and run:

```bash
openspec-workspace project add --projects-file projects.json --yes --json
```

The registry stores each project's name, real location, expected Git branch, type, and context. Workspace never guesses a path from a conversation.

## Daily commands

```bash
openspec-workspace project list --json
openspec-workspace project show payments --json
openspec-workspace project verify payments --json
openspec-workspace project sync-branch payments --yes --json
openspec-workspace context --project payments --json
openspec-workspace sync --json
openspec-workspace doctor --json
```

`project sync-branch` records the branch already checked out in the repository; it never switches Git branches.

## Update and language

```bash
openspec-workspace update --json
openspec-workspace update --language zh-CN --json
openspec-workspace language --json
```

`update` refreshes only Workspace-owned managed assets. Unknown local edits stop the batch before writes; review them or pass `--force` explicitly.

## Monitor

```bash
openspec-workspace monitor --port 3211
```

The monitor binds to loopback, combines events from multiple initialized workspaces, and keeps hook reporting failure-open. Review and trust project hooks in Codex before relying on reports.

## Completion

```bash
openspec-workspace completion --shell zsh
openspec-workspace completion --shell bash
```

## Development

```bash
npm install
npm test
npm run check
npm run pack:check
```

The release manifest contains only Workspace-owned asset sources and managed files. Checksums make installation and update deterministic.
