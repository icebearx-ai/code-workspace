## ADDED Requirements

### Requirement: 运行时协议与安装协议独立协商
Code Workspace SHALL 将运行时协议版本与 `extensionSpecVersion` 分离。扩展 manifest MAY 声明 runtime protocol version 和运行时能力要求；Host SHALL 发布受支持的 runtime protocol 和 capability 集合。只有扩展声明的全部必需运行时能力均受支持时，Host 才可执行运行时入口。未知运行时协议或必需能力 MUST 只阻断对应 runtime 能力，不得被解释为安装协议兼容。

#### Scenario: v1 安装扩展没有运行时声明
- **WHEN** 现有 Extension Spec v1 扩展不声明 runtime 能力
- **THEN** 扩展的发现、安装、升级和卸载行为保持兼容

#### Scenario: 未知必需运行时能力
- **WHEN** 扩展声明 Host 不支持的必需 runtime capability
- **THEN** Host 在执行入口前安全拒绝，并报告支持的 capability 集合

#### Scenario: 运行时协议独立升级
- **WHEN** runtime protocol 增加不兼容变化但安装生命周期不变
- **THEN** 只需更新 runtime protocol 支持集合，旧运行时协议不得通过数值范围被推测为兼容
