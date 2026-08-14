# Agent Directory Authorization

## Purpose

定义 Code Workspace 对 Agent 工具目录授权的统一命令、适配器、事务、项目流程和健康诊断行为。

## Requirements

### Requirement: 明确的权限命令
CLI 必须（SHALL）提供 `permissions apply`，用于应用已注册项目的目录授权；并且必须（SHALL）将已删除的 `sync` 命令识别为未知命令。

#### Scenario: 为 Workspace 持久化工具应用权限
- **WHEN** 用户运行不带 `--tools` 的 `code-w permissions apply`
- **THEN** 命令使用 Workspace 中持久化的工具选择，并为这些工具所缺失的已注册项目目录准备授权操作

#### Scenario: 为显式工具子集应用权限
- **WHEN** 用户运行 `code-w permissions apply --tools claude,codex`
- **THEN** 命令通过共享解析器验证工具名称，并将计划限制在请求的、具备权限能力的工具上

#### Scenario: 已删除的 sync 命令
- **WHEN** 用户调用 `code-w sync`
- **THEN** CLI 在发现 Workspace 之前返回稳定的未知命令诊断

### Requirement: 明确的授权操作
权限服务必须（SHALL）将目录授权建模为明确的 `grant` 和 `revoke` 操作，并且不得（SHALL NOT）仅因为目录不存在于项目注册表中就推断应当撤销授权。

#### Scenario: 为缺失的已注册项目补充授权
- **WHEN** `permissions apply` 检查到选中工具缺少已注册项目目录的授权
- **THEN** 计划包含对应工具与目录组合的授权操作，且不包含任何推断产生的撤销操作

#### Scenario: 保留额外授权
- **WHEN** 选中工具已授权一个未注册为项目的目录，且没有明确的撤销操作请求该目录
- **THEN** 应用计划后仍保留该授权

#### Scenario: 删除项目时明确撤销
- **WHEN** 用户确认删除一个已注册项目
- **THEN** 授权请求明确撤销所有选中且具备权限能力的工具对该项目目录的访问权限

### Requirement: 统一的授权交互
所有多工具授权变更必须（SHALL）以一个合并计划展示，通过一次确认接受，并使用一个与工具无关的结果契约进行报告。

#### Scenario: 合并的交互式确认
- **WHEN** 一个计划操作会改变多个工具的授权
- **THEN** CLI 在请求一次确认之前，展示全部授权和撤销操作、受影响工具以及受影响文件

#### Scenario: 非交互执行需要确认
- **WHEN** 授权计划包含写入，并且在 JSON 或非 TTY 环境中执行且未提供 `--yes`
- **THEN** 命令在修改任何文件之前以 `CLI_CONFIRMATION_REQUIRED` 失败

#### Scenario: 无变更时无需确认
- **WHEN** 请求的所有授权均已处于目标状态
- **THEN** 命令无需提示即可成功，并报告每个选中工具均未改变

#### Scenario: 通用 JSON 结果
- **WHEN** 任意受支持工具组合的授权操作成功
- **THEN** JSON 数据报告请求的工具和操作，并为每个工具提供 `target`、`action`、`granted`、`revoked`、`unchanged` 和 `verified` 字段

### Requirement: 权限适配器扩展性
核心权限服务必须（SHALL）通过权限适配器注册表解析工具特有行为，并且必须（SHALL）使通用规划、交互、事务、验证和结果构建不依赖 Agent 配置格式。

#### Scenario: 执行已注册适配器
- **WHEN** 选中的工具具有已注册的权限适配器
- **THEN** 通用服务通过标准的 inspect、plan、apply、verify 和 target 契约调用该适配器

#### Scenario: 选中工具不具备权限能力
- **WHEN** Workspace 选中的工具没有已注册的权限适配器
- **THEN** 权限规划返回稳定的“不支持该能力”诊断，指出工具名称和补救方式，而不是静默跳过

#### Scenario: 未来的本地文件适配器
- **WHEN** 未来 Agent 工具实现并注册标准的本地文件权限适配器契约
- **THEN** `permissions apply`、项目授权流程、确认、事务和通用 JSON 结果无需增加命令专用分支即可支持该工具

### Requirement: Codex 权限映射
Codex 权限适配器必须（SHALL）在 `.codex/config.toml` 的 Code Workspace 托管块中修改请求涉及的规范目录条目，同时保留该区块之外的配置。

#### Scenario: 授予 Codex 目录访问权限
- **WHEN** 已确认计划授予一个尚未存在于 Codex 托管可写根目录中的目录
- **THEN** 适配器将该目录加入托管块，并保留无关 TOML 内容

#### Scenario: 撤销 Codex 目录访问权限
- **WHEN** 已确认计划明确撤销一个存在于 Codex 托管可写根目录中的目录
- **THEN** 适配器删除该目录，同时保留其他所有托管根目录和无关 TOML 内容

#### Scenario: 只补授权时保留额外 Codex 根目录
- **WHEN** `permissions apply` 为缺失的已注册项目补充授权，且托管块中包含其他目录
- **THEN** 适配器保留该目录，因为没有明确的撤销操作请求它

#### Scenario: 非托管 Codex 配置冲突
- **WHEN** 非托管的 Codex sandbox 设置与托管权限区块冲突
- **THEN** 规划在确认或修改之前以稳定的冲突诊断失败

### Requirement: Claude 权限映射
Claude 权限适配器必须（SHALL）修改 `.claude/settings.local.json` 中 `permissions.additionalDirectories` 里的规范目录条目，并且不得添加托管标记或权限所有权元数据。

#### Scenario: 授予 Claude 目录访问权限
- **WHEN** 已确认计划授予一个不存在于 Claude `additionalDirectories` 中的目录
- **THEN** 适配器添加该目录，在结构合法时创建缺失的包含对象，并保留无关 JSON 属性和未删除目录的顺序

#### Scenario: 撤销 Claude 目录访问权限
- **WHEN** 已确认计划明确撤销一个存在于 Claude `additionalDirectories` 中的目录
- **THEN** 适配器删除规范化后完全匹配的条目，并保留无关 JSON 属性和其他目录

#### Scenario: Claude 设置结构无效
- **WHEN** Claude 设置文件或权限字段具有不兼容的 JSON 结构
- **THEN** 规划在确认或修改之前以稳定的解析或结构诊断失败，并指出 `.claude/settings.local.json`

#### Scenario: 不记录所有权元数据
- **WHEN** Claude 适配器成功修改目录授权
- **THEN** `.code-workspace/state.json` 和 Claude 设置文件均不写入 Code Workspace 权限所有权元数据

### Requirement: 原子化的多工具授权
授权操作必须（SHALL）验证所有请求的后置条件，并且必须（SHALL）针对可回滚的本地适配器原子提交项目文件和权限文件。

#### Scenario: 跨工具成功
- **WHEN** 每个选中适配器都成功应用并验证其计划中的授权和撤销操作
- **THEN** 事务提交，且每个工具的结果均报告 `verified: true`

#### Scenario: 适配器应用失败
- **WHEN** 某个选中适配器在另一个目标已经写入后失败
- **THEN** 操作将所有受影响的权限文件和项目配置文件恢复到操作前状态

#### Scenario: 适配器验证失败
- **WHEN** 目标写入完成，但请求的授权、撤销或无关配置保留检查失败
- **THEN** 操作以稳定的验证诊断失败，并回滚所有受影响文件

#### Scenario: 授权计划过期
- **WHEN** 目标配置在规划完成后、应用开始前发生变化
- **THEN** 操作在第一次写入前拒绝过期计划，并指出发生变化的目标

### Requirement: 项目流程集成
项目注册表变更必须（SHALL）使用通用权限服务，并且必须（SHALL）将注册表和授权变更纳入同一个计划、确认、事务和结果。

#### Scenario: 添加项目并授权
- **WHEN** 用户确认添加一个或多个项目
- **THEN** 命令保存完整项目记录，并在一个经过验证的事务中向所有选中且具备权限能力的工具授予其目录访问权限

#### Scenario: 删除项目并撤销授权
- **WHEN** 用户确认删除一个项目
- **THEN** 命令删除项目记录，并在一个经过验证的事务中明确撤销所有选中且具备权限能力的工具对其目录的访问权限

#### Scenario: 项目操作失败回滚
- **WHEN** 项目配置已经写入，但任一权限适配器失败或无法通过验证
- **THEN** 项目注册表和每个权限目标都恢复为原始内容

### Requirement: 初始化和更新的授权边界
初始化必须（SHALL）只把明确缺失的目录授权纳入已确认计划，而普通 update 必须（SHALL）保持授权中立。

#### Scenario: 重新初始化现有 Workspace
- **WHEN** 在已有 Agent 目录授权的 Workspace 上运行初始化
- **THEN** 初始化保留现有授权，只应用已确认初始化计划中包含的缺失授权

#### Scenario: 普通更新
- **WHEN** 用户在没有授权命令的情况下运行 `code-w update`
- **THEN** 不修改任何 Agent 目录授权文件

#### Scenario: 工具选择更新暴露缺失授权
- **WHEN** update 启用了一个尚未获得已注册项目目录授权的工具
- **THEN** update 在不授予访问权限的情况下完成，并报告补救说明，引导用户检查并运行 `code-w permissions apply`

### Requirement: 权限健康诊断
Workspace 健康检查必须（SHALL）评估每个选中且具备权限能力的工具是否获得已注册项目授权，同时不得把额外授权目录视为不健康状态。

#### Scenario: 缺少已注册项目授权
- **WHEN** 选中工具缺少某个已注册项目目录的访问权限
- **THEN** doctor 返回结构化诊断，指出工具、目录、目标文件以及运行 `permissions apply` 的补救方式

#### Scenario: 用户额外授权
- **WHEN** 选中工具授权了已注册项目集合之外的目录
- **THEN** doctor 不把这些额外目录报告为错误或警告

#### Scenario: 所有已注册项目均已授权
- **WHEN** 每个选中且具备权限能力的工具都已获得所有已注册项目目录的访问权限
- **THEN** 权限健康检查不产生错误诊断
