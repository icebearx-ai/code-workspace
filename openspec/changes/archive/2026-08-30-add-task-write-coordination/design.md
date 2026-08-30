## Context

Code Workspace 当前已有 Workspace UUID、项目 real path、原子文件写入、`proper-lockfile` 和 Codex 生命周期 Hook 模板，但现有 Hook 只服务于 Monitor，且 `PostToolUse` 无法在写入发生前阻止冲突。仓库尚未提供 Claude Hook 模板，也没有跨 Codex/Claude 的任务身份、并发写入台账或恢复协议。

本设计处理两种性质不同的风险：

1. 两个任务在同一项目写不同文件是允许的，但必须先让用户知道并确认；
2. 两个任务可能同时写同一个文件是不可接受的，必须在写入前阻断。

这里的“任务”是写入所有权的最小单位。任务内部的子 Agent、并行工具调用和 Provider 自己的调度共享父任务身份，不形成新的跨任务竞争者。核心状态不依赖 Monitor、网络服务或常驻 Broker；每个 Hook 和 CLI 进程直接访问本机持久化台账。

Codex 与 Claude 当前都提供会话事件、`PreToolUse`、成功/失败后的工具事件、`Stop` 和 `SessionEnd`。两者都能在 `PreToolUse` 阻断受支持的工具调用，但 Hook 不是 OS 文件系统沙箱，因此强制保证只覆盖经过已安装、已启用且未被绕过的 Hook 入口。

## Goals / Non-Goals

**Goals:**

- 在同项目不同文件并行写入前生成一次可审计的用户确认。
- 在目标范围有重叠时强制拒绝后来的写入，不提供覆盖按钮。
- 使用 `ACTIVE | UNKNOWN | ENDED` 表达任务状态，不用超时伪造任务结束。
- 让每一个 `UNKNOWN` 冲突都由用户根据完整证据裁决，且裁决过程不产生新的竞态。
- 确保“写入前已经预约、尚未实际修改、任务随后崩溃”具有确定、可发现、可执行的恢复路径。
- 使多文件写入登记具有全有或全无语义，并避免锁顺序死锁和用户交互死锁。
- 通过 Provider 无关协议接入 Codex 与 Claude，后续 Provider 只新增适配层。
- 保持协调核心在 Monitor 未启动、不可用或完全移除时仍可运行。

**Non-Goals:**

- 不协调同一任务内部的子 Agent 竞争。
- 不实现完整 Scope Broker、分布式租约或跨机器一致性。
- 不拦截绕过 Agent Hook 的编辑器、用户 shell、外部进程或未受支持 Provider 的写入。
- 不把 Git dirty 当成写入前互斥锁，也不要求任务结束前必须提交或清理修改。
- 不让 Monitor 决定任务状态、持有锁或参与放行决策；Monitor 最多作为未来的只读观察者。
- 不尝试通过通用 shell 文本解析证明任意脚本的精确写入集合。

## Decisions

### 1. 使用稳定任务 generation，而不是仅使用 session ID

任务主键为：

```text
workspaceUuid + provider + nativeSessionId + generation
```

`taskId` 是该主键的稳定摘要和可读短 ID。`generation` 用于区分同一个原生 session 的不同生命周期代次，避免用户放弃一个 `UNKNOWN` 任务后，迟到事件把旧任务重新激活。只有新的 `SessionStart` 可以在已结束或已撤销的原生 session 上创建下一代；被撤销 generation 的其他迟到事件返回 `TASK_GENERATION_REVOKED`。

子 Agent 的 `agent_id`、`agent_type` 等字段只作为证据保存；适配器始终把其写入归入父 session 的当前 generation。

### 2. 三态任务模型与事件标定

任务记录至少包含：

```json
{
  "taskId": "codex-a1b2c3-g2",
  "workspaceUuid": "...",
  "provider": "codex",
  "nativeSessionId": "...",
  "generation": 2,
  "status": "ACTIVE",
  "phase": "TOOL_RUNNING",
  "startedAt": "...",
  "lastSeenAt": "...",
  "lastEvent": "write.before",
  "unknownSince": null,
  "endedAt": null,
  "endReason": null,
  "runtimeEvidence": {}
}
```

状态转换如下：

| 输入 | 原状态 | 新状态 | 说明 |
| --- | --- | --- | --- |
| `task.started` 或首个可信活动事件 | 不存在 | `ACTIVE` | 分配 generation，记录启动原因 |
| `task.activity`、`write.before`、`write.after`、权限请求 | `ACTIVE` | `ACTIVE` | 刷新 `lastSeenAt` 和证据 |
| `task.turn-ended` / `task.waiting` | `ACTIVE` | `ACTIVE` | `Stop` 只更新 phase，不结束任务 |
| 超过 15 分钟未收到可信事件 | `ACTIVE` | `UNKNOWN` | 在下一次 Hook/CLI 访问时惰性计算，不释放任何保护 |
| 同一未撤销 generation 再次收到可信事件 | `UNKNOWN` | `ACTIVE` | 仅恢复活性，不自动释放或转移 claim |
| `task.ended` | `ACTIVE` 或 `UNKNOWN` | `ENDED` | `SessionEnd` 是正常结束证据 |
| 用户放弃 `UNKNOWN` generation | `UNKNOWN` | `ENDED` | `endReason=USER_ABANDONED` 且 generation 被撤销 |

15 分钟只决定“证据是否新鲜”，不是锁过期时间。进程存在、进程启动时间、父子关系、最后工具名和操作 ID 作为裁决证据，但进程检查不自动把 `UNKNOWN` 改成 `ENDED`。这样不会因 PID 复用、远程会话、长命令或丢失事件误释放。

### 3. 区分三种保护对象

本方案不把所有东西统称为同一种锁：

| 对象 | 语义 | 是否排他 | 用户能否覆盖 |
| --- | --- | --- | --- |
| 项目参与关系 / project guard | 告知同项目存在其他任务写入，并记录任务对批准 | 否 | 可以批准后重试 |
| 文件范围 claim | 阻止两个任务的写入范围重叠 | 是 | `ACTIVE` 不可覆盖；`UNKNOWN` 必须先裁决旧任务 |
| ledger mutex | 串行化台账的检查与登记事务 | 是，但只持有毫秒级 | 不面向用户；失败后重试 |

项目参与关系在任务第一次成功通过写入检查时创建。即使该任务暂时没有 dirty 文件，只要任务仍是 `ACTIVE`，其他任务的首次项目写入仍需确认。批准按 `projectRealPath + requesterGeneration + ownerGeneration` 保存；任一 generation 结束、被撤销或状态变为 `UNKNOWN` 后原批准失效。

同文件判断优先于项目确认。不能用“用户已经批准项目并行”绕过文件 claim。

### 4. 文件 claim 分为预约和 dirty 所有权

`WRITE_RESERVATION` 在 Provider 执行实际工具前创建，记录：

- owner task generation；
- `operationId` / 原生 tool call ID；
- `EXACT_FILE | DIRECTORY_TREE | PROJECT_WIDE` 范围；
- 规范化 project real path 与目标路径；
- 创建时间、工具名、输入摘要；
- 写入前 fingerprint 与 Git 路径状态；
- claim revision。

`write.after` 成功时重新采集 fingerprint 和 Git 状态：

- 未发生变化：释放 reservation，不创建 dirty claim；
- 文件发生变化且仍 dirty：把 reservation 原子转换为 `DIRTY_CLAIM`；
- 文件发生变化后已 clean（例如工具自行提交/还原）：释放 reservation，只写所有权历史；
- 工具明确失败：释放与该 `operationId` 匹配的 reservation；如果仍检测到变化，则仍创建 dirty claim。

`DIRTY_CLAIM` 表示任务已经留下尚未被用户/Git 处理的结果，不表示工具仍在运行。任务为 `ACTIVE` 时，如果后续检查发现 tracked 文件从 dirty 变为 clean，或非 Git/ignored 文件恢复到写入前 fingerprint，则自动停止其互斥效力并保留历史。任务为 `UNKNOWN` 时，即使已经 clean 也只把 `dirtyToClean=true` 放入证据，不自动释放。

任务正常 `ENDED` 时，所有未完成 reservation 和 dirty claim 均停止互斥效力，项目参与关系结束，历史记录继续保留。因为 `SessionEnd` 是 Provider 给出的终止证据；若没有该证据，任务只能进入 `UNKNOWN`。

### 5. 写入范围规范化与重叠规则

目标路径先关联到注册项目，再规范化为项目 real path 下的路径。已存在路径使用 `realpath`；未存在文件使用最近已存在父目录的 `realpath` 再拼接剩余片段。任何逃出 project real path 的 `..`、符号链接或大小写别名都必须在 claim 前被解析或拒绝。

范围重叠规则为：

- 相同规范化文件互相重叠；
- 文件落在另一方 `DIRECTORY_TREE` 内时重叠；
- 两棵目录树存在祖先/后代关系时重叠；
- `PROJECT_WIDE` 与同项目任何写入范围重叠。

一次工具调用的所有范围先规范化、排序、去重，再在同一个 ledger 事务中全部检查和登记。任一范围冲突时不登记任何范围。

### 6. 未知写入范围采用项目级强互斥 reservation

适配器将工具调用分成：

1. 已知只读：不进入写入协调；
2. 可提取 exact/tree 目标：按目标范围登记；
3. 可能写入但无法可靠提取目标：使用 `PROJECT_WIDE`。

当项目已有其他 `ACTIVE`/`UNKNOWN` 参与者或 claim 时，新的 `PROJECT_WIDE` 请求直接返回 `DENY_UNKNOWN_WRITE_SCOPE`，用户不能用项目确认覆盖。反过来，已有 `PROJECT_WIDE` reservation 时，其他任务的任何项目写入都按文件范围冲突强制拒绝。

若项目没有其他任务，`PROJECT_WIDE` 可以执行，并在工具结束后扫描项目路径级 Git 状态，将实际 dirty 文件转为 exact dirty claims。该设计牺牲未知脚本之间的并发度，换取同文件兜底不被一个不可解析脚本绕过。

### 7. 原子台账事务使用单一短时 mutex

台账位于 Workspace 外部的用户状态目录：

```text
<user-state-dir>/code-workspace/task-coordination/<workspace-hash>/ledger.json
<user-state-dir>/code-workspace/task-coordination/<workspace-hash>/ledger.lock
```

平台目录按 `XDG_STATE_HOME`、macOS Application Support、`LOCALAPPDATA` 和安全 fallback 选择；测试可注入专用目录。目录和文件使用当前用户权限，台账不写入项目或 `.code-workspace/`。

`proper-lockfile` 只锁 `ledger.lock` 目标，采用 worker heartbeat、stale 恢复和有界获取。持锁区只允许：读取 ledger、验证 revision、应用纯内存状态转换、`atomicWrite`、释放。不得在持锁期间：

- 询问用户；
- 执行 Provider 工具；
- 运行 Git；
- 等待文件 claim；
- 获取第二把协调 mutex。

需要 Git/fingerprint 证据时采用两阶段乐观流程：

```text
锁内读取相关记录和 ledgerRevision
→ 解锁采集文件/Git/进程证据
→ 再加锁并核对 ledgerRevision、task generation、claim revision
→ 未变化则提交；变化则有界重试或返回 RETRY_COORDINATION_FAILURE
```

台账每次写入增加全局 revision，并使用临时文件 + rename 的原子写入。解析失败或 schema 不兼容时 fail closed，保留损坏文件和最近备份，返回带台账路径及修复建议的结构化错误，绝不静默重建空台账。

### 8. 冲突决策顺序固定

`write.before` 的决策顺序为：

1. 验证任务 generation 和 Provider 事件幂等键；
2. 惰性把超时 `ACTIVE` 标为 `UNKNOWN`，但不释放 claim；
3. 规范化全部范围并采集必要证据；
4. 检查 `PROJECT_WIDE` 和文件/tree 重叠；
5. 重叠 owner 为 `ACTIVE`：返回 `DENY_FILE_CONFLICT`；
6. 重叠 owner 为 `UNKNOWN`：创建或复用 `UNKNOWN_OWNER_DECISION_REQUIRED`；
7. 无重叠但存在未批准的项目参与者：创建 `CONFIRM_PROJECT`；
8. 所有检查通过：原子创建项目参与关系和全部 reservations，返回 `ALLOW`。

Hook 遇到确认或裁决时不保持进程等待。它返回 Provider 原生“拒绝/阻断”结果以及 `decisionRequestId`，用户通过 CLI 处理后，由 Agent 重试原工具调用。这样用户思考时间不会占用 ledger mutex，也不会让 Hook 超时后出现不确定行为。

### 9. `UNKNOWN` 必须人工裁决，并区分 reservation 与 dirty claim

待裁决记录包含：

```text
decisionRequestId
ledgerRevision / evidenceHash
请求任务与 owner 的 taskId、provider、session、generation、status、phase
owner 的 lastEvent、lastSeenAt、unknownSince
claim 类型、范围、operationId、工具、createdAt、claimRevision
写入前/当前 fingerprint、Git 状态、dirty→clean 变化
已知 PID、进程启动标识、是否仍存活及“未知”原因
每个选项的后果、风险和下一步命令
```

可用裁决按对象限制：

- `UNKNOWN + DIRTY_CLAIM`：`KEEP`、`RELEASE_CLAIM`、`INSPECT`；
- `UNKNOWN + WRITE_RESERVATION`：`KEEP`、`ABANDON_TASK_AND_RELEASE`、`INSPECT`；
- `UNKNOWN + 项目参与关系`：`KEEP_AND_BLOCK`、`APPROVE_PROJECT_PARALLEL`、`ABANDON_TASK_AND_RELEASE`、`INSPECT`。

`WRITE_RESERVATION` 不允许只释放单个 claim。因为缺失 after-event 可能意味着旧工具仍在运行；安全恢复必须原子地把整个 owner generation 标为 `ENDED/USER_ABANDONED`、撤销其后续事件、终止其全部保护的互斥效力并写审计历史。如果运行时证据明确显示旧 Agent/工具进程仍存活，`ABANDON_TASK_AND_RELEASE` 必须拒绝并提示用户先停止该进程；证据缺失时明确告知无法证明进程已终止，由用户作最后判断。

裁决命令重新获取 ledger mutex，并校验 decision request 的 ledger revision、owner generation、claim revision 与 evidence hash。任一项变化都返回 `TASK_DECISION_STALE` 并要求重新查看，不应用旧决定。裁决只改变旧 owner 的状态、claim 或项目批准，不直接为请求工具创建 reservation；请求任务必须重新执行完整 `write.before`。

### 10. 意外中止但未修改文件的确定恢复路径

该场景不会自动释放，也不会形成“永远无法处理”的锁：

```text
PreToolUse 创建 WRITE_RESERVATION
→ Agent/Hook/工具在实际写入前异常中止
→ 无 after-event
→ 15 分钟后任务在下一次访问时成为 UNKNOWN
→ 其他任务命中该范围并被阻断
→ 系统展示 fingerprint 未变化、Git clean、进程证据和最后事件
→ 用户选择 KEEP 或 ABANDON_TASK_AND_RELEASE
→ 放弃时原子撤销旧 generation 和全部 reservation
→ 请求任务重新检查并取得 reservation
```

因此锁可能在无人处理期间继续保留，但不会是不可见或无解的永久锁。系统禁止基于“文件没变”自动释放，因为旧工具仍可能尚未开始写；同时保证每次命中都给出任务、状态、证据和一条可执行的恢复命令。

### 11. 统一 Hook 协议与 Provider 适配

内部事件 envelope：

```json
{
  "schemaVersion": 1,
  "eventId": "provider-stable-id-or-hash",
  "eventType": "write.before",
  "provider": "codex",
  "nativeEventName": "PreToolUse",
  "nativeSessionId": "...",
  "workspaceUuid": "...",
  "cwd": "...",
  "occurredAt": "...",
  "agent": { "isSubagent": false, "parentSessionId": null },
  "tool": { "callId": "...", "name": "Edit", "input": {} }
}
```

统一事件集合为：

- `task.started`
- `task.activity`
- `task.waiting`
- `task.turn-ended`
- `write.before`
- `write.after`
- `task.ended`

统一决策集合为：

- `ALLOW`
- `CONFIRM_PROJECT`
- `DENY_FILE_CONFLICT`
- `DENY_UNKNOWN_WRITE_SCOPE`
- `UNKNOWN_OWNER_DECISION_REQUIRED`
- `RETRY_COORDINATION_FAILURE`

Codex 和 Claude 适配器分别负责读取 native stdin、映射事件、提取工具范围、调用唯一协调核心、再渲染 native Hook 返回格式。Hook runner 不经过公共 CLI 结果 renderer，避免 Provider 需要的决策 JSON 与 CLI 稳定 envelope 冲突。Monitor report Hook 与协调 Hook 配置相互独立；协调 Hook 不读取 monitor 配置，也不向 Monitor 发送请求。

Provider 映射最低要求：

| Provider 事件 | 内部事件 |
| --- | --- |
| `SessionStart` | `task.started` |
| `UserPromptSubmit` / `PermissionRequest` | `task.activity` |
| `PreToolUse` | `write.before` 或只读 `task.activity` |
| `PostToolUse` | `write.after(success)` |
| 工具失败事件（若 Provider 提供） | `write.after(failure)` |
| `Stop` | `task.turn-ended`，状态保持 `ACTIVE` |
| `SessionEnd` | `task.ended` |

### 12. CLI 契约遵循现有架构

公共 CLI 只用于观察和人工裁决：

| 命令 | workspace | config | interaction | effects |
| --- | --- | --- | --- | --- |
| `task list` | required | identity, projects | never | read-only |
| `task show <task-id>` | required | identity, projects | never | read-only |
| `task lock list` | required | identity, projects | never | read-only |
| `task decision show <request-id>` | required | identity, projects | never | read-only |
| `task decision keep <request-id> --yes` | required | identity, projects | required | planned-write |
| `task decision approve <request-id> --yes` | required | identity, projects | required | planned-write |
| `task decision release <request-id> --yes` | required | identity, projects | required | planned-write |
| `task decision abandon <request-id> --yes` | required | identity, projects | required | planned-write |

所有命令在 `src/cli/registry.js` 完整声明并由共享 parser 解析。命令处理器只调用 core 的 inspect/plan/apply API，不导入 `src/core/fs.js`，不直接读写台账。planned-write 命令遵循 inspect → plan → stale validation → shared confirmation → core mutation → postcondition verification。JSON 使用共享 schema version 1 envelope；错误包含稳定 code、owner、status、claim、path、evidence 和 remediation。

`release` 只接受 `UNKNOWN DIRTY_CLAIM`；`approve` 只接受项目并行确认；`abandon` 只接受 `UNKNOWN` owner 且必须撤销整个 generation；无命令能够覆盖 `ACTIVE` 文件冲突。

## Risks / Trade-offs

- **[Hook 被禁用、超时或绕过]** → 安装时验证并提示信任 Hook；runner 内部错误 fail closed 并返回合法阻断结果；文档明确这不是 OS 级 enforcement boundary。
- **[任意 shell 的写入范围不可证明]** → 使用 `PROJECT_WIDE` 强互斥 reservation；存在并发时拒绝，不能用项目确认覆盖。
- **[长命令被标为 UNKNOWN]** → UNKNOWN 不自动释放；显示 operation 和进程证据，由用户裁决。
- **[崩溃遗留 reservation]** → 冲突时生成强制裁决，提供 abandon generation 的原子恢复；无静默永久锁。
- **[用户错误放弃仍可能运行的 UNKNOWN 工具]** → 已知进程存活时禁止放弃；证据未知时给出显著风险说明并要求显式确认。没有 OS 级进程监管时无法彻底消除此风险。
- **[Git 检查较慢或仓库很大]** → 使用 pathspec、`--porcelain=v2 -z`，在 mutex 外采集，并只扫描当前操作相关范围。
- **[台账竞争]** → 单 mutex、短临界区、有界重试；协调繁忙时拒绝当前工具并要求重试，不无限等待。
- **[台账损坏]** → 原子写、revision、最近备份、fail closed 和明确修复指引；绝不把损坏解释为空台账。
- **[路径别名绕过重叠检查]** → realpath、最近存在父目录和平台大小写规范化；无法安全解析时扩大到 tree/project 范围或拒绝。
- **[状态事件乱序/重放]** → eventId 幂等、operationId 关联、generation 撤销和 revision 校验；迟到事件不能解锁新 owner 的 claim。

## Migration Plan

1. 先实现纯 core 数据模型、外部状态目录、ledger mutex、原子事务、路径/Git 证据和状态机，不接入任何 Hook。
2. 实现并发及崩溃恢复测试，通过后新增只读 CLI 与裁决 planned-write CLI，并运行 CLI 架构守卫。
3. 实现 Provider 无关 Hook runner 和 Claude/Codex 适配器，使用 fixture 验证相同内部事件与决策。
4. 更新 managed artifacts：分别安装 Codex 与 Claude 协调 Hook；保留 Monitor 配置独立开关。
5. 在默认启用强制阻断前，以诊断模式验证目标提取覆盖率；只有已知写工具启用 exact/tree claim，未知写工具使用 `PROJECT_WIDE`。
6. 发布时对既有 Workspace 通过 `code-w update` 增量安装；没有旧台账可迁移，首次事件创建 schema version 1。

回滚时先移除/禁用协调 Hook，再保留台账为审计数据；旧版本不会读取外部台账。不得先删除台账再保留 Hook，否则 Hook 会失去 owner 证据。台账清理由单独、显式且已确认的维护流程处理。

## Open Questions

- Codex 与 Claude 每个版本的具体工具名和输入字段必须以 adapter fixture 固化；新增或未知工具默认按可能写入处理，而不是静默判为只读。
- 15 分钟 `ACTIVE → UNKNOWN` 阈值先作为 core 常量和测试注入项，运行数据证明需要用户配置后，再新增独立 coordination 配置域；本变更不复用 monitor 配置。
