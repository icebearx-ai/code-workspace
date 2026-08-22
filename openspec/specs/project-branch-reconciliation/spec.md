# Project Branch Reconciliation

## Purpose

定义 Code Workspace CLI 对注册分支与目标 Git worktree 实际分支进行检查、协调、验证和失败补偿的稳定合同。

## Requirements

### Requirement: 分支合同统一为 registeredBranch 和 actualBranch
CLI 必须（SHALL）在实现其他分支协调能力前，将所有分支比较、公共诊断、计划和结果统一为 `registeredBranch`（Code Workspace 期望状态）与 `actualBranch`（目标 Git worktree 观测状态）。现有持久化键 `projects[].branch` 必须（SHALL）继续保存注册分支，并在进入分支领域状态时映射为 `registeredBranch`；不得以 `configuredBranch`、`previousBranch`、`expectedBranch`、`requestedBranch` 或 `savedBranch` 表示新的公共分支合同。

#### Scenario: 现有分支不一致诊断使用规范字段
- **WHEN** `project verify <name>` 返回 `PROJECT_BRANCH_MISMATCH`
- **THEN** 诊断详情包含 `registeredBranch`、`actualBranch` 和 `location`，且不包含 `configuredBranch`

#### Scenario: 状态前后变化使用统一容器
- **WHEN** 分支操作需要返回操作前后状态
- **THEN** 结果使用 `before` 和 `after` 状态对象，且每个状态对象只以 `registeredBranch`、`actualBranch` 表达两侧分支

#### Scenario: 并发或后置验证失败
- **WHEN** 分支计划因状态漂移或后置验证失败
- **THEN** 诊断使用 `expectedState` 和 `observedState`，且两个状态对象只以 `registeredBranch`、`actualBranch` 表达分支，不返回旧分支字段

#### Scenario: 持久化配置保持兼容
- **WHEN** CLI 读取或写入项目记录
- **THEN** 配置仍使用 `projects[].branch` 持久化注册分支，不要求配置 schema 迁移，公共分支状态将该值表达为 `registeredBranch`

#### Scenario: 检查不一致的目标项目
- **WHEN** 用户运行 `code-w project branch inspect <name> --json`，且目标项目的注册分支与实际分支不同
- **THEN** 命令成功返回目标项目名称、位置、`registeredBranch`、`actualBranch`、`matches: false`、`worktreeClean` 和 `registeredBranchExists`

#### Scenario: 检查已经一致的目标项目
- **WHEN** 用户运行分支状态检查，且注册分支与实际分支相同
- **THEN** 命令返回 `matches: true`，且不写入 Workspace 或项目状态

### Requirement: 注册表可以显式接受实际分支
CLI 必须（SHALL）提供 `project branch accept-actual <name>`，以目标项目的实际分支更新该项目的注册分支，并且必须（SHALL）将其声明为需要确认的 `planned-write` 命令，只加载 `projects` 配置域。

#### Scenario: 未确认的非交互调用
- **WHEN** 用户以 JSON 或非 TTY 方式运行 `project branch accept-actual <name>` 且未提供 `--yes`
- **THEN** 命令返回 `CLI_CONFIRMATION_REQUIRED`，并且不修改配置或 Git worktree

#### Scenario: 接受实际分支成功
- **WHEN** 用户确认将注册分支从当前值更新为检查到的实际分支，且计划在应用和验证期间保持有效
- **THEN** CLI 只更新命名项目的注册分支，验证持久化值和实际分支仍等于计划值，并返回方向明确的成功数据

#### Scenario: 注册分支已经等于实际分支
- **WHEN** 用户运行 `project branch accept-actual <name>`，且两个分支已经一致
- **THEN** 命令以 `skip` 成功返回，不要求确认且不写入配置

#### Scenario: 计划期间发生状态漂移
- **WHEN** 注册分支或实际分支在计划后、提交验证前发生变化
- **THEN** 命令返回稳定的冲突或验证失败诊断，回滚本命令的 Workspace 文件写入，并且不修改其他配置域

### Requirement: 项目可以安全使用注册分支
CLI 必须（SHALL）提供 `project branch use-registered <name>`，将命名项目从 `actualBranch` 切换到 `registeredBranch`；该命令必须（SHALL）声明为需要确认的 `external` 命令，并且不得创建分支、fetch、stash、reset、commit 或修改 Workspace 注册表。

#### Scenario: 安全切换成功
- **WHEN** 工作树干净、注册本地分支存在、用户已确认且计划没有漂移
- **THEN** CLI 切换命名项目到注册分支，验证实际分支和干净状态，并返回原实际分支与最终实际分支

#### Scenario: 工作树不干净
- **WHEN** 目标项目存在未提交变更
- **THEN** 命令在确认和 Git 切换前返回稳定诊断，说明必须由用户手动处理，并且不运行 stash、reset 或其他补救命令

#### Scenario: 注册本地分支不存在
- **WHEN** 项目的注册分支不是现有本地分支
- **THEN** 命令在确认和 Git 切换前返回稳定诊断，且不创建或下载该分支

#### Scenario: 实际分支已经等于注册分支
- **WHEN** 用户运行 `project branch use-registered <name>`，且两个分支已经一致
- **THEN** 命令以 `skip` 成功返回，不要求确认且不执行 Git 变更

#### Scenario: 确认后计划失效
- **WHEN** 注册分支、实际分支、工作树干净状态或目标分支存在性在确认后发生变化
- **THEN** CLI 在执行 `git switch` 前返回计划过期诊断，并且不产生外部效果

### Requirement: 外部分支效果必须验证和补偿
CLI 必须（SHALL）验证 `use-registered` 的可观测后置条件；在 Git 切换后发生失败时必须（SHALL）尝试切回计划中的原实际分支，并在补偿失败时通过稳定诊断报告保留的外部效果和人工恢复信息。

#### Scenario: 切换后验证失败但补偿成功
- **WHEN** Git 切换已经发生，但后置验证失败，且 CLI 能切回原实际分支
- **THEN** 命令返回失败，报告补偿成功，并且最终实际分支恢复为命令前状态

#### Scenario: 切换后补偿失败
- **WHEN** Git 切换后发生失败，且切回原实际分支也失败
- **THEN** 命令返回失败，并在诊断中包含项目、原实际分支、当前观测分支、`retained` 外部效果和人工恢复建议

### Requirement: 分支一致性使用专用只读验证
CLI 必须（SHALL）提供 `project branch verify <name...>`，且该命令只断言注册分支与实际分支相等。命令必须只加载 `projects` 配置域，并只通过 Git worktree 检查获取实际分支和真实位置；不得调用整体 `project verify`、项目字段健康检查、项目路径重叠或嵌套检查、工作树干净度检查或注册本地分支存在性检查。

#### Scenario: 分支一致性验证成功
- **WHEN** 用户运行 `project branch verify <name> --json` 且 `registeredBranch` 等于 `actualBranch`
- **THEN** 命令成功返回项目名称、位置、`registeredBranch`、`actualBranch` 和 `matches: true`

#### Scenario: 分支一致性验证失败
- **WHEN** 注册分支与实际分支不一致
- **THEN** 命令返回 `PROJECT_BRANCH_MISMATCH`，保留包含规范分支状态的结果数据，且不因工作树干净度或注册本地分支是否存在而改变结论

#### Scenario: 整体项目问题不阻塞分支验证
- **WHEN** 分支已经一致，但定向 `project verify` 会因项目字段、Workspace 重叠、项目嵌套或其他非分支项目问题失败
- **THEN** `project branch verify` 仍成功，且不承担或报告这些项目整体健康问题

### Requirement: 分支命令使用稳定结果与错误合同
四条分支命令必须（SHALL）使用共享结果 envelope、稳定命令名和 `WorkspaceError` 诊断，并且分支值、项目名、位置、预期值、实际值和可执行恢复建议必须（SHALL）以结构化字段返回。

#### Scenario: JSON 成功结果
- **WHEN** 任一分支命令以 `--json` 成功完成
- **THEN** 返回 `schemaVersion`、`ok`、完整三段式 `command`、`data` 和 `diagnostics`，且 text-only 内容不泄漏到 JSON envelope

#### Scenario: 未知项目
- **WHEN** 任一分支命令引用未注册的项目名
- **THEN** 返回 `PROJECT_NOT_FOUND`，且不检查任何项目路径或修改任何状态

### Requirement: 分支协调链路支持独立参数的多项目批量处理
`project branch inspect`、`project branch verify`、`project branch accept-actual`、`project branch use-registered` 和定向 `project verify` 必须（SHALL）接受一个或多个独立项目名参数。CLI 不得将逗号分隔字符串解释为多个项目。单项目调用必须保持原有数据合同；多项目调用必须返回 `scope: selection`、输入顺序的逐项目结果和成功、跳过、失败汇总。

#### Scenario: 批量只读命令包含失败项目
- **WHEN** 批量 `branch inspect`、`branch verify` 或定向 `project verify` 中某个项目不存在或检查失败
- **THEN** CLI 记录该项目诊断并继续检查其余项目，全部完成后顶层返回失败，同时保留所有成功项目的数据

#### Scenario: 批量写操作统一确认
- **WHEN** 多个项目可执行 `accept-actual` 或 `use-registered` 且调用方没有提供 `--yes`
- **THEN** CLI 在任何项目产生效果前只请求一次确认；取消或非交互确认缺失时不修改任何项目

#### Scenario: 批量操作部分失败
- **WHEN** 某个项目在预检查、应用或后置验证阶段失败
- **THEN** CLI 保留该项目自身的事务回滚或外部效果补偿，继续处理后续项目，不回滚此前成功项目，并在全部处理后返回有项目归属的诊断与有序汇总

#### Scenario: 批量项目重复出现
- **WHEN** 同一个项目名在一次批量命令中重复出现
- **THEN** CLI 只处理第一次出现的位置，为后续重复项返回 warning，且不重复产生项目效果

### Requirement: 移除语义不明确的旧分支命令
CLI 必须（SHALL）移除 `project sync-branch`，并以 `project branch accept-actual` 作为“实际分支写回注册表”的唯一受支持入口。

#### Scenario: 调用旧命令
- **WHEN** 用户运行 `code-w project sync-branch <name>`
- **THEN** CLI 在 Workspace 发现和配置加载前返回未知命令诊断，并且帮助、补全、Skill 和文档均不列出旧命令

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
