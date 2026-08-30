# Task Write Coordination Specification

## Purpose

定义跨 Agent 任务的项目参与、文件范围互斥、写入预约、dirty claim、UNKNOWN 裁决、并发事务和审计历史，确保写入安全、可恢复且不依赖用户无感知的强制覆盖。

## Requirements

### Requirement: 项目保护允许经确认的并行写入
系统 MUST 在任务第一次成功准备项目写入时建立项目参与关系；当另一个任务准备写同一项目的非重叠范围时，系统 MUST 在写入前告知用户并要求确认，而不是永久排斥第二个任务。

#### Scenario: 同项目不同文件
- **WHEN** task-A 已参与项目并写入 `src/a.js`，task-B 准备写入不重叠的 `src/b.js`
- **THEN** 系统返回 `CONFIRM_PROJECT`，用户批准且 task-B 重试后允许 task-B 建立自己的参与关系和 reservation

### Requirement: 项目批准绑定任务 generation
项目并行批准 MUST 绑定 project real path、requester generation 与 owner generation；任一 generation 结束、撤销或从 `ACTIVE` 变为 `UNKNOWN` 时，旧批准 MUST 失效。

#### Scenario: 已批准 owner 变为 UNKNOWN
- **WHEN** task-B 已获准与 task-A 并行，但 task-A 随后变为 `UNKNOWN`
- **THEN** task-B 的下一次写入不能复用旧批准，系统生成包含新状态证据的确认或裁决请求

### Requirement: 写入前文件预约是强制互斥
系统 MUST 在允许 Provider 执行实际写入前创建 `WRITE_RESERVATION`，并 MUST 对其他 task generation 的重叠写入强制拒绝；项目批准不能覆盖文件范围冲突。

#### Scenario: 两个任务同时预约同一文件
- **WHEN** task-A 与 task-B 并发请求预约同一规范化文件
- **THEN** 只有先提交 ledger 事务的任务获得 reservation，另一个任务收到强制拒绝

### Requirement: ACTIVE 文件冲突不可覆盖
当重叠 claim 的 owner 为 `ACTIVE` 时，系统 MUST 返回 `DENY_FILE_CONFLICT`，并 MUST NOT 提供 `--force`、用户确认或批准项目并行的绕过路径。

#### Scenario: 用户已经批准同项目并行
- **WHEN** 两个任务已有项目并行批准，但后来的工具准备写入前一个 `ACTIVE` 任务持有的同一文件
- **THEN** 系统仍强制拒绝该工具并指出 owner task 与冲突范围

### Requirement: 多范围登记全有或全无
一次工具调用包含多个文件或目录范围时，系统 MUST 在一个 ledger 事务中检查并登记全部规范化范围；任一范围冲突时 MUST 不登记任何新范围。

#### Scenario: 十个目标中的一个冲突
- **WHEN** 格式化工具声明十个文件且其中一个被其他任务持有
- **THEN** 整个工具调用被拒绝，另外九个文件也不会留下 reservation

### Requirement: 范围重叠覆盖文件目录和项目
系统 MUST 识别 `EXACT_FILE`、`DIRECTORY_TREE` 和 `PROJECT_WIDE` 范围，并按文件相同、目录祖先/后代以及项目全范围关系判定重叠。

#### Scenario: 文件落在已预约目录内
- **WHEN** task-A 持有 `src/generated/` 的 tree reservation，task-B 准备写 `src/generated/a.js`
- **THEN** 系统把两个范围判定为重叠并执行文件冲突规则

### Requirement: 未知写入范围使用项目级强 reservation
对可能写入但不能可靠提取目标的工具，系统 MUST 使用 `PROJECT_WIDE` reservation；存在其他任务参与或 claim 时 MUST 返回 `DENY_UNKNOWN_WRITE_SCOPE`，且用户不能用保护性项目确认覆盖。

#### Scenario: 并发项目中运行未知脚本
- **WHEN** 项目已有 task-A 的参与关系，task-B 请求运行无法确定写入目标的脚本
- **THEN** 系统强制拒绝 task-B，并解释无法证明脚本不会修改 task-A 的文件

#### Scenario: 未知脚本独占执行期间出现新任务
- **WHEN** task-A 已取得 `PROJECT_WIDE` reservation，task-B 准备写该项目任意文件
- **THEN** task-B 被当作范围重叠强制拒绝

### Requirement: 工具结束后转换 reservation
系统 MUST 使用 operationId 关联 before/after 事件，并在 after-event 后根据实际 fingerprint 和路径级 Git 状态释放 reservation、转换为 `DIRTY_CLAIM` 或只保留历史。

#### Scenario: 工具成功但文件内容未变
- **WHEN** 写工具完成且目标的当前 fingerprint 与写入前一致
- **THEN** 系统释放 reservation，不创建 dirty claim

#### Scenario: 工具报告失败但留下修改
- **WHEN** 工具发出失败事件但目标文件已经发生变化并处于 dirty 状态
- **THEN** 系统释放运行中 reservation 并创建 `DIRTY_CLAIM`

### Requirement: ACTIVE dirty-to-clean 自动释放
当 `DIRTY_CLAIM` owner 为 `ACTIVE` 且 tracked 文件变为 Git clean，或非 Git 文件恢复到写入前 fingerprint 时，系统 MUST 自动停止该 claim 的互斥效力并保留历史。

#### Scenario: 用户提交 ACTIVE 任务留下的文件
- **WHEN** `ACTIVE` task-A 的 dirty 文件经用户处理后从 dirty 变为 clean
- **THEN** 下一次协调检查释放 task-A 对该文件的 dirty claim，后续任务可重新参与完整检查

### Requirement: UNKNOWN dirty-to-clean 不自动释放
当 `DIRTY_CLAIM` owner 为 `UNKNOWN` 时，系统 MUST NOT 因文件 clean 或 fingerprint 恢复而自动释放；系统 MUST 把该变化作为用户裁决证据。

#### Scenario: UNKNOWN 文件已经 clean
- **WHEN** task-A 为 `UNKNOWN` 且其 dirty claim 对应文件已经 clean
- **THEN** 冲突任务收到 `UNKNOWN_OWNER_DECISION_REQUIRED`，提示文件已 clean 并提供 keep、release 与 inspect 选项

### Requirement: UNKNOWN reservation 只能保留或放弃 generation
对 `UNKNOWN` owner 的 `WRITE_RESERVATION`，系统 MUST 禁止只释放单个 reservation；合法的解除操作 MUST 原子地把 owner generation 标为 `ENDED/USER_ABANDONED`、撤销迟到事件并结束该 generation 全部保护效力。

#### Scenario: 写入前中止且文件未变化
- **WHEN** task-A 已创建 reservation、尚未修改文件便意外中止，并在超时后成为 `UNKNOWN`
- **THEN** 系统保留 reservation，展示文件未变化和运行时证据，并允许用户 keep 或 abandon 整个 generation

#### Scenario: 已知旧进程仍存活
- **WHEN** 用户尝试 abandon 一个 `UNKNOWN` reservation 且运行时证据明确表明旧 Agent 或工具进程仍存活
- **THEN** 系统拒绝释放并提示先停止该进程后重新采集证据

### Requirement: UNKNOWN 裁决具有竞态保护
每个裁决请求 MUST 绑定 ledger revision、owner generation、claim revision 与 evidence hash；应用决定时 MUST 在 ledger mutex 下重新验证，过期决定 MUST 返回 `TASK_DECISION_STALE`。

#### Scenario: 用户查看后 claim 已变化
- **WHEN** 用户确认前 owner、claim 或文件证据已经变化
- **THEN** 系统不应用旧决定，要求重新查看更新后的情况

### Requirement: 裁决后请求者必须重新检查
用户裁决 MUST 只更新 owner 状态、claim 或项目批准，MUST NOT 直接为被阻断工具授予 reservation；请求任务必须重新执行完整 `write.before`。

#### Scenario: UNKNOWN owner 被 abandon
- **WHEN** 用户成功 abandon 冲突 owner
- **THEN** 原请求仍未取得文件所有权，只有重试并再次通过全部冲突检查后才能写入

### Requirement: 台账检查与登记原子化
系统 MUST 使用 Workspace 专属的单一 `proper-lockfile` mutex 串行化 ledger 的检查和登记，并通过原子写入提交递增 revision。

#### Scenario: 并发进程读到同一旧状态
- **WHEN** 两个 Hook 进程几乎同时请求同一空闲文件
- **THEN** mutex 使第二个事务在第一个提交后重新观察 ledger，两个进程不能都成功

### Requirement: 协调不得产生等待死锁
系统 MUST NOT 在持有 ledger mutex 时等待用户、运行工具、执行 Git 或获取另一把协调 mutex；资源冲突 MUST 立即返回诊断而不是等待 claim 释放。

#### Scenario: 用户长时间不处理确认
- **WHEN** 项目确认等待数小时
- **THEN** 没有进程持有 ledger mutex，其他项目和只读查询仍可继续

#### Scenario: ledger mutex 暂时繁忙
- **WHEN** Hook 无法在有界时间内取得 mutex
- **THEN** 当前写入 fail closed 并返回 `RETRY_COORDINATION_FAILURE`，而不是无限等待

### Requirement: 文件状态检查不扩大 mutex 临界区
系统 MUST 在 ledger mutex 外运行 path-level Git 和 fingerprint 检查，并在提交前通过 revision 二次校验防止检查结果过时。

#### Scenario: Git 检查期间 ledger 改变
- **WHEN** Git 状态采集期间另一个事务更新相关 claim
- **THEN** 当前事务检测 revision 不匹配并重试或安全拒绝，不基于旧证据释放或登记

### Requirement: 任务结束保留所有权历史
任务 `ENDED` 后，系统 MUST 停止其 reservation、dirty claim 和项目参与关系的冲突效力，同时 MUST 保留文件、Git 状态、操作和解除原因的审计历史。

#### Scenario: 正常任务结束但文件仍 dirty
- **WHEN** task-A 发出 `SessionEnd` 时历史中包含 dirty 文件
- **THEN** task-B 不再因 task-A 被强制阻断，但用户仍可查询 task-A 曾修改该文件的记录

### Requirement: 台账异常 fail closed
台账解析失败、schema 不兼容或原子提交失败时，系统 MUST 阻断当前写入、保留原文件并返回台账位置、错误原因和恢复建议，MUST NOT 静默创建空 ledger。

#### Scenario: ledger JSON 损坏
- **WHEN** Hook 读取到无法解析的 ledger
- **THEN** 写入被拒绝并收到结构化协调错误，既有 owner 信息不会被空状态覆盖
