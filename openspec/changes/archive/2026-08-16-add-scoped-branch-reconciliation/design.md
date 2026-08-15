## Context

Code Workspace 当前在项目记录中保存 `branch`，并通过 Git worktree 读取当前分支。`project verify <name>` 能报告二者不一致，`project sync-branch` 能将实际分支写回注册表；但反方向仍由 Agent 直接运行 `git switch`。现有分支 Skill 因此同时承担事实收集、安全判断、用户询问和外部变更，无法由 CLI 统一保证确认、并发检查、后置验证与恢复。

定向校验还通过“全量校验后过滤诊断”实现，导致 `project verify <name>` 实际检查每个已注册仓库。这个实现与 Agent 只关注目标项目的要求冲突，也使无关仓库的缺失、权限或 Git 状态进入当前操作路径。

本变更必须遵守既有 CLI 架构：命令在注册表中声明完整合同，命令层只负责计划、确认、事务编排和结果构建，原始 Git 与配置持久化由核心 API 负责；外部 Git 效果必须验证，并在无法补偿时明确报告保留效果。实施期间先完成 CLI 和核心测试，再允许托管 Skill 引用新命令。

## Goals / Non-Goals

**Goals:**

- 在任何新能力实现前，先把现有分支比较、诊断、计划和结果统一为 `registeredBranch`（Workspace 期望状态）与 `actualBranch`（Git 观测状态）。
- 提供分支状态检查、注册表接受实际分支、项目使用注册分支三条方向明确的 CLI 命令。
- 对 Workspace 文件写入和外部 Git 切换分别应用合适的确认、并发检查、验证和恢复模型。
- 保证定向校验与分支命令只检查命名项目，不访问其他项目仓库。
- 让 Workspace Guard 负责简洁的不变量，让分支 Skill 负责固定询问和 CLI-only 状态机。
- 通过任务依赖保证 CLI 能力和测试先于 Skill、模板及文档迁移完成。

**Non-Goals:**

- 不自动判断注册分支或实际分支哪一个更正确。
- 不创建、下载、合并或删除 Git 分支，不执行 fetch、stash、reset、commit 或 checkout 远端分支。
- 不支持脏工作树上的自动切换，也不替用户解决冲突。
- 不改变工作区级 `project verify`、`doctor` 的显式全量检查语义。
- 不扩展为多项目批量分支协调；多个项目必须由用户显式纳入范围并逐个处理。

## Decisions

### 1. 第一实施阶段统一为 registeredBranch 和 actualBranch

所有现有和新增 CLI、诊断、计划、结果与 Agent 文案使用以下两个规范分支词根：

- `registeredBranch`：项目记录中的期望分支；
- `actualBranch`：目标 worktree 当前检出的实际分支；
- `matches`：二者是否相等；
- `worktreeClean`：目标 worktree 是否无未提交变更；
- `registeredBranchExists`：注册分支是否作为本地分支存在。

配置持久化键 `projects[].branch` 保持不变，以避免无必要的配置 schema 迁移；加载项目记录后，任何分支比较或公共输出必须显式映射为 `registeredBranch: project.branch`。低层 Git 检查结果中的原始 `branch` 同样必须在进入领域状态时映射为 `actualBranch`。

状态随时间变化时不创造第三套分支名，而是使用统一容器：

```json
{
  "before": {
    "registeredBranch": "main",
    "actualBranch": "feature/work"
  },
  "after": {
    "registeredBranch": "feature/work",
    "actualBranch": "feature/work"
  }
}
```

并发和后置验证失败使用 `expectedState`、`observedState`，两个状态对象内部仍只允许 `registeredBranch` 与 `actualBranch`。现有字段按以下方式迁移：

| 现有字段 | 迁移后表达 |
| --- | --- |
| `configuredBranch` | `registeredBranch` |
| `previousBranch` | `before.registeredBranch` |
| `expectedBranch` | `expectedState.registeredBranch` |
| `requestedBranch` | `expectedState.registeredBranch` 或 `expectedState.actualBranch`，按被验证状态填写 |
| `savedBranch` | `observedState.registeredBranch` |

`PROJECT_BRANCH_MISMATCH` 的诊断详情固定返回 `registeredBranch`、`actualBranch` 和 `location`，不再返回 `configuredBranch`。`project branch inspect` 返回规范字段、`matches`、`worktreeClean`、`registeredBranchExists` 和目标项目身份，但不返回其他项目记录或无关工作树详情。

不使用“正向”“反向”“同步到”“配置分支”“预期 Git 分支”等替代话术。中文统一为“注册分支/实际分支”，英文统一为 “registered branch/actual branch”。

替代方案是重命名配置键 `projects[].branch`。这会要求配置 schema 升级和历史 Workspace 迁移，却不会改善运行时方向判断，因此不采用。另一个替代方案是只让新命令使用规范字段、保留旧诊断字段；这会永久形成两套公共合同，因此也不采用。

### 2. 分成三条命令，而不是一个带方向参数的命令

三条命令合同如下：

```yaml
command: project branch inspect
workspace: required
config: [projects]
interaction: never
effects: read-only
arguments:
  - name: name
    required: true
options: {}
writes: []
verification:
  - 只从注册表解析命名项目并检查该项目的 Git 状态
rollback: N/A
```

```yaml
command: project branch accept-actual
workspace: required
config: [projects]
interaction: required
effects: planned-write
arguments:
  - name: name
    required: true
options:
  yes: boolean
writes:
  - .code-workspace/config.yaml 中命名项目的注册分支
verification:
  - 持久化注册分支等于计划中的实际分支
  - 目标项目实际分支在提交前未变化
rollback:
  - 恢复命令前的 config.yaml
```

```yaml
command: project branch use-registered
workspace: required
config: [projects]
interaction: required
effects: external
arguments:
  - name: name
    required: true
options:
  yes: boolean
writes:
  - 命名项目 Git worktree 和 HEAD
verification:
  - 实际分支等于注册分支
  - 工作树在切换后仍为干净状态
rollback:
  - 失败后尝试切回计划中的原实际分支
  - 补偿失败时报告 retained external effect 和人工恢复信息
```

单一 `project branch reconcile --direction ...` 无法在注册表中准确声明 `planned-write` 与 `external` 两种效果，也会混淆两条不同的恢复路径，因此不采用。

### 3. 新建独立分支命令模块和核心服务

注册表支持任意长度命令路径，因此新增三段式命令无需修改解析规则。分支命令路由到独立的 `src/cli/commands/project-branch.js`，并在通用 `project` 路由之前匹配；稳定结果命令名分别为 `project.branch.inspect`、`project.branch.accept-actual`、`project.branch.use-registered`。

核心层提供目标项目分支状态检查和安全切换 API。核心 API 封装 `git status --porcelain`、本地分支存在性和 `git switch`，命令层不得直接执行 Git 或持久化配置。现有定向配置更新 API 继续负责并发比较与原子写入。

替代方案是在现有 `project.js` 中继续增加分支分支处理。该文件已经同时处理项目输入、权限和验证，继续扩张会弱化命令边界，因此不采用。

### 4. 两种变更使用不同的故障模型

`accept-actual` 复用文件事务：计划的 `before` 状态记录 `registeredBranch` 和 `actualBranch`，确认后以 `before.registeredBranch` 作为并发条件更新配置，再重新读取配置和目标 Git 状态；成功结果返回只包含规范字段的 `before`/`after`，任一验证失败均恢复配置并返回 `expectedState`/`observedState`。

`use-registered` 在确认前要求工作树干净且注册本地分支存在。确认后重新检查完整计划指纹，状态漂移则在任何 Git 变更前失败。切换成功后验证分支和干净状态；后续失败时尝试切回原实际分支。补偿成功则报告操作失败但无保留效果；补偿失败则通过现有 retained-effect 结构报告目标项目、原分支、观测分支和人工恢复建议。

CLI 的 `--yes` 只表示命令确认已由调用方完成，不替代 Agent 在分支不一致时取得用户的明确方向选择。

### 5. 定向校验采用直接目标算法

`validateProject` 不再调用 `validateProjects`。它只：

1. 校验项目数组和命名项目记录；
2. 检查与目标有关的重复名称，以及基于注册表路径元数据可判定的重复或嵌套冲突；
3. 只对目标 `location` 调用 Git worktree 检查；
4. 只返回目标相关诊断。

其他项目的注册表记录可以作为冲突比较元数据读取，但不得对其路径执行 `realpath`、Git 命令或文件系统探测。显式的无参数 `project verify` 继续调用全量算法。

这一设计依赖项目注册时保存规范绝对路径；如果未被 CLI 管理的手工配置使其他路径元数据失真，定向校验可能无法发现涉及符号链接的跨项目冲突，全量校验仍负责发现此类全局问题。

### 6. Guard 与 Skill 分层，并固定询问模板

`WORKSPACE_GUARD` 只声明角色、选中项目范围、定向校验门禁、Workspace 写边界和分支 Skill 入口。用户已经指定注册项目时直接 `project show <name>`；只有项目归属无法确定时才 `project list`，且列表只用于选择。项目一旦选定，AI 不得读取、验证或修改未纳入用户请求的工程。

双语 `USER_GUIDE` 只保留用户可调用的分支 Skill 入口。`project branch` 命令、规范字段、迁移合同、安全前置条件、验证和恢复模型属于 CLI 与 Agent 的实现细节，只在 README、流程文档、Guard 和 Skill 中维护，不进入用户指南。

分支 Skill 使用 `project branch inspect` 获取事实，并按下列固定结构询问；只允许替换占位符和按 CLI 状态填写可用性，不得省略事实、重命名方向或默认推荐一侧：

```text
Project branch mismatch detected. Project work is paused.

Project: {projectName}
Location: {projectLocation}
Registered branch (Code Workspace expected state): {registeredBranch}
Actual branch (Git checked-out state): {actualBranch}
Worktree: {clean|dirty}
Registered branch available locally: {yes|no}

Choose exactly one:
1. Use the registered branch.
   Effect: switch the project from {actualBranch} to {registeredBranch};
   the Code Workspace registry does not change.
   Availability: {available|unavailable: reason}
2. Accept the actual branch.
   Effect: update the registered branch from {registeredBranch} to
   {actualBranch}; the project worktree does not change.
3. Resolve manually.
   Effect: project work remains paused until you finish and confirm.

Reply with 1, 2, or 3. No Git or Workspace state will change before your choice.
```

用户选择 1 或 2 后，Skill 才能分别调用带 `--yes --json` 的 CLI。命令失败时报告诊断并停止，不得回退到原始 Git 或配置编辑。处理结束后只运行 `project verify <name> --json`，不重新列出或校验所有项目。

### 7. 采用明确的破坏性迁移

移除 `project sync-branch` 注册与文档引用，不提供隐藏别名。当前包仍处于 beta，清晰合同优先于保留容易误解的入口。解析器必须在 Workspace 发现和配置加载前将旧命令报告为未知命令。

实施门禁按顺序执行：先迁移现有分支术语、公共诊断和结果测试；然后完成核心 API、新 CLI、定向校验和全部 CLI 测试；仅在这些检查通过后修改 Guard、Skill、README 和流程图，并确认用户指南仍停留在 Skill 入口层。最后统一运行架构检查、完整测试和打包检查。

## Risks / Trade-offs

- [外部 Git 切换无法像文件写入一样保证原子回滚] → 仅允许干净 worktree，验证后尝试补偿切回；补偿失败时报告保留效果和人工恢复信息。
- [移除旧命令会影响已有脚本] → 在 README、流程文档和发布说明中提供一一对应迁移命令，并用真实解析器校验所有新引用；不把脚本迁移合同扩散到用户指南。
- [定向校验不探测无关路径可能遗漏手工配置造成的符号链接冲突] → 保留显式全量校验作为全局健康检查，项目注册和更新继续规范化路径。
- [固定询问模板可能显得冗长] → 只在 `PROJECT_BRANCH_MISMATCH` 时使用，并限制为六个事实字段和三个选择，换取稳定、可审计的用户授权。
- [三段式命令增加路由和补全层级] → 使用独立命令模块并扩展现有通用注册表/补全测试，不修改解析架构。

## Migration Plan

1. 在实现任何新命令前，统一现有分支领域状态、`PROJECT_BRANCH_MISMATCH` 诊断、配置并发详情和旧分支计划/结果为 `registeredBranch`、`actualBranch` 及规范状态容器，并先迁移相关测试。
2. 实现安全分支状态服务和真正定向的项目校验，保持现有 Agent 资产不变。
3. 注册并实现三条新 CLI 命令；在迁移窗口内暂时保留旧命令，以便现有托管资产仍可被完整测试。
4. 新命令的核心、CLI、确认、故障恢复和定向作用域测试通过后，才开始修改 Guard 与分支 Skill，使其只引用已经可用的新命令和规范术语。
5. 迁移 README、流程图和托管资产断言，保持用户指南只暴露分支处理 Skill；然后移除旧 `sync-branch` 注册、处理逻辑与测试引用，并验证旧命令成为未知命令。
6. 运行 `node scripts/check-cli-architecture.js`、`npm test` 和 `npm run check`。若发布前需要回退，恢复旧版本整体资产和 CLI；不发布新 Skill 引用未注册 CLI、保留旧字段或最终版本仍暴露旧命令的中间状态。

## Open Questions

无。
