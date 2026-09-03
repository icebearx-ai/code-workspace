# Monitor 扩展化决策记录

本文件记录本次实施中影响架构边界、兼容性和运行时安全语义的主要决策。

## D1：Monitor observer Hook 与写保护 Hook 使用双协议边界

**决策**：Provider adaptor 只负责原生事件识别和通用字段提取；之后分别进入 `observer` 和 `coordination` 协议。两者不共享 task ledger、claim、写入 scope、ALLOW/DENY 决策或 Monitor API。

**原因**：Monitor 的职责是观察和上报，写保护的职责是授权和阻断。把两者放进同一 runner 会让监控不可达、配置错误或上报延迟影响写入安全，也会让 Monitor 获得不应拥有的决策能力。

**失败策略**：observer failure-open，返回中性 acknowledgement 并记录 warning；写保护保持 failure-closed。

**替代方案及拒绝原因**：

- 共用一个 Hook runner：拒绝，职责和失败策略相互污染。
- 让 Monitor 复用 task coordination 的工具分类和决策 helper：拒绝，违反扩展独立性。
- 让 observer 返回 allow/deny：拒绝，观察协议不应产生写入决策。

## D2：`code-w ext` 是静态注册的通用扩展点

**决策**：核心 registry 永久注册 `ext`，运行时解析第一个扩展 ID，并从 manifest 读取 CLI 入口；扩展数量变化不修改核心 registry。

**原因**：每新增一个扩展都修改核心命令注册表会形成紧耦合，扩展生态无法复用通用生命周期。核心只理解通用执行边界，扩展自行解释私有参数。

**通用合同**：入口路径、入口 SHA-256、Extension Spec 版本、scope、timeout、protocolVersion、长驻声明、统一 result envelope、错误码和输出上限。

**替代方案及拒绝原因**：

- 为 Monitor 增加专用 `monitor` dispatcher：拒绝，无法成为后续通用扩展点。
- 核心解析所有扩展私有选项：拒绝，扩展 CLI 演进会反向修改核心 parser。
- 直接执行扩展入口而不校验摘要：拒绝，无法检测计划后入口漂移。

## D3：Monitor 采用 Workspace 状态与 Global runtime 双作用域

**决策**：Workspace 安装只管理扩展状态、observer Hook 和用户配置；Monitor Server 作为 global runtime 启动，并可汇总多个 Workspace。

**原因**：Server 的生命周期和数据聚合范围是全局的，而 Hook 和安装状态必须跟随具体 Workspace。把两者混为一个作用域会导致多个 Workspace 无法共享服务，或卸载一个 Workspace 时误停全局服务。

**实现方式**：通过 global runtime registry 解析已安装/随包提供的可信 Monitor runtime，`code-w ext monitor` 负责启动，不在核心 dispatcher 中硬编码 Monitor 例外。

## D4：扩展配置脱离核心配置

**决策**：扩展配置统一放置在 `<workspace>/.code-workspace/config-<extension-id>.yaml`；Monitor 固定使用 `config-monitor.yaml`。核心 Host 不解析或重写扩展专属字段。

**原因**：核心 `config.yaml` 应只承载 Workspace 自身控制面。扩展字段进入核心会扩大配置投影、迁移和校验耦合，并使无关扩展配置错误阻断核心命令。

**生命周期**：升级保留用户修改；卸载删除扩展制品和 Hook，但默认保留配置和运行期用户数据；配置解析错误只影响对应扩展运行。

**兼容处理**：旧 `config.monitor` 只作为迁移输入和兼容投影存在；迁移成功后核心配置删除旧域，新路径优先。

## D5：旧 Monitor 状态采用渐进式、可回滚迁移

**决策**：识别旧 `config.monitor` 和旧 `code-w monitor report` Hook，使用文件事务原子迁移到 `config-monitor.yaml` 和 observer Hook；保留 `code-w monitor` 兼容别名。

**原因**：已有 Workspace 不能因升级丢失监控配置或破坏写保护/用户 Hook。迁移需要在配置、Hook 和状态文件之间保持一致性。

**保留规则**：

- 用户 Hook 保留；
- 写保护 Hook 保留；
- 其他扩展 Hook 保留；
- 已存在的新 `config-monitor.yaml` 视为用户较新配置，不被旧配置覆盖；
- 迁移失败回滚外层文件事务，不删除旧来源。

## D6：长驻扩展 CLI 与一次性 CLI 分离生命周期

**决策**：一次性 CLI 使用受限同步执行并解析 JSON；长驻 CLI 使用独立异步子进程，`timeoutMs` 只约束启动阶段，Host 转发 SIGINT/SIGTERM 并在退出后清理上下文。

**原因**：Monitor Server 需要持续运行。若把长驻服务放入一次性 `spawnSync` 超时模型，会在服务正常运行时被错误杀死，或者无法正确处理终止信号。

**限制**：长驻 CLI 是生命周期管理，不是安全沙箱；扩展仍属于可信代码。

## D7：扩展 Host 提供故障隔离，不承诺恶意代码安全隔离

**决策**：Host 校验 manifest、入口、摘要、输出、作用域和结果 envelope，并隔离扩展失败对核心事务的影响；不把独立 Node 子进程描述为安全沙箱。

**原因**：当前 Extension Spec 的目标是可信内置扩展的生命周期治理。恶意代码防护需要 OS sandbox、容器或额外权限模型，超出本次范围。

## D8：不修改 Monitor 业务逻辑

**决策**：迁移 Store、HTTP API、Dashboard、SSE、事件映射、统计、Session 失活和 i18n 资源，但保持行为基线不变。

**原因**：本次目标是边界重构和扩展化，不是产品业务变更。这样可以把回归风险集中在安装、Hook、配置、CLI 和生命周期。

## D9：兼容代码有意保留

**决策**：暂时保留 `normalizeMonitor`、`DEFAULT_MONITOR_URL`、旧 `--monitor` 参数、`src/monitor/*` 兼容桥接和 legacy-only managed asset。

**原因**：这些内容用于旧 API、迁移和现有可见测试的非破坏性兼容。新核心流程不依赖它们；贸然删除会把扩展化变更扩大为破坏性清理。

## D10：验证分为契约、运行时和环境限制三类

**决策**：同时执行单元/集成测试、CLI 架构检查、OpenSpec 校验、打包检查和差异格式检查；外部依赖或 sandbox 限制单独标记为 skip，不将其误报为通过。

**结果**：247 项测试中 245 通过、2 跳过、0 失败；CLI 架构检查、`npm run check`、OpenSpec 校验和 `git diff --check` 通过。两个 skip 分别是 Gitee Jira 外部依赖和当前 sandbox 禁止 loopback listener 的 Monitor Server 测试。

## 决策后的不变量

1. Monitor observer 永远不产生写入决策。
2. observer 失败不会改变写保护结果。
3. 核心配置新写入不增加 `monitor` 域。
4. `config-monitor.yaml` 升级和卸载默认保留。
5. 扩展 CLI 入口在执行前必须通过摘要和计划一致性校验。
6. 长驻服务不会被一次性 CLI 超时错误截断。
7. 卸载不能删除用户 Hook、写保护 Hook 或用户运行期数据。
8. 新增扩展不需要修改核心 `ext` registry。
