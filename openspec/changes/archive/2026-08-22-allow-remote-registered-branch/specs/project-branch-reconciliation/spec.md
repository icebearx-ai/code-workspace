## Modified Requirements

### Requirement: 项目可以安全使用注册分支

`project branch use-registered <name>` SHALL retain local-only behavior by default. When explicitly given `--allow-remote`, it MAY create a local tracking branch from exactly one existing remote-tracking branch. When explicitly given `--remote <remote>`, it MAY fetch only the registered branch from that configured remote, create a local tracking branch, and switch the worktree. It SHALL never overwrite an existing local branch.

#### Scenario: 默认仍拒绝缺失本地分支
- **WHEN** 注册分支不是本地分支，且用户未提供远程选项
- **THEN** 命令在确认和 Git 变更前返回 `PROJECT_REGISTERED_BRANCH_MISSING`

#### Scenario: 使用唯一远程跟踪分支
- **WHEN** 用户提供 `--allow-remote`，且存在唯一的 `refs/remotes/<remote>/<registeredBranch>`
- **THEN** CLI 在确认后创建本地 tracking 分支、切换到注册分支并验证最终分支和干净 worktree

#### Scenario: 远程跟踪分支存在歧义
- **WHEN** 用户提供 `--allow-remote`，且多个 remote 存在同名远程跟踪分支
- **THEN** CLI 在 Git 变更前返回 `PROJECT_BRANCH_REMOTE_AMBIGUOUS`，并列出候选 remote

#### Scenario: 显式 fetch 远程分支
- **WHEN** 用户提供已配置的 `--remote <remote>`，且远程存在注册分支
- **THEN** CLI 在确认后仅 fetch 该分支，创建本地 tracking 分支、切换并验证最终状态

#### Scenario: fetch 失败
- **WHEN** 显式远程不可访问、认证失败或远程分支不存在
- **THEN** CLI 返回稳定 fetch/remote 诊断，且在创建本地分支前保持原 worktree 分支不变

#### Scenario: 远程选项冲突
- **WHEN** 用户同时提供 `--allow-remote` 和 `--remote`
- **THEN** CLI 返回 `CLI_OPTION_CONFLICT`，且不执行 Git 操作

#### Scenario: 确认提示反映远程效果
- **WHEN** 计划需要创建 tracking 分支或 fetch
- **THEN** 确认文本明确列出 remote、fetch、创建本地分支和切换效果；JSON/非 TTY 未提供 `--yes` 时仍返回 `CLI_CONFIRMATION_REQUIRED`

#### Scenario: 创建后验证失败
- **WHEN** 本地分支已创建或切换已发生，但后置验证失败
- **THEN** CLI 尝试切回原实际分支，并报告未自动删除的新建本地分支等 retained Git effects
