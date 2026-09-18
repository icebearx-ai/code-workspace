## Why

phase-07 提供安全的 Nexus/npm Provider 后，用户仍无法通过 Code Workspace 发现、查看、安装或升级远端扩展。需要把 Provider 接入稳定 CLI 与既有 Workspace 扩展事务，形成企业内部 Registry 的完整用户闭环。

## What Changes

- 增加 Workspace 无关的 `extension search [query]` 和 `extension info <name>` 外部读取命令，使用 Nexus Search API 与 npm metadata 返回统一文本和 JSON 结果。
- 扩展 `extension install [name...]`：Registry 已配置时从内置与 Nexus 可信来源解析最高兼容正式版本；增加命令级 `--version <exact-semver>`，继续拒绝 `name@version` 位置参数语法。
- 增加 `extension upgrade [name...]` planned-write 命令，只升级已安装的普通扩展，固定目标版本和 digest 后复用现有逐扩展事务、确认、验证与回滚。
- 默认排除 prerelease 和 deprecated 版本；精确请求 deprecated 或 prerelease 时使用显式选项和诊断，不允许运行时自动漂移到 latest。
- 相同 `id@version` 在多个来源出现且 digest 不一致时失败；已在 Store 中且摘要匹配的精确包可离线复用。
- 系统扩展继续只由内置 Provider 管理；`init` 在本阶段不隐式联网安装远端普通扩展。
- 更新帮助、补全、中英文文档、JSON envelope、错误修复建议以及 parser/网络/事务/故障注入测试。
- 本 Change 是执行顺序第 3 步，依赖 `phase-06-package-extensions-for-nexus` 和 `phase-07-add-nexus-extension-provider`。

## Capabilities

### New Capabilities

- `extension-registry-discovery`: 定义通过 Nexus 搜索和 npm metadata 发现、查看及筛选扩展的用户契约。

### Modified Capabilities

- `workspace-init-extensions`: 扩展独立安装命令的来源、精确版本和升级语义，同时明确系统扩展与 `init` 的远端边界。

## Impact

影响 CLI registry/parser/dispatch/help/completion、扩展命令模块、Provider 与现有计划解析边界、批处理结果、版本选择、交互确认、Workspace 锁和安装事务测试。新增网络读取不得进入命令层直接实现；命令层只编排核心 Registry 与扩展生命周期服务。
