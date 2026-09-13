## Context

现有扩展包来自发布包内的 `extensions/<id>/<version>/`，安装时由 Host 执行并将运行目录、配置和 Hook 作为 Workspace 制品保存。该模型无法避免多个 Workspace 重复保存包内容，也无法让一个 Runtime 被多个 Workspace 复用。本 Change 只重建本地包存储和 Workspace activation；包来源仍是当前发布包内置目录，不处理远程下载。

## Goals / Non-Goals

**Goals:**

- 建立用户级、不可变、可多版本共存的 Extension Store。
- 让 Workspace activation 精确引用扩展版本和完整包摘要。
- 保持现有 staging、Host 校验、事务、漂移检查和卸载语义。
- 为后续通用 Runtime Host 提供稳定的包定位和引用接口。
- 保证扩展源码和依赖不再作为 Workspace 制品写入。

**Non-Goals:**

- 不实现远程 catalog、下载、签名或第三方扩展市场。
- 不实现 Runtime service 进程管理。
- 不改变 Monitor 业务或迁移 `src/monitor`。
- 不建立全局 Workspace。

## Decisions

### D1: 使用 Code Workspace 管理的用户级 Store

Store 使用 Host 管理的用户数据目录，内部按扩展 ID、版本和完整包摘要保存不可变包。当前发布包内置目录是第一种 Package Provider；不直接使用用户 npm 全局目录，避免外部修改、扁平依赖和版本状态不可追踪。

### D2: Workspace 保存 activation，不保存 package

Workspace 的 `ext-manifest.json` 记录精确的 `id`、`version`、`packageSha256`、制品和 Hook。init 仍在 staging 中生成 Workspace 制品，但入口从 Store 包执行。生成的 Hook/MCP 配置不得写入 Store 的绝对路径。

### D3: 包安装与 Workspace 安装分阶段提交

Host 先将包安全导入 Store，再执行扩展入口并提交 Workspace 事务。Workspace 事务失败时不得留下 activation；Store 包可作为无引用缓存保留，由 GC 延迟清理。这样避免跨目录事务无法回滚的问题。

### D4: 引用计数只用于 GC，不作为正确性来源

全局 registry 记录 Workspace activation、运行进程、未完成操作和显式 pin。GC 只能删除没有任何引用且未被锁定的包；卸载 Workspace 不直接删除包目录。

### D5: 旧状态兼容优先

Host 继续读取旧 installed protocol v1/v2/v3。升级时优先通过新 Store 重新生成 Workspace 制品；无法定位原包时保留旧制品并报告迁移诊断，不能静默删除。

## Risks / Trade-offs

- [Workspace 不再自包含] → activation 固定版本和摘要，并预留未来 `restore` 接口；本 Change 仅保证当前发布包可重新导入。
- [全局 Store 被手工修改] → 每次使用前验证 manifest、入口和 package digest，目录采用不可变版本路径。
- [包引用泄漏导致 Store 膨胀] → 提供显式 GC，记录所有 activation 和运行引用，失败时保留包而不是破坏 Workspace。
- [跨用户或权限目录差异] → Store 路径由平台适配器提供，核心只使用抽象路径和原子文件 API。
- [旧 Workspace 迁移失败] → 迁移先 dry-run 和验证，失败保留旧状态与制品。

## Migration Plan

1. 引入 Store 和内置 Package Provider，但不改变现有安装路径。
2. 为新安装写入 package 引用和 Workspace activation。
3. 对既有 Workspace 执行可回滚迁移：导入包、重建制品、更新 activation。
4. 迁移成功后再允许 GC 清理无引用的旧包目录。
5. 回滚时恢复旧 Workspace 状态和制品；Store 中新增包可保留为缓存。

## Open Questions

- 用户级 Store 的平台路径和权限策略需要由运行时 Host Change 固化。
- 是否在本 Change 提供 `extension prune` CLI，还是先提供内部 GC API。
- 旧 Workspace 内运行目录是否全部重建，还是允许在无法验证包时暂时保留 legacy 状态。
