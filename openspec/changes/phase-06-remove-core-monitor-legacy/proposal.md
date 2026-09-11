## Why

Monitor 扩展成为默认路径并经过兼容期后，继续在核心保留 Monitor 配置域、CLI、Server、页面资源、公共导出和旧 Hook 会增加维护面和发布体积。只有兼容指标满足后才能删除这些代码。

## What Changes

- 在满足明确的兼容与发布门槛后，移除核心 `config.monitor` 域及其渲染、投影、迁移和诊断逻辑。
- 移除核心 Monitor CLI/Server/Store/Page/i18n 实现、旧 managed Hook、打包资源和对应公共桥接。
- 结束旧配置/Hook 迁移和 `code-w monitor` 兼容窗口；兼容策略必须在实施时明确为已到期。
- 保留 `monitor-session-lifecycle` 所定义的扩展行为，以及扩展安装、升级、卸载和配置保留语义。
- 本阶段是清理阶段，不改变 Monitor 业务行为，也不重新设计扩展机制。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `monitor-extension-adoption`: 兼容窗口结束后移除旧 CLI、旧配置和迁移桥接，并固定安全删除前置条件。

## Impact

影响核心配置、CLI、Monitor 源码和资源、公共导出、package files、文档及测试。变更具有破坏性，必须在实施前形成单独共识，并基于真实兼容期证据决定是否进入本阶段。
