# Release Notes

## Unreleased

### BREAKING: Jira 与修复总结 Skill 迁移为独立扩展

`code-workspace-jira-prd-analysis`、`code-workspace-jira-task-breakdown` 和 `code-workspace-issue-fix-summary` 不再属于核心 managed files，不再由 `codew init` 或 `codew update` 自动安装。

- 三个 Skill 分别以同名内置扩展提供，支持 Codex 与 Claude Code 文件输出。
- 使用 `codew extension install <name> --yes` 显式安装，使用 `codew extension uninstall <name> --yes` 独立卸载。
- 内置扩展 manifest 新增不超过 60 字的单行 `description`，交互式 init 和 extension install 使用两行选项：加粗名称与弱化描述，且默认不选中任何扩展。
- 扩展只安装 Skill 指令；需要实际访问 Jira 时，另行安装 `zhuiyi-jira-mcp`。
- 这是 beta 阶段的破坏性调整，不提供旧 managed file 的自动迁移。已有测试 Workspace 应改用全新的 Workspace，或先手动删除旧的 `.codex/skills/<name>` 与 `.claude/skills/<name>` 目录，再安装对应扩展。

## 0.1.0-beta.9 (unreleased)

### BREAKING: Monitor 完全收敛为扩展包

`src/monitor/` 的 legacy 实现、`codew monitor` / `codew monitor report` 命令、workspace config 的 `monitor` 配置域，以及 init 的 Monitor 自动激活逻辑全部删除。Host 核心不再包含任何 Monitor 业务知识，Monitor 的唯一实现和上报入口是内置扩展包 `extensions/monitor/1.1.0`。

#### 破坏性变更

- **`codew monitor` / `codew monitor report` 已删除**，无过渡别名。Hook 上报的唯一入口改为 `codew ext monitor report`，经通用 `ext` 命令路由；保持 failure-open——服务不可用、制品缺失或 POST 失败时退出码恒为 0，绝不阻塞 Agent 工具。
- **workspace config 的 `monitor` 配置域已删除**（`monitor.enable` / `monitor.url`），以及 `--monitor` / `--no-monitor` / `--monitor-url` init 参数。存量配置中的 `monitor:` 键在读取时被剥离，下次保存时自然移除。
- **init 的 "Enable Codex Agent monitor?" 交互步骤已取消**，Codex 工具的 Monitor 自动激活一并移除。监控只能通过 `--extensions monitor` 或交互式扩展多选显式安装。
- **Monitor 配置改为扩展自有制品** `.code-workspace/config-monitor.yaml`（默认值，Host 按 exclusive output 管理），不再进入核心 config schema。

#### 升级前置条件

- **存量 `.codex/hooks.json` / `.claude` Hook 仍指向 `codew monitor report`**：运行 `codew init` 会将 monitor 扩展升级到 1.1.0 并重写扩展自有的 Hook 条目为 `codew ext monitor report`。
- **以编程方式使用 `code-workspace-zhuiyi` npm 包**：核心 Monitor 导出已移除，等价实现请直接 require `extensions/monitor/1.1.0/monitor.js` 等扩展包内模块，或通过 `codew ext monitor` 命令访问。

#### 不变的部分

- 用户级 Monitor runtime data、扩展 Store、Workspace activation 状态（`.code-workspace/ext-manifest.json`）不受影响，无需迁移。
- 旧 installed 记录（protocol v1/v2/v3）仍可仅依据状态完成卸载，不要求扩展源码存在；卸载不会停止共享 Monitor service 或删除用户级运行数据。
- Session 生命周期（10 分钟无信号投影为 `INACTIVE`）、统计口径、删除 API、SSE、Dashboard 行为不变。

#### 回滚方式

如发布后发现问题，回滚本变更的代码提交即可；任何情况下都不要删除用户级 Monitor runtime data 与扩展 Store。
