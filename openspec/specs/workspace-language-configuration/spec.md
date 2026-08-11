# workspace-language-configuration Specification

## Purpose
定义工作区内容语言的唯一配置来源、初始化与更新入口、旧工作区迁移规则，以及语言变更对 OpenSpec 产物、项目上下文和托管用户读物的安全更新行为。

## Requirements

### Requirement: 工作区配置保存内容语言
系统 MUST 在 `.openspec-workspace/config.yaml` 的 `workspace.language` 中保存受支持的工作区内容语言，并将其作为迁移完成后的唯一事实来源。配置加载和保存 MUST 验证并保留该字段，且不得继续把 `.openspec-workspace/state.json.workspaceLanguage` 或 `openspec/config.yaml` 当作正常运行时的对等配置源。

#### Scenario: 初始化新工作区并指定语言
- **WHEN** 用户执行 `openspec-w init . --language en-US`
- **THEN** 系统在本地配置中保存 `workspace.language: en-US`
- **THEN** 初始化结果报告 `en-US` 为工作区内容语言

#### Scenario: 拒绝不支持的语言
- **WHEN** 用户在 init 或 update 中提供未注册的语言标记
- **THEN** 系统在写入任何配置或 artifact 之前失败
- **THEN** 错误列出受支持的语言标记

### Requirement: 语言查询读取本地工作区配置
系统 MUST 让 `openspec-w language` 及其 JSON 输出从 `workspace.language` 读取当前语言，并继续为 project context 生成者返回该语言对应的本地化语义标签。

#### Scenario: 查询当前语言和 context 标签
- **WHEN** 本地配置包含 `workspace.language: zh-CN` 且用户执行 `openspec-w language --json`
- **THEN** 输出报告语言 `zh-CN`
- **THEN** 输出包含中文的 responsibility、technologyStack、codeLocations 和 projectBoundary 标签值

### Requirement: 初始化和更新管理语言偏好
系统 MUST 支持在首次 init 中设置语言，并 MUST 支持通过 `openspec-w update --language <lang>` 修改已有工作区的 `workspace.language`。不带 `--language` 的 update MUST 使用现有配置语言刷新 artifacts，而不得改变语言偏好。

#### Scenario: 更新已有工作区语言
- **WHEN** 当前配置语言为 `zh-CN` 且用户执行 `openspec-w update --language en-US`
- **THEN** 成功操作后的本地配置语言为 `en-US`
- **THEN** 所有依赖语言的托管 artifacts 与 `en-US` 一致

#### Scenario: 普通更新保留语言
- **WHEN** 当前配置语言为 `en-US` 且用户执行不带 `--language` 的 update
- **THEN** 系统使用 `en-US` 计算期望 artifacts
- **THEN** 本地语言偏好保持 `en-US`

### Requirement: 语言切换遵循 managed artifacts 安全规则
系统 MUST 在写入 `workspace.language` 之前，使用目标语言和现有 artifacts 更新机制完成整个 update 计划的分类与预检。任何 unknown 托管目标 MUST 在没有 `--force` 时阻塞整个操作；显式 `--force` MUST 沿用现有完整 update 的覆盖范围。

#### Scenario: 本地修改阻塞语言切换
- **WHEN** 一个托管目标包含 unknown 本地修改且用户执行不带 `--force` 的语言更新
- **THEN** 系统不修改 `workspace.language`、任何托管 artifact 或 managed state
- **THEN** 错误标明阻塞文件并提示可显式重试 `openspec-w update --language <lang> --force`

#### Scenario: 强制执行语言切换
- **WHEN** 托管目标包含 unknown 本地修改且用户显式提供 `--force`
- **THEN** 系统按照现有完整 update 的 force 语义覆盖所有计划中的 unknown 目标
- **THEN** 系统提交目标语言及与其一致的派生 artifacts

### Requirement: 工作区语言驱动三类内容
系统 MUST 用 `workspace.language` 驱动后续 OpenSpec 自然语言产物、后续新增或显式重新生成的 `projects[].context`，以及语言相关的托管工作区人类读物。系统 MUST 保持协议关键字、配置键、项目名、标识符、路径、技术名和代码符号不被语言设置翻译。

#### Scenario: 新内容使用当前语言
- **WHEN** 工作区语言为 `en-US`
- **THEN** 后续 OpenSpec 产物的自然语言正文使用英文
- **THEN** 后续生成的 project context 使用英文标签和描述

#### Scenario: 历史业务内容不被自动翻译
- **WHEN** 用户成功切换工作区语言
- **THEN** 系统不改写已有 OpenSpec 产物
- **THEN** 系统不改写已有 `projects[].context`

### Requirement: 派生托管文件与配置语言一致
系统 MUST 从 `workspace.language` 派生 `openspec/config.yaml` 中的 `Language:` 指令，并 MUST 在工作区稳定目标 `USER_GUIDE.md` 安装所选语言的人类指南。语言切换对这些文件 MUST 使用现有 current、managed-old、replaceable、missing、unknown 和 obsolete 保护规则。

#### Scenario: 安全切换托管指南
- **WHEN** 当前 `USER_GUIDE.md` 匹配已知托管版本且用户成功切换语言
- **THEN** 系统将它替换为目标语言对应的托管版本
- **THEN** `openspec/config.yaml` 的语言指令与 `workspace.language` 一致

#### Scenario: 保护修改过的旧指南
- **WHEN** 旧的指南目标包含未知本地修改
- **THEN** 系统不得静默覆盖或删除该文件
- **THEN** 没有 `--force` 的语言更新失败且不产生部分更改

### Requirement: 旧工作区语言可确定迁移
系统 MUST 为缺少 `workspace.language` 的旧工作区提供迁移。迁移 MUST 优先采用 `state.json.workspaceLanguage`，其次采用 `openspec/config.yaml` 的受支持语言指令；若两个已存在的旧来源不一致，系统 MUST 要求用户显式选择语言而不是静默迁移。

#### Scenario: 从旧状态迁移
- **WHEN** 本地配置缺少语言且旧状态包含受支持的 `workspaceLanguage`
- **THEN** 系统将该值迁移到 `workspace.language`
- **THEN** 成功提交后状态文件不再保存 `workspaceLanguage`

#### Scenario: 拒绝冲突的旧语言来源
- **WHEN** 状态文件和 OpenSpec 派生配置包含不同的受支持语言且本地配置没有语言
- **THEN** 自动迁移失败且不修改任何文件
- **THEN** 错误要求用户通过 `update --language <lang>` 明确选择

### Requirement: Monitor 语言不受工作区语言变更影响
系统 MUST 保持 Monitor 页面语言独立于 `workspace.language`，且本次能力不得迁移 Monitor locale、浏览器语言偏好或 Monitor 模块边界。

#### Scenario: 切换工作区语言不改变 Monitor 偏好
- **WHEN** 用户执行成功的 `openspec-w update --language <lang>`
- **THEN** Monitor 的 locale 资源和浏览器持久化语言值不发生变化
