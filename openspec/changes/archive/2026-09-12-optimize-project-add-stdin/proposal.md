## Why

当前 `project add` 只能从项目路径或 JSON 文件读取记录，add-projects Skill 因此必须先写临时 JSON，再执行 add 和独立 verify，产生多次命令与文件写入审批。为 stdin 增加正式 CLI 契约，可以移除临时文件并让 Skill 使用单次批量写入，同时保持现有事务、确认和回滚安全边界。

## What Changes

- 为 `project add` 增加 `--stdin` boolean 输入模式，从文件描述符 0 读取与 `--projects-file` 相同的批量 JSON。
- 强制 `--stdin` 与其他输入模式互斥，并要求 `--yes`，避免 stdin 同时承担确认输入。
- 对空输入、非法 JSON 和超限输入提供稳定诊断，且在任何写入前失败。
- 将 add-projects Codex Skill 和 Claude command 改为无临时 JSON、一次确认、一次 `project add --stdin`，不再默认追加 `project verify`。
- 更新 README、用户指南、流程文档和项目配置规格，统一说明 stdin 输入、逐项采集失败和原子写入语义。

## Capabilities

### New Capabilities

无。本变更扩展现有项目注册命令，不引入新的独立能力。

### Modified Capabilities

- `project-config-reference`: `project add` 在保留现有路径、单项目文件和批量文件输入的同时，新增正式 stdin 输入模式及其输入校验、确认和事务语义。

## Impact

- CLI registry、`project add` 命令实现和 JSON 诊断。
- add-projects Skill、Claude command、README、用户指南和流程文档。
- 项目配置规格、CLI runtime/parser/事务测试及托管文件 manifest 指纹。
- 现有路径和文件输入模式保持兼容；无配置格式或项目记录字段变化。
