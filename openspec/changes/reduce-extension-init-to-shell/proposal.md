## Why

当前 `extension init` 预置了 output、target、README 和示例行为，替用户提前选择了扩展形态。探索阶段只需要一个可继续编辑的 package 空壳，能力声明应由开发者根据 Extension Spec 后续添加。

## What Changes

- `extension init` 只生成 `package.json`、`extension/manifest.json` 和空壳 `extension/init.js`。
- 移除默认 output、output target、README 和能力模板选项。
- TTY 下仅交互收集 id、display name、description、version；目录名只作为 id 默认值。
- 空壳允许生成和更新摘要，但 `extension pack` 在未声明 outputs、hooks 或 runtime 时严格拒绝。

## Capabilities

### New Capabilities

- `minimal-extension-shell`: 创建不预设扩展能力的最小开发 package。

### Modified Capabilities

无。

## Impact

- extension scaffold core service、CLI 交互和 registry options。
- extension scaffold tests 与开发文档。
- 不改变 Extension Spec 的能力要求和 pack 校验边界。
