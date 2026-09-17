## Context

当前扩展的可信输入是 `extensions/<id>/<version>/` 目录，Host 对该目录计算 `packageSha256`。Nexus 的 npm hosted repository 要求发布 npm tarball 和 `package.json`；如果直接把运输用 `package.json` 放入扩展目录，同一扩展的内置副本与 Nexus 副本将得到不同 package digest，破坏 Store 的不可变身份。

本 Change 先固定“扩展包”和“npm 运输包装”之间的边界，并提供可在本仓库及外部扩展仓库复用的打包命令。后续网络 Provider 只能消费这里定义的包，不得自行猜测 tarball 布局。

## Goals / Non-Goals

**Goals:**

- 生成 Nexus npm hosted repository 可接受的标准 npm tarball。
- 保持真实扩展目录内容与现有 `packageSha256` 算法不变。
- 在发布前复用 Host 的 manifest、入口、目录和 Extension Spec 校验。
- 让打包命令不依赖 Workspace、不执行扩展代码和 npm 生命周期脚本。
- 提供稳定的机器结果供 CI 获取文件、身份和摘要。

**Non-Goals:**

- 不连接 Nexus、不处理登录、不执行 `npm publish`。
- 不解析远端版本、不安装或激活扩展。
- 不引入扩展依赖或 npm dependency 安装。
- 不要求 tar/gzip 字节在不同 Node 或依赖版本之间完全可复现；真实扩展目录摘要必须可复现。

## Decisions

### D1: npm 包装与真实扩展包分层

tarball 固定为：

```text
package/package.json
package/extension/manifest.json
package/extension/<extension files>
```

`package/package.json` 是运输 envelope，`package/extension/` 才是 Extension package root。Store 导入和 `packageSha256` 只针对 `extension/`。这使同一 `id@version` 的内置目录与 Nexus 载荷可以产生相同 digest。

不采用“在每个扩展目录增加 package.json”，因为这会改变所有既有包摘要并制造内置与远端身份分叉。

### D2: npm 身份使用固定 scope 映射

映射固定为 `@codew-ext/<manifest.id>@<manifest.version>`。运输 envelope 回显 `extensionId`、`extensionSpecVersion` 和固定 `packageRoot: "extension"`。打包时校验 npm name/version 与 manifest 一致；消费端仍须重新验证 manifest，不能把 envelope 当成执行事实。

首版不支持自定义 scope，避免一个 Extension ID 在不同命名规则下出现多个远端身份。

### D3: 提供 `extension pack` 而不是 `extension publish`

公共命令合同为：

```yaml
command: extension pack
workspace: none
config: []
interaction: never
effects: planned-write
arguments:
  - name: source
    required: true
options:
  output: string-required
writes:
  - 递归创建缺失的 output 目录
  - output 目录中的一个新 .tgz
verification:
  - 重新打开 tarball
  - 验证 npm envelope
  - 重新验证 extension 根和 packageSha256
rollback:
  - 失败时删除本次临时文件和尚未提交的目标文件
```

输出目录必须显式提供；目录缺失且可创建时递归创建。目标文件已存在时失败，不覆盖。命令先在同目录临时文件生成并验证，再原子 rename。命令层只编排；源目录检查、包装、归档和验证由 core API 完成。

不提供 `publish` 命令，避免 Code Workspace 持有发布凭证或复制 npm/Nexus 的权限和上传协议。CI 对已验证 tarball 调用标准 `npm publish <tarball>`。

### D4: 打包不执行任何扩展或 npm 代码

打包过程只读取普通文件、校验 schema/摘要并创建归档。它不运行 `init.js`、runtime、`npm pack`、`npm install` 或任何 lifecycle script。运输 envelope 由 Host 生成，不接受源目录提供的 scripts、dependencies 或 bundled dependencies。

### D5: 使用受维护的 tar 实现并固定安全选项

实现使用 Node 生态中受维护且支持创建与读取 gzip tar 的库，固定 POSIX 路径、`package/` 前缀、普通文件/目录类型和稳定排序。归档验证复用后续 Provider 将使用的安全读取器，以避免发布端和消费端对文件类型、路径或大小限制理解不同。

新增依赖前需审查许可证、维护状态和传递依赖；不得通过 shell 调用系统 `tar` 形成跨平台差异。

### D6: JSON 结果冻结发布所需事实

成功结果至少返回 npm package name、扩展 ID、版本、Extension Spec、tarball 绝对路径、tarball integrity、manifest SHA-256、entry SHA-256 和 package SHA-256。结果不得包含 Nexus URL 或凭证，因为 pack 本身与 Registry 无关。

## Risks / Trade-offs

- [手工 tar 实现与 npm 不兼容] → 使用标准库创建 `package/` 布局，并以真实 `npm publish`/Nexus fixture 做契约测试。
- [包装元数据被误当作执行合同] → 文档、schema 和消费端均要求下载后重新验证 manifest 与目录摘要。
- [大包导致内存或磁盘压力] → 采用流式归档、文件数/单文件/总大小限制和临时文件清理。
- [新增公共命令扩大 CLI 面] → 在 registry 中声明完整合同，增加 parser、JSON、失败回滚和文档命令校验测试。

## Migration Plan

1. 引入运输 envelope schema、包名映射和 core pack API。
2. 注册 `extension pack` 并完成原子输出、结果和失败测试。
3. 对所有当前内置扩展执行 pack/重新验证 smoke test。
4. 在 CI 中产出 tarball，但在 phase-07 完成前不要求消费者下载。
5. 回滚时移除命令和生成逻辑；既有扩展目录、Store 与 Workspace 状态不变。

## Open Questions

- 在实现阶段选定 tar 库后，是否需要固定其主版本以保证长期文件属性一致。
- 单包总大小、文件数和单文件大小的首版上限需结合当前 monitor 资源包测量后确定。
