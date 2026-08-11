# OpenSpec Workspace 执行流程

以下流程以 `workspace-workflow` 为例。

核心原则：

- OpenSpec 管理 proposal、spec、design、tasks、apply、sync 和 archive 生命周期。
- OpenSpec Workspace 负责多项目选择、项目边界、定向验证和安全恢复。
- 普通 `spec-driven` schema 直接执行原生 OpenSpec 工作流。

## 完整执行流程

```mermaid
flowchart TD
    U[用户提出需求] --> P[调用 propose<br/>Claude Command / Claude Skill / Codex Skill]

    subgraph PROPOSE[1. Propose：建立变更]
        P --> N[OpenSpec 创建 change]
        N --> S[OpenSpec status<br/>解析 schemaName、planningHome、actionContext]
        S --> W{schemaName 是<br/>workspace-workflow?}

        W -- 否 --> NP[执行原生 OpenSpec 工作流]
        W -- 是 --> R{Repo-local planningHome<br/>且等于 Workspace root?}

        R -- 否 --> STOP1[停止<br/>禁止将 standalone store<br/>隐式绑定到 Workspace]
        R -- 是 --> PL[Workspace project list]
        PL --> SEL[从注册表选择受影响项目]
        SEL --> PV[逐项目 project verify 项目名]
        PV --> BM{分支匹配?}

        BM -- 否 --> BR[调用共享 resolve-branch Skill]
        BR --> PV
        BM -- 是 --> PC[读取 project context]

        PC --> ART[OpenSpec 生成制品<br/>proposal → specs → design → tasks]
        ART --> RULES[执行项目所有权约束<br/>specPrefix / 项目任务组 / Cross-project]
    end

    ART --> A[调用 apply]

    subgraph APPLY[2. Apply：实施任务]
        A --> AS[OpenSpec status]
        AS --> AR[验证 repo-local root]
        AR --> CV[Workspace change validate<br/>只验证参与项目]
        CV --> AC[Workspace context --change<br/>只返回受影响项目]
        AC --> AI[OpenSpec instructions apply]

        AI --> TASK{还有未完成任务?}

        TASK -- 是 --> OWNER[从任务组解析 owning project]
        OWNER --> TPV[project verify owning-project]
        TPV --> TBM{分支匹配?}

        TBM -- 否 --> TBR[调用 resolve-branch Skill]
        TBR --> REFRESH[重新 list / verify<br/>刷新 change context]
        REFRESH --> OWNER

        TBM -- 是 --> EDIT[只在 registered location<br/>修改生产代码]
        EDIT --> TEST[运行项目测试与验证]
        TEST --> DONE[标记任务完成]
        DONE --> TASK

        TASK -- 否 --> READY[实施完成，可以归档]
    end

    READY --> ARC[调用 archive]

    subgraph ARCHIVE[3. Archive：同步与归档]
        ARC --> ACS[OpenSpec status]
        ACS --> ACV[Workspace change validate]
        ACV --> CHECK[检查制品和任务完成状态]
        CHECK --> DELTA{存在 delta specs?}

        DELTA -- 否 --> MOVE
        DELTA -- 是 --> ASK{用户是否同步?}

        ASK -- 否 --> MOVE[OpenSpec 移动 change 到 archive]
        ASK -- 是 --> SYNC[OpenSpec sync-specs<br/>同步到主规格]

        SYNC --> POST[Workspace change validate<br/>--require-main-specs]
        POST --> OK{主规格存在且<br/>唯一映射到项目?}

        OK -- 否 --> STOP2[停止归档<br/>保留 change 供修复]
        OK -- 是 --> MOVE

        MOVE --> END[Archive 完成]
    end
```

## 分支不一致恢复流程

```mermaid
flowchart LR
    M[PROJECT_BRANCH_MISMATCH] --> I[检查当前分支、worktree 状态<br/>以及注册分支是否存在]
    I --> C{用户明确选择}

    C -->|使用注册分支| SAFE{worktree 干净<br/>且本地分支存在?}
    SAFE -- 是 --> GS[git switch 注册分支]
    SAFE -- 否 --> MANUAL[要求人工处理]

    C -->|接受当前分支| CLI[project sync-branch<br/>通过 CLI 原子更新注册表]
    C -->|人工处理| MANUAL

    GS --> V[定向 project verify]
    CLI --> V
    MANUAL --> V

    V -->|ok: true| CONTINUE[刷新 context 后继续]
    V -->|失败| STOP[保持停止状态]
```

## 责任边界

| 层次 | 负责内容 |
| --- | --- |
| OpenSpec | change、proposal、spec、design、tasks、apply、sync、archive |
| Workspace CLI | 项目注册表、定向验证、change ownership、主规格后置检查 |
| Resolve-branch Skill | 用户确认、Git 安全检查、分支恢复 |
| OpenSpec 补丁 | 串联上述能力并限制生产代码编辑范围 |

## 关键命令

### 项目发现

```bash
openspec-workspace project list --json
```

### 项目定向验证

```bash
openspec-workspace project verify "<project-name>" --json
```

### Change 验证

```bash
openspec-workspace change validate "<change-name>" --json
```

### 获取 Change 相关项目上下文

```bash
openspec-workspace context --change "<change-name>" --json
```

### 同步后的主规格验证

```bash
openspec-workspace change validate "<change-name>" \
  --require-main-specs \
  --json
```

### 接受项目当前分支

```bash
openspec-workspace project sync-branch "<project-name>" \
  --yes \
  --json
```

## 关键约束

- 不得猜测项目路径、项目归属或分支。
- 不得直接修改 `.openspec-workspace/config.yaml`。
- `PROJECT_BRANCH_MISMATCH` 必须委托给 `openspec-workspace-resolve-branch`。
- apply 只能修改任务所属项目的 registered `location`。
- `Cross-project` 只能包含协调、契约和集成验证任务。
- `workspace-workflow` 只适用于 repo-local planning home。
- standalone OpenSpec store 不会隐式绑定到当前 Workspace。
- 以下 Markdown 标记属于不可翻译的协议字段：
  - `Affected Projects`
  - `Capabilities`
  - `New Capabilities`
  - `Modified Capabilities`
  - `Project`
  - `Capability`
  - `Cross-project`
