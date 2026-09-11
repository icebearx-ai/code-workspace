## Why

前三个阶段建立通用运行时能力后，Monitor 可以作为首个真实消费者验证这些能力，而无需继续让核心承担 Monitor Server、Dashboard、事件映射和运行期配置。本阶段先提供可选的扩展实现，不切换默认路径，以便与现有核心 Monitor 做完整对等回归。

## What Changes

- 将 Monitor Store、HTTP API、Dashboard、i18n、静态资源和事件业务映射打包为 `monitor` 运行时扩展。
- Monitor 通过通用扩展 CLI 启动全局服务，通过扩展配置文件读取用户配置。
- 为 Codex 和 Claude 声明 observer Hooks，使用第三阶段协议进行 failure-open 上报。
- 保持 Monitor 的 Session 生命周期、统计、删除 API、页面行为和十分钟失活规则不变。
- 本阶段仅支持显式安装和选择 Monitor 扩展；核心 Monitor、旧命令和旧默认行为继续存在，作为对等测试基线。

## Capabilities

### New Capabilities

- `monitor-extension`: Monitor 作为可独立安装、升级和卸载的运行时扩展提供原有业务能力。

### Modified Capabilities

无。

## Impact

影响 `extensions/monitor/` 包结构、Monitor 测试、扩展运行入口和资源打包。不改变 `config.monitor`，不改变 `code-w monitor` 默认路径，不迁移旧 Workspace，也不删除核心 Monitor。
