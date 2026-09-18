## ADDED Requirements

### Requirement: 用户可在 Workspace 外搜索 Nexus 扩展
系统 SHALL 提供 `extension search [query]` external 命令，通过配置的 Nexus Provider 搜索固定 repository 和 `@codew-ext` scope。命令 MUST 不要求 Workspace、不执行扩展代码，并将分页 Nexus 结果转换为统一的扩展级文本和 JSON 数据。

#### Scenario: 按关键词搜索
- **WHEN** 用户在任意目录执行 `codew extension search jira`
- **THEN** 系统返回匹配 scope 的有序扩展身份、描述和版本摘要，不显示其他 repository 或普通 npm 包

#### Scenario: Registry 未配置
- **WHEN** 用户执行搜索但没有可信 Registry 配置
- **THEN** 命令以稳定未配置错误失败并提供用户级 npm scope 配置建议

#### Scenario: 搜索结果分页
- **WHEN** Nexus 返回多页组件
- **THEN** 命令通过 Provider continuation 接口读取到固定上限、按扩展身份去重，并在结果中说明是否截断

### Requirement: 用户可查看扩展远端详情
系统 SHALL 提供 `extension info <name>` external 命令，从 npm metadata 返回 package/Extension 身份、描述、可见版本、deprecated 状态和最高默认候选。info MUST NOT 下载 tarball、导入 Store 或执行扩展。

#### Scenario: 查看存在的扩展
- **WHEN** 用户查询 Nexus 中存在的 `zhuiyi-jira-mcp`
- **THEN** 命令返回 `@codew-ext/zhuiyi-jira-mcp` 的版本集合、最高兼容正式候选和 deprecated 信息

#### Scenario: 远端包不存在
- **WHEN** scope 下没有对应 npm package
- **THEN** 命令返回稳定 not-found 错误并包含请求的 Extension ID

### Requirement: 发现结果区分提示与权威验证
搜索和详情 SHALL 将 npm envelope 兼容性标记为 metadata-level，并明确安装前仍需下载验证 Extension manifest 和 package digest。未知 Extension Spec、prerelease 和 deprecated 版本 MUST 在结果中可诊断，但不得成为默认安装候选。

#### Scenario: metadata 声明兼容版本
- **WHEN** npm metadata 声明 Host 支持的 Extension Spec
- **THEN** info 将其标记为预筛选兼容，并说明最终兼容性在 tarball 验证后确定

#### Scenario: 只有 deprecated 或 prerelease
- **WHEN** 包没有可用的稳定非 deprecated 版本
- **THEN** search/info 不报告默认可安装版本，并保留可见版本及原因诊断

### Requirement: 发现命令结果与凭证隔离
发现命令 SHALL 使用共享 result envelope 和稳定诊断；JSON 与文本 MUST NOT 包含 Authorization、token、`.npmrc` 路径、原始 Nexus payload 或带敏感 query 的 URL。

#### Scenario: Nexus 认证失败
- **WHEN** Nexus 返回 401 或 403
- **THEN** 命令报告 Registry 身份、稳定认证/权限错误和修复建议，结果中不包含凭证
