## ADDED Requirements

### Requirement: Monitor 扩展支持多 Workspace activation
Monitor SHALL 作为一个版本化扩展包提供 Workspace activation。每个 Workspace MAY 独立激活或卸载 Monitor；activation MUST 只拥有该 Workspace 的 Observer Hook、上报配置和其他声明制品，不得拥有全局 Monitor Store 或服务进程。

#### Scenario: 两个 Workspace 激活 Monitor
- **WHEN** Workspace A 和 Workspace B 分别激活同一 Monitor 包版本
- **THEN** 两个 Workspace 各自生成 Hook/config，并共享同一 User Store 包，不互相覆盖制品

#### Scenario: 卸载一个 Workspace activation
- **WHEN** Workspace A 卸载 Monitor 而 Workspace B 仍保持激活
- **THEN** Host 只移除 A 的 Hook/config，B 的 activation 和全局服务保持可用

### Requirement: Monitor service 聚合多个 Workspace
Monitor 扩展 SHALL 提供声明为 global/user execution scope 的长驻 service。该 service MUST 在用户级数据目录维护跨 Workspace 的事件、Session、统计和 Dashboard 状态，不得将聚合数据写入任意 Workspace。

#### Scenario: 多 Workspace 上报事件
- **WHEN** A、B 两个 Workspace 的 Observer Hook 向同一 Monitor service 上报事件
- **THEN** service 按 Workspace identity 分别聚合事件，并在全局快照中同时展示 A、B

#### Scenario: 当前目录不是 Workspace
- **WHEN** 用户在普通目录执行 Monitor service 启动命令
- **THEN** Runtime Host 可以启动 Monitor service，不要求该目录存在 Workspace activation

### Requirement: Monitor 版本和服务兼容性可预测
Monitor activation MUST 固定扩展版本和 package digest。Monitor manifest SHALL 声明 service identity 和兼容组；Host MUST 拒绝不兼容 activation 静默连接到同一 singleton service。

#### Scenario: 兼容版本共用服务
- **WHEN** Workspace A 使用 monitor@1.0.0、Workspace B 使用 monitor@1.1.0，且两者声明同一兼容组
- **THEN** Host 可以运行一个 Monitor service 并接收两个 Workspace 的事件

#### Scenario: 不兼容版本激活
- **WHEN** Workspace B 的 Monitor 版本与当前运行 service 兼容组不同
- **THEN** Host 返回稳定兼容冲突错误，不自动切换或覆盖 A 的 service

### Requirement: Monitor Observer failure-open
Monitor Observer Hook MUST 只上报事实，不得返回阻断决策或修改 Workspace 写保护状态。服务不可达、上报超时或响应异常时，Agent 工具 MUST 继续执行，并产生受限诊断。

#### Scenario: Monitor 服务不可达
- **WHEN** Observer Hook 无法连接 Monitor service
- **THEN** Hook 报告 failure-open 诊断并以成功或非阻断状态退出

### Requirement: Monitor 行为与既有实现对等
扩展 Monitor service MUST 保持既有 Session 十分钟失活、ACTIVE/INACTIVE/ENDED 状态、统计、Session 删除、Dashboard、SSE 和 i18n 行为。对等验证 SHALL 使用核心实现和扩展实现的相同输入场景。

#### Scenario: Session 生命周期对等
- **WHEN** 同一事件序列分别发送到核心 Monitor 和扩展 Monitor
- **THEN** 两者的 Session 状态、统计和失活结果一致

#### Scenario: 删除 Session 对等
- **WHEN** 客户端按 Workspace UUID 和 Session ID 删除 Session
- **THEN** 扩展 Monitor 移除 Session 及关联事件并发布更新，且不删除 Workspace
