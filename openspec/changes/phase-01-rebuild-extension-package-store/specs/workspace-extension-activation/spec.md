## ADDED Requirements

### Requirement: Workspace activation 精确引用 Store 包
Workspace 的扩展状态 SHALL 记录扩展 ID、精确版本和完整 package digest，并将生成的 artifacts、contribution 和 Hook 作为 Workspace-owned activation 事实。Workspace activation MUST NOT 复制扩展源码或依赖目录。

#### Scenario: 新 Workspace 激活扩展
- **WHEN** Workspace 安装 `example@1.0.0`
- **THEN** `ext-manifest.json` 记录 `example` 的精确版本和 package digest，Workspace 只接收声明制品与 Hook

#### Scenario: 同一包被多个 Workspace 激活
- **WHEN** Workspace A 和 Workspace B 都安装 `example@1.0.0`
- **THEN** 两个 Workspace 各自记录 activation，但共享同一个 Store 包且互不覆盖对方制品

#### Scenario: Workspace 激活固定版本
- **WHEN** Store 后续增加 `example@2.0.0`
- **THEN** 已激活 Workspace 继续使用其记录的 `1.0.0`，除非用户显式执行升级

### Requirement: Activation 安装保持 Workspace 事务语义
Host SHALL 从 Store 包执行 init，在 staging 中验证输出后，以单 Workspace 文件事务提交 activation、制品和状态。Store 导入成功但 Workspace 事务失败时 MUST 不保存 activation，且不得删除其他扩展或核心文件。

#### Scenario: 制品提交失败
- **WHEN** Store 包有效但 Workspace 共享 contribution 或状态写入失败
- **THEN** Workspace 恢复到安装前状态，失败尝试可诊断，Store 包可作为无引用缓存保留

#### Scenario: 卸载 activation
- **WHEN** Workspace 卸载已安装扩展且制品未发生未知修改
- **THEN** Host 仅移除该 Workspace 拥有的制品、Hook 和 activation，并减少对应 Store 引用

### Requirement: 旧 Workspace 状态可安全迁移或保留
Host SHALL 能识别旧 Workspace installed record。迁移只有在能够定位并验证对应 Store 包、重建制品并完成后置验证时才提交；迁移失败 MUST 保留旧制品和旧状态。

#### Scenario: 旧内置包可定位
- **WHEN** 旧 Workspace 包版本仍存在于当前发布包内置目录
- **THEN** Host 导入该包到 Store，重建 activation 制品并提交新状态

#### Scenario: 旧包无法定位
- **WHEN** 旧 Workspace 记录的扩展包无法找到或摘要不匹配
- **THEN** Host 保留旧 installed 状态和制品，并报告需要恢复包的迁移诊断
