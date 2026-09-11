## ADDED Requirements

### Requirement: Monitor 作为可选运行时扩展提供
Code Workspace SHALL 提供内置 `monitor` 扩展，包含现有 Monitor Store、HTTP API、Dashboard、i18n、静态资源和事件业务映射。用户 SHALL 可以显式安装、升级和卸载该扩展；在本阶段，核心 Monitor 和旧默认路径 MUST 继续存在，扩展不得改变它们的行为。

#### Scenario: 显式安装 Monitor 扩展
- **WHEN** 用户执行 `code-w extension install monitor --yes`
- **THEN** Host 安装扩展状态、配置声明和适用的 Observer Hooks，但不修改核心 `config.monitor` 或 `code-w monitor` 默认路径

#### Scenario: 未安装 Monitor 扩展
- **WHEN** Workspace 未选择 Monitor 扩展
- **THEN** 核心 Monitor 的原有命令、配置和 Hook 行为保持可用

### Requirement: Monitor 使用通用运行时 CLI
Monitor 扩展 SHALL 通过 `code-w ext monitor` 提供原 Monitor 服务的启动能力，并 MUST 使用 runtime CLI 的作用域、入口摘要、生命周期和错误契约。Monitor 服务 SHALL 使用 global runtime scope，不要求单个 Workspace 定义服务身份。

#### Scenario: 启动扩展 Monitor 服务
- **WHEN** 用户执行 `code-w ext monitor serve`
- **THEN** 扩展启动原有 loopback HTTP Server、Dashboard 和事件 API

#### Scenario: 服务运行期间保持长驻
- **WHEN** Monitor 服务成功启动并持续运行
- **THEN** Host 不应用一次性 CLI 超时终止服务，并转发用户终止信号

### Requirement: Monitor 使用扩展配置和独立 Observer
Monitor 扩展 SHALL 通过通用扩展配置文件读取自身配置，并 MUST 通过 observer protocol 消费 Codex 和 Claude 观察事件。Monitor observer MUST NOT 获得写入决策、任务台账或 claim 权限，MUST 在不可达或异常时 failure-open。

#### Scenario: Codex 事件上报
- **WHEN** 已安装扩展的 Codex Workspace 产生 Session、Turn、Tool 或 Subagent 观察事件
- **THEN** observer 将事件映射并上报到扩展 Monitor API

#### Scenario: Claude 事件上报
- **WHEN** 已安装扩展的 Claude Workspace 产生工具成功或失败事件
- **THEN** observer 归一化事件并上报，不返回工具阻断决策

#### Scenario: Monitor 服务不可达
- **WHEN** Monitor 服务停止或上报超时
- **THEN** Agent 工具继续执行，扩展记录可用诊断且不改变其他 Hook

### Requirement: Monitor 扩展与核心恢复业务对等
迁移到扩展的实现 MUST 保持现有 Session 生命周期、十分钟失活阈值、统计、删除 API、Dashboard 刷新、SSE、i18n 和事件映射行为。对等验证 SHALL 使用同一输入场景比较核心实现与扩展实现；任何业务差异必须在显式变更中处理，不能作为本阶段的隐式修改。

#### Scenario: 失活 Session 对等
- **WHEN** 同一 Session 快照在核心实现和扩展实现中连续十分钟没有信号
- **THEN** 两者都返回 `INACTIVE`，且活跃统计一致

#### Scenario: 删除 Session 对等
- **WHEN** 对同一 Workspace UUID 和 Session ID 执行扩展删除
- **THEN** Session 及其关联事件被移除并发布更新，Workspace 不被自动删除
