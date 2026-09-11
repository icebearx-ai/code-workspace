## Context

现有 Hook 抽象可以映射 Codex/Claude 原生生命周期事件，并为扩展安装原生配置片段。但该模型没有区分“观察事件”与“会产生 ALLOW/DENY 的决策事件”，也没有约束失败策略。Monitor 需要观察两个 Provider，同时不能获得写入控制权或共享写保护状态。

## Goals / Non-Goals

**Goals:**

- 定义独立 observer 协议和 provider-neutral 观察事件。
- 让 Codex/Claude adaptor 统一输入 envelope，同时保留 Provider 和原生会话元数据。
- 保证 observer failure-open，永不阻断 Agent 工具调用。
- 让 observer 与决策型 Hook 在声明、合成、运行和故障上隔离。

**Non-Goals:**

- 不迁移 Monitor。
- 不定义写入冲突、任务台账、claim 或 ALLOW/DENY。
- 不把 observer 结果解释为安全决策。
- 不承诺恶意扩展隔离；observer 仍是可信代码。

## Decisions

### D1: 使用独立 observer 协议标识

Hook 声明必须显式区分 `observer` 与决策型协议。Host 分别校验、合成、安装、验证和卸载；observer 不得复用决策协议 marker，也不能通过字段伪装成决策 Hook。

### D2: 使用观察语义事件而不是 write.* 事件

观察事件使用 `session.*`、`turn.*`、`tool.*`、`subagent.*` 和 `permission.*` 命名。工具观察表达 started/completed/failed，不表达 write.before/write.after 的授权含义。这样 Monitor 消费的是事实事件，而不是写保护内部阶段。

### D3: Host 只归一化，不解释扩展业务

Provider adaptor 负责识别原生事件、提取 session/turn/tool/subagent 元数据并移除敏感正文。扩展 runner 接收版本化观察 envelope。Host 不要求特定 Monitor 字段，也不写入扩展 Store。

### D4: failure-open 是协议要求

配置缺失、Monitor 不可达、输入损坏或 runner 异常时，observer 必须返回 Provider 接受的中性 acknowledgement 并以成功退出结束。结构化 warning 只能写诊断，不得改变 Agent 的工具执行结果。决策型 Hook 继续保有自身失败策略，observer 不得改变它。

### D5: 安装成功与运行成功分离

Hook 声明校验、原生配置合成和安装仍是 fail-closed；安装后 observer 的运行时失败是 failure-open。二者必须使用不同错误码和测试路径，避免把运行时上报失败回滚成安装失败。

## Risks / Trade-offs

- Provider 事件不完全对称 → 统一 envelope 允许字段可空，原生名称保留用于诊断，但不得强迫 Provider 伪造事件。
- failure-open 可能隐藏故障 → 必须记录 warning 和稳定 error code，同时保证 stdout 仍是中性 acknowledgement。
- 事件过于松散无法测试 → 事件名和 envelope 版本必须固定，未知事件要安全跳过并产生诊断。
- 同一原生事件同时供多种协议使用 → 原生配置合成可以使用独立 entry，运行时不得共享决策状态。

## Migration Plan

1. 增加 observer 声明、事件 envelope 和 Provider 归一化测试，不安装真实用户 Hook。
2. 增加独立合成与卸载测试，确认现有 Hook 内容不变。
3. 使用 fixture observer 在 Codex 和 Claude 模拟输入下验证 failure-open。
4. 回滚时移除 observer 声明和已 fixture 安装项；用户 Hook 和现有扩展 Hook 必须保留。

## Open Questions

- 观察事件启动时的首个事件是否允许仅为 `session.activity`，还是 Provider adaptor 必须合成 `session.started`。
- acknowledgement 是否统一由 Provider adaptor 渲染，还是 observer runner 输出通用结果后由 Host 转换；需要固定一层职责。
