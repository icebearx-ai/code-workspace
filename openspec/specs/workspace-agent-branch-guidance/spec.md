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
- **THEN** Agent 可以把这些项目加入作用域，并使用独立项目名参数进行一次批量定向校验；若其中多个项目分支不一致，可以统一询问用户，CLI 内部仍必须隔离每个项目的协调与复验结果

### Requirement: 分支 Skill 使用确定性 ASK 结构
分支处理 Skill 必须（SHALL）通过 `project branch inspect <name...> --json` 获取目标事实，并使用固定 Ask Template 与精简 Ask Rules 呈现项目名、注册分支、实际分支、异常状态和三个固定语义方向。多个项目必须通过独立位置参数一次检查，不得拼接为逗号字符串。

#### Scenario: 两个自动方向都可用
- **WHEN** 工作树干净且注册本地分支存在
- **THEN** Skill 显示使用注册分支、接受实际分支、手动处理三个固定语义方向，不输出正常状态噪声，不默认推荐任一自动方向，并声明用户选择前不改变状态

#### Scenario: 单项目使用注册分支不可用
- **WHEN** 只有一个项目需要询问，且工作树不干净、注册本地分支不存在或两者同时发生
- **THEN** Skill 在对应分支行标注异常，以“仅显示可用选择”的含义引出选择区，省略不可用的“使用注册分支”选项，只显示仍可用且保留原语义编号的选项，不显示多项目标签、回复格式说明或单独的重要提示区

#### Scenario: 多项目存在不可用选择
- **WHEN** 多个项目需要统一询问，且至少一个项目的工作树不干净或注册本地分支不存在
- **THEN** Skill 保留三个统一编号的固定语义方向，在重要提示区按项目逐行说明“使用注册分支”不可用的规范原因；每行只说明一个项目的一个原因，两个条件同时存在时使用两行，且不临时发明 stash、reset、创建或下载分支方案

#### Scenario: 接受实际分支
- **WHEN** 项目工作树不干净但实际分支事实可用
- **THEN** “接受实际分支”仍保持可用，因为该方向只更新注册信息而不切换 Git worktree

#### Scenario: 询问所需事实缺失
- **WHEN** 分支状态检查失败或未返回固定模板要求的事实
- **THEN** Skill 不猜测缺失值，也不为失败项目展示不完整的方向选择；批量检查中其他成功项目仍可继续处理，若全部失败则报告汇总诊断并停止

#### Scenario: 多个项目同时分支不一致
- **WHEN** 已选作用域内两个或以上项目的定向校验报告分支不一致
- **THEN** Skill 使用稳定的项目标签在一次询问中展示全部不一致项目；每个项目独立成块，项目名、注册分支和实际分支各占一行，项目块之间保留空行，不得压缩为 bullet、表格行或合并句；回复格式说明允许用户用 `1`、`2`、`3` 对全部项目统一选择，或用 `A1`、`B2` 等形式分别选择，并接受大小写标签以及逗号、空格或换行分隔符

#### Scenario: 交互控件不能保持布局
- **WHEN** 原生 ASK 控件无法保留多行项目块和三个中立选择
- **THEN** Skill 使用普通用户提问呈现同一结构，不得为了适配控件压缩字段、改变选项或推荐默认方向

#### Scenario: 用户选择不完整或选择不可用方向
- **WHEN** 用户遗漏部分项目，或为某个项目选择了因工作树不干净或注册分支本地不存在而不可用的“使用注册分支”
- **THEN** Skill 保留尚未执行的有效选择，仅针对缺失或无效项目重新询问并说明规范事实原因，在全部选择有效且完整前不修改 Git 或 Workspace 状态

#### Scenario: 用户混用回复模式
- **WHEN** 用户在同一次回复中同时提供应用于全部项目的裸数字和带项目标签的选择，例如 `1 B2`
- **THEN** Skill 将整次回复视为无效，不推导覆盖顺序，不执行任何选择，并要求用户使用一种回复模式重新提交

#### Scenario: 项目标签选择无效
- **WHEN** 带标签回复包含未知标签、未知选项、重复标签或同一项目的冲突选择
- **THEN** Skill 将对应项目选择视为无效，保留其他明确且有效的项目选择，并仅重新询问缺失、不可用或无效的项目

### Requirement: 两个自动协调方向只能通过 CLI 执行
用户明确选择自动协调方向后，分支 Skill 必须（SHALL）按方向分组，分别调用一次 `project branch use-registered <name...> --yes --json` 或 `project branch accept-actual <name...> --yes --json`；不得直接执行 Git 分支变更或编辑 Workspace 配置。

#### Scenario: 用户选择使用注册分支
- **WHEN** 用户明确选择“使用注册分支”且该选项可用
- **THEN** Skill 仅调用 `project branch use-registered`，并以 CLI 结果决定是否继续

#### Scenario: 用户选择接受实际分支
- **WHEN** 用户明确选择“接受实际分支”
- **THEN** Skill 仅调用 `project branch accept-actual`，不切换目标 Git worktree

#### Scenario: CLI 协调失败
- **WHEN** 批量 CLI 返回部分项目失败
- **THEN** Skill 读取完整项目结果，继续执行另一自动方向组和后续成功项目复验，最终统一报告，不回退到原始 Git 命令、配置编辑或自由发挥的修复步骤

#### Scenario: 多项目选择全部有效
- **WHEN** 用户对全部不一致项目提交了完整且有效的方向选择
- **THEN** Skill 将同方向项目合并为一次批量 CLI 调用，并在两个方向组完成后对成功或跳过项目进行一次批量定向复验

#### Scenario: 用户选择手动处理
- **WHEN** 用户选择手动处理
- **THEN** Skill 保持暂停，直到用户确认处理完成，且不复用处理前缓存的分支状态

### Requirement: 分支 Skill 只验证分支一致性并交还整体校验
分支 Skill 必须（SHALL）在自动或手动处理后运行 `project branch verify <name...> --json`，且不得从 Skill 内运行整体 `project verify`。Skill 的完成只表示分支协调完成且分支一致性已验证；Workspace Guard 必须（SHALL）在 Skill 交还控制后重新运行目标项目的 `project verify <name...> --json`，并独立决定项目工作能否恢复。

#### Scenario: 批量复验部分失败
- **WHEN** 多项目分支一致性验证中部分项目成功、部分项目失败
- **THEN** Skill 将成功项目交还 Guard，保持失败项目为分支未解决状态，并在全部结果产生后统一汇报

#### Scenario: 目标项目复验成功
- **WHEN** 分支处理完成且目标项目的 `project branch verify` 返回 `ok: true`
- **THEN** Skill 报告该项目分支协调已完成，并将项目交还 Workspace Guard 执行整体目标校验

#### Scenario: 目标项目复验失败
- **WHEN** 分支一致性复验仍返回分支不一致或检查错误
- **THEN** Skill 保持目标项目为未解决状态，报告诊断且不检查其他项目

#### Scenario: 整体校验发现非分支问题
- **WHEN** Skill 已成功验证分支一致性，但 Guard 后续运行的定向 `project verify` 因非分支问题失败
- **THEN** 分支 Skill 保持完成，Guard 保持该项目工作暂停并负责报告或处理项目级问题

#### Scenario: 整体校验发现新的分支漂移
- **WHEN** Guard 后续运行的定向 `project verify` 因再次发生的 `PROJECT_BRANCH_MISMATCH` 失败
- **THEN** Guard 可以重新进入分支 Skill，并以新的 CLI 观察结果开始一次新的协调流程

### Requirement: 分支相关技术文档只引用已注册 CLI
Guard、分支 Skill、README 和流程文档中的命令引用必须（SHALL）通过真实 CLI 解析器校验；托管资产不得引用已移除的 `project sync-branch` 或任何尚未注册的命令。

#### Scenario: 打包托管资产
- **WHEN** 项目运行命令引用、托管文件和打包检查
- **THEN** 所有技术文档中的 `project branch` 示例均由注册表识别，且旧 `project sync-branch` 不出现在生成的 Agent 资产、帮助、补全或文档中

### Requirement: 用户指南不暴露分支协调实现细节
所有已注册 locale 的用户指南必须（SHALL）只提供用户可调用的分支处理 Skill 入口，不得列出 `project branch` 命令、分支状态字段、CLI 安全前置条件、迁移合同、验证、回滚或补偿机制。

#### Scenario: 生成用户指南
- **WHEN** 初始化或更新 Workspace 使用任一已注册 locale 生成 `USER_GUIDE.md`
- **THEN** 指南可以说明如何调用分支处理 Skill，但不包含底层 `project branch` 命令或分支协调实现合同
