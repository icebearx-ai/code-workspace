## 1. 扩展领域模型与发现

- [x] 1.1 实现扩展名、严格 SemVer、兼容范围、manifest schema 和 hash 校验
- [x] 1.2 实现包内扩展发现、最高兼容版本解析和确认前冻结的扩展计划
- [x] 1.3 实现安全 target 校验、核心托管文件保护及扩展间所有权冲突检查

## 2. 隔离执行与事务安装

- [x] 2.1 实现最小 context、独立 staging、Node 子进程执行、超时终止和临时目录回收
- [x] 2.2 实现缺失/额外/符号链接/非文件/hash 错误的输出协议校验
- [x] 2.3 实现逐扩展 artifact 与 ext-manifest 原子事务、后置条件验证和失败回滚
- [x] 2.4 实现 installed/lastAttempt 状态模型、升级失败保留旧状态及回滚不完整诊断

## 3. init CLI 集成

- [x] 3.1 在 registry/parser 中声明并解析 `--extensions <comma-list|none>`，覆盖非法版本语法
- [x] 3.2 扩展 init 计划与交互多选，在确认前展示并冻结最终版本和 manifest hash
- [x] 3.3 核心成功提交后执行扩展批次，返回稳定 ordered results、summary 和 warning diagnostics
- [x] 3.4 实现新 Workspace、已有安装默认升级、显式 none 及未选择不卸载语义

## 4. 内置扩展与发布

- [x] 4.1 新增版本化 `openspec-workspace` manifest、入口和 Codex/Claude skill 模板，并生成真实 hash
- [x] 4.2 将 `extensions/` 纳入 npm 发布清单并补充中英文实验边界与 CLI 示例

## 5. 验证

- [x] 5.1 添加发现、manifest、路径、冲突、SemVer 和输出验证单元测试
- [x] 5.2 添加超时/崩溃/写入/状态/后置验证失败、升级回滚和继续批处理测试
- [x] 5.3 添加 CLI 参数顺序、确认、默认值、JSON/text 结果、配置隔离和核心失败跳过测试
- [x] 5.4 运行 OpenSpec validation、CLI architecture checker、完整测试与 npm pack 校验

## 6. 契约与故障隔离

- [x] 6.1 为 manifest artifact 增加 kind/output 与 entrySha256，发布 JSON Schema 和开发契约
- [x] 6.2 验证扩展入口 hash并使用环境变量白名单运行子进程
- [x] 6.3 将仓库、状态和已选扩展准备失败隔离为扩展结果，保留非法 CLI 选择的写前失败

## 7. Host 托管共享制品

- [x] 7.1 抽取 artifact adapter 并保持 file 安装/升级行为兼容
- [x] 7.2 实现 codex-config-block 的标记块安装、完整 TOML 验证、冲突和回滚
- [x] 7.3 实现 codex-hooks 的核心/扩展稳定合成、状态保存、漂移检测和回滚

## 8. 扩展卸载

- [x] 8.1 注册并实现 `extension uninstall <name>` 的确认、JSON/text 结果和稳定错误
- [x] 8.2 实现基于 installed 状态的完整删除计划、单事务应用、后置验证和空目录清理
- [x] 8.3 覆盖无包卸载、幂等、本地修改拒绝、共享目标重建和失败回滚

## 9. 发布验收

- [x] 9.1 迁移内置扩展 manifest 与制品，补充中英文用户文档和扩展开发文档
- [x] 9.2 运行 OpenSpec validation、CLI architecture checker、完整测试与 npm pack 校验

## 10. 独立扩展安装

- [x] 10.1 补充 `extension install [name...]` 的选择、取消、结果、锁和非交互契约
- [x] 10.2 注册并实现显式名称安装、无参数交互多选、ESC/空选择退出和共享操作锁
- [x] 10.3 覆盖 parser、确认、交互、重装、幂等、部分失败、配置隔离和锁测试，并更新中英文文档
- [x] 10.4 运行 OpenSpec validation、CLI architecture checker、完整测试与 npm pack 校验
