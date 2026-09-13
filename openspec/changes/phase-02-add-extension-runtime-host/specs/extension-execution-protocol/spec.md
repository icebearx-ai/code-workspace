## MODIFIED Requirements

### Requirement: Host 验证并冻结静态扩展包
Host SHALL 只执行符合受支持 Extension Spec 的可信扩展包。静态 manifest SHALL 同时声明安装期入口和可选 runtime entries；Host SHALL 冻结 manifest、完整包摘要及被调用 runtime entry 的摘要，并在执行前从 User Extension Store 重新验证。runtime entry 的 execution scope、mode 和 service metadata 不得由命令行参数覆盖。

#### Scenario: Runtime entry 摘要匹配
- **WHEN** Store 中 runtime entry 与冻结计划的 manifest、入口和包摘要一致
- **THEN** Host 可以启动该 runtime

#### Scenario: Runtime metadata 被修改
- **WHEN** runtime entry 或其 service metadata 在计划后发生变化
- **THEN** Host 在启动前返回 stale-plan 错误

### Requirement: 扩展执行模型不被描述为安全沙箱
系统文档 SHALL 明确 Runtime Host 只执行可信扩展，子进程隔离不是安全沙箱。global execution scope 只表示进程可服务多个 Workspace，不表示更高安全等级或自动获得其他 Workspace 权限。

#### Scenario: global scope 解释
- **WHEN** 扩展 manifest 声明 global runtime
- **THEN** Host 将其解释为执行和数据聚合范围，不将其转换为全局 Workspace 或任意 Workspace 文件访问权限
