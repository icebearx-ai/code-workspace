## ADDED Requirements

### Requirement: 独立安装从可信 Provider 解析普通扩展
当 Nexus Registry 已配置时，`extension install` SHALL 对普通扩展合并内置 Provider、Nexus Provider 和已验证 Store 的候选事实，并选择最高的、Host 支持的、非 prerelease、非 deprecated SemVer。相同 `id@version` 的不同 package digest MUST 失败；系统扩展 MUST 继续只从内置 Provider 解析。

#### Scenario: Nexus 提供更高兼容版本
- **WHEN** 内置 Provider 有 `example@1.0.0`，Nexus 有摘要验证通过的 `example@1.1.0`，且两者规范均受支持
- **THEN** 独立安装冻结并激活 `1.1.0` 的精确版本和 package digest

#### Scenario: Registry 网络失败
- **WHEN** Registry 已配置、用户未请求 offline 且无版本安装无法取得完整远端版本事实
- **THEN** 安装在 Workspace 写入前失败，不静默选择旧内置版本

#### Scenario: 系统扩展远端同名
- **WHEN** Nexus 出现与系统扩展相同的 npm 包
- **THEN** Host 忽略远端候选，系统扩展仍由内置生命周期管理

### Requirement: 独立安装支持精确版本和显式本地解析
`extension install` SHALL 接受 `--version <exact-semver>`、`--allow-deprecated` 和 `--offline`。`--version` MUST 只与一个显式名称组合并允许精确 prerelease；`--allow-deprecated` MUST 只影响精确版本；`name@version` 位置语法和 SemVer range MUST 继续被拒绝。offline 模式 MUST 禁止网络请求并明确结果只基于 builtin 与 Store 本地事实。

#### Scenario: 安装精确版本
- **WHEN** 用户执行 `extension install example --version 1.2.0 --yes`
- **THEN** Host 只接受身份和摘要验证通过的 `1.2.0`，在确认计划中展示来源并把精确事实写入 activation

#### Scenario: 批量版本选项歧义
- **WHEN** 用户为多个名称提供单个 `--version`
- **THEN** parser/handler 在网络和 Workspace 写入前以稳定选项组合错误失败

#### Scenario: 离线复用 Store
- **WHEN** 用户以 `--offline --version 1.2.0` 请求 Store 中摘要有效的精确包
- **THEN** Host 不访问 Nexus并从 Store 规划正常 activation

#### Scenario: 默认排除 deprecated
- **WHEN** 最高 SemVer 已 deprecated 且存在较低的非 deprecated 兼容正式版本
- **THEN** 默认安装选择较低版本；只有精确版本加 `--allow-deprecated` 才可请求已 deprecated 版本

### Requirement: 已安装普通扩展可显式升级
系统 SHALL 提供 `extension upgrade <name...>` planned-write 命令。命令 MUST 只接受已安装普通扩展，按请求顺序冻结默认最高兼容正式版本，统一确认后复用逐扩展 Workspace 事务、后置验证、回滚和最佳努力批处理；系统扩展和未安装扩展 MUST 拒绝。

#### Scenario: 升级到远端高版本
- **WHEN** Workspace 已激活 `example@1.0.0` 且 Nexus 提供验证通过的 `1.1.0`
- **THEN** upgrade 在单扩展事务中迁移制品、Hook 和 activation 到 `1.1.0`，并验证最终 version/digest

#### Scenario: 已是当前版本
- **WHEN** 已安装版本与解析目标版本及 digest 相同且制品未漂移
- **THEN** upgrade 返回 skipped/current 且不重写 Workspace

#### Scenario: 批量升级部分失败
- **WHEN** 一个目标下载或安装失败而同批仍有后续目标
- **THEN** Host 回滚失败目标、继续后续目标并返回完整有序结果，顶层命令失败

#### Scenario: 升级系统扩展
- **WHEN** 用户显式请求 upgrade 系统扩展
- **THEN** 命令在写入前返回系统托管错误

## MODIFIED Requirements

### Requirement: 扩展 CLI 契约保持稳定
`init`、`extension search [query]`、`extension info <name>`、`extension install [name...]`、`extension upgrade <name...>` 和 `extension uninstall <name>` SHALL 由 CLI registry 声明完整参数、Workspace、配置、交互和 effects 合同。search/info MUST 是 Workspace 无关的 external 读取；install/upgrade/uninstall MUST 使用统一确认、Workspace 锁、批处理和 JSON envelope。命令层不得直接解析 `.npmrc`、Nexus payload、tarball 或写入 Workspace；确认信息 SHALL 展示精确来源、版本、package digest、静态网络 host 和输出目标。

#### Scenario: 多扩展安装中远端下载失败
- **WHEN** 一个扩展下载或验证失败且同批仍有后续扩展
- **THEN** 命令记录该目标失败、继续后续扩展并返回完整有序汇总，失败目标不产生 Workspace activation

#### Scenario: 发布包包含命令实现
- **WHEN** 执行 npm pack dry-run
- **THEN** 包内容包含 Registry Provider 与 search/info/install/upgrade/uninstall 命令所需模块、schema 和文档

#### Scenario: 文档命令由真实 parser 校验
- **WHEN** 架构检查扫描 Nexus 扩展 Registry 文档中的 `codew` 命令
- **THEN** 每个命令、位置参数和 Host option 均可由 registry-driven parser 识别

### Requirement: 扩展可独立选择和安装
系统 SHALL 提供 `extension install [name...]` planned-write 命令，不执行核心 Workspace 初始化。显式名称 SHALL 按参数顺序从允许的可信 Provider 解析默认最高兼容稳定版本，或在单目标时解析 `--version` 指定的精确 SemVer；未提供名称时，系统 SHALL 只在交互 TTY 中展示可发现、非系统且具有默认兼容版本的扩展。安装 SHALL 复用计划冻结、Store 导入、逐扩展 Workspace 事务、后置验证、回滚和状态持久化能力。

#### Scenario: 显式安装远端扩展
- **WHEN** 用户执行 `extension install example --yes`，Registry 已配置且远端默认候选验证通过
- **THEN** Host 导入精确包、安装制品和 activation，并且不重写核心 Workspace 制品

#### Scenario: 无参数交互多选
- **WHEN** 用户在 TTY 中执行不带名称的 `extension install`
- **THEN** 系统展示当前可信 Provider 可用的普通扩展、默认版本、来源和规范版本，允许多选后统一确认

#### Scenario: 交互取消不产生写入
- **WHEN** 用户在扩展多选中按 ESC 或提交空选择
- **THEN** 命令成功退出并报告 cancel 或 skip，且 Store 引用、扩展制品和 activation 均不改变

#### Scenario: 无参数非交互失败
- **WHEN** JSON、非 TTY 或 `--yes` 调用未提供任何扩展名称
- **THEN** 系统以 `EXTENSION_SELECTION_REQUIRED` 在网络下载和 Workspace 写入前失败

#### Scenario: 多扩展安装部分失败
- **WHEN** 一个请求包含多个扩展且其中一个准备或执行失败
- **THEN** 系统回滚失败扩展的 Workspace 事务、继续后续扩展、保留有序结果，并使独立安装命令顶层失败；已验证无引用 Store 缓存可以保留

#### Scenario: 扩展操作互斥
- **WHEN** 同一 Workspace 已有 init、安装、升级或卸载操作持有操作锁
- **THEN** 另一个扩展 planned-write 命令在写入前以稳定锁错误退出
