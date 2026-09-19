## MODIFIED Requirements

### Requirement: init 提供明确的扩展选择语义
交互式 `init` SHALL 通过共享 Nexus extension picker 展示普通扩展；picker SHALL 支持搜索、用户可见分页、左/右键翻页、多选和安装状态。已安装最新版普通扩展不得选中，已安装旧版本普通扩展可以选中并产生 update 动作。系统扩展 SHALL 隐藏并自动加入计划。非交互式 `init` SHALL 接受 `--extensions <comma-list|none>` 并由 Nexus/Store lifecycle 解析。

#### Scenario: 交互式 init 展示线上扩展
- **WHEN** 用户在 TTY 中运行 init 且 Nexus 可用
- **THEN** 普通扩展列表来自 Nexus picker，不读取普通包内目录，并显示页码和安装状态

#### Scenario: 系统扩展隐藏但自动安装
- **WHEN** 用户在 picker 中浏览扩展
- **THEN** `codew-workspace-guard` 不显示在普通列表，但确认后仍执行系统扩展计划

#### Scenario: 已安装最新版不可选
- **WHEN** Workspace 已安装的版本和 digest 与 Nexus 候选一致
- **THEN** 该扩展显示已安装最新版且不能被勾选

#### Scenario: 已安装旧版本可更新
- **WHEN** Workspace 已安装旧版本且 Nexus 有更高可验证候选
- **THEN** 该扩展显示版本迁移并可勾选，确认后进入 update 计划

#### Scenario: Nexus 失败可跳过普通扩展
- **WHEN** 首次加载或翻页请求 Nexus 失败
- **THEN** init 显示稳定诊断并允许用户跳过普通扩展，核心 Workspace 初始化仍可继续

### Requirement: 核心成功与扩展结果相互隔离
系统 SHALL 继续仅在核心初始化成功后执行系统和普通扩展；Nexus picker、远端准备或普通扩展失败不得回滚已成功的核心初始化。

#### Scenario: 普通扩展准备失败
- **WHEN** 用户确认后某个 Nexus 扩展下载或验证失败
- **THEN** 核心 init 保持成功，扩展结果按既有批处理顺序报告 warning/error
