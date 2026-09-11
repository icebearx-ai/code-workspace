## ADDED Requirements

### Requirement: 核心 Legacy 只有在兼容门槛满足后移除
系统 MUST 在移除核心 Monitor 配置、CLI、业务源码、公共导出或打包资源前验证：Monitor 扩展已成为默认路径、至少一个兼容发布周期无阻断迁移问题、扩展行为和生命周期测试对等、回滚手册已更新、旧命令和公共 API 已完成 deprecation。任一条件不满足时 MUST 不执行清理。

#### Scenario: 所有门槛满足
- **WHEN** 发布负责人提供默认采用、兼容期、对等测试、回滚手册和 deprecation 证据
- **THEN** 变更可以进入核心 Legacy 分面删除

#### Scenario: 存在未解决迁移问题
- **WHEN** 兼容期内仍存在阻断旧 Workspace 迁移的已知问题
- **THEN** 系统保留核心 Legacy 并阻止清理变更实施

### Requirement: 删除核心 Legacy 不得删除用户数据
移除核心 Monitor 实现时，系统 MUST NOT 删除扩展配置、用户 Hook、扩展 installed 状态或 Monitor 运行期用户数据。不得通过核心删除逻辑代替扩展卸载或数据清理。

#### Scenario: 删除核心业务源码
- **WHEN** 维护者移除核心 Monitor Server、Page、i18n 和旧 CLI 实现
- **THEN** `.code-workspace` 中的扩展配置和用户数据保持不变

#### Scenario: 用户仍依赖旧公共 API
- **WHEN** 公共 API 达到 deprecation 期限并随主版本移除
- **THEN** 发布说明提供扩展入口和迁移路径，且删除操作不修改用户 Workspace 数据
