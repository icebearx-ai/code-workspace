## Why

扩展开发者目前需要手工拼装 `manifest.json`、`init.js` 和 npm transport envelope，且每次修改入口或扩展文件后都要手工维护 SHA-256。增加脚手架和摘要同步命令，可以让新扩展从一开始就是可校验、可打包的合规 package，并降低发布前的操作错误。

## What Changes

- 新增 `extension init [path]`，生成完整的扩展 package 根目录：`package.json`、`extension/manifest.json`、`extension/init.js` 和 `README.md`。
- 新增 `extension digest update [path]`，原子更新 `entrySha256` 和 `packageSha256`。
- **BREAKING**：公开的 `extension pack` 输入改为包含 `package.json` 和 `extension/` 子目录的 package 根目录。
- `extension pack` 不再生成或修改 transport envelope，只校验现有 package 并打包其中的 `package.json` 与 `extension/**`。
- 保持系统内置扩展的现有裸目录格式，通过内部兼容入口继续支持仓库内置打包流程。

## Capabilities

### New Capabilities

- `extension-package-scaffold`: 生成可立即校验和打包的扩展 package，以及同步其摘要元数据。

### Modified Capabilities

无。当前仓库没有已归档的 `extension-package-distribution` 主规范，本次将打包输入合同与脚手架合同一起记录在新能力中。

## Impact

- CLI registry、parser、dispatch、帮助和 completion。
- `src/core/extension-package.js` 的 package-root 检查、envelope 校验和 tarball 写入流程。
- 新增扩展 package scaffold/digest core service。
- 扩展 CLI、架构检查、扩展包和运行时相关测试及开发文档。
- 不新增运行时依赖。
