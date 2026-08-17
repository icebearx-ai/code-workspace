## Why

Monitor 目前依赖 Agent 正常执行 `SessionEnd` hook 才能结束会话；当 Codex 或其他 Agent 意外退出时，会话及其轮次会长期保持活跃，导致 Workspace 状态和统计失真。需要为缺失退出信号的情况提供可靠的失活判定，并允许用户清理不再需要的会话记录。

## What Changes

- Monitor 根据服务端最后接收信号时间，将连续 10 分钟无信号且未明确结束的 Session 判定为非活跃。
- 非活跃 Session 收到新信号后自动恢复活跃，明确结束的 Session 保持结束状态。
- Workspace 和全局汇总区分历史 Session 总数与活跃 Session 数，过期 Session 不再影响运行中、等待授权等活跃状态。
- Session 视图显示失活状态和最后信号时间，并提供带确认提示的删除操作。
- 新增按 Workspace 和 Session 标识删除会话的 Monitor API，同时清理关联事件并通知页面刷新。

## Capabilities

### New Capabilities

- `monitor-session-lifecycle`: 定义 Monitor Session 的超时失活、状态恢复、统计投影、展示和删除行为。

### Modified Capabilities

无。

## Impact

- 影响 `src/monitor/index.js` 中的内存 Store、快照投影和 HTTP API。
- 影响 `src/monitor/page.js` 中的统计、Workspace/Session 状态展示、定时刷新和删除交互。
- 影响 Monitor 中英文文案和 `src/__test__/monitor.test.js` 回归测试。
- 不改变 Agent hook 上报协议，也不引入新的运行时依赖或持久化格式。
