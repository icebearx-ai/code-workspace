## ADDED Requirements

### Requirement: Host 管理共享 contribution
扩展 SHALL 能声明共享 `text-block` 和 `json-member` 输出。Host SHALL 以扩展 id/output id 管理局部所有权，保留目标中的用户、核心和其他扩展内容，并在安装、升级和卸载时验证已拥有 contribution 未被未知修改。新 manifest MUST NOT 再声明 `codex-config-block`、`codex-hooks` 或具体 Agent 产品命名的公共输出类型；已发布旧 installed 状态仍 SHALL 可安全读取和卸载。

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
- **THEN** Host 仍能仅依据状态安全移除对应旧 contribution，且新 manifest v2 不再产生这些类型

### Requirement: 发布 Zhuiyi Jira MCP 扩展
npm 包 SHALL 包含基于新执行协议的 `zhuiyi-jira-mcp@0.1.0`。扩展入口 SHALL 在扩展私有实现中下载固定预构建包、限制允许的 HTTPS host、验证固定 SHA-256、安全解压和校验包结构，再生成运行目录及所选 Codex/Claude 配置。Host MUST NOT 理解该下载或归档业务。

#### Scenario: 初始化安装 Jira MCP
- **WHEN** Workspace init 选择 `zhuiyi-jira-mcp` 且扩展准备成功
- **THEN** Host 将候选目录安装到 `.code-workspace/extensions/zhuiyi-jira-mcp/0.1.0`，并为所选 Agent 安装指向 `dist/index.js` 的配置

#### Scenario: 独立安装 Jira MCP
- **WHEN** 用户执行 `code-w extension install zhuiyi-jira-mcp --yes`
- **THEN** Host 不重跑核心 init，只执行该扩展协议并提交其运行目录、配置和 installed 状态

#### Scenario: 预构建包安装不执行构建
- **WHEN** Jira 扩展准备远程运行包
- **THEN** 扩展不运行 `npm install`、`npm ci`、`npm run build` 或归档内生命周期脚本

#### Scenario: 不持久化 Jira 凭证
- **WHEN** 扩展生成 Codex 或 Claude 配置
- **THEN** staging、result、installed 状态、诊断和日志均不包含 Cookie、Token 或真实用户凭证

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

## MODIFIED Requirements

### Requirement: 发现内置扩展并解析兼容版本
系统 SHALL 只从 Code Workspace 包根的 `extensions/<name>/<version>/` 发现可信内置扩展，其中名称匹配小写字母、数字和短横线，版本为标准 SemVer，并且版本目录包含符合 manifest v2 的 `manifest.json`、声明入口和扩展私有资源。系统 SHALL 为请求名称选择与当前 Code Workspace 版本兼容的最高版本，并冻结 manifest、入口及完整扩展版本目录摘要。

#### Scenario: 选择最高兼容版本
- **WHEN** 一个扩展存在多个合法版本且其中多个版本兼容当前 Code Workspace
- **THEN** 安装计划只选择最高兼容 SemVer，并固定其版本、manifest SHA-256、入口 SHA-256 和完整扩展包摘要

#### Scenario: 拒绝版本选择语法
- **WHEN** 用户通过 `--extensions` 请求 `openspec-workspace@1.0.0`
- **THEN** 系统以稳定的扩展选择错误拒绝请求且不执行初始化写入

### Requirement: 校验扩展 manifest 和目标所有权
系统 SHALL 校验 manifest v2 schema、试验标记、目录 identity、入口、兼容范围、超时、声明性能力和通用 outputs。每个 target MUST 是安全的 Workspace 相对 POSIX 路径。Host SHALL 拒绝绝对路径、反斜杠、`.`/`..` 段、符号链接逃逸、独占目标父子重叠、核心托管目标、共享类型不兼容、JSON selector 父子重叠以及扩展间所有权冲突。

#### Scenario: 路径逃逸被拒绝
- **WHEN** output target 包含 `..`、绝对路径、反斜杠或其现有祖先是符号链接
- **THEN** 系统在启动扩展入口前拒绝该扩展且不修改真实 Workspace

#### Scenario: 扩展目标冲突被拒绝
- **WHEN** 两个扩展声明相同或父子重叠的独占目标，或声明冲突的共享 selector
- **THEN** 冲突扩展返回稳定错误且任何冲突目标均不被覆盖

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
- **THEN** 系统提交事务并记录 installed 协议版本、扩展版本、manifest/扩展包摘要、通用所有权及 Host 计算的制品摘要

#### Scenario: 升级写入失败
- **WHEN** 已安装扩展升级过程中任一目录替换、共享内容合成、状态写入或验证失败
- **THEN** 系统恢复旧版本全部制品、共享 contribution 和旧 installed，并将新版本失败记录为 lastAttempt

#### Scenario: 回滚不完整
- **WHEN** 扩展安装失败且至少一个原文件或目录无法恢复
- **THEN** 系统报告 `EXTENSION_ROLLBACK_INCOMPLETE` 并继续处理后续扩展

### Requirement: Workspace 状态区分安装与尝试
系统 SHALL 在 `.code-workspace/ext-manifest.json` 中使用 schemaVersion 1 和 experimental 标记，并为每个扩展分别维护 `installed` 与 `lastAttempt`。协议 v2 installed SHALL 记录扩展版本、manifest 摘要、完整扩展包摘要、通用输出所有权和 Host 验证事实。失败尝试 MUST NOT 将仍有效的旧 installed 状态清空。

#### Scenario: 首次安装失败
- **WHEN** Workspace 中没有该扩展 installed 状态且首次安装失败
- **THEN** installed 为 null，lastAttempt 记录失败版本、状态、稳定 code 和 message

#### Scenario: 升级失败保留已安装版本
- **WHEN** 已安装旧版本而新版本准备或提交失败
- **THEN** installed 仍指向旧版本，lastAttempt 指向失败的新版本

### Requirement: 发布首个 OpenSpec Workspace 扩展
npm 包 SHALL 包含 `extensions/openspec-workspace` 的至少一个兼容 manifest v2 版本。该扩展 SHALL 根据 context 中选择的工具在 staging 中生成 Codex 和 Claude skill 文件，并在 result 中完整返回适用 output id 与 source；真实 Workspace target、所有权和摘要由静态 manifest 与 Host 决定。

#### Scenario: 只为选择工具生成文件
- **WHEN** context tools 只包含 `codex`
- **THEN** 扩展只生成并返回 Codex output，Host 不要求不适用的 Claude output，也不写任何未声明目标

#### Scenario: 发布包包含扩展仓库
- **WHEN** 执行 npm pack dry-run
- **THEN** 包内容包含 `extensions/openspec-workspace/<version>/init.js`、manifest v2 和所需模板文件

### Requirement: 扩展入口与执行环境遵守最小契约
系统 SHALL 在计划中冻结并在执行前验证 manifest、扩展入口和完整扩展版本目录摘要，且 SHALL 仅向扩展子进程传递运行所需的环境变量白名单。扩展契约 SHALL 以随包文档和 JSON Schema 发布；context 不得包含真实 Workspace 路径，result 不得重新声明 target、所有权或摘要。

#### Scenario: 辅助文件在计划后被修改
- **WHEN** manifest 或入口未变，但 `init.js` 使用的模板、私有元数据或辅助代码在计划冻结后发生变化
- **THEN** Host 以稳定计划过期错误拒绝执行入口且不写入扩展制品

#### Scenario: 子进程环境最小化
- **WHEN** 扩展入口读取 context 或环境变量
- **THEN** 入口无法获得真实 Workspace 根路径、父进程 `PWD`、凭证或未声明业务变量

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

## REMOVED Requirements

### Requirement: Host 托管共享 Codex 制品
