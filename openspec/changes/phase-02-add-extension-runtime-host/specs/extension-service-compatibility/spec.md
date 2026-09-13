## ADDED Requirements

### Requirement: Service 声明身份和兼容组
长驻 Runtime MAY 声明 `service.id`、兼容组和 singleton policy。Host MUST 使用声明的 service identity 和兼容组判断共享，不得根据扩展 SemVer 数值推断协议兼容。

#### Scenario: 兼容版本共享服务
- **WHEN** 两个 Workspace activation 的 service 具有相同 service id 和兼容组
- **THEN** Host 可以让它们共享一个 service 实例

#### Scenario: 不兼容版本请求共享
- **WHEN** 两个 activation 的 service id 相同但兼容组不同且 policy 为 singleton
- **THEN** Host 拒绝第二个 activation 的 service 请求并报告稳定兼容冲突

### Requirement: Service 进程引用阻止过早 GC
Runtime Host SHALL 为运行中的 service 持有包引用，并在正常退出、异常退出、启动失败和信号终止后释放引用。包在仍有进程引用时 MUST NOT 被 GC 删除。

#### Scenario: 服务正常退出
- **WHEN** service 退出并完成清理
- **THEN** Host 释放运行引用，使无其他引用的包可以进入 GC

#### Scenario: 启动失败
- **WHEN** service 在 readiness 阶段失败
- **THEN** Host 释放临时 context 和包引用，并返回稳定启动失败错误

### Requirement: Host 正确管理 service 生命周期
service MUST 使用继承的 stdio，启动超时只覆盖 readiness 阶段；Host MUST 转发 SIGINT/SIGTERM，并在退出后清理进程组和运行记录。正常长驻不得被 oneshot 总超时终止。

#### Scenario: 长驻服务持续运行
- **WHEN** service 在启动超时内报告 ready 并继续运行
- **THEN** Host 保持进程运行，不应用一次性总超时

#### Scenario: 用户终止服务
- **WHEN** 前台 Host 收到 SIGTERM
- **THEN** Host 将 SIGTERM 转发给 service，等待退出并释放运行资源
