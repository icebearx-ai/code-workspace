## ADDED Requirements

### Requirement: Observer Hook 使用独立协议
扩展 manifest MAY 声明 observer Hook。Observer MUST 与决策型 Hook 使用不同协议标识、runner、贡献 marker 和测试路径。Host SHALL 分别合成、验证、安装和卸载 observer 与决策型 Hook；observer 存在、失败或卸载不得改变决策型 Hook 的内容或失败策略。

#### Scenario: 只安装 observer
- **WHEN** Workspace 安装只声明 observer Hook 的扩展
- **THEN** Host 只写入对应 Provider 的 observer entry，不创建或修改决策状态

#### Scenario: observer 与决策 Hook 并存
- **WHEN** 同一 Workspace 同时存在 observer 和决策型 Hook
- **THEN** 两类 Hook 分别验证和卸载，一方漂移不静默修改另一方

### Requirement: Host 提供 Provider-neutral 观察事件
Observer runtime SHALL 接收版本化观察 envelope，其中包含 provider、原生 session ID、规范化 event type、occurredAt 和适用的 turn/tool/subagent/permission 元数据。观察事件 MUST 使用 `session.*`、`turn.*`、`tool.*`、`subagent.*` 或 `permission.*` 语义，MUST NOT 把授权含义的 `write.before`/`write.after` 作为观察事件。敏感输入正文、凭证和完整工具参数 MUST NOT 默认进入 envelope。

#### Scenario: Tool 观察事件
- **WHEN** Provider adaptor 收到工具开始或完成输入
- **THEN** envelope 包含规范化的 `tool.started` 或 `tool.completed` 及必要元数据，不包含完整敏感参数正文

#### Scenario: 未知原生事件
- **WHEN** Provider 收到当前规范未定义的观察事件
- **THEN** Host 安全跳过或记录 warning，不产生允许/拒绝决策

### Requirement: Observer 始终 failure-open
Observer 在配置错误、服务不可达、输入损坏、超时或内部异常时 MUST 返回 Provider 接受的中性 acknowledgement 并以成功状态退出。Observer MUST NOT 返回 ALLOW/DENY、阻塞工具或修改决策状态。失败 MAY 通过 stderr、宿主诊断或扩展日志记录，但不得改变 Agent 工具执行结果。

#### Scenario: 观察服务不可达
- **WHEN** observer 上报目标不可达或超时
- **THEN** Hook 返回中性 acknowledgement，Agent 工具继续执行

#### Scenario: observer 产生决策字段
- **WHEN** observer runner 返回 ALLOW、DENY、block 或权限决策字段
- **THEN** Host 拒绝该 observer 结果且不把其作为安全决策

### Requirement: Codex 与 Claude 观察适配
Host SHALL 通过 Codex 和 Claude adaptor 将原生 Session、Turn、Tool、Subagent、Permission 和结束事件转换为统一 observer envelope。Adaptor MUST 保留 provider 和原生 session 标识，允许 Provider 不支持的字段为空，并 MUST 明确成功、失败和结束状态。

#### Scenario: Claude 工具失败事件
- **WHEN** Claude 发出 `PostToolUseFailure`
- **THEN** observer 收到带失败状态的 `tool.completed` envelope

#### Scenario: Codex Session 结束事件
- **WHEN** Codex 发出 `SessionEnd`
- **THEN** observer 收到 `session.ended` envelope 和原生 session ID
