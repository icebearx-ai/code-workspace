## MODIFIED Requirements

### Requirement: Host 验证并冻结静态扩展包
Host SHALL 只执行符合受支持 Extension Spec 的可信扩展包。静态 manifest SHALL 使用对应规范固定的 schema，并在执行前声明规范版本、身份、入口、超时、声明性能力和最大输出范围。Host SHALL 在规划时冻结 manifest、入口和完整扩展版本目录摘要；执行时 MUST 从已验证的不可变 Package Store 版本解析入口，并重新验证其摘要。Workspace 路径不得作为扩展包源码来源。

#### Scenario: Store 包与计划一致
- **WHEN** Store 中精确版本的 manifest、入口和完整包摘要均与冻结计划相同
- **THEN** Host 可以从该 Store 包执行扩展入口

#### Scenario: Store 包发生漂移
- **WHEN** Store 版本目录内容与记录摘要不一致
- **THEN** Host 以稳定 stale-plan 或 package integrity 错误停止且不执行扩展

#### Scenario: Workspace 不包含扩展源码
- **WHEN** Workspace 只有 activation 和生成制品而没有扩展包目录
- **THEN** Host 仍可通过 Store 定位并执行该扩展

### Requirement: installed manifest 是 Workspace activation 事实来源
Host SHALL 在 Workspace 的 installed record 中记录安装时的 Extension Spec 版本、扩展版本、package digest、通用输出所有权和 Host 验证事实。幂等、升级和卸载 SHALL 验证 Workspace activation 与真实制品；卸载不得要求扩展包仍在 Workspace 中。

#### Scenario: Activation 记录精确包版本
- **WHEN** Workspace 成功安装扩展
- **THEN** installed record 保存精确版本和 package digest，而不是仅保存扩展 ID 或 latest 标记

#### Scenario: Store 包暂时不可用时卸载
- **WHEN** installed record 有效但 Store 包已不可用
- **THEN** Host 仍能仅依据 Workspace installed record 验证并卸载已有制品
