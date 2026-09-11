## MODIFIED Requirements

### Requirement: 发布 Zhuiyi Jira MCP 扩展
npm 包 SHALL 包含基于 Extension Spec v1 的 `zhuiyi-jira-mcp` 扩展，且随包提供的最高受支持版本为 `1.0.0`。扩展入口 SHALL 在扩展私有实现中下载固定预构建包、限制允许的 HTTPS host、验证固定 SHA-256、安全解压和校验包结构，再生成运行目录及所选 Codex/Claude 配置。预构建包 SHALL 自包含运行产物（生产依赖已 bundle 到 `dist/index.js`），安装过程 MUST NOT 运行 `npm install`、`npm ci`、`npm run build` 或归档内生命周期脚本。Host MUST NOT 理解该下载或归档业务。

#### Scenario: 初始化安装 Jira MCP
- **WHEN** Workspace init 选择 `zhuiyi-jira-mcp` 且扩展准备成功
- **THEN** Host 将最高受支持版本 `1.0.0` 的候选目录安装到 `.code-workspace/extensions/zhuiyi-jira-mcp/1.0.0`，并为所选 Agent 安装指向 `dist/index.js` 的配置

#### Scenario: 独立安装 Jira MCP
- **WHEN** 用户执行 `code-w extension install zhuiyi-jira-mcp --yes`
- **THEN** Host 不重跑核心 init，只执行 Extension Spec v1 并提交其运行目录、配置和 installed 状态

#### Scenario: 预构建包安装不执行构建
- **WHEN** Jira 扩展准备远程运行包
- **THEN** 扩展不运行 `npm install`、`npm ci`、`npm run build` 或归档内生命周期脚本

#### Scenario: 升级已安装的 Jira MCP
- **WHEN** Workspace 已安装 `zhuiyi-jira-mcp@0.1.0` 且存在更高的受支持版本 `1.0.0`
- **THEN** Host 在一次事务内安装 `1.0.0` 运行目录、更新配置和 `.gitignore` contribution，并移除 `0.1.0` 运行目录；任一步骤失败时回滚到 `0.1.0`

#### Scenario: 不持久化真实 Jira 凭证
- **WHEN** 扩展生成 Codex 或 Claude 配置
- **THEN** 配置可包含空字符串 `JIRA_COOKIE` 占位符，但 staging、result、installed 状态、诊断和日志均不包含非空 Cookie、Token 或其他真实用户凭证

#### Scenario: 生成 1.0.0 MCP 配置契约
- **WHEN** 扩展为 Codex 或 Claude 生成 MCP 配置
- **THEN** 配置包含 `JIRA_CUSTOM_FIELD_MAPPING`、`JIRA_SUBTASK_ISSUE_TYPE_ID`、`JIRA_CACHE_DIR`、`JIRA_CACHE_TTL`、`JIRA_CACHE_MAX_SNAPSHOTS`、`JIRA_CACHE_STALE_IF_ERROR` 和 `JIRA_REQUEST_TIMEOUT`，且不包含已移除的 `JIRA_REQUIREMENT_FIELDS` 和 `JIRA_ATTACHMENT_DIR`

#### Scenario: 忽略 Jira 缓存目录
- **WHEN** 扩展安装到 Workspace
- **THEN** Host 通过共享文本 contribution 将 `/.mcp-cache-jira/` 写入 `.gitignore`，并保留已有用户内容

#### Scenario: 卸载保留缓存目录
- **WHEN** 用户卸载 Jira 扩展且 Workspace 存在 `.mcp-cache-jira/`
- **THEN** Host 移除已拥有运行目录和配置 contribution，但保留缓存目录
