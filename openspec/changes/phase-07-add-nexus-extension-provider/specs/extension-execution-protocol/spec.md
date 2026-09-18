## MODIFIED Requirements

### Requirement: Host 验证并冻结静态扩展包
Host SHALL 只执行符合受支持 Extension Spec 的可信扩展。可信包 MUST 来自当前发布包的内置 Provider，或来自已配置公司 Nexus npm Provider 且完成 npm integrity、安全解包、Extension 身份与完整 package digest 验证后导入的用户级 Store。静态 manifest SHALL 使用对应规范固定的 schema，并在执行前声明规范版本、身份、入口、超时、声明性能力、最大输出范围和可选 runtime；Host SHALL 从 Store 精确 `id/version/packageSha256` 重新验证 manifest、入口、runtime 入口和完整目录摘要。Workspace 路径不得作为扩展包源码来源，运输 envelope 不得作为执行合同。

#### Scenario: 执行内置导入包
- **WHEN** 内置 Provider 包经验证导入 Store，且 Store 中 manifest、入口和 package digest 与冻结计划一致
- **THEN** Host 可以从该精确 Store 包执行扩展入口

#### Scenario: 执行 Nexus 导入包
- **WHEN** Nexus tarball 已通过 archive integrity、运输身份、Extension manifest 和 package digest 验证并原子导入 Store
- **THEN** Host 对其使用与内置包相同的 Store 执行验证，不在执行时重新信任远端 metadata

#### Scenario: Store 包发生漂移
- **WHEN** Store 版本目录内容与 activation、registry 或冻结计划的任一摘要不一致
- **THEN** Host 以稳定 package integrity 或 stale-plan 错误停止且不执行扩展

#### Scenario: 未知规范版本
- **WHEN** 内置或 Nexus 包声明的 `extensionSpecVersion` 不属于 Host 支持集合
- **THEN** Host 只读取稳定发现 envelope，不解释入口、能力、输出或 runtime，也不执行扩展代码

#### Scenario: Workspace 不包含扩展源码
- **WHEN** Workspace 只有 activation 和生成制品而没有扩展包目录
- **THEN** Host 仍可通过用户级 Store 定位并执行其固定版本
