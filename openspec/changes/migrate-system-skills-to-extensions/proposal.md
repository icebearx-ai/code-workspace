## Why

`WORKSPACE_GUARD`、`codew-add-projects` 和 `codew-resolve-branch` 目前由核心 managed files 直接维护，无法复用扩展的版本、事务和安装状态模型。将三者变为一个系统扩展，可以统一这些 Workspace 安全资产的生命周期，同时保证它们随 Workspace 默认启用且不暴露为可选集成。

## What Changes

- **BREAKING** 将 Workspace Guard、两个 Skill 及 `codew-add-projects` 的 Claude 命令从核心 managed files 迁移到 `extensions/.system/codew-workspace-guard` 下的单一版本化扩展包。
- 增加系统扩展发现与分类；系统扩展复用普通扩展的 manifest、入口、staging、Store、事务和 installed state。
- `init` 自动安装/升级系统扩展；普通扩展选择界面不展示系统扩展，`--extensions none` 不影响系统扩展。
- 禁止通过 `extension install` 和 `extension uninstall` 手动管理系统扩展。
- 删除旧核心 managed-file 定义及对应测试依赖；不提供旧 Workspace 兼容迁移。

## Capabilities

### New Capabilities

- `system-extensions`: 定义系统扩展的发现、自动安装、隐藏选择和不可卸载策略。

### Modified Capabilities

- `workspace-init-extensions`: 改变 init 的扩展请求语义，并区分普通扩展与系统扩展。

## Impact

- 影响 `src/core/extensions.js`、扩展安装/卸载命令和 init 流程。
- 新增 `extensions/.system/codew-workspace-guard` 包，包含 Guard、两个 Skill 及其工具入口。
- 修改 `artifacts/manifest.json`、扩展规范、CLI 文档和扩展回归测试。
- 允许破坏性修改；不维护当前版本之前 Workspace 的 managed-file 或 extension state 兼容。
