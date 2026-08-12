# OpenSpec Workspace User Guide

A short reminder for using OpenSpec Workspace after initialization.

## Add workspace projects

Codex:

```text
$openspec-workspace-add-projects /absolute/path/to/project-a /absolute/path/to/project-b
```

Claude Code:

```text
/opswx:add-projects /absolute/path/to/project-a /absolute/path/to/project-b
```

Review the project records and confirm when prompted. The add-projects skill runs `openspec-workspace language --json`, uses `data.projectContext` from the standard result envelope, and writes each generated project context in `data.language`.

## Upgrade OpenSpec Workspace

Upgrade the global package, update the current workspace's managed files, then verify health:

```bash
npm install -g @icebearx-ai/openspec-workspace@latest
openspec-w update
openspec-w doctor
```

`update` refreshes managed instructions, Workspace skills, hooks, and this guide. It stops if a managed file contains unknown local changes. Review the file first; use `--force` only when replacing those changes is intentional.

## Workspace language

Choose the Workspace language during initialization, or pass it explicitly:

```bash
openspec-w init --language en-US
openspec-w language
```

The selected preference is stored at `workspace.language` in `.openspec-workspace/config.yaml`. Change an initialized workspace with:

```bash
openspec-w update --language en-US
```

This also switches this managed guide. Existing project context is not translated.

## Use the Agent monitor

Start one global monitor for all workspaces:

```bash
openspec-w monitor
```

Open the printed local URL. The dashboard shows workspaces, execution state, pending approvals, completed turns, and live signals. Monitor language is selected on the page and is independent of `workspace.language`.

Use another port when necessary:

```bash
openspec-w monitor --port 8080
```

Each participating workspace must use the same URL in `.openspec-workspace/config.yaml`. After initialization, review and trust the project hooks with `/hooks` in Codex.

## Practical commands

```bash
# Check installation and workspace health
openspec-w doctor

# Update all managed files
openspec-w update

# Synchronize Codex writable project roots
openspec-w sync

# Validate local projects
openspec-w project verify
openspec-w project verify <project-name>
```

Existing local specification records remain available through read-only compatibility commands:

```bash
openspec-w change validate <change-name>
openspec-w context --change <change-name>
openspec-w validate
```

Add `--json` when a query result is consumed by Codex or a script.

## Workspace skills

- `$openspec-workspace-add-projects` — inspect and register local Git projects with concise AI-generated navigation context.
- `$openspec-workspace-resolve-branch` — safely resolve a selected project's registered/actual branch mismatch and re-run targeted verification.

| Purpose | Codex | Claude Code |
| --- | --- | --- |
| Add workspace projects | `$openspec-workspace-add-projects` | `/opswx:add-projects` |
| Resolve a project branch mismatch | `$openspec-workspace-resolve-branch` | `/openspec-workspace-resolve-branch` |
