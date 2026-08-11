## ADDED Requirements

### Requirement: 命令具备语义化语法
CLI MUST 根据定义了位置参数元数和选项类型的声明式语法解析命令。系统 MUST 支持将合法选项放在位置参数之前或之后，且不得改变其含义；系统还 MUST 在执行处理器之前拒绝未知选项和多余位置参数。

#### Scenario: 布尔选项不消费目标路径
- **WHEN** 用户执行 `openspec-w init --yes .`
- **THEN** CLI 将 `.` 解析为可选的 init 目标，并将 `yes` 解析为布尔值 true

#### Scenario: 拒绝未知选项
- **WHEN** 用户执行 `openspec-w update --froce`
- **THEN** CLI 在读取或写入工作区状态之前失败，并返回未知选项诊断

### Requirement: 命令声明工作区与配置依赖
每个命令 MUST 声明自身是否需要工作区，以及消费哪些配置域。运行时 MUST NOT 在执行命令之前校验无关配置域。

#### Scenario: 项目列表兼容无关的旧语言字段缺失
- **WHEN** 受支持的旧工作区包含有效项目，但缺少 `workspace.language`
- **THEN** `openspec-w project list` 成功返回项目列表

#### Scenario: 仓库检查独立于工作区
- **WHEN** 用户在工作区外执行 `openspec-w project inspect <path>`
- **THEN** CLI 无需本地工作区配置即可检查该仓库

### Requirement: 配置兼容具备版本感知能力且默认只读
配置网关 MUST 区分当前版本、受支持的旧版本、不受支持的未来版本、缺失配置和非法配置。兼容性读取 MUST NOT 修改文件；显式维护写入 MUST 完整校验并持久化迁移后的当前版本。

#### Scenario: 投影受支持的旧配置但不产生变更
- **WHEN** 只读命令从受支持的旧配置中消费一个有效配置域
- **THEN** 命令获得该配置域，且配置文件逐字节保持不变

#### Scenario: 保护未来版本配置
- **WHEN** CLI 遇到高于自身支持范围的 Schema 版本
- **THEN** CLI 以稳定的不支持版本诊断失败，且不重写该文件

### Requirement: 写命令使用计划效果
关键写命令 MUST 在提交前计算并校验其工作区效果。应用或验证失败后，系统 MUST 恢复可回滚的工作区效果；不可回滚的外部效果 MUST 被单独识别和验证。

#### Scenario: 工作区失败后恢复可回滚文件
- **WHEN** 关键写命令修改一个或多个受跟踪工作区文件后被注入失败
- **THEN** 所有受跟踪的既有文件均被恢复，所有受跟踪的新建文件均被移除

#### Scenario: 如实报告外部效果
- **WHEN** 外部依赖操作成功，但后续工作区提交失败
- **THEN** CLI 在恢复可回滚工作区文件的同时，报告已经验证的外部效果仍然保留

### Requirement: 机器输出是稳定的命令契约
机器可读命令 MUST 返回带版本的成功或诊断信封，并具备确定性的退出行为。Skill 和文档 MUST 只引用已注册的命令和选项。

#### Scenario: JSON 失败保持机器可读
- **WHEN** 已注册命令在 JSON 模式下失败
- **THEN** stdout 只包含一个有效诊断信封，stderr 不包含与之冲突的人类可读错误，进程以非零状态退出

#### Scenario: Skill 命令引用有效
- **WHEN** CLI 契约测试扫描发布包内的 Skill 命令调用
- **THEN** 每个被引用的命令路径和选项都能通过命令注册表解析

### Requirement: 所有机器结果使用统一信封
CLI MUST 让 JSON 成功和失败结果都包含 `schemaVersion`、`ok`、`command`、`data` 和 `diagnostics`。文本渲染 MUST 从同一个命令结果派生。JSON 模式 MUST 为非交互模式，需要确认的写命令在缺少 `--yes` 时 MUST 在应用效果前失败。

#### Scenario: 查询命令返回成功信封
- **WHEN** 用户执行任一查询命令并传入 `--json`
- **THEN** stdout 只包含一个 `ok: true` 的统一信封
- **THEN** 命令特有字段位于 `data` 中

#### Scenario: JSON 写命令不提示
- **WHEN** 用户以 `--json` 执行需要确认的写命令但未传入 `--yes`
- **THEN** CLI 返回 `CLI_CONFIRMATION_REQUIRED`
- **THEN** stdout 仍是统一失败信封且未应用任何效果

### Requirement: 工具选择具有唯一来源
CLI MUST 按显式 `--tools`、持久化 workspace state、manifest 默认值的顺序确定工具集合，并向调用方报告实际来源。Doctor、init、update 和 managed files MUST 使用同一个解析结果。

#### Scenario: 更新保留现有工具选择
- **WHEN** 工作区上次只选择 Codex 且用户执行未带 `--tools` 的 update
- **THEN** update 继续只管理 Codex 资产
- **THEN** Doctor 与 update 报告相同的工具集合及来源

### Requirement: Doctor 保留有效配置域
Doctor MUST 宽容解析配置并逐域诊断。一个域无效时，其他有效域仍 MUST 被用于相关健康检查；不得用空对象替代整个配置并制造次生缺失错误。

#### Scenario: 语言无效但项目有效
- **WHEN** 配置包含无效 language 和有效 projects
- **THEN** Doctor 报告 language 诊断并继续验证 projects
- **THEN** Doctor 不报告虚假的 workspace identity 缺失

### Requirement: 回滚结果精确描述效果
失败诊断 MUST 分别列出已恢复文件、已删除的新文件、无法补偿的保留效果和回滚失败。外部命令成功只有在命令专属后置条件通过后才能标记为 verified。

#### Scenario: 部分效果无法补偿
- **WHEN** 外部安装成功而后续工作区提交失败
- **THEN** 可补偿文件列入 restored 或 removed
- **THEN** 外部安装列入 retained，且不得声称整个工作区没有修改
