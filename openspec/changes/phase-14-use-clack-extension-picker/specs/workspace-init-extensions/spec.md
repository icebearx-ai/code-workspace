## MODIFIED Requirements

### Requirement: init 提供明确的扩展选择语义
交互式 `init` SHALL 使用基于 `@clack/prompts` 的扩展选择流程按扩展名搜索、多选和分页，并展示最高受支持版本及其 Extension Spec。流程 SHALL 通过显式的页面操作菜单提供上一页、下一页、重新搜索、完成和取消。非交互式 `init` SHALL 接受 `--extensions <comma-list|none>`；新 Workspace 未提供该选项时 SHALL 不安装扩展，已有 Workspace 未提供时 SHALL 默认请求已安装扩展。未选择的已安装扩展 SHALL 保持不变。

#### Scenario: 非交互新 Workspace 默认无扩展
- **WHEN** 新 Workspace 以非交互模式运行 init 且未传 `--extensions`
- **THEN** 初始化计划的 requested extensions 为空

#### Scenario: 已有 Workspace 默认升级已安装扩展
- **WHEN** 已有 Workspace 重新运行 init 且未显式选择扩展
- **THEN** 初始化计划请求每个已安装扩展并解析当前最高受支持版本

#### Scenario: Clack 搜索和分页选择
- **WHEN** 用户在交互式 init 中提交搜索词并在 Clack 页面多选中选择扩展
- **THEN** 用户可以通过页面操作菜单浏览上一页或下一页、重新搜索或完成选择，且选中的扩展进入初始化计划

#### Scenario: none 不卸载
- **WHEN** 已有 Workspace 使用 `--extensions none`
- **THEN** 本次不初始化扩展且保留所有已安装状态和制品
