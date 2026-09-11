## ADDED Requirements

### Requirement: Init 和 Update 支持可回滚的 Monitor 扩展采用
Init 和 update SHALL 在扩展计划与核心维护计划之间建立单一可验证边界。默认选择 Monitor 扩展时，系统 MUST 同时验证扩展 installed 状态、扩展配置、Observer Hook 和旧配置清理；任一必需条件失败时，MUST 回滚本次采用操作，且不得影响其他成功扩展或核心初始化结果。

#### Scenario: 默认采用成功
- **WHEN** 用户按兼容默认条件执行 init 或 update
- **THEN** 核心报告 Monitor 扩展已安装，配置和 Observer Hook 后置条件全部通过

#### Scenario: 扩展安装成功但 Hook 失败
- **WHEN** Monitor 扩展制品安装成功但 Observer Hook 合成或验证失败
- **THEN** 系统回滚该扩展采用边界，其他扩展和核心结果保持其独立事务语义

#### Scenario: 重复执行保持幂等
- **WHEN** 已采用 Monitor 扩展的 Workspace 再次执行 init 或 update
- **THEN** 系统不重复写入配置和 Hook，不报告虚假迁移或漂移
