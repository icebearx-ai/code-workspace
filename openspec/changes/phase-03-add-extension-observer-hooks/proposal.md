## Why

扩展需要消费 Agent 生命周期事件，但观察行为不应获得写入决策、阻塞工具调用或共享写保护状态。当前抽象 Hook 没有区分观察协议与决策协议，也没有面向 Codex/Claude 的稳定 failure-open 语义。

## What Changes

- 新增扩展 observer Hook 协议，与任何写入协调、决策或台账能力分离。
- 定义 Session、Turn、Tool 和 Subagent 等观察事件，不把写保护事件复用为观察事件。
- Host 通过 Codex/Claude adaptor 将 Provider 原生输入归一化；observer 只接收通用观察字段且排除敏感正文。
- Observer 在配置错误、服务不可达或内部异常时 failure-open，返回中性 acknowledgement，并记录可诊断信息。
- 使用独立 observer 测试扩展验证两个 Provider；本阶段不迁移或修改 Monitor。

## Capabilities

### New Capabilities

- `extension-observer-hooks`: Provider-neutral 观察事件、failure-open 执行语义以及 Codex/Claude 观察适配。

### Modified Capabilities

- `extension-execution-protocol`: Manifest 支持声明 observer Hook 及其协议语义。
- `workspace-init-extensions`: Hook 合成、安装、验证和卸载区分 observer 与决策型 Hook。

## Impact

影响 Provider adaptor、Hook 声明校验、原生 Hook 合成、安装/卸载事务和相关测试。不修改 Monitor observer、不新增写入决策，也不改变现有扩展 Hook 的失败策略。
