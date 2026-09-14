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

Review the project records and confirm once. The add-projects skill uses one read-only collection to inspect every path independently; a failed project reports its diagnostic without stopping the remaining paths or being silently ignored. After confirmation, all valid records are sent to `project add` through stdin in one operation, with no temporary JSON file and no default second verify.

## Upgrade Code Workspace

Upgrade the global package, update the current workspace's managed files, then verify health:

```bash
npm install -g @icebearx-ai/code-workspace@latest
codew update
codew doctor
```

`update` refreshes managed instructions, Workspace skills, hooks, and this guide. It stops if a managed file contains unknown local changes. Review the file first; use `--force` only when replacing those changes is intentional.

## Workspace language

Choose the Workspace language during initialization, or pass it explicitly:

```bash
codew init --language en-US
codew language
```

The selected preference is stored at `workspace.language` in `.code-workspace/config.yaml`. Change an initialized workspace with:

```bash
codew update --language en-US
```

This also switches this managed guide. Existing project context is not translated.

## Use the Agent monitor

Monitoring ships as the built-in `monitor` extension. Install it in a workspace and start one global monitor for all workspaces:

```bash
codew extension install monitor --yes
codew ext monitor
```

Open the printed local URL. The dashboard shows workspaces, execution state, pending approvals, completed turns, and live signals. Monitor language is selected on the page and is independent of `workspace.language`.

Use another port when necessary:

```bash
codew ext monitor serve --port 8080
```

The extension reports to the URL recorded in `.code-workspace/monitor-reporting.json`. After installation, review and trust the project hooks with `/hooks` in Codex.

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

- `$code-workspace-add-projects` — inspect and register local Git projects with concise AI-generated navigation context.
- `$code-workspace-resolve-branch` — safely resolve a selected project's branch mismatch and confirm branch alignment.

The following skills are distributed as independent extensions. They are not installed by `init` or `update`; install or uninstall each one explicitly. The interactive extension picker starts with no extensions selected, and each choice shows the extension name and a short description:

```bash
codew extension install code-workspace-jira-prd-analysis --yes
codew extension install code-workspace-jira-task-breakdown --yes
codew extension install code-workspace-issue-fix-summary --yes
codew extension uninstall code-workspace-jira-prd-analysis --yes
```

- `$code-workspace-jira-prd-analysis` — confirm Jira scope, then analyze requirement clarity, consistency, and code feasibility.
- `$code-workspace-jira-task-breakdown` — split a confirmed Jira requirement into executable frontend, backend, and test tasks.
- `$code-workspace-issue-fix-summary` — summarize a completed fix and, after confirmation, publish it as a Jira comment.

These extensions install skill instructions only. Install the `zhuiyi-jira-mcp` extension separately when Jira access is required.

| Purpose | Codex | Claude Code |
| --- | --- | --- |
| Add workspace projects | `$code-workspace-add-projects` | `/code-workspace:add-projects` |
| Resolve a project branch mismatch | `$code-workspace-resolve-branch` | `/code-workspace-resolve-branch` |
| Analyze a Jira requirement | `$code-workspace-jira-prd-analysis` | `$code-workspace-jira-prd-analysis` |
| Break down Jira tasks | `$code-workspace-jira-task-breakdown` | `$code-workspace-jira-task-breakdown` |
| Summarize an issue fix | `$code-workspace-issue-fix-summary` | `$code-workspace-issue-fix-summary` |
