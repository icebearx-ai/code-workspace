# Monitor Session Lifecycle

## Purpose

定义 Monitor 对 Session 失活判定、统计展示、状态刷新和显式删除的统一行为，避免 Agent 意外退出后会话长期保持假活跃状态。

## Requirements

### Requirement: Monitor 判定 Session 活跃生命周期
Monitor 必须（SHALL）以服务端最后接收信号时间为准，将未明确结束且连续 10 分钟未收到信号的 Session 投影为 `INACTIVE`；明确收到结束信号的 Session 必须保持 `ENDED`。

#### Scenario: Session 在阈值前保持活跃
- **WHEN** 未结束 Session 距离最后信号不足 10 分钟
- **THEN** Monitor 快照将该 Session 返回为 `ACTIVE`

#### Scenario: Session 达到阈值后变为非活跃
- **WHEN** 未结束 Session 距离最后信号达到或超过 10 分钟
- **THEN** Monitor 快照将该 Session 返回为 `INACTIVE`

#### Scenario: 非活跃 Session 恢复
- **WHEN** `INACTIVE` Session 收到新的合法信号
- **THEN** Monitor 更新最后信号时间，并在后续快照中将其返回为 `ACTIVE`

#### Scenario: 已结束 Session 不被超时覆盖
- **WHEN** Session 已明确结束且时间继续推进
- **THEN** Monitor 仍将该 Session 返回为 `ENDED`

### Requirement: Monitor 提供一致的 Session 统计
Monitor 必须（SHALL）在快照中区分保留的 Session 总数与 `ACTIVE` Session 数；`INACTIVE` 和 `ENDED` Session 不得影响活跃 Session 数或 Workspace 的运行中、等待授权状态。

#### Scenario: Session 超时后活跃统计减少
- **WHEN** Workspace 中一个活跃 Session 因 10 分钟无信号变为 `INACTIVE`
- **THEN** Workspace 和全局活跃 Session 数各减少一，Session 总数保持不变

#### Scenario: 非活跃 Turn 不产生 Workspace 活跃状态
- **WHEN** `INACTIVE` Session 中保留状态为 `RUNNING` 或 `WAITING_APPROVAL` 的 Turn
- **THEN** 页面不使用这些 Turn 将 Workspace 标记为运行中或等待授权

### Requirement: Session 视图展示失活信息
Monitor 页面必须（SHALL）展示 Session 的有效状态和最后信号时间，并在没有 SSE 更新时定期重新获取快照，以反映时间驱动的失活变化。

#### Scenario: 页面展示超时 Session
- **WHEN** 快照包含 `INACTIVE` Session
- **THEN** Session 卡片显示“非活跃”、最后信号相对时间和 10 分钟无信号说明

#### Scenario: 页面在无新事件时刷新状态
- **WHEN** 页面已连接且 10 秒内没有新 SSE 事件
- **THEN** 页面重新获取快照，使到达失活阈值的 Session 能够更新状态

### Requirement: 用户可以删除单个 Session
Monitor 必须（SHALL）提供按 Workspace UUID 和 Session ID 删除单个 Session 的 API 与页面操作；删除必须同时移除该 Session 的关联事件并发布更新通知，但不得自动删除 Workspace。

#### Scenario: 删除存在的 Session
- **WHEN** 客户端删除指定 Workspace 中存在的 Session
- **THEN** API 返回成功，后续快照不包含该 Session 或其关联事件，并更新 Workspace 统计

#### Scenario: 删除不存在的 Session
- **WHEN** Workspace 或 Session 不存在
- **THEN** API 返回 `404`，且不修改其他 Workspace 或 Session

#### Scenario: 删除最后一个 Session
- **WHEN** 用户删除 Workspace 中最后一个 Session
- **THEN** Workspace 保留，Session 总数和活跃 Session 数均为零

#### Scenario: 删除后的 Session 重新出现
- **WHEN** 已删除 Session ID 后续收到新信号
- **THEN** Monitor 按新 Session 重新创建记录

#### Scenario: 页面确认删除活跃 Session
- **WHEN** 用户请求删除仍为 `ACTIVE` 的 Session
- **THEN** 页面要求确认，并说明后续新信号会使 Session 重新出现
