## ADDED Requirements

### Requirement: Provider 事件先归一化再进入核心
Codex 与 Claude 适配器 MUST 把原生 Hook 输入转换为带 schemaVersion、eventId、provider、nativeSessionId、workspaceUuid、cwd、eventType、occurredAt、agent 和 tool 信息的统一 envelope，协调核心 MUST NOT 直接依赖 Provider 原生字段。

#### Scenario: 两个 Provider 的 PreToolUse
- **WHEN** Codex 和 Claude 分别发出语义相同的写工具前事件
- **THEN** 两个适配器生成相同 `write.before` 语义并调用同一协调服务

### Requirement: Codex 生命周期映射
Codex 适配器 MUST 支持 `SessionStart`、`UserPromptSubmit`、`PermissionRequest`、`PreToolUse`、`PostToolUse`、可用的工具失败事件、`Stop` 与 `SessionEnd`，并按统一生命周期语义映射。

#### Scenario: Codex Stop
- **WHEN** Codex 发送 `Stop`
- **THEN** 适配器生成 `task.turn-ended`，不会生成 `task.ended`

### Requirement: Claude 生命周期映射
Claude 适配器 MUST 支持 `SessionStart`、`UserPromptSubmit`、`PermissionRequest`、`PreToolUse`、`PostToolUse`、`PostToolUseFailure`、`Stop`、`StopFailure` 与 `SessionEnd`，并按统一生命周期语义映射。

#### Scenario: Claude PostToolUseFailure
- **WHEN** Claude 工具调用失败并发送 `PostToolUseFailure`
- **THEN** 适配器生成带失败结果的 `write.after`，核心检查是否仍留下修改

### Requirement: PreToolUse 决定实际写入是否执行
适配器 MUST 在 Provider 实际执行写工具前调用协调核心，并把 `ALLOW` 渲染为 Provider 允许结果，把任何 deny/confirm/adjudication/retry 结果渲染为 Provider 原生阻断结果。

#### Scenario: 同文件冲突
- **WHEN** 核心对 `PreToolUse` 返回 `DENY_FILE_CONFLICT`
- **THEN** Provider 工具不会执行，用户和 Agent 能看到结构化冲突原因

### Requirement: Hook 内部失败必须 fail closed
Pre-write runner MUST 捕获台账、路径解析、Git、适配或内部异常并尽可能返回合法的 Provider 阻断结果；它 MUST NOT 把协调错误解释为允许。

#### Scenario: ledger mutex 获取失败
- **WHEN** PreToolUse runner 在有界时间内无法完成协调事务
- **THEN** runner 阻断工具并提示安全重试，而不是静默 exit-success

### Requirement: 工具目标提取采用显式能力表
每个 Provider 适配器 MUST 维护版本化工具能力表，把工具分类为只读、exact-file、multi-file、directory-tree 或 unknown-write；未知工具 MUST NOT 默认归类为只读。

#### Scenario: 新出现的未知工具
- **WHEN** Provider 发出能力表中不存在的工具调用且其效果不能证明为只读
- **THEN** 适配器把它归类为 unknown-write 并请求 `PROJECT_WIDE` 协调

### Requirement: 路径提取失败不得缩小保护范围
当工具被识别为可能写入但目标字段缺失、动态生成或无法安全规范化时，适配器 MUST 使用 directory/project 范围或阻断，MUST NOT 以空目标集合放行。

#### Scenario: shell 动态命令
- **WHEN** shell 命令通过变量和脚本动态决定输出文件，适配器无法证明具体目标
- **THEN** 事件使用 `PROJECT_WIDE` 范围并服从未知写入强互斥规则

### Requirement: Hook 事件幂等且关联 operation
适配器 MUST 为可重试事件生成稳定 eventId，并保留原生 tool call ID 作为 operationId；核心 MUST 忽略重复事件且只允许匹配 operationId 的 after-event转换 reservation。

#### Scenario: PostToolUse 重放
- **WHEN** 同一个 `PostToolUse` 因 Hook 重试被提交两次
- **THEN** 第二次事件不会重复释放 claim、重复写历史或增加错误 revision

### Requirement: 乱序和迟到事件不能破坏当前 owner
适配器和核心 MUST 使用 generation、eventId 与 operationId 拒绝或无害化迟到事件，尤其不能让旧 after-event 释放新 generation 或其他任务的 claim。

#### Scenario: abandon 后迟到的 after-event
- **WHEN** 旧 generation 被 abandon 后收到原操作的 `PostToolUse`
- **THEN** 事件只记录为 revoked/late 证据，不改变当前文件 owner

### Requirement: 子 Agent 元数据不改变 owner
适配器 MUST 保存可用的 `agent_id` 与 `agent_type` 作为观察信息，但 MUST 使用父 session 任务作为锁 owner。

#### Scenario: Claude subagent 工具事件
- **WHEN** Claude Hook 输入包含 subagent 标识
- **THEN** envelope 记录 subagent 元数据，同时 nativeSessionId/generation 仍解析到父任务

### Requirement: 协调 Hook 与 Monitor 解耦
协调 Hook 模板、runner 和核心 MUST NOT 调用 `monitor report`、Monitor HTTP API 或 Monitor 内存状态；Monitor Hook 可独立存在、禁用或失败。

#### Scenario: 只安装协调 Hook
- **WHEN** Workspace 未启用 Monitor 但安装了 Codex/Claude 协调 Hook
- **THEN** 生命周期、项目确认和文件互斥全部可用

### Requirement: 明示 Hook 强制边界
安装说明和冲突诊断 MUST 说明强制互斥只覆盖已信任且启用的受支持 Hook 工具入口，不得宣称能阻止外部编辑器、用户进程或绕过 Hook 的写入。

#### Scenario: 用户查看安全说明
- **WHEN** 用户安装或诊断写入协调功能
- **THEN** 输出明确列出 Provider Hook 信任状态、受支持工具范围和无法覆盖的外部写入边界

