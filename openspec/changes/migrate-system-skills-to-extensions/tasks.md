## 1. 系统扩展 Host 策略

- [x] 1.1 增加 `.system` catalog 发现、普通/系统 ID 冲突校验及系统计划标记
- [x] 1.2 在 installed state 中记录并校验 `system: true`
- [x] 1.3 让 init 自动注入适用系统扩展，处理 `--extensions none` 和 `--tools none`
- [x] 1.4 从普通扩展安装选择中隐藏系统扩展，并拒绝显式系统扩展安装
- [x] 1.5 在卸载计划和应用 API 中拒绝系统扩展，返回 `EXTENSION_SYSTEM_MANAGED`

## 2. 系统扩展包迁移

- [x] 2.1 创建 `extensions/.system/codew-workspace-guard/1.0.0` 包及 Workspace Guard 输出
- [x] 2.2 将 `codew-add-projects` 与 `codew-resolve-branch` 的工具相关输出纳入同一系统包
- [x] 2.3 从 `artifacts/manifest.json` 删除两个 Skill、OpenAI metadata 和 Claude add-projects command 条目
- [x] 2.4 更新扩展包入口摘要、发布清单和相关用户文档

## 3. 测试与规范

- [x] 3.1 更新 managed-file 和内置扩展测试以匹配系统扩展模型
- [x] 3.2 增加系统扩展自动安装、隐藏、none、无工具和不可卸载测试
- [x] 3.3 增加系统状态持久化、重复 init、版本升级和失败诊断测试
- [x] 3.4 运行 CLI 架构检查、完整测试和 npm pack 检查
