## 1. 扩展包

- [x] 1.1 新增 `extensions/zhuiyi-jira-mcp/1.0.0` 版本目录，固定 Gitee 1.0.0 URL、SHA-256、根目录、入口和包身份
- [x] 1.2 新增 manifest（version 1.0.0、入口 SHA-256、运行目录目标）和 init 入口
- [x] 1.3 复制并更新私有归档校验辅助代码

## 2. 配置契约

- [x] 2.1 更新 Codex `config.toml` 模板为 1.0.0 环境变量契约
- [x] 2.2 更新 Claude `server.json` 模板为 1.0.0 环境变量契约
- [x] 2.3 将 `.gitignore` contribution 更新为 `/.mcp-cache-jira/`

## 3. 测试与文档

- [x] 3.1 更新扩展归档测试为新版本、SHA-256、配置契约和缓存目录
- [x] 3.2 增加 `0.1.0` → `1.0.0` 升级覆盖
- [x] 3.3 运行 OpenSpec strict validate、CLI 架构检查、完整测试和打包检查，并用真实 Gitee 包验证固定 SHA-256 与包契约
