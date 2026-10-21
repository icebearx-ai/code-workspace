## REMOVED Requirements

### Requirement: Monitor 判定 Session 活跃生命周期
**Reason**: 可选监控扩展和 Hook 事件来源被移除，项目不再提供 Session 生命周期判定。
**Migration**: 使用外部监控方案；本项目仅保留 Workspace、项目和权限状态。

### Requirement: Monitor 提供一致的 Session 统计
**Reason**: Session 聚合视图依赖已删除的监控扩展。
**Migration**: 使用独立监控工具；本项目不承诺 Session 统计。

### Requirement: Session 视图展示失活信息
**Reason**: 监控视图被移除。
**Migration**: 无内置替代。

### Requirement: 用户可以删除单个 Session
**Reason**: 项目不再持久化或展示 Session。
**Migration**: 使用外部监控工具管理其自身数据。
