## Context

当前 `codew-add-projects`、`codew-resolve-branch` 及其 Agent 入口文件由核心 managed files 安装。扩展 Host 已经能够处理同类型的工具相关文件制品，因此本 Change 只需增加系统扩展的生命周期策略。当前处于测试阶段，允许删除旧 managed-file 定义，不提供旧 Workspace 兼容迁移。

## Goals / Non-Goals

**Goals:**

- 在 `extensions/.system` 下发布两个版本化系统扩展。
- 复用普通扩展的发现校验、隔离执行、Store、事务、状态和完整性验证。
- `init` 自动安装或升级系统扩展，且普通扩展选择界面不展示它们。
- 从 CLI 和核心卸载 API 禁止手动卸载系统扩展。
- 保持 `AGENTS.md`、`CLAUDE.md` 等 Workspace Guard 核心文件由 managed files 管理。

**Non-Goals:**

- 不迁移或兼容旧版本 Workspace 的 managed-file 状态。
- 不提供用户无法直接删除 Workspace 文件的操作系统级保护。
- 不改变 Extension Spec v1 的 staging、result 或 artifact 协议。

## Decisions

### D1: 用源码目录区分系统扩展

扩展 Host 继续使用同一份 manifest schema。`extensions/.system/<id>/<version>` 被发现为系统 catalog，普通 `extensions/<id>/<version>` 被发现为普通 catalog。计划和 installed state 记录 `system: true`，避免包导入 Store 后丢失管理属性。相比在公共 manifest 中增加产品专用字段，这种方式不需要升级 Extension Spec。

### D2: init 自动注入系统扩展

`init` 在解析普通扩展选择后，将适用于当前工具的系统扩展追加到请求集合。`--extensions none` 仅清空普通扩展请求；系统扩展不进入交互多选。没有选择 Agent 工具时，系统 Skill 以无适用输出的 skipped 结果处理。

### D3: 系统扩展不开放独立安装和卸载

普通扩展安装 catalog 和选择 UI 排除系统扩展。显式传入系统扩展 ID 返回 `EXTENSION_SYSTEM_MANAGED`。卸载计划和应用 API 在任何文件变更前拒绝系统扩展。系统扩展只通过 `init` 的自动计划安装或升级。

### D4: 两个 Skill 保持两个扩展 ID

系统能力采用单一 `codew-workspace-guard` ID，将 Workspace Guard、`codew-add-projects` 与 `codew-resolve-branch` 作为一个原子扩展包发布。这样三者的文件输出共享一次扩展事务：任一输出校验或写入失败时，Guard 与两个 Skill 不会出现半安装状态。Skill 的公开名称和调用方式保持不变，但不再作为可单独安装、升级或卸载的扩展 ID 暴露。

### D5: 直接移除旧核心资产定义

从 `artifacts/manifest.json` 删除两个 Skill、OpenAI metadata 和 Claude add-projects command 的条目，并将源文件复制到对应系统扩展包。旧 Workspace 不做状态接管；测试夹具按新模型重建。

## Risks / Trade-offs

- [系统扩展安装失败会留下缺少 Skill 的 Workspace] → 保持扩展失败诊断，增加系统扩展专用结果标记和测试；是否将失败升级为 init 致命错误不在本 Change 中改变。
- [隐藏扩展降低用户可见性] → 仅从选择列表隐藏，init 结果中保留系统扩展的自动处理摘要。
- [系统 ID 与普通 ID 冲突] → 发现阶段校验两个 catalog 的 ID 集合，不允许重复。
- [用户仍可直接删除或编辑文件] → 文档明确系统插件保护的是 Code Workspace 命令/API，不是文件系统权限。

## Migration Plan

1. 新增系统 catalog 发现、自动计划注入、状态标记和卸载保护。
2. 创建两个 `.system` 扩展包并更新 manifest 摘要。
3. 从核心 managed files manifest 删除旧 Skill 资产。
4. 更新测试、规范和文档；不执行旧 Workspace 迁移。
5. 运行完整测试、CLI 架构检查和 npm pack 检查。

## Open Questions

无。系统扩展失败继续沿用当前扩展 failure-open 语义。
