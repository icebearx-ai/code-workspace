## MODIFIED Requirements

### Requirement: init 提供明确的扩展选择语义

交互式 `init` SHALL 允许按普通扩展名多选并展示最高受支持版本及其 Extension Spec；系统扩展 SHALL 不出现在选择列表中。非交互式 `init` SHALL 接受 `--extensions <comma-list|none>`；新 Workspace 未提供该选项时 SHALL 不安装普通扩展，但 SHALL 自动请求适用的系统扩展；已有 Workspace 未提供时 SHALL 默认请求已安装的普通扩展并自动请求适用的系统扩展。`none` SHALL 只影响普通扩展，未选择的已安装普通扩展 SHALL 保持不变。

#### Scenario: 非交互新 Workspace 默认仅安装系统扩展
- **WHEN** 新 Workspace 以非交互模式运行 init 且未传 `--extensions`
- **THEN** 初始化计划的普通扩展 requested extensions 为空，适用系统扩展仍在自动请求集合中

#### Scenario: 已有 Workspace 默认升级普通和系统扩展
- **WHEN** 已有 Workspace 重新运行 init 且未显式选择普通扩展
- **THEN** 初始化计划请求每个已安装普通扩展，并自动请求适用系统扩展以解析当前最高受支持版本

#### Scenario: none 不卸载普通扩展且不取消系统扩展
- **WHEN** 已有 Workspace 使用 `--extensions none`
- **THEN** 本次不初始化普通扩展且保留其已安装状态和制品，同时继续处理适用系统扩展
