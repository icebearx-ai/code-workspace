## 1. Default Selection

- [ ] 1.1 将旧 Monitor 默认启用条件映射为 Monitor 扩展选择条件，并保留所有显式用户选择。
- [ ] 1.2 在 init/update 计划中冻结扩展选择、配置创建、Hook 变更和迁移来源。
- [ ] 1.3 确保 `--no-monitor`、`--extensions none`、交互取消和非 Codex 工具不隐式安装。
- [ ] 1.4 增加默认采用前预检和可诊断迁移计划数据。

## 2. Legacy Migration

- [ ] 2.1 识别旧 `config.monitor`、旧 managed Hook 和现有新扩展配置的优先级。
- [ ] 2.2 在单一外层事务中迁移扩展配置、Observer Hook、扩展状态和核心配置域。
- [ ] 2.3 保证迁移成功前旧来源不删除，失败后全部文件恢复到迁移前状态。
- [ ] 2.4 覆盖不存在旧配置、新旧并存、用户 Hook、部分旧 Hook 和多 Workspace 场景。

## 3. Compatibility and Rollback

- [ ] 3.1 将 `code-w monitor` 实现为薄兼容别名，保留既有常用参数和错误语义。
- [ ] 3.2 卸载扩展时保留配置、运行期数据和用户 Hook，并明确核心回退行为。
- [ ] 3.3 提供从扩展默认路径回退到核心路径的补偿步骤和数据保留规则。
- [ ] 3.4 记录 deprecation 窗口、扩展 API 兼容边界和后续删除前置条件。

## 4. Verification

- [ ] 4.1 覆盖新 Workspace、旧 Workspace、重复 init/update 和幂等路径。
- [ ] 4.2 覆盖配置、Hook、状态写入失败注入及完整回滚后置验证。
- [ ] 4.3 对核心回退路径和扩展默认路径分别运行 Monitor 行为测试。
- [ ] 4.4 运行完整测试、CLI architecture checker、OpenSpec validate 和 package dry-run。
