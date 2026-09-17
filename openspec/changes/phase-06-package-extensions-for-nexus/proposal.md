## Why

现有扩展只以 Code Workspace 发布包内目录存在，无法作为独立制品发布到公司 Nexus。需要先建立与现有 Extension package digest 兼容的 npm 分发包装和发布前校验能力，才能让后续 Registry Provider 安全消费远端包。

## What Changes

- 定义 `@codew-ext/<extension-id>@<version>` npm 包命名和固定 `package/extension/` 载荷布局。
- 定义 npm 运输 envelope，使 npm 元数据只承担发现与分发提示，Extension manifest 仍是执行合同。
- 增加 `codew extension pack <source> --output <directory>`，验证扩展后生成可交给 `npm publish` 的 tarball；命令不发布、不登录 Nexus，也不执行 npm 生命周期脚本。
- 拒绝依赖、bundled dependencies、生命周期脚本、身份不一致、符号链接、特殊文件和不受支持 Extension Spec。
- 让当前随包扩展均可由同一打包能力产出 Nexus/npm 包，并增加文件清单、摘要和失败场景测试。
- 本 Change 是执行顺序第 1 步；不实现网络访问、Nexus 查询、远端下载或 Workspace 安装行为。

## Capabilities

### New Capabilities

- `extension-package-distribution`: 定义 Extension 包到 npm/Nexus 制品的命名、包装、校验和打包合同。

### Modified Capabilities

无。

## Impact

影响 CLI registry/parser/dispatch、扩展 manifest 与目录校验复用接口、npm tarball 生成、发布文档、package dependencies 和 CLI/打包测试。新增命令必须保持 Workspace 无关，不得读取或写入目标 Workspace 配置。
