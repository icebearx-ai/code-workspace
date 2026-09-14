## ADDED Requirements

### Requirement: Hook 上报以扩展 report 命令为唯一入口并保持 failure-open
Monitor 的 Hook 事件上报与 failure-open 语义的唯一实现和验证来源必须（SHALL）是 `extensions/monitor` 的 runtime `report` 命令，经通用 `codew ext <id>` 路由以 `codew ext monitor report` 调用。核心不得提供第二套上报实现、`codew monitor` 兼容命令或 `normalizeHookEvent` / `reportHookEvent` 业务拷贝。

#### Scenario: report 命令读取扩展自有制品配置
- **WHEN** 通过 `codew ext monitor report` 触发上报
- **THEN** runtime 从调用方 cwd 向上查找扩展自有制品 `.code-workspace/monitor-reporting.json`，读取 `enable`、`url` 与 workspace 元数据，不依赖核心 workspace config 的 monitor 域

#### Scenario: 上报服务不可用仍失败开放
- **WHEN** 上报制品缺失、POST 失败或服务不可达
- **THEN** report 命令以退出码 0 结束，不阻断 Agent 工具执行

#### Scenario: 上报被禁用时跳过
- **WHEN** 制品中 `enable` 为 false
- **THEN** report 命令跳过上报并以退出码 0 结束

#### Scenario: report 不依赖 singleton 服务
- **WHEN** `codew ext monitor report` 作为短命令执行且 Monitor service 未运行
- **THEN** report 作为纯 HTTP 客户端独立执行，不经过 service 注册或 readiness 握手，失败即跳过
