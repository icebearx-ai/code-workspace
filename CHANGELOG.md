# Changelog

Code Workspace 的所有重要变更都记录在此文件中。

格式基于 [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)，版本遵循 [Semantic Versioning](https://semver.org/spec/v2.0.0.html)。

## [Unreleased]

暂无变更。

## [1.1.0] - 2026-09-24

### 新增

- 新增本地扩展安装：`codew extension install --local <tarball>`。开发者可以在发布到 Registry 前，将最终生成的 `.tgz` 包安装到 Workspace 中进行验证。该流程复用 tarball 完整性校验、安全解压、Extension Store 导入、确认、事务、回滚及生命周期处理；本地包以 `source: local` 记录，相同包可幂等复用，不同 digest 的同版本包会被拒绝。([ea2323a](https://github.com/icebearx-ai/code-workspace/commit/ea2323a2cc8b04f79e22caa9e1770f6e93a49a3a))
- 新增 `codew init` 开发模式选择。交互式初始化会询问开发模式；新 Workspace 默认选择“是”，已有 Workspace 使用已保存的值作为默认选项。也可以通过 `--dev true` 或 `--dev false` 在非交互模式下直接指定。([981df89](https://github.com/icebearx-ai/code-workspace/commit/981df89932edb7bc1b211e80fafab6588ef2fca9))

[Unreleased]: https://github.com/icebearx-ai/code-workspace/compare/v1.1.0...HEAD
[1.1.0]: https://github.com/icebearx-ai/code-workspace/compare/v1.0.0...v1.1.0
