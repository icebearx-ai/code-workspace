## Why

扩展包进入用户级 Store 后，仍需要一个与具体业务无关的执行层，统一从精确包版本启动一次性 CLI 和长驻服务，并使全局服务可以被多个 Workspace 使用。当前 CLI 和扩展生命周期尚未提供这种通用边界。

## What Changes

- 建立通用 Extension Runtime Host，从 Package Store 按 ID、版本和摘要解析运行入口。
- 永久注册 `codew ext <extension-id> ...`，扩展 ID 后的参数保持不透明直通。
- 支持 workspace activation 与 global/user service 两种执行作用域，但不建立全局 Workspace。
- 实现 oneshot 与 service 生命周期、进程组、stdio、信号、启动超时和稳定错误。
- 增加 service identity、兼容组和运行进程引用，避免不兼容版本静默共享服务。
- 保持内核只提供通用 Host 能力，不导入 Monitor、MCP 或其他扩展业务模块。

## Capabilities

### New Capabilities

- `extension-runtime-host`: 通用扩展 CLI、Runtime 入口解析和一次性/长驻执行生命周期。
- `extension-service-compatibility`: 全局服务身份、兼容组、版本选择和运行进程引用规则。

### Modified Capabilities

- `extension-execution-protocol`: 增加 runtime entry、execution scope、service identity 和兼容性声明。


## Impact

影响 CLI registry/parser/dispatch、扩展 manifest/schema、进程执行层、Package Store 查询、结果与错误模型及测试 fixture。不得新增任何 Monitor 专用核心路由。
