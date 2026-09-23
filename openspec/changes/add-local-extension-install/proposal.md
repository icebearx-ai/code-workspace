## Why

扩展开发者需要在上传到 Registry 前，用最终生成的 tarball 在本地 Workspace 中验证安装行为。现有 `extension install` 面向 Registry，不能直接消费本地发布物。

## What Changes

- 为现有 `extension install` 增加 `--local <tarball>` 模式，仅接受本地 `.tgz` 文件。
- 复用现有 tarball 校验、安全解压、Extension Store 导入和 Workspace 安装事务。
- 本地包记录为 `source: local`，不访问 Registry。
- 相同版本和相同 digest 幂等复用；相同版本不同 digest 拒绝覆盖。
- 不支持源码目录安装，也不支持同版本强制替换。
- `extension install` 的 Registry 模式保持兼容；`--local` 与扩展名、`--version` 和 `--allow-deprecated` 参数互斥。

## Capabilities

### New Capabilities

- `local-extension-install`: 从本地已打包 tarball 安全安装扩展到当前 Workspace。

### Modified Capabilities

无。

## Impact

- CLI registry、extension command handler 和本地 tarball 导入核心服务。
- Extension Store provenance 模型和本地安装测试。
- 开发文档与 CLI 架构检查。
