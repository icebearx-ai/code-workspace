## Why

Monitor 扩展通过与核心实现对等验证后，需要成为默认可用路径，同时保证已有 Workspace 的配置、Hook 和运行方式不丢失。默认切换必须原子、可诊断、可回滚，并保留窄兼容入口，避免一次性破坏用户升级。

## What Changes

- 新 Workspace 在原有适用条件下默认选择 Monitor 扩展，并通过通用扩展生命周期安装 observer Hooks。
- `init` 和 `update` 识别旧 `config.monitor` 与旧 Monitor Hook，在一次文件事务内迁移到扩展配置和 observer Hook。
- 已存在的扩展配置优先于旧配置；迁移失败不得删除旧来源，必须回滚全部文件变化。
- 保留 `code-w monitor` 作为兼容别名并转发到 `code-w ext monitor`。
- 卸载只移除扩展拥有的制品和 Hook，默认保留扩展配置、运行期数据和用户自定义 Hook。
- 核心 Monitor 暂时保留作为回退基线；本阶段不删除旧实现。

## Capabilities

### New Capabilities

- `monitor-extension-adoption`: Monitor 扩展的默认选择、旧配置/Hook 迁移、兼容别名、回滚和保留策略。

### Modified Capabilities

- `workspace-init-extensions`: 初始化默认扩展选择、升级迁移和卸载保留行为支持 Monitor 扩展。

## Impact

影响 init/update、配置迁移、Hook 合成、CLI 兼容路由、扩展状态和相关测试。必须覆盖新旧 Workspace、多 Workspace、重复执行、迁移中断和回滚，不改变 Monitor 可见业务规则。
