# Code Workspace 用户指南

这是一份在初始化完成后使用 Code Workspace 的简明指南。

## 添加工作区项目

Codex：

```text
$code-workspace-add-projects /absolute/path/to/project-a /absolute/path/to/project-b
```

Claude Code：

```text
/code-workspace:add-projects /absolute/path/to/project-a /absolute/path/to/project-b
```

根据提示检查项目记录并只确认一次。add-projects skill 会用一次只读采集逐项检查路径；某个项目失败时会报告具体诊断并继续检查其他项目，不会静默忽略失败项。确认后，所有有效记录通过 stdin 一次交给 `project add`，不需要临时 JSON 文件，也不会默认追加第二次 verify。

## 升级 Code Workspace

先升级全局软件包，再更新当前工作区的托管文件，最后检查健康状态：

```bash
npm install -g @icebearx-ai/code-workspace@latest
codew update
codew doctor
```

`update` 会更新托管指令、Workspace 技能、Hook 和本指南。如果托管文件包含未知的本地修改，更新会停止。请先检查文件；只有明确要覆盖这些修改时才使用 `--force`。

## 工作区语言

初始化时可选择 Workspace 语言，也可以显式指定：

```bash
codew init --language zh-CN
codew language
```

所选偏好保存在 `.code-workspace/config.yaml` 的 `workspace.language`。已有工作区可通过以下命令切换语言：

```bash
codew update --language zh-CN
```

该操作也会切换本托管指南。已有项目 context 不会自动翻译。

## 使用 Agent Monitor

为所有工作区启动一个全局 Monitor：

```bash
codew monitor
```

打开命令输出的本地地址。面板会显示工作区、执行状态、待授权请求、已完成轮次和实时信号。Monitor 语言在页面中单独选择，与 `workspace.language` 相互独立。

必要时可使用其他端口：

```bash
codew monitor --port 8080
```

所有参与监控的工作区都必须在 `.code-workspace/config.yaml` 中使用相同 URL。初始化后，请在 Codex 中使用 `/hooks` 检查并信任项目 Hook。

## 实用命令

```bash
# 检查安装和工作区健康状态
codew doctor

# 更新所有托管文件
codew update

# 应用 Agent 项目目录授权
codew permissions apply --yes

# 校验本地项目
codew project verify
codew project verify <project-name>
```

目录访问由用户授权。Code Workspace 负责展示请求的变更、实施并验证变更，以及报告结果。`permissions apply` 只补齐已注册项目缺失的授权，不撤销额外目录。普通 `update` 不会改变授权。

查询结果需要交给 Codex 或脚本处理时，可添加 `--json`。

## Workspace Skills

- `$code-workspace-add-projects` — 检查并注册本地 Git 项目，同时生成供 AI 导航使用的简洁 context。
- `$code-workspace-resolve-branch` — 安全解决选中项目的分支不一致问题，并确认分支对齐。

| 用途 | Codex | Claude Code |
| --- | --- | --- |
| 添加工作区项目 | `$code-workspace-add-projects` | `/code-workspace:add-projects` |
| 解决项目分支不一致 | `$code-workspace-resolve-branch` | `/code-workspace-resolve-branch` |
