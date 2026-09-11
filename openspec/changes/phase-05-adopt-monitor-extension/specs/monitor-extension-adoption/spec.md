## ADDED Requirements

### Requirement: Monitor 扩展按兼容条件成为默认路径
在原有核心 Monitor 会默认启用且用户未显式禁用或选择其他扩展的条件下，init/update SHALL 默认选择 `monitor` 扩展。显式 `--no-monitor`、`--extensions none`、交互选择禁用或其他明确的用户选择 MUST 优先，系统不得覆盖。

#### Scenario: 新 Codex Workspace 默认选择扩展
- **WHEN** 用户以与旧默认启用 Monitor 相同的条件初始化 Codex Workspace
- **THEN** 安装计划包含 Monitor 扩展及其 Observer Hook，不新增核心 `monitor` 域

#### Scenario: 用户显式禁用 Monitor
- **WHEN** 用户传入 `--no-monitor`
- **THEN** 系统不选择 Monitor 扩展、不创建配置且不安装 Monitor Observer Hook

### Requirement: 旧配置和 Hook 原子迁移
系统 SHALL 识别旧 `config.monitor` 和旧 Monitor Hook，并将其迁移为扩展配置和 observer Hook。迁移 MUST 在一个外层文件事务中覆盖核心配置、扩展配置、原生 Hook、扩展状态和旧 managed asset 状态。已存在的新扩展配置 MUST 优先，不得被旧值覆盖。任一步失败 MUST 回滚全部变化并保留旧来源。

#### Scenario: 旧 Workspace 升级
- **WHEN** Workspace 包含旧 `config.monitor` 且不存在新扩展配置
- **THEN** 系统创建扩展配置、安装 Observer Hooks、更新扩展状态并删除旧核心配置域

#### Scenario: 新配置已经存在
- **WHEN** Workspace 同时包含旧核心配置和用户修改后的新扩展配置
- **THEN** 新扩展配置保持不变，迁移只清理兼容旧来源并记录 warning

#### Scenario: 迁移后置验证失败
- **WHEN** 配置、Hook 或扩展状态任一后置条件不满足
- **THEN** 系统回滚外层事务，旧配置和旧 Hook 保持可恢复

### Requirement: 保留兼容命令和可预测退出
兼容期内 `code-w monitor` SHALL 作为薄别名调用 `code-w ext monitor`，并至少保留第一阶段发布记录中列出的既有常用参数行为。别名 MUST NOT 直接导入扩展业务实现。别名解析失败或扩展不可用时 MUST 返回可诊断错误，而不是静默切换到不同服务。

#### Scenario: 启动兼容别名
- **WHEN** 用户执行 `code-w monitor`
- **THEN** 命令转换到 `code-w ext monitor` 并启动扩展服务

#### Scenario: 兼容别名显式端口
- **WHEN** 用户执行 `code-w monitor --port 8080`
- **THEN** 别名将端口参数传给扩展 CLI，不使用核心 Monitor 专用实现

### Requirement: 卸载保留用户配置和数据
卸载 Monitor 扩展 SHALL 移除扩展拥有的 Hooks、独占制品和 installed 状态，但 MUST 默认保留扩展配置、Monitor 运行期用户数据和用户自定义 Hook。兼容期内用户 MAY 显式运行核心 Monitor；卸载不得静默改写核心配置或启动状态。

#### Scenario: 卸载扩展
- **WHEN** 用户确认卸载 Monitor 扩展
- **THEN** Observer Hooks 和扩展状态被事务性移除，扩展配置和用户数据保留

#### Scenario: 卸载后启动旧命令
- **WHEN** 兼容期内卸载扩展后用户显式运行核心 Monitor 回退路径
- **THEN** 核心 Monitor 可按自身配置启动，不发生隐式数据迁移
