## ADDED Requirements

### Requirement: init 不管理 Monitor 配置域
交互式与非交互式 init 必须（SHALL）不再写入、校验或投影 workspace config 的 `monitor` 配置域，也不接受 `--monitor` / `--no-monitor` / `--monitor-url` 参数。Monitor 配置由扩展自有制品 `.code-workspace/monitor-reporting.json` 提供，Host 按 exclusive output 管理。

#### Scenario: init 不自动激活 Monitor
- **WHEN** 用户运行 init 且未显式选择 monitor 扩展
- **THEN** 初始化计划不请求 monitor、不写入任何 monitor 配置，也不显示 "Enable Codex Agent monitor?" 步骤

#### Scenario: 存量 monitor 配置被剥离
- **WHEN** 已存在 workspace config 含 `monitor` 键且 Host 读取该配置
- **THEN** Host 解构丢弃 `monitor` 键，下次保存时自然移除，不引入 schema 版本迁移

#### Scenario: Monitor 配置为扩展自有制品
- **WHEN** monitor 扩展安装或升级
- **THEN** `.code-workspace/monitor-reporting.json` 作为扩展 exclusive output 由 Host 管理，其内容不进入核心 config schema

#### Scenario: Monitor Hook 完全由扩展声明生成
- **WHEN** monitor 扩展经 Hook 声明生成 `.codex/hooks.json` 与 `.claude` Hook 条目
- **THEN** Hook 命令指向 `codew ext monitor report`，核心不写入或校验 monitor 专属 Hook 配置
