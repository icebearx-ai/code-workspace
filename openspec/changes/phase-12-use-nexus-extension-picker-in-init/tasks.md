## 1. Init 接口切换

- [x] 1.1 将 wizard 的普通扩展输入改为共享 picker adapter
- [x] 1.2 将 picker 选择接入 Registry lifecycle 计划冻结和确认摘要
- [x] 1.3 保留非交互 `--extensions` 的 Nexus/Store 解析路径

## 2. 系统与失败边界

- [x] 2.1 确保系统扩展隐藏、自动加入并参与冲突规划
- [x] 2.2 实现 Nexus 未配置、超时、翻页失败时的跳过/重试诊断

## 3. 验证

- [x] 3.1 增加 init 交互 picker、状态、翻页和系统扩展测试
- [x] 3.2 验证核心 init 与扩展失败隔离、确认前无 Workspace 写入
- [x] 3.3 更新文档并运行 CLI architecture checker 和完整测试
