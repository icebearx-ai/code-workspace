# OpenSpec Workspace

OpenSpec Workspace 是面向 Claude Code 与 Codex 的本地多项目注册表和安全边界层，负责工作区身份、项目路径与分支、Agent 指令、可写目录权限、校验以及可选监控。

它是独立工具。初始化和更新不会安装、检测、调用或管理其他 OpenSpec 软件包及可执行文件的版本。已有 `openspec/` 文件保持用户所有：Workspace 可以读取提案和规格以提供上下文与校验，但不会初始化或改写该目录。

## 环境要求

- Node.js 20.19.0 或更高版本
- 待注册项目是 Git 仓库

## 安装

```bash
npm install -g @icebearx-ai/openspec-workspace
```

软件包提供 `openspec-workspace` 命令及短别名 `openspec-w`。

## 初始化

交互式初始化：

```bash
openspec-workspace init .
```

非交互式初始化：

```bash
openspec-workspace init . \
  --tools claude,codex \
  --language zh-CN \
  --yes
```

可用 `--tools claude`、`--tools codex` 或 `--tools none` 覆盖默认工具选择。选择 Codex 时默认启用监控；可传 `--no-monitor` 关闭。

初始化只写入 Workspace 自有状态和集成：

- `.openspec-workspace/config.yaml` 与 `.openspec-workspace/state.json`
- `USER_GUIDE.md`
- `CLAUDE.md` 和/或 `AGENTS.md`
- 名称以 `openspec-workspace-` 开头或使用 `/opswx` 命名空间的 Workspace 专用命令与 Skill
- 启用监控时的 `.codex/hooks.json`

它不会创建 `openspec/`，不会安装原生 `/opsx` 命令，也不会安装原生 `openspec-*` Skill。

## 注册项目

项目检查是只读操作：

```bash
openspec-workspace project inspect /absolute/path/to/project --json
```

Claude Code 用户可显式调用：

```text
/opswx:add-projects /absolute/path/to/project-a /absolute/path/to/project-b
```

Codex 用户可对相同的显式路径调用 `$openspec-workspace-add-projects`。底层自动化可准备完整项目记录，然后运行：

```bash
openspec-workspace project add --projects-file projects.json --yes --json
```

注册表保存项目名称、唯一规格前缀、真实路径、预期 Git 分支、类型和上下文。Workspace 不会根据对话猜测路径。

## 日常命令

```bash
openspec-workspace project list --json
openspec-workspace project show payments --json
openspec-workspace project verify payments --json
openspec-workspace project sync-branch payments --yes --json
openspec-workspace context --project payments --json
openspec-workspace sync --json
openspec-workspace validate --json
openspec-workspace doctor --json
```

`project sync-branch` 只记录仓库当前已检出的分支，不会切换 Git 分支。

## 对已有记录的只读兼容

存在 `openspec/changes/<name>/proposal.md` 时，Workspace 可以解析受影响项目并校验项目边界：

```bash
openspec-workspace change validate add-payment-retry --json
openspec-workspace change validate add-payment-retry --require-main-specs --json
```

这些命令只读取已有记录；记录的创建、生命周期管理和归档不属于 Workspace 的职责。

## 更新与语言

```bash
openspec-workspace update --json
openspec-workspace update --language en-US --json
openspec-workspace language --json
```

`update` 只刷新 Workspace 自有托管资产。遇到未知本地修改时，会在任何写入前终止批次；请先审查修改，或显式传入 `--force`。

## 监控

```bash
openspec-workspace monitor --port 3211
```

监控服务仅绑定 loopback，可汇总多个已初始化工作区的事件；hook 上报失败不会阻断 Agent。依赖监控前，请在 Codex 中检查并信任项目 hook。

## 命令补全

```bash
openspec-workspace completion --shell zsh
openspec-workspace completion --shell bash
```

## 开发

```bash
npm install
npm test
npm run check
npm run pack:check
```

发布清单只包含 Workspace 自有资产源和托管文件，并通过校验和保证安装与更新的确定性。
