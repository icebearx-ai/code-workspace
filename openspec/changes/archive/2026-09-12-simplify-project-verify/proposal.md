## Why

当前 Workspace Guard 在 `project branch update-latest` 之后再次运行定向 `project verify`，但该验证只检查注册表、路径和分支状态，无法提供 update-latest 后置条件未覆盖的新保证。同时，单项目 `project verify` 同时在 `data.project` 和 `data.projects[0]` 返回完整项目对象，导致大型 `context` 被重复序列化并浪费模型上下文。

## What Changes

- 简化 Workspace Guard：入口只保留一次定向 `project verify`；分支处理 Skill 交还后不再次运行整体验证；`project branch update-latest` 作为项目工作前的最终状态门。
- 更新成功后不再运行第二次 `project verify`。仅在 `fastForwarded: true` 时丢弃旧项目上下文并重新读取项目文件和指令；`disabled` 与 `already-latest` 直接继续。
- **BREAKING** 单项目 `project verify <name>` 的 `data` 保留 `scope: "project"` 和 `project`，删除冗余的 `projects` 数组。
- 全量 `project verify` 继续返回 `data.projects`；多项目 `project verify <a> <b>` 继续返回 `data.results`。
- 同步更新 Guard 模板、OpenSpec 规范、CLI 架构文档、流程文档、测试和托管制品指纹。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `workspace-agent-branch-guidance`: 删除 Guard 在分支协调后和 update-latest 后的重复整体校验，明确 update-latest 的最终状态门职责。
- `project-branch-reconciliation`: 收紧单项目 `project verify` 的 JSON 数据合同，删除 `data.projects` 冗余字段。

## Impact

- 影响 `project verify <name> --json` 的机器可观察数据合同，调用方必须从 `data.projects[0]` 迁移到 `data.project`。
- 影响 Workspace Guard 模板、生成的 `AGENTS.md` / `CLAUDE.md`、流程文档和相关测试。
- 不改变项目校验逻辑、Git 操作、配置结构、错误码或事务边界。
