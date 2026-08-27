## Why

项目注册表目前内嵌在 `.code-workspace/config.yaml`，项目增删和注册分支更新会持续改写工作区主配置。将项目注册表拆到固定的 `config-projects.yaml`，可以让主配置只表达项目配置引用，并让项目注册数据拥有独立的文件生命周期和版本历史。

## What Changes

- **BREAKING** 将项目配置格式固定为 `.code-workspace/config.yaml` 中的 `projects.ref` 引用，不再支持内联 `projects` 数组。
- 新增 `.code-workspace/config-projects.yaml` 项目注册文件及其 schema 校验。
- 保持 `project add/remove/list/show/verify` 和项目分支命令的现有 CLI 语义、参数、结果和确认行为不变，仅切换项目配置的读写来源。
- 初始化默认生成主配置引用和空的 `config-projects.yaml`。
- 将配置解析、投影、Doctor、权限同步、事务回滚和并发检查适配到外部项目文件。
- 更新 README，说明唯一支持的拆分格式、两个文件的示例、引用约束以及不再支持的旧格式。

## Capabilities

### New Capabilities

- `project-config-reference`: 定义主工作区配置对独立项目注册文件的引用、解析、校验和持久化边界。

### Modified Capabilities

- 无。现有项目命令的用户可见要求不变，本变更只替换其配置存储来源。

## Impact

- 影响 `src/core/config.js`、项目配置事务、项目分支更新、初始化和 Doctor/校验路径。
- 影响 `.code-workspace` 本地配置文件布局和配置 schema 版本。
- 不新增 CLI 命令或选项，不改变项目权限目标和 Agent 集成合同。
- 现有内联配置需要用户通过一次性迁移或重新初始化转换为拆分格式；运行时不再兼容旧格式。
