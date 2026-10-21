# Code Workspace User Guide

A short reminder for using Code Workspace after initialization.

## Add workspace projects

Codex:

```text
$codew-add-projects /absolute/path/to/project-a /absolute/path/to/project-b
```

Claude Code:

```text
/codew:add-projects /absolute/path/to/project-a /absolute/path/to/project-b
```

Review the project records and confirm once. The add-projects skill uses one read-only collection to inspect every path independently; a failed project reports its diagnostic without stopping the remaining paths or being silently ignored. After confirmation, all valid records are sent to `project add` through stdin in one operation, with no temporary JSON file and no default second verify.

## Upgrade Code Workspace

Upgrade the global package, update the current workspace's managed files, then verify health:

```bash
npm install -g @icebearx-ai/code-workspace@latest
codew update
codew doctor
```

`update` refreshes managed instructions, Workspace skills, and this guide. It stops if a managed file contains unknown local changes. Review the file first; use `--force` only when replacing those changes is intentional.

## Workspace language

Choose the Workspace language during initialization, or pass it explicitly:

```bash
codew init --language en-US
codew language
```

The selected preference is stored at `workspace.language` in `.codew/config.yaml`. Change an initialized workspace with:

```bash
codew update --language en-US
```

This also switches this managed guide. Existing project context is not translated.

## Practical commands

```bash
# Check installation and workspace health
codew doctor

# Update all managed files
codew update

# Apply Agent project directory authorization
codew permissions apply --yes

# Validate local projects
codew project verify
codew project verify <project-name>
```

Directory access is authorized by the user. Code Workspace shows the requested changes, applies and verifies them, and reports the result. `permissions apply` grants missing registered-project access without revoking additional directories. Ordinary `update` does not change authorization.

Add `--json` when a query result is consumed by Codex or a script.

## Workspace skills

Installed by default during Workspace initialization:

- `$codew-add-projects` — inspect and register local Git projects with concise AI-generated navigation context.
- `$codew-resolve-branch` — safely resolve a selected project's branch mismatch and confirm branch alignment.

| Purpose | Codex | Claude Code |
| --- | --- | --- |
| Add workspace projects | `$codew-add-projects` | `/codew:add-projects` |
| Resolve a project branch mismatch | `$codew-resolve-branch` | `/codew-resolve-branch` |
| --- | --- | --- |
| Add workspace projects | `$codew-add-projects` | `/codew:add-projects` |
| Resolve a project branch mismatch | `$codew-resolve-branch` | `/codew-resolve-branch` |
| Analyze a Jira requirement | `$zhuiyi-jira-prd-analysis` | `$zhuiyi-jira-prd-analysis` |
| Break down Jira tasks | `$zhuiyi-jira-task-breakdown` | `$zhuiyi-jira-task-breakdown` |
| Summarize an issue fix | `$zhuiyi-jira-issue-fix-summary` | `$zhuiyi-jira-issue-fix-summary` |
| Apply the Guangda coding spec | `$zhuiyi-guangda-coding-spec` | `$zhuiyi-guangda-coding-spec` |
