## ADDED Requirements

### Requirement: 扩展可声明用户配置文件和默认内容
扩展 manifest MAY 通过 runtime config capability 声明一个 Workspace 控制面内的安全相对文件名和默认初始化内容。Host SHALL 校验声明路径为普通文件路径，拒绝绝对路径、反斜杠、`.`/`..`、目录穿越、符号链接祖先和与核心控制文件的冲突。Host MUST NOT 解释配置文件的业务字段。

#### Scenario: 合法配置声明
- **WHEN** 扩展声明安全文件名和默认内容
- **THEN** Host 可以将其纳入扩展安装计划并显示目标路径

#### Scenario: 配置路径逃逸或冲突
- **WHEN** 配置路径是绝对路径、包含 `..`、经过符号链接或冲突于核心控制文件
- **THEN** Host 在安装前拒绝扩展且不创建文件

### Requirement: 新安装只在文件不存在时创建配置
扩展新安装 SHALL 在声明文件不存在时创建默认配置；当文件已经存在时，Host MUST 保留原内容并继续安装或升级。Host MUST NOT 用 manifest 默认值覆盖已有文件。

#### Scenario: 首次安装创建默认配置
- **WHEN** 用户安装声明配置文件的扩展且目标不存在
- **THEN** Host 在扩展事务内创建默认配置并验证文件存在

#### Scenario: 升级保留用户修改
- **WHEN** 已安装扩展升级且配置文件包含用户修改
- **THEN** 升级保留文件内容和 mtime 语义，不把修改报告为制品漂移

### Requirement: 卸载默认保留扩展配置
卸载扩展 SHALL 只移除 installed 状态拥有的制品和 Hooks。扩展配置文件和运行期用户数据 MUST 默认保留，并在卸载结果中报告保留路径；不得因为配置文件是安装期创建而删除它。

#### Scenario: 卸载后配置仍存在
- **WHEN** 用户卸载扩展且配置文件未被手动删除
- **THEN** 文件内容保持不变且卸载结果列出该保留路径

### Requirement: 配置错误只影响对应扩展
配置文件缺失、不可读、格式错误或字段非法时，系统 SHALL 将错误隔离到对应扩展的运行时或诊断。核心 init/update、核心配置读取、其他扩展和显式 `--extensions none` MUST 不因该扩展配置错误失败。

#### Scenario: 损坏配置不阻断核心命令
- **WHEN** 某扩展配置文件损坏且用户运行不依赖该扩展的核心命令
- **THEN** 核心命令按原契约成功或按自身条件失败，不引用损坏的扩展配置

#### Scenario: 扩展运行时报告配置错误
- **WHEN** 用户调用配置损坏的扩展 CLI
- **THEN** 扩展返回包含文件名和 remediation 的稳定扩展错误，Host 不尝试解释或修复字段
