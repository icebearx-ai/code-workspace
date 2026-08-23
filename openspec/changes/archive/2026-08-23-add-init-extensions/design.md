## Context

当前 `init` 的核心写入已有计划、确认和事务保护，但没有可插拔的集成制品层。扩展随 npm 包一起发布并被信任，但扩展脚本仍可能崩溃、超时或生成错误内容。设计必须让 CLI 保持薄层、让扩展无法在正常契约下直接写真实 Workspace，并确保一个扩展失败不会破坏核心初始化或其他扩展。

## Goals / Non-Goals

**Goals:**

- 从包根 `extensions/` 发现符合命名、SemVer 和 manifest 约束的内置扩展。
- 在确认前解析并冻结每个扩展的最高兼容版本和 manifest hash。
- 在 staging 中隔离运行入口，严格验证声明文件、目标、hash 和冲突，再独立事务写入。
- 保留可靠的 installed 状态，同时记录每次成功或失败尝试。
- 让 `init` 继续以核心初始化成功作为顶层成功和退出码依据，并完整报告扩展结果。
- 允许在不重新执行核心初始化的情况下显式安装、重新安装或升级一个或多个内置扩展。

**Non-Goals:**

- 网络市场、外部目录、用户选版本、依赖解析、扩展间调用和恶意代码沙箱。
- 任意 TOML/JSON patch、扩展自定义卸载脚本、强制卸载、扩展禁用和 `update` 自动升级扩展。
- 允许扩展在初始化期间修改项目、调用 Git 或创建 OpenSpec change。

## Decisions

### 包内版本化仓库与确认前冻结

扩展根固定为 Code Workspace 包根的 `extensions/`。目录名和 manifest identity 必须一致，版本目录使用严格 SemVer。Host 读取全部候选，按当前包版本过滤 `codeWorkspace` 范围并选择最高版本。计划保存版本、规范化 manifest 与原始 manifest SHA-256，执行不重新发现。

选择名称而非版本能保持非交互 API 稳定，并避免暴露首期不提供的版本管理承诺。实现一个覆盖需求所需的 SemVer 解析/比较/范围匹配器，避免为有限范围引入新的运行时依赖。

### 静态 manifest 与 Host 托管制品

`manifest.json` 是扩展版本声明；`.code-workspace/ext-manifest.json` 是 Workspace 安装状态。artifact 必须显式声明 `kind`。首期只支持扩展独占的 `file`、由 Host 以标记块维护的 `codex-config-block`、以及由 Host 确定性合成的 `codex-hooks`。不提供任意 patch。

Host 在计划阶段检查所选扩展之间、所选与已安装其他扩展之间的所有权冲突。扩展只生成 staging 输出；Host adapter 负责真实目标的 inspect、plan、apply、verify 和 remove。共享目标只允许由对应 Host adapter 写入。

### 最小共享文件合成

`codex-config-block` 使用稳定的 extension/artifact 标记包围经 hash 验证的 TOML 片段。Host 保留块外内容，并在安装和卸载前后验证完整 TOML 结构；块被本地修改时拒绝继续。

`codex-hooks` 接受结构化 Hook fragment。Host 将核心 monitor contribution 与全部已安装扩展 contribution 按稳定顺序合成完整 `.codex/hooks.json`。状态保存规范化 fragment，使扩展包不再存在时仍可卸载。共享文件出现未知修改时拒绝写入。

### 子进程生成与 Host 安装

Host 为每个扩展创建独立临时目录，将最小 context 写入临时 JSON，并以 `process.execPath entry --context ... --output ...` 启动子进程。真实 Workspace 路径不进入 context。Host 只传递运行所需的环境变量白名单，并在执行前验证 manifest 与入口 SHA-256。超时后终止子进程；stdout/stderr 仅用于诊断并设大小边界。

入口只能在 output 下生成 manifest 声明的文件。Host 拒绝缺少、额外、非普通文件、符号链接以及 hash 不匹配的输出。这是故障隔离而非安全沙箱：随包代码仍能使用 Node API，因此文档明确其信任边界。

### 核心事务与逐扩展事务

核心 `init` 先按现有事务提交；失败时不运行扩展。随后扩展按请求顺序逐个执行。每个扩展使用一个文件事务覆盖其所有声明目标和 `ext-manifest.json`：安装、重新读取并验证全部目标及状态后才提交；任一阶段失败就恢复该扩展修改前的文件。

升级失败时旧 installed 状态及旧制品保持不变，只在一个单独且尽力而为的状态写事务中更新 `lastAttempt`。若主事务回滚失败，结果升级为 `EXTENSION_ROLLBACK_INCOMPLETE`，但批处理继续。

### CLI 边界和结果

`src/cli/commands/init.js` 只负责获取 extension catalog/plan、应用共享确认、执行核心初始化后调用 core extension batch service，并构造共享 result。parser 只根据 registry 解析字符串选项。core service 拥有 manifest、子进程、文件、事务、验证和 ext-manifest 持久化。

扩展失败产生 warning diagnostic；只要核心成功，顶层 `ok` 保持 true。`data.extensions` 始终包含 requested、逐项 results 和 summary。非交互新 Workspace 未传参数时请求为空；已有 Workspace 默认请求已安装扩展；未选择已安装扩展不卸载。

扩展准备返回 plans、failed 和 diagnostics，而不是因仓库或状态内部损坏直接终止核心 init。非法 CLI 选择语法和未知扩展名仍在写入前失败；已选择扩展自身的 manifest、兼容性或状态问题作为扩展失败随核心成功结果返回。

`extension uninstall <name>` 是独立 planned-write 命令。命令层只负责确认和结果；core 根据已安装状态生成完整删除计划，使用一个文件事务移除独占文件、配置块、Hook contribution 和扩展状态，验证后提交。首期不提供 `--force`，不执行扩展代码。

`extension install [name...]` 同样是独立 planned-write 命令。名称参数是可选 variadic 参数；显式名称按参数顺序安装，不允许版本语法。无名称时只在交互 TTY 中展示全部有效内置扩展，兼容版本可多选，不兼容版本只展示不可选择状态；ESC 和空选择均成功退出且不写入。JSON、非 TTY 或 `--yes` 模式未给名称时，以 `EXTENSION_SELECTION_REQUIRED` 在写前失败。

安装命令从现有 Workspace 配置读取 identity/language，从初始化状态读取 tools，不提供独立 `--tools`，也不运行核心初始化。命令在确认前冻结版本、manifest hash 和目标，应用一次批次确认；执行继续复用逐扩展事务和 best-effort 批处理。与 `init` 不同，独立安装的任一扩展失败会使顶层命令失败，同时保留全部有序结果。`init`、安装和卸载复用同一个 Workspace 操作锁，避免并发修改制品和扩展状态。

## Risks / Trade-offs

- [Node 子进程不是恶意代码沙箱] → 仅加载随 npm 包发布的内置扩展，context 不暴露 Workspace 路径，并明确试验边界。
- [共享文件存在用户修改] → 仅在当前内容匹配 Host 可重建状态时写入；未知修改拒绝安装、升级和卸载。
- [自实现 SemVer 只覆盖首期范围语法] → 对不支持或无效范围拒绝 manifest，并对 beta 包版本和边界增加测试。
- [进程在原子 rename 之间被强杀仍可能留下部分状态] → 正常异常路径使用备份事务恢复，后置条件验证后才提交；不宣称进程级崩溃原子性。
- [失败的 lastAttempt 记录本身可能失败] → 不改变 installed，返回状态持久化 warning；回滚不完整使用独立稳定错误码。
- [已有目标可能是符号链接] → 写前逐段 `lstat`，发现任何 symlink 就拒绝，不跟随到 Workspace 外。

## Migration Plan

该功能以 `experimental: true` 发布，无既有 ext-manifest 迁移。不存在该文件时按空状态处理；首次成功安装时原子创建。发布包检查必须确认 `extensions/` 被包含。回退旧版本 Code Workspace 时扩展制品和 ext-manifest 会保留，但旧 CLI 不读取它们。

## Open Questions

无；外部扩展、任意 patch、强制卸载、自动修复和更强沙箱留给后续 change。
