## Why

工作区内容语言目前分散在 `openspec/config.yaml` 和 `.openspec-workspace/state.json`，没有作为用户偏好保存在本地工作区配置中。这使语言缺少明确的唯一事实来源，也让语言切换、托管文档选择和 artifacts 安全更新难以保持一致。

## What Changes

- 在 `.openspec-workspace/config.yaml` 的 `workspace` 对象中增加必需的 `language` 字段，作为工作区内容语言的唯一事实来源。
- 首次初始化通过 `openspec-w init . --language <lang>` 设置 `workspace.language`；已有工作区通过 `openspec-w update --language <lang>` 修改。
- 让工作区语言影响三类面向用户的内容：后续生成的 OpenSpec 产物、后续生成或重新生成的 `projects[].context`，以及由 artifacts 管理的工作区人类读物。
- 将 `openspec/config.yaml` 中的 `Language:` 指令和所选语言的 `USER_GUIDE.md` 定义为 `workspace.language` 的派生托管产物。
- 语言切换严格复用现有 artifacts 分类、预检、未知修改保护和 `--force` 机制；任何受保护文件阻塞更新时，不写入配置或其他产物，并给出明确的 `--force` 提示。
- 从旧工作区的 `state.json.workspaceLanguage` 或 `openspec/config.yaml` 迁移语言；迁移完成后不再把状态文件或派生文件作为对等配置源。
- 不自动翻译或改写已有 OpenSpec 产物和已有项目 context。
- 本次不调整 Monitor 的语言存储、翻译资源或模块边界；Monitor i18n 分离留待独立变更。

## Capabilities

### New Capabilities

- `workspace-language-configuration`: 定义工作区语言的配置模型、初始化与更新命令、旧配置迁移、语言影响范围，以及通过现有 artifacts 安全机制更新派生人类可读内容的行为。

### Modified Capabilities

无。

## Impact

- 本地配置规范与序列化：`.openspec-workspace/config.yaml`。
- 初始化、更新、语言查询和 doctor 流程。
- 托管 artifacts 的渲染、选择、预检、写入与回滚边界。
- `openspec/config.yaml` 和工作区 `USER_GUIDE.md` 的安装模型。
- add-projects 使用的语言和 project context locale。
- 旧 `.openspec-workspace/state.json` 与现有 OpenSpec language 指令的兼容迁移。
- CLI 参数和 JSON 输出保持兼容；Monitor i18n 不在影响范围内。
