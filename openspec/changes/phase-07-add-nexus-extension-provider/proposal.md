## Why

phase-06 能生成 Nexus 可托管的扩展包，但 Host 仍只能从发布包内置目录导入 Store。需要增加一个只负责可信 Nexus/npm 元数据、认证、下载和验证的 Package Provider，在不改变 Workspace 激活事务的前提下把远端精确包安全导入现有用户级 Store。

## What Changes

- 增加 Nexus npm Package Provider，读取固定 `@codew-ext` scope 的 npm metadata，并解析精确版本、tarball URL、integrity、deprecated 和运输 envelope。
- 从用户级 npm 配置或显式环境注入解析与 Registry URL 精确匹配的凭证；禁止使用 Workspace 内 `.npmrc`，禁止持久化或输出凭证。
- 下载到临时位置，限制重定向、响应体大小和超时，验证 npm integrity，再安全解包固定 `extension/` 根目录。
- 重新验证 Extension manifest、入口摘要、完整 package digest 和 phase-06 的身份映射，再以原子 Store 导入流程保存不可变包和来源证明。
- 提供 Nexus Search API 的分页查询和健康检查核心接口，但不在本 Change 增加用户 CLI 或修改 Workspace activation。
- 保留内置 Package Provider；相同 `id@version` 的不同 digest 必须稳定失败，不得按来源优先级静默覆盖。
- 本 Change 是执行顺序第 2 步，依赖 `phase-06-package-extensions-for-nexus`。

## Capabilities

### New Capabilities

- `extension-registry-provider`: 定义 Nexus/npm Registry 配置、认证、元数据、搜索、下载、完整性验证、来源证明和 Store 导入行为。

### Modified Capabilities

- `extension-execution-protocol`: 将可执行可信包来源从仅内置目录扩展为内置 Provider 或经完整验证后导入 Store 的公司 Nexus 包，同时保持 Store 中精确版本和 package digest 为执行边界。

## Impact

影响核心 Package Provider 抽象、Extension Store registry schema 与迁移、网络客户端、npm integrity 和 tar 解包依赖、用户级 npm 配置读取、稳定错误码及网络/完整性/凭证测试。本 Change 不新增或更改 Workspace 写入命令。
