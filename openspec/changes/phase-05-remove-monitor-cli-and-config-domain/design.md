## Context

phase-04 之后核心仍有约 180 行 monitor 专属代码：CLI 兼容命令（含事件规范化/上报的复制实现）、`monitor` 配置域、init 自动激活、doctor 校验和 capabilities 死代码。用户决定不做过渡与兼容，一次性收敛到扩展包。

## Goals / Non-Goals

**Goals:**

- 核心 `src/` 中不再有任何 monitor 业务知识。
- `codew ext monitor report` 成为 Hook 上报的唯一入口，保持 failure-open。
- Monitor 配置作为扩展自有制品（exclusive output）存在。
- 通用 Host 获得 service runtime 的短命令执行能力（任何扩展可用）。

**Non-Goals:**

- 不为已删除的 `codew monitor` 提供废弃别名或过渡窗口。
- 不优化 report 的进程启动耗时（spawn 开销后续再优化）。
- 不设计通用扩展 settings 机制；monitor 配置当前只有默认值。

## Decisions

1. **Host 新增 `runCommandRuntime` 而非扩展 manifest schema。** service runtime 通过 `codew ext <id> <argv>` 调用时：空 argv 或 `serve` 走 singleton 服务机制；其他首参数以继承 stdio、调用方 cwd 执行入口，超时仍为 `timeoutMs`。约定写入 Extension Spec v1 规范，不改 manifest schema。
2. **report 由扩展 runtime 自包含实现。** runtime 入口识别 `report` argv：读 stdin、从 cwd 向上查找 `.codew/monitor-reporting.json`、POST、任何失败 exit 0。不依赖 workspace root 注入（spec 禁止 context 携带真实路径）。
3. **配置域以剥离方式移除。** `normalizeConfig` 解构丢弃 `monitor` 键，旧配置文件在下次保存时自然瘦身，不引入 schema 版本迁移。
4. **扩展版本升至 1.1.0。** Hook 命令与 runtime 行为变化属于机器可观察变化；Host 重跑 init 时按最高受支持版本升级并重写自有 Hook 条目。

## Risks / Trade-offs

- [存量 hooks 指向已删除命令] → 已接受（无过渡）。修复路径：`codew init` 升级 monitor 扩展到 1.1.0。
- [report 多一层进程启动，2s Hook 超时可能紧张] → 已接受（后续优化项）。
- [service 运行时 `codew ext monitor report` 不经过 singleton 检查] → report 是纯 HTTP 客户端，与 service 是否运行无关，失败即跳过。

## Migration Plan

1. 扩展 1.1.0（report 模式 + hooks 命令切换）先行合入。
2. 删除核心 monitor 代码与配置域，测试全部切到 `--extensions monitor` / `ext` 命令路径。
3. 完整验证：测试、架构检查、npm pack、OpenSpec 校验、端到端冒烟（serve + report + 快照）。
4. 回滚：revert 本 Change 提交；用户级 runtime data 与扩展 Store 不受影响。

## Open Questions

无。
