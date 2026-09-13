## MODIFIED Requirements

### Requirement: 发现内置扩展并解析兼容版本
系统 SHALL 从当前发布包的内置扩展目录发现可信包，并可将受支持版本导入用户级 Extension Store。安装计划 SHALL 固定扩展 ID、精确 SemVer、Extension Spec 版本、manifest SHA-256、入口 SHA-256 和完整 package digest；Workspace 不得作为扩展包发现或源码存储位置。

#### Scenario: 选择并导入最高受支持版本
- **WHEN** 内置目录存在多个受支持版本且用户请求安装扩展
- **THEN** Host 选择最高受支持版本，将其导入 Store，并在 Workspace activation 中记录精确版本和摘要

#### Scenario: Workspace 不重复保存包
- **WHEN** 两个 Workspace 安装相同扩展版本
- **THEN** 两个 Workspace 各自提交 activation 制品，但不各自复制扩展源码和依赖目录

### Requirement: 扩展可事务性卸载
系统 SHALL 提供 `extension uninstall <name>` planned-write 命令。卸载 SHALL 依据 Workspace installed activation 验证并移除该 Workspace 的独占文件、独占目录和共享 contribution，再删除 activation；不得因为该扩展仍被其他 Workspace 使用而删除其 Store 包或其他 Workspace 制品。

#### Scenario: 一个 Workspace 卸载共享扩展
- **WHEN** Workspace A 卸载扩展且 Workspace B 仍引用相同 Store 包
- **THEN** 系统只移除 A 的 activation 和制品，Store 包及 B 的 activation 保持可用

#### Scenario: 最后一个 Workspace 卸载
- **WHEN** 没有 Workspace 再引用某个 Store 包
- **THEN** 卸载命令完成 Workspace 事务，包是否删除由引用感知的 GC 决定，而不是由卸载命令直接删除
