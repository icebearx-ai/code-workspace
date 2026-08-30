## ADDED Requirements

### Requirement: 任务身份包含生命周期 generation
系统 MUST 使用 `workspaceUuid + provider + nativeSessionId + generation` 唯一标识任务，并为同一原生 session 的新生命周期分配递增 generation。

#### Scenario: 已结束 session 再次启动
- **WHEN** 已经 `ENDED` 的原生 session 收到新的 `SessionStart`
- **THEN** 系统创建新的 generation，且旧 generation 的锁、批准和迟到事件不能影响新任务

### Requirement: 子 Agent 共享父任务身份
系统 MUST 将 Codex 或 Claude 子 Agent 的写入归属于父 session 当前 generation，并且 MUST NOT 为子 Agent 创建独立锁 owner。

#### Scenario: 同一任务的两个子 Agent 写入
- **WHEN** 两个子 Agent 在同一父 session 下发出写入事件
- **THEN** 两个事件使用同一个 taskId，系统不把它们视为跨任务文件冲突

### Requirement: 可信活动标定 ACTIVE
系统 MUST 在 `task.started`、用户提示、权限请求、写入前、写入后及其他可信 Provider 活动事件到达时，把未撤销任务标为 `ACTIVE` 并刷新 `lastSeenAt`、`lastEvent` 与 phase。

#### Scenario: 权限等待保持 ACTIVE
- **WHEN** 任务收到权限请求并等待用户审批
- **THEN** 任务保持 `ACTIVE`，其项目参与关系和文件 claim 继续参与冲突判断

### Requirement: Stop 不结束任务
系统 MUST 把 Provider 的 `Stop` 映射为 turn 结束或等待用户的 phase，且 MUST NOT 仅因 `Stop` 把任务标为 `ENDED` 或释放保护。

#### Scenario: 一次回复完成后等待用户
- **WHEN** Codex 或 Claude 发出 `Stop` 但未发出 `SessionEnd`
- **THEN** 任务仍为 `ACTIVE`，后续同 session 活动仍属于同一 generation

### Requirement: 无新鲜证据时降级 UNKNOWN
系统 MUST 在 `ACTIVE` 任务超过活动阈值未收到可信事件后，于下一次协调或查询时把它标为 `UNKNOWN`，且 MUST NOT 直接标为 `ENDED`。

#### Scenario: SessionEnd 丢失
- **WHEN** 任务超过活动阈值且未收到 `SessionEnd`
- **THEN** 任务变为 `UNKNOWN`，系统记录 `unknownSince` 并保留其保护

#### Scenario: 长时间工具调用
- **WHEN** 工具执行超过活动阈值且仍没有 after-event
- **THEN** 任务变为 `UNKNOWN`，运行中的 reservation 不会因超时被自动释放

### Requirement: UNKNOWN 的新活动只恢复活性
系统 MUST 允许未撤销 generation 的可信新事件把 `UNKNOWN` 恢复为 `ACTIVE`，但 MUST NOT 借此静默释放、转移或重建已有 claim。

#### Scenario: 暂停的 session 恢复
- **WHEN** `UNKNOWN` 任务从同一未撤销 generation 收到新的用户提示事件
- **THEN** 任务恢复为 `ACTIVE`，已有 claim owner 和 revision 保持不变

### Requirement: 只有终止证据产生 ENDED
系统 MUST 仅在收到 `task.ended`，或用户完成合法的 `UNKNOWN` abandon 裁决时，把任务标为 `ENDED`；进程缺失、超时或 Git clean 只能作为证据，不能单独产生 `ENDED`。

#### Scenario: 正常 SessionEnd
- **WHEN** Provider 为当前 generation 发出 `SessionEnd`
- **THEN** 系统把任务标为 `ENDED`、结束其保护效力并保留所有权历史

#### Scenario: 仅检测不到进程
- **WHEN** 系统无法找到一个 `UNKNOWN` 任务的记录进程但没有终止事件或用户裁决
- **THEN** 任务仍为 `UNKNOWN`，进程缺失只显示在裁决证据中

### Requirement: 撤销 generation 拒绝迟到事件
系统 MUST 记录被用户 abandon 的 generation 为 revoked，并拒绝任何试图重新激活或写入该 generation 的迟到事件。

#### Scenario: abandon 后迟到的 PreToolUse
- **WHEN** 已撤销 generation 收到迟到的 `PreToolUse`
- **THEN** 系统返回 `TASK_GENERATION_REVOKED`，不创建 reservation

### Requirement: 生命周期独立于 Monitor
生命周期核心 MUST 从本地 Hook 事件和持久台账计算状态，且 MUST NOT 读取 Monitor 可用性、Monitor URL 或 Monitor 内存状态来决定 `ACTIVE`、`UNKNOWN` 或 `ENDED`。

#### Scenario: Monitor 未启动
- **WHEN** Monitor 未配置或不可访问
- **THEN** Codex/Claude 任务状态转换和写入协调仍按相同规则工作

