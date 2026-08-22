## Context

当前项目注册表只保存注册分支，现有 `project branch` 命令可以解决注册分支与实际分支不一致，但不会判断本地分支是否落后于 upstream。多项目场景中，即使分支名称一致，Agent 仍可能读取到过期代码。

现有 CLI 已将项目注册生命周期和分支协调分开：`project` 负责注册表，`project branch` 负责分支状态与 Git 外部效果。分支协调命令要求明确的用户方向，且不会自动 fetch/reset。新的能力必须保留这一边界。

## Goals / Non-Goals

**Goals:**

- 支持项目级可选布尔策略 `projects[].updateLatest`，缺失等同于 `false`。
- 提供 `project branch update-latest <name...>`，仅对显式启用项目进行安全的 upstream fast-forward。
- 在工作树脏、无 upstream、无法 fast-forward、Git 网络失败或状态漂移时停止并返回结构化诊断。
- 支持单项目和多项目 best-effort 结果，验证每个项目的最终状态。
- 让 Workspace Guard 在项目开始工作前、分支协调完成后调用该命令。
- 保持用户可以手动编辑配置，但禁止 AI/Agent 直接编辑配置文件的治理边界。

**Non-Goals:**

- 不修改 `project add`、`project remove`、`project verify` 的语义或参数。
- 不新增 `project update` 或 `project branch configure`。
- 不支持固定 commit/tag、detached HEAD 或 submodule 更新。
- 不执行 reset、stash、rebase、非 fast-forward merge、冲突解决或分支创建。
- 不让 `project branch use-registered` 隐式执行网络更新。

## Decisions

### 1. 使用独立的 `project branch update-latest` 命令

更新代码版本是分支域的外部效果，但不是分支方向选择。独立命令可以保持现有 `inspect/verify/accept-actual/use-registered` 合同稳定，也能覆盖“分支本来就一致”的场景；如果把更新放进 resolve-branch Skill，则该 Skill 在分支一致时不会被调用，而且会同时承担用户选择、网络操作和版本验证。

### 2. 配置字段只读、不提供专用配置 CLI

`updateLatest` 是用户负责的策略配置。用户可以手动编辑 `.code-workspace/config.yaml`，AI/Agent 不得直接编辑该文件；本变更只读取和校验字段，不增加配置命令，也不扩展 `project add`。这样避免为一个布尔项引入额外的写配置事务和交互阻塞。

### 3. 只允许 upstream fast-forward

命令解析当前分支的 Git upstream，fetch 该 upstream，然后以 `git merge --ff-only <targetHead>` 更新。普通 `git pull` 可能产生 merge commit；reset/stash/rebase 会产生破坏性或隐式恢复效果，均不符合克制范围。

### 4. 以本次 fetch 的 upstream HEAD 作为目标快照

fetch 成功后读取一次 target HEAD。若当前 HEAD 已等于 target HEAD，返回 `already-latest`；否则先检查 current HEAD 是否为 target HEAD 的祖先，再执行 fast-forward。这样不会因远端在操作期间继续变化而无限追赶。

### 5. 无自动回滚 reset，报告保留外部效果

Git 外部效果不能纳入 Workspace 文件事务。如果 fast-forward 后置验证失败，不执行 reset 作为补偿，而是返回 `PROJECT_BRANCH_UPDATE_VERIFY_FAILED`，包含 before/target/after HEAD、当前分支和人工恢复建议。批量操作按项目隔离，已成功的项目不因其他项目失败而回滚。

### 6. Guard 编排，resolve-branch Skill 只做分支协调

Guard 流程为：定向 `project verify` → 必要时运行 resolve-branch Skill → `project branch verify` → `project branch update-latest` → 最终 `project verify`。resolve-branch Skill 保持现有分支协调职责不变；Guard 负责在其完成后调用 update-latest，不读取或修改配置策略。

### 7. Git 状态读取与写入放在独立 core 服务

新增 `src/core/project-branch-update.js` 封装 upstream 解析、fetch、祖先判断、fast-forward 和后置验证；新增 CLI 命令模块只负责编排、批量结果和诊断。这样避免继续扩大现有 `src/core/project.js` 和 `src/cli/commands/project-branch.js` 的职责。

## Risks / Trade-offs

- **远端认证、网络或代理失败** → 返回稳定的 fetch 错误；不改变本地 Git 状态。
- **本地领先或分叉** → `merge-base --is-ancestor` 失败，拒绝更新并给出人工处理建议。
- **fast-forward 已发生但验证失败** → 不执行 reset，报告 retained external effect 和当前 HEAD。
- **配置无法通过 CLI 设置** → 文档明确用户可手动设置；AI/Agent 只能提示用户，不得直接写入。
- **多项目部分成功** → 每个项目独立执行和汇总，不做跨仓库原子回滚。
- **运行时间增加** → 只有 `updateLatest: true` 项目才 fetch；false/缺失项目在读取配置后立即 skip。

## Migration Plan

1. 部署后，现有项目缺失 `updateLatest`，行为保持不变。
2. 用户需要时手动为指定项目增加 `updateLatest: true`。
3. 更新 Workspace 托管 Guard，使其在目标项目开始工作前执行 `update-latest`。
4. 若新命令或 Git 远端不可用，项目保持暂停，用户可将配置改回 `false` 或手动处理后重试。

## Open Questions

- 是否将未跟踪文件视为 dirty worktree：建议沿用现有 `git status --porcelain` 语义，视为不干净。
- 是否需要为 fetch 设置独立于现有 5 秒 Git 检查的网络超时：实现时应为网络命令提供更长且可配置的超时，避免沿用过短的通用检查超时。
