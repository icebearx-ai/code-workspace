## 1. CLI 单项目 verify 合同

- [x] 1.1 删除单项目 `project verify` 结果中的 `data.projects`，保留 `data.project`。
- [x] 1.2 更新 CLI runtime 测试，断言单项目结果包含 `project` 且不包含 `projects`，同时保留 workspace 与 selection 合同测试。
- [x] 1.3 更新 `docs/cli-architecture.md` 中的单项目与多项目结果合同说明。

## 2. Workspace Guard 流程

- [x] 2.1 更新 `WORKSPACE_GUARD.md.template`，删除 Skill 交还后和 update-latest 后的整体 `project verify`。
- [x] 2.2 在 Guard 模板中明确 update-latest 的最终状态门职责、`PROJECT_BRANCH_MISMATCH` 重入路径和 fast-forward 后上下文刷新要求。
- [x] 2.3 更新 Guard 与 managed-file 测试断言，覆盖新流程并排除旧复验要求。
- [x] 2.4 更新 `docs/code-workspace-flow.zh-CN.md` 的分支恢复流程图和说明。
- [x] 2.5 重新计算并更新 `artifacts/manifest.json` 中 `WORKSPACE_GUARD.md.template` 的 SHA-256。

## 3. OpenSpec 与验证

- [x] 3.1 将本变更的两个 delta spec 同步到 `openspec/specs/`。
- [x] 3.2 运行 `npm run cli:architecture-check` 并通过。
- [x] 3.3 运行 `npm test` 并通过。
- [x] 3.4 运行 `npm run pack:check` 并通过。
- [x] 3.5 运行 `openspec validate simplify-project-verify --json` 并通过。

## 4. 最终检查

- [x] 4.1 检查最终 diff，确认只包含两项批准的优化及其规范、文档、测试和指纹更新。
