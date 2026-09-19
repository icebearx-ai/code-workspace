## Context

普通扩展源码已由用户删除，系统扩展从 `extensions/.system` 移到 `extensions/`。现有发现逻辑仍按目录位置区分系统/普通扩展，必须改为按显式系统 ID 区分。Nexus Provider、Store 导入和扩展事务已经存在，本 Change 只清理来源边界，不重新实现远端生命周期。

## Goals / Non-Goals

**Goals:**

- 仅保留系统扩展的包内来源。
- 普通扩展解析只使用 Nexus metadata、下载包和已验证 Store。
- 保留系统扩展的受保护目标、自动生命周期和远端同名隔离。
- 删除测试阶段不再需要的普通内置代码路径。

**Non-Goals:**

- 不实现分页 UI。
- 不实现 `init` 新选择器。
- 不考虑旧 Workspace 或旧 Store 的兼容迁移。
- 不改变 Extension Spec 或 Nexus 包格式。

## Decisions

1. 使用显式 `SYSTEM_EXTENSION_IDS`（当前包含 `codew-workspace-guard`）识别系统扩展，而不是继续依赖 `.system` 目录。
2. `discoverExtensions` 过滤系统 ID；`discoverSystemExtensions` 从同一 `extensions/` 根目录筛选系统 ID，并继续应用 protected-target 校验。
3. 普通扩展的 builtin Provider、内置迁移兜底和 runtime 自动补种被移除或改为仅处理系统扩展；Nexus/Store 生命周期服务保持唯一普通扩展入口。
4. `pack:extensions` 仅打包非系统来源（当前普通目录为空时返回明确的无可发布包结果），不把系统扩展发布到 Nexus。
5. 由于处于测试阶段，发现到普通内置目录缺失时直接按新规则处理，不增加兼容 fallback。

## Risks / Trade-offs

- [系统 ID 硬编码需要后续维护] → 当前测试阶段只保留一个系统扩展；未来可单独引入 manifest 元数据或产品配置。
- [删除普通目录后旧测试大量失败] → 同步删除/改写只验证普通 builtin 来源的测试，保留 Nexus/Store 生命周期测试。
- [误把系统扩展当普通扩展] → 增加发现、打包、install/uninstall/upgrade 和 runtime 的边界测试。

## Migration Plan

1. 先建立系统 ID 识别和目录发现测试。
2. 切换 init、runtime、Store 相关入口。
3. 删除普通内置实现和普通目录引用。
4. 运行架构检查、完整测试和 npm pack 检查。
5. 失败时回滚本 Change 的代码删除，不恢复普通扩展功能；下一阶段继续使用 Nexus。
