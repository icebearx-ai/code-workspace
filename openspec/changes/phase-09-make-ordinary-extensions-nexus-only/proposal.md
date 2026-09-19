## Why

普通扩展已经由 Nexus 托管，但代码仍把包内 `extensions/` 当作普通扩展目录来源。当前测试阶段需要切断这条旧路径，避免普通扩展继续被发现、打包或运行时补种，同时保留系统扩展的产品内置生命周期。

## What Changes

- **BREAKING** 普通扩展只允许从 Nexus 和已验证 Extension Store 解析，不再从包内普通扩展目录解析。
- 将已移动到 `extensions/codew-workspace-guard` 的系统扩展按显式系统扩展身份识别。
- 系统扩展继续由 `init` 自动安装/升级，并从普通安装、卸载、升级和选择列表中隐藏或拒绝。
- 删除普通内置扩展发现、运行时补种、迁移兜底和自动发布路径。
- 更新打包、运行时、文档和测试，使普通内置扩展不再作为发布包内容。

## Capabilities

### New Capabilities

- `system-extension-source-boundary`: 定义移动后的系统扩展识别、保护和生命周期边界。

### Modified Capabilities

- `workspace-init-extensions`: 普通扩展来源改为 Nexus/Store，系统扩展继续自动管理。

## Impact

影响 `src/core/extensions.js`、`src/core/extension-store.js`、`src/cli/commands/ext.js`、`src/cli/commands/init.js`、打包脚本、扩展目录、文档和相关测试。测试阶段明确不提供旧 Workspace 兼容迁移。
