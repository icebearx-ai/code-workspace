## Context

Monitor 将 hook 事件保存在进程内存中，并以 Workspace、Session、Turn 三层结构生成快照。当前 Session 只有 `ACTIVE` 和 `ENDED` 两种生命周期结果，且页面只有收到 SSE 事件时才重新读取快照；因此缺失 `SessionEnd` 时，历史 Turn 的 `RUNNING` 或 `WAITING_APPROVAL` 会无限期影响 Workspace 状态。

本次改动跨越 Store 快照、HTTP API、页面统计和浏览器本地告警，但不改变 hook 事件协议或内存存储边界。

## Goals / Non-Goals

**Goals:**

- 以 Monitor 服务端接收信号的时间为准，稳定判定连续 10 分钟无信号的 Session 为非活跃。
- 保留非活跃 Session 的诊断历史，同时从活跃统计和 Workspace 运行状态中排除它。
- 允许删除单个 Session 及其关联事件，并保持新信号可重新创建同标识 Session。
- 让页面在没有新 SSE 信号时仍能及时反映超时变化。

**Non-Goals:**

- 不持久化 Monitor 数据，不在进程重启后恢复 Session。
- 不增加 Agent 心跳协议，也不要求所有 Agent 实现新的 hook。
- 不把 10 分钟阈值加入 Workspace 配置或 CLI 公共选项。
- 不自动删除超时 Session 或空 Workspace。

## Decisions

### 使用服务端接收时间维护活跃性

Store 在接收事件时用可注入的服务端时钟写入 `lastSignalAt`，事件原有 `timestamp` 继续用于事件展示。这样不会因 Agent 时钟漂移或补发旧事件而错误失活；测试可通过注入时钟覆盖边界条件。

### 在快照投影中计算有效状态

Store 保留明确的结束状态，`snapshot()` 为每个 Session 投影有效状态：明确结束为 `ENDED`，否则超过阈值为 `INACTIVE`，其余为 `ACTIVE`。相比后台定时器，这种方式没有额外生命周期清理；页面每 10 秒重新获取快照，超时展示延迟上限约为 10 秒。

快照同时生成全局 `summary` 以及 Workspace 的 `sessionCount`、`activeSessionCount`，让统计口径由服务端统一定义。历史 Session 总数继续保留，活跃 Session 数在失活时减少。

### 活跃聚合只读取活跃 Session

页面计算 Workspace 的等待授权、运行中和活跃状态时，只读取 `ACTIVE` Session 下的 Turn。`INACTIVE` Session 仍展示原始 Turn 历史，但不会产生幽灵运行状态；与非活跃、结束或已删除 Session 关联的本地授权提示会在快照刷新时清理。

### Session 删除沿用 Workspace 删除语义

新增嵌套路由 `DELETE /api/v1/workspaces/:workspaceUuid/sessions/:sessionId`。Store 原子删除 Session、相关事件并更新 Workspace 事件数，随后通过现有 SSE 发布删除通知。删除最后一个 Session 不删除 Workspace；后续同标识信号会重新创建 Session。

### 删除所有状态的 Session

页面对活跃、非活跃和结束 Session 都提供删除操作。活跃 Session 的确认文案明确说明它可能在新信号到达后重新出现，避免 API 增加难以保持一致的状态限制。

## Risks / Trade-offs

- [短暂停顿超过 10 分钟的 Agent 会显示为非活跃] → 新信号到达后自动恢复，不丢失历史。
- [页面依靠轮询观察时间驱动的状态变化] → 轮询间隔为 10 秒，复用无状态快照计算，避免后台 timer 泄漏。
- [删除活跃 Session 后可能迅速重新出现] → 删除确认中提示重建语义。
- [浏览器本地旧版告警可能缺少 Session 标识] → 只自动清理能够可靠关联 Session 的告警，无法关联的旧告警保留原有人工确认行为。

## Migration Plan

该改动只为内存对象和 JSON 快照增加字段，不需要持久化迁移。部署后已有进程内 Session 在下一次信号或快照中获得兼容的最后信号时间回退值；回滚只需恢复 Monitor 代码，Agent hook 无需变更。

## Open Questions

无。
