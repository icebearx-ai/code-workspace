# OpenSpec Workspace 用户指南

这是一份在初始化完成后，使用 OpenSpec Workspace 和 OpenSpec 的简明指南。

## 实用 Skills

### 添加工作区项目

Codex：

```text
$openspec-workspace-add-projects /absolute/path/to/project-a /absolute/path/to/project-b
```

Claude Code：

```text
/opswx:add-projects /absolute/path/to/project-a /absolute/path/to/project-b
```

根据提示检查项目记录并确认。

add-projects skill 会运行 `openspec-workspace language --json`，使用标准结果信封中的 `data.projectContext` 标签，并以 `data.language` 生成项目 context。OpenSpec 指令本身始终使用英文；`openspec/config.yaml` 中的 `Language` 值控制 OpenSpec 生成产物的语言。

## 升级 OpenSpec Workspace

如果需要升级 openspec-workspace，先升级全局软件包，再更新当前工作区的托管文件，最后检查健康状态：

```bash
npm install -g @icebearx-ai/openspec-workspace@latest
openspec-w update
openspec-w doctor
```

`update` 会更新托管指令、技能、Hook、Schema 和本指南。如果托管文件包含未知的本地修改，更新会停止。请先检查文件；只有明确要覆盖这些修改时才使用 `--force`。

当新版本要求切换 OpenSpec 版本时，重新运行 `init`，检查其计划后再确认：

```bash
openspec-w init
```

可以在初始化时选择 OpenSpec 生成产物的语言，也可以显式指定：

```bash
openspec-w init --language zh-CN
openspec-w language
```

所选偏好保存在 `.openspec-workspace/config.yaml` 的 `workspace.language`。已有工作区可通过以下命令切换语言：

```bash
openspec-w update --language zh-CN
```

该操作也会切换本托管指南。已有 OpenSpec 产物和已有项目 context 不会自动翻译。如果托管文件包含本地修改，update 会保持语言偏好和所有文件不变，并提示明确使用 `--force` 重试。

## 使用 Agent Monitor

为所有工作区启动一个全局 Monitor：

```bash
openspec-w monitor
```

打开命令输出的本地地址。面板会显示工作区、执行状态、待授权请求、已完成轮次和实时信号。声音提醒默认开启。

Monitor 的语言在面板页面中手动选择。该设置保存在浏览器中，与 `workspace.language` 相互独立；Monitor i18n 不由 CLI 的工作区语言设置管理。

必要时可使用其他端口：

```bash
openspec-w monitor --port 8080
```

所有参与监控的工作区都必须在 `.openspec-workspace/config.yaml` 中使用相同 URL：

```yaml
monitor:
  enable: true
  url: http://127.0.0.1:8080
```

初始化后，请在 Codex 中使用 `/hooks` 检查并信任项目 Hook。授权决策仍需在来源 Codex CLI 或 Codex App 中完成。

## 实用命令

### 维护与诊断

```bash
# 检查安装和工作区健康状态
openspec-w doctor

# 更新所有托管文件
openspec-w update

# 同步 Codex 可写项目根目录
openspec-w sync
```

当校验或查询结果需要交给 Codex 或脚本处理时，可添加 `--json`。

### 变更与校验

```bash
# 校验单个变更的项目归属和任务结构
openspec-w change validate <change-name>

# 输出一个变更的准确项目上下文
openspec-w context --change <change-name>

# 校验项目、规格和所有活动变更
openspec-w validate
```

## OpenSpec 变更状态流转

（以 Codex 为例）

```text
┌──────────────┐
│ 新需求       │
└──────┬───────┘
       ├── 需求明确，直接提案 ────────────┐
       │                                  │
       ▼                                  │
┌────────────────────────────┐            │
│ 探索（可选）               │            │
│ $openspec-explore          │            │
└─────────────┬──────────────┘            │
              │ 明确需求                  │
              ▼                           │
┌────────────────────────────┐ ◀──────────┘
│ 提案                       │
│ $openspec-propose          │
└─────────────┬──────────────┘
              │ 生成
              ▼
┌────────────────────────────┐
│ 规格 · 设计 · 任务         │
└─────────────┬──────────────┘
              │ 准备完成
              ▼
┌────────────────────────────┐
│ 实施                       │
│ $openspec-apply-change     │
└─────────────┬──────────────┘
              │ 实施完成
              ▼
┌────────────────────────────┐
│ 校验                       │
│ 测试 + 审查                │
└─────────────┬──────────────┘
              │ 全部通过
              ▼
┌────────────────────────────┐
│ 归档                       │
│ $openspec-archive-change   │
└────────────────────────────┘
```

### Skill 用途

- `$openspec-explore` — 在正式创建变更前探索问题、约束和受影响项目。该步骤可选，不要求一定生成制品。
- `$openspec-propose` — 创建变更提案以及所需的规格、设计和任务制品，使变更达到可实施状态。
- `$openspec-apply-change` — 按任务在归属的工作区项目中实施，并确保修改不超出声明的项目边界。
- `$openspec-sync-specs` — 将变更中的规格增量同步到主规格，但不归档该变更。
- `$openspec-archive-change` — 校验已完成的变更，更新主规格，并将变更移入归档。
- `$openspec-workspace-add-projects` — 检查并注册本地 Git 项目，同时生成供 AI 导航使用的简洁 context。
- `$openspec-workspace-resolve-branch` — 安全解决选中项目的注册分支与实际分支不一致问题，并重新执行定向校验。

### Claude Code 对应命令

本指南以 Codex Skill 名称作为主要表达。在 Claude Code 中，请使用对应的 Slash Command：

| 用途 | Codex | Claude Code |
| --- | --- | --- |
| 探索 | `$openspec-explore` | `/opsx:explore` |
| 提案 | `$openspec-propose` | `/opsx:propose` |
| 实施 | `$openspec-apply-change` | `/opsx:apply` |
| 同步规格 | `$openspec-sync-specs` | `/opsx:sync` |
| 归档 | `$openspec-archive-change` | `/opsx:archive` |
| 添加工作区项目 | `$openspec-workspace-add-projects` | `/opswx:add-projects` |
| 解决工作区项目分支不一致 | `$openspec-workspace-resolve-branch` | `/openspec-workspace-resolve-branch` |
