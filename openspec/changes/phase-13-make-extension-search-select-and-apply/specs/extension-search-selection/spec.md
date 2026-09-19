## ADDED Requirements

### Requirement: TTY 下 extension search 直接进入选择并应用
在 TTY 中执行 `codew extension search [query]` SHALL 直接打开共享 Nexus picker；用户确认选择后，系统 SHALL 对未安装扩展执行 install，对已安装旧版本扩展执行 update，并复用既有 Workspace 锁、确认、事务、验证和回滚。

#### Scenario: 选择未安装扩展
- **WHEN** 用户在 TTY search picker 中选择未安装扩展并确认
- **THEN** 系统导入精确 Nexus 包并安装 Workspace activation，返回 ordered selection result

#### Scenario: 选择过期扩展
- **WHEN** 用户选择已安装但不是最新可验证候选的扩展并确认
- **THEN** 系统执行 upgrade 事务并返回旧版本到新版本的结果

### Requirement: 已安装最新版不可选择
search picker SHALL 比较 installed version 与 package digest 和当前候选事实；两者一致的扩展 MUST 禁用且不得产生安装或升级动作。

#### Scenario: 当前版本
- **WHEN** installed version 和 digest 与默认候选一致
- **THEN** 列表显示已安装最新版，Space 不能选中该项

### Requirement: 非交互 search 保持只读
JSON、非 TTY 或无法安全确认的 `extension search` 调用 SHALL 只返回搜索结果，不提示、不导入 Store、不写 Workspace；结果不得包含凭证或原始 Nexus payload。

#### Scenario: JSON search
- **WHEN** 用户执行 `codew extension search jira --json`
- **THEN** 命令返回稳定搜索 envelope，不执行安装或更新

#### Scenario: 非 TTY search
- **WHEN** search 在非 TTY 环境执行且未进入交互 picker
- **THEN** 命令不等待输入、不写 Workspace，并返回搜索结果或稳定的非交互提示

### Requirement: 批量应用保留独立事务和完整结果
一次 search 选择多个扩展时，系统 SHALL 在首个写入前只确认一次，按选择顺序执行独立事务；单个目标失败 SHALL 回滚该目标、继续后续目标并返回完整 ordered results，顶层 ok 在有失败时为 false。

#### Scenario: 部分更新失败
- **WHEN** 批量选择中一个扩展下载或激活失败
- **THEN** 失败目标恢复旧状态，后续目标继续处理，结果包含成功、跳过和失败统计

### Requirement: 系统扩展不参与 search 选择
系统扩展 SHALL 不出现在 search picker 或普通 install/update 计划中；系统生命周期仍由 init 管理。

#### Scenario: Nexus 返回系统同名包
- **WHEN** Search 结果包含 `codew-workspace-guard`
- **THEN** picker 隐藏该项且 search 不会写入或升级系统扩展
