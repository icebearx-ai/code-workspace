## Why

`init` 仍从本地 extension catalog 构造普通扩展多选，而普通内置扩展已经清理。需要把 init 的普通扩展步骤切换到共享 Nexus picker，同时保持系统扩展自动安装和核心初始化边界。

## What Changes

- **BREAKING** 交互式 init 的普通扩展列表改为 Nexus 分页搜索结果。
- init 使用共享 picker 的搜索、左右翻页、多选和安装状态展示。
- 选择结果在确认前冻结候选版本、来源和 package digest。
- 系统扩展继续隐藏并自动加入 init 计划。
- Nexus 延迟或失败时给出可理解的 warning/重试/跳过路径，不把普通扩展失败伪装成本地 builtin。
- 非交互式 `--extensions` 继续使用名称输入，并由 Nexus lifecycle 解析。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `workspace-init-extensions`: 交互式普通扩展选择改为 Nexus picker，系统扩展自动处理。

## Impact

影响 `src/cli/commands/init.js`、`src/init/wizard.js`、共享 picker 接口、Nexus lifecycle 调用和 init 测试。核心 Workspace 初始化、确认和扩展事务保持不变。
