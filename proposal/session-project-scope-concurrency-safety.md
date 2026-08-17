# 通过会话项目作用域保障多会话并发安全

## 提案状态

- 状态：Draft
- 关注点：多个 Agent 会话同时运行时的项目写隔离与 worktree 并发保护
- 适用范围：由 Code Workspace 启动和管理的本地 Agent 会话

## 摘要

本提案引入可信的“会话项目作用域”，明确某个 Agent 会话当前可以访问哪些注册项目，以及每个项目是 `read-only` 还是 `read-write`。会话作用域按 Workspace UUID、Agent provider 和 session ID 隔离，不复用 Workspace 级持久目录授权。

仅有作用域记录不足以保证多会话安全。完整方案必须把以下机制绑定为一个授权事务：

1. 会话项目作用域：描述用户批准的项目和访问级别；
2. worktree 写租约：保证同一真实 Git worktree 最多只有一个写会话；
3. Scope Broker：保存 Agent 不可篡改的可信状态，并执行授权和租约协调；
4. 会话启动器：将作用域编译为会话专属执行环境并监管进程生命周期；
5. PreToolUse 策略：快速拒绝明显越界、失效或分支漂移的工具调用；
6. OS 沙箱：保证脚本、构建工具和无法静态理解的 Shell 命令不能写出授权根目录。

本提案要保证的是项目写完整性和多会话写互斥。只读会话与写会话并存时，读取方可能观察到尚未完成的修改；稳定读取视图需要独立 worktree、快照或固定 commit。Codex 本地 `workspace-write` 主要提供写边界，不应在没有更强沙箱或容器时承诺未选项目的读取保密性。

## 背景与问题

Code Workspace 当前维护长期项目注册表，并通过 Agent 配置向已注册项目授予持久目录权限。该模型适合表达：

> 这个 Workspace 长期允许 Agent 使用哪些项目。

它不适合表达：

> 这个 Agent 会话此刻被允许操作哪些项目。

当多个会话同时运行时，持久授权会产生两个问题：

- 选中项目 A 的会话仍可能写入已经持久授权的项目 B 或 C；
- 两个会话可以同时修改同一个 Git worktree，产生覆盖、混合修改或不可预测的验证结果。

Hook 可以在执行前拒绝一部分明显违规的工具调用，但无法可靠证明任意命令的全部副作用，且部分特殊工具路径可能不经过默认 Hook 路径。因此 Hook 只能作为增强型 guardrail，不能单独构成项目写边界。

## 目标

本提案具有以下目标：

- 未建立有效作用域的会话默认没有项目写权限；
- 用户明确批准的项目集合是会话权限上限，不因注册表、依赖关系或 Agent 推理自动扩大；
- 同一真实 Git worktree 同时最多存在一个 `read-write` 会话；
- 多项目写授权以原子事务获取，不产生部分持有或死锁；
- 作用域、租约和批准记录不能被沙箱内的 Agent 直接修改；
- 作用域失效、分支漂移、项目身份变化或租约丢失后，后续写入 fail closed；
- Agent 进程及其子进程退出前，不把写租约重新分配给其他会话；
- Hook 漏判时，OS 沙箱仍阻止越界写入；
- 拒绝结果使用稳定、结构化、可补救的错误合同。

## 非目标

第一阶段不试图解决以下问题：

- 外部编辑器、用户终端或其他不受 Code Workspace 管理的进程对项目的修改；
- 同一 Codex 会话内多个子 Agent 之间的文件级编辑协调；
- 分布式主机之间的租约一致性；
- 自动合并两个会话的修改；
- 为只读项目提供稳定快照或读取保密性；
- 允许 Agent 通过普通审批提示临时绕过会话作用域；
- 在强沙箱运行期间无重启地动态增加新的可写根目录。

子 Agent 默认继承父会话 ID，因此本提案把一个主会话及其子 Agent 视为同一个授权主体。它可以防止不同会话双写，但不防止同一会话中的两个子 Agent 同时编辑同一文件。未来如果需要该能力，应引入独立 Agent 身份或会话内写入串行化。

## 核心概念

### 项目注册表

项目注册表是 Workspace 的长期控制面，定义可被选择的项目、注册路径和注册分支。注册项目仅表示“有资格被授权”，不表示任意会话自动获得访问权。

### 会话项目作用域

会话项目作用域是用户批准的短期授权记录。其主身份为：

```text
workspace UUID + Agent provider + session ID
```

由于真实 session ID 只能在 Agent 启动后获得，启动阶段还需要一个由可信启动器生成的一次性 `launchTicket`。`SessionStart` 使用该 ticket 将预备作用域绑定到真实 session ID，Agent 不能仅凭自报的 session ID 认领作用域。

### worktree 写租约

写租约以规范化后的 Git worktree `realPath` 为资源键，而不是项目名称、原始路径字符串或 Git 仓库名称。

这意味着：

- 同一路径的符号链接和别名映射到同一个租约；
- 同一个 Git 仓库的两个独立 worktree 可以分别持有写租约；
- 项目改名不会绕过租约；
- 嵌套或重复项目路径必须在作用域激活前被拒绝。

每次重新授予写租约都必须生成单调递增的 fencing token，避免旧 revision 或旧会话在资源重新分配后继续被 Broker 接受。

### Scope Broker

Scope Broker 是可信控制面，负责：

- 保存会话作用域和租约；
- 接收 Agent 的查询和扩展请求；
- 接收可信用户界面的批准或拒绝；
- 原子获取和释放租约；
- 绑定真实 session ID；
- 评估工具调用；
- 记录 revision、fencing token 和审计事件；
- 通知启动器暂停或终止失效会话。

Broker 状态必须位于 Agent 不可写的用户状态目录、受控本地 daemon 内存或其他可信存储中。仅仅把文件放在 `.code-workspace/` 下不能形成可信边界。

Agent 可访问的查询/请求接口与用户批准接口必须分离。`code-w scope request` 只能创建请求，不能通过 `--yes`、环境变量或可伪造的标准输入把请求升级为批准。批准端点应只对沙箱外的 Launcher/UI 管理能力开放。

## 安全不变量

系统必须始终维持以下不变量：

### 不变量 1：默认无写权限

`PENDING`、`SUSPENDED`、`CLOSING`、`CLOSED`、未知或过期的作用域不能执行项目写入。

### 不变量 2：每个 worktree 最多一个写者

对于任意 `worktreeRealPath`，最多只有一个未撤销且绑定到存活受管进程组的 `read-write` 租约。

### 不变量 3：作用域不自动扩大

项目注册、项目依赖、文件引用、构建配置或 Agent 推理均不能增加会话权限。每次增加项目或从只读升级为写入都必须产生新的用户批准和 scope revision。

### 不变量 4：租约与进程生命周期一致

停止心跳、收到 `SessionEnd` 或租约超时只能触发关闭流程，不能立即释放写租约。只有启动器确认受管进程组及其子进程已经退出后，Broker 才能释放租约。

### 不变量 5：目标身份持续有效

每次写入前至少要确认：

- 作用域仍为 `ACTIVE`；
- 当前 scope revision 和 lease fencing token 仍有效；
- 项目仍解析到激活时的真实 worktree；
- 当前分支仍与授权的注册分支一致；
- 目标真实路径位于授权写根内；
- Workspace 控制文件没有被当作普通项目文件写入；
- 当前 permission/sandbox mode 没有绕过托管策略。

工作树变脏是正常开发结果，不得仅因为出现未提交修改就暂停作用域。

### 不变量 6：Hook 不是最终边界

任何声称“强隔离”的会话都必须由 Launcher 使用会话专属 OS 沙箱启动。只安装 Hook、但继续暴露全部持久 `writable_roots` 的会话只能标记为 `advisory`。

## 建议数据模型

```json
{
  "schemaVersion": 1,
  "scopeId": "scope-uuid",
  "workspace": {
    "uuid": "workspace-uuid",
    "registryRevision": "registry-fingerprint"
  },
  "session": {
    "provider": "codex",
    "id": "session-id",
    "launchId": "launch-uuid"
  },
  "projects": [
    {
      "name": "payments",
      "registeredLocation": "/projects/payments",
      "worktreeRealPath": "/projects/payments",
      "access": "read-write",
      "registeredBranch": "main",
      "activationHead": "git-object-id",
      "lease": {
        "mode": "write",
        "fencingToken": 42
      }
    },
    {
      "name": "shared-contracts",
      "registeredLocation": "/projects/shared-contracts",
      "worktreeRealPath": "/projects/shared-contracts",
      "access": "read-only",
      "registeredBranch": "main",
      "activationHead": "git-object-id",
      "lease": {
        "mode": "read"
      }
    }
  ],
  "controlPlane": "read-only",
  "status": "active",
  "revision": 3,
  "issuedAt": "...",
  "expiresAt": "...",
  "approvedBy": {
    "channel": "launcher-ui",
    "eventId": "approval-event-id"
  }
}
```

`activationHead` 用于审计和诊断，不作为持续写入条件。Agent 产生提交或 HEAD 变化是否允许，应由后续 Git 操作策略单独定义；本提案的核心持续条件是 worktree 身份、授权分支、有效租约和目标路径。

## 状态机

```text
PENDING
   │ 用户批准、定向验证成功、原子获取全部租约
   ▼
ACTIVE
   │ 分支漂移、项目身份变化、租约异常、策略失效
   ▼
SUSPENDED
   │ 用户重新确认并重新验证
   └──────────────────────────────▶ ACTIVE

ACTIVE / SUSPENDED / PENDING
   │ 会话结束、超时、用户关闭、Broker 回收
   ▼
CLOSING
   │ 终止并确认整个进程组退出
   ▼
CLOSED
```

租约冲突不应创建一个已经具有写能力的 `SUSPENDED` 会话。请求应保持 `PENDING` 或直接失败，并提供降级只读或创建独立 worktree 的补救建议。

## 并发规则

### 基础兼容矩阵

| 当前状态 | 新建只读会话 | 新建写会话 |
|---|---|---|
| 无租约 | 允许 | 允许 |
| 一个或多个只读租约 | 允许 | 允许，但读取方获得的是实时视图 |
| 一个写租约 | 允许实时读取 | 拒绝、降级只读或使用独立 worktree |

只读与写入并存只保证读取方不会覆盖写入方，不保证读取一致性。需要稳定上下文的只读任务应使用独立 worktree、快照或固定 commit。

### 多项目原子获取

一次会话需要多个 `read-write` 项目时，Broker 必须：

1. 定向验证每一个命名项目；
2. 将所有真实 worktree 键按规范顺序排序；
3. 在单个事务中检查冲突并获取全部租约；
4. 任一项目冲突时不保留任何新写租约；
5. 成功后一次性发布新的 scope revision。

禁止使用“先获取一部分租约、再等待剩余租约”的方式。

## 会话启动流程

建议入口：

```text
code-w agent run payments --tool codex
```

多项目示例：

```text
code-w agent run payments-api payments-web \
  --read-only shared-contracts \
  --tool codex
```

完整流程如下：

1. Launcher 读取 Workspace 身份和项目注册表；
2. 只对显式选择的项目执行定向验证；
3. 解析并记录每个项目的真实 worktree、注册分支和初始状态；
4. Broker 原子获取全部写租约；
5. Broker 创建 `PENDING` 作用域和一次性 launch ticket；
6. Launcher 编译会话专属 Codex profile/sandbox；
7. 以主写项目的 `location` 作为工作目录启动 Codex；
8. `SessionStart` 使用 launch ticket 绑定真实 session ID；
9. Broker 激活作用域并发布 revision；
10. `PreToolUse` 在每次受支持的工具调用前查询当前作用域；
11. OS 沙箱限制实际文件写入范围；
12. 会话结束时 Launcher 终止并等待整个进程组退出；
13. Broker 释放租约并关闭作用域。

如果第 4 至第 9 步任一步骤失败，必须撤销已经获取的租约、关闭预备作用域，并终止尚未完成绑定的 Agent 进程。

## 会话专属执行视图

强隔离会话的目标执行视图为：

```text
显式 read-write 项目       RW
显式 read-only 项目        RO
Workspace 控制面           RO，修改只能经 Broker
其他注册项目               不作为可写根
会话临时目录               独立
网络                       默认关闭
Scope Broker 状态          Agent 不可写
```

托管会话不得允许 `danger-full-access`、绕过沙箱或普通审批流程临时增加作用域外写权限。用户确实需要增加项目时，应通过 Scope Broker 批准新的 revision，并重新编译或重新启动执行环境。

对于 Codex 本地模式，仅从 `writable_roots` 移除其他项目可以保证写隔离，但通常不能保证这些路径不可读。需要读取保密性时，应使用具有挂载级隔离的容器或平台原生强沙箱。

## 工具调用策略

策略函数应保持确定性：

```text
decision = evaluate(scope, leaseState, projectRegistry, toolCall, runtimeFacts)
```

输出只包含：

```text
ALLOW
DENY(code, reason, remediation)
```

每次评估至少需要：

- `session_id`；
- `turn_id`；
- `tool_name`；
- `tool_input`；
- 当前工作目录；
- 能静态提取的全部目标路径及其规范真实路径；
- 当前 scope revision；
- 当前 lease fencing token；
- 项目实际 worktree 与分支；
- Workspace 自有文件清单；
- 当前 sandbox/permission mode。

基础规则如下：

| 调用 | 结果 |
|---|---|
| 读取 Workspace 注册表 | 允许 |
| `project show/verify` | 允许，但只检查命名项目 |
| 修改作用域内 `read-write` 项目的普通文件 | 允许 |
| 读取作用域内 `read-only` 项目 | 允许 |
| 修改 `read-only` 项目 | 拒绝 |
| 修改未选注册项目 | 拒绝 |
| 修改未注册路径 | 拒绝 |
| 修改 `.code-workspace/*` | 拒绝，必须经 Broker/CLI 受控流程 |
| 修改 `.codex/config.toml` | 拒绝 |
| 通过符号链接写出真实授权根 | 拒绝 |
| 未建立有效作用域时写文件 | 拒绝 |
| 分支漂移 | 原子暂停作用域并拒绝 |
| Agent 请求扩大作用域 | 创建待批准请求，不直接授权 |
| 请求绕过沙箱或扩大写根 | 拒绝并引导用户通过 Launcher 重启 |

当评估发现分支或项目身份漂移时，Broker 应使用 compare-and-swap 将 `ACTIVE` 作用域转换为 `SUSPENDED` 并增加 revision，避免多个并发 Hook 基于旧状态继续放行。

示例拒绝结果：

```json
{
  "code": "SESSION_SCOPE_WRITE_DENIED",
  "sessionId": "session-id",
  "scopeRevision": 3,
  "project": "frontend",
  "target": "/projects/frontend/src/App.tsx",
  "allowedWriteRoots": ["/projects/payments"],
  "remediation": "Ask the user to add frontend to this session scope and restart the managed session."
}
```

## 分支与工作树规则

作用域激活时记录：

- `registeredBranch`；
- `actualBranch`；
- Git worktree 真实根目录；
- 初始 HEAD；
- 初始工作树状态摘要。

持续写入前主要检查：

- 仍是同一个真实 worktree；
- 当前分支没有变化；
- 作用域仍为 `ACTIVE`；
- 当前会话仍持有写租约；
- 目标仍位于授权根内。

开始开发后工作树变脏是正常状态，不应导致作用域暂停。

托管沙箱应保持 `.git` 只读，并拒绝普通工具调用通过审批修改 Git 元数据。外部用户切换分支时，下一次策略评估应暂停作用域。由于外部非受管进程不在本提案的控制范围内，本方案不承诺阻止用户在另一个终端直接修改 worktree。

## 租约回收与故障处理

### 正常结束

`SessionEnd` 通知 Broker 进入 `CLOSING`，Launcher 终止并等待整个进程组退出，随后释放租约并进入 `CLOSED`。

### Hook 缺失或异常结束

`SessionEnd` 可能缺失，因此 Launcher 的进程监管是权威事实。Codex 主进程退出后仍必须确认其受管子进程已经结束。

### 心跳或 TTL 过期

TTL 过期不得直接释放写租约。正确顺序为：

```text
停止续租
  → scope 进入 CLOSING
  → 终止受管进程组
  → 确认进程组退出
  → 释放租约
  → 允许后续会话获取
```

### Broker 重启

Broker 重启后必须从持久状态和 Launcher 进程监管信息恢复。不能确认所有者进程已经退出的租约应保持隔离状态，禁止自动重新分配，直到完成可靠的存活检查或人工恢复。

### 作用域扩展

Agent 可以创建扩展请求，但批准后不能只更新 Hook 中的项目列表。如果运行中的 OS 沙箱没有安全的动态授权能力，应关闭原会话并使用新 revision 重新启动。旧租约只有在旧进程组退出后才能释放。

## 建议模块边界

建议新增以下概念模块：

```text
src/core/session-scope.js
src/core/scope-policy.js
src/core/worktree-lease.js
src/core/scope-broker-client.js
src/core/runtime-adapters/codex.js
src/core/agent-launcher.js
```

职责建议：

- `session-scope.js`：数据模型、状态机、revision 和状态转换；
- `scope-policy.js`：无副作用规则求值与结构化拒绝；
- `worktree-lease.js`：真实 worktree 键、原子租约和 fencing token；
- `scope-broker-client.js`：受限查询/请求协议，不暴露批准能力；
- `runtime-adapters/codex.js`：session 绑定、Hook 输入映射和沙箱编译；
- `agent-launcher.js`：启动事务、进程组监管、关闭和故障补偿。

持久项目授权服务继续负责 Workspace 长期工具配置，不承担会话选择和租约职责。

## 建议命令与信任边界

Agent 可调用：

```text
code-w scope show --json
code-w scope request <project> --access read|write --json
code-w scope close --json
```

可信用户/Launcher 调用：

```text
code-w agent run <project...> --read-only <project...> --tool codex
```

不建议提供可由 Agent 直接调用的：

```text
code-w scope approve --yes
code-w scope force-release
code-w scope renew
```

关闭请求可以由 Agent 发起，但租约释放仍必须等待 Launcher 确认进程组退出。

## 分阶段落地

### 第一阶段：单写项目的可信闭环

- 支持每个会话一个 `read-write` 项目；
- 引入受控 Broker 和 Agent 不可写状态存储；
- 引入基于 worktree realPath 的独占写租约；
- 实现 Launcher、真实 session 绑定和进程组监管；
- 为 Codex 生成仅包含目标项目的会话专属沙箱；
- 接入 `SessionStart`、`PreToolUse`、`PermissionRequest` 和 `SessionEnd`；
- 默认拒绝作用域外审批和 sandbox bypass；
- 将普通 Workspace 根启动的会话标记为 `advisory`。

这一阶段完成后，才可以对受管单项目会话声明多会话写安全保证。

### 第二阶段：显式多项目与只读项目

- 原子获取多 worktree 写租约；
- 支持显式 `read-only` 项目；
- 增加作用域扩展请求和外部批准流程；
- 对需要扩展强沙箱的会话执行受控重启；
- 完善审计、诊断和恢复体验。

### 第三阶段：跨 Provider 与更强隔离

- 为各 Provider 实现统一的 `bindSession()`、`compileSandbox()` 和 `evaluateToolCall()`；
- 对不具备可靠沙箱的 Provider 标记为 `advisory only`；
- 通过容器或平台原生隔离实现挂载级读写边界；
- 如有需要，引入分布式租约和稳定只读快照。

## 验收标准

实现必须至少覆盖以下场景：

1. 两个会话同时请求同一 `realPath` 的写权限时，只有一个进入 `ACTIVE`；
2. 同一路径通过符号链接注册时仍被识别为同一租约资源；
3. 同一 Git 仓库的两个独立 worktree 可以分别获得写租约；
4. 多项目请求中任一写租约冲突时，不保留其他项目的部分租约；
5. `PENDING`、`SUSPENDED`、`CLOSING`、`CLOSED` 和未知会话的写入均被拒绝；
6. Agent 无法直接修改作用域存储、批准请求、续租或强制释放租约；
7. 未选项目即使存在于持久 Agent 权限配置中，也不在受管会话的实际写集合内；
8. Hook 未识别出脚本的副作用时，OS 沙箱仍阻止其写出授权根；
9. 分支漂移会暂停作用域，但 Agent 自己产生的未提交修改不会暂停作用域；
10. Codex 主进程退出但后台子进程仍存活时，不释放写租约；
11. TTL 过期后，只有在旧进程组确认退出后才允许新写会话激活；
12. 作用域扩展必须产生用户批准和新 revision，旧执行环境不能静默获得新写根；
13. 所有拒绝返回稳定错误码、目标、当前 revision 和可执行补救建议；
14. read-only 与 read-write 并存时，产品明确提示读取方得到的是实时视图而非稳定快照；
15. 非 Launcher 启动或绕过沙箱的会话不会被标记为强隔离。

## 开放决策

在进入实现前仍需确认：

- 第一阶段是否完全禁止写会话与只读会话共享同一 worktree，还是允许明确标记的实时读取；
- Scope Broker 使用常驻 daemon，还是由 Launcher 持有并通过受控 IPC 暴露；
- Broker 重启后如何验证跨平台进程组存活；
- macOS、Linux 和 Windows 分别采用何种进程树监管机制；
- 运行中扩大只读集合是否也要求重启沙箱；
- 是否允许受管会话创建 Git commit，以及如何在保持 `.git` 保护的前提下通过 Broker 执行；
- 是否需要为同一会话中的子 Agent 增加独立写入协调。

## 结论

会话项目作用域解决“这个会话被授权操作什么”，worktree 写租约解决“同一资源此刻由谁修改”，OS 沙箱解决“即使策略漏判，进程实际上能写到哪里”，Launcher 则保证租约不会早于写进程释放。

因此，能够承诺多会话安全的最小产品单元不是 `session scope + PreToolUse`，而是：

```text
可信会话作用域
+ worktree 独占写租约
+ Launcher 进程生命周期监管
+ 会话专属 OS 沙箱
+ PreToolUse/PermissionRequest 策略
```

只实现作用域与 Hook 的版本可以作为第一步验证策略和交互，但必须明确标记为增强型 guardrail，不能声称已经提供不可绕过的多会话项目写边界。

## 参考资料

- [Codex Hooks](https://learn.chatgpt.com/docs/hooks)
- [Codex Configuration Reference](https://learn.chatgpt.com/docs/config-file/config-reference)
- [Codex Agent approvals & security](https://learn.chatgpt.com/docs/agent-approvals-security)

