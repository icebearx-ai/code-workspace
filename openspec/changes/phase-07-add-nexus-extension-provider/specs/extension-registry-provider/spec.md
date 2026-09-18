## ADDED Requirements

### Requirement: Host 从用户级配置解析唯一 Nexus Registry
Host SHALL 为固定 `@codew-ext` scope 解析一个 HTTPS Nexus npm hosted repository。配置 MUST 来自显式进程注入或用户级 npm 配置；Host MUST NOT 使用当前 Workspace 或其祖先目录中的 `.npmrc`，也不得向未配置的公网 Registry 回退。

#### Scenario: 从用户 npm 配置解析 Registry
- **WHEN** 用户级 npm 配置将 `@codew-ext` 映射到合法 Nexus repository URL
- **THEN** Provider 解析固定 origin、repository 和 scope，且不读取 Workspace `.npmrc`

#### Scenario: Workspace 试图覆盖 Registry
- **WHEN** 当前 Workspace 包含不同的 scope registry 或认证配置
- **THEN** Provider 忽略该文件并继续使用受信用户级配置

#### Scenario: Registry 未配置
- **WHEN** 没有显式配置且用户级 npm 配置没有 `@codew-ext` 映射
- **THEN** Provider 报告稳定未配置状态且不访问 npmjs.org

### Requirement: Registry 凭证按 URL 隔离且永不持久化
Provider SHALL 只向与配置 Registry origin 和 repository path 匹配的请求附加 npm bearer/basic 凭证。凭证 MUST NOT 出现在 Workspace、Store registry、错误 details、JSON result、日志或重定向到其他 origin 的请求中。

#### Scenario: 认证下载
- **WHEN** 用户级配置包含目标 Nexus URL 的有效凭证
- **THEN** metadata 和同 Registry tarball 请求携带凭证，下载成功后只保存非敏感 provenance

#### Scenario: 跨 origin 重定向
- **WHEN** Nexus 响应试图把请求重定向到不同 origin
- **THEN** Provider 不转发认证信息，并按安全重定向策略拒绝或重新验证目标

#### Scenario: 认证失败
- **WHEN** Nexus 返回未认证或无权限
- **THEN** Provider 返回脱敏稳定错误和登录/权限修复建议，不回显凭证

### Requirement: Provider 冻结 npm 元数据中的精确候选
Provider SHALL 从 npm packument 验证 package name、SemVer、deprecated、运输 envelope、tarball URL 和 SHA-512 integrity，并返回精确版本候选。metadata 仅用于下载前解析；Provider MUST NOT 仅依据 metadata 将包标记为可信 Store 包。

#### Scenario: 合法版本候选
- **WHEN** packument 包含身份一致的版本、同 Registry tarball URL 和 SHA-512 integrity
- **THEN** Provider 返回冻结 version、URL、integrity 和 transport identity

#### Scenario: 缺少强完整性字段
- **WHEN** 版本只有 SHA-1 shasum 或缺少 integrity
- **THEN** Provider 拒绝该版本并报告不安全 metadata

#### Scenario: tarball 越过配置 repository
- **WHEN** metadata 将 tarball 指向未配置 origin 或 repository
- **THEN** Provider 在下载前拒绝候选

### Requirement: 下载和解包遵守资源与路径边界
Provider SHALL 流式下载到独立临时文件，实施超时、重定向、响应大小限制并增量验证 npm integrity。解包 MUST 只接受固定包装布局中的普通文件和目录，并拒绝路径逃逸、重复/冲突路径、符号链接、硬链接、特殊文件、文件数及展开大小超限。

#### Scenario: 下载完整性匹配
- **WHEN** tarball 字节与冻结 SHA-512 integrity 匹配且归档布局安全
- **THEN** Provider 可以解包并进入 Extension 层验证

#### Scenario: 下载摘要不匹配
- **WHEN** 响应成功但实际 tarball 字节与 integrity 不同
- **THEN** Provider 删除临时内容、报告完整性错误且不更新 Store

#### Scenario: 压缩炸弹或链接条目
- **WHEN** 归档展开大小超过上限或包含符号链接、硬链接或特殊文件
- **THEN** Provider 中止解包、清理临时内容且不读取链接目标

### Requirement: 远端包重新通过 Extension 合同验证
Provider SHALL 将固定 `extension/` 子目录作为候选包根，重新验证 npm envelope 与 manifest 身份、Extension Spec 支持、manifest/entry/runtime 摘要和完整 package digest。运输 metadata 与真实 manifest 不一致时 MUST 失败。

#### Scenario: 双层身份一致
- **WHEN** npm name/version、运输 envelope、Extension manifest 和实际摘要全部一致
- **THEN** Provider 返回可导入 Store 的冻结 Extension package candidate

#### Scenario: manifest 身份被替换
- **WHEN** tarball integrity 有效但内部 manifest ID 或版本与 npm 身份不同
- **THEN** Provider 以供应链身份错误拒绝包

### Requirement: Store 原子记录 Nexus 包和非敏感来源
Host SHALL 复用 Store 包锁、临时目录和原子提交导入 Nexus candidate，并在 registry 中记录 registry origin、repository、npm package name 和 archive integrity。记录 MUST NOT 包含凭证或带敏感 query 的 tarball URL。

#### Scenario: 首次导入 Nexus 包
- **WHEN** Store 不存在目标 `id@version` 且 candidate 完整验证通过
- **THEN** Host 原子提交不可变包和 Nexus provenance

#### Scenario: 复用相同包
- **WHEN** Store 已存在相同 `id@version` 和相同 package digest
- **THEN** Host 复用现有目录并保持所有引用，不重复复制包

#### Scenario: 同版本内容冲突
- **WHEN** Store 或内置 Provider 已存在相同 `id@version` 但 package digest 不同
- **THEN** Host 以稳定 package conflict 失败且不覆盖任一目录

### Requirement: Nexus 搜索和健康检查封装为分页核心接口
Provider SHALL 使用 Nexus Search API 的固定 repository、npm format 和 `@codew-ext` scope 查询组件，处理 continuation token，并将 Nexus 响应转换为不泄漏产品内部字段的统一候选结果。健康检查 SHALL 分别验证 Registry 配置、认证、metadata 和 Search 能力。

#### Scenario: 多页搜索
- **WHEN** Nexus 搜索结果包含 continuation token
- **THEN** Provider 按页读取直到结束或达到调用方限制，并按扩展身份去重

#### Scenario: Search API 不兼容
- **WHEN** 公司 Nexus 版本返回未知或缺少必需的搜索响应字段
- **THEN** Provider 返回稳定兼容错误，不影响已有 Store 包或 Workspace
