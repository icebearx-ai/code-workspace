## Context

`zhuiyi-jira-mcp` 扩展把“如何准备内容”封装在扩展私有实现里：它下载固定预构建包、校验 SHA-256、安全解压并生成运行目录与 Codex/Claude 配置。Host 只理解通用的 directory、text-block 和 json-member 输出，并在 installed 状态上做事务性安装、升级和卸载。

1.0.0 的发布包把生产依赖 bundle 进 `dist/index.js`，解压后无需安装依赖；这与既有“扩展自行准备内容、Host 不执行 npm”的边界一致。

## Goals / Non-Goals

- Goal：让随包内置扩展发布并选择 `zhuiyi-jira-mcp@1.0.0`，生成符合 1.0.0 README 的 MCP 配置。
- Goal：保持 Host 逻辑、CLI contract 和通用输出类型不变。
- Goal：已安装 `0.1.0` 的 Workspace 能事务性升级到 `1.0.0`，失败可回滚。
- Non-Goal：不引入新的 Host 输出类型、下载或归档能力。
- Non-Goal：不替换或删除 `0.1.0` 版本目录。

## Decisions

### 保留 0.1.0，新增 1.0.0 版本目录

Host 按“受支持 Extension Spec + 最高扩展 SemVer”选择版本，且 installed 状态记录真实版本与目标。因此新增 `1.0.0` 目录即可让新安装和升级都选择 1.0.0，同时保留 0.1.0 作为历史版本。

### 运行目录目标带版本号

沿用既有约定，目标为 `.code-workspace/extensions/zhuiyi-jira-mcp/1.0.0`。Host 的 directory transition 会移除不再出现在新 plan 中的旧目录（`0.1.0`），因此升级不会遗留旧运行目录。

### 配置契约按 1.0.0 README 对齐

生成的 Codex/Claude `env` 使用 1.0.0 变量：`JIRA_AUTH_TYPE`、空 `JIRA_COOKIE` 占位符、`JIRA_API_VERSION`、`JIRA_ALLOWED_HOSTS`、`JIRA_CUSTOM_FIELD_MAPPING`、`JIRA_SUBTASK_ISSUE_TYPE_ID`、`JIRA_CACHE_*`、`JIRA_REQUEST_TIMEOUT`、`JIRA_ATTACHMENT_MAX_SIZE`、`JIRA_ATTACHMENT_ALLOWED_TYPES`。不再写入 `JIRA_REQUIREMENT_FIELDS` 和 `JIRA_ATTACHMENT_DIR`。

### gitignore 跟随缓存目录

1.0.0 把需求与附件缓存写入 `.mcp-cache-jira/`，因此共享 text-block contribution 从 `/.jira-attachments/` 改为 `/.mcp-cache-jira/`；卸载仍保留该运行期用户数据目录。

## Risks / Trade-offs

- 若 Gitee 重新发布同名 `1.0.0` 包，固定 SHA-256 会因校验失败而拒绝安装；这是有意的完整性约束。
- 旧 Workspace 的 `.jira-attachments/` 目录作为用户数据保留，不再由扩展管理，也不会被自动迁移到新缓存目录。

## Migration Plan

1. 新增 `extensions/zhuiyi-jira-mcp/1.0.0` 版本目录及其 release/manifest/入口/模板。
2. 更新扩展归档测试为 1.0.0 契约。
3. 运行 OpenSpec strict validate、CLI 架构检查、完整测试、diff check 和打包检查；用真实 Gitee 包验证固定 SHA-256 与包契约。

## Open Questions

- 无。
