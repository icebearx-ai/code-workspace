## MODIFIED Requirements

### Requirement: 扩展可事务性卸载
系统 SHALL 提供 `extension uninstall <name>` planned-write 命令。卸载 SHALL 只依据 Workspace installed activation 状态，由 Host 验证并移除该 Workspace 拥有的独占文件、独占目录、共享 contribution 和 Hook，再删除该 Workspace 的 activation。卸载 MUST NOT 删除仍被其他 Workspace 引用的 User Store 包、全局 service 或用户级运行数据；不得读取当前扩展包或执行扩展代码。

#### Scenario: 卸载 Monitor Workspace activation
- **WHEN** 用户确认卸载 Monitor，且当前 Workspace 的 Hook/config 未被未知修改
- **THEN** 系统事务性移除该 Workspace 的 Monitor activation 和制品，不停止其他 Workspace 正在使用的 Monitor service

#### Scenario: Store 包仍被其他 Workspace 使用
- **WHEN** Workspace A 卸载 Monitor，而 Workspace B 仍引用同一 Store 包
- **THEN** Store 包保持可用，B 的 activation 和服务引用不受影响

#### Scenario: 全部 Workspace 都已卸载
- **WHEN** 没有 Workspace 再引用某 Monitor Store 包
- **THEN** 卸载命令只完成当前 Workspace 事务，包由引用感知 GC 在没有运行进程或其他 pin 时清理
