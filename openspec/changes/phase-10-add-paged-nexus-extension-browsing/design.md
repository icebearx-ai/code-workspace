## Context

Provider 当前可以一次读取多页并返回聚合结果，但 UI 无法感知页边界，也无法在上一页时复用已请求内容。metadata 读取还需要避免逐个串行请求，以降低首屏等待。

## Goals / Non-Goals

**Goals:**

- 提供单页、可继续读取的 Nexus extension browse session。
- 保存页面历史和 continuation token，支持上一页/下一页。
- 对每页 metadata 采用固定并发上限和进程内缓存。
- 不泄露 Nexus 原始 token、Authorization 或敏感 URL。

**Non-Goals:**

- 不实现终端按键处理。
- 不改变 Nexus Provider 的安全校验和包下载协议。
- 不做跨进程持久缓存。

## Decisions

1. 在 core 层新增 browse session/service，而不是让 CLI 或 UI 直接调用 Nexus Search。
2. session 维护 `pages[]`、`currentIndex`、`nextToken`、`complete` 和 query；上一页只读内存缓存，下一页才请求 Nexus。
3. 每页 identity 先由 Search API 获取，再以 4 个并发 worker 获取 package metadata；单个 metadata 失败转为该条目的 warning，不阻断其他条目。
4. 页面结果按 extension ID 稳定排序，并携带 latest candidate、version count、diagnostics 和 `hasNext`。
5. session 内缓存 metadata 和页面；不同 query 不共享结果，避免搜索结果污染。

## Risks / Trade-offs

- [某页 metadata 很慢] → 固定并发、单请求超时、保留已成功项目并显示 partial diagnostics。
- [上一页状态占用内存] → 仅保留当前 session 页面和 metadata，session 结束即释放。
- [Nexus token 失效] → 下一页请求失败时保持当前页，返回稳定错误并允许重试。

## Migration Plan

1. 先实现 page/session core API 并保留现有聚合 search API。
2. 增加多页、上一页缓存、并发和故障测试。
3. 后续选择器只依赖 session API；现有非交互 search 可继续使用聚合 API。
