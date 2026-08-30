## ADDED Requirements

### Requirement: 协调命令由 registry 完整声明
所有 `task` CLI 命令 MUST 在 `src/cli/registry.js` 声明 path、positionals、options、workspace、config、interaction 与 effects，并由共享 parser 和 `src/cli.js` dispatch 路由。

#### Scenario: task decision abandon 契约
- **WHEN** registry 声明 `task decision abandon <request-id>`
- **THEN** 它要求 Workspace、只加载 identity/projects、声明 required interaction 和 planned-write，并提供 boolean `--yes`

### Requirement: 只读命令显示任务和锁全貌
CLI MUST 提供 `task list`、`task show <task-id>`、`task lock list` 和 `task decision show <request-id>`，且这些命令 MUST 为 read-only、never-interaction，不修改台账。

#### Scenario: 查询 UNKNOWN owner
- **WHEN** 用户查看一个阻断写入的 `UNKNOWN` task
- **THEN** 文本和 JSON 都包含 taskId、provider、session/generation、状态、phase、最后事件时间、项目参与、claims 和待裁决事项

### Requirement: 冲突诊断必须可行动
任何写入阻断结果 MUST 包含 owner task、owner status、最后活动、claim 类型、冲突路径/范围、当前文件/Git 证据、阻断原因和至少一个适用于当前状态的处理命令。

#### Scenario: ACTIVE 同文件冲突
- **WHEN** 当前工具被 `ACTIVE` task-A 的 exact-file claim 阻断
- **THEN** 提示明确说明不能强制覆盖，并建议等待 task-A 的工具/会话结束或联系对应任务，而不是只输出“locked”

#### Scenario: UNKNOWN 未写入 reservation
- **WHEN** 当前工具命中一个文件仍 clean 的 `UNKNOWN WRITE_RESERVATION`
- **THEN** 提示说明 reservation 可能代表尚未开始的旧工具，展示进程证据并给出 show、keep、abandon 命令

### Requirement: 裁决命令使用共享确认边界
`task decision keep|approve|release|abandon` MUST 先从 core 获取 plan、校验动作适用性，再使用共享 confirmation helper；JSON 或非 TTY 模式 MUST NOT 提示，并要求显式 `--yes`。

#### Scenario: 非交互 abandon 未提供 yes
- **WHEN** 用户在非 TTY 或 JSON 模式运行 abandon 且未传 `--yes`
- **THEN** 命令返回 `CLI_CONFIRMATION_REQUIRED`，台账保持不变

### Requirement: 裁决动作受类型和状态约束
CLI MUST 禁止对 `ACTIVE` 文件 owner 使用 release/abandon，禁止对 `WRITE_RESERVATION` 使用单 claim release，并禁止把 approve 用于文件冲突。

#### Scenario: 尝试释放 ACTIVE 文件 claim
- **WHEN** 用户对 `ACTIVE` owner 的文件冲突执行 release
- **THEN** CLI 返回稳定错误码和安全处理建议，不修改 claim

#### Scenario: 尝试单独释放 UNKNOWN reservation
- **WHEN** 用户对 `UNKNOWN WRITE_RESERVATION` 执行 release
- **THEN** CLI 拒绝并说明必须 keep 或 abandon 整个 generation

### Requirement: planned-write 裁决防止 stale plan
裁决 handler MUST 遵循 inspect → plan → validate → confirm → apply → verify，并在 apply 时由 core 重新验证 decision revision、evidence hash 和 owner generation。

#### Scenario: 确认期间状态改变
- **WHEN** 用户看到确认提示后 owner 收到新事件或 claim 改变
- **THEN** apply 返回 `TASK_DECISION_STALE`，命令不报告成功且不覆盖新状态

### Requirement: 裁决成功验证完整后置条件
CLI MUST 在报告裁决成功前验证预期 task status、claim enforcement、project approval 和 decision audit 状态全部成立；验证失败 MUST 返回稳定错误且不得声称已解锁。

#### Scenario: abandon 持久化不完整
- **WHEN** task 已标记 ended 但一个应解除的 reservation 仍具有 enforcement 效力
- **THEN** 命令验证失败并返回协调一致性错误，不输出成功结果

### Requirement: CLI 使用共享结果模型
所有 task 命令 MUST 通过共享 result helper 返回 schema version 1 envelope；预期失败 MUST 使用稳定 `WorkspaceError` code 和结构化 details，warning MUST 位于 diagnostics。

#### Scenario: JSON 文件冲突
- **WHEN** 用户或 Hook 相关诊断以 JSON 查询冲突
- **THEN** envelope 包含 `ok=false`、稳定 command name、错误 code、owner/path/status/evidence 和 remediation

### Requirement: CLI 不直接持久化台账
task command handler MUST 只调用 core 的 inspect、plan 和 apply API，MUST NOT 导入 `src/core/fs.js`、调用 atomicWrite 或自行序列化 ledger。

#### Scenario: CLI 架构检查
- **WHEN** 运行 repository-owned CLI architecture checker
- **THEN** 新增 task 命令通过 registry、dispatch、持久化边界和文档引用检查

### Requirement: 决定不直接重放旧工具
CLI 成功处理决定后 MUST 告知用户或 Agent 重试原操作，MUST NOT 从 CLI 内执行 Provider 工具或直接创建请求者 reservation。

#### Scenario: 项目并行批准成功
- **WHEN** 用户运行 `task decision approve` 并通过验证
- **THEN** CLI 只保存 task-pair approval 并提示重试，实际文件 reservation 由下一次 `write.before` 获取

