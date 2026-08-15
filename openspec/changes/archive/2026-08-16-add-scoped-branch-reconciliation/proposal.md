## Why

当前 Workspace 将注册分支与项目实际分支的角色混为“唯一事实来源”，分支不一致时仅有“实际分支写回注册表”受到 CLI 保护，而“项目切回注册分支”仍依赖 Agent 直接执行 Git 命令。同时，定向项目校验会在内部检查所有已注册工程，使无关工程进入当前任务的读取和判断范围。需要建立方向明确、由 CLI 强制执行、且严格限定到选中项目的分支协调契约，再让 Agent Skill 基于这套稳定能力提供一致指导。

## What Changes

- 将实施第一阶段固定为分支术语与结构化字段迁移：所有分支比较、诊断、计划和结果统一使用 `registeredBranch` 与 `actualBranch`；状态前后或并发比较通过 `before`/`after`、`expectedState`/`observedState` 容器表达，不再使用 `configuredBranch`、`previousBranch`、`expectedBranch`、`requestedBranch` 或 `savedBranch` 等替代名称。
- 明确定义 `registeredBranch` 为 Code Workspace 的期望状态、`actualBranch` 为目标 Git worktree 的观测状态；分支不一致不自动决定任何一侧优先。现有持久化键 `projects[].branch` 保持不变，并明确映射为 `registeredBranch`，本变更不引入配置 schema 迁移。
- 新增只读的目标项目分支状态检查，以及“项目使用注册分支”和“注册表接受实际分支”两种独立 CLI 操作；两种操作均提供确认、并发漂移检查、后置验证和结构化结果。
- 将项目切换到注册分支的安全前置条件下沉到 CLI：工作树必须干净、注册分支必须已在本地存在，且不得隐式创建分支、fetch、stash 或 reset。
- 使 `project verify <name>` 和所有新分支命令只检查命名项目，不读取、校验或修改其他已注册工程；工作区级校验仍保留显式的全量语义。
- 在 CLI 能力完成后，重写 Workspace Guard 和分支处理 Skill：优先确定单一目标项目，使用固定事实字段和固定选择模板询问用户，两个协调方向都只调用 CLI，并仅重新校验目标项目。
- 同步流程文档、README、命令补全、托管资产断言和架构测试；双语用户指南只保留面向用户的分支处理 Skill 入口，不暴露底层命令族或状态合同。
- **BREAKING**：`PROJECT_BRANCH_MISMATCH` 等公共 JSON 诊断和旧分支命令结果从 `configuredBranch`、`previousBranch` 等字段迁移到只包含 `registeredBranch`、`actualBranch` 的规范状态结构。
- **BREAKING**：以 `project branch inspect`、`project branch accept-actual`、`project branch use-registered` 替换语义不明确的 `project sync-branch`，不再把旧命令作为 Agent 或文档入口。

## Capabilities

### New Capabilities

- `project-branch-reconciliation`: 定义目标项目分支状态检查、两个方向的 CLI 协调、安全前置条件、确认、验证、失败恢复和稳定结果。
- `targeted-project-scope`: 定义定向项目操作只访问命名工程，以及显式全量操作与定向操作之间的范围边界。
- `workspace-agent-branch-guidance`: 定义 Workspace Guard 的分支角色和项目选择规则，以及分支 Skill 的固定询问模板、CLI-only 执行与定向复验流程。

### Modified Capabilities

无。

## Impact

- CLI 注册、解析、帮助、补全和项目命令路由：`src/cli/registry.js`、`src/cli/commands/project.js` 或新的分支命令模块。
- 核心 Git 检查、分支切换、配置分支更新、定向项目校验和外部效果报告：`src/core/project.js`、`src/core/config.js`、`src/core/validation.js`、事务与错误模型的现有公共接口。
- Agent 托管资产：`artifacts/templates/agents/WORKSPACE_GUARD.md.template`、`code-workspace-resolve-branch` Skill 及清单生成测试。
- 用户文档和命令引用：README 与流程文档中的技术示例、双语用户指南的 Skill 级入口，以及真实解析器校验。
- CLI 调用方需要迁移分支诊断/结果字段，并从 `project sync-branch` 迁移到新的 `project branch` 命令族；不引入新的第三方依赖。
