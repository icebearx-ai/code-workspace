## ADDED Requirements

### Requirement: 核心提供稳定的扩展 CLI 命名空间
Code Workspace SHALL 永久注册 `code-w ext [host-options] <extension-id> [extension-argv...]`。Parser MUST 在识别 extension-id 后停止解释扩展参数；扩展 ID 后的所有 token，包括以 `-` 开头的 token，MUST 原样传递给扩展。Host options MUST 只允许出现在 extension-id 之前，显式 `--` MAY 作为兼容分隔符。系统 MUST NOT 允许扩展动态注册或覆盖 `code-w <extension-id>` 顶级命令。

#### Scenario: 扩展私有选项无需额外分隔符
- **WHEN** 用户执行 `code-w ext example status --json`
- **THEN** Host 将 `status --json` 识别为扩展参数并原样传递给 `example` 扩展

#### Scenario: Host 选项位于扩展 ID 之前
- **WHEN** 用户执行 `code-w ext --json example status`
- **THEN** `--json` 由 Host 解释，`status` 由扩展解释

#### Scenario: 扩展不能动态创建顶级命令
- **WHEN** 已安装扩展的 ID 为 `example` 且 registry 没有 `example` 命令
- **THEN** `code-w example` 仍以未知命令失败，只能通过 `code-w ext example` 调用

### Requirement: Runtime CLI 入口必须声明并冻结
扩展 manifest SHALL 在独立 runtime 声明中提供 CLI entry、entry 摘要、runtime protocol version、scope 和 execution mode。Host SHALL 在调用前验证当前 manifest、完整扩展包、entry 路径和 entry 摘要；任一不一致时 MUST 以稳定 stale-plan 错误拒绝执行。

#### Scenario: CLI 入口摘要匹配
- **WHEN** manifest、完整扩展包和 CLI entry 均与运行时计划一致
- **THEN** Host 可以启动扩展 CLI

#### Scenario: CLI 入口在调用前漂移
- **WHEN** CLI entry 内容与声明摘要不一致
- **THEN** Host 不启动扩展并报告入口 stale-plan 错误

#### Scenario: 扩展没有 CLI 能力
- **WHEN** 用户对未声明 CLI entry 的扩展执行 `code-w ext`
- **THEN** Host 以稳定 `EXTENSION_CLI_UNAVAILABLE` 类错误拒绝调用

### Requirement: Host 按作用域解析运行时
CLI runtime SHALL 声明 `workspace` 或 `global` scope。Workspace-scoped CLI MUST 要求当前 Workspace 已安装该扩展；Global-scoped CLI MUST 从 Host 支持的可信全局 runtime 集合解析，且不得因任意单个 Workspace 未安装而不可用。作用域不匹配时系统 MUST 在启动子进程前失败。

#### Scenario: Workspace 扩展未安装
- **WHEN** Workspace-scoped 扩展声明 CLI 但当前 Workspace 未安装它
- **THEN** Host 在启动子进程前返回未安装错误和安装 remediation

#### Scenario: Global runtime 与 Workspace 状态分离
- **WHEN** 当前目录不是 Workspace 而全局可信 runtime 提供 CLI
- **THEN** 该 CLI 仍可按其声明的 global scope 调用

### Requirement: 一次性 CLI 使用统一结果契约
必须声明为一次性执行的 CLI SHALL 在成功退出时向 stdout 输出单个 JSON result envelope。Host MUST 校验 schema version、runtime protocol version、扩展身份、允许字段、diagnostics 结构、stdout/stderr 上限和退出码，再将业务数据映射到统一的 `ext` command result。空输出、额外字段、身份不匹配、非零退出、超时或输出超限 MUST 使用稳定错误码失败。

#### Scenario: 一次性 CLI 成功
- **WHEN** 扩展以状态 0 退出并返回身份匹配的合法 JSON envelope
- **THEN** Host 返回统一的 `ext` result 并包含扩展数据和 diagnostics

#### Scenario: 一次性 CLI 输出非法
- **WHEN** 扩展返回非 JSON、额外字段、错误身份或超过输出上限
- **THEN** Host 拒绝结果且不把原始 stdout 暴露为成功业务数据

### Requirement: 长驻 CLI 使用独立生命周期
必须声明为长驻服务的 CLI SHALL 使用继承的 stdio，并且其运行时长 MUST NOT 受一次性总超时限制。Host SHALL 只用启动超时约束就绪阶段，MUST 转发 `SIGINT` 和 `SIGTERM`，并在服务退出后清理临时 context。服务未就绪、启动失败或异常退出时 Host MUST 返回稳定错误；启动成功后 Host MUST NOT 把正常存活误判为超时。

#### Scenario: 服务正常长驻
- **WHEN** 长驻 CLI 在启动超时内报告就绪并持续运行
- **THEN** Host 保持进程运行且不应用一次性超时终止

#### Scenario: 用户终止服务
- **WHEN** 用户向前台 `code-w ext` 进程发送 SIGINT 或 SIGTERM
- **THEN** Host 将相同信号转发给服务并清理进程资源

#### Scenario: 服务启动超时
- **WHEN** 长驻 CLI 未在声明的启动超时内就绪
- **THEN** Host 终止启动过程并返回启动超时错误
