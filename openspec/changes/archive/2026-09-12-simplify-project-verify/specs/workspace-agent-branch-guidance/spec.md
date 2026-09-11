## RENAMED Requirements

- FROM: `### Requirement: 分支 Skill 只验证分支一致性并交还整体校验`
- TO: `### Requirement: 分支 Skill 只验证分支一致性并交还 Guard`

## MODIFIED Requirements

### Requirement: 分支 Skill 只验证分支一致性并交还 Guard
分支 Skill 必须（SHALL）在自动或手动处理后运行 `project branch verify <name...> --json`，且不得从 Skill 内运行整体 `project verify`。Skill 的完成只表示分支协调完成且分支一致性已验证；Workspace Guard 必须（SHALL）在 Skill 交还控制后直接进入 `project branch update-latest`，不得再运行一次整体 `project verify`。如果 update-latest 返回 `PROJECT_BRANCH_MISMATCH`，Guard 可以基于新的 CLI 观察结果重新进入分支 Skill。

#### Scenario: 批量复验部分失败
- **WHEN** 多项目分支一致性验证中部分项目成功、部分项目失败
- **THEN** Skill 将成功项目交还 Guard，保持失败项目为分支未解决状态，并在全部结果产生后统一汇报

#### Scenario: 目标项目复验成功
- **WHEN** 分支处理完成且目标项目的 `project branch verify` 返回 `ok: true`
- **THEN** Skill 报告该项目分支协调已完成，并将项目交还 Workspace Guard 直接执行最新版本准备

#### Scenario: 目标项目复验失败
- **WHEN** 分支一致性复验仍返回分支不一致或检查错误
- **THEN** Skill 保持目标项目为未解决状态，报告诊断且不检查其他项目

#### Scenario: 最新版本准备前再次发生分支漂移
- **WHEN** Skill 已成功验证分支一致性，但随后运行的 `project branch update-latest` 返回 `PROJECT_BRANCH_MISMATCH`
- **THEN** Guard 保持该项目暂停，并可以以新的 CLI 观察结果重新进入分支 Skill

### Requirement: Workspace Guard 在项目工作前完成最新版本准备
Workspace Guard SHALL 在目标项目开始读取或修改代码前，先运行一次定向 `project verify`，在报告 `PROJECT_BRANCH_MISMATCH` 时完成分支协调，然后对成功项目运行 `project branch update-latest`。Guard SHALL NOT 在分支 Skill 交还后或 update-latest 成功之后重新运行整体 `project verify`；update-latest 是项目工作前的最终状态门。

#### Scenario: 分支已经一致
- **WHEN** 入口定向 `project verify` 报告目标项目分支一致
- **THEN** Guard 仍调用 `project branch update-latest`，因为项目本地 HEAD 可能落后于 upstream

#### Scenario: 分支存在不一致
- **WHEN** 入口定向 `project verify` 报告 `PROJECT_BRANCH_MISMATCH`
- **THEN** Guard 调用 `code-workspace-resolve-branch` Skill；Skill 完成 `project branch verify` 后由 Guard 直接调用 `project branch update-latest`

#### Scenario: 入口存在非分支项目问题
- **WHEN** 入口定向 `project verify` 因非分支问题失败
- **THEN** Guard 暂停该项目并报告项目级诊断，不进入 update-latest

#### Scenario: 最新版本更新失败
- **WHEN** `project branch update-latest` 对目标项目返回失败
- **THEN** Guard 暂停该项目，不开始项目工作，并报告项目归属的稳定诊断；不得自行执行 fetch、pull、reset、stash 或编辑配置

#### Scenario: 最新版本更新完成
- **WHEN** `project branch update-latest` 对目标项目返回 `fastForwarded: true`
- **THEN** Guard 丢弃更新前读取的项目上下文，要求 Agent 重新读取项目文件和指令，并在不重新运行整体 `project verify` 的情况下允许继续项目工作

#### Scenario: 最新版本已经最新或已禁用
- **WHEN** `project branch update-latest` 返回 `disabled` 或 `already-latest`
- **THEN** Guard 保留现有项目上下文并允许继续项目工作，不重新运行整体 `project verify`
