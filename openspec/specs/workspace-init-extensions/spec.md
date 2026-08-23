# Workspace Init Extensions Specification

## Purpose

定义 Code Workspace 内置扩展的发现、隔离执行、事务安装与卸载、状态管理及 CLI 交互契约，确保扩展能力与核心 Workspace 初始化保持明确边界。

## Requirements

### Requirement: 发现内置扩展并解析兼容版本
系统 SHALL 只从 Code Workspace 包根的 `extensions/<name>/<version>/` 发现扩展，其中名称匹配小写字母、数字和短横线，版本为标准 SemVer，并且版本目录包含 `init.js` 与 `manifest.json`。系统 SHALL 为请求名称选择与当前 Code Workspace 版本兼容的最高版本。

#### Scenario: 选择最高兼容版本
- **WHEN** 一个扩展存在多个合法版本且其中多个版本兼容当前 Code Workspace
- **THEN** 初始化计划只选择最高的兼容 SemVer，并固定其版本和 manifest SHA-256

#### Scenario: 拒绝版本选择语法
- **WHEN** 用户通过 `--extensions` 请求 `openspec-workspace@1.0.0`
- **THEN** 系统以稳定的扩展选择错误拒绝请求且不执行初始化写入

### Requirement: 校验扩展 manifest 和目标所有权
系统 SHALL 校验 manifest schema、试验标记、目录 identity、入口、兼容范围、超时和逐文件 artifacts。每个 target MUST 是安全的 Workspace 相对 POSIX 路径，且 SHALL 拒绝绝对路径、反斜杠、`.`/`..` 段、符号链接逃逸、重复目标、核心托管目标以及扩展间冲突。

#### Scenario: 路径逃逸被拒绝
- **WHEN** artifact target 包含 `..`、绝对路径、反斜杠或其现有祖先是符号链接
- **THEN** 系统在启动扩展入口前拒绝该扩展且不修改真实 Workspace

#### Scenario: 扩展目标冲突被拒绝
- **WHEN** 两个扩展或一个扩展与已安装的其他扩展声明同一目标
- **THEN** 冲突扩展返回稳定错误且任何冲突目标均不被覆盖

### Requirement: 隔离生成并验证制品
系统 SHALL 在独立 Node 子进程中运行入口，只向其提供最小 context 和独立 output 目录，不提供真实 Workspace 根目录。系统 SHALL 执行超时，并在安装前拒绝缺少、额外、非普通、符号链接或 SHA-256 不匹配的输出。

#### Scenario: 正确输出通过验证
- **WHEN** 入口在超时内成功退出并生成且仅生成全部已声明的匹配 hash 文件
- **THEN** Host 进入该扩展的真实 Workspace 安装事务

#### Scenario: 异常输出被回收
- **WHEN** 入口超时、崩溃、缺少文件、生成额外文件或 hash 不匹配
- **THEN** Host 删除 staging、不写入声明目标，并继续处理下一个扩展

### Requirement: 扩展以独立文件事务安装
系统 SHALL 将单扩展的所有制品和 `ext-manifest.json` 作为一个事务写入，重新读取验证制品和状态后才提交。失败时 SHALL 恢复该扩展写入前的全部文件，且不得回滚已成功的核心初始化或其他扩展。

#### Scenario: 安装及状态写入成功
- **WHEN** 全部声明制品安装成功且后置条件匹配
- **THEN** 系统提交文件并记录 installed 版本、manifest hash、实际 artifact hash 及 installed lastAttempt

#### Scenario: 升级写入失败
- **WHEN** 已安装扩展升级过程中任一真实 Workspace 写入、状态写入或验证失败
- **THEN** 系统恢复旧版本全部制品和旧 installed，并将新版本失败记录为 lastAttempt

#### Scenario: 回滚不完整
- **WHEN** 扩展安装失败且至少一个原文件无法恢复
- **THEN** 系统报告 `EXTENSION_ROLLBACK_INCOMPLETE` 并继续处理后续扩展

### Requirement: Workspace 状态区分安装与尝试
系统 SHALL 在 `.code-workspace/ext-manifest.json` 中使用 schemaVersion 1 和 experimental 标记，并为每个扩展分别维护 `installed` 与 `lastAttempt`。失败尝试 MUST NOT 将仍有效的旧 installed 状态清空。

#### Scenario: 首次安装失败
- **WHEN** Workspace 中没有该扩展 installed 状态且首次安装失败
- **THEN** installed 为 null，lastAttempt 记录失败版本、状态、稳定 code 和 message

#### Scenario: 升级失败保留已安装版本
- **WHEN** 已安装旧版本而新版本初始化失败
- **THEN** installed 仍指向旧版本，lastAttempt 指向失败的新版本

### Requirement: init 提供明确的扩展选择语义
交互式 `init` SHALL 允许按扩展名多选并展示最高兼容版本。非交互式 `init` SHALL 接受 `--extensions <comma-list|none>`；新 Workspace 未提供该选项时 SHALL 不安装扩展，已有 Workspace 未提供时 SHALL 默认请求已安装扩展。未选择的已安装扩展 SHALL 保持不变。

#### Scenario: 非交互新 Workspace 默认无扩展
- **WHEN** 新 Workspace 以非交互模式运行 init 且未传 `--extensions`
- **THEN** 初始化计划的 requested extensions 为空

#### Scenario: 已有 Workspace 默认升级已安装扩展
- **WHEN** 已有 Workspace 重新运行 init 且未显式选择扩展
- **THEN** 初始化计划请求每个已安装扩展并解析当前最高兼容版本

#### Scenario: none 不卸载
- **WHEN** 已有 Workspace 使用 `--extensions none`
- **THEN** 本次不初始化扩展且保留所有已安装状态和制品

### Requirement: 核心成功与扩展结果相互隔离
系统 SHALL 仅在核心初始化成功提交后执行扩展。扩展 SHALL 按请求顺序独立执行，失败产生 warning diagnostic 并在结构化结果中完整呈现，但不得使成功的核心 init 顶层 `ok` 或退出码变为失败。

#### Scenario: 核心失败跳过扩展
- **WHEN** 核心初始化失败或回滚
- **THEN** 系统不启动任何扩展入口

#### Scenario: 部分扩展失败
- **WHEN** 核心成功且请求的多个扩展中至少一个失败
- **THEN** 顶层结果保持成功，extensions results 保持请求顺序，summary 统计 installed、skipped、failed，并附带 warning diagnostics

### Requirement: 发布首个 OpenSpec Workspace 扩展
npm 包 SHALL 包含 `extensions/openspec-workspace` 的至少一个兼容版本。该扩展 SHALL 根据 context 中选择的工具生成 manifest 分别声明、内容 hash 匹配且互不共享目标的 Codex 和 Claude OpenSpec skill 文件。

#### Scenario: 只为选择工具生成文件
- **WHEN** context tools 只包含 `codex`
- **THEN** 扩展生成 Codex artifact，并按输出协议处理未适用的 Claude artifact，而不写任何未声明目标

#### Scenario: 发布包包含扩展仓库
- **WHEN** 执行 npm pack dry-run
- **THEN** 包内容包含 `extensions/openspec-workspace/<version>/init.js`、`manifest.json` 和所需模板文件

### Requirement: 扩展入口与执行环境遵守最小契约
系统 SHALL 在计划中冻结并在执行前验证扩展入口 SHA-256，且 SHALL 仅向扩展子进程传递运行所需的环境变量白名单。扩展契约 SHALL 以随包文档和 JSON Schema 发布。

#### Scenario: 入口在计划后被修改
- **WHEN** `init.js` 内容在扩展计划冻结后发生变化
- **THEN** Host 以稳定的计划过期错误拒绝执行入口且不写入扩展制品

#### Scenario: 子进程环境最小化
- **WHEN** 扩展入口读取环境变量
- **THEN** 入口无法获得父进程的 `PWD`、凭证或未声明业务变量

### Requirement: 扩展准备失败不阻断核心初始化
系统 SHALL 将扩展仓库条目、扩展状态和已选扩展准备阶段的内部失败转换为有序扩展结果和 warning diagnostics。非法选择语法和未知扩展名仍 SHALL 在任何写入前失败。

#### Scenario: 未选择扩展损坏
- **WHEN** 内置仓库中一个未选择扩展的 manifest 无效
- **THEN** 核心 init 可成功且该扩展以 warning 报告

#### Scenario: 扩展状态损坏
- **WHEN** 已有 Workspace 的 ext-manifest 无法解析
- **THEN** 核心 init 可成功，扩展批次跳过并报告稳定 warning

### Requirement: Host 托管共享 Codex 制品
系统 SHALL 支持 `file`、`codex-config-block` 和 `codex-hooks` artifact。配置块 SHALL 仅修改自己的标记范围并验证完整 TOML；Hook SHALL 由 Host 将核心与扩展 contribution 按稳定顺序合成。共享文件未知修改或贡献冲突 MUST 在写入前被拒绝。

#### Scenario: 安装配置块保留用户内容
- **WHEN** `.codex/config.toml` 含有与扩展无关的合法配置
- **THEN** Host 只增加扩展标记块并保留其他内容

#### Scenario: 合成多个 Hook contribution
- **WHEN** 核心 monitor 与一个或多个扩展声明 Hook
- **THEN** Host 写出包含全部贡献的确定性 hooks.json 并记录可卸载状态

### Requirement: 扩展可事务性卸载
系统 SHALL 提供 `extension uninstall <name>` planned-write 命令。卸载 SHALL 只依据 installed 状态，由 Host 移除独占文件、配置块和 Hook contribution，并删除该扩展状态；不得执行扩展代码。完整后置条件验证前不得提交。

#### Scenario: 卸载已安装扩展
- **WHEN** 用户确认卸载且全部制品仍匹配 installed 状态
- **THEN** 系统原子移除该扩展全部制品和状态，同时保留用户内容、核心贡献和其他扩展贡献

#### Scenario: 卸载已不存在于包中的扩展
- **WHEN** installed 状态存在但当前内置仓库不再包含该扩展
- **THEN** 系统仍可仅根据 installed 状态完成卸载

#### Scenario: 本地修改阻止卸载
- **WHEN** 任一独占文件、配置块或共享 Hook 文件包含未知修改
- **THEN** 系统以稳定错误拒绝卸载且事务不产生部分删除

### Requirement: 扩展可独立选择和安装
系统 SHALL 提供 `extension install [name...]` planned-write 命令，不执行核心 Workspace 初始化。显式名称 SHALL 按参数顺序请求最高兼容版本；未提供名称时，系统 SHALL 只在交互 TTY 中展示全部有效内置扩展名称及兼容状态，并允许多选。安装 SHALL 复用扩展的计划冻结、逐扩展事务、后置验证、回滚和状态持久化能力。

#### Scenario: 显式安装已卸载扩展
- **WHEN** 用户执行 `extension install openspec-workspace --yes` 且该扩展未安装
- **THEN** 系统安装最高兼容版本、验证制品和 installed 状态，并且不重写核心 Workspace 制品

#### Scenario: 无参数交互多选
- **WHEN** 用户在 TTY 中执行不带名称的 `extension install`
- **THEN** 系统展示全部有效内置扩展，允许选择多个兼容扩展，并在一次确认后按选择顺序执行

#### Scenario: 交互取消不产生写入
- **WHEN** 用户在扩展多选中按 ESC 或提交空选择
- **THEN** 命令成功退出并报告 cancel 或 skip，且扩展制品和状态均不改变

#### Scenario: 无参数非交互失败
- **WHEN** JSON、非 TTY 或 `--yes` 调用未提供任何扩展名称
- **THEN** 系统以 `EXTENSION_SELECTION_REQUIRED` 在任何写入前失败，并提示显式传入一个或多个名称

#### Scenario: 多扩展安装部分失败
- **WHEN** 一个请求包含多个扩展且其中一个执行失败
- **THEN** 系统回滚失败扩展、继续后续扩展、保留有序结果，并使独立安装命令顶层失败

#### Scenario: 扩展操作互斥
- **WHEN** 同一 Workspace 已有 init、安装或卸载操作持有操作锁
- **THEN** 另一个扩展安装或卸载命令在写入前以稳定锁错误退出
