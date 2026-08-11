## Context

当前工作区语言由初始化参数解析后，同时写入托管的 `openspec/config.yaml` 和 `.openspec-workspace/state.json.workspaceLanguage`。语言查询又以 `openspec/config.yaml` 为主要来源，而 `.openspec-workspace/config.yaml` 的配置模型不接受语言字段。这形成了多个事实来源，也使用户无法从本地配置直接判断或修改工作区偏好。

语言实际影响三类内容：OpenSpec 后续生成的自然语言产物、add-projects 后续生成的 `projects[].context`，以及 artifacts 管理的工作区人类读物。Monitor 页面语言具有独立生命周期，本次不处理其 i18n 或模块拆分。

## Goals / Non-Goals

**Goals:**

- 以 `.openspec-workspace/config.yaml` 的 `workspace.language` 作为唯一事实来源。
- 支持初始化时设置语言，以及通过 `openspec-w update --language <lang>` 安全切换语言。
- 严格复用现有 managed artifacts 的 current、managed-old、replaceable、missing、unknown 和 `--force` 语义。
- 确保受保护的本地修改阻塞语言切换时，配置和 artifacts 均不发生部分更新。
- 让目标语言驱动 `openspec/config.yaml`、后续 project context 和工作区 `USER_GUIDE.md`。
- 为旧工作区提供确定、兼容的语言迁移路径。

**Non-Goals:**

- 自动翻译已有 proposal、spec、design、tasks、归档 change 或 project context。
- 本地化 CLI 帮助、进度、错误消息或机器可读字段。
- 翻译 Agent 指令、OpenSpec schema、命令名、标识符或代码内容。
- 分离 Monitor locale、调整 Monitor 的浏览器语言偏好，或拆分 Monitor 模块。
- 根据工作区语言改写包级 README、LICENSE 或贡献者文档。

## Decisions

### 1. 将语言归入 `workspace` 配置对象

本地配置采用：

```yaml
workspace:
  name: example
  uuid: 123e4567-e89b-42d3-a456-426614174000
  language: zh-CN
```

`workspace.language` 与工作区名称和 UUID 一起描述工作区身份及内容偏好，避免新增含义重复的顶层 `workspaceLanguage`。配置规范化必须验证该字段，仅接受注册的语言标记，并在保存时保留它。

备选方案是顶层 `workspaceLanguage`，但它会把同一工作区的属性拆散，并延续状态文件中的旧命名，因此不采用。

### 2. 配置是事实来源，其他语言标记都是派生信息

命令执行时的解析优先级为：显式 `--language`、`config.workspace.language`、旧版迁移来源、首次初始化默认值。正常运行和迁移完成后，查询、update、doctor 和 add-projects 都只把 `config.workspace.language` 视为事实来源。

`openspec/config.yaml` 中的 `Language:` 是供 OpenSpec 和 Agent 消费的托管派生指令；`.openspec-workspace/state.json` 只记录安装状态，不再写入 `workspaceLanguage`。

### 3. 首次设置与后续修改使用不同的用户入口

首次初始化使用 `openspec-w init . --language <lang>`；已有工作区推荐使用 `openspec-w update --language <lang>`。重新执行 init 时若显式提供语言，必须复用 update 的候选配置、artifacts 预检和写入语义，不能形成第二套更新路径。

不带 `--language` 的 update 读取当前 `workspace.language` 并刷新 artifacts，但不改变用户偏好。

### 4. 语言切换先预检 artifacts，再提交配置

update 先在内存中构造包含目标语言的候选配置，并以该语言渲染完整 managed-file 计划。现有 artifacts 分类规则保持不变：

- current 不写入；
- managed-old 和 replaceable 可更新；
- missing 可创建；
- unknown 在没有 `--force` 时阻塞整个操作；
- unknown 在显式 `--force` 时按现有全局 force 语义覆盖。

若预检失败，`workspace.language`、托管文件和 managed state 均保持原样。错误必须列出阻塞目标，说明未发生更改，并给出带原目标语言的 `openspec-w update --language <lang> --force` 命令提示。

`--force` 继续作用于本次完整 update 计划，而不是只作用于语言相关文件；提示和 JSON 计划应让用户看到所有会被覆盖的 unknown 目标。

### 5. 三类内容采用不同的更新时间语义

- `openspec/config.yaml` 的 `Language:` 在语言切换成功时立即更新，控制后续 OpenSpec 产物。
- `projects[].context` 不在 update 中重写；只有后续新增或显式重新生成时使用当前语言。
- `USER_GUIDE.md` 是可重建的托管读物，在语言切换成功时立即切换为对应语言版本，并受 unknown/`--force` 保护。

工作区使用稳定目标名 `USER_GUIDE.md`。包内可以保留按 locale 组织的源模板，但不再要求工作区同时安装多个带语言后缀的指南。旧的 `USER_GUIDE.zh-CN.md` 按现有 obsolete managed asset 规则安全清理；存在未知本地修改时不得静默删除。

### 6. 旧工作区执行一次性迁移

当 `workspace.language` 缺失时，迁移按以下顺序选择值：

1. `.openspec-workspace/state.json.workspaceLanguage`；
2. `openspec/config.yaml` 的受支持 `Language:`；
3. 首次初始化场景使用默认 `zh-CN`。

若两个旧来源同时存在但不一致，迁移必须失败并要求用户通过 `update --language <lang>` 明确选择，不能静默决定。成功提交后删除状态文件中的旧 `workspaceLanguage`，后续不再读取旧来源作为正常回退。

### 7. Monitor 保持在本次边界之外

Monitor 继续使用自己的页面选择器和浏览器 localStorage。即使源码目前复用 locale registry，本次也不移动文件、不改变接口，避免将工作区配置修复扩展成 Monitor 架构重构。

### 8. Locale registry 是支持语言的唯一注册点

Registry 自动发现 `src/i18n/locales/*.js`，并从 locale 定义派生支持语言代码、CLI 选项、配置校验和默认语言。每个 locale 同时声明其 `artifactDirectory`，工作区指南统一解析为 `artifacts/templates/<artifactDirectory>/USER_GUIDE.md`。核心代码不得按具体语言标记进行条件分支，测试也不得维护固定语言清单；测试应遍历 registry 并验证每个已注册 locale 的结构和模板完整性。

因此新增语言只新增一个 locale 定义和一个同目录指南模板，不修改配置模块、registry 源码或既有测试。

## Risks / Trade-offs

- **旧语言来源不一致导致升级失败** → 明确报告两个来源和值，要求用户用 `update --language` 解决。
- **`--force` 可能覆盖与语言无关的托管文件** → 保持现有全局语义，但在执行前输出完整覆盖目标；不新增含义重叠的 force 参数。
- **切换后工作区同时存在多种语言的历史产物** → 明确采用面向未来的语言语义，不自动翻译业务内容。
- **单一 `USER_GUIDE.md` 会改变当前双语文件布局** → 将旧语言后缀文件纳入受保护的 obsolete 清理，并在用户改过文件时阻塞。
- **配置与 artifacts 属于不同写入系统** → 在任何写入前完成候选配置和完整 artifacts 计划，并复用初始化已有的文件快照/恢复模式覆盖外层事务。

## Migration Plan

1. 扩展本地配置规范，允许并验证 `workspace.language`。
2. 为旧工作区实现只在迁移阶段使用的语言解析和冲突检测。
3. 调整 init、language、update 和 doctor 以读取唯一事实来源。
4. 将语言相关 managed artifacts 改为由候选 `workspace.language` 渲染或选择。
5. 将工作区指南收敛为单一 `USER_GUIDE.md`，安全处理旧的语言后缀指南。
6. 成功迁移后清除 `state.json.workspaceLanguage`，并更新测试和文档。
7. 如升级失败，恢复本地配置、状态和已触及的托管文件；用户可继续使用旧版本或显式选择语言重试。

## Open Questions

无。本次明确不处理 Monitor i18n 分离。
