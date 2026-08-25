# Code Workspace

Code Workspace 是面向 Claude Code 与 Codex 的本地多项目注册表和安全边界层，负责工作区身份、项目路径与分支、Agent 指令、可写目录权限、校验以及可选监控。

## 环境要求

- Node.js 20.19.0 或更高版本
- 待注册项目是 Git 仓库

## 安装

```bash
npm install -g @icebearx-ai/code-workspace
```

软件包提供 `code-workspace` 命令及短别名 `code-w`。

## 初始化

交互式初始化：

```bash
code-workspace init .
```

非交互式初始化：

```bash
code-workspace init . \
  --tools claude,codex \
  --extensions none \
  --language zh-CN \
  --yes
```

可用 `--tools claude`、`--tools codex` 或 `--tools none` 覆盖默认工具选择。选择 Codex 时默认启用监控；可传 `--no-monitor` 关闭。

初始化只写入 Workspace 自有状态和集成：

- `.code-workspace/config.yaml` 与 `.code-workspace/state.json`
- `USER_GUIDE.md`
- `CLAUDE.md` 和/或 `AGENTS.md`
- 名称以 `code-workspace-` 开头或使用 `/code-workspace` 命名空间的 Workspace 专用命令与 Skill
- 启用监控时的 `.codex/hooks.json`

它不会创建 `openspec/`，不会安装原生 `/opsx` 命令，也不会安装原生 `openspec-*` Skill。

### 试验性内置扩展

`init` 可以从 npm 包内随附的版本化 `extensions/` 仓库安装集成。交互模式按扩展名多选；非交互模式传入逗号分隔的扩展名。独立安装命令接受一个或多个扩展名；不传名称时打开内置扩展多选，按 ESC 可无修改退出：

```bash
code-w init . --extensions openspec-workspace --yes
code-w init . --extensions none --yes
code-w extension install
code-w extension install openspec-workspace --yes
code-w extension uninstall openspec-workspace --yes
```

`init`、扩展安装和扩展卸载共享的 Workspace 操作锁配置在 Code Workspace 项目自身的 `.env` 中（不在目标 Workspace 中）。`CODE_WORKSPACE_INIT_LOCK_UPDATE_MS` 默认值为 `5000`，`CODE_WORKSPACE_INIT_LOCK_STALE_MS` 默认值为 `30000`；进程环境变量优先于 `.env`。配置项名称见 `.env.example`。

用户只选择扩展名，不能选择版本；`openspec-workspace@1.0.0` 会被明确拒绝。Code Workspace 在确认前，从 Host 明确支持的 Extension Spec 实现中解析最高扩展 SemVer。新 Workspace 非交互初始化时，未传 `--extensions` 就不安装扩展；已有 Workspace 重新初始化时，默认选择已安装扩展，并在存在更高受支持内置版本时升级。`none` 只跳过本次扩展初始化，不会卸载已有制品。

`extension install` 不会重新执行 Workspace 核心初始化。在 JSON、非 TTY 或 `--yes` 模式下，必须至少提供一个扩展名。多个名称按顺序安装，只确认一次且各自使用独立事务；任一扩展失败会使安装命令失败，但后续扩展仍会继续执行。

内置 `openspec-workspace` 扩展会为选中的 Agent 工具安装命名空间为 `code-workspace-openspec-propose` 的 Skill；它不会创建 `openspec/` 目录，也不会安装 OpenSpec 原生命令。

扩展入口在独立 Node 进程中运行，只向临时 staging 目录生成文件。Host 会在事务安装前拒绝未声明、缺失、符号链接、非文件、路径逃逸、目标冲突和 hash 不匹配的制品。Workspace 状态存放在 `.code-workspace/ext-manifest.json`。扩展失败以 warning 报告，不回滚已成功的核心初始化，也不阻止后续扩展；升级失败会恢复并保留旧的已安装版本。

扩展可以独占完整文件，也可以贡献由 Host 管理的 Codex TOML 配置块和 Hook 片段。共享目标由 Code Workspace 合成和验证；扩展不会直接 patch 真实 Workspace。卸载只使用已安装状态，不执行扩展代码；扩展所有的文件或贡献存在未知修改时会拒绝覆盖或删除。

这是故障隔离，不是恶意代码安全沙箱。试验版本只信任随 Code Workspace 发布的扩展代码；暂不支持网络源、外部扩展目录、扩展依赖、任意 patch、强制卸载、禁用命令，也不会通过 `code-w update` 自动更新扩展。开发契约见 `docs/extensions.zh-CN.md`。

## 注册项目

项目检查是只读操作：

```bash
code-workspace project inspect /absolute/path/to/project --json
```

Claude Code 用户可显式调用：

```text
/code-workspace:add-projects /absolute/path/to/project-a /absolute/path/to/project-b
```

Codex 用户可对相同的显式路径调用 `$code-workspace-add-projects`。底层自动化可准备完整项目记录，然后运行：

```bash
code-workspace project add --projects-file projects.json --yes --json
```

注册表保存项目名称、真实路径、注册分支、类型和上下文。注册分支是 Code Workspace 的期望状态，实际分支是从选中 Git worktree 观测到的状态。Workspace 不会根据对话猜测路径，也不会自动判断哪一侧分支更权威。

## 日常命令

```bash
code-workspace project list --json
code-workspace project show payments --json
code-workspace project verify payments --json
code-workspace project branch inspect payments --json
code-workspace project branch verify payments --json
code-workspace project branch use-registered payments --yes --json
code-workspace project branch accept-actual payments --yes --json
code-workspace project branch update-latest payments --json
code-workspace permissions apply --yes --json
code-workspace doctor --json
```

`project branch inspect` 只检查命名项目，返回 `registeredBranch`、`actualBranch`、是否一致、worktree 是否干净、注册分支是否在本地存在以及远程跟踪候选。`project branch verify` 是协调后的窄范围断言，只检查注册分支和实际分支是否一致，不执行项目整体健康校验。`PROJECT_BRANCH_MISMATCH` 诊断使用 `registeredBranch`、`actualBranch` 和 `location`；使用旧分支诊断或结果字段的调用方必须迁移到这套规范状态合同。

两个协调方向通过独立命令表达：

- `project branch use-registered` 将选中 worktree 切换到注册分支，默认要求确认、干净 worktree 和已存在的本地注册分支。提供 `--allow-remote` 时，可以从唯一已有的远程跟踪分支创建本地 tracking 分支；提供 `--remote <name>` 时，可以在确认后仅 fetch 指定远程的注册分支，再创建本地 tracking 分支并切换。
- `project branch accept-actual` 只更新选中项目的注册记录，让注册分支接受实际分支；已有“接受实际分支”脚本应迁移到该命令。

两条命令都会检查计划漂移并验证后置条件。`project branch update-latest` 是独立的显式配置路径：仅当项目 `updateLatest: true` 时，才对干净且分支一致的 worktree fetch upstream 并 fast-forward。Code Workspace 不会创建或下载分支，也不会执行 stash、reset、rebase、非 fast-forward merge、生产代码编辑或冲突处理。

用户可以手动在 `.code-workspace/config.yaml` 中设置项目策略：

```yaml
projects:
  - name: payments
    updateLatest: true
```

AI/Agent 不得直接编辑该文件；可以读取策略并调用已注册的 CLI，手动配置结果由用户负责。

`permissions apply` 会展示选中 Agent 工具的完整授权计划，在需要修改时要求确认，实施并验证请求的授权，并按工具报告结果。Agent 目录访问仍属于用户授权。该命令只补齐已注册项目缺失的访问权限，不撤销额外目录；如需撤销，请使用 `project remove` 或显式编辑 Agent 设置。

## 更新与语言

```bash
code-workspace update --json
code-workspace update --language en-US --json
code-workspace language --json
```

`update` 只刷新 Workspace 自有托管资产，绝不会修改 Agent 目录授权。遇到未知本地修改时，会在任何写入前终止批次；请先审查修改，或显式传入 `--force`。

## 监控

```bash
code-workspace monitor --port 3211
```

监控服务仅绑定 loopback，可汇总多个已初始化工作区的事件；hook 上报失败不会阻断 Agent。依赖监控前，请在 Codex 中检查并信任项目 hook。

## 命令补全

```bash
code-workspace completion --shell zsh
code-workspace completion --shell bash
```

`completion` 会根据完整命令注册表输出脚本，包括子命令和各命令专属选项；它不会安装脚本或修改 Shell 配置。使用 `--json` 时，脚本位于 `data.script`。

## 开发

```bash
npm install
npm test
npm run check
npm run pack:check
```

发布清单只包含 Workspace 自有资产源和托管文件，并通过校验和保证安装与更新的确定性。
