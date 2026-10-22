---
name: codew-getting-started
description: This workspace uses Code Workspace for local multi-project management. Load at session start or when asked about projects, workspace setup, or branch status. Provides available workflow skills and project context.
---

# Code Workspace

You have Code Workspace skills available for local multi-project management.

## Available workflow skills

- `$codew-add-projects` — Inspect and register local Git projects with AI navigation context.
- `$codew-resolve-branch` — Safely resolve branch mismatches between registered and actual branches.

## Getting project context

Run this to see registered projects and their status:

```bash
codew context --json
```

## Core rules

1. **Never guess project paths.** Always use `codew project list --json` to discover registered projects.
2. **Never edit `.codew/config.yaml`** or project configuration files directly. Use registered CLI commands.
3. **Branch mismatches require user decision.** Use `$codew-resolve-branch` when `PROJECT_BRANCH_MISMATCH` is reported.
4. **Directory access is user-controlled.** Never modify Claude/Codex permission settings; use `codew permissions apply`.
