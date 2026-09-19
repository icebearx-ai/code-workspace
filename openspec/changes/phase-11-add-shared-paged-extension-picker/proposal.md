## Why

`init` 和扩展命令需要同一套线上扩展选择体验：搜索、分页、多选、跨页保留选择，并明确显示未安装、已安装最新版和可更新状态。现有 Clack multiselect 没有用户可见分页，也不能把左右键定义为翻页。

## What Changes

- 新增共享的终端扩展分页选择器，供 init 和 extension search 使用。
- 列表焦点下使用左键上一页、右键下一页；不采用隐藏的加载更多或简单滚动替代。
- 保留搜索焦点与列表焦点，避免左右键和搜索光标冲突。
- 支持跨页多选、页面缓存、加载中、重试、取消和空选择。
- 统一呈现扩展版本、来源、安装状态和可执行动作。

## Capabilities

### New Capabilities

- `paged-extension-picker`: 定义终端搜索、分页、多选和状态展示交互。

### Modified Capabilities

无。

## Impact

影响 `src/init/ui.js`、新增 picker 模块、交互测试和结果格式。该 Change 不决定 init 或 search 的最终写入编排。
