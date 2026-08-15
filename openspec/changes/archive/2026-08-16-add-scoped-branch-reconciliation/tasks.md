## 1. 首先统一 registeredBranch 和 actualBranch

- [x] 1.1 为现有分支比较和公共 JSON 合同增加迁移测试：`projects[].branch` 明确映射为 `registeredBranch`，Git 当前分支映射为 `actualBranch`，`PROJECT_BRANCH_MISMATCH` 返回 `registeredBranch`、`actualBranch`、`location` 且不再返回 `configuredBranch`。
- [x] 1.2 统一核心与 CLI 中的分支领域状态，清理 `configuredBranch`、`previousBranch`、`expectedBranch`、`requestedBranch`、`savedBranch` 等替代字段；操作前后统一使用只包含 `registeredBranch`、`actualBranch` 的 `before`/`after`，并发与验证诊断统一使用相同字段组成的 `expectedState`/`observedState`。
- [x] 1.3 保留 `.code-workspace/config.yaml` 的 `projects[].branch` 持久化键和现有 schema，在配置边界显式完成 `branch` 与 `registeredBranch` 的映射，验证读写旧 Workspace 不需要迁移且不会重写无关配置域。
- [x] 1.4 更新现有核心、校验、CLI 和故障注入测试以断言规范字段，并增加静态断言防止公共分支结果或诊断重新引入旧字段；只有本组测试通过后才能开始后续功能开发。

## 2. 建立真正定向的项目校验

- [x] 2.1 为 `validateProject` 增加可观测的定向测试，证明未选项目的缺失路径、分支漂移和 Git 检查函数不会被访问，同时保留与目标有关的名称和路径冲突诊断。
- [x] 2.2 重构 `src/core/validation.js`，让定向校验直接校验目标记录、只检查目标 worktree，并仅用其他记录的静态路径元数据判断目标相关冲突；保持无名称全量校验行为不变。
- [x] 2.3 扩展 `project verify <name>` 的 CLI 测试，覆盖未知项目、无关配置域隔离、未选工程不可访问、结果中只包含目标项目，以及分支诊断只使用 `registeredBranch`、`actualBranch`。

## 3. 实现分支核心服务

- [x] 3.1 在核心层实现目标项目分支状态检查，返回 `registeredBranch`、`actualBranch`、`matches`、`worktreeClean` 和 `registeredBranchExists`，并为脏工作树、本地分支缺失和 Git 检查失败建立稳定错误细节。
- [x] 3.2 在核心层实现安全的注册分支切换，限制为已有本地分支和干净 worktree，禁止隐式 fetch、stash、reset 或创建分支，并在执行前比较只包含规范分支字段的完整计划状态。
- [x] 3.3 实现切换后的分支/干净状态验证、失败补偿切回和补偿失败的 retained external effect 报告，加入每个应用、验证和补偿阶段的故障注入测试。
- [x] 3.4 使实际分支写回配置复用第 1 组建立的 `before`/`after` 与 `expectedState`/`observedState` 合同，保持原子写入、并发条件、无关配置域保留和失败回滚。

## 4. 先交付并验证新 CLI

- [x] 4.1 在命令注册表中声明 `project branch inspect`、`project branch accept-actual` 和 `project branch use-registered` 的参数、`projects` 配置域、交互策略与 `read-only`/`planned-write`/`external` 效果；此阶段暂时保留旧入口以维持迁移窗口。
- [x] 4.2 新建独立的项目分支命令模块并接入三段式路由，确保命令层只负责计划、共享确认、事务/外部效果编排和共享结果构建，所有 Git 与配置持久化都调用核心 API。
- [x] 4.3 实现 `project branch inspect` 的文本与 JSON 结果，覆盖一致、不一致、未知项目、不访问未选工程和规范分支字段。
- [x] 4.4 实现 `project branch accept-actual` 的 skip、确认、原子配置更新、计划漂移检查、完整后置验证与回滚，并迁移原 `sync-branch` 的正向能力测试到规范状态合同。
- [x] 4.5 实现 `project branch use-registered` 的 skip、安全前置条件、确认、外部切换、后置验证、补偿和 retained-effect 诊断测试。
- [x] 4.6 扩展解析、未知选项/多余参数、帮助、补全、稳定命令名、JSON envelope、配置域隔离和错误码测试，确保三条新命令均由注册表驱动且只输出 `registeredBranch`、`actualBranch` 语义。
- [x] 4.7 在不修改 Guard 或分支 Skill 的前提下运行 CLI 架构检查及核心/CLI 分支测试；只有新命令、定向作用域、确认、回滚与外部效果测试全部通过后，才能开始第 5 组任务。

## 5. 后置迁移 Workspace Guard 与分支 Skill

- [x] 5.1 精简 `WORKSPACE_GUARD.md.template`，定义 Workspace 控制平面、`registeredBranch` 期望状态、`actualBranch` 观测状态、CLI 与用户决策职责；用户已指定项目时不先全量 list，并冻结到显式选中项目范围。
- [x] 5.2 重写 `code-workspace-resolve-branch` Skill，使用 `project branch inspect` 收集固定事实，加入只替换占位符的三选一询问模板和确定性可用性说明，不默认推荐任何自动方向。
- [x] 5.3 将 Skill 的两个自动方向分别绑定到 `project branch use-registered` 与 `project branch accept-actual`，删除原始 `git status`、`git show-ref`、`git switch` 和直接配置处理，并规定 CLI 失败后停止且不降级。
- [x] 5.4 将恢复流程改为只重新运行 `project verify <name> --json`，删除恢复后的全量 `project list`，并扩展 Claude/Codex 共享托管资产测试，验证规范术语、固定模板、CLI-only 和目标范围约束。

## 6. 完成破坏性迁移和用户文档

- [x] 6.1 更新 README、中文流程图和日常命令示例，统一使用“注册分支/实际分支”和 “registered branch/actual branch”，解释两个方向、安全限制、JSON 字段迁移和从 `project sync-branch` 到 `project branch accept-actual` 的迁移；双语用户指南只保留分支处理 Skill 入口，不暴露底层命令或状态合同。
- [x] 6.2 从注册表、旧项目命令处理和导出中移除 `project sync-branch`，删除旧帮助/补全入口，并增加在 Workspace 发现前返回未知命令的回归测试。
- [x] 6.3 更新所有命令引用与托管资产断言，通过真实解析器验证三个新命令，断言源码托管资产、README、帮助和补全中不再出现旧命令或 `configuredBranch` 等旧公共字段，并断言双语用户指南不包含 `project branch` 实现细节。
- [x] 6.4 复核 Workspace CLI 对项目仓库职责边界的文档表述，明确 CLI 只负责经确认的安全分支协调，不负责生产代码编辑、分支创建、网络同步或冲突处理。

## 7. 完整验证

- [x] 7.1 运行 `node scripts/check-cli-architecture.js`，确认注册/解析合同、配置域隔离、命令/核心分层、事务与后置条件、结果和错误全部通过。
- [x] 7.2 运行 `npm test`，确认规范分支字段、定向校验、三条分支命令、故障注入、托管资产和文档引用测试全部通过。
- [x] 7.3 运行 `npm run check` 完成架构、测试和打包检查，并审查最终 diff，确认没有修改用户已有的无关文件，也没有遗留旧字段、新 Skill/旧 CLI 混合状态。
