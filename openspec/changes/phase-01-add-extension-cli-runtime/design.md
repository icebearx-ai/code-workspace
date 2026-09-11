## Context

当前扩展规范覆盖 manifest 冻结、init 子进程、staging 制品和 Workspace 安装生命周期。扩展可以通过声明式 Hook 参与运行期事件，但不能声明稳定的 CLI 入口。核心因此只能通过 `monitor` 这类专用 registry 项、命令 handler 和配置域接入带 CLI 的能力。

本阶段只建设通用运行时扩展底座，不迁移 Monitor。现有 Extension Spec v1 扩展、`extension install/uninstall`、Hook 和核心命令必须继续工作。

## Goals / Non-Goals

**Goals:**

- 用一个永久稳定的 `ext` 命令承载所有扩展 CLI。
- 让扩展 ID 之后的参数成为不透明参数，核心不解析扩展私有选项。
- Host 统一负责入口完整性、作用域、进程生命周期、超时、输出上限、错误和退出行为。
- 支持一次性执行和长驻服务两种生命周期。
- 为后续配置和 observer 能力提供可独立演进、可协商的运行时协议边界。

**Non-Goals:**

- 不迁移或调用 Monitor。
- 不提供外部扩展市场、远程下载或任意顶级动态命令。
- 不把子进程隔离描述为安全沙箱。
- 不决定后续配置和 observer 能力的具体 schema，只定义它们可以独立加入的协议位置。

## Decisions

### D1: 安装协议与运行时协议分离

现有 `extensionSpecVersion` 继续表示安装期兼容边界。新增独立的 `runtimeProtocolVersion` 表示 CLI、配置和 Hook runner 的运行时边界。Host 发布支持的运行时能力集合，扩展声明所需能力；只要存在未支持的必需能力，Host 就在执行前安全拒绝该运行时入口。

这样可以先实施 CLI，再分阶段增加配置和 observer 能力，而不必为每个新增运行时能力重写完整安装协议，也不得把新能力误认为 v1 安装协议天然可用。

替代方案是把 CLI、配置和 observer 一次性塞入新的单一 Extension Spec。该方案版本切换过大、实现无法分阶段回归，因此拒绝。

### D2: `code-w ext` 是唯一稳定的扩展 CLI 命名空间

核心永久注册路径为：

```text
code-w ext [host-options] <extension-id> [extension-argv...]
```

Parser 在取得 `extension-id` 后停止解释扩展参数；Host 选项必须位于扩展 ID 之前。扩展自行解释子命令、`--help`、`--json` 和业务选项。保留显式 `--` 作为兼容写法，但不能把 `--` 设为唯一正确的直通方式。

不允许扩展动态注册 `code-w <extension-id>` 顶级命令，因为命令识别发生在扩展发现之前，动态顶级命令会产生冲突、可用性和升级不确定性。历史兼容别名必须由独立的兼容 shim 固定维护。

### D3: Host 与扩展职责固定

Host 负责：扩展发现、安装状态、scope 判定、manifest/入口/包摘要校验、子进程创建、启动超时、退出码、输出上限、信号转发、统一错误和无敏感 context 传递。

扩展负责：参数解释、业务校验、帮助文本、状态输出、配置读取和真实业务副作用。Host 不得理解扩展私有参数或业务结果字段。

### D4: 一次性与长驻生命周期显式区分

`oneshot` 模式等待进程退出，收集受限 stdout，并要求成功输出一个统一 JSON result envelope。超时覆盖完整调用。

`service` 模式继承 TTY/stdio，启动超时只覆盖就绪阶段，进程正常存活不受总超时限制。Host 必须转发 `SIGINT`/`SIGTERM`，并在退出时清理临时 context。首版就绪信号必须显式声明，避免把 `spawn` 事件误当作服务已经可用。

### D5: 结果和失败保持稳定

一次性 CLI 的业务数据只能进入 `data`，诊断进入 `diagnostics`，文本提示进入 `text`；未知字段、身份不匹配、非 JSON、超限输出和非零退出都使用稳定错误码。长驻服务不要求 stdout JSON；其生命周期结果由退出码和信号表达。

## Risks / Trade-offs

- 参数边界错误会破坏所有扩展 CLI → parser、文档和集成测试必须先固定 `extension-id` 边界，再进行任何真实消费方迁移。
- 运行时能力协商过度设计 → 首版只实现 capability set 与未知必需能力 fail-closed，不引入动态插件依赖解析。
- 长驻进程产生孤儿 → 基于进程组和信号转发实现清理，并测试正常退出、信号退出和启动失败。
- 入口摘要每次调用都校验完整包 → 首版优先正确性；只有出现可测量性能问题后才增加可信缓存。
- 新旧命令行为混淆 → 本阶段不注册 Monitor 别名，也不改变任何现有命令。

## Migration Plan

1. 增加运行时协议声明和能力校验，但默认没有扩展使用。
2. 注册 `ext` 并实现 parser 边界、oneshot/service 执行器和测试 fixture。
3. 运行完整既有回归，确认 Monitor 和所有 v1 扩展行为不变。
4. 回滚时移除 `ext` 注册和运行时字段支持；不得改变已有安装状态或 Workspace 制品。

## Open Questions

- 运行时能力集合使用扩展侧 `requires`、Host 侧 `supports`，还是二者组合表达；需在实施前形成一个最小测试矩阵。
- 服务就绪协议采用单行 readiness 消息还是显式健康检查；需同时覆盖 TTY 和 JSON 场景。
