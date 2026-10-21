## Context

Code Workspace 当前由两部分组成：一部分是稳定的多项目管理控制平面，包括 Workspace 配置、项目注册、Agent 授权、分支期望状态和 Doctor；另一部分是完整的扩展平台，包括 Nexus Registry、扩展包、Extension Store、隔离初始化、manifest/生命周期状态、共享文件合成、Hook 适配和 `codew ext` 运行时。`codew-workspace-guard` 虽被归类为系统扩展，但实际提供的是核心 Agent 指令与 Skill，不应随普通扩展平台一起移除。

本次变更要求删除扩展平台和监控能力，同时保留项目注册、描述、授权、分支恢复、初始化/更新/校验，并把 Agent 集成改为随 CLI 发布的内置托管资产。项目采用 Node.js CommonJS、显式 CLI registry、计划/确认/事务/验证模型，以及 OpenSpec 主规格约束；这些基础约束保持不变。

## Goals / Non-Goals

**Goals:**

- 将 `AGENTS.md`、`CLAUDE.md`、添加项目 Skill/Command 和分支恢复 Skill 改为 CLI 内置托管资产。
- 彻底移除普通扩展安装、升级、卸载、搜索、打包、开发和运行命令。
- 移除 Nexus/本地 Extension Store、扩展 manifest schema、扩展运行时协议和用户级扩展配置域。
- 移除监控扩展、抽象 Hook 适配和扩展拥有的 `.codex/hooks.json` 合成能力。
- 保留项目注册表、项目描述、Agent 目录授权、分支检查与两个显式恢复方向、`updateLatest` 受限 fast-forward、Doctor、语言和补全能力。
- 为已有 Workspace 提供安全迁移：项目与权限数据不丢失，旧扩展状态和监控 Hook 只在可验证且经确认时清理。
- 缩小依赖、测试、发布文件和文档面，以 Major 版本发布破坏性变更。

**Non-Goals:**

- 不实现新的插件系统、Skill 市场或远程能力分发机制。
- 不引入第三方 Skill 运行时；内置 Agent 资产只由本项目版本化发布。
- 不管理 AI Session 生命周期，不提供会话监控、事件采集或通知。
- 不改变项目注册表格式、分支恢复语义、权限文件映射和已有安全边界。
- 不自动处理 Git 脏工作区、冲突、rebase、reset、stash 或生产代码修改。
- 不归档或改写历史 OpenSpec 变更记录。

## Decisions

### 1. 内置 Agent 集成替代系统扩展

将 `extensions/codew-workspace-guard` 的模板、Skill 和 Command 迁入包内普通资产目录（例如 `templates/agent/` 或现有 artifacts source tree），并把每个输出登记到 `artifacts/manifest.json` 的 `managedFiles`。`init/update/doctor` 直接通过现有 managed-files 机制规划、确认、写入、验证和移除这些文件。

理由：这些文件是核心 Workspace 行为，而不是可选能力；继续依赖 Extension Host 会导致“删除扩展系统但保留系统扩展”的矛盾架构。备选方案是保留一个不可卸载的专用系统扩展，但那会保留不必要的 manifest、staging、入口进程和生命周期状态。

### 2. 删除独立扩展配置域和 `config` 命令

移除 `extensions.registry`、`extensions.scope`、`extensions.auth-type` 及 `config get/list/set/delete`。当前用户级配置没有扩展之外的已发布配置键，保留空命令会制造伪能力。

理由：配置面应跟随真实需求。备选方案是保留通用 config 框架，但这会要求发明默认键或允许未定义键，增加兼容成本。

### 3. 旧扩展状态采用显式迁移而非静默忽略

`update` 读取 `.codew/ext-manifest.json` 和 `.codex/hooks.json` 时 SHALL 生成可审查计划：

- 原系统扩展拥有的内置 Agent 输出由新的 managed-file 记录接管；
- 普通扩展输出不再运行，但未知或用户修改内容不得覆盖；
- 扩展状态和监控 Hook 只在内容可识别、计划经确认且后置条件验证通过时删除；
- 无法安全识别的内容保留，并由 Doctor 报告 legacy 诊断和人工处理建议；
- `.codew/config.yaml`、项目引用文件和权限文件中的项目事实必须保持可用。

理由：现有 Workspace 可能包含普通扩展、monitor Hook 或用户修改。直接删除会违反项目的不覆盖未知托管内容原则；完全静默保留又会让 Doctor 长期解释已删除领域。显式迁移提供清晰退出路径。备选方案是只提示不清理，可作为保守回退策略，但与净化目标不一致。

### 4. 扩展命令直接移除并返回 CLI 未识别命令

删除 registry/parser/help/completion 中的 `extension`、`ext` 和 `config` 命令，不再保留兼容 shim。README 和 CHANGELOG 指示用户使用外部 npm/包管理能力安装原普通扩展（如存在），监控能力没有内置替代。

理由：这是 Major 破坏性变更，保留空命令会扩大测试面并暗示能力仍存在。备选方案是添加一年期 deprecation stub，但项目尚未声明长期支持策略，且用户级扩展能力本来就是试验性功能。

### 5. 监控和 Hook 层整体移除

删除 `src/hooks/`、扩展 Hook 状态合成、监控规格和测试；核心初始化不再创建 `.codex/hooks.json`。Agent 指令和 Skill 仍通过普通文件生效，不需要 Hook 运行时。

理由：当前 Hook 抽象主要服务于扩展与监控；保留未使用的 Provider 适配会维持错误的 Session 架构预期。备选方案是保留 provider-neutral Hook 模块作为未来能力，但 YAGNI。

### 6. 架构降级为 Foundation + Workspace + 内置 Agent Integration

文档从 Session/Workspace/Foundation 三层演进目标改为轻量控制平面：Foundation 负责 CLI/config/transaction/diagnostics；Project Domain 负责 registry/branch/verification；Agent Integration 负责内置指令、Skill 和权限适配。Session 只作为明确非目标，不再出现在核心架构承诺中。

理由：删除监控后没有 Session 事实来源，继续保留第三层会让文档与实现不一致。备选方案是把 Session 标为未来扩展，但“扩展”正是本次删除的复杂度来源。

### 7. 版本化破坏性发布

以 `2.0.0` 发布，npm 包移除 `extensions/`、扩展 schemas、扩展开发文档和扩展打包脚本。依赖仅保留初始化交互、YAML、锁和核心运行仍实际使用的包。

理由：命令、状态和包内容均不兼容旧版本。SemVer Major 是最清晰的兼容信号。

## Risks / Trade-offs

- [风险] 已安装普通扩展的文件无法安全识别 → `update/doctor` 不覆盖或删除未知内容，报告 legacy 状态并给出人工确认路径。
- [风险] `.codex/hooks.json` 中混合用户自有 Hook → 仅在 JSON 与旧扩展状态可对应且未漂移时清理；否则保留并报告冲突。
- [风险] 内置 Agent 资产接管旧系统扩展输出时遇到用户修改 → 沿用 managed-file `unknown` 状态，要求用户确认覆盖或保留。
- [风险] 删除 `config` 命令影响脚本 → Major 版本和 CHANGELOG 明确迁移：扩展 Registry 配置不再有效，通用配置待真实需求重新设计。
- [风险] 用户误以为监控仍内置 → README 和 Doctor 错误 remediation 明确监控已在 2.0 移除且无内置替代。
- [风险] 依赖瘦身导致误删初始化 UI 依赖 → 在删除前后分别运行测试、架构检查和 pack 检查，并检查运行时 require。
- [风险] 规格删除范围过大导致归档失败 → Delta spec 对每个被删除 requirement 给出 Reason 和 Migration，并保持 requirement 名称与主规格一致。

## Migration Plan

1. 新增内置 Agent 托管资产和 manifest 记录，先让 `init/update` 在扩展机制仍存在时可以生成等价输出。
2. 为旧 `.codew/ext-manifest.json`、系统扩展记录和 `.codex/hooks.json` 添加只读识别与迁移计划。
3. 在确认新内置输出、项目命令、权限命令和 Doctor 测试通过后，移除普通扩展命令、Runtime、Store、Registry、schemas、脚本和测试。
4. 移除 Hook 与监控状态合成，执行显式清理计划并更新 Doctor。
5. 清理 package 依赖、发布文件、README、中文 README、FRAMEWORK、CLI 架构文档和 CHANGELOG。
6. 同步 OpenSpec delta specs，运行 `npm run check` 和 OpenSpec validate/archive 流程。
7. 发布 `2.0.0`。若发布前发现迁移缺陷，可回退未发布的实现分支；发布后不尝试自动降级已清理状态，用户应从 Git 或备份恢复权限/项目配置前的人工副本。

## Open Questions

- 是否需要在 2.0 中主动删除 `.codew/ext-manifest.json`，还是仅当包含普通扩展/Hook 状态时清理并保留空状态文件？实现阶段应以最小可验证清理为准。
- 旧普通扩展输出的具体识别边界是否只依赖 `ext-manifest.json` 的 installed ownership 记录？应在实现阶段验证现有状态格式是否足以安全删除。
