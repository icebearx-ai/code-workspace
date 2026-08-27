# Workspace Init Extensions Specification

## Purpose

定义 Code Workspace 内置扩展的发现、隔离执行、事务安装与卸载、状态管理及 CLI 交互契约，确保扩展能力与核心 Workspace 初始化保持明确边界。

## Requirements

### Requirement: 发现内置扩展并解析兼容版本
系统 SHALL 只从 Code Workspace 包根的 `extensions/<name>/<version>/` 发现可信内置扩展，其中名称匹配小写字母、数字和短横线，版本为标准 SemVer，并且版本目录包含具有稳定发现 envelope 的 `manifest.json`。系统 SHALL 跳过不受 Host 支持的 Extension Spec 实现，为请求名称选择基于受支持规范实现的最高扩展 SemVer，并冻结 manifest、入口及完整扩展版本目录摘要。

#### Scenario: 选择最高受支持版本
- **WHEN** 一个扩展存在多个合法版本，且其中多个版本基于 Host 支持的 Extension Spec
- **THEN** 安装计划只选择这些版本中的最高 SemVer，并固定其规范版本、扩展版本、manifest SHA-256、入口 SHA-256和完整扩展包摘要

#### Scenario: 较新扩展使用未知规范
- **WHEN** 最高扩展 SemVer 使用 Host 不支持的规范版本，而较低扩展 SemVer 使用受支持规范
- **THEN** Host 跳过较新版本并选择较低的受支持版本

#### Scenario: 拒绝版本选择语法
- **WHEN** 用户通过 `--extensions` 请求 `zhuiyi-jira-mcp@0.1.0`
- **THEN** 系统以稳定的扩展选择错误拒绝请求且不执行初始化写入

### Requirement: 校验扩展 manifest 和目标所有权
系统 SHALL 先校验 manifest 的稳定发现 envelope，再只对 Host 支持的 Extension Spec 应用其固定 manifest schema、入口、超时、声明性能力和通用 outputs 校验。每个 target MUST 是安全的 Workspace 相对 POSIX 路径。Host SHALL 拒绝绝对路径、反斜杠、`.`/`..` 段、符号链接逃逸、独占目标父子重叠、核心托管目标、共享类型不兼容、JSON selector 父子重叠以及扩展间所有权冲突。

#### Scenario: 路径逃逸被拒绝
- **WHEN** 受支持规范的 output target 包含 `..`、绝对路径、反斜杠或其现有祖先是符号链接
- **THEN** 系统在启动扩展入口前拒绝该扩展且不修改真实 Workspace

#### Scenario: 扩展目标冲突被拒绝
- **WHEN** 两个受支持扩展声明相同或父子重叠的独占目标，或声明冲突的共享 selector
- **THEN** 冲突扩展返回稳定错误且任何冲突目标均不被覆盖

#### Scenario: 没有受支持规范实现
- **WHEN** 请求的扩展全部版本均声明 Host 不支持的 Extension Spec
- **THEN** 系统以 `EXTENSION_SPEC_UNSUPPORTED` 失败，并报告 Host 支持集合和发现的规范版本

### Requirement: 隔离生成并验证制品
系统 SHALL 为每个扩展创建独立 context、staging 和 result 临时路径，并在独立 Node 子进程中运行入口，不提供真实 Workspace 根目录。result MUST 恰好返回本次工具选择适用的全部静态 output id 与 staging source。Host SHALL 递归枚举 staging，拒绝缺少、额外、越界、重复、重叠、符号链接或特殊文件，并独立计算普通文件和规范目录摘要。

#### Scenario: 正确输出通过验证
- **WHEN** 入口在超时内成功退出，result 完整匹配适用 outputs，且 staging 只包含合法普通文件和目录
- **THEN** Host 独立计算候选摘要并进入该扩展的真实 Workspace 安装事务

#### Scenario: 异常输出被回收
- **WHEN** 入口超时、崩溃、缺少 result、返回未知或重复 output、生成额外内容、路径逃逸、符号链接或特殊文件
- **THEN** Host 删除 staging、不写入声明目标，并继续处理下一个扩展

### Requirement: 扩展以独立文件事务安装
系统 SHALL 将单扩展的独占文件、独占目录、共享 contribution 和 `ext-manifest.json` 作为一个可恢复事务提交，重新读取验证全部制品和状态后才完成安装。失败时 SHALL 恢复该扩展写入前的文件、目录、共享内容和 installed 状态，且不得回滚已成功的核心初始化或其他扩展。

#### Scenario: 安装及状态写入成功
- **WHEN** 全部候选输出安装成功且后置条件匹配
- **THEN** 系统提交事务并记录 Extension Spec 版本、installed record 版本、扩展版本、manifest/扩展包摘要、通用所有权及 Host 计算的制品摘要

#### Scenario: 升级写入失败
- **WHEN** 已安装扩展升级过程中任一目录替换、共享内容合成、状态写入或验证失败
- **THEN** 系统恢复旧版本全部制品、共享 contribution 和旧 installed，并将新版本失败记录为 lastAttempt

#### Scenario: 回滚不完整
- **WHEN** 扩展安装失败且至少一个原文件或目录无法恢复
- **THEN** 系统报告 `EXTENSION_ROLLBACK_INCOMPLETE` 并继续处理后续扩展

### Requirement: Workspace 状态区分安装与尝试
系统 SHALL 在 `.code-workspace/ext-manifest.json` 中使用 schemaVersion 1 和 experimental 标记，并为每个扩展分别维护 `installed` 与 `lastAttempt`。新 installed protocol v3 record SHALL 记录 Extension Spec 版本、扩展版本、manifest 摘要、完整扩展包摘要、通用输出所有权和 Host 验证事实。Host SHALL 继续读取旧 installed protocol v1/v2 以验证和卸载历史制品。失败尝试 MUST NOT 将仍有效的旧 installed 状态清空。

#### Scenario: 首次安装失败
- **WHEN** Workspace 中没有该扩展 installed 状态且首次安装失败
- **THEN** installed 为 null，lastAttempt 记录失败扩展版本、规范版本、状态、稳定 code 和 message

#### Scenario: 升级失败保留已安装版本
- **WHEN** 已安装旧版本而新版本准备或提交失败
- **THEN** installed 仍指向旧扩展及其规范版本，lastAttempt 指向失败的新扩展及规范版本

#### Scenario: 卸载旧 installed record
- **WHEN** Workspace 中存在 protocol v1 或 v2 installed 状态
- **THEN** 新 Host 仍能仅依据该记录验证和卸载制品，不要求重新执行扩展

### Requirement: init 提供明确的扩展选择语义
交互式 `init` SHALL 允许按扩展名多选并展示最高受支持版本及其 Extension Spec。非交互式 `init` SHALL 接受 `--extensions <comma-list|none>`；新 Workspace 未提供该选项时 SHALL 不安装扩展，已有 Workspace 未提供时 SHALL 默认请求已安装扩展。未选择的已安装扩展 SHALL 保持不变。

#### Scenario: 非交互新 Workspace 默认无扩展
- **WHEN** 新 Workspace 以非交互模式运行 init 且未传 `--extensions`
- **THEN** 初始化计划的 requested extensions 为空

#### Scenario: 已有 Workspace 默认升级已安装扩展
- **WHEN** 已有 Workspace 重新运行 init 且未显式选择扩展
- **THEN** 初始化计划请求每个已安装扩展并解析当前最高受支持版本

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

### Requirement: 扩展入口与执行环境遵守最小契约
系统 SHALL 在计划中冻结并在执行前验证 Extension Spec 版本、manifest、扩展入口和完整扩展版本目录摘要，且 SHALL 仅向扩展子进程传递运行所需的环境变量白名单。扩展规范 SHALL 以随包文档和 JSON Schema 集合发布；context 和 result SHALL 回显计划中的 Extension Spec 版本，context 不得包含真实 Workspace 路径，result 不得重新声明 target、所有权或摘要。

#### Scenario: 辅助文件在计划后被修改
- **WHEN** manifest 或入口未变，但 `init.js` 使用的模板、私有元数据或辅助代码在计划冻结后发生变化
- **THEN** Host 以稳定计划过期错误拒绝执行入口且不写入扩展制品

#### Scenario: 执行协议版本不一致
- **WHEN** context 或 result 的 Extension Spec 版本与冻结计划不同
- **THEN** Host 以稳定 context 或 result 错误拒绝执行结果且不提交制品

#### Scenario: 子进程环境最小化
- **WHEN** 扩展入口读取 context 或环境变量
- **THEN** 入口无法获得真实 Workspace 根路径、父进程 `PWD`、凭证或未声明业务变量

### Requirement: 扩展准备失败不阻断核心初始化
系统 SHALL 将扩展仓库条目、扩展状态和已选扩展准备阶段的内部失败转换为有序扩展结果和 warning diagnostics。非法选择语法和未知扩展名仍 SHALL 在任何写入前失败。

#### Scenario: 未选择扩展损坏
- **WHEN** 内置仓库中一个未选择扩展的 manifest 无效
- **THEN** 核心 init 可成功且该扩展以 warning 报告

#### Scenario: 扩展状态损坏
- **WHEN** 已有 Workspace 的 ext-manifest 无法解析
- **THEN** 核心 init 可成功，扩展批次跳过并报告稳定 warning

### Requirement: Host 管理共享 contribution
扩展 SHALL 能声明共享 `text-block` 和 `json-member` 输出。Host SHALL 以扩展 id/output id 管理局部所有权，保留目标中的用户、核心和其他扩展内容，并在安装、升级和卸载时验证已拥有 contribution 未被未知修改。Extension Spec v1 manifest MUST NOT 声明 `codex-config-block`、`codex-hooks` 或具体 Agent 产品命名的公共输出类型；已发布旧 installed 状态仍 SHALL 可安全读取和卸载。

#### Scenario: 安装 Codex 配置片段
- **WHEN** 扩展返回适用于 Codex 的合法 TOML `text-block` 且目标中不存在冲突标记
- **THEN** Host 添加稳定所有权标记和片段，保留目标其他内容，验证完整 TOML 并记录片段摘要

#### Scenario: 安装 JSON 对象成员
- **WHEN** 扩展声明 `.mcp.json` 的 `/mcpServers/example` 且该成员不存在
- **THEN** Host 安装扩展提供的 JSON 值、保留其他成员和顶层字段并记录规范化 contribution

#### Scenario: 共享 contribution 被本地修改
- **WHEN** 当前文本块或 JSON 成员与 installed 状态不同
- **THEN** Host 在升级或卸载前以稳定本地修改错误停止

#### Scenario: 旧共享状态兼容卸载
- **WHEN** installed 状态包含已发布的 `codex-config-block` 或 `codex-hooks` 记录
- **THEN** Host 仍能仅依据状态安全移除对应旧 contribution，且 Extension Spec v1 不再产生这些类型

### Requirement: 发布 Zhuiyi Jira MCP 扩展
npm 包 SHALL 包含基于 Extension Spec v1 的 `zhuiyi-jira-mcp@0.1.0`。扩展入口 SHALL 在扩展私有实现中下载固定预构建包、限制允许的 HTTPS host、验证固定 SHA-256、安全解压和校验包结构，再生成运行目录及所选 Codex/Claude 配置。Host MUST NOT 理解该下载或归档业务。

#### Scenario: 初始化安装 Jira MCP
- **WHEN** Workspace init 选择 `zhuiyi-jira-mcp` 且扩展准备成功
- **THEN** Host 将候选目录安装到 `.code-workspace/extensions/zhuiyi-jira-mcp/0.1.0`，并为所选 Agent 安装指向 `dist/index.js` 的配置

#### Scenario: 独立安装 Jira MCP
- **WHEN** 用户执行 `code-w extension install zhuiyi-jira-mcp --yes`
- **THEN** Host 不重跑核心 init，只执行 Extension Spec v1 并提交其运行目录、配置和 installed 状态

#### Scenario: 预构建包安装不执行构建
- **WHEN** Jira 扩展准备远程运行包
- **THEN** 扩展不运行 `npm install`、`npm ci`、`npm run build` 或归档内生命周期脚本

#### Scenario: 不持久化真实 Jira 凭证
- **WHEN** 扩展生成 Codex 或 Claude 配置
- **THEN** 配置可包含空字符串 `JIRA_COOKIE` 占位符，但 staging、result、installed 状态、诊断和日志均不包含非空 Cookie、Token 或其他真实用户凭证

#### Scenario: 忽略 Jira 附件目录
- **WHEN** 扩展安装到 Workspace
- **THEN** Host 通过共享文本 contribution 将 `/.jira-attachments/` 写入 `.gitignore`，并保留已有用户内容

#### Scenario: 卸载保留附件
- **WHEN** 用户卸载 Jira 扩展且 Workspace 存在 `.jira-attachments/`
- **THEN** Host 移除已拥有运行目录和配置 contribution，但保留附件目录

### Requirement: 扩展 CLI 契约保持稳定
`init`、`extension install [name...]` 和 `extension uninstall <name>` SHALL 保持既有 registry、parser、Workspace 要求、配置投影、统一确认、Workspace 锁、批处理和 JSON envelope 契约。确认信息 SHALL 展示静态声明的网络 host 和输出目标，而不是解释扩展内部下载、解压或构建步骤。

#### Scenario: 多扩展批量安装中 Jira 下载失败
- **WHEN** Jira 扩展执行失败且同批仍有后续扩展
- **THEN** 命令记录 Jira 失败、继续后续扩展并返回完整有序汇总

#### Scenario: 发布包包含扩展定义
- **WHEN** 执行 npm pack dry-run
- **THEN** 包内容包含 Jira 扩展 manifest、入口、私有辅助代码和非敏感模板，但不内嵌远程运行归档

### Requirement: 扩展可事务性卸载
系统 SHALL 提供 `extension uninstall <name>` planned-write 命令。卸载 SHALL 只依据 installed 状态，由 Host 验证并移除独占文件、独占目录和共享 contribution，再删除该扩展状态；不得读取当前扩展包或执行扩展代码。完整后置条件验证前不得提交。

#### Scenario: 卸载已安装扩展
- **WHEN** 用户确认卸载且全部制品及 contribution 仍匹配 installed 状态
- **THEN** 系统事务性移除该扩展全部安装制品和状态，同时保留用户内容、核心贡献、其他扩展贡献和运行期用户数据

#### Scenario: 卸载已不存在于包中的扩展
- **WHEN** installed 状态存在但当前内置仓库不再包含该扩展
- **THEN** 系统仍可仅根据 installed 状态完成卸载

#### Scenario: 本地修改阻止卸载
- **WHEN** 任一独占文件、目录或共享 contribution 包含未知修改
- **THEN** 系统以稳定错误拒绝卸载且事务不产生部分删除

### Requirement: 扩展可独立选择和安装
系统 SHALL 提供 `extension install [name...]` planned-write 命令，不执行核心 Workspace 初始化。显式名称 SHALL 按参数顺序请求基于 Host 支持规范的最高扩展 SemVer；未提供名称时，系统 SHALL 只在交互 TTY 中展示全部有效内置扩展名称、最高受支持版本和规范版本，并允许多选。安装 SHALL 复用扩展的计划冻结、逐扩展事务、后置验证、回滚和状态持久化能力。

#### Scenario: 显式安装已卸载扩展
- **WHEN** 用户执行 `extension install zhuiyi-jira-mcp --yes` 且该扩展未安装
- **THEN** 系统安装最高受支持版本、验证制品和 installed 状态，并且不重写核心 Workspace 制品

#### Scenario: 无参数交互多选
- **WHEN** 用户在 TTY 中执行不带名称的 `extension install`
- **THEN** 系统展示全部有效内置扩展，允许选择多个具有受支持规范实现的扩展，并在一次确认后按选择顺序执行

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
