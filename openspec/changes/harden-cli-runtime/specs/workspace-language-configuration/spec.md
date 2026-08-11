## MODIFIED Requirements

### Requirement: 工作区配置保存内容语言
系统 MUST 在 `.openspec-workspace/config.yaml` 的 `workspace.language` 中保存受支持的工作区内容语言，并将其作为迁移完成后的唯一事实来源。完整配置写入和依赖语言的命令 MUST 验证该字段。仅依赖其他配置域的命令 MUST 能够读取受支持的旧工作区，且不得因为旧配置缺少语言而失败或隐式写回语言。

#### Scenario: 初始化新工作区并指定语言
- **WHEN** 用户执行 `openspec-w init . --language en-US`
- **THEN** 系统在本地配置中保存 `workspace.language: en-US`
- **THEN** 初始化结果报告 `en-US` 为工作区内容语言

#### Scenario: 拒绝不支持的语言
- **WHEN** 用户在 init 或 update 中提供未注册的语言标记
- **THEN** 系统在写入任何配置或 artifact 之前失败
- **THEN** 错误列出受支持的语言标记

#### Scenario: 无关命令读取旧工作区
- **WHEN** 受支持的旧配置缺少 `workspace.language` 但包含有效项目注册表
- **THEN** `project list`、`project show` 和 `project verify` 不因语言缺失而失败
- **THEN** 这些只读操作不修改本地配置

### Requirement: 旧工作区语言可确定迁移
系统 MUST 为缺少 `workspace.language` 的旧工作区提供迁移。兼容读取 MUST 优先采用 `state.json.workspaceLanguage`，其次采用 `openspec/config.yaml` 的受支持语言指令，但不得在只读命令中写回。显式 init/update 迁移 MUST 持久化选定语言；若两个已存在的旧来源不一致，系统 MUST 要求用户显式选择语言而不是静默迁移。

#### Scenario: 从旧状态迁移
- **WHEN** 本地配置缺少语言且旧状态包含受支持的 `workspaceLanguage`
- **THEN** init/update 将该值迁移到 `workspace.language`
- **THEN** 成功提交后状态文件不再保存 `workspaceLanguage`

#### Scenario: 只读兼容不产生迁移写入
- **WHEN** 普通查询命令从旧来源解析出工作区语言或读取不依赖语言的配置域
- **THEN** `.openspec-workspace/config.yaml` 和 state 文件保持不变

#### Scenario: 拒绝冲突的旧语言来源
- **WHEN** 状态文件和 OpenSpec 派生配置包含不同的受支持语言且本地配置没有语言
- **THEN** 自动迁移失败且不修改任何文件
- **THEN** 错误要求用户通过 `update --language <lang>` 明确选择

### Requirement: 配置迁移由版本注册表控制
系统 MUST 将缺少 `schemaVersion` 的文档识别为 v0、现有 `schemaVersion: 1` 文档识别为 v1，并通过纯函数迁移注册表规划到当前 v2。只读兼容投影 MUST NOT 提交迁移；init/update 成功写入后 MUST 持久化 v2。

#### Scenario: 维护命令提交 v1 到 v2 迁移
- **WHEN** 用户对受支持的 v1 工作区执行成功的 init 或 update
- **THEN** 配置以 `schemaVersion: 2` 写回
- **THEN** 结果报告迁移来源版本、目标版本和步骤

#### Scenario: 无版本旧配置只读不写回
- **WHEN** 查询命令读取缺少 `schemaVersion` 但目标域有效的配置
- **THEN** 配置被识别为 v0 并兼容读取
- **THEN** 文件内容逐字节保持不变
