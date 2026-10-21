## ADDED Requirements

### Requirement: 内置 Agent 资产随 CLI 发布
Code Workspace SHALL 将 Workspace Guard 指令、添加项目 Skill/Command 和分支恢复 Skill 作为 CLI 包内静态托管资产管理，SHALL NOT 依赖扩展 manifest、Extension Store、Registry、扩展入口进程或 `.codew/ext-manifest.json` 来发现、安装或运行这些资产。

#### Scenario: 初始化新 Workspace
- **WHEN** 用户对选择 Claude 和/或 Codex 的新 Workspace 运行 `init`
- **THEN** CLI 直接按工具选择规划并生成对应内置 Agent 指令、Skill 或 Command，且不创建扩展状态记录

#### Scenario: 更新已有 Workspace
- **WHEN** 用户对已有 Workspace 运行 `update`
- **THEN** CLI 按当前包内静态资产和工具选择计算托管文件差异，并沿用计划、确认、写入和验证流程

### Requirement: 内置托管输出遵守所有权规则
内置 Agent 集成 SHALL 为每个输出声明稳定的 Workspace 相对目标、来源摘要、工具适用性和移除语义；CLI MUST 在写入前拒绝路径逃逸、目标冲突和未知本地修改，并在工具被取消选择时按托管文件规则提供移除或遗忘计划。

#### Scenario: 工具被取消选择
- **WHEN** 用户在 update 中把工具从 Claude 和 Codex 改为 none
- **THEN** 更新计划列出不再适用的内置 Agent 文件的移除动作，并要求确认后执行

#### Scenario: 托管文件被用户修改
- **WHEN** 内置 Agent 输出内容与上一个托管版本不同且不属于声明的可替换内容
- **THEN** CLI 以未知托管文件诊断停止，不覆盖该文件

### Requirement: 内置 Agent 集成保持多项目安全边界
内置 Workspace Guard 和 Skill SHALL 保持既有安全语义：项目路径必须来自用户显式输入或注册表，Agent MUST NOT 直接编辑项目注册表、权限文件或分支记录，分支恢复 MUST 通过已注册 CLI 命令执行。

#### Scenario: Agent 需要添加项目
- **WHEN** 用户提供显式项目路径
- **THEN** 内置添加项目 Skill 调用 `project inspect` 和 `project add`，不在 Skill 内直接写 `.codew` 项目配置

#### Scenario: Agent 遇到分支不一致
- **WHEN** 项目验证返回 `PROJECT_BRANCH_MISMATCH`
- **THEN** 内置分支恢复 Skill 要求用户选择恢复方向，并只调用 `project branch use-registered` 或 `project branch accept-actual`

### Requirement: 旧系统扩展输出可迁移为内置托管输出
对包含 `codew-workspace-guard` installed 记录的已有 Workspace，`update` SHALL 识别其拥有的 Agent 输出、来源摘要和工具选择，SHALL 将等价输出映射到新的内置托管文件记录，并 SHALL 保留项目注册和权限数据。映射或验证失败时 MUST 保持原文件不变并返回稳定迁移诊断。

#### Scenario: 系统扩展输出未被修改
- **WHEN** 旧系统扩展生成的 `AGENTS.md`、`CLAUDE.md` 和 Skill 文件与 installed 记录匹配
- **THEN** update 将这些目标接管为内置托管文件，并可继续更新到当前 CLI 版本

#### Scenario: 系统扩展输出被修改
- **WHEN** 旧系统扩展输出与 installed 记录不匹配
- **THEN** update 不覆盖该输出，报告未知修改并提供人工确认后的处理路径
