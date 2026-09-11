## ADDED Requirements

### Requirement: 配置能力通过 runtime capability 声明
扩展配置文件支持 SHALL 作为独立 runtime capability 协商，而不是默认假设所有 runtime 扩展都理解配置。扩展声明 config capability 时，Host 必须在安装计划中冻结配置文件声明、默认内容和路径安全性；Host 不支持该 capability 时 MUST 在执行需要它的扩展入口前失败。

#### Scenario: Host 支持 config capability
- **WHEN** 扩展声明支持的 config capability 和合法配置文件
- **THEN** Host 将其纳入安装、升级和卸载生命周期

#### Scenario: Host 不支持必需 config capability
- **WHEN** 扩展要求 config capability 但 Host 支持集合不包含它
- **THEN** Host 在创建文件或执行运行时入口前安全拒绝
