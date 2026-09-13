## ADDED Requirements

### Requirement: Host 提供不可变的用户级扩展包 Store
Code Workspace SHALL 提供由 Host 管理的用户级 Extension Store。Store 中的包 MUST 按扩展 ID 和 SemVer 版本隔离保存，包版本目录在完整性校验通过后 MUST 不可变；当前发布包内置 `extensions/<id>/<version>/` SHALL 作为第一版可信 Package Provider。Store MUST NOT 使用 Workspace 目录作为包源码存储。

#### Scenario: 导入内置扩展包
- **WHEN** Host 首次为 Workspace 安装内置扩展 `example@1.0.0`
- **THEN** Host 将完整包导入用户级 Store，校验 manifest、入口和 package digest，并记录可复用的包版本

#### Scenario: 同一扩展多版本共存
- **WHEN** Store 已有 `monitor@1.0.0` 且再次导入 `monitor@2.0.0`
- **THEN** 两个不可变版本均可保留，导入一个版本不得覆盖另一个版本

#### Scenario: 包摘要不匹配
- **WHEN** 待导入目录的完整摘要与冻结计划或已记录摘要不一致
- **THEN** Host 拒绝导入并不创建可用的 Store 包记录

### Requirement: Store 包引用和垃圾回收可验证
Host SHALL 为每个 Store 包记录 Workspace activation、运行进程、未完成事务和显式 pin 等引用。GC MUST 仅删除不存在任何引用且未被锁定的包；GC 失败 MUST 保留包并报告诊断。

#### Scenario: Workspace 卸载后仍有运行进程
- **WHEN** 最后一个 Workspace activation 被移除但该版本 Runtime 进程仍在运行
- **THEN** GC 不删除该包，直到运行进程引用被释放

#### Scenario: 无引用包被清理
- **WHEN** 包没有 Workspace、进程、事务或显式 pin 引用
- **THEN** Host 可以删除该包及其 registry 记录，并验证 Store 不再可见该版本

### Requirement: Store 安装使用独立锁和原子提交
Host SHALL 对同一包版本的导入、验证和 registry 更新使用可重入或可检测的全局锁。包必须先写入临时目录并完成验证，再原子移动到正式版本目录；并发请求 MUST 得到同一已验证包结果。

#### Scenario: 并发导入同一版本
- **WHEN** 两个 Workspace 同时请求导入相同扩展版本
- **THEN** Host 不产生半成品目录，两个请求均引用同一完整且摘要匹配的 Store 包

#### Scenario: 导入中断
- **WHEN** 包导入或摘要校验过程中进程异常退出
- **THEN** Store 不暴露未完成版本，临时目录可被后续清理
