## Why

Nexus Search 已支持 continuation token，但当前扩展列表一次性加载且不可由用户翻页。线上扩展数量和 metadata 网络延迟会使初始化选择不够可控，需要把 Nexus 分页变成用户可见的、可缓存的分页数据能力。

## What Changes

- 增加面向扩展目录的分页读取 API，暴露当前页、是否有下一页和安全的页面状态。
- 使用 Nexus continuation token 获取下一页，并缓存已访问页面以支持上一页。
- 搜索结果 metadata 采用有限并发，避免串行等待或无限并发。
- 增加请求中、超时、部分 metadata 失败和可重试的稳定诊断。
- 不在本 Change 实现终端选择器或 Workspace 写入。

## Capabilities

### New Capabilities

- `nexus-paged-extension-browsing`: 定义 Nexus 扩展目录分页、延迟和页面缓存契约。

### Modified Capabilities

无。

## Impact

影响 `src/core/nexus-extension-provider.js`、`src/core/extension-registry-lifecycle.js`、Registry 测试和诊断模型。该 Change 为后续共享选择器提供无 UI 的分页数据服务。
