## 1. CLI 合同

- [x] 1.1 修改 extension search registry、配置域、interaction/effects 合同并更新架构测试
- [x] 1.2 实现 TTY、JSON、non-TTY 分流和稳定错误/结果 envelope

## 2. 选择与动作

- [x] 2.1 将共享 picker 状态映射为 install/update/current-disabled
- [x] 2.2 在确认前冻结候选版本、digest、source 和 action
- [x] 2.3 复用 Registry lifecycle、锁、批处理、验证和回滚执行选择

## 3. 验证与文档

- [x] 3.1 增加已安装最新版禁用、过期更新、未安装安装和系统隐藏测试
- [x] 3.2 增加 JSON/non-TTY 只读、确认取消、部分失败和幂等测试
- [x] 3.3 更新帮助、README 和真实 parser 命令校验
- [x] 3.4 运行 CLI architecture checker、完整测试和 npm pack check
