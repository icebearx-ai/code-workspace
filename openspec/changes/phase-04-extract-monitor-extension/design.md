## Context

前三阶段建立通用 CLI、配置和 observer Hook 后，Monitor 可以作为首个真实运行时扩展验证平台。此时核心 Monitor 仍完整存在，因此本阶段可以采用对等实现策略，而不必立即承担默认切换和迁移风险。

## Goals / Non-Goals

**Goals:**

- 将 Monitor Server、Store、Page、i18n、事件映射和资源打包为内置 `monitor` 扩展。
- 通过通用 `ext` 启动服务，通过扩展配置读取用户设置，通过 observer 消费 Codex/Claude 事件。
- 保持 Monitor 现有业务规则、API、Dashboard 和测试结果不变。
- 扩展必须可显式安装、升级和卸载，但默认行为仍使用核心 Monitor。

**Non-Goals:**

- 不修改 init/update 默认选择。
- 不迁移 `config.monitor` 和旧 Hook。
- 不删除核心 Monitor。
- 不改变 `code-w monitor` 行为。
- 不改变十分钟失活、统计、删除 API 或页面交互。

## Decisions

### D1: Monitor 使用一个扩展包，但不侵占核心命名空间

扩展 ID 为 `monitor`，运行入口通过 `code-w ext monitor` 调用。核心 Monitor 命令继续独立存在。新旧入口共享测试 fixture 和快照，但不得共享可变全局 Store，避免对等测试相互污染。

### D2: 全局服务与 Workspace 安装状态分离

Monitor Service 使用 global runtime scope；Workspace 安装只负责扩展状态、配置文件和 observer Hooks。一个 Workspace 的卸载不得停止或删除全局 runtime，也不得删除其他 Workspace 的配置。

### D3: Monitor 配置只由扩展解释

扩展使用第二阶段配置文件能力声明 `config-monitor.yaml`，默认值覆盖原有 enable/url 语义。核心在本阶段仍按 `config.monitor` 运行旧 Monitor；扩展读取自己的配置。两者同时存在时不得互相改写。

### D4: Monitor observer 只上报事实

Codex/Claude observer 使用第三阶段协议归一化 Session、Turn、Tool、Subagent 和 Permission 事件，再映射到现有 Monitor API。observer 不返回 deny，不访问写保护状态，也不要求核心理解 Monitor 事件映射。

### D5: 业务迁移以行为对等为目标

现有 Store、HTTP 路由、页面字符串、i18n locale registry、事件 ID 规则、Session 失活和统计行为直接迁移或包装。允许包内模块重排，不允许借迁移修改业务语义。

## Risks / Trade-offs

- 两份 Monitor 实现并存增加维护成本 → 仅作为第四阶段临时状态，第五阶段完成默认切换，第六阶段清理。
- 扩展依赖核心模块会削弱边界 → 运行时扩展只能依赖公开 Host context 和其自身包；若必须复用核心协议，应先加入第三阶段通用 API。
- 资源打包和摘要计算增大包体 → 复用现有资源，不在本阶段压缩或转换媒体格式。
- 对等测试容易只覆盖 happy path → 必须复用旧 Monitor 的 API、SSE、失活、删除、i18n 和错误测试矩阵。

## Migration Plan

1. 创建扩展包和显式安装入口，不修改默认配置。
2. 迁移业务模块并运行扩展专用测试。
3. 对旧核心 Monitor 和扩展运行同一组契约场景，记录差异并修至对等。
4. 默认路径保持核心；用户可显式安装并选择扩展进行试用。
5. 回滚时卸载扩展并继续使用核心 Monitor，不触碰旧配置。

## Open Questions

- 扩展实现是否允许通过兼容桥接复用 `src/monitor`，还是第四阶段必须完全私有化代码；应优先选择无核心 Monitor import 的私有实现。
- global runtime 的发现由包内 catalog 提供，还是引入机器级 registry；首版应选择更小的包内可信 runtime 模型。
