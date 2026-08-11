# OpenSpec Workspace User Guide

A short reminder for using OpenSpec Workspace and OpenSpec after initialization.

## Practical Skills

### Add workspace projects

Codex:

```text
$openspec-workspace-add-projects /absolute/path/to/project-a /absolute/path/to/project-b
```

Claude Code:

```text
/opswx:add-projects /absolute/path/to/project-a /absolute/path/to/project-b
```

Review the project records and confirm when prompted.

The add-projects skill runs `openspec-workspace language --json`, uses `data.projectContext` from the standard result envelope, and writes each generated project context in `data.language`. OpenSpec instructions remain in English; the `Language` value in `openspec/config.yaml` controls the language of OpenSpec-generated artifacts.

## Upgrade OpenSpec Workspace

Upgrade the global package, update the current workspace's managed files, then verify health:

```bash
npm install -g @icebearx-ai/openspec-workspace@latest
openspec-w update
openspec-w doctor
```

`update` refreshes managed instructions, skills, hooks, schema files, and this guide. It stops if a managed file contains unknown local changes. Review the file first; use `--force` only when replacing those changes is intentional.

When a release requires a different OpenSpec version, run `init` again and review its plan before confirming:

```bash
openspec-w init
```

Choose the language for OpenSpec-generated artifacts during initialization, or pass it explicitly:

```bash
openspec-w init --language en-US
openspec-w language
```

The selected preference is stored at `workspace.language` in `.openspec-workspace/config.yaml`. Change an initialized workspace with:

```bash
openspec-w update --language en-US
```

This also switches this managed guide. Existing OpenSpec artifacts and existing project context are not translated. If a managed file has local changes, update stops without changing the preference and suggests an explicit `--force` retry.

## Use the Agent monitor

Start one global monitor for all workspaces:

```bash
openspec-w monitor
```

Open the printed local URL. The dashboard shows workspaces, execution state, pending approvals, completed turns, and live signals. Sound alerts are enabled by default.

Choose the Monitor language manually from the dashboard. This setting is stored in the browser and is independent of `workspace.language`; Monitor i18n is not managed by the CLI workspace-language setting.

Use another port when necessary:

```bash
openspec-w monitor --port 8080
```

Each participating workspace must use the same URL in `.openspec-workspace/config.yaml`:

```yaml
monitor:
  enable: true
  url: http://127.0.0.1:8080
```

After initialization, review and trust the project hooks with `/hooks` in Codex. Approval decisions must still be made in the originating Codex CLI or Codex App.

## Practical commands

### Maintenance and diagnostics

```bash
# Check installation and workspace health
openspec-w doctor

# Update all managed files
openspec-w update

# Synchronize Codex writable project roots
openspec-w sync
```

Add `--json` to validation and query commands when the result is consumed by Codex or a script.

### Changes and validation

```bash
# Validate project ownership and task structure for one change
openspec-w change validate <change-name>

# Print the exact project context for a change
openspec-w context --change <change-name>

# Validate projects, specs, and all active changes
openspec-w validate
```

## OpenSpec change lifecycle

(Using Codex as an example.)

```text
┌──────────────┐
│ New request  │
└──────┬───────┘
       ├── Clear enough, propose directly ─────┐
       │                                       │
       ▼                                       │
┌────────────────────────────┐                 │
│ Explore (optional)         │                 │
│ $openspec-explore          │                 │
└─────────────┬──────────────┘                 │
              │ requirements clarified        │
              ▼                                │
┌────────────────────────────┐ ◀───────────────┘
│ Proposal                   │
│ $openspec-propose          │
└─────────────┬──────────────┘
              │ produces
              ▼
┌────────────────────────────┐
│ Specs · Design · Tasks     │
└─────────────┬──────────────┘
              │ ready
              ▼
┌────────────────────────────┐
│ Apply                      │
│ $openspec-apply-change     │
└─────────────┬──────────────┘
              │ implemented
              ▼
┌────────────────────────────┐
│ Validate                   │
│ tests + review             │
└─────────────┬──────────────┘
              │ complete
              ▼
┌────────────────────────────┐
│ Archive                    │
│ $openspec-archive-change   │
└────────────────────────────┘
```

### What the skills do

- `$openspec-explore` — investigate the problem, constraints, and affected projects before committing to a change. It is optional and does not need to create artifacts.
- `$openspec-propose` — create the change proposal and the required specs, design, and task artifacts so implementation can begin.
- `$openspec-apply-change` — implement the tasks in their owning workspace projects, keeping changes within declared project boundaries.
- `$openspec-sync-specs` — merge a change's spec deltas into the main specs without archiving the change.
- `$openspec-archive-change` — verify the completed change, update the main specs, and move the change into the archive.
- `$openspec-workspace-add-projects` — inspect and register local Git projects with concise AI-generated navigation context.
- `$openspec-workspace-resolve-branch` — safely resolve a selected project's registered/actual branch mismatch and re-run targeted verification.

### Claude Code equivalents

The guide uses Codex skill names as the primary notation. In Claude Code, use the corresponding slash commands:

| Purpose | Codex | Claude Code |
| --- | --- | --- |
| Explore | `$openspec-explore` | `/opsx:explore` |
| Propose | `$openspec-propose` | `/opsx:propose` |
| Apply | `$openspec-apply-change` | `/opsx:apply` |
| Sync specs | `$openspec-sync-specs` | `/opsx:sync` |
| Archive | `$openspec-archive-change` | `/opsx:archive` |
| Add workspace projects | `$openspec-workspace-add-projects` | `/opswx:add-projects` |
| Resolve a workspace branch mismatch | `$openspec-workspace-resolve-branch` | `/openspec-workspace-resolve-branch` |
