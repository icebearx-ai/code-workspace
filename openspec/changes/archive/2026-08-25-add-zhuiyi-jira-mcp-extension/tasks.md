## 1. 架构与协议基础

- [x] 1.1 在 `docs` 中新增中文扩展架构阐明文档，明确术语、信任模型、边界、最小能力和完整生命周期
- [x] 1.2 新增静态 manifest v2、初始化 context v1 和 result v1 schema
- [x] 1.3 扩展发现和规划支持 manifest v2、完整扩展包摘要冻结及声明性网络 host

## 2. 扩展执行与候选输出验证

- [x] 2.1 runner 使用独立 context、staging、result 路径执行可信入口并保持既有超时/环境隔离
- [x] 2.2 校验 result 完整匹配本次适用输出，拒绝未知/重复/缺失/额外/越界输出和不支持的文件类型
- [x] 2.3 Host 独立计算文件与规范目录摘要，并在计划到执行之间验证扩展包未变化

## 3. Host 输出、状态与事务闭环

- [x] 3.1 公共输出模型支持独占 `file` 和 `directory`，复用目录事务、回滚、幂等及漂移检查
- [x] 3.2 公共输出模型支持共享 `text-block` 和 `json-member`，完成冲突、合成、升级和卸载
- [x] 3.3 installed 状态记录通用所有权与 Host 摘要，升级处理新增/替换/移除输出，卸载只依赖状态
- [x] 3.4 保留已发布旧 installed 状态的安全读取/卸载兼容，并验证所有写入失败阶段的后置条件和回滚

## 4. Jira MCP 扩展迁移

- [x] 4.1 将受限下载、固定 hash、安全解压和包结构校验迁入 Jira 扩展私有代码/元数据
- [x] 4.2 Jira `init.js` 按新协议生成运行目录、Codex 文本块、Claude JSON 值和 result，不执行 npm 安装或构建
- [x] 4.3 移除核心/schema 中 `remote-archive`、`claude-mcp-server` 及 Jira/MCP/下载领域分支，迁移内置扩展 manifest
- [x] 4.4 保持 CLI 命令和结果契约，更新中英文扩展文档、网络确认和附件保留说明

## 5. 验证

- [x] 5.1 增加 manifest/context/result、包冻结、staging 越界和 Host 摘要测试
- [x] 5.2 增加文件/目录/text-block/json-member 的安装、幂等、冲突、升级、回滚和状态卸载测试
- [x] 5.3 增加 Jira fixture/真实归档下载、hash、恶意归档、配置、凭证和附件保留测试
- [x] 5.4 使用第二个协议扩展证明无需修改核心/schema，并运行 CLI architecture checker、完整测试、pack dry-run、OpenSpec strict validate 和 diff 检查
