## 1. CLI 输入契约

- [x] 1.1 在 `src/cli/registry.js` 为 `project add` 注册 boolean `--stdin`。
- [x] 1.2 在 `project add` 中实现四种输入模式互斥、`--stdin` 与位置参数冲突诊断。
- [x] 1.3 强制 `--stdin` 配合 `--yes`，缺少确认时在读取 stdin 前失败。
- [x] 1.4 通过 fd 0 实现有大小上限的 JSON 读取，并复用现有批量项目校验逻辑。
- [x] 1.5 为空白输入、超限输入、JSON 解析失败和批内项目校验失败提供稳定诊断。

## 2. CLI 测试

- [x] 2.1 扩展 parser 测试，覆盖 `--stdin` 的有效、冲突和重复选项行为。
- [x] 2.2 扩展 CLI runtime 测试，覆盖合法 stdin 批量添加和现有文件模式兼容。
- [x] 2.3 覆盖空 stdin、超限 stdin、非法 JSON、缺少 `--yes` 和输入模式冲突且零写入。
- [x] 2.4 覆盖 stdin 路径下的确认、权限结果、事务后置验证和失败回滚。
- [x] 2.5 更新文档命令架构检查所需测试和断言。

## 3. Agent 工作流

- [x] 3.1 重写 `artifacts/templates/codex/skills/code-workspace-add-projects/SKILL.md`，改为一次只读采集、逐项失败汇总、一次确认和 `project add --stdin`。
- [x] 3.2 重写 `artifacts/templates/claude/commands/code-workspace/add-projects.md`，与 Codex 工作流保持一致。
- [x] 3.3 删除 Skill 和 Claude command 中的临时 JSON 与默认 `project verify` 要求。
- [x] 3.4 更新 CLI Skill 测试断言，验证 stdin、无临时文件和单次写入流程。

## 4. 文档和托管制品

- [x] 4.1 更新 `README.md` 和 `README.zh-CN.md` 的项目注册与低层 stdin 示例。
- [x] 4.2 更新用户指南中英文版本，说明逐项采集失败、一次确认和无临时文件流程。
- [x] 4.3 更新 `docs/code-workspace-flow.zh-CN.md` 的注册流程和关键命令。
- [x] 4.4 更新 `docs/cli-architecture.md`，说明显式 stdin 输入仍受确认、事务和验证约束。
- [x] 4.5 重新计算并更新 `artifacts/manifest.json` 中受影响托管文件的 SHA-256。

## 5. 验证

- [x] 5.1 运行 `npm run cli:architecture-check` 并通过。
- [x] 5.2 运行 `npm test` 并通过。
- [x] 5.3 运行 `npm run pack:check` 并通过。
- [x] 5.4 运行 `openspec validate "optimize-project-add-stdin" --json` 并通过。
- [x] 5.5 检查最终 diff，确认没有引入临时 JSON、明文 JSON 参数或无关 CLI 行为。
