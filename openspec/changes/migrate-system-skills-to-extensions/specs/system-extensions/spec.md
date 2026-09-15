## ADDED Requirements

### Requirement: 系统扩展使用独立隐藏目录发现

系统 SHALL 从 `extensions/.system/<name>/<version>/` 发现系统扩展，并使用与普通扩展相同的 manifest、版本、入口、摘要和 Extension Spec 校验。系统扩展 SHALL 不出现在普通扩展 catalog 中；系统 catalog 与普通 catalog 不得包含重复 ID。

#### Scenario: 发现系统扩展
- **WHEN** 发布包包含合法的 `extensions/.system/codew-add-projects/1.0.0`
- **THEN** Host 将其加入系统 catalog，并冻结与普通扩展相同的 manifest、入口和包摘要

#### Scenario: 系统扩展不进入普通选择列表
- **WHEN** 用户执行交互式 `init` 或不带参数的 `extension install`
- **THEN** 普通扩展选择列表不展示任何系统扩展

### Requirement: init 自动安装系统扩展

`init` SHALL 自动请求所有适用于当前 Agent 工具的系统扩展。系统扩展 SHALL 不受普通扩展选择和 `--extensions none` 影响；系统扩展 SHALL 复用普通扩展的计划冻结、Store 导入、隔离执行、逐扩展事务和 installed state。

#### Scenario: 新 Workspace 自动安装系统扩展
- **WHEN** 新 Workspace 使用 Codex 或 Claude 初始化且未选择普通扩展
- **THEN** init 请求对应工具的系统 Skill 扩展并安装其适用制品

#### Scenario: none 不取消系统扩展
- **WHEN** 用户执行 `init --extensions none --yes`
- **THEN** 普通扩展请求为空，但适用的系统扩展仍被请求、安装或跳过为 current

#### Scenario: 没有 Agent 工具
- **WHEN** 用户执行 `init --tools none --yes`
- **THEN** 系统扩展不产生 `EXTENSION_NO_APPLICABLE_OUTPUTS` 错误，并以无适用输出的 skipped 结果完成

### Requirement: 系统扩展不能被手动安装或卸载

系统 SHALL 拒绝通过 `extension install` 显式安装系统扩展，并在 `extension uninstall` 的计划或应用阶段拒绝系统扩展。拒绝必须发生在任何 Workspace 制品或状态写入前，并返回稳定错误 `EXTENSION_SYSTEM_MANAGED`。

#### Scenario: 显式安装被拒绝
- **WHEN** 用户执行 `extension install codew-add-projects --yes`
- **THEN** 命令以 `EXTENSION_SYSTEM_MANAGED` 失败且不写入 Workspace

#### Scenario: 手动卸载被拒绝
- **WHEN** 用户执行 `extension uninstall codew-resolve-branch --yes`
- **THEN** 命令以 `EXTENSION_SYSTEM_MANAGED` 失败且不修改制品或 installed state

### Requirement: 系统管理属性持久化

系统扩展成功安装后的 installed record SHALL 持久化 `system: true`。Host SHALL 在重新读取 Workspace state、升级和卸载判断时使用该属性，不依赖系统扩展源码仍存在或 Store 路径仍包含 `.system`。

#### Scenario: Store 导入后仍识别系统扩展
- **WHEN** 系统扩展包被导入用户级 Extension Store 并完成安装
- **THEN** Workspace installed state 仍标记该扩展为系统管理

#### Scenario: 缺少系统源码不放开卸载
- **WHEN** Workspace state 中存在 `system: true` 的已安装记录但当前发布包不含该扩展
- **THEN** 卸载 API 仍以 `EXTENSION_SYSTEM_MANAGED` 拒绝操作
