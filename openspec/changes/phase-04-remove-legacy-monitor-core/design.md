## Context

phase-03 已提供独立的 `extensions/monitor/1.0.0`，包含 Workspace activation、全局 service、Store、Dashboard、SSE、i18n 和 failure-open 上报。当前核心仍通过 `src/monitor` 保留同一套业务实现，`src/index.js` 也继续导出这些 API。

## Goals / Non-Goals

**Goals:**

- 删除 `src/monitor/` 及其核心公共导出。
- 让 `codew monitor` 和 `codew monitor report` 只依赖扩展/通用 Runtime Host。
- 保留已有 Workspace activation、共享 service、用户级数据和卸载兼容性。
- 将测试、打包清单和文档的唯一 Monitor 实现来源切换到扩展包。

**Non-Goals:**

- 不改变 Monitor API、Session 生命周期、Dashboard 或数据清理规则。
- 不删除 `extensions/monitor`、Extension Store 或 Runtime Host。
- 不在本 Change 中处理远程下载或扩展市场。

## Decisions

1. **先建立扩展边界测试，再删除核心实现。** 通过扩展包直接测试生命周期、SSE、删除、i18n 和多 Workspace 聚合，确保删除不会依赖隐式回退。
2. **兼容 CLI 保留在 CLI 层。** `codew monitor` 继续接受已有端口参数并路由到 `ext monitor serve`；上报命令保留 failure-open，但不再 import `src/monitor`。
3. **不迁移或删除用户数据。** 用户级 runtime data、Store 引用和 Workspace activation 状态由通用 Host 管理，清理核心代码不得触碰这些路径。
4. **保留旧 installed manifest 的卸载能力。** 卸载路径继续仅依据状态和 Host artifact 逻辑，不读取已删除的 Monitor 包入口。

## Risks / Trade-offs

- [隐藏调用方仍 import `src/monitor`] → 全仓库搜索、公共入口测试和 npm pack 检查必须失败即停。
- [兼容命令行为漂移] → 复用 phase-03 的 CLI/HTTP 对等矩阵，并保留稳定错误码。
- [旧 Workspace 卸载失败] → 增加无扩展源码情况下的旧状态卸载回归测试。

## Migration Plan

1. 先将所有测试和 CLI 引用切换到扩展 Monitor 或通用 Host。
2. 删除 `src/monitor` 目录、入口导出及核心专用打包引用。
3. 运行完整测试、CLI architecture check、npm pack 和 OpenSpec 校验。
4. 若发布后发现问题，回滚本 Change 的代码提交；不得删除用户级 Monitor runtime data。

## Open Questions

无。删除前提是 phase-03 的兼容性和多 Workspace 证据已经通过。
