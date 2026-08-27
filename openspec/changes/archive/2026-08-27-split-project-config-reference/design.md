## Context

当前 Workspace 将项目数组直接存储在 `.code-workspace/config.yaml`。项目命令、分支协调、初始化、Doctor 和权限同步都通过配置投影读取该数组，项目写操作通过配置事务更新主文件。本变更要求只支持拆分后的格式：主配置保留工作区身份和监控设置，项目注册表固定存储在同目录的 `config-projects.yaml`，而现有 CLI 语义不变。

## Goals / Non-Goals

**Goals:**

- 让 `.code-workspace/config.yaml` 通过 `projects.ref` 明确引用 `config-projects.yaml`。
- 让所有现有项目命令继续操作同一组逻辑项目记录和返回合同。
- 让配置投影、Doctor、权限计划、分支更新和写事务正确覆盖外部项目文件。
- 初始化时始终创建拆分格式，并在 README 中给出完整示例和约束。

**Non-Goals:**

- 不兼容旧的内联 `projects` 数组，也不提供运行时双格式读取。
- 不修改 `project add/remove/list/show/verify` 或项目分支命令的用户可见语义、参数和结果。
- 不引入项目归档、配置 profile、远程引用或通用 YAML include。
- 不改变项目权限目录的授权语义。

## Decisions

### 1. 使用 `projects.ref`，而不是 `projectsRef` 或 YAML 标签

主配置使用：

```yaml
projects:
  ref: config-projects.yaml
```

因为本次不再要求兼容旧数组，`projects` 改成引用对象不会产生双格式兼容复杂度；同时引用关系与项目配置域保持聚合。`!include`、YAML anchor 和 `$ref` 分别存在跨文件解析、路径安全或 JSON Schema 语义混淆问题，因此不采用。

### 2. 固定引用目标和相对路径规则

`ref` 必须是 `config.yaml` 所在目录下的普通文件名 `config-projects.yaml`。不支持 URL、glob、目录、符号链接、绝对路径或逃逸 Workspace 的路径。固定目标可以避免不同项目命令产生不同注册源，并让初始化和事务目标确定。

### 3. 配置加载分为主文档和项目文档

核心配置 API 读取主文档、验证引用，再读取项目文档。对调用方继续返回规范化的 `config.projects` 数组，并附带内部项目文件路径/原始文档信息供写事务和并发检查使用。项目文件格式为 `schemaVersion: 1` 加 `projects` 数组；项目字段沿用现有注册合同。

### 4. 所有项目写入均落到项目文件

`saveConfig` 在初始化或更新工作区域配置时写入主文档引用和项目文档；`project add/remove` 使用同一核心保存能力更新 `config-projects.yaml`。分支接受实际分支的定向更新也改为原子修改项目文件。项目配置事务必须同时快照主文档、项目文档和权限目标，写后重新加载并验证逻辑项目数组。

### 5. 明确拒绝旧格式

主配置缺少 `projects.ref`、引用不是预期值、或 `projects` 是数组时，返回稳定的 `PROJECT_CONFIG_REFERENCE_*` / `PROJECT_CONFIG_INLINE_UNSUPPORTED` 错误，并包含文件路径和修复提示。不会尝试合并内联和外部项目，也不会在只读命令中自动迁移。

### 6. 版本和初始化

主配置继续使用现有 schema 版本 2，项目配置文件使用独立版本 1；项目域通过强制的引用对象区分新格式。初始化默认生成两个文件；既有旧工作区需要用户执行一次性迁移或重新初始化，运行时不承担旧格式兼容。

## Risks / Trade-offs

- [旧工作区无法直接使用] → 在错误诊断中指出需要生成 `projects.ref` 和 `config-projects.yaml`；不静默丢弃旧项目。
- [两个文件的跨文件事务复杂] → 事务快照和恢复同时覆盖两个配置文件，提交前重新加载验证。
- [外部文件仍可能被本机 Git 忽略] → README 明确说明 `.code-workspace` 的默认忽略行为；Git 历史由用户另行决定。
- [配置引用被替换或路径逃逸] → 固定文件名、相对路径和普通文件检查，拒绝符号链接和越界路径。
- [直接读取原始主文档的代码遗漏适配] → 收敛到核心 `loadConfigProjection` / 项目文档 mutation API，并增加分支、Doctor、失败回滚和配置投影测试。

## Migration Plan

1. 新版本初始化直接写入拆分格式。
2. 不提供旧内联格式的运行时兼容；旧工作区在 `config.yaml` 缺少引用时失败并给出修复诊断。
3. 如需保留旧项目数据，用户先将旧数组转换为 `config-projects.yaml`，再将主配置改为引用。
4. 回滚代码版本时，拆分文件仍保留；旧版本无法读取拆分格式，需恢复对应的旧配置文件。

## Open Questions

- 暂无。`config-projects.yaml` 默认与 `config.yaml` 位于同一个 `.code-workspace` 目录。
