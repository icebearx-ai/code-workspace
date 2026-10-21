## MODIFIED Requirements

### Requirement: init 提供明确的扩展选择语义
`init` SHALL NOT 提供扩展选择、Registry 查询、扩展安装或 `--extensions` 输入。非交互新 Workspace SHALL 默认只初始化 Workspace 配置、项目注册引用、状态、用户指南和内置 Agent 集成；已有 Workspace 未改变工具选择时 SHALL 保留既有工具和项目状态。初始化 MAY 识别并规划历史扩展状态迁移，但 MUST NOT 执行任何扩展入口。

#### Scenario: 非交互新 Workspace 默认无扩展
- **WHEN** 新 Workspace 以非交互模式运行 init 且未传扩展相关选项
- **THEN** 初始化只请求核心 Workspace 和内置 Agent 集成，requested extensions 不存在或为空

#### Scenario: 已有 Workspace 重新初始化
- **WHEN** 已有 Workspace 重新运行 init 且未改变工具选择
- **THEN** 初始化保留项目注册、权限数据和工具选择，不尝试升级或卸载普通扩展

#### Scenario: 扩展选项被拒绝
- **WHEN** 用户传入 `--extensions none` 或 `--extensions monitor`
- **THEN** CLI 在写入前返回稳定的无效选项诊断，并说明扩展能力已在当前 Major 版本移除

## REMOVED Requirements

### Requirement: 发现内置扩展并解析兼容版本
**Reason**: 内置能力不再以版本化扩展目录发现，而是随 CLI 包静态发布并由 managed files 管理。
**Migration**: 使用当前 CLI 的内置 Agent 集成；普通扩展需由用户在其宿主环境自行安装和管理。

### Requirement: 校验扩展 manifest 和目标所有权
**Reason**: 项目不再接受或执行外部扩展 manifest。
**Migration**: 内置 Agent 输出改用包内 managed-file 来源、摘要和目标所有权记录。

### Requirement: 隔离生成并验证制品
**Reason**: 删除扩展入口执行和 staging 协议。
**Migration**: 无迁移路径；内置输出为静态包资产，不需要子进程生成。

### Requirement: 扩展以独立文件事务安装
**Reason**: 扩展安装生命周期被移除。
**Migration**: 已安装普通扩展保留为用户文件或由显式 legacy 清理计划处理。

### Requirement: Workspace 状态区分安装与尝试
**Reason**: Workspace 状态不再记录扩展安装、升级或 lastAttempt。
**Migration**: `update` 将可识别的旧状态迁移为 legacy 清理计划；无法识别时保留并由 doctor 报告。

### Requirement: 核心成功与扩展结果相互隔离
**Reason**: 初始化结果不再包含扩展执行结果。
**Migration**: 调用方读取核心初始化和内置托管文件结果。

### Requirement: 扩展入口与执行环境遵守最小契约
**Reason**: 项目不再运行扩展入口。
**Migration**: 无运行时迁移路径；扩展作者将扩展作为独立工具发布。

### Requirement: 扩展准备失败不阻断核心初始化
**Reason**: 初始化不再准备扩展。
**Migration**: 核心初始化失败仍按现有 Workspace 错误处理；普通扩展状态问题只作为 legacy 迁移诊断报告。

### Requirement: Host 管理共享 contribution
**Reason**: 扩展共享文件合成能力被移除。
**Migration**: 用户自行保留或合并需要的扩展贡献；CLI 不覆盖未知内容。

### Requirement: Host 管理抽象插件 Hook
**Reason**: 扩展 Hook 声明和 Provider 映射被移除。
**Migration**: 用户手动保留自有 Hook；CLI 仅在旧扩展状态可验证时清理扩展拥有的 Hook。

### Requirement: 发布 Zhuiyi Jira MCP 扩展
**Reason**: 本项目不再发布或分发普通扩展。
**Migration**: 如仍需要 Jira MCP，由独立项目或包仓库发布。

### Requirement: 扩展 CLI 契约保持稳定
**Reason**: `extension` 和 `ext` 命令面被移除。
**Migration**: 使用外部包管理器或扩展项目自身的 CLI。

### Requirement: 扩展可事务性卸载
**Reason**: 扩展卸载生命周期被移除。
**Migration**: `update` 可对可识别旧状态生成确认后的清理计划；未知文件由用户手动处理。

### Requirement: 扩展可独立选择和安装
**Reason**: 扩展选择器和独立安装能力被移除。
**Migration**: 使用外部包管理器或宿主工具的扩展安装机制。
