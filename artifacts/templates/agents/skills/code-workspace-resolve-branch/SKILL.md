---
name: code-workspace-resolve-branch
description: Resolve `PROJECT_BRANCH_MISMATCH` for one or more already selected Code Workspace projects before project work. Use this Skill whenever targeted verification reports registered/actual branch mismatches; it gathers canonical facts, can combine several mismatches into one concise choice, delegates every automatic direction to the CLI, and verifies branch alignment without taking ownership of overall project health.
---

# Resolve Workspace Project Branches

Resolve only the already selected registered project or projects. This Skill owns branch reconciliation only; Workspace Guard decides whether project work can resume after overall project verification.

## Inspect canonical facts

Run one command from the Workspace for all selected projects whose targeted verification reported `PROJECT_BRANCH_MISMATCH`. Pass each project name as a separate argument; do not join names with commas:

```bash
code-w project branch inspect "<project-a>" "<project-b>" --json
```

For one project, require the existing standard envelope whose `data` contains all of: `project.name`, `project.location`, `registeredBranch`, `actualBranch`, `matches`, `worktreeClean`, and `registeredBranchExists`. For several projects, read the ordered `data.results`; each successful result contains those facts in its `data`, while failed results are explained by the top-level diagnostics. Do not infer or independently inspect missing values.

Keep failed inspections paused and exclude them from the choice, but continue with every project whose canonical facts were returned. If no project was inspected successfully, report the collected diagnostics and stop.

If `matches` is already true, omit that project from the choice and proceed to branch-alignment verification. Do not inspect or include projects outside the already selected scope.

## Present one concise choice

Explain the mismatch and ask the user to choose a direction. The examples below demonstrate the useful information and interaction shape; they are guidance, not required wording or a script to reproduce exactly. Do not recommend a default direction.

Keep the presentation compact:

- Always show the project name, registered branch, actual branch, and the three directions.
- Add a short annotation to the registered branch only when `registeredBranchExists` is false.
- Add a short annotation to the actual branch only when `worktreeClean` is false.
- Omit normal-state annotations such as "available" or "clean".
- Choice 1 is available only when both `registeredBranchExists` and `worktreeClean` are true. Choices 2 and 3 remain available.
- When choice 1 is unavailable, state every applicable reason. Do not suggest stashing, resetting, creating, or fetching a branch.

Single-project example:

```text
检测到项目 `api` 分支不一致，项目工作已暂停。

注册分支：main（本地不存在）
实际分支：feature/login（有代码未提交）

请选择：
1. 使用注册分支
2. 接受实际分支
3. 手动处理

回复 1、2 或 3

注意：选项 1 当前不可用，因为注册分支本地不存在，且工作区有未提交代码。
```

When two or more selected projects have mismatches, ask once and assign stable labels `A`, `B`, `C`, and so on in presentation order. A bare `1`, `2`, or `3` applies that direction to every listed project. A labelled reply such as `A1, B2` assigns directions per project. Accept unambiguous natural separators rather than requiring one exact reply format.

Multi-project example:

```text
检测到项目 `api`、`server` 分支不一致，项目工作已暂停。

项目 A：api
注册分支：main（本地不存在）
实际分支：feature/login

项目 B：server
注册分支：main
实际分支：feature/order（有代码未提交）

请选择：
1. 使用注册分支
2. 接受实际分支
3. 手动处理

回复 1、2 或 3，或者分别回复 A2、B1。

注意：
A1 不可选，因为项目 A 的注册分支本地不存在，需要手动处理或接受实际分支。
B1 不可选，因为项目 B 有未提交代码，无法安全切换分支。
```

Do not mutate Git or Workspace state until the submitted choices are valid and complete for every listed project. Preserve valid pending choices while asking again only for projects whose choice is missing or unavailable. If the user insists on an unavailable choice such as `A1`, explain the applicable canonical reason and ask again for that project; never silently substitute another direction.

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

Hand successful projects back to Workspace Guard for overall targeted `project verify`. Unrelated project-health failures discovered there do not reopen or fail this Skill; they remain Guard-owned issues. If the Guard observes a new `PROJECT_BRANCH_MISMATCH` caused by later drift, it may invoke this Skill again. Do not run `project list` or any `project verify` inside this Skill, and do not inspect any registered project outside the selected scope.
