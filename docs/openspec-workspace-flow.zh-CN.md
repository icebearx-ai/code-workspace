# OpenSpec Workspace 执行流程

本文描述 Workspace 的职责边界：管理多项目注册表和 Agent 安全集成，并与原生 OpenSpec 实现保持解耦。

## 核心原则

- Workspace 不安装、检测或调用其他 OpenSpec CLI。
- Workspace 不读取、创建、更新或归档 `openspec/` 下的记录。
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

初始化和更新都不会创建或修改 `openspec/`；该目录中的已有记录始终由用户或外部工具负责。

## 项目注册流程

```mermaid
flowchart TD
    A[显式项目路径] --> I[project inspect 只读检查]
    I --> R[用户或 Skill 补全项目记录]
    R --> V[批量校验名称、真实路径和 Git 分支]
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
| Workspace CLI | 项目注册表、项目验证、权限、Doctor、监控 |
| Workspace Agent 集成 | 显式添加项目、分支不一致恢复引导 |
| 用户或外部工具 | `openspec/` 记录的创建、编辑、同步、归档和删除 |
| 各项目仓库 | 生产代码、测试、构建和 Git 分支操作 |

## 不变量

- 不得猜测项目路径、项目归属或分支。
- 不得直接编辑 `.openspec-workspace/config.yaml`；通过 CLI 写入。
- 不得把独立的 `openspec/` 存储隐式绑定到 Workspace。
- Workspace 初始化、更新和 Doctor 不依赖其他 OpenSpec 包或可执行文件。
- Workspace 不读取或写入 `openspec/`。
