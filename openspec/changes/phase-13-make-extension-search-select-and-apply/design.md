## Context

`extension search` 目前声明为 `workspace: none`, `interaction: never`, `effects: external`，而交互选择安装/更新需要 Workspace 状态和 planned-write 语义。CLI 架构只允许一个 registry 合同，因此命令需要声明能覆盖交互路径的最小 Workspace 配置，并在 handler 中按 TTY/JSON 分流。

## Goals / Non-Goals

**Goals:**

- TTY 下无额外选项即可搜索、分页、多选、确认并安装/更新。
- JSON/非 TTY 下保持稳定只读 search 数据，不产生写入或 prompt。
- 统一使用 picker 的状态模型和 Registry lifecycle 的 install/upgrade 计划。
- 一次确认、逐扩展事务、最佳努力批处理和完整结果。

**Non-Goals:**

- 不增加 `--select`。
- 不把 search 改成远端发布/删除命令。
- 不允许系统扩展进入选择列表。

## Decisions

1. registry 将 `extension search` 声明为 `workspace: required`、`config: [identity, language]`、`interaction: required`、`effects: planned-write`，并保留可选 `--yes`；JSON/非 TTY 由 handler 走只读分支但仍使用最小 Workspace projection（若后续要支持任意目录只读，可另立 Change）。
2. TTY 分支调用共享 picker，返回 selected IDs 和 action；已安装最新版禁用，过期项进入 upgrade 计划，未安装项进入 install 计划。
3. 计划统一走 `prepareRegistryExtensionPlans` 和 `runExtensionBatch`；不要在 search handler 中复制事务代码。
4. JSON/non-TTY 分支调用现有 `searchRegistryExtensions`，不读取已安装状态、不确认、不写入；缺少 Workspace 时返回稳定的命令合同错误，避免静默改变命令作用域。
5. 结果 command 保持 `extension.search`，交互写入结果使用 selection envelope，附带 action、requested/resolved version、source、offline 和 diagnostics。

## Risks / Trade-offs

- [同一命令有读和写两种效果] → registry 明确声明 planned-write，文档和 JSON 行为固定；架构测试覆盖 TTY/JSON/non-TTY 分流。
- [用户以为 search 只读] → 文案、帮助和确认摘要明确“选择后安装/更新”；需要纯读时使用 JSON/non-TTY。
- [过期判断受远端 metadata 延迟影响] → picker 先显示加载状态，候选与 installed digest 在确认前再次冻结校验。
- [部分目标失败] → 复用既有 ordered best-effort batch，顶层 ok=false 但保留所有目标结果。

## Migration Plan

1. 先改 registry/config projection 和 parser/architecture tests。
2. 接入 picker 和状态动作映射。
3. 复用 install/upgrade lifecycle 执行并补充确认、回滚、幂等测试。
4. 更新 README/帮助，运行真实 parser、CLI architecture checker、完整测试。
5. 失败时保留 search 的只读实现并撤销交互分支；不影响 `extension install`/`upgrade` 独立命令。
