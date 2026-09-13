## Why

当前扩展包随 Workspace 制品一起管理，导致每个 Workspace 重复保存扩展源码/依赖，也无法自然支持多个 Workspace 共享同一扩展运行包。需要先建立用户级、版本化且不可变的本地 Package Store，同时保留 Workspace 级 activation。

## What Changes

- 将内置扩展包导入用户级 Extension Store，按扩展 ID、版本和完整包摘要保存。
- 允许同一扩展的多个版本共存，Workspace activation 固定引用精确版本和摘要。
- 将 Workspace 状态改为只记录 activation、制品和 Hook，不再把扩展源码作为 Workspace 制品保存。
- 增加包安装、完整性校验、引用记录、并发锁和安全垃圾回收。
- 保留当前内置目录作为第一版 Package Provider；本 Change 不处理远程下载。
- **BREAKING** 扩展运行目录不再默认写入 Workspace；已有 Workspace 提供迁移和回滚路径。

## Capabilities

### New Capabilities

- `extension-package-store`: 用户级本地扩展包 Store、版本共存、完整性和引用生命周期。
- `workspace-extension-activation`: Workspace 对全局扩展包的精确版本激活和制品生命周期。

### Modified Capabilities

- `extension-execution-protocol`: 扩展执行输入从 Workspace 内包目录改为不可变 Package Store 包，并固定包摘要引用。
- `workspace-init-extensions`: 安装、升级、卸载和状态记录改为 Package Store + Workspace activation 模型。

## Impact

影响扩展发现、安装计划、状态格式、事务和卸载路径，新增用户级 Store、全局锁和引用管理。需要迁移现有 Workspace 扩展状态，并保持旧 installed record 可安全卸载。
