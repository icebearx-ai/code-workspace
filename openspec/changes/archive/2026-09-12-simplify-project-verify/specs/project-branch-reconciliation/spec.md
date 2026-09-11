## MODIFIED Requirements

### Requirement: 分支协调链路支持独立参数的多项目批量处理
`project branch inspect`、`project branch verify`、`project branch accept-actual`、`project branch use-registered` 和定向 `project verify` 必须（SHALL）接受一个或多个独立项目名参数。CLI 不得将逗号分隔字符串解释为多个项目。四条分支命令的单项目调用必须保持原有数据合同；定向 `project verify` 的单项目调用必须返回 `scope: "project"` 和 `data.project`，且不得返回冗余的 `data.projects`。多项目调用必须返回 `scope: selection`、输入顺序的逐项目结果和成功、跳过、失败汇总。

#### Scenario: 单项目 verify 返回精简结果
- **WHEN** 用户运行 `project verify <name> --json` 且只指定一个项目
- **THEN** `data` 包含 `scope: "project"` 和完整 `project` 对象，不包含 `projects`

#### Scenario: 分支命令单项目合同保持不变
- **WHEN** 用户对单个项目运行任一条 `project branch` 命令
- **THEN** 该命令继续返回其既有的单项目 `data` 合同，不因定向 `project verify` 的精简而改变

#### Scenario: 批量只读命令包含失败项目
- **WHEN** 批量 `branch inspect`、`branch verify` 或定向 `project verify` 中某个项目不存在或检查失败
- **THEN** CLI 记录该项目诊断并继续检查其余项目，全部完成后顶层返回失败，同时保留所有成功项目的数据

#### Scenario: 批量写操作统一确认
- **WHEN** 多个项目可执行 `accept-actual` 或 `use-registered` 且调用方没有提供 `--yes`
- **THEN** CLI 在任何项目产生效果前只请求一次确认；取消或非交互确认缺失时不修改任何项目

#### Scenario: 批量操作部分失败
- **WHEN** 某个项目在预检查、应用或后置验证阶段失败
- **THEN** CLI 保留该项目自身的事务回滚或外部效果补偿，继续处理后续项目，不回滚此前成功项目，并在全部处理后返回有项目归属的诊断与有序汇总

#### Scenario: 批量项目重复出现
- **WHEN** 同一个项目名在一次批量命令中重复出现
- **THEN** CLI 只处理第一次出现的位置，为后续重复项返回 warning，且不重复产生项目效果
