## ADDED Requirements

### Requirement: Workspace Guard 在项目工作前完成最新版本准备

Workspace Guard SHALL 在目标项目开始读取或修改代码前，先完成分支协调（如有需要）、分支一致性验证和 `project branch update-latest`。分支 Skill SHALL 只负责分支协调与分支验证，不得执行最新版本更新。

#### Scenario: 分支已经一致
- **WHEN** 定向 `project verify` 报告目标项目分支一致
- **THEN** Guard 仍调用 `project branch update-latest`，因为项目本地 HEAD 可能落后于 upstream

#### Scenario: 分支存在不一致
- **WHEN** 定向 `project verify` 报告 `PROJECT_BRANCH_MISMATCH`
- **THEN** Guard 调用 `code-workspace-resolve-branch` Skill；Skill 完成 `project branch verify` 后将控制权交还 Guard，由 Guard 再调用 `project branch update-latest`

#### Scenario: 最新版本更新失败
- **WHEN** `project branch update-latest` 对目标项目返回失败
- **THEN** Guard 暂停该项目，不开始项目工作，并报告项目归属的稳定诊断；不得自行执行 fetch、pull、reset、stash 或编辑配置

#### Scenario: 最新版本更新完成
- **WHEN** `project branch update-latest` 成功或以 disabled/already-latest skip
- **THEN** Guard 丢弃更新前读取的项目上下文，重新运行目标项目验证，然后才允许继续项目工作
