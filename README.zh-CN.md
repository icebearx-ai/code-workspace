# OpenSpec Workspace

[English](README.md) | 简体中文

`@icebearx-ai/openspec-workspace` 为 OpenSpec 扩展了本地多项目及跨项目 AI 编码工作流。

OpenSpec 继续负责提案、规格、设计、任务、实施和归档。OpenSpec Workspace 在此基础上增加本地项目注册表、Git worktree 与分支校验、能力归属、跨项目任务校验、AI 上下文输出，以及 Codex 可写根目录同步。

## 安装

```bash
npm install -g @icebearx-ai/openspec-workspace
```

该软件包提供两个等价命令：

```bash
openspec-workspace --help
openspec-w --help
```

`openspec-workspace` 是文档和自动化使用的标准命令，`openspec-w` 是较短的交互式别名。

## 初始化

```bash
mkdir my-workspace
cd my-workspace

openspec-workspace init
```

目标目录参数可省略，默认使用当前目录。只有需要初始化其他目录时才需传入路径，例如 `openspec-workspace init ./my-workspace`。

`init` 执行完整的托管初始化流程：

1. 运行只读预检，校验软件包清单、检查 Node.js，并检测全局 OpenSpec 软件包及可执行文件的版本。
2. 在交互式终端中使用 `@clack/prompts` 设置向导，通过键盘可选控件收集工作区名称、工作区语言（`zh-CN` 或 `en-US`）、受支持的精确 OpenSpec 版本、Agent 工具和 Codex 监控设置，并提供一致的取消行为。未传入 `--tools` 时，向导会提供只包含 Claude Code 和 Codex 的多选项；两者默认选中，也可以分别取消。启用 Codex 时默认选中监控功能；可用 `--no-monitor` 退出。Monitor 的语言在面板页面中单独选择。
3. 展示完整初始化计划，包括全局 OpenSpec 版本变更；写入文件或安装软件包前请求确认。
4. 当 OpenSpec 缺失、版本不同或状态不一致时，通过 `npm install -g <package>@<version>` 安装所选精确版本，然后校验软件包和可执行文件版本。
5. 生成稳定的工作区 UUID，并在后续初始化时保留。
6. 初始化 OpenSpec Workspace 源码目录时运行 `npm install`。
7. 对全新目标初始化 OpenSpec 以及所选 AI 工具的原生基线。已有完整 `openspec/` 结构时，即使缺少某个 AI 工具文件，也不会重新进入上游 OpenSpec 初始化流程。
8. 删除早期版本遗留的过时托管文件。
9. 通过统一的指纹托管机制安装全部模板、编译后的补丁输出和工作区 schema 文件。
10. 应用版本化的 `config-yaml.patch`，选择 `workspace-workflow` schema 并安装 OpenSpec Workspace 项目上下文。
11. 创建仅限本地使用的项目配置；存在项目时同步 Codex 可写根目录。
12. 运行严格健康检查，提交本地初始化状态并校验提交结果。

非交互式安装或版本变更：

```bash
openspec-workspace init . \
  --tools claude,codex \
  --language zh-CN \
  --openspec-version 1.5.0 \
  --yes
```

省略 `--openspec-version` 时，`--yes` 会选择清单中推荐的 OpenSpec 版本。`--json` 模式不会显示交互向导、颜色或进度界面。非交互命令无法显示工具多选，因此在 `--yes` 或 `--json` 模式下省略 `--tools` 会同时启用 Claude Code 和 Codex；可使用 `--tools claude`、`--tools codex` 或 `--tools none` 覆盖该默认值。

初始化会创建仅限本地使用的状态：

```text
.openspec-workspace/
├── config.yaml
└── state.json
```

整个 `.openspec-workspace/` 目录都会加入 `.gitignore`。OpenSpec Workspace 不会创建或支持共享项目配置。

初始化会在工作区根目录按所选工作区语言安装一份托管的 `USER_GUIDE.md`。可以通过 `openspec-workspace update` 恢复、更新或切换该指南的语言。

## 添加项目

推荐使用初始化时安装的 `openspec-workspace-add-projects` skill 作为用户入口。skill 会只读检查各仓库、生成简洁的 AI context、展示完整项目记录供确认，然后调用底层 CLI 完成注册。

CLI 为 skill 和自动化提供只读检查命令：

```bash
openspec-workspace project inspect /absolute/path/to/project --json
openspec-workspace project list
openspec-workspace project verify
openspec-workspace project verify <name>
openspec-workspace project sync-branch <name>
```

`project inspect` 只报告已经验证的 Git 事实和文件存在事实，不推断项目类型、技术栈、代码归属或 context，也不会修改工作区文件。

`project verify` 不带名称时校验整个注册表；`project verify <name>` 只校验选中项目及其参与的配置冲突，因此其他项目的分支漂移不会阻断定向工作。

底层注册命令必须接收由用户或 skill 生成的完整项目记录：

```bash
openspec-workspace project add --projects-file /path/to/projects.json --yes --json
```

项目记录格式：

```yaml
schemaVersion: 1
workspace:
  name: openspec-workspace
  uuid: 123e4567-e89b-42d3-a456-426614174000
  language: zh-CN
monitor:
  enable: false
  url: http://127.0.0.1:3211
projects:
  - name: xxx-management
    specPrefix: xxx-management
    location: /absolute/path/to/xxx-management
    branch: release/1.0.0
    type: backend
    context: |
      职责：Xxx 产品的管理后端，提供管理和业务编排能力。
      技术栈：Java 8、Spring Boot、Maven、MySQL、Redis。
      代码定位：应用代码位于 src/main/java，接口层位于 controller，业务逻辑位于 service。
      项目边界：负责服务端规则和数据访问。
```

`type` 和 `context` 是由用户或 skill 提供的语义字段。CLI 只负责校验和存储，不负责推断。`context` 仍然可以是任意非空文本；托管的 add-projects skill 会先运行 `openspec-workspace language --json`，使用标准结果信封中的 `data.projectContext` 标签，再以 `data.language` 生成四行简洁内容。短文案统一存放在 `src/i18n/locales`；长篇用户指南继续使用独立 Markdown 文件。

可以使用以下命令查询 OpenSpec 产物和新生成项目 context 使用的语言：

```bash
openspec-workspace language
openspec-workspace language --json
```

### 修改工作区语言

如果初始化时选择了中文，之后希望改为英文，请在工作区根目录运行：

```bash
openspec-w update --language en-US
```

该命令会更新 `.openspec-workspace/config.yaml` 中的 `workspace.language`，派生更新 `openspec/config.yaml` 中的 `Language: en-US`，并切换托管的 `USER_GUIDE.md`。如果任何托管文件包含未知本地修改，所有内容均保持不变，命令会提示检查文件或明确使用 `--force` 重试。可以使用以下命令确认结果：

```bash
openspec-w language
openspec-w language --json
openspec-w doctor
```

新的语言设置适用于之后生成的 OpenSpec proposal、spec、design、tasks，以及后续通过 add-projects 生成的 Project context。已经存在的 OpenSpec 产物和 Project context 不会自动翻译。Monitor 语言与 Workspace language 相互独立，仍需在 Monitor 页面中手动选择。

## Agent 监控

Monitor 是全局服务，不归属于、不配置于、也不耦合到任何单独工作区。可以从任意目录启动；单个进程能够接收多个工作区的事件，按 UUID 隔离，并展示可读名称：

```bash
openspec-w monitor
```

打开命令输出的地址（默认为 `http://127.0.0.1:3211/`）即可使用内置实时面板。页面展示汇总计数、工作区与会话导航、轮次状态、工具活动和实时事件流。

服务只监听 `127.0.0.1:3211`。若端口被占用，请选择其他端口，并在所有参与工作区的本地 `.openspec-workspace/config.yaml` 中配置相同基础 URL：

```bash
openspec-w monitor -p 8080
```

```yaml
monitor:
  enable: true
  url: http://127.0.0.1:8080
```

可以在 `init` 时交互启用此功能，也可以用 `--monitor` 非交互启用。托管的 `.codex/hooks.json` 会向 `/api/v1/events` 上报生命周期元数据；提示词文本、工具输入、响应和 transcript 均会排除。上报采用较短超时并遵循故障开放原则，因此 Monitor 不可用时不会阻塞编码。项目 Hook 需要信任，初始化后请在 Codex 中通过 `/hooks` 检查并启用。

### 未来功能：远程授权

从 Monitor 批准或拒绝 Codex 权限请求的功能有意延后。该功能需要稳定的双向 Codex 控制协议、到来源工作区及会话的精确路由、完整展示请求理由和实际命令或权限范围，并防止过期或重复决策。实施前还必须验证所支持的 Codex 版本、Codex CLI 与 Codex App 行为，以及 macOS、Windows 和 Linux 平台差异。在满足这些兼容性和安全要求之前，Monitor 只记录授权事件并提供可选声音提示。

只读 API 包括 `/api/v1/health`、`/api/v1/snapshot`、`/api/v1/workspaces`、`/api/v1/events` 和 `/api/v1/stream`（SSE）。数据保存在内存中，服务停止时会重置。

## OpenSpec 工作流

```bash
openspec new change add-feature
openspec-workspace change validate add-feature
openspec-workspace context --change add-feature
```

工作区流程要求：

- 提案的 `Affected Projects` 条目使用本地项目名称；
- capability ID 使用 `<specPrefix>-<local-capability>`；
- 任务组使用 `## <n>. <project-name>:` 标题；
- `Cross-project` 组只包含协调工作，不包含无归属的生产代码修改。

## Claude 与 Codex

OpenSpec 使用 `opsx` 前缀安装原生 Claude 命令：

```text
/opsx:explore
/opsx:propose
/opsx:apply
/opsx:sync
/opsx:archive
```

OpenSpec Workspace 只增加多项目扩展：

```text
/opswx:add-projects
```

初始化还会从同一个规范模板安装精简的英文工作空间守卫指令：选择 Claude 时安装 `CLAUDE.md`，选择 Codex 时安装 `AGENTS.md`。它们明确根目录是工作空间而不是生产工程，要求按注册信息选择项目并进行定向校验，同时禁止直接修改本地工作空间状态。旧版本中未修改的托管 `AGENT.md` 会在 update 时安全迁移；修改过或来源未知的文件仍受保护。

原生 OpenSpec 技能继续使用 `openspec-*` 命名；精简的版本化补丁只为 explore、propose、apply 和 archive 增加多项目守卫，不接管 OpenSpec 的生命周期。守卫仅选择并定向校验相关项目，通过 `openspec-workspace context --change <name> --json` 解析 apply 位置，保留带项目前缀的 capability，并强制执行项目归属的实施边界。它们不会直接修改 Workspace 注册表，也不会内嵌 Git 分支恢复：Claude 和 Codex 安装的 `openspec-workspace-resolve-branch` 统一负责 `PROJECT_BRANCH_MISMATCH` 的显式安全恢复。`workspace-workflow` 只适用于仓库本地 planning home；独立 OpenSpec store 不会隐式绑定到当前 Workspace 注册表。

模板与补丁输出使用相同的托管文件状态机，其中包括由 `config-yaml.patch` 生成的版本化 `openspec/config.yaml`。只有当目标文件匹配期望指纹、上次安装指纹或显式声明的上游基线时，才能被替换。未知修改会在写入任何目标之前终止整个批次。经审查的补丁保存在 `artifacts/patches`；发布检查会证明：将补丁应用到锁定的 OpenSpec 基线后，结果与运行时打包的完整输出一致。当 OpenSpec 重新生成原生资源后，可运行 `openspec-workspace update` 恢复托管输出。

## 命令

| 命令 | 用途 |
| --- | --- |
| `init [path]` | 创建本地配置并安装托管资源；`path` 默认是当前目录 |
| `monitor [-p PORT]` | 运行全局多工作区 Agent Monitor |
| `update` | 更新托管的 Claude、Codex 和 OpenSpec 资源 |
| `language` | 输出当前工作区语言（`en-US` 或 `zh-CN`） |
| `project inspect/add/remove/list/show/verify [name]/sync-branch` | 检查和管理本地 Git worktree，校验全部项目或单个选中项目，并将实际 worktree branch 同步到注册信息 |
| `change validate <name>` | 校验单个变更的项目和 capability 归属 |
| `context` | 输出工作区、项目或变更上下文 |
| `sync` | 同步 Codex 可写根目录 |
| `validate` | 校验项目、规格和所有活动变更 |
| `doctor` | 报告本地工作区健康状态 |

校验和查询命令支持 `--json`。当用户明确希望覆盖本地修改过的生成资源时，托管文件更新命令支持 `--force`。

## 开发

```bash
npm install
npm test
npm run patches:check
npm run pack:check
```

该软件包要求 Node.js 20.19 或更高版本。
