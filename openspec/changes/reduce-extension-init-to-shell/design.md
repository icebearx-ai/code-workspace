## Context

扩展可以声明 outputs、hooks、runtime 或组合能力。初始化命令不应在用户选择能力前生成某一种示例实现，因此默认产物只保留 package 身份、manifest 基础字段和空入口。

## Goals / Non-Goals

**Goals:**

- 让 init 成为最小、方向中立的开发起点。
- 保留通用元数据交互和摘要维护能力。
- 让 pack 继续作为完整规范校验边界。

**Non-Goals:**

- 不增加能力选择向导。
- 不生成 output、target、README 或模板目录。
- 不放宽最终 package 的 outputs/hooks/runtime 要求。

## Decisions

- 空壳 manifest 使用基础身份字段，不声明 capabilities；因此它可保存和编辑，但不能直接 pack。
- `digest update` 使用基础 manifest 校验，不要求能力已声明，以便开发阶段修改入口后仍能维护摘要。
- 交互字段只包含 id、name、description、version；显式 CLI 参数优先，非 TTY/JSON 使用确定性默认值。

## Risks / Trade-offs

- 空壳不能直接发布 → pack 返回明确的缺少能力诊断和 remediation。
- manifest 在开发阶段暂时不完整 → 只允许 scaffold/digest 路径接受，安装和 pack 仍使用严格校验。

## Migration Plan

更新 scaffold core、CLI registry、交互、测试和开发文档；不迁移已有扩展 package。
