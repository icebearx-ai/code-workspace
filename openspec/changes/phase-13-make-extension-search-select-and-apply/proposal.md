## Why

`codew extension search` 当前是 Workspace 无关的只读命令，无法直接完成用户发现后的安装或更新。产品希望它与 init 使用同一搜索、分页、多选体验，并根据 Workspace 状态把选择转换为安装或更新。

## What Changes

- **BREAKING** TTY 下 `codew extension search [query]` 直接进入搜索、分页、多选和确认流程，不增加 `--select`。
- 已安装且为最新版本的扩展显示为不可选。
- 已安装但不是最新版的扩展可选，选择后执行 update/upgrade 事务。
- 未安装扩展可选，选择后执行 install 事务。
- JSON、非 TTY 或明确非交互调用保留只读搜索结果，不提示、不写 Workspace。
- 更新 CLI registry、配置域、效果分类、确认、结果 envelope、文档和测试。

## Capabilities

### New Capabilities

- `extension-search-selection`: 定义 extension search 的交互选择、安装/更新和非交互只读分流。

### Modified Capabilities

无。

## Impact

影响 `src/cli/registry.js`、`src/cli/commands/extension.js`、CLI dispatch/config projection、共享 picker、Registry lifecycle、结果和文档。计划写入必须继续复用 Workspace 锁、确认、逐扩展事务、验证和回滚。
