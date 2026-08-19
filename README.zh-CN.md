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
code-workspace permissions apply --yes --json
code-workspace doctor --json
```

`project branch inspect` 只检查命名项目，返回 `registeredBranch`、`actualBranch`、是否一致、worktree 是否干净以及注册分支是否在本地存在。`project branch verify` 是协调后的窄范围断言，只检查注册分支和实际分支是否一致，不执行项目整体健康校验。`PROJECT_BRANCH_MISMATCH` 诊断使用 `registeredBranch`、`actualBranch` 和 `location`；使用旧分支诊断或结果字段的调用方必须迁移到这套规范状态合同。

两个协调方向通过独立命令表达：

- `project branch use-registered` 将选中 worktree 切换到注册分支，要求确认、干净 worktree 和已存在的本地注册分支。
- `project branch accept-actual` 只更新选中项目的注册记录，让注册分支接受实际分支；已有“接受实际分支”脚本应迁移到该命令。

两条命令都会检查计划漂移并验证后置条件。Code Workspace 不会创建或下载分支，也不会执行 fetch、stash、reset、commit、生产代码编辑或冲突处理。

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
