## Context

`project add` 已经支持单个项目路径、`--project-file` 和 `--projects-file`，并在写入前完成批量校验、确认、权限规划和事务提交。add-projects Skill 目前必须把模型生成的完整记录写入临时 JSON，再调用 `--projects-file`，最后额外执行 `project verify`，导致用户需要批准多次命令和文件写入。

CLI 架构要求所有输入继续经过 registry、parser、命令层规划、共享确认和事务后置验证。stdin 只能作为新的显式输入来源，不能绕过这些边界。

## Goals / Non-Goals

**Goals:**

- 为 `project add` 增加正式、可测试的 `--stdin` 输入模式。
- 让批量 JSON 可以一次性传给 add，避免临时文件和重复 verify。
- 保持现有路径、`--project-file`、`--projects-file` 输入兼容。
- 在空输入、非法 JSON、超限输入或模式冲突时于任何写入前失败。
- 让 SKILL、Claude command 和用户文档统一使用同一流程。

**Non-Goals:**

- 不接受明文 JSON 命令行参数，不把 `/dev/stdin` 正式化。
- 不改变项目记录字段、配置文件格式或权限授权格式。
- 不新增独立的项目 verify 步骤；`project add` 继续在事务内完成现有后置验证。
- 不改变读取阶段的逐项目失败汇总；stdin 只处理已经确认的完整有效集合。

## Decisions

### 使用 `--stdin` boolean，而不是设备路径或 `--projects-file -`

`--stdin` 明确表达输入来源，不依赖 `/dev/stdin`，也不需要修改全局 parser 对以 `-` 开头选项值的处理。它与现有文件模式并存，便于诊断和测试。

### `--stdin` 必须与四种输入来源互斥

`--stdin`、`--project-file`、`--projects-file` 和位置路径只能出现一个。stdin 模式不允许位置参数。冲突继续使用 `PROJECT_INPUT_MODE_CONFLICT`。

### `--stdin` 必须配合 `--yes`

stdin 已用于传入 JSON；CLI 不应再尝试从同一 stdin 读取确认。缺少 `--yes` 时在读取输入前返回现有 `CLI_CONFIRMATION_REQUIRED`，避免管道关闭或交互死锁。

### 复用批量 JSON 语义并限制输入大小

stdin 接受与 `--projects-file` 相同的对象或数组形式，其中对象格式为 `{ schemaVersion: 1, projects: [...] }`。读取过程按字节累计，超过固定 1 MiB 上限时返回 `PROJECT_INPUT_TOO_LARGE`；空输入返回 `PROJECT_INPUT_EMPTY`；JSON 解析失败返回 `PROJECT_INPUT_READ_FAILED`。

### 保持现有确认、事务和结果模型

stdin 解析出的记录进入与文件模式相同的 `normalizeProjectRecord`、冲突检查、`validateProjects`、权限规划、确认和 `applyProjectConfiguration` 流程。成功结果仍以 `ok: true` 和现有 `data` 结构表示，不引入绕过事务的 stdin 专用写入路径。

## Risks / Trade-offs

- [stdin 在无输入时可能等待] -> `--stdin` 是显式选择；SKILL 和文档必须说明输入必须由已闭合的 stdin 提供，并测试空输入错误。
- [heredoc 仍可能受 shell 注入影响] -> CLI 契约只负责 fd 0；SKILL 优先使用原生 stdin，文本示例使用已知 JSON 文件管道，不指导直接拼接不可信 JSON。
- [固定大小上限可能拒绝极端大批量] -> 1 MiB 对数千个简短项目记录仍有余量；达到上限时明确失败，不截断 JSON。
- [新增输入模式可能造成模式冲突] -> 在所有分支进行统一互斥检查，并覆盖 parser/runtime 测试。

## Migration Plan

现有路径和文件调用不需要修改。发布后先更新 CLI，再更新托管 SKILL、Claude command、README 和用户指南；`code-w update` 通过 manifest 指纹更新托管模板。若需要回退，可继续使用原有输入模式，不需要迁移项目配置。

## Open Questions

无。输入优先级、确认、大小上限和错误码已由本设计确定。
