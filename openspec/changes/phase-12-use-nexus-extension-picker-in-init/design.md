## Context

phase-09 清理普通内置来源，phase-10/11 提供 Nexus page session 和共享 picker。当前 init 仍把普通 catalog 传给 `collectInitPlan`，并用 `resolveExtensionPlans` 生成本地计划，需要改成先取得 picker 选择，再由 Registry lifecycle 冻结远端计划。

## Goals / Non-Goals

**Goals:**

- 交互式 init 只展示 Nexus/Store 普通扩展。
- 系统扩展从新的系统识别 API 自动加入并隐藏。
- 确认前展示精确版本、来源、digest、网络能力和输出目标。
- 复用现有 Store 导入、批处理、事务和诊断。

**Non-Goals:**

- 不改变非交互参数语法。
- 不在 init 中实现新的安装事务。
- 不做旧 Workspace 兼容。

## Decisions

1. `collectInitPlan` 接收一个 registry picker adapter，wizard 只消费选择结果，不解析 Nexus 响应。
2. picker 返回 extension IDs/actions；init 在确认前调用 `prepareRegistryExtensionPlans` 冻结精确候选，计划摘要使用该结果。
3. 系统扩展仍由 `executeInit` 依据 system catalog 自动合并到 requested extensions，普通 picker 永不返回系统 ID。
4. 交互式首次加载可显示 Nexus loading；如果 Registry 未配置或请求失败，用户可以跳过普通扩展并继续核心 init，已选目标的准备失败则进入已有 warning 结果。
5. 非交互 `--extensions` 不调用 picker，直接走 Registry lifecycle；未显式提供时维持现有“新 Workspace 不安装普通扩展”的规则。

## Risks / Trade-offs

- [init 首屏受 Nexus 延迟影响] → 使用 page session 有限并发、加载状态和可跳过选项。
- [确认摘要与实际远端候选不一致] → 在确认和执行之间复用冻结计划及 digest 校验。
- [系统扩展与普通扩展目标冲突] → 系统计划先纳入 planning state，普通候选冲突在准备阶段失败并给出诊断。

## Migration Plan

1. 保留核心 init 流程，替换普通扩展 catalog 输入。
2. 增加 interactive init fake picker、Nexus failure、system hidden 和 plan freeze 测试。
3. 更新 README 中 init 交互描述。
4. 失败时可回滚到 phase-09 的无普通扩展选择状态，不恢复 builtin 普通目录。
