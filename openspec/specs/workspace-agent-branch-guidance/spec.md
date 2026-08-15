# Workspace Agent Branch Guidance

## Purpose

定义托管 Agent 指令与分支处理 Skill 对项目作用域和分支协调的统一、安全引导规则，确保 Agent 依据用户选择通过受支持的 CLI 处理不一致并仅复验目标项目。

## Requirements

### Requirement: Workspace Guard 明确定义分支角色
托管的 Workspace Guard 必须（SHALL）说明 Workspace 根目录是多项目控制平面而不是生产项目，注册分支是目标项目的期望状态，实际分支是目标 Git worktree 的观测状态；不得将注册表描述为实际 Git 分支的唯一事实来源。

#### Scenario: Agent 读取 Workspace 根指令
- **WHEN** Claude Code 或 Codex 加载生成的 Workspace Guard
- **THEN** 两个平台获得相同的 Workspace、注册项目、注册分支、实际分支、CLI、Agent 和用户决策职责定义

#### Scenario: 检测到分支不一致
- **WHEN** 注册分支与实际分支不同
- **THEN** Guard 要求 Agent 停止项目工作并调用分支处理 Skill，而不是自行选择某一侧作为权威

### Requirement: Agent 只建立必要的项目作用域
Workspace Guard 必须（SHALL）要求 Agent 优先使用用户明确指定的注册项目；只有无法确定项目归属时才列出注册表元数据，并且项目选定后不得读取、校验或修改未被用户请求包含的工程。

#### Scenario: 用户明确指定注册项目
- **WHEN** 用户请求明确命名一个已注册项目
- **THEN** Agent 直接显示并定向校验该项目，不先运行全量 `project list` 或工作区级校验

#### Scenario: 项目归属不明确
- **WHEN** 用户任务无法从现有上下文确定负责项目
- **THEN** Agent 可以列出注册项目元数据，只展示相关候选并请求选择，但不得检查候选项目仓库

#### Scenario: 用户请求只涉及一个项目
- **WHEN** 已经选中一个项目且用户没有扩展范围
- **THEN** Agent 保持该项目为唯一作用域，不因发现其他注册项目而读取、验证、修复或评论它们

#### Scenario: 用户明确请求多个项目
- **WHEN** 用户显式将多个注册项目纳入任务
- **THEN** Agent 可以把这些项目加入作用域，但必须逐个定向校验和处理分支不一致

### Requirement: 分支 Skill 使用固定事实与选择模板
分支处理 Skill 必须（SHALL）通过 `project branch inspect <name> --json` 获取目标事实，并使用固定询问结构呈现项目名、位置、注册分支、实际分支、工作树干净状态和注册本地分支存在性，以及三个固定选择和每个选择的影响。

#### Scenario: 两个自动方向都可用
- **WHEN** 工作树干净且注册本地分支存在
- **THEN** Skill 显示“使用注册分支”“接受实际分支”“手动处理”三个选择，不默认推荐任一自动方向，并声明用户选择前不改变状态

#### Scenario: 使用注册分支不可用
- **WHEN** 工作树不干净或注册本地分支不存在
- **THEN** Skill 保留固定选择结构，将“使用注册分支”标记为不可用并填入 CLI 提供的原因，不临时发明 stash、reset、创建或下载分支方案

#### Scenario: 询问所需事实缺失
- **WHEN** 分支状态检查失败或未返回固定模板要求的事实
- **THEN** Skill 报告诊断并停止，不猜测缺失值也不向用户展示不完整的方向选择

### Requirement: 两个自动协调方向只能通过 CLI 执行
用户明确选择自动协调方向后，分支 Skill 必须（SHALL）分别调用 `project branch use-registered <name> --yes --json` 或 `project branch accept-actual <name> --yes --json`；不得直接执行 Git 分支变更或编辑 Workspace 配置。

#### Scenario: 用户选择使用注册分支
- **WHEN** 用户明确选择“使用注册分支”且该选项可用
- **THEN** Skill 仅调用 `project branch use-registered`，并以 CLI 结果决定是否继续

#### Scenario: 用户选择接受实际分支
- **WHEN** 用户明确选择“接受实际分支”
- **THEN** Skill 仅调用 `project branch accept-actual`，不切换目标 Git worktree

#### Scenario: CLI 协调失败
- **WHEN** 任一 CLI 命令返回失败
- **THEN** Skill 向用户报告结构化诊断并保持项目工作暂停，不回退到原始 Git 命令、配置编辑或自由发挥的修复步骤

#### Scenario: 用户选择手动处理
- **WHEN** 用户选择手动处理
- **THEN** Skill 保持暂停，直到用户确认处理完成，且不复用处理前缓存的分支状态

### Requirement: 分支处理结束后只复验目标项目
分支 Skill 必须（SHALL）在自动或手动处理后运行 `project verify <name> --json`，且不得重新列出或全量校验所有注册项目；只有目标校验成功才可恢复项目工作。

#### Scenario: 目标项目复验成功
- **WHEN** 分支处理完成且目标项目定向校验返回 `ok: true`
- **THEN** Agent 可以重新获取该项目所需上下文并继续用户任务

#### Scenario: 目标项目复验失败
- **WHEN** 定向复验仍返回分支不一致或其他错误
- **THEN** Agent 保持目标项目工作暂停，报告诊断且不检查其他项目

### Requirement: 分支相关技术文档只引用已注册 CLI
Guard、分支 Skill、README 和流程文档中的命令引用必须（SHALL）通过真实 CLI 解析器校验；托管资产不得引用已移除的 `project sync-branch` 或任何尚未注册的命令。

#### Scenario: 打包托管资产
- **WHEN** 项目运行命令引用、托管文件和打包检查
- **THEN** 所有技术文档中的 `project branch` 示例均由注册表识别，且旧 `project sync-branch` 不出现在生成的 Agent 资产、帮助、补全或文档中

### Requirement: 用户指南不暴露分支协调实现细节
双语用户指南必须（SHALL）只提供用户可调用的分支处理 Skill 入口，不得列出 `project branch` 命令、分支状态字段、CLI 安全前置条件、迁移合同、验证、回滚或补偿机制。

#### Scenario: 生成用户指南
- **WHEN** 初始化或更新 Workspace 生成任一语言的 `USER_GUIDE.md`
- **THEN** 指南可以说明如何调用分支处理 Skill，但不包含底层 `project branch` 命令或分支协调实现合同
