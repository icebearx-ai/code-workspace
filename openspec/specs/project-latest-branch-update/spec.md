# Project Latest Branch Update

## Purpose

定义项目通过 `updateLatest` 策略安全追赶已配置 upstream 最新提交的合同。

## Requirements

### Requirement: 项目可以声明是否自动追赶最新 upstream
项目配置中的 `projects[].updateLatest` SHALL 是可选布尔字段。字段缺失 SHALL 等同于 `false`；存在时必须是 YAML 布尔值 `true` 或 `false`。项目注册和删除命令 SHALL 不新增该字段的参数或写入逻辑。

#### Scenario: 旧项目缺少更新策略
- **WHEN** 项目记录没有 `updateLatest`
- **THEN** 项目行为等同于 `updateLatest: false`，读取项目和分支命令不得因为缺失字段失败

#### Scenario: 更新策略为 true
- **WHEN** 项目记录的 `updateLatest` 是 YAML 布尔值 `true`
- **THEN** `project branch update-latest` 将该项目视为启用自动更新的候选

#### Scenario: 更新策略为非法类型
- **WHEN** 项目记录的 `updateLatest` 是字符串、数字、null 或其他非布尔值
- **THEN** 项目校验返回稳定的 `PROJECT_UPDATE_LATEST_INVALID` 诊断，并包含项目名称和字段信息

#### Scenario: project add 不管理更新策略
- **WHEN** 用户运行 `project add` 或通过项目输入文件注册项目
- **THEN** 命令不接受 `updateLatest` 参数，不自动写入该字段，也不因默认值改变项目注册合同

### Requirement: CLI 可以安全更新启用项目的最新分支
CLI SHALL 提供 `project branch update-latest <name...>`。命令 SHALL 只加载 `projects` 配置域，声明 `workspace: required`、`interaction: never`、`effects: external`，并接受一个或多个独立项目名参数。命令 SHALL 只对 `updateLatest: true` 的目标项目执行 Git 更新。

#### Scenario: 更新策略关闭
- **WHEN** 目标项目缺少 `updateLatest` 或其值为 `false`
- **THEN** 命令返回 `skip`，原因是 `disabled`，不执行 fetch、merge 或其他 Git 命令

#### Scenario: 分支和工作树满足更新前置条件
- **WHEN** `updateLatest` 为 `true`、实际分支等于注册分支、工作树干净、当前分支存在 upstream 且本地可以 fast-forward 到 fetched upstream HEAD
- **THEN** 命令 fetch upstream，执行 fast-forward 更新，并验证最终分支仍等于注册分支、HEAD 等于目标 HEAD 且工作树干净

#### Scenario: 已经处于最新提交
- **WHEN** fetch 后当前 HEAD 等于目标 upstream HEAD
- **THEN** 命令返回 `skip`，原因是 `already-latest`，不执行 merge

#### Scenario: 分支不一致
- **WHEN** `actualBranch` 不等于项目注册分支
- **THEN** 命令返回 `PROJECT_BRANCH_MISMATCH`，不执行 fetch 或 merge，并要求先完成现有分支协调

#### Scenario: 工作树不干净
- **WHEN** `git status --porcelain` 返回任何内容
- **THEN** 命令返回 `PROJECT_WORKTREE_DIRTY`，不执行 fetch 或 merge，并保留人工处理建议

#### Scenario: upstream 缺失
- **WHEN** 当前分支没有配置 upstream
- **THEN** 命令返回 `PROJECT_BRANCH_UPSTREAM_MISSING`，不猜测 remote、不设置 upstream、不执行 merge

#### Scenario: fetch 失败
- **WHEN** upstream fetch 因网络、认证、远端或 Git 错误失败
- **THEN** 命令返回 `PROJECT_BRANCH_FETCH_FAILED`，包含项目、位置、upstream 和可执行的重试建议

#### Scenario: 无法 fast-forward
- **WHEN** 当前 HEAD 不是目标 HEAD 的祖先
- **THEN** 命令返回 `PROJECT_BRANCH_NOT_FAST_FORWARD`，不执行 reset、stash、rebase 或非 fast-forward merge

#### Scenario: 状态在 fetch 后发生漂移
- **WHEN** fetch 完成后，分支、HEAD、注册配置或工作树状态与计划不一致
- **THEN** 命令返回 `PROJECT_BRANCH_UPDATE_PLAN_STALE`，不执行 fast-forward

#### Scenario: 后置验证失败
- **WHEN** fast-forward 已经执行但最终分支、HEAD 或工作树不符合计划
- **THEN** 命令返回 `PROJECT_BRANCH_UPDATE_VERIFY_FAILED`，报告当前观测状态和 retained external effect，不执行 reset 补偿

### Requirement: 最新分支更新支持隔离的多项目批处理
命令 SHALL 对多个目标项目采用 best-effort 语义，按输入顺序逐项目处理，并返回 `scope: selection`、逐项目结果和 succeeded/skipped/failed 汇总。一个项目失败 SHALL 不阻止后续项目，也不得回滚其他项目已经完成的 Git 更新。

#### Scenario: 批量包含 disabled、成功和失败项目
- **WHEN** 一次命令选择多个项目，且项目分别处于 disabled、可成功更新和 Git 更新失败状态
- **THEN** 命令返回全部项目的有序结果，顶层 `ok` 为 false，并准确统计 skip、success 和 failure

#### Scenario: 重复项目参数
- **WHEN** 同一项目名在一次批量命令中重复出现
- **THEN** CLI 只处理第一次出现的位置，并为后续重复项返回 warning，不重复执行 Git 效果

#### Scenario: 未注册项目
- **WHEN** 批量参数包含未注册项目名
- **THEN** 该项目返回 `PROJECT_NOT_FOUND`，不检查其路径、不执行 Git，其他项目仍继续处理
