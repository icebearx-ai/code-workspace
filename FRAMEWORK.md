# Code Workspace 架构

Code Workspace 是一个轻量本地控制平面，不是生产项目，也不是插件运行时。

```text
┌────────────────────────────────────────────┐
│ Built-in Agent Integration                 │
│ AGENTS.md / CLAUDE.md / Skills / 权限适配 │
└──────────────────────────┬─────────────────┘
                           │
┌──────────────────────────▼─────────────────┐
│ Workspace Project Domain                   │
│ 项目注册表 / 分支期望状态 / 校验          │
└──────────────────────────┬─────────────────┘
                           │
┌──────────────────────────▼─────────────────┐
│ Foundation                                 │
│ CLI / 配置 / 事务 / 诊断 / 国际化         │
└────────────────────────────────────────────┘
```

## Foundation

Foundation 提供：

- CLI registry、parser、统一结果和错误 envelope；
- 配置读取、迁移和原子持久化；
- 计划、确认、事务、回滚和后置验证；
- 托管资产摘要和完整性检查；
- 中英文支持。

Foundation 不理解项目归属、Git 分支权威或 Agent 配置格式。

## Workspace Project Domain

Workspace Project Domain 负责：

- Workspace 身份；
- 项目注册、删除、列表和查询；
- 显式项目作用域；
- 注册分支与实际分支的检查和协调；
- `updateLatest` 受限 fast-forward；
- 项目与 Workspace Doctor。

安全边界：

- 不根据对话猜测项目、路径、归属或分支；
- 不编辑项目生产代码；
- 不执行 stash、reset、rebase、非 fast-forward merge 或冲突处理；
- 不读取或写入项目 `openspec/`。

## Built-in Agent Integration

Agent 集成是 CLI 发布物的一部分，不是可插拔扩展：

- `AGENTS.md` / `CLAUDE.md`；
- `codew-add-projects`；
- `codew-resolve-branch`；
- Claude / Codex 权限适配器。

所有输出由 `artifacts/manifest.json` 声明来源、摘要、目标、工具适用性和托管语义。CLI 负责规划、确认、写入、验证和取消选择后的移除/遗忘。

## 非目标

- 不安装、升级或卸载扩展；
- 不提供 Registry、Extension Store 或扩展运行时；
- 不监控 AI Session；
- 不管理会话生命周期；
- 不读写 `openspec/`；
- 不代替用户处理 Git 冲突或生产代码。

## 旧扩展状态

`.codew/ext-manifest.json` 只作为历史迁移输入。可验证的旧普通扩展文件和扩展 Hook 可在确认后清理；未知内容保留并由 Doctor 报告。内置 Agent 输出由新的 managed-file 记录接管。
