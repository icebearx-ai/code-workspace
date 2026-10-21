## REMOVED Requirements

### Requirement: Extension Spec 作为完整兼容边界
**Reason**: Extension Spec、Host 兼容矩阵和扩展兼容边界不再属于本项目。
**Migration**: 扩展作者应使用独立包的 SemVer 和宿主工具兼容性说明。

### Requirement: 规范性制品与说明性文档分离
**Reason**: 项目不再接收或验证扩展制品。
**Migration**: 扩展文档由独立扩展项目自行管理。

### Requirement: Host 验证并冻结静态扩展包
**Reason**: Extension Store 和扩展包验证被移除。
**Migration**: 外部分发系统自行负责包完整性和来源验证。

### Requirement: 扩展只返回静态范围内的实际输出
**Reason**: 扩展初始化入口协议被移除。
**Migration**: 内置 Agent 资产直接作为包内静态文件管理。

### Requirement: Host 独立验证 staging 和安装摘要
**Reason**: 扩展 staging 与安装事务被移除。
**Migration**: 内置托管文件继续使用现有 managed-file 摘要验证。

### Requirement: Host 只支持具有完整生命周期的基础输出
**Reason**: 扩展输出所有权和生命周期模型被移除。
**Migration**: 仅内置 Agent 输出由 managed-files 声明所有权。

### Requirement: installed manifest 是生命周期事实来源
**Reason**: `.codew/ext-manifest.json` 不再是活动状态来源。
**Migration**: `update/doctor` 仅将其作为历史迁移输入；无法安全解释时报告 legacy 状态。

### Requirement: 扩展执行模型不被描述为安全沙箱
**Reason**: 项目不再执行扩展。
**Migration**: 无需沙箱边界声明；外部扩展安全由其宿主和用户负责。
