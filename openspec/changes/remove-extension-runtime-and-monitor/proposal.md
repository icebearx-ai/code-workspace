## Why

Code Workspace 的核心价值是本地多项目注册、Agent 授权、分支期望状态协调和工作区校验；当前 Extension Host、Registry、Store、Runtime、Hook 组合和可选监控为这组核心能力引入了不成比例的复杂度。项目需要净化为纯粹的多项目管理工具，用随 CLI 发布的内置 Agent 集成替代可插拔扩展机制。

## What Changes

- **BREAKING** 移除普通扩展生命周期和命令：`extension install/uninstall/upgrade/search/info/pack/init/digest update` 与 `ext`。
- **BREAKING** 移除用户级 `extensions.registry`、`extensions.scope`、`extensions.auth-type` 配置域；在没有其他配置域前移除 `config get/list/set/delete` 命令。
- **BREAKING** 移除 Nexus Registry、扩展包下载、本地 Extension Store、扩展 manifest 校验、扩展运行时协议和扩展开发/发布能力。
- 移除可选监控扩展、Claude/Codex Hook 事件适配和 `.codex/hooks.json` 扩展组合能力。
- 将现有 `codew-workspace-guard` 系统扩展迁为随 CLI 发布的内置 Agent 集成资产，继续生成 `AGENTS.md`、`CLAUDE.md`、添加项目 Skill/Command 和分支恢复 Skill。
- 保留 Workspace 初始化/更新/Doctor、项目注册与描述、Agent 目录授权、项目分支检查与安全恢复、`updateLatest` 受限 fast-forward，以及中英文能力。
- 提供已有 Workspace 的迁移策略：内置 Agent 资产接管原系统扩展输出；扩展状态与监控 Hook 以安全、可验证、需确认的方式清理或降级为 legacy 提示；项目注册和权限数据必须保留。
- 删除扩展相关依赖、schemas、打包脚本、文档、测试和发布文件，显著缩小 CLI 表面和 npm 包。
- 将项目定位和架构文档更新为“本地多项目注册表 + Git 分支期望状态 + Agent 权限/指令集成”的轻量控制平面。

## Capabilities

### New Capabilities

- `builtin-agent-integration`: 随 CLI 直接发布并维护 Workspace Agent 指令和内置 Skill/Command，不依赖扩展安装、运行或生命周期状态。

### Modified Capabilities

- `workspace-init-extensions`: 初始化不再提供扩展选择、Registry 查询或扩展安装；仅支持内置 Agent 集成和历史扩展状态迁移，规格能力更名为 `workspace-init` 语义。
- `extension-execution-protocol`: 移除扩展安装、校验、执行、升级、卸载和运行时协议要求。
- `monitor-session-lifecycle`: 移除监控扩展、Hook 事件采集和会话生命周期观测要求。
- `workspace-agent-branch-guidance`: 分支引导 Skill 改由内置 Agent 集成直接托管，要求保持安全流程且不依赖扩展状态。
- `agent-directory-authorization`: 保留授权语义，但初始化/更新不再通过扩展安装触发授权，规范内置集成后的应用路径。

## Impact

- CLI 命令注册、parser、帮助、补全、结果契约和架构守卫需要移除扩展/配置/运行时命令。
- `src/core/extension-*`、`src/core/extensions.js`、`src/core/nexus-extension-provider.js`、`src/hooks`、扩展选择器、扩展命令和相关测试将删除或重写。
- `artifacts/manifest.json`、managed files、`init/update/doctor` 需要接管原系统扩展输出并处理旧 `.codew/ext-manifest.json`、`.codex/hooks.json`。
- `permissions`、`project`、`project branch` 领域逻辑保持兼容，仅移除扩展耦合。
- `package.json` 依赖和发布文件将缩减：预计可移除 npm Registry、tarball、TOML、完整性校验等扩展专用依赖。
- README、中文 README、FRAMEWORK、架构文档、CHANGELOG 和 OpenSpec 主规格需要同步重写。
- 这是 Major 破坏性变更，建议以 `2.0.0` 发布并提供旧 Workspace 迁移说明。
