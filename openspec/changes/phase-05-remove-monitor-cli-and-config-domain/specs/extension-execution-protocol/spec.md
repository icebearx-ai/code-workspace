## ADDED Requirements

### Requirement: service runtime 支持固定 argv 短命令约定
对于通过 `codew ext <id>` 调用的 `service` runtime，Host 必须（SHALL）应用固定 argv 约定：空 argv 或首参数为 `serve` 时启动或接入 singleton 服务；其他首参数将 runtime 入口作为短命令执行，继承 stdio 与调用方工作目录，不经过 service 注册和 readiness 握手。命令调用以子进程退出状态结束，并受声明的 `timeoutMs` 约束。

#### Scenario: 空 argv 或 serve 启动服务
- **WHEN** 调用 `codew ext <id>` 无额外参数或以 `serve` 为首参数
- **THEN** Host 启动或接入该 runtime 的 singleton 服务，并执行 service 注册与 readiness 握手

#### Scenario: 其他首参数作为短命令执行
- **WHEN** 调用 `codew ext <id> report` 等非 `serve` 首参数
- **THEN** Host 以调用方 cwd、继承 stdio 执行 runtime 入口，不注册 service 也不写 readiness 文件

#### Scenario: 短命令受超时约束
- **WHEN** 短命令在声明的 `timeoutMs` 内未退出
- **THEN** Host 终止子进程并以稳定超时结果返回

#### Scenario: 短命令退出状态透传
- **WHEN** 短命令以非零状态退出
- **THEN** Host 以子进程退出码结束，不以 service 运行状态为判据
