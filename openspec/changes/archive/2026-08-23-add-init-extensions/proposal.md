## Why

Code Workspace 的 `init` 目前只能初始化核心 Workspace，无法以可验证、可回收的方式分发工具集成。直接让内置脚本修改真实 Workspace 会把扩展故障扩大到核心初始化，因此需要一个本地、受控并具备独立事务边界的试验性扩展机制。

## What Changes

- 在 npm 包内发布只读的 `extensions/<name>/<semver>/` 本地扩展仓库，并自动发现最高兼容版本。
- 为扩展定义静态 `manifest.json`，校验文件制品目标、hash、兼容性、冲突与路径安全。
- 在独立 Node 子进程和 staging 目录中运行 `init.js`，由 Host 验证输出后事务性写入 Workspace。
- 在 `.code-workspace/ext-manifest.json` 中分离记录已安装状态和最近一次尝试，支持升级失败恢复旧版本。
- 扩展初始化与核心初始化使用不同事务：核心成功不因扩展失败回滚，扩展逐个执行并返回完整结构化汇总和 warning diagnostics。
- 扩展 `init` 交互多选及非交互 `--extensions <names|none>`，只允许选择扩展名，确认后固定版本和 manifest hash。
- 为扩展制品定义 Host 托管的 `file`、`codex-config-block` 和 `codex-hooks` 类型；共享配置由 Host 合成，扩展入口仍不能直接写真实 Workspace。
- 新增事务性的 `extension uninstall <name>`，只根据已安装状态回收独占文件、TOML 管理块和 Hook 贡献，不执行扩展自定义卸载脚本。
- 新增 `extension install [name...]`：显式名称支持非交互安装；无名称时在 TTY 中展示全部内置扩展并多选，ESC 无写入退出。
- 将扩展仓库、扩展状态和选中扩展的准备失败隔离为扩展诊断，避免内部故障阻断成功的核心初始化。
- 发布 manifest JSON Schema 和扩展开发契约，并冻结扩展入口 hash、收紧子进程环境变量。
- 随包提供首个 `openspec-workspace` 扩展，为已选择的 Codex/Claude 工具生成独立的 OpenSpec skill 文件。

## Capabilities

### New Capabilities

- `workspace-init-extensions`: 定义内置扩展发现、选择、兼容版本解析、隔离生成、制品验证、独立事务安装、状态持久化及 init 结果语义。

### Modified Capabilities

无。

## Impact

- 影响 `init` 与新增 `extension install`、`extension uninstall` 命令的注册、解析、确认、事务和 JSON/text 结果。
- 新增 core extension service、扩展状态持久化、子进程执行和文件事务协作。
- 新增 `extensions/openspec-workspace` 发布内容，并将 `extensions` 纳入 npm `files`。
- 不引入网络加载、第三方目录、依赖解析、任意补丁、扩展卸载脚本、强制卸载或恶意代码安全沙箱。
