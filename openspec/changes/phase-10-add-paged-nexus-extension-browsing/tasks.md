## 1. 分页核心服务

- [x] 1.1 设计并实现 page/session 数据模型和安全结果投影
- [x] 1.2 接入 Nexus continuation token 的 next/previous 语义和 session 缓存

## 2. 延迟与并发

- [x] 2.1 为每页 metadata 实现固定并发 worker 和单请求超时
- [x] 2.2 实现 partial result、重试诊断和失败时保持当前页

## 3. 验证

- [x] 3.1 增加分页、缓存、token 失效、查询隔离测试
- [x] 3.2 增加并发上限、慢请求、部分失败和秘密脱敏测试
