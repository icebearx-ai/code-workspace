# OpenSpec Workspace 执行流程

本文描述 Level A 之后的职责边界：Workspace 管理多项目注册表和 Agent 安全集成；已有 `openspec/` 记录仅作为只读输入。

## 核心原则

- Workspace 不安装、检测或调用其他 OpenSpec CLI。
- Workspace 不创建、更新或归档 `openspec/` 下的记录。
- `openspec/` 中已有 proposal 与 spec 可用于上下文解析和一致性校验。
- Workspace 的写入范围是 `.openspec-workspace/`、Workspace 自有 Agent 集成、Codex hook 与权限配置。
- 项目生产代码只允许在已注册项目的 `location` 中修改；Workspace CLI 自身不执行生产代码修改。

## 初始化和维护流程

```mermaid
flowchart TD
    I[init] --> N[校验 Node.js 与发布清单]
    N --> T[确定 Claude Code / Codex 选择]
    T --> O[清理旧版本中有指纹记录的废弃资产]
    O --> M[安装 Workspace 自有模板、命令和 Skill]
    M --> C[写入本地 Workspace 配置]
    C --> P[同步 Codex 可写目录权限]
    P --> D[严格 Doctor]
    D --> S[提交 Workspace state]

    U[update] --> OP[规划托管文件与废弃资产]
    OP --> SAFE{存在未知本地修改?}
    SAFE -- 是 --> STOP[写入前停止]
    SAFE -- 否 --> APPLY[原子更新 Workspace 自有资产]
    APPLY --> VERIFY[验证完整后置条件]
    VERIFY --> COMMIT[提交新 release state]
```

初始化和更新都不会创建 `openspec/`。若旧 state 曾记录原生工作流文件或 Workspace schema 副本，只有内容仍匹配安装指纹时才删除；`openspec/config.yaml` 仅解除旧托管关系，文件内容保持不变。

## 项目注册流程

```mermaid
flowchart TD
    A[显式项目路径] --> I[project inspect 只读检查]
    I --> R[用户或 Skill 补全项目记录]
    R --> V[批量校验名称、specPrefix、真实路径和 Git 分支]
    V --> Q{确认写入?}
    Q -- 否 --> X[不修改]
    Q -- 是 --> W[原子更新 Workspace 配置]
    W --> P[同步 Codex writable_roots]
    P --> Z[重新加载并验证]
```

关键命令：

```bash
openspec-workspace project inspect /absolute/path/to/project --json
openspec-workspace project add --projects-file projects.json --yes --json
openspec-workspace project list --json
openspec-workspace project verify "<project-name>" --json
```

Claude Code 使用 `/opswx:add-projects`；Codex 使用 `$openspec-workspace-add-projects`。两者都要求用户给出显式路径，不得根据对话猜测。

## 已有变更记录的只读流程

```mermaid
flowchart TD
    C[已有 openspec/changes/name/proposal.md] --> P[解析 Affected Projects]
    P --> L[与 Workspace 项目注册表匹配]
    L --> V[只验证参与项目]
    V --> B{项目分支匹配?}
    B -- 否 --> E[PROJECT_BRANCH_MISMATCH]
    B -- 是 --> X[返回受影响项目上下文]
    X --> S[可选：验证主规格映射]
```

```bash
openspec-workspace context --change "<change-name>" --json
openspec-workspace change validate "<change-name>" --json
openspec-workspace change validate "<change-name>" --require-main-specs --json
```

这些命令不会改写 proposal、spec、tasks 或 archive。记录的创建和生命周期由用户选择的外部流程负责。

## 分支不一致恢复

```mermaid
flowchart LR
    M[PROJECT_BRANCH_MISMATCH] --> I[检查当前分支和 worktree]
    I --> C{用户明确选择}
    C -->|接受当前分支| CLI[project sync-branch]
    C -->|自行切换或修复| MANUAL[人工处理 Git]
    CLI --> V[project verify]
    MANUAL --> V
    V -->|通过| CONTINUE[刷新 context 后继续]
    V -->|失败| STOP[保持停止]
```

```bash
openspec-workspace project sync-branch "<project-name>" --yes --json
```

`project sync-branch` 只接受仓库当前分支并更新注册表，不执行 `git switch`。

## 责任边界

| 层次 | 负责内容 |
| --- | --- |
| Workspace CLI | 项目注册表、定向验证、只读 change/spec 解析、权限、Doctor、监控 |
| Workspace Agent 集成 | 显式添加项目、分支不一致恢复引导 |
| 用户或外部工具 | `openspec/` 记录的创建、编辑、同步、归档和删除 |
| 各项目仓库 | 生产代码、测试、构建和 Git 分支操作 |

## 不变量

- 不得猜测项目路径、项目归属或分支。
- 不得直接编辑 `.openspec-workspace/config.yaml`；通过 CLI 写入。
- 不得把独立的 `openspec/` 存储隐式绑定到 Workspace。
- Workspace 初始化、更新和 Doctor 不依赖其他 OpenSpec 包或可执行文件。
- Workspace 不主动写入 `openspec/`。
