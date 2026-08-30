## 1. 协调模型与持久化基础

- [x] 1.1 新建 task-coordination core 模块，定义 schema version、task/status/phase、generation、project participation、claim、decision 和 audit 数据结构及严格校验器。
- [x] 1.2 实现跨平台 Workspace 外部状态目录解析，以 workspace UUID 与 canonical real path 生成隔离目录，并支持测试注入且不在项目内创建台账。
- [x] 1.3 基于现有 `proper-lockfile` worker heartbeat 模式实现 Workspace 单 ledger mutex、有界获取、stale mutex 恢复和稳定错误码。
- [x] 1.4 实现 ledger 原子读取/写入、全局 revision、最近备份、权限约束和损坏/schema 不兼容时 fail-closed 诊断。
- [x] 1.5 为 mutex 崩溃恢复、并发提交、原子写失败、损坏 ledger 和跨 Workspace 隔离增加单元及子进程测试。

## 2. 任务身份与三态生命周期

- [x] 2.1 实现 `workspaceUuid + provider + nativeSessionId + generation` 身份解析、可读 taskId、原生 session 当前 generation 绑定和 revoked generation 检查。
- [x] 2.2 实现 `ACTIVE | UNKNOWN | ENDED` 状态机、15 分钟可注入活动阈值、phase/lastEvent/lastSeenAt/unknownSince/endReason 记录和惰性 reconciliation。
- [x] 2.3 实现 `Stop` 保持 ACTIVE、`SessionEnd` 正常结束、UNKNOWN 新活动恢复 ACTIVE、用户 abandon 结束并撤销 generation 的转换规则。
- [x] 2.4 实现子 Agent 到父任务的身份归并以及 agent/runtime/process 证据记录，确保进程证据只辅助裁决、不自动结束 UNKNOWN。
- [x] 2.5 增加完整状态转换表测试，包括权限等待、长命令、SessionEnd 丢失、session 恢复、迟到事件、generation 复用和 Monitor 完全不可用场景。

## 3. 路径、范围、fingerprint 与 Git 证据

- [x] 3.1 实现项目归属解析和安全 canonical path：现有目标 realpath、未创建目标的最近现有父目录、符号链接/`..`/平台大小写处理及逃逸拒绝。
- [x] 3.2 实现 `EXACT_FILE | DIRECTORY_TREE | PROJECT_WIDE` 范围模型、排序去重和文件/目录/项目重叠算法。
- [x] 3.3 实现写入前后 fingerprint（存在性、类型、mode、content hash）与 path-level `git status --porcelain=v2 -z --untracked-files=all -- <paths>` 状态采集。
- [x] 3.4 实现 tracked、untracked、ignored、non-Git 和不存在文件的 dirty/clean 判定及 dirty-to-clean 证据，Git 与 hash 检查全部在 ledger mutex 外执行。
- [x] 3.5 增加符号链接别名、未存在文件、目录祖先关系、Git rename/untracked/ignored、非 Git 文件恢复和大范围 pathspec 的测试。

## 4. 写入前协调与项目保护

- [x] 4.1 实现两阶段乐观 write-before 流程：锁内快照、锁外证据、锁内 revision 重验、有界重试以及 eventId 幂等。
- [x] 4.2 实现固定决策顺序：generation 校验、UNKNOWN reconciliation、范围冲突、UNKNOWN owner、项目并行确认、全量 reservation 原子登记。
- [x] 4.3 实现项目参与关系和按 project/requester generation/owner generation 的批准缓存，并在 owner 状态或 generation 变化时失效。
- [x] 4.4 实现 ACTIVE 同范围 `DENY_FILE_CONFLICT` 且无覆盖路径，以及同项目非重叠范围 `CONFIRM_PROJECT` 后重试放行。
- [x] 4.5 实现 unknown-write 的 `PROJECT_WIDE` 强 reservation，使其与所有项目写入互斥并在已有并发时返回 `DENY_UNKNOWN_WRITE_SCOPE`。
- [x] 4.6 增加真实并发测试：同文件只有一个成功、不同文件生成一次确认、批准后继续、多范围全有或全无、PROJECT_WIDE 双向阻断和 mutex 繁忙安全重试。

## 5. 写入后转换与正常释放

- [x] 5.1 实现 operationId 关联的 write-after success/failure 处理，并防止重复或迟到 after-event 释放其他 operation/generation 的 claim。
- [x] 5.2 实现无变化释放、dirty 转 `DIRTY_CLAIM`、工具失败但留下修改仍建 claim、工具自行 clean 只记历史的原子转换。
- [x] 5.3 实现 ACTIVE dirty-to-clean 自动停止 claim 效力，以及 UNKNOWN dirty-to-clean 只更新证据、不自动释放。
- [x] 5.4 实现正常 `SessionEnd` 结束项目参与和 claim enforcement、保留文件所有权与解除原因历史，并验证旧历史不阻断新任务。
- [x] 5.5 增加工具成功/失败/部分写入、after-event 丢失、重复 after、提交后 clean、还原后 clean 和 ENDED 历史保留测试。

## 6. UNKNOWN 裁决与僵死预约恢复

- [x] 6.1 实现 UNKNOWN 冲突 evidence snapshot 和去重 decision request，包含 task、status、phase、last event、claim、operation、fingerprint、Git、进程及后果说明。
- [x] 6.2 实现 decision plan/apply API 和 ledgerRevision、owner generation、claimRevision、evidenceHash 四重 stale 校验。
- [x] 6.3 实现 `KEEP`、`APPROVE_PROJECT_PARALLEL`、仅限 dirty claim 的 `RELEASE_CLAIM`，并验证动作类型与 owner 状态。
- [x] 6.4 实现仅限 UNKNOWN 的 `ABANDON_TASK_AND_RELEASE` 原子操作：结束/revoke 整个 generation、停止全部保护效力、保留审计历史且不直接授权请求者。
- [x] 6.5 在运行时证据明确显示旧进程存活时拒绝 abandon；证据未知时生成显著风险与停止旧进程的确认说明。
- [x] 6.6 增加核心恢复验收：reservation 后未修改即崩溃、转 UNKNOWN、clean 证据展示、keep、abandon、迟到 Pre/Post 事件拒绝及请求者重新检查后成功。
- [x] 6.7 增加 stale-decision、UNKNOWN dirty 已 clean、UNKNOWN reservation 禁止单 claim release、用户处理期间无 mutex 持有和无资源等待死锁测试。

## 7. Provider 无关 Hook 协议

- [x] 7.1 实现 versioned normalized event/decision envelope、稳定 eventId、operationId、Provider adapter 接口和 native output renderer 接口。
- [x] 7.2 实现显式工具能力表与目标提取框架，支持只读、exact、multi-file、tree、unknown-write；未知工具默认不得判为只读。
- [x] 7.3 实现独立 Hook runner：stdin 解析、Workspace/任务解析、core 调用、native 输出、超时预算和 pre-write 内部异常 fail-closed；runner 不经过公共 CLI renderer。
- [x] 7.4 用 Provider 中立 fixtures 验证相同 normalized event 在不同 adapter 下得到相同 core 决策。

## 8. Codex 与 Claude 适配及托管安装

- [x] 8.1 根据当前官方 Hook schema 实现 Codex adapter，覆盖 SessionStart、活动、PreToolUse、PostToolUse/可用失败事件、Stop 与 SessionEnd，并为每种事件建立 fixture。
- [x] 8.2 根据当前官方 Hook schema 实现 Claude adapter，覆盖 SessionStart、活动、PreToolUse、PostToolUse、PostToolUseFailure、Stop/StopFailure 与 SessionEnd，并为每种事件建立 fixture。
- [x] 8.3 更新 Codex managed hooks 组合逻辑，新增独立协调 Hook，保留扩展 Hook 和可选 Monitor Hook，避免用 PostToolUse 充当写入前阻断。
- [x] 8.4 实现 Claude settings/hooks 的结构化合并与验证，保留用户字段、现有 permissions 和非本功能 Hook，并支持 update/rollback。
- [x] 8.5 更新 artifact manifest、initializer、update、managed-file 状态和用户指南，使选择 codex/claude 工具时安装对应协调 Hook，并明确 Hook 信任与非 OS 级边界。
- [x] 8.6 增加 Codex/Claude managed artifact 幂等、用户配置保留、失败回滚、Monitor 禁用/失败不影响协调和子 Agent 共享 taskId 的集成测试。

## 9. 任务协调 CLI

- [x] 9.1 在 registry 声明 `task list`、`task show`、`task lock list`、`task decision show|keep|approve|release|abandon` 的完整 workspace/config/interaction/effects/options 契约并接入 dispatch。
- [x] 9.2 实现只读 task/lock/decision handlers，使用 core inspect API 和共享 result model 输出 task、owner、status、evidence、历史及 remediation。
- [x] 9.3 实现 decision planned-write handlers：inspect → plan → validate → shared confirmation → apply →完整 postcondition verify，JSON/非 TTY 未传 `--yes` 时拒绝。
- [x] 9.4 为 ACTIVE 文件冲突、UNKNOWN dirty claim、UNKNOWN reservation、PROJECT_WIDE 和协调内部错误实现可行动的中英文文本诊断及稳定错误 details。
- [x] 9.5 增加 parser option ordering、未知 option/额外 positional、text/JSON、稳定错误码、配置域隔离、stale plan、失败注入和命令文档引用测试。
- [x] 9.6 运行 `npm run cli:architecture-check`，修复 registry/dispatch/持久化边界问题，确保 CLI handler 不直接读写 ledger。

## 10. 端到端验收与发布准备

- [x] 10.1 建立多进程端到端 harness，分别驱动 Codex/Claude fixture 事件并验证同文件强拒绝、不同文件确认、UNKNOWN 人工裁决和多文件原子性。
- [x] 10.2 增加 failpoint 覆盖 mutex 获取、快照后竞态、Git 检查、ledger atomic write、Hook native 输出和裁决 postcondition 各阶段，验证 fail closed 且不遗留半成功状态。
- [x] 10.3 验证用户确认期间、长命令期间和并发查询期间没有 mutex/资源等待环，运行压力测试证明不存在锁顺序死锁。
- [x] 10.4 更新中英文用户指南，提供冲突消息示例、每个 decision 命令、未修改即崩溃的恢复演练、UNKNOWN 证据解释及安全边界。
- [x] 10.5 运行完整 `npm run check`、`npm run cli:architecture-check` 和 OpenSpec 验证，记录 Codex/Claude 支持的 Hook/工具版本矩阵与已知限制。
