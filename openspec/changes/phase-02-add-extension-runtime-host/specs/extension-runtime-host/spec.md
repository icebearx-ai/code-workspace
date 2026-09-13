## ADDED Requirements

### Requirement: Host 提供稳定的扩展 CLI 命名空间
系统 SHALL 永久注册 `codew ext [host-options] <extension-id> [extension-argv...]`。Parser MUST 在识别 extension-id 后停止解释扩展参数；扩展 ID 后的 token MUST 原样传递。Host options MUST 位于 extension-id 之前，且扩展不得动态注册顶级命令。

#### Scenario: 扩展私有选项直通
- **WHEN** 用户执行 `codew ext example status --json`
- **THEN** Host 将 `status --json` 原样传给 `example` runtime

#### Scenario: 非法 Host option 顺序
- **WHEN** 用户将 Host option 放在 extension-id 之后
- **THEN** Host 将其视为扩展参数，不因该 token 的名称解析或覆盖扩展选项

### Requirement: Runtime Host 从 Store 精确解析入口
Host SHALL 依据扩展 ID、精确版本和 package digest 从 User Extension Store 定位不可变包，并在启动前校验 manifest、runtime entry 和完整包摘要。入口漂移、包缺失或摘要不匹配 MUST 在启动前失败。

#### Scenario: 解析已激活版本
- **WHEN** Workspace activation 引用 `example@1.0.0` 且 Store 包摘要匹配
- **THEN** Host 启动该精确版本的 runtime entry

#### Scenario: Store 包缺失
- **WHEN** activation 引用的版本不在 Store 中
- **THEN** Host 返回稳定 runtime unavailable 错误且不启动其他版本

### Requirement: Runtime 作用域决定 Workspace 依赖
Runtime entry SHALL 声明 `workspace` 或 `global` execution scope。Workspace runtime MUST 要求当前 Workspace 存在匹配 activation；global runtime MUST 可在没有 Workspace 的目录中解析，并不得因任意 Workspace 未激活而不可用。

#### Scenario: Workspace runtime 未激活
- **WHEN** 用户在 Workspace 中调用未激活的 workspace-scoped runtime
- **THEN** Host 在启动前返回 activation required 错误

#### Scenario: Global runtime 脱离 Workspace 调用
- **WHEN** 用户在普通目录调用 global-scoped runtime
- **THEN** Host 可以从 Store 解析并启动该 runtime，不要求创建 Workspace

### Requirement: Runtime 入口不获得真实 Workspace 路径
Host SHALL 为 runtime 创建独立临时 context 和最小环境变量。global runtime 默认不得接收真实 Workspace 根路径、Workspace 私有配置或凭证；runtime context 的协议版本和扩展身份 MUST 与计划一致。

#### Scenario: Global service 启动
- **WHEN** global service 被 Host 启动
- **THEN** service 只接收通用 runtime context、用户级数据目录和声明的参数，不接收任意 Workspace 私有路径
