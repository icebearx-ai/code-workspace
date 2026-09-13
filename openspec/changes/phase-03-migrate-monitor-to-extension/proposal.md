## Why

Monitor 是典型的多 Workspace 能力：多个 Workspace 产生观察事件，一个服务负责聚合、展示和维护用户级状态。它不应被安装到某一个 Workspace，也不应继续依赖核心 Monitor 业务实现。

## What Changes

- 将 Monitor Server、Store、HTTP API、Dashboard、i18n 和事件映射迁移到 `monitor` 扩展包。
- 每个 Workspace 只安装 Monitor activation，包括 Observer Hook 和 Workspace 配置。
- 通过通用 Runtime Host 启动一个 user/global Monitor service，聚合多个 Workspace。
- Monitor service 使用用户级运行数据，不把聚合数据写入任意 Workspace。
- 固定 Monitor 版本、service identity、兼容组和多 Workspace 激活规则。
- 保留 `codew monitor` 作为兼容别名，最终移除核心 Monitor 业务实现。

## Capabilities

### New Capabilities

- `multi-workspace-monitor-extension`: Monitor 扩展的 Workspace activation、全局聚合服务、数据范围和版本兼容。

### Modified Capabilities

- `workspace-init-extensions`: Workspace 初始化和升级支持 Monitor activation 的安装、迁移和保留策略。

## Impact

影响 `extensions/monitor/` 包、Monitor 测试、用户级运行数据、Workspace Hook/config 迁移、CLI 兼容路由和核心 Monitor 删除。要求扩展实现不 import `src/monitor`，并完成多 Workspace、版本共存及回滚验证。
