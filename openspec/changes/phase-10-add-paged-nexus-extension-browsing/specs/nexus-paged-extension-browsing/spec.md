## ADDED Requirements

### Requirement: Nexus 扩展目录支持用户可见分页数据
系统 SHALL 提供按 query 读取单页扩展目录的 core API，返回稳定排序的扩展项、当前页索引、是否存在下一页和可安全消费的诊断；API 不得暴露 Authorization、原始 continuation token 或敏感 URL。

#### Scenario: 读取第一页
- **WHEN** 新建 browse session 并请求第一页
- **THEN** 系统返回 page index 0、扩展项、`hasNext` 和不含凭证的 Registry 摘要

#### Scenario: 读取下一页
- **WHEN** 当前页存在下一页且调用 next
- **THEN** 系统使用内部 continuation 状态获取下一页并返回递增页索引

### Requirement: 已访问页面支持上一页
系统 SHALL 缓存当前 session 已成功读取的页面，调用 previous 时不得重复访问 Nexus；跨页选择所需的扩展身份 SHALL 保持稳定。

#### Scenario: 返回上一页
- **WHEN** 用户在第二页请求上一页
- **THEN** 系统从 session 缓存恢复第一页，网络请求次数不增加

### Requirement: metadata 请求具备有限并发和延迟诊断
系统 SHALL 以固定并发上限获取页面扩展 metadata，单个包失败不得丢弃同页其他成功项；请求中、超时和部分失败 SHALL 转换为稳定诊断。

#### Scenario: 单个 metadata 超时
- **WHEN** 页面中一个包的 metadata 请求超时
- **THEN** 页面仍返回其他成功项，并为该包附加可重试 warning

#### Scenario: 下一页网络失败
- **WHEN** 获取下一页失败
- **THEN** 当前页保持不变，调用方获得稳定错误和重试信息

### Requirement: browse session 不跨查询复用结果
不同 query SHALL 创建隔离的 page/token/metadata 状态，结束 session 后不得保留用户凭证或远端原始响应。

#### Scenario: 切换查询
- **WHEN** 用户从 `jira` 查询切换到 `mcp`
- **THEN** 新查询从第一页开始且不使用旧查询的页面缓存
