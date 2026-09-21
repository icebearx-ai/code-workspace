## Context

当前 `extension pack` 接收直接包含 `manifest.json` 和 `init.js` 的目录，并在打包阶段生成 npm transport envelope。开发者必须手工创建 envelope，并在修改入口或扩展资源后分别维护 `entrySha256` 与 `packageSha256`。

本变更把开发目录调整为 transport package 根目录：根目录包含 `package.json`、`extension/` 和开发文档。公开打包命令只校验已有 package 并生成 tarball；系统内置扩展的现有裸目录由内部兼容路径继续处理。

## Goals / Non-Goals

**Goals:**

- 生成立即可校验、可打包的最小扩展 package。
- 通过 CLI 原子更新入口摘要和扩展目录摘要。
- 让 `extension pack` 不修改源目录，只校验并打包 `package.json` 与 `extension/**`。
- 保持现有安装、tarball 校验和运行时协议不变。

**Non-Goals:**

- 不生成 hooks/runtime 高级模板。
- 不自动同步 id、version、name 等身份元数据。
- 不把 README、依赖或 npm lifecycle 内容放进运输包。
- 不迁移系统扩展的仓库目录结构。

## Decisions

### 1. 使用 package-root 输入合同

新增 core API 识别并校验 `source/package.json` 与 `source/extension/`。envelope 使用现有 `validateExtensionTransportEnvelope`，并以 manifest 身份、版本、Extension Spec 和实际目录摘要进行交叉验证。

替代方案是继续接受裸 extension 目录并在 pack 时补齐 envelope；这会保留手工/隐式生成的不一致，也无法满足“pack 只做校验和打包”的要求。

### 2. 保留内部 legacy 打包入口

公开 CLI `extension pack` 使用 package-root 合同；内部 `scripts/pack-extensions.js` 和系统扩展继续通过现有裸目录 API 打包，避免把系统扩展迁移与开发者体验变更耦合。后续可以单独迁移内置扩展。

### 3. digest update 的更新顺序

`extension digest update` 先计算 `extension/init.js` 并更新 `manifest.entrySha256`，再对整个 `extension/` 目录计算摘要并更新 `package.json.codeWorkspace.packageSha256`。两个文件在临时目录中完成验证后一次性替换，任何失败都不保留部分更新。

### 4. scaffold 使用 core 服务和临时目录

CLI handler 只负责参数、交互、确认和结果。`src/core/extension-scaffold.js` 负责默认值、模板内容、摘要、package 校验、冲突检查和原子提交。新目录必须不存在或为空；重复执行完全相同的生成计划返回 skip，已有不同内容则返回稳定错误。

### 5. tarball 使用源 envelope 字节

`extension pack` 读取并验证源 `package.json`，将其原样写入 tarball 的 `package/package.json`，只收集 `extension/` 下已校验的普通文件。这样 pack 不会偷偷修正元数据，发布结果完全由源 package 决定。

## Risks / Trade-offs

- [Breaking] 公开 pack 的 source 参数由裸扩展目录变为 package 根目录 → 错误中提供迁移提示；内部 legacy API 保持现有脚本可用。
- [摘要漂移] 用户修改 manifest 或扩展资源后 packageSha256 失效 → README 引导运行 `extension digest update`，pack 继续独立拒绝漂移。
- [覆盖风险] init 目标目录可能包含用户文件 → 默认拒绝非空目录，force 仅覆盖脚手架声明的文件并仍需确认。
- [重复身份] package.json 与 manifest 可能手工改成不同版本 → digest update 不修改身份，pack 返回稳定的 envelope identity mismatch。

## Migration Plan

1. 新增 package-root 校验和 scaffold/digest core API。
2. 注册 `extension init` 与 `extension digest update`，更新帮助、completion 和文档。
3. 将公开 `extension pack` 切换到 package-root API，同时保留内部 legacy pack API。
4. 添加 CLI、core、失败清理和 tarball 内容测试。
5. 如需迁移内置扩展，另行将每个版本目录包装为 package-root，并切换批量打包脚本。

## Open Questions

- 是否在后续版本增加 `extension hash` 作为 `extension digest update` 的短别名。
- 是否将系统扩展也迁移到统一 package-root 结构。
