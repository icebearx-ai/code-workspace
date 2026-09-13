## Context

phase-01 建立了用户级 Extension Store 和 Workspace activation，但尚未定义如何从 Store 包启动运行时入口。Runtime Host 必须与具体扩展业务隔离：它只解析 manifest、创建执行环境、管理进程生命周期和统一结果，不导入 Monitor 或 MCP 模块。

## Goals / Non-Goals

**Goals:**

- 提供稳定的 `codew ext <extension-id> ...` 命名空间。
- 从精确 Store 包版本启动 oneshot CLI 和长驻 service。
- 支持 Workspace activation 与 global/user service 两种执行作用域。
- 提供 service identity、兼容组和运行进程引用。
- 让当前内核只包含通用 Runtime Host，不包含扩展业务。

**Non-Goals:**

- 不实现远程下载、扩展市场或签名信任体系。
- 不建立全局 Workspace。
- 不实现 Monitor、MCP 或其他具体扩展的业务协议。
- 不支持未经 manifest 声明的动态顶级命令。

## Decisions

### D1: Runtime entry 是 manifest 的独立声明

运行时入口、runtime protocol、execution scope、mode 和 service metadata 与安装期 outputs 分离。Host 只依据静态声明定位入口，不解析扩展私有参数或业务结果。

### D2: `ext` 命令 Workspace 要求为 optional

Host 在发现 runtime 前无法知道作用域，因此 registry 声明可选 Workspace。Workspace-scoped runtime 在解析完成后要求 activation；global/user runtime 不读取当前 Workspace 状态作为可用性条件。

### D3: Runtime 包版本精确绑定

默认从 Workspace activation 的 `id/version/packageSha256` 启动 workspace runtime。global service 由显式版本、当前兼容组或 Host 选择策略定位；不得在运行时静默切换到 latest。

### D4: Service 使用兼容组而非版本号猜测

manifest 声明 `service.id`、兼容组和 singleton policy。Host 只允许同一兼容组共享 singleton service；不兼容时返回稳定冲突错误，不自动启动第二个实例。

### D5: 通用 supervisor 与扩展业务分层

supervisor 负责进程组、信号、stdio、就绪超时、退出和运行引用。扩展负责 readiness 消息、业务配置、数据和输出；Host 不解释 Monitor 等业务协议。

## Risks / Trade-offs

- [global service 版本冲突] → manifest 显式声明兼容组；首版不支持不兼容 service 并行实例。
- [长驻进程孤儿] → 使用进程组和运行 registry，退出、信号和启动失败均释放引用。
- [service 输出不可统一 JSON] → service 使用继承 stdio，生命周期只以就绪和退出状态表达。
- [Host 误传 Workspace 敏感信息] → global runtime 默认不接收 Workspace context，只传递通用、非敏感 runtime context。

## Migration Plan

1. 扩展 manifest 增加 runtime 声明和 schema 校验。
2. 实现 generic `ext` parser、resolver 和 supervisor。
3. 使用独立测试扩展验证 oneshot、service、信号和兼容组。
4. 保持现有 `extension install/uninstall` 和旧命令行为不变。
5. 回滚时移除 `ext` 路由和 runtime 字段支持，不修改 Workspace activation 制品。

## Open Questions

- global service 的默认版本选择是否要求显式 `--version`，还是由兼容组中最高受支持版本决定。
- readiness 使用单行协议还是文件/管道信号，需要在 fixture 中固定。
