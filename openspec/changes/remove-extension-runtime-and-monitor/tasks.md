## 1. 内置 Agent 集成接管

- [x] 1.1 将 `codew-workspace-guard` 的指令模板、添加项目 Skill/Command、分支恢复 Skill 和工具适用性迁为包内静态托管资产
- [x] 1.2 在 `artifacts/manifest.json` 中登记全部内置 Agent 输出的来源、目标、摘要、渲染变量、工具选择和移除语义
- [x] 1.3 更新 managed-files/init/update/doctor，使内置输出不依赖扩展 manifest、Extension Store 或扩展入口
- [x] 1.4 增加旧 `codew-workspace-guard` installed 记录到新托管文件记录的只读识别和接管计划
- [x] 1.5 为新 Workspace 初始化、已有 Workspace 更新、工具取消选择和用户修改托管文件添加测试

## 2. 历史扩展状态迁移与清理

- [x] 2.1 定义 `.codew/ext-manifest.json`、普通扩展输出和 `.codex/hooks.json` 的 legacy 识别规则与稳定诊断
- [x] 2.2 在 `update/doctor` 中加入不执行扩展入口的只读识别和确认后清理计划
- [x] 2.3 实现可验证的清理事务与后置条件检查；未知或用户修改内容必须保留并报告
- [x] 2.4 验证项目注册文件、权限文件和内置 Agent 输出在迁移过程中保持可用
- [x] 2.5 添加无扩展状态、仅系统扩展状态、普通扩展状态、monitor Hook 状态和用户修改状态的迁移测试

## 3. 删除扩展与监控命令面

- [x] 3.1 从 CLI registry、parser、帮助、补全和命令分发中移除 `extension *`、`ext` 和 `config *`
- [x] 3.2 移除 `init --extensions` 语义，并在写入前返回稳定的破坏性变更诊断
- [x] 3.3 删除扩展选择器、扩展摘要、Registry 生命周期、用户级 extensions 配置和相关 CLI 测试
- [x] 3.4 删除扩展安装、升级、卸载、打包、scaffold、digest、搜索、info 和 runtime 命令实现
- [x] 3.5 删除 `src/hooks/`、抽象 Hook 适配、扩展 Hook 合成和监控状态逻辑
- [x] 3.6 更新 CLI architecture guard 和命令引用校验，确保不存在已移除命令的文档或运行入口

## 4. 核心能力回归

- [x] 4.1 验证 Workspace init/update/language/doctor 在无扩展状态下保持既有配置、状态、语言和托管文件契约
- [x] 4.2 验证 project inspect/add/remove/list/show/verify 和 stdin 项目注册行为不变
- [x] 4.3 验证 project branch inspect/verify/use-registered/accept-actual/update-latest 的确认、事务和后置条件不变
- [x] 4.4 验证 permissions apply 与项目添加/删除的授权事务、Claude/Codex 映射和 Doctor 诊断不变
- [x] 4.5 为内置 Agent Skill 的添加项目和分支恢复流程添加端到端或契约测试

## 5. 代码、依赖与发布瘦身

- [x] 5.1 删除扩展核心模块、Extension Store、Nexus provider、扩展 schemas、扩展脚本、扩展 fixtures 和扩展测试
- [x] 5.2 删除扩展文档和发布目录，更新 package.json `files`、scripts、依赖和 package-lock
- [x] 5.3 确认仅保留 `@clack/prompts`、`js-yaml`、`proper-lockfile` 等核心仍实际使用的依赖
- [x] 5.4 将版本提升为 `2.0.0`，更新 CHANGELOG 的破坏性变更和迁移说明
- [x] 5.5 验证 `npm pack --dry-run` 不包含 extensions、扩展 schemas、扩展开发文档或扩展打包脚本

## 6. 文档与规格同步

- [x] 6.1 重写 README 和中文 README，定位项目为纯本地多项目管理工具并移除扩展/监控用法
- [x] 6.2 更新 FRAMEWORK、Workspace 流程、CLI 架构和扩展架构文档，删除 Extension Host 与 Session 承诺
- [x] 6.3 更新用户指南与内置 Agent 资产，使其不引用已移除命令或扩展状态
- [x] 6.4 同步 OpenSpec delta specs 并运行 `openspec validate --change remove-extension-runtime-and-monitor`
- [x] 6.5 运行 `npm run check`，修复测试、架构检查和打包检查发现的问题
