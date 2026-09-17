## ADDED Requirements

### Requirement: npm 包身份确定映射 Extension 身份
系统 SHALL 将扩展 `id@version` 映射为 `@codew-ext/<id>@<version>`，并生成 schemaVersion 1 的 npm 运输 envelope。npm version、envelope extension ID/version/Extension Spec 与 `extension/manifest.json` MUST 完全一致；运输 envelope MUST NOT 替代 Extension manifest 的执行合同地位。

#### Scenario: 生成匹配的 npm 身份
- **WHEN** 打包 `zhuiyi-jira-mcp@1.1.0`
- **THEN** tarball 的 npm name/version 为 `@codew-ext/zhuiyi-jira-mcp@1.1.0`，envelope 回显相同 Extension 身份和规范版本

#### Scenario: 身份不一致
- **WHEN** 源 manifest 身份、请求身份或生成的 npm name/version 任一不一致
- **THEN** 打包在创建最终 tarball 前以稳定身份错误失败

### Requirement: npm 包装不改变 Extension package digest
npm tarball SHALL 使用固定 `package/package.json` 与 `package/extension/` 布局。Host MUST 只对 `package/extension/` 应用 Extension package digest；运输 `package.json` MUST NOT 进入该摘要。

#### Scenario: 内置与 Nexus 载荷摘要相同
- **WHEN** 同一扩展目录直接计算摘要并在打包后从 `package/extension/` 重新计算摘要
- **THEN** 两次 `packageSha256` 完全相同

#### Scenario: 包装根发生漂移
- **WHEN** tarball 缺少固定 `extension/` 根、包含额外包装根或将 manifest 放在其他位置
- **THEN** 包装验证以稳定布局错误失败

### Requirement: 发布包自包含且不声明 npm 执行行为
系统生成的运输 `package.json` MUST NOT 包含 dependencies、optionalDependencies、peerDependencies、bundledDependencies 或 lifecycle scripts。打包过程 MUST NOT 执行扩展入口、runtime、npm install、npm pack 或任何源代码。

#### Scenario: 打包合法自包含扩展
- **WHEN** 扩展目录由普通文件和目录组成且 manifest 与入口摘要有效
- **THEN** 系统只读取和归档内容，生成不含依赖与 scripts 的运输 envelope

#### Scenario: 归档包含不安全文件类型
- **WHEN** 扩展目录包含符号链接、设备、socket、FIFO、路径逃逸或超过声明限制的内容
- **THEN** 系统拒绝打包且不留下最终 tarball

### Requirement: extension pack 原子生成并验证 tarball
系统 SHALL 提供 `extension pack <source> --output <directory>` planned-write 命令。命令 MUST 与 Workspace 无关，MUST 在输出目录缺失且可创建时递归创建该目录，MUST 在临时文件中生成 tarball、重新打开并完成 envelope、manifest、入口和 package digest 后置验证后才原子提交；已存在目标不得覆盖。

#### Scenario: 成功打包
- **WHEN** 用户为有效扩展指定可创建的输出目录且目标文件不存在
- **THEN** 命令只创建一个已重新验证的 `.tgz`，并在统一结果中返回扩展身份、文件路径、npm integrity 和 Extension 摘要

#### Scenario: 目标已经存在
- **WHEN** 规范输出文件名在输出目录中已存在
- **THEN** 命令在覆盖前失败并保留原文件

#### Scenario: 最终验证失败
- **WHEN** 临时 tarball 无法重新读取或其载荷摘要与冻结源目录不一致
- **THEN** 命令删除临时内容、不提交最终文件并返回稳定错误

### Requirement: 当前内置扩展共享同一分发合同
Code Workspace 随包提供的普通扩展 SHALL 均可通过同一 pack API 生成 npm 包，不得为 Jira、OpenSVN、Monitor 或 Skill 扩展增加产品专用归档分支。系统扩展是否发布到 Nexus MUST 由发布策略决定，而不是由通用打包协议产生不同格式。

#### Scenario: 多种扩展使用同一打包器
- **WHEN** 分别打包一个 runtime 扩展、MCP 配置扩展和 Skill 扩展
- **THEN** 三者使用相同 npm envelope 和目录布局，差异只存在于各自 Extension manifest 与私有文件
