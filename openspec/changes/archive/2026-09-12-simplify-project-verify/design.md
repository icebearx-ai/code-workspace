## Context

Workspace Guard 当前在两个位置重复运行定向 `project verify`：分支处理 Skill 交还后一次，以及 `project branch update-latest` 成功后一次。单项目 `project verify` 还会同时返回 `data.project` 和 `data.projects: [project]`。这两处重复都增加了命令调用、输出体积和模型上下文，但没有引入新的验证事实。

`project branch update-latest` 已经检查注册分支与实际分支一致、worktree 干净、upstream 存在、目标 HEAD 可 fast-forward，并验证更新后的分支、worktree 和 HEAD。`project verify` 只检查配置字段、路径和分支一致性，因此它对 update-latest 后置条件没有独立的补充作用。

## Goals / Non-Goals

**Goals:**

- 让 Workspace Guard 只保留入口处一次定向 `project verify`。
- 让 `project branch update-latest` 成为项目工作前的最终状态门。
- 删除单项目 `project verify` 的 `data.projects` 冗余字段，保留 `data.project`。
- 保持全量校验和多项目 selection 结果合同不变。
- 同步更新规范、模板、文档、测试和托管指纹。

**Non-Goals:**

- 不新增命令或选项。
- 不改变 `project branch verify`、`project branch inspect` 或 `project branch update-latest` 的验证与 Git 行为。
- 不修改配置结构、错误码、确认策略或事务边界。
- 不尝试自动重新加载 Agent 已缓存的项目指令；Guard 只负责要求 Agent 在 fast-forward 后重新读取。

## Decisions

### 1. update-latest 作为最终状态门

分支处理 Skill 成功后，Guard 不再运行整体 `project verify`，而是直接对成功项目运行 `project branch update-latest`。如果 update-latest 返回 `PROJECT_BRANCH_MISMATCH`，说明分支在交还后再次漂移，Guard 重新进入分支处理 Skill；其他失败暂停项目。

理由是 update-latest 会在 plan 和 apply 阶段重新检查分支一致性与 worktree 状态，覆盖 Guard 中间校验在当时能够发现的状态问题，同时避免多一次命令。

### 2. fast-forward 后只刷新上下文，不再次 verify

当 update-latest 的单个项目结果为 `fastForwarded: true` 时，Guard 丢弃 update 前读取的项目内容，重新读取项目文件、指令和后续工作所需上下文。`disabled` 或 `already-latest` 时 worktree 没有变化，继续工作。

不运行第二次 `project verify`，因为该命令无法验证项目代码、构建或指令内容，不能实现“刷新上下文”的语义。

### 3. 单项目 verify 保留 project，删除 projects

三条范围合同调整为：

```text
scope: workspace  -> data.projects
scope: project    -> data.project
scope: selection  -> data.results
```

单项目调用已经通过 `scope: "project"` 明确表达范围，`data.project` 是唯一项目对象；`data.projects` 没有任何额外语义，只重复完整对象和大段 `context`。

这是有意的破坏性数据合同变更，但项目仍处于 `0.1.0-beta.x`。本次不提升全局 envelope `schemaVersion`，避免影响所有其他命令；调用方需将 `data.projects[0]` 迁移为 `data.project`。

### 4. 测试直接约束字段存在与缺失

单项目 verify 测试同时断言 `data.project.name` 存在且 `data` 不包含 `projects`。Guard 测试断言模板不再要求在 Skill 交还后或 update-latest 后重新运行 `project verify`，并验证 fast-forward 后必须刷新上下文。

## Risks / Trade-offs

- **外部脚本依赖 `data.projects[0]`** → 这是有意的破坏性变更；在提案、规范和文档中明确迁移到 `data.project`，测试锁定新合同。
- **删除第二次 verify 后减少一个兜底检查** → update-latest 的 plan/apply 前置条件和后置验证继续覆盖分支与 worktree；若需要代码级健康检查，应由项目自身的测试或构建承担。
- **`updateLatest: false` 项目不会被 update-latest 检查分支** → 入口 `project verify` 仍负责首个状态门；项目工作开始前不接受后续无原因的分支漂移，Guard 不额外增加整体校验。
- **托管模板变更造成指纹失配** → 同步重新计算 `artifacts/manifest.json` 中 `WORKSPACE_GUARD.md.template` 的 SHA-256。

## Migration Plan

1. 先更新 CLI，使单项目 `project verify` 返回精简结构。
2. 同步更新 Guard 模板和生成的 `AGENTS.md` / `CLAUDE.md`。
3. 外部调用方将单项目读取从 `data.projects[0]` 改为 `data.project`。
4. 回退时可恢复旧 CLI 与旧托管模板；项目配置和 Git 状态无需迁移。

## Open Questions

无。
