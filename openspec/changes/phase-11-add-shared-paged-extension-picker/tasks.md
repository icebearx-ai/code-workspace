## 1. 选择器模型

- [x] 1.1 定义 page item 状态、selection action 和 picker session 数据结构
- [x] 1.2 实现搜索/列表双焦点及纯键盘 reducer

## 2. 交互实现

- [x] 2.1 实现左/右键上一页/下一页、边界和加载锁
- [x] 2.2 实现跨页选择、禁用项、状态文案、取消和重试
- [x] 2.3 将输入输出和 page provider 注入 picker，避免直接访问 Nexus 或 Workspace

## 3. 验证

- [x] 3.1 增加 reducer 单测覆盖所有键位和焦点转换
- [x] 3.2 增加分页、多选、状态展示和失败交互测试
