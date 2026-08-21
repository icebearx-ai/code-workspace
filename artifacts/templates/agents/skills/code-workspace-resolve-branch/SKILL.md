---
name: code-workspace-resolve-branch
description: Resolve `PROJECT_BRANCH_MISMATCH` for one or more already selected Code Workspace projects before project work. Use this Skill whenever targeted verification reports registered/actual branch mismatches; it gathers canonical facts, presents a deterministic structured choice, delegates every automatic direction to the branch CLI, and verifies branch alignment.
---

# Resolve Workspace Project Branches

Resolve only the already selected registered project or projects. This Skill owns branch reconciliation only; Workspace Guard decides whether project work can resume.

## Inspect canonical facts

Run one command from the Workspace for all selected projects whose targeted verification reported `PROJECT_BRANCH_MISMATCH`. Pass each project name as a separate argument; do not join names with commas:

```bash
code-w project branch inspect "<project-a>" "<project-b>" --json
```

For one project, require the existing standard envelope whose `data` contains all of: `project.name`, `project.location`, `registeredBranch`, `actualBranch`, `matches`, `worktreeClean`, and `registeredBranchExists`. For several projects, read the ordered `data.results`; each successful result contains those facts in its `data`, while failed results are explained by the top-level diagnostics. Do not infer or independently inspect missing values.

Keep failed inspections paused and exclude them from the choice, but continue with every project whose canonical facts were returned. If no project was inspected successfully, report the collected diagnostics and stop.

If `matches` is already true, omit that project from the choice and proceed to branch-alignment verification. Do not inspect or include projects outside the already selected scope.

## Keep the ASK structure stable

Different models may choose different wording, but preserve the following presentation shape so users can scan the same information consistently:

```text
[mismatch introduction and request for a decision]

[multi-project only: A:] [project name]
[registered-branch label]: [registered branch][optional annotation when the branch is missing locally]
[actual-branch label]: [actual branch][optional annotation when the worktree is unclean]

[multi-project only: B:] [project name]
[registered-branch label]: [registered branch][optional annotation]
[actual-branch label]: [actual branch][optional annotation]

[continue in inspection order, with one blank line between project blocks]

[choice prompt; for one project, state that only available choices are shown]
1. [use the registered branch]
2. [accept the actual branch]
3. [handle manually without an automatic Git operation]

[request a decision for each project]

[multi-project only: reply-format heading]
[explain that one number applies to every project, while labelled selections such as A1 B2 C3 apply per project]
[explain that labels are case-insensitive and commas, spaces, or line breaks are accepted as separators]

[multi-project only, and only when a choice is unavailable: important-notes heading]
[project label]: choice 1 is unavailable — [one canonical reason]
[one line for each additional project/reason]

[multi-project only: explain that an unavailable selection is re-asked only for that project, valid selections are retained, and no state changes occur until every selection is valid and complete]
```

Ask rules:

- Replace the bracketed instructions with user-facing text without exposing them. Keep inspection order, three non-bulleted lines per project, blank lines between projects, and only the two abnormal annotations shown in the template.
- Choice 1 is available only when the registered branch exists locally and the worktree is clean. Choices 2 and 3 remain available. Do not recommend a default or invent another recovery direction.
- For one project, omit everything marked multi-project only, state that only available choices are shown, and preserve the semantic numbers of those choices.
- For several projects, keep stable letter labels and all three choices. Include every applicable unavailable reason, with one project and one reason per line.
- Accept either one bare number for every project or labelled selections, never both. In labelled mode, accept partial replies, but treat unknown labels or options and duplicate or conflicting labels as invalid. Retain other valid selections and re-ask only for missing, unavailable, or invalid projects.
- Do not mutate state until all choices are valid and complete. If an ASK control cannot preserve the template, use a normal user-facing question.

## Apply valid choices through the CLI

- Group every project that selected choice 1 into one `code-w project branch use-registered "<project-a>" "<project-b>" --yes --json` invocation. Include only projects for which choice 1 is available.
- Group every project that selected choice 2 into one `code-w project branch accept-actual "<project-a>" "<project-b>" --yes --json` invocation.
- For choice 3, keep that project paused until the user confirms manual resolution is complete. Do not reuse any pre-resolution branch facts.

After all choices are valid and complete, run each non-empty automatic direction group once. A batch command can return `ok: false` after still completing other projects, so inspect its ordered results instead of treating the whole group as unprocessed. Continue with the other automatic direction group even when the first group contains failures. Do not fall back to direct Git commands, direct Workspace configuration editing, or an improvised recovery direction.

## Verify branch alignment in one targeted batch

After both automatic direction groups finish, collect projects whose operations succeeded or skipped together with projects that were already matching during inspection, discard their cached branch-dependent context, and run one branch-only verification. After the user confirms one or more manual resolutions, verify those confirmed projects the same way:

```bash
code-w project branch verify "<project-a>" "<project-b>" --json
```

Use each result independently. A successful result means branch reconciliation is complete and branch alignment has been verified for that project; a failed result remains unresolved. Complete all independent automatic operations and branch verification before giving one consolidated report of inspected failures, successful changes, skips, branch-verification failures, and projects awaiting manual handling.

Hand successful projects back to Workspace Guard. Later non-branch project issues do not reopen or fail this Skill. If later branch drift is observed, the Guard may invoke this Skill again. Do not inspect any registered project outside the selected scope.
