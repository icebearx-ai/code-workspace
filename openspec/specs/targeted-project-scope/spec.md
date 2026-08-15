# Targeted Project Scope

## Purpose

定义定向项目校验与分支命令的作用域隔离规则，确保 CLI 只检查和修改用户命名的注册项目，并避免未选项目的运行时状态或无关配置域干扰目标操作。

## Requirements

### Requirement: 定向项目校验只检查命名工程
`project verify <name>` 必须（SHALL）直接校验命名项目，不得通过先全量检查再过滤诊断来实现；除读取注册表冲突元数据外，不得对未选项目的位置执行文件系统探测、路径实化或 Git 命令。

#### Scenario: 未选项目存在运行时漂移
- **WHEN** 用户定向校验项目 A，而项目 B 的路径缺失、不可访问或分支不一致
- **THEN** CLI 只检查项目 A，结果不受项目 B 运行时状态影响，并且不访问项目 B 的位置

#### Scenario: 目标项目存在分支不一致
- **WHEN** 用户定向校验项目 A，且 A 的注册分支与实际分支不同
- **THEN** CLI 返回只关联项目 A 的 `PROJECT_BRANCH_MISMATCH`，并包含 `registeredBranch`、`actualBranch` 和目标位置，且不包含 `configuredBranch`

#### Scenario: 项目不存在
- **WHEN** 用户定向校验未注册名称
- **THEN** CLI 返回 `PROJECT_NOT_FOUND`，且不检查任何已注册工程

### Requirement: 定向校验保留目标相关的注册表冲突
定向校验必须（SHALL）基于注册表元数据检测与目标项目有关的重复名称、重复路径和嵌套路径冲突，同时不得为确认这些冲突而访问其他项目仓库。

#### Scenario: 其他记录与目标路径冲突
- **WHEN** 另一条注册记录的规范路径元数据与目标项目重复或嵌套
- **THEN** 定向校验返回包含目标项目和冲突记录名称的结构化诊断，但不检查冲突记录的 Git worktree

#### Scenario: 无关记录之间冲突
- **WHEN** 两个未选项目彼此冲突但均不涉及目标项目
- **THEN** 目标项目的定向校验不返回该冲突，也不访问这两个项目的位置

### Requirement: 定向分支命令遵守同一作用域
所有 `project branch` 命令必须（SHALL）只解析、检查和修改命名项目，不得因注册表中存在其他项目而检查或改变它们的 Git、配置字段或权限。

#### Scenario: 分支协调时其他项目不可用
- **WHEN** 用户对项目 A 执行任一分支命令，而项目 B 不可访问
- **THEN** 命令只使用项目 B 的静态注册表元数据（如确有目标冲突比较需要），不得访问项目 B 的位置，且项目 B 不阻塞项目 A 的操作

#### Scenario: 分支协调成功后的结果范围
- **WHEN** 项目 A 的分支命令成功或跳过
- **THEN** 结果数据只包含项目 A 和该操作的分支状态，不包含其他项目记录

### Requirement: 全量检查必须由用户显式请求
无名称的 `project verify` 和 Workspace 健康检查必须（SHALL）保留全量语义；定向命令不得隐式升级为全量检查。

#### Scenario: 显式运行工作区级校验
- **WHEN** 用户运行不带项目名的 `project verify`
- **THEN** CLI 检查所有已注册项目，并将结果范围标记为 `workspace`

#### Scenario: 运行定向校验
- **WHEN** 用户运行带项目名的 `project verify <name>`
- **THEN** CLI 将结果范围标记为 `project`，仅返回命名项目，并且不调用全量项目校验路径

### Requirement: 定向命令隔离无关配置域
`project verify <name>` 和三条 `project branch` 命令必须（SHALL）只加载 `projects` 配置域；语言、监控或其他配置域无效时不得阻塞目标项目操作。

#### Scenario: 无关配置域无效
- **WHEN** Workspace 的语言或监控配置无效，但 `projects` 域和目标项目有效
- **THEN** 定向校验和分支命令仍按目标项目状态执行，且不重写无关配置域
