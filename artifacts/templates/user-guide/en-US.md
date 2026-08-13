# Code Workspace User Guide

A short reminder for using Code Workspace after initialization.

## Add workspace projects

Codex:

```text
$code-workspace-add-projects /absolute/path/to/project-a /absolute/path/to/project-b
```

Claude Code:

```text
/code-workspace:add-projects /absolute/path/to/project-a /absolute/path/to/project-b
```

Review the project records and confirm when prompted. The add-projects skill runs `code-workspace language --json`, uses `data.projectContext` from the standard result envelope, and writes each generated project context in `data.language`.

## Upgrade Code Workspace

Upgrade the global package, update the current workspace's managed files, then verify health:

```bash
npm install -g @icebearx-ai/code-workspace@latest
code-w update
code-w doctor
```

`update` refreshes managed instructions, Workspace skills, hooks, and this guide. It stops if a managed file contains unknown local changes. Review the file first; use `--force` only when replacing those changes is intentional.

## Workspace language

Choose the Workspace language during initialization, or pass it explicitly:

```bash
code-w init --language en-US
code-w language
```

The selected preference is stored at `workspace.language` in `.code-workspace/config.yaml`. Change an initialized workspace with:

```bash
code-w update --language en-US
```

This also switches this managed guide. Existing project context is not translated.

## Use the Agent monitor

Start one global monitor for all workspaces:

```bash
code-w monitor
```

Open the printed local URL. The dashboard shows workspaces, execution state, pending approvals, completed turns, and live signals. Monitor language is selected on the page and is independent of `workspace.language`.

Use another port when necessary:

```bash
code-w monitor --port 8080
```

Each participating workspace must use the same URL in `.code-workspace/config.yaml`. After initialization, review and trust the project hooks with `/hooks` in Codex.

## Practical commands

```bash
# Check installation and workspace health
code-w doctor

# Update all managed files
code-w update

# Synchronize Codex writable project roots
code-w sync

# Validate local projects
code-w project verify
code-w project verify <project-name>
```

Add `--json` when a query result is consumed by Codex or a script.

## Workspace skills

- `$code-workspace-add-projects` — inspect and register local Git projects with concise AI-generated navigation context.
- `$code-workspace-resolve-branch` — safely resolve a selected project's registered/actual branch mismatch and re-run targeted verification.

| Purpose | Codex | Claude Code |
| --- | --- | --- |
| Add workspace projects | `$code-workspace-add-projects` | `/code-workspace:add-projects` |
| Resolve a project branch mismatch | `$code-workspace-resolve-branch` | `/code-workspace-resolve-branch` |
