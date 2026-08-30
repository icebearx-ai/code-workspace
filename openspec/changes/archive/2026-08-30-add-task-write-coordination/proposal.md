## Why

多个 Codex 或 Claude 任务可以同时在同一项目中工作，但用户目前无法在写入发生前获知项目内的并行写入，也没有机制阻止两个任务同时修改同一文件。需要在不依赖 Monitor、不禁止合理并行开发的前提下，提供项目级告知确认与文件级强制互斥，并为异常中止和 `UNKNOWN` 状态保留可理解、可恢复的人工裁决路径。

## What Changes

- 引入工具无关的任务身份与 `ACTIVE | UNKNOWN | ENDED` 生命周期状态；子 Agent 继承父任务身份，不单独参与锁竞争。
- 引入 Workspace 外部的持久化协调台账，并用现有 `proper-lockfile` 对短时台账事务串行化；协调核心不依赖 Monitor。
- 将“项目锁”实现为可由用户批准的并行写入保护/参与关系，而非排他互斥锁。
- 将“文件锁”拆分为写入前 `WRITE_RESERVATION` 和写入后 `DIRTY_CLAIM`；同文件冲突强制拒绝，多个文件一次性检查和登记。
- 对 `UNKNOWN` 所有权禁止自动释放，提供包含任务、锁、Git、指纹和运行时证据的人工裁决；裁决后请求任务必须重新执行完整写入检查。
- 新增统一 Hook 事件和决策协议，并分别提供 Codex、Claude 适配器；以后新增 Provider 时只增加适配器。
- 新增任务、锁和待裁决事项的查询及处理 CLI，返回稳定错误码、结构化详情与明确修复建议。
- 明确安全边界：无法在写入前确定目标范围且项目存在并发写入时强制拒绝；绕过受支持 Hook/工具入口的外部写入不在本机制的强制保证范围内。

## Capabilities

### New Capabilities

- `task-lifecycle-state`: 定义任务身份、三态生命周期、generation、超时降级、显式结束以及 `UNKNOWN` 人工裁决规则。
- `task-write-coordination`: 定义项目级保护、文件预约与 dirty claim、原子台账事务、释放/恢复规则、冲突决策和无死锁约束。
- `agent-write-hook-protocol`: 定义 Provider 无关的 Hook 输入输出协议、写入范围提取以及 Codex/Claude 生命周期和工具事件适配。
- `task-coordination-cli`: 定义任务/锁/裁决的查询和处理命令、确认边界、稳定结果与友好诊断。

### Modified Capabilities

无。现有 `monitor-session-lifecycle` 不参与本机制的状态判断或锁管理；Monitor 如需展示，只能在后续以只读方式消费协调状态。

## Impact

- 新增 `src/core` 下的任务协调、台账、Git 路径状态和 Provider 协议核心服务。
- 新增 `src/cli/registry.js` 命令声明、`src/cli.js` 路由、任务协调命令处理器及文本/JSON 输出。
- 新增 Codex 与 Claude Hook 模板/适配器，并更新初始化、更新和托管文件清单。
- 复用 `proper-lockfile` 与原子写入能力，不引入常驻 Broker 或 Monitor 依赖。
- 增加并发、崩溃恢复、状态竞态、CLI 架构和 Provider 适配测试。
