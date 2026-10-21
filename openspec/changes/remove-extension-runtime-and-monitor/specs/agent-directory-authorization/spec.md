## MODIFIED Requirements

### Requirement: 权限适配器扩展性
核心权限服务 MUST 通过权限适配器注册表解析工具特有行为，并 MUST 使通用规划、交互、事务、验证和结果构建不依赖 Agent 配置格式。适配器 SHALL 作为核心代码内置注册，SHALL NOT 通过 Extension Store、扩展 manifest 或扩展运行时注册。

#### Scenario: 执行已注册适配器
- **WHEN** 选中的工具具有内置注册的权限适配器
- **THEN** 通用服务通过标准的 inspect、plan、apply、verify 和 target 契约调用该适配器

#### Scenario: 选中工具不具备权限能力
- **WHEN** Workspace 选中的工具没有注册权限适配器
- **THEN** 权限规划返回稳定的“不支持该能力”诊断，指出工具名称和补救方式，而不是静默跳过

#### Scenario: 未来本地文件适配器
- **WHEN** 未来 Agent 工具作为核心内置适配器实现并注册标准本地文件权限契约
- **THEN** `permissions apply`、项目授权流程、确认、事务和通用 JSON 结果无需增加命令专用分支即可支持该工具

### Requirement: 初始化和更新的授权边界
初始化 MUST 只把明确缺失的目录授权纳入已确认计划，普通 update MUST 保持授权中立；两者 SHALL NOT 通过扩展安装触发授权，Agent 目录访问仍由用户通过 CLI 确认。

#### Scenario: 重新初始化现有 Workspace
- **WHEN** 在已有 Agent 目录授权的 Workspace 上运行初始化
- **THEN** 初始化保留现有授权，只应用已确认初始化计划中包含的缺失授权

#### Scenario: 普通更新
- **WHEN** 用户在没有授权命令的情况下运行 `codew update`
- **THEN** 不修改任何 Agent 目录授权文件

#### Scenario: 工具选择更新暴露缺失授权
- **WHEN** update 启用一个尚未获得已注册项目目录授权的工具
- **THEN** update 在不授予访问权限的情况下完成，并报告补救说明，引导用户检查并运行 `codew permissions apply`
