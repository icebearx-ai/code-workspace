## 1. Store 与 API

- [x] 1.1 为 Monitor Store 增加服务端时钟、10 分钟失活投影和统一 Session 汇总统计
- [x] 1.2 实现单个 Session 删除、关联事件清理和 SSE 更新通知
- [x] 1.3 增加嵌套 Session DELETE API 及稳定的成功和 404 响应

## 2. Monitor 页面

- [x] 2.1 调整 Workspace 和全局统计，使非活跃 Session 不再影响活跃状态
- [x] 2.2 优化 Session 卡片，展示非活跃原因、最后信号时间和生命周期排序
- [x] 2.3 增加 Session 删除操作、确认交互、告警清理和 10 秒快照刷新
- [x] 2.4 补齐中英文状态与删除文案

## 3. 验证

- [x] 3.1 增加 Store 超时边界、恢复、结束优先级和统计测试
- [x] 3.2 增加 Session 删除 Store、HTTP API 和页面契约测试
- [x] 3.3 运行 Monitor 测试、完整测试和 OpenSpec 校验
