## Why

phase-03 已将 Monitor 的服务、Store、Dashboard、事件映射和 Workspace activation 迁移到 `extensions/monitor`，但仓库仍保留 `src/monitor` 及其公开导出，形成两套实现和长期漂移风险。现在需要在兼容性证据完成后删除 legacy core Monitor，让 Host 核心只保留通用扩展运行时。

## What Changes

- **BREAKING** 删除 `src/monitor/` 下的 legacy Monitor Store、HTTP Server、Dashboard、i18n 和事件映射实现。
- **BREAKING** 从 `src/index.js` 和其他公共入口移除 legacy Monitor 导出。
- 保留 `codew monitor` 兼容命令，但只能路由到 `codew ext monitor serve`，不得再依赖核心 Monitor 业务模块。
- 保留 `codew monitor report` 的 failure-open 上报语义，并使其依赖扩展契约或通用 Host 能力。
- 删除核心 Monitor 专用测试、构建引用、打包入口和旧 managed-file capability；保留扩展 Monitor 的等价测试。
- 验证用户级 Monitor 数据、Workspace activation、共享 service、SSE、Session 生命周期和卸载行为不受影响。
- 记录升级/回滚说明，确保旧 Workspace 可以继续卸载已有 Monitor activation。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `monitor-session-lifecycle`: 将 Monitor 生命周期行为的唯一实现和验证来源固定为 `extensions/monitor`，不再依赖核心模块。
- `workspace-init-extensions`: 删除 legacy Monitor 核心制品和兼容性实现，同时保留 Monitor 扩展 activation、服务和卸载契约。

## Impact

影响 `src/monitor/`、`src/index.js`、CLI 兼容路由、Monitor 测试、npm 打包内容、核心 managed-file 配置及扩展回归测试。不会删除用户级 Monitor runtime data，也不会删除 `extensions/monitor` 或通用 Extension Runtime Host。
