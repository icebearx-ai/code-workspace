# Code Workspace

Code Workspace 是面向 Claude Code 与 Codex 的本地多项目注册表和安全边界层。它管理工作区身份、项目路径与注册分支、Agent 目录权限、内置 Agent 指令以及工作区校验。

从 2.0.0 起，本项目是纯粹的多项目管理工具：不再提供扩展系统、扩展 Registry、扩展运行时或监控能力。Workspace Guard、添加项目 Skill 和分支恢复 Skill 随 CLI 内置发布。

## 环境要求

- Node.js 20.19.0 或更高版本
- 待注册项目是 Git 仓库

## 安装

```bash
npm install -g code-workspace-zhuiyi@2.0.0
```

## 初始化

交互式初始化：

```bash
codew init .code-workspace
```

非交互式初始化：

```bash
codew init . \
  --tools claude,codex \
  --language zh-CN \
  --yes
```

`--tools` 支持 `claude`、`codex`、`none` 或逗号分隔组合。开发模式用于决定是否在 Code Workspace 源码目录中安装依赖；普通工作区可使用 `--dev false`。

初始化只写入 Workspace 自有状态和集成：

- `.codew/config.yaml`
- `.codew/config-projects.yaml`
- `.codew/state.json`
- `USER_GUIDE.md`
- `CLAUDE.md` 和/或 `AGENTS.md`
- Workspace 专用 Agent Skill 与 Command
- Claude / Codex 项目目录授权配置

它不创建 `openspec/`，不安装扩展，不创建监控 Hook，也不会执行普通扩展入口。

## 注册项目

项目路径必须来自用户显式输入。先执行只读检查：

```bash
codew project inspect /absolute/path/to/project --json
```

Claude Code 用户可显式调用：

```text
/codew:add-projects /absolute/path/to/project
```

Codex 用户可调用：

```text
$codew-add-projects /absolute/path/to/project
```

自动化流程可以通过 stdin 一次传入完整记录：

```bash
cat projects.json | codew project add --stdin --yes --json
```

项目注册表保存项目名称、真实路径、注册分支、类型和上下文：

```yaml
# .codew/config-projects.yaml
schemaVersion: 1
projects:
  - name: payments
    location: /absolute/path/to/payments
    branch: main
    type: backend
    context: |-
      服务职责和代码导航上下文。
    updateLatest: true
```

项目注册文件由 `.codew/config.yaml` 的 `projects.ref` 引用，必须位于同一 `.codew` 目录中，且必须是安全普通文件名。AI/Agent 不得直接编辑该文件。

## 日常命令

```bash
codew project list --json
codew project show payments --json
codew project verify payments --json

codew project branch inspect payments --json
codew project branch verify payments --json
codew project branch use-registered payments --yes --json
codew project branch accept-actual payments --yes --json
codew project branch update-latest payments --json

codew permissions apply --yes --json
codew doctor --json
```

注册分支是 Workspace 的期望状态；实际分支是 Git worktree 的观测状态。出现不一致时由用户明确选择：

- `use-registered`：切换回注册分支；
- `accept-actual`：更新注册记录以接受实际分支；
- 手动处理后运行 `verify` 确认。

`updateLatest` 仅对显式启用该策略、分支一致且 worktree 干净的项目执行 upstream fetch 和 fast-forward。Workspace 不创建或下载分支，不执行 stash、reset、rebase、非 fast-forward merge、生产代码编辑或冲突处理。

## Agent 授权

```bash
codew permissions apply --yes --json
```

该命令展示完整授权计划，确认后只补齐已注册项目缺失的目录授权，并验证结果。它不撤销额外目录；如需撤销，请移除项目或手动编辑 Agent 设置。

## 更新与语言

```bash
codew update --json
codew update --language en-US --json
codew language --json
```

更新只管理 Workspace 自有资产。未知本地修改会导致写入前失败；确认覆盖时使用 `--force`。

## 从 1.x 迁移

2.0.0 移除了以下试验性能力：

- `extension *`
- `ext`
- `config *`
- Nexus Registry 与本地 Extension Store
- monitor 扩展和 Codex 监控 Hook
- 扩展打包、开发与运行协议

`init` 和 `update` 会继续识别旧 `.codew/ext-manifest.json`。Doctor 会报告 legacy 扩展状态；可安全识别的旧普通扩展文件和扩展 Hook 会在 `update --yes` 的清理计划中移除。已被用户修改的旧扩展文件会被保留并报告，需要人工处理。

内置 Workspace Guard 会接管原 `codew-workspace-guard` 系统扩展生成的 `AGENTS.md`、`CLAUDE.md`、添加项目 Skill/Command 和分支恢复 Skill。若这些文件被本地修改，更新会要求确认覆盖。

## 开发

```bash
npm test
npm run cli:architecture-check
npm run check
```

## License

MIT
