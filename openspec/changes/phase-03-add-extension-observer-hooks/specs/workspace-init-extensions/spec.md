## ADDED Requirements

### Requirement: Host 隔离安装 Observer 与决策型 Hook
Host SHALL 在 Hook 计划、原生配置合成、冲突检查、状态记录、后置验证和卸载中保留 Hook protocol 类型。Observer contribution MUST 只表示观察 runner，不得被解释为写入决策、任务 claim 或台账输入；决策型 Hook 不得因 observer 失败被移除或回滚。

#### Scenario: 安装 observer Hook
- **WHEN** 扩展声明经过校验的 observer Hook
- **THEN** Host 在对应 Provider 配置中创建 observer entry，并在 installed 状态中保留 protocol 类型

#### Scenario: Observer 运行失败
- **WHEN** 已安装 observer 在运行期失败开放
- **THEN** Host 保留 observer 和所有决策型 Hook 状态，只记录 observer 诊断

#### Scenario: 卸载 observer
- **WHEN** 用户卸载拥有 observer Hook 的扩展
- **THEN** Host 只移除该扩展的 observer contribution，保留用户、核心和其他扩展 Hook
