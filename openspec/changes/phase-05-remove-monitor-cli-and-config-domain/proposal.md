## Why

phase-04 删除了 `src/monitor` 的业务实现，但核心仍保留 monitor 专属的 CLI 兼容命令、`monitor` 配置域、init 自动激活逻辑和事件上报业务拷贝，形成第二事实来源。为了让 Host 核心只包含通用扩展运行时，Monitor 的全部入口、配置和上报语义必须收敛到扩展包。

## What Changes

- **BREAKING** 删除 `codew monitor` / `codew monitor report` 命令。`extensions/monitor/1.1.0` 的 Hook 命令改为 `codew ext monitor report`，通过通用 `ext` 命令路由。
- **BREAKING** 删除 workspace config 的 `monitor` 配置域（`monitor.enable` / `monitor.url`）及 `--monitor` / `--no-monitor` / `--monitor-url` init 参数。存量配置中的 `monitor:` 键在读取时被剥离，下次保存时自然移除。
- **BREAKING** 取消 init 的 "Enable Codex Agent monitor?" 交互步骤和 Codex 工具的 monitor 自动激活。监控只能通过 `--extensions monitor` 或交互式扩展多选显式安装。
- Monitor 配置改由扩展自有制品 `.code-workspace/monitor-reporting.json` 提供（默认值，Host 按 exclusive output 管理）。
- 通用 Runtime Host 新增 service runtime 的短命令执行能力：`codew ext <id> <command>` 以继承 stdio、调用方 cwd 执行 runtime 入口，不经过 service 注册和 readiness；空 argv 或 `serve` 仍走 singleton 服务机制。
- 删除 CLI 层 `normalizeHookEvent` / `reportHookEvent` 业务拷贝、`MONITOR_CODEX_REQUIRED` doctor 校验和 managed-file capabilities 死代码。
- `reportHookEvent` 签名从核心 config 形态改为扩展制品形态（`{ enable, url, workspace }`），由扩展 runtime 的 `report` 模式从 cwd 向上查找制品后调用。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `monitor-session-lifecycle`: Hook 上报与 failure-open 语义的唯一实现来源固定为 `extensions/monitor/1.1.0` 的 runtime `report` 命令，经 `codew ext monitor report` 调用。
- `workspace-init-extensions`: init 不再写入或校验 monitor 配置域；monitor hooks 完全由扩展 Hook 声明生成。
- `extension-execution-protocol`: service runtime 通过 `codew ext <id>` 的 argv 约定获得短命令执行能力。

## Impact

影响 CLI 注册表与分发、workspace config schema、init/wizard、doctor、update、managed-files capabilities 机制、extension settings 通道、monitor 扩展（1.0.0 → 1.1.0）、扩展执行协议规范与全部相关测试。存量 Workspace 的 `.codex/hooks.json` 若仍指向 `codew monitor report`，需通过 `codew init`（升级到 1.1.0 时 Host 重写自有 Hook 条目）修复；本 Change 不提供过渡别名。
