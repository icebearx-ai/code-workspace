## Why

在多项目工作区中，项目可能仍处于注册分支，但本地提交已经落后于该分支的 upstream。当前分支协调能力只解决分支名称一致性，无法消除这种代码版本漂移，导致 Agent 开始工作前仍可能使用过期代码。

## What Changes

- 为项目配置增加可选的 `projects[].updateLatest` 布尔策略；缺失等同于 `false`。
- 新增 `project branch update-latest <name...>`，仅对显式启用的项目执行安全的 upstream fetch 和 fast-forward 更新。
- 要求工作树干净、当前分支等于注册分支且存在 upstream；不执行 reset、stash、rebase、merge commit 或自动冲突处理。
- 在 Workspace Guard 完成分支协调后、项目工作开始前执行最新分支更新，并覆盖分支本来已经一致的场景。
- 保持 `project add`、项目注册生命周期命令和 `project verify` 的既有语义，不增加 `project branch configure` 或其他专用配置写入命令。
- 明确用户可以手动编辑 `.code-workspace/config.yaml`；AI/Agent 不得直接编辑该文件，应遵循已有 CLI 边界。

## Capabilities

### New Capabilities

- `project-latest-branch-update`: 管理 `updateLatest` 策略及安全的最新 upstream fast-forward 更新。

### Modified Capabilities

- `project-branch-reconciliation`: 增加分支域的 `update-latest` 外部效果命令，同时保持既有分支协调命令合同不变。
- `workspace-agent-branch-guidance`: 要求 Guard 在分支协调完成后调用最新分支更新，并在更新后重新验证目标项目。

## Impact

- 影响项目配置投影与项目字段校验。
- 新增 Git 状态读取、upstream fetch、fast-forward 及后置验证服务。
- 新增 CLI 注册、批量结果、稳定错误码和失败效果报告。
- 更新 Workspace Guard、中文/英文 README、流程文档及测试；不修改 `code-workspace-resolve-branch` Skill。
