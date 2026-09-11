## Context

Monitor 扩展达到行为对等后，需要成为默认路径。已有 Workspace 可能同时包含 `config.monitor`、旧 managed Hook、用户 Hook、旧 Monitor 状态和已安装扩展状态，升级必须保持可回滚且不能误删用户内容。

## Goals / Non-Goals

**Goals:**

- 在原有适用条件下默认选择 Monitor 扩展。
- 原子迁移旧配置和 Hook，并保留用户与其他扩展内容。
- 保留 `code-w monitor` 兼容别名和明确 deprecation 窗口。
- 提供失败回滚和可诊断迁移结果。

**Non-Goals:**

- 不删除核心 Monitor 实现。
- 不改变 Monitor 业务规则。
- 不迁移运行期用户数据的内部分析或统计语义。
- 不结束兼容别名。

## Decisions

### D1: 默认选择复用既有条件

仅当旧版本会默认启用 Monitor 的相同工具、交互和显式选项条件下，init/update 才默认选择 Monitor 扩展。显式 `--no-monitor`、`--extensions none` 或用户选择其他扩展时必须尊重显式选择。

### D2: 迁移输入和优先级固定

旧 `config.monitor` 与旧 Monitor Hook 是迁移输入。已存在的 `config-monitor.yaml` 优先，不被旧值覆盖。迁移成功后才从核心配置删除旧域；新文件写入失败、Hook 合成失败或后置验证失败时保留旧来源。

### D3: 单次外层事务覆盖全部迁移制品

核心配置、扩展配置、Observer Hook、状态和旧 managed asset 状态在同一事务快照下处理。事务提交前必须验证扩展配置、Hook 贡献和 installed 状态。任一步失败回滚全部文件变化。

### D4: 兼容别名是单向薄适配器

`code-w monitor` 解析旧选项后转换为 `ext monitor` 调用，不直接导入扩展业务模块。别名在 deprecation 期间保持原有常用参数语义；不承诺继续扩展新参数。

### D5: 卸载与切回核心明确分离

卸载扩展会移除扩展 Hooks 和状态但保留用户配置。兼容期内用户可以继续运行核心 Monitor；是否自动切回由显式操作决定，不能在卸载时静默改配置。

## Risks / Trade-offs

- 双实现行为漂移 → 默认切换前必须冻结对等测试结果，切换后保留核心回退测试。
- 旧 Hook 与用户 Hook 冲突 → 只移除已识别且摘要匹配的旧贡献；未知修改 fail closed。
- 新旧配置同时存在 → 新配置优先并产生 warning，不静默合并字段。
- 默认切换难以回滚 → 记录迁移前状态和版本，支持撤销扩展到旧配置/Hook 的补偿计划。

## Migration Plan

1. 增加迁移预检和 dry-run 型计划数据，不写文件。
2. 对 fixture 和新 Workspace 执行默认扩展选择。
3. 对旧 Workspace 执行原子迁移，核心 Monitor 保留为运行回退。
4. 监控兼容和迁移诊断，满足门槛后才允许进入第六阶段。
5. 回滚时恢复旧配置/Hook 和默认选择，保留扩展配置供后续重试。

## Open Questions

- 默认切换是否需要版本 flag 或安装选项，以支持先小范围发布再全面启用。
- 旧配置迁移后核心 `monitor` 域是立即删除还是保留一个只读兼容投影；需要平衡回滚和配置单一事实来源。
