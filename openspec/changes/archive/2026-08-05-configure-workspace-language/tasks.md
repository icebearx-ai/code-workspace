## 1. 本地配置与迁移模型

- [x] 1.1 扩展 workspace 配置规范化、校验和 YAML 往返逻辑，支持必需的 `workspace.language`
- [x] 1.2 将语言解析改为以 `workspace.language` 为唯一正常运行时来源，并保留受限的一次性旧来源迁移读取
- [x] 1.3 实现旧 `state.json.workspaceLanguage` 与 `openspec/config.yaml` 语言的迁移、冲突检测和成功后的旧状态清理
- [x] 1.4 增加配置合法值、非法值、序列化保留、旧配置迁移和冲突失败测试

## 2. Init、Language 与 Doctor 命令

- [x] 2.1 调整首次 init，将已选择或默认的语言写入 `workspace.language`
- [x] 2.2 让已有工作区上的 init 语言变更复用 update 的安全更新路径
- [x] 2.3 调整 `openspec-w language` 的文本和 JSON 输出，从本地配置读取语言并返回对应 project context 标签
- [x] 2.4 调整 doctor，以配置语言验证派生 OpenSpec 指令和 managed artifacts，并停止要求 state 保存语言
- [x] 2.5 增加 init、language 和 doctor 的命令级回归测试

## 3. 安全的语言更新事务

- [x] 3.1 为 `openspec-w update` 增加 `--language <lang>` 参数并构造尚未写入的候选配置
- [x] 3.2 使用候选语言生成完整 managed artifacts 计划，在任何配置或文件写入前完成 current、managed-old、replaceable、missing、unknown 分类
- [x] 3.3 在 unknown 且没有 `--force` 时中止全部更新，列出阻塞目标、确认无更改并给出带目标语言的 `--force` 重试提示
- [x] 3.4 保持现有全局 `--force` 覆盖语义，并在计划或输出中明确所有将被强制覆盖的 unknown 文件
- [x] 3.5 将本地配置、managed state 和 artifacts 纳入同一外层快照/恢复边界，防止预检或写入失败留下语言部分更新
- [x] 3.6 增加普通 update 保留语言、安全语言切换、unknown 阻塞、force 覆盖和失败恢复测试

## 4. 语言相关产物

- [x] 4.1 从 `workspace.language` 渲染 `openspec/config.yaml` 的 `Language:` 指令，并验证后续 OpenSpec 产物使用该语言
- [x] 4.2 保持 add-projects 从 language JSON 获取 locale 标签和当前语言，验证新增 context 跟随语言而已有 context 不被 update 改写
- [x] 4.3 将工作区人类指南收敛为稳定目标 `USER_GUIDE.md`，按 workspace language 选择包内源模板
- [x] 4.4 通过现有 obsolete 和 unknown 保护规则处理旧 `USER_GUIDE.zh-CN.md`，禁止静默删除本地修改
- [x] 4.5 更新 manifest、checksum、patch 输出及相关一致性测试

## 5. 文档与完整验证

- [x] 5.1 更新英文和中文 README/USER_GUIDE，说明 `workspace.language`、init 首次设置、update 修改和不自动翻译历史内容的语义
- [x] 5.2 明确记录 Monitor language 独立且 Monitor i18n 分离不属于本次变更
- [ ] 5.3 运行完整测试、patch consistency、managed-file 检查和 package dry-run
