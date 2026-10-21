# Changelog

Code Workspace 的所有重要变更都记录在此文件中。

格式基于 [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)，版本遵循 [Semantic Versioning](https://semver.org/spec/v2.0.0.html)。

## [Unreleased]

## [2.0.0] - 2026-10-21

### 移除

- **BREAKING** 移除扩展安装、升级、卸载、搜索、info、打包、scaffold、digest 和运行命令。
- **BREAKING** 移除用户级扩展 Registry 配置与 `config` 命令。
- **BREAKING** 移除 Nexus Registry、本地 Extension Store、扩展 manifest 协议和扩展运行时。
- 移除 monitor 扩展、Provider Hook 适配和扩展拥有的 `.codex/hooks.json` 组合能力。

### 变更

- `codew-workspace-guard` 改为内置托管 Agent 集成，继续生成 Workspace 指令、添加项目 Skill/Command 和分支恢复 Skill。
- `init`/`update`/`doctor` 直接管理内置 Agent 资产，不再执行扩展入口。
- 可识别的旧扩展状态与 Hook 通过确认后的安全清理计划移除；未知修改保留并报告。
- 项目注册、描述、授权、分支检查与安全恢复能力保持不变。
- 依赖和 npm 发布内容显著缩减，项目版本提升为 `2.0.0`。

## [1.1.0] - 2026-09-24

### 新增

- 新增本地扩展安装：`codew extension install --local <tarball>`。开发者可以在发布到 Registry 前，将最终生成的 `.tgz` 包安装到 Workspace 中进行验证。该流程复用 tarball 完整性校验、安全解压、Extension Store 导入、确认、事务、回滚及生命周期处理；本地包以 `source: local` 记录，相同包可幂等复用，不同 digest 的同版本包会被拒绝。([ea2323a](https://github.com/icebearx-ai/code-workspace/commit/ea2323a2cc8b04f79e22caa9e1770f6e93a49a3a))
- 新增 `codew init` 开发模式选择。交互式初始化会询问开发模式；新 Workspace 默认选择“是”，已有 Workspace 使用已保存的值作为默认选项。也可以通过 `--dev true` 或 `--dev false` 在非交互模式下直接指定。([981df89](https://github.com/icebearx-ai/code-workspace/commit/981df89932edb7bc1b211e80fafab6588ef2fca9))

[Unreleased]: https://github.com/icebearx-ai/code-workspace/compare/v1.1.0...HEAD
[1.1.0]: https://github.com/icebearx-ai/code-workspace/compare/v1.0.0...v1.1.0
