## Why

Gitee 上的 `zhuiyi-jira-mcp` 已发布自包含的 `1.0.0` 预构建包：运行产物（含生产依赖）已经 bundle 到 `dist/index.js`，安装时不需要 `npm install`。同时 1.0.0 的 MCP 环境变量契约发生变化（自定义字段映射、子任务类型、缓存与请求超时），当前内置扩展仍固定发布 `0.1.0` 并使用旧的附件目录变量，工作区无法获得新的快照、评论和子任务工具能力。

## What Changes

- 随包新增 `extensions/zhuiyi-jira-mcp/1.0.0`，固定 Gitee `zhuiyi-jira-mcp-1.0.0.tar.gz` 的 URL、SHA-256、根目录、入口和包身份。
- 预构建包自包含运行产物，安装过程不执行 `npm install`、`npm ci`、`npm run build` 或归档内生命周期脚本。
- 更新 Codex/Claude 生成的 MCP 配置为 1.0.0 契约：新增 `JIRA_CUSTOM_FIELD_MAPPING`、`JIRA_SUBTASK_ISSUE_TYPE_ID`、`JIRA_CACHE_DIR`、`JIRA_CACHE_TTL`、`JIRA_CACHE_MAX_SNAPSHOTS`、`JIRA_CACHE_STALE_IF_ERROR`、`JIRA_REQUEST_TIMEOUT`，移除 `JIRA_REQUIREMENT_FIELDS` 和 `JIRA_ATTACHMENT_DIR`。
- 运行目录目标更新为 `.code-workspace/extensions/zhuiyi-jira-mcp/1.0.0`；`.gitignore` 共享 contribution 由 `/.jira-attachments/` 改为 `/.mcp-cache-jira/`。
- 保留 `0.1.0` 版本目录，Host 继续按最高受支持 SemVer 选择和事务性升级。
- 更新扩展归档测试，覆盖新的版本、SHA-256、配置契约、缓存目录和 `0.1.0` → `1.0.0` 升级。

## Capabilities

### New Capabilities

- 无。

### Modified Capabilities

- `workspace-init-extensions`：内置 Jira MCP 扩展的发布版本、运行目录目标、MCP 配置契约和 gitignore 目录更新为 1.0.0。

## Impact

- 新增 `extensions/zhuiyi-jira-mcp/1.0.0/**`，更新 `src/__test__/extension-archive.test.js`。
- Host 扩展发现、计划、安装、升级、卸载逻辑和 CLI contract 保持不变；扩展仍只声明通用 `directory`、`text-block` 和 `json-member` 输出。
- 已安装 `0.1.0` 的 Workspace 在下一次扩展安装/升级时迁移到 `1.0.0`，失败时回滚到 `0.1.0`。
