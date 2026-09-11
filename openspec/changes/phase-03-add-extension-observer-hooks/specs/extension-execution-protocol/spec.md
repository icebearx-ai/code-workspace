## ADDED Requirements

### Requirement: Observer capability 参与运行时协商
Observer Hook SHALL 作为独立 runtime capability 声明和协商。Host MUST 只对支持 observer capability 的扩展安装 observer Hook，并在能力不匹配时安全拒绝或跳过；observer 能力不得隐式授予任何决策能力。

#### Scenario: Host 支持 observer capability
- **WHEN** 扩展声明 observer capability 且 Host 支持该能力
- **THEN** Host 按其 Provider、事件和贡献声明执行安装计划

#### Scenario: Observer 能力与决策能力隔离
- **WHEN** Host 支持 observer capability 但不支持某个决策能力
- **THEN** observer 可以可用，但扩展不得因此获得写入决策或台账权限
