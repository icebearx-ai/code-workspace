## Why

CLI 运行时的主要结构性问题已经解决，但初始化仍可能在外部命令部分生效后遗漏 retained effect，迁移报告也可能只显示 Schema 升级而没有表达语言兼容动作。发布前应补齐这些会影响用户判断和自动化恢复的边界，同时避免继续进行与风险无关的重构。

## What Changes

- 让全局 OpenSpec 安装、workspace dependencies 和上游 `openspec init` 在命令失败或后置验证失败时，都报告已发生或可能发生的不可补偿效果。
- 将配置版本步骤与旧语言来源解析汇总成一个可审计的维护迁移计划；只允许 init/update 提交，只读命令继续保持无写入。
- 在已识别命令的参数错误中保留命令路径，并为上述高价值失败路径补齐稳定错误代码、证据和修复建议。
- 按写入风险采用分级安全模型：单文件原子写不强制套用多文件事务，多文件工作区写继续使用文件事务，外部命令使用后置验证和效果报告。
- 增加针对旧配置 init、外部命令部分成功、解析错误命令上下文和关键 JSON 信封的回归测试。
- 不拆分现有 project handler，不引入第三方 CLI/事务框架，不建立通用事件溯源或完整文件系统快照。

## Capabilities

### New Capabilities

- `cli-safety-boundaries`: 定义维护迁移计划、外部效果核算、分级写入安全和关键错误契约。

### Modified Capabilities

无。

## Impact

- 主要影响 `src/core/init.js`、`src/core/initializer.js`、`src/core/config.js`、`src/core/transaction.js`、`src/cli/parser.js`、`src/cli.js` 及对应测试。
- 不改变公开命令名称、工作区目录结构或成功响应的 JSON 信封。
- 失败响应可能新增更具体的诊断字段和 retained effect 记录，属于向后兼容增强。
- 不增加运行时依赖。
