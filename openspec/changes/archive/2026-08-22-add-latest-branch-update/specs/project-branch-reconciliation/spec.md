## ADDED Requirements

### Requirement: 分支域提供独立的最新版本更新命令

分支域 SHALL 提供 `project branch update-latest <name...>` 作为代码版本更新的唯一自动入口。现有 `project branch inspect`、`verify`、`accept-actual` 和 `use-registered` 的既有语义 SHALL 保持不变；其中 `use-registered` SHALL 不隐式执行 fetch、pull 或 reset。

#### Scenario: 只调用最新版本更新命令
- **WHEN** 用户或 Workspace Guard 需要根据 `updateLatest` 更新项目代码
- **THEN** 调用 `project branch update-latest`，而不是向现有分支方向命令添加隐式网络或 reset 效果

#### Scenario: 现有分支命令保持兼容
- **WHEN** 用户调用已有四条 `project branch` 命令
- **THEN** 命令的参数、结果合同和 Git 效果不因最新版本更新能力而改变

### Requirement: AI/Agent 不得直接编辑 Workspace 配置

托管的 Agent 指令 SHALL 明确：用户可以手动编辑 `.code-workspace/config.yaml` 并对结果负责；AI/Agent 不得直接写入、重写、删除或通过脚本绕过 CLI 修改该文件。`updateLatest` 作为用户维护的策略字段 SHALL 由 Agent 只读并遵循。

#### Scenario: 用户需要开启 updateLatest
- **WHEN** 用户希望某个项目自动更新最新分支
- **THEN** Agent 可以说明应在目标项目记录中手动设置 `updateLatest: true`，但不得代替用户编辑配置文件

#### Scenario: Agent 执行已配置策略
- **WHEN** 目标项目已有 `updateLatest: true`
- **THEN** Agent 可以调用 `project branch update-latest` 执行 Git 更新，但不得修改配置策略
