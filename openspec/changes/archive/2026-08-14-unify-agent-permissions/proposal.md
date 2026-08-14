## 为什么

现有 `sync` 命令既没有说明被修改的资源，也没有表达操作方向和授权后果；同时，其仅支持 Codex 的行为无法扩展到 Claude 或未来的 Agent 工具。Code Workspace 需要建立一个明确的目录授权契约：为所有支持的工具提供一致的计划、确认、事务、验证和结果模型，同时将工具特有的配置细节封装在适配器之后。

## 变更内容

- **破坏性变更**：使用 `permissions apply` 替代语义含糊的 `sync` 命令，不保留废弃别名。
- 引入统一的目录授权模型，为 Codex、Claude 及未来工具提供明确的 `grant` 和 `revoke` 操作。
- 增加权限适配器：Codex 继续更新其托管的 TOML 区块；Claude 更新 `.claude/settings.local.json` 中的 `permissions.additionalDirectories`，不使用托管块或所有权元数据。
- 将 Agent 目录访问视为用户授权：展示完整的跨工具变更计划，只要求一次确认，以事务方式实施，验证每个目标，并按工具报告实际结果。
- `permissions apply` 只为已注册项目补齐缺失的访问授权，不隐式撤销 Agent 配置中已有的其他授权。
- `project add` 为所有选中工具授予受影响目录的访问权限；`project remove` 撤销该目录的访问权限；二者都与项目注册表变更处于同一事务中。
- 普通 `update` 保持授权中立。重新初始化可以授予已确认计划中缺失的访问权限，但不得隐式撤销现有授权。
- 扩展 `doctor`：按选中工具报告已注册项目缺失的授权，但不把用户额外授权的目录视为错误。

## 能力

### 新增能力

- `agent-directory-authorization`：定义与具体工具无关的授权命令、用户交互、适配器契约、Codex 与 Claude 映射、事务保证、验证、结果以及扩展性要求。

### 修改的能力

无。

## 影响范围

- CLI 注册表、解析、分发、帮助、补全、文档命令示例以及稳定的 JSON 结果。
- 项目添加、删除和初始化编排，包括确认流程与多文件回滚边界。
- 核心权限服务、事务规划、doctor 诊断以及工具注册机制。
- Codex `.codex/config.toml` 和 Claude `.claude/settings.local.json` 权限适配器。
- 现有 `sync` 调用方和文档必须迁移到 `permissions apply`。
- 测试必须覆盖工具无关行为、各适配器的解析与持久化、幂等性、确认、故障注入、验证以及跨工具回滚。
