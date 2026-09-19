# Code Workspace

Code Workspace 是面向 Claude Code 与 Codex 的本地多项目注册表和安全边界层，负责工作区身份、项目路径与分支、Agent 指令、可写目录权限、校验以及可选监控。

## 环境要求

- Node.js 20.19.0 或更高版本
- 待注册项目是 Git 仓库

## 安装

```bash
npm install -g @icebearx-ai/code-workspace
```

软件包提供 `code-workspace` 命令及短别名 `codew`。为保持兼容，旧别名 `code-w` 仍然可用。

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

可用 `--tools claude`、`--tools codex` 或 `--tools none` 覆盖默认工具选择。监控不会隐式启用；请通过 `--extensions monitor` 或交互式扩展选择安装 `monitor` 扩展。

初始化只写入 Workspace 自有状态和集成：

- `.codew/config.yaml`、其引用的项目配置文件（默认：`.codew/config-projects.yaml`）与 `.codew/state.json`
- `USER_GUIDE.md`
- `CLAUDE.md` 和/或 `AGENTS.md`
- 名称以 `code-workspace-` 开头或使用 `/code-workspace` 命名空间的 Workspace 专用命令与 Skill
- 安装 `monitor` 扩展时由扩展写入的 `.codex/hooks.json`

它不会创建 `openspec/`，不会安装原生 `/opsx` 命令，也不会安装原生 `openspec-*` Skill。

### 试验性扩展

普通扩展发布到配置的 `@codew-ext` Nexus Registry，并安装到经过验证的本地 Extension Store。`init` 和独立安装命令从 Nexus/Store 选择普通扩展；npm 包内的 `extensions/` 目录只保留系统扩展 `codew-workspace-guard`。交互选择按 ESC 可无修改退出：

```bash
codew init . --extensions monitor --yes
codew init . --extensions none --yes
codew extension install
codew extension install monitor --yes
codew extension uninstall monitor --yes
codew extension search jira --json
codew extension info zhuiyi-jira-mcp --json
codew extension install zhuiyi-jira-mcp --version 1.1.0 --yes
codew extension install zhuiyi-jira-mcp --offline --version 1.1.0 --yes
codew extension upgrade zhuiyi-jira-mcp --yes
```

`init`、扩展安装和扩展卸载共享的 Workspace 操作锁配置在 Code Workspace 项目自身的 `.env` 中（不在目标 Workspace 中）。`CODE_WORKSPACE_INIT_LOCK_UPDATE_MS` 默认值为 `5000`，`CODE_WORKSPACE_INIT_LOCK_STALE_MS` 默认值为 `30000`；进程环境变量优先于 `.env`。配置项名称见 `.env.example`。

用户选择扩展名，不使用 `name@version` 位置语法。默认安装会从已配置的 `@codew-ext` Nexus Registry 和已验证本地 Store 中选择最高的兼容、稳定、非 deprecated 版本。单目标安装可用 `--version` 指定精确 SemVer； prerelease 必须通过精确版本请求，deprecated 版本还必须加 `--allow-deprecated`。`--offline` 禁止 Registry 访问，只基于本地事实解析。`codew-workspace-guard` 是包含 Workspace Guard、`codew-add-projects` 和 `codew-resolve-branch` 的系统扩展，由 `init` 自动安装或升级，不出现在扩展选择列表中，也不能通过 `extension install/uninstall/upgrade` 手动管理。新 Workspace 非交互初始化时，未传 `--extensions` 就不安装普通扩展；`init` 不会隐式查询 Nexus。`none` 只跳过本次普通扩展初始化，不会卸载已有制品，也不会取消系统扩展处理。

`extension install` 不会重新执行 Workspace 核心初始化。在 JSON、非 TTY 或 `--yes` 模式下，必须至少提供一个扩展名。多个名称按顺序安装，只确认一次且各自使用独立事务；任一扩展失败会使安装命令失败，但后续扩展仍会继续执行。Registry 已配置且默认解析无法取得远端 metadata 时，安装会在 Workspace 写入前失败，不会静默选择旧包。

`extension info` 仍是与 Workspace 无关的 Registry 读取命令。在 TTY 中，`extension search` 会打开与 `init` 相同的分页扩展选择器；选择未安装扩展会执行安装，选择已安装但过期的扩展会执行更新。系统扩展不会出现在列表中，已是最新版的扩展不可选择。JSON、非 TTY 或使用 `--yes` 时，search 保持只读并返回 Registry 结果 envelope。`extension upgrade` 接受一个或多个已安装普通扩展，逐个冻结默认目标，统一确认后复用安装的逐扩展事务和回滚；已是当前版本的目标返回 skipped。

`extension pack` 可以从扩展包目录生成可交给 Nexus/npm 的 `codew-ext-<extension-id>-<version>.tgz`：

```bash
code-workspace extension pack /path/to/extension/1.1.0 --output dist/extensions --json
```

该命令与 Workspace 无关，会在输出目录缺失时递归创建，不执行扩展入口或任何 npm 生命周期脚本；生成 tarball 后会重新读取并验证 npm envelope、manifest、入口摘要和未变化的 `packageSha256`，再原子提交。目标文件已存在时拒绝覆盖。命令本身不发布、不保存 Registry 凭证；CI 可将已验证的 tarball 交给 `npm publish --registry`。

系统管理的 `codew-workspace-guard` 由 `init` 自动安装或升级，不出现在普通扩展选择列表中，也不能手动安装、升级或卸载。普通扩展包从 Nexus 下载、验证，并缓存到用户级 Extension Store。

扩展入口在独立 Node 进程中运行，只向临时 staging 目录生成文件。Host 会在事务安装前拒绝未声明、缺失、符号链接、非文件、路径逃逸、目标冲突和 hash 不匹配的制品。Workspace 状态存放在 `.codew/ext-manifest.json`。扩展失败以 warning 报告，不回滚已成功的核心初始化，也不阻止后续扩展；升级失败会恢复并保留旧的已安装版本。

扩展可以独占完整文件，也可以声明由 Host 管理的抽象 Hook。Host 通过 Codex/Claude adaptor
把声明转换为各自的原生配置，并在扩展安装、升级和卸载时动态插拔；共享目标由 Code
Workspace 合成和验证，扩展不会直接 patch 真实 Workspace。卸载只使用已安装状态，不执行
扩展代码；扩展所有的文件或贡献存在未知修改时会拒绝覆盖或删除。

这是故障隔离，不是恶意代码安全沙箱。试验版本信任随 Code Workspace 发布的系统扩展代码，以及从已配置公司 Nexus 下载并通过归档、身份、manifest、入口、runtime 和 package digest 验证的普通扩展包。外部扩展目录、扩展依赖、任意 patch、强制卸载、禁用命令和通过 `codew update` 自动更新扩展仍不支持。开发契约见 `docs/extensions.zh-CN.md`；从目录结构到打包发布的完整流程见 `docs/extension-development/extension-development-guide.zh-CN.md`。

## 注册项目

项目检查是只读操作：

```bash
code-workspace project inspect /absolute/path/to/project --json
```

Claude Code 用户可显式调用：

```text
/codew:add-projects /absolute/path/to/project-a /absolute/path/to/project-b
```

Codex 用户可对相同的显式路径调用 `$codew-add-projects`。底层自动化可通过 stdin 一次传入完整项目记录：

```bash
cat projects.json | code-workspace project add --stdin --yes --json
```

`--stdin` 接受 `{ "schemaVersion": 1, "projects": [...] }` 形式且与 `--projects-file` 相同语义的 JSON，必须与 `--yes` 一起使用，并在输入为空、无效或超过 1 MiB 时于写入前失败。`--stdin`、`--project-file`、`--projects-file` 与位置路径只能选择一个。

注册表保存项目名称、真实路径、注册分支、类型和上下文。注册分支是 Code Workspace 的期望状态，实际分支是从选中 Git worktree 观测到的状态。Workspace 不会根据对话猜测路径，也不会自动判断哪一侧分支更权威。

项目注册配置始终独立保存于 `.codew` 目录下的单独文件。初始化默认使用 `config-projects.yaml`，但 `projects.ref` 可以引用该目录下任意安全的普通文件名：

```yaml
# .codew/config.yaml
projects:
  ref: config-projects.yaml
```

引用文件使用以下格式：

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
```

`projects.ref` 相对于 `config.yaml` 解析，必须是同一 `.codew` 目录下的安全普通文件名。不支持 URL、glob、绝对路径、路径逃逸或内联 `projects` 数组。项目命令的现有参数和行为保持兼容，`project add` 额外支持 `--stdin`；项目数据仍只读取和写入引用文件。`.codew/` 默认被忽略；如需 Git 历史，需要显式制定仓库策略。

例如，`ref: team-projects.yaml` 会将项目注册表放在 `.codew/team-projects.yaml`；默认名称仍为 `config-projects.yaml`。

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

用户可以手动在 `projects.ref` 指定的文件（默认：`.codew/config-projects.yaml`）中设置项目策略：

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

监控以 Nexus 中的 `monitor` 扩展提供。先在 Workspace 中安装扩展，再通过通用扩展运行时启动面板：

```bash
code-workspace extension install monitor --yes
code-workspace ext monitor serve --port 3211
```

监控服务仅绑定 loopback，可汇总多个已初始化工作区的事件；hook 上报（`codew ext monitor report`）失败不会阻断 Agent。依赖监控前，请在 Codex 中检查并信任项目 hook。

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
