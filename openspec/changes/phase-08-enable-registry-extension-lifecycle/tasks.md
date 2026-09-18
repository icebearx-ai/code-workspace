## 1. CLI 合同与架构边界

- [x] 1.1 确认 phase-06 与 phase-07 已完成，并只通过其 pack/Provider 公共接口访问 Nexus
- [x] 1.2 在 CLI registry 声明 `extension search [query]`、`extension info <name>` 和 `extension upgrade <name...>` 完整合同
- [x] 1.3 为 `extension install` 声明 `--version`、`--allow-deprecated` 和 `--offline`，在 parser/handler 前置拒绝歧义组合
- [x] 1.4 更新 dispatch、help、completion 和架构 checker，禁止命令模块解析 `.npmrc`、Nexus payload、tarball 或直接写 Workspace
- [x] 1.5 为所有新增/修改命令写下 JSON data、稳定错误、remediation 和 text rendering 合同

## 2. Registry 发现命令

- [x] 2.1 实现 core discovery service，将 Nexus search page 与 npm metadata 转换为统一扩展级模型
- [x] 2.2 实现 `extension search` handler、结果上限/截断、scope 过滤和文本/JSON 输出
- [x] 2.3 实现 `extension info` handler、版本排序、metadata-level 兼容、deprecated/prerelease 展示和 not-found 诊断
- [x] 2.4 覆盖无 Workspace、Registry 未配置、认证失败、分页、重复组件、未知响应字段和秘密脱敏

## 3. 多 Provider 版本解析

- [x] 3.1 实现 builtin、Nexus metadata 与 Store candidate 的身份合并和同版本 digest 冲突检测
- [x] 3.2 实现默认最高兼容稳定且非 deprecated 解析，不使用可变 latest tag 作为 activation 事实
- [x] 3.3 实现单目标精确 SemVer、prerelease 和 `--allow-deprecated` 规则，继续拒绝 range 与 `name@version`
- [x] 3.4 实现 `--offline` 的 local-only 解析和结果标记，禁止网络并避免声称 Registry latest
- [x] 3.5 保持系统扩展只从 builtin Provider 解析，并证明远端同名包不能覆盖系统身份

## 4. 远端安装接入

- [x] 4.1 将远端 candidate 下载、验证和 Store 导入加入 install 的 Workspace 写入前准备阶段
- [x] 4.2 在确认计划中展示来源、精确版本、package digest、能力、网络 host、outputs 与 hooks
- [x] 4.3 复用现有 Workspace 锁、逐扩展事务、后置验证、lastAttempt、回滚和最佳努力批处理
- [x] 4.4 处理 Store 导入成功但 Workspace activation 失败的无引用缓存，不误删其他引用包
- [x] 4.5 覆盖 Registry 配置时网络失败不静默降级、精确缓存离线复用和现有无 Registry 行为兼容

## 5. Upgrade 生命周期

- [x] 5.1 实现已安装普通扩展选择、默认目标冻结、current skip 和未安装/系统扩展拒绝
- [x] 5.2 使用 install 的同一 plan/apply/verify 服务实现 ordered best-effort upgrade，避免重复事务代码
- [x] 5.3 覆盖制品漂移、下载失败、Store 冲突、状态写入失败、后置验证失败和回滚不完整
- [x] 5.4 验证 upgrade 不改变未选择扩展、核心 Workspace 文件或运行期用户数据

## 6. 文档与最终验证

- [x] 6.1 更新 README 中英文版、扩展开发文档和 Nexus 运维文档的 search/info/install/upgrade/offline 示例
- [x] 6.2 使用真实 parser 校验所有文档命令，并覆盖 option ordering、unknown options、extra positionals 和 JSON/non-TTY 行为
- [x] 6.3 运行 CLI architecture checker、网络与事务故障注入测试、完整测试和 npm pack check
- [ ] 6.4 使用公司 Nexus Reader 账号完成 search、info、首次安装、幂等安装、升级、deprecated、离线缓存和卸载验收
