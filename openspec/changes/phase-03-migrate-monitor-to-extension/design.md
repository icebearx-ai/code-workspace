## Context

phase-01 和 phase-02 提供了用户级 Package Store、Workspace activation 和通用 Runtime Host。Monitor 是第一个需要多个 Workspace 共享一个服务的扩展；其业务实现必须离开核心，但每个 Workspace 仍需独立决定是否启用观察 Hook。

## Goals / Non-Goals

**Goals:**

- 将 Monitor Server、Store、HTTP API、Dashboard、i18n 和事件映射放入 `extensions/monitor`。
- 每个 Workspace 只安装 Monitor activation 和观察 Hook。
- 由 Runtime Host 启动单一 user/global Monitor service 聚合多个 Workspace。
- 保持 Session 生命周期、统计、删除、SSE 和页面行为对等。
- 固定 Monitor 版本 pin、service identity 和兼容组策略。
- 让核心可以在后续 Change 删除 `src/monitor`，不保留 Monitor 业务桥接。

**Non-Goals:**

- 不实现远程下载或独立扩展市场。
- 不支持同一用户下不兼容 Monitor service 并行运行。
- 不改变 Monitor 业务规则或数据清理策略。
- 不在本 Change 删除已有核心 Monitor，删除作为后续独立清理步骤。

## Decisions

### D1: Monitor 包含 workspace activation 和 global service 两个入口

`init.js` 负责 Workspace Hook/config 制品，`runtime/serve.js` 负责全局聚合服务。两者共享同一个版本化扩展包，但由 Host 以不同 execution scope 调用。

### D2: Monitor 数据使用用户级目录

聚合 Store、服务锁和运行数据不写入任何 Workspace。Workspace 只保存自身 identity、activation 和上报配置；服务接收事件后自行维护跨 Workspace 状态。

### D3: 单一 service identity 与兼容组

Monitor manifest 声明固定 `service.id = monitor` 和兼容组。Host 只允许一个兼容组的 Monitor service；扩展版本可以在 Store 中并存，但 activation 必须通过服务兼容性检查。

### D4: Hook 只上报事实且 failure-open

Workspace Observer Hook 将 Session、Turn、Tool、Subagent 和 Permission 事实发送到 Monitor service。服务不可达、超时或异常时 Hook 不得阻断 Agent 行为。

### D5: 兼容命令只做路由

`codew monitor` 解析保留的常用参数后转换为 `codew ext monitor serve`，不得 import Monitor 业务模块或维护第二套服务生命周期。

## Risks / Trade-offs

- [全局服务不可达] → Observer failure-open，记录受限诊断，不影响 Agent。
- [Monitor 版本不兼容] → Host 依据兼容组拒绝静默共享，并要求显式升级或保持当前版本。
- [核心与扩展行为漂移] → 迁移前复用同一 API、SSE、页面和生命周期测试矩阵。
- [服务退出导致事件丢失] → Hook 只保证尽力上报；服务恢复后不改变已提交 Workspace 制品。
- [扩展误依赖核心] → 包内 lint/test 禁止 `extensions/monitor` import `src/monitor`。

## Migration Plan

1. 将 Monitor 业务模块复制或重排到扩展包，并建立独立运行入口。
2. 为新 Workspace 安装 Monitor activation，生成观察 Hook 和上报配置。
3. 对已有 Workspace 迁移旧 Monitor 配置/Hook，迁移失败保留旧来源。
4. 用 Runtime Host 启动扩展 Monitor service，运行核心与扩展对等测试。
5. 保留兼容 `codew monitor`，观察一个发布周期后再进入核心清理 Change。

## Open Questions

- 旧 `config.monitor.url` 是否直接迁移为 Workspace 上报端点，还是拆分为服务配置和 Workspace 覆盖。
- Monitor service 的默认版本选择是否固定为当前最高兼容组版本。
