## MODIFIED Requirements

### Requirement: Workspace Guard 明确定义分支角色
内置 Workspace Guard MUST 说明 Workspace 根目录是多项目控制平面而不是生产项目，注册分支是目标项目的期望状态，实际分支是目标 Git worktree 的观测状态；不得将注册表描述为实际 Git 分支的唯一事实来源。Guard MUST 作为 CLI 内置托管资产发布，不得依赖扩展状态。

#### Scenario: Agent 读取 Workspace 根指令
- **WHEN** Claude Code 或 Codex 加载生成的 Workspace Guard
- **THEN** 两个平台获得相同的 Workspace、注册项目、注册分支、实际分支、CLI、Agent 和用户决策职责定义

#### Scenario: 检测到分支不一致
- **WHEN** 注册分支与实际分支不同
- **THEN** Guard 要求 Agent 停止项目工作并调用内置分支处理 Skill，而不是自行选择某一侧作为权威

#### Scenario: Doctor 检查内置 Guard
- **WHEN** Workspace 选中的工具缺少或无法识别内置 Guard 输出
- **THEN** Doctor 返回托管文件诊断，而不是扩展安装诊断

### Requirement: 分支 Skill 只验证分支一致性并交还 Guard
内置分支 Skill MUST 在自动或手动处理后运行 `project branch verify <name...> --json`，且不得从 Skill 内运行整体 `project verify`。Skill 的完成只表示分支协调完成且分支一致性已验证；Workspace Guard MUST 在 Skill 交还控制后直接进入 `project branch update-latest`，不得再运行一次整体 `project verify`。如果 update-latest 返回 `PROJECT_BRANCH_MISMATCH`，Guard 可以基于新的 CLI 观察结果重新进入分支 Skill。

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
