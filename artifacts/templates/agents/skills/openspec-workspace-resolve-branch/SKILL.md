---
name: openspec-workspace-resolve-branch
description: Resolve an OpenSpec Workspace `PROJECT_BRANCH_MISMATCH` safely. Use when targeted project verification shows that a registered project's configured branch differs from the Git worktree branch, before reading or modifying project code.
---

# Resolve a Workspace Project Branch

Resolve only the named registered project. Do not continue project work while the mismatch exists.

## Inspect

1. Run `openspec-w project show "<project.name>" --json` and retain its registered `location` and `branch`.
2. In `project.location`, inspect the current branch with `git branch --show-current`, worktree changes with `git status --short`, and whether the registered branch exists with `git show-ref --verify --quiet "refs/heads/<registered-branch>"`.
3. Report the project name, location, registered branch, actual branch, worktree status, and registered-branch existence. Do not infer missing values.

## Ask for One Explicit Choice

Offer exactly these choices:

1. Use the registered branch.
2. Accept the actual current branch in the workspace registry.
3. Resolve the mismatch manually and continue afterward.

Do not mutate Git or workspace state until the user explicitly chooses an option.

## Apply the Choice

### Use the registered branch

- Proceed only when the worktree is clean and the registered local branch already exists.
- Ask the user to handle the mismatch manually if switching could overwrite data, requires stashing, creates a branch, or has any ambiguous effect.
- After explicit authorization, run `git switch "<registered-branch>"` inside `project.location`.
- Never create a branch automatically.

### Accept the actual branch

- Do not edit `.openspec-workspace/config.yaml` directly.
- After explicit authorization, run `openspec-w project sync-branch "<project.name>" --yes --json` from the workspace.
- Treat a non-success result as unresolved and stop.

### Manual resolution

- Pause until the user confirms that branch or registry state is corrected.
- Do not reuse project information captured before the correction.

## Reverify

After any option completes, invalidate cached branch-dependent context, then run:

```bash
openspec-w project list --json
openspec-w project verify "<project.name>" --json
```

Resume project work only when targeted verification returns `ok: true`.
