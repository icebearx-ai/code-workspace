## 1. Configuration Contract

- [ ] 1.1 定义 config runtime capability、文件名、默认内容来源和安全路径约束。
- [ ] 1.2 确定配置文件与核心 `config.yaml`、state 和扩展版本目录的边界。
- [ ] 1.3 更新 manifest schema、Extension Spec 和配置生命周期文档。
- [ ] 1.4 确定缺失、损坏、未知字段和权限错误的隔离规则与稳定错误码。

## 2. Install and Persistence

- [ ] 2.1 将扩展配置路径和存在状态纳入安装计划、确认信息和计划摘要。
- [ ] 2.2 在文件不存在时事务性创建默认配置，并验证后置条件。
- [ ] 2.3 保证升级不覆盖已有配置、不把用户修改判断为 exclusive artifact 漂移。
- [ ] 2.4 保证卸载默认保留配置并返回明确保留路径。
- [ ] 2.5 保证安装或升级失败时恢复配置创建，且不删除用户已有文件。

## 3. Runtime Isolation

- [ ] 3.1 向扩展 runtime 提供配置文件路径，不暴露核心配置对象或内部存储。
- [ ] 3.2 确保损坏配置只影响对应扩展 CLI/observer，不阻断 core init/update 和其他扩展。
- [ ] 3.3 增加配置路径逃逸、符号链接、核心文件冲突和路径重叠校验。

## 4. Fixture and Regression

- [ ] 4.1 增加声明配置的 fixture 扩展，覆盖首次创建、升级保留和卸载保留。
- [ ] 4.2 覆盖文件不存在、只读、解析损坏、路径冲突和事务注入失败。
- [ ] 4.3 验证无 config capability 的现有扩展和所有核心命令行为不变。
- [ ] 4.4 运行完整测试、CLI architecture checker 和 package dry-run。
