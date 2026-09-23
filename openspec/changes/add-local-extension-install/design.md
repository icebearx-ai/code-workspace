## Context

当前 Registry 安装流程已经具备候选解析、tarball 验证、Store 导入和 Workspace 安装事务。本地安装只需要增加本地 tarball 入口，不能复制另一套安装实现。

## Goals / Non-Goals

**Goals:**

- 让开发者测试与未来发布完全一致的 `.tgz` 内容。
- 在写入 Store 或 Workspace 前完成完整 tarball 验证。
- 保持安装、回滚、状态引用和卸载行为与普通扩展一致。

**Non-Goals:**

- 不支持 package 源码目录安装。
- 不访问 Registry 或解析 Registry 元数据。
- 不允许覆盖同一 id/version 下的不同 package digest。
- 不新增 `--replace` 开发模式。

## Decisions

- 使用现有 `extension install` 的 `--local <tarball>` 模式；默认无 `--local` 时保持 Registry 安装。这样安装动作只有一个入口，来源是模式选择。
- `--local` 模式要求恰好一个 tarball 参数，并拒绝 `--version`、`--allow-deprecated`、额外扩展名和其他 Registry 选择参数。
- 先调用 `inspectExtensionTransportTarball` 和 `extractExtensionTransportTarball`，再调用 `ensureStoredExtensionPackage`，最后复用 `runExtensionBatch`。
- 本地 tarball 的 SHA-512 integrity 在导入结果中保存到 Store provenance；包身份仍由 id、version 和 packageSha256 决定。
- Store 导入使用 `source: local`；已存在同 digest 包直接复用，digest 不同则返回稳定冲突错误。
- 命令要求 Workspace，使用共享确认策略和 `--yes`，JSON/non-TTY 不提示。

## Risks / Trade-offs

- [本地包路径可能在安装后失效] → 路径仅用于本次操作和展示，不作为包有效性的依据。
- [临时解压残留] → 所有准备阶段使用临时目录，并在成功或失败后清理。
- [同版本迭代不便] → 第一版要求开发者递增版本或 prerelease 版本，避免破坏 Store 不可变模型。

## Migration Plan

新增命令不改变既有 Registry 安装和 Store 记录；旧 Store registry 继续按现有 schema 读取，新增 local provenance 仅由新命令写入。
