# 使用 Nexus 托管 Code Workspace 扩展

本文定义公司内部使用 Sonatype Nexus Repository 托管、发现和分发 Code Workspace 扩展的推荐方案。Nexus 负责 npm 包托管、认证、授权、搜索、审计和保留策略；Code Workspace 负责扩展身份校验、下载完整性校验、本地不可变 Store 导入以及 Workspace 激活事务。

本文是部署与协作说明，不替代 Extension Spec。扩展包的执行合同仍以 `spec/extension/` 下的版本化规范、JSON Schema 和 `manifest.json` 为准。

## 1. 目标与边界

目标：

- 使用公司现有 Nexus，不建设新的 Registry 服务、数据库、对象存储或管理后台。
- 通过 npm hosted repository 提供 SemVer、scope、包元数据和 tarball 分发。
- 让扩展发布由受控 CI 完成，普通用户只有搜索和下载权限。
- 保持现有用户级 Extension Store、package digest、Workspace activation、事务和回滚语义。
- 支持 Nexus UI 与 Code Workspace CLI 两种发现入口。

非目标：

- 不允许任意第三方发布扩展。
- 不把 Nexus 或 npm 当成扩展执行安全沙箱。
- 不通过 `npm install` 安装扩展，不创建 `node_modules`，不执行 npm 生命周期脚本。
- 不在第一版引入扩展依赖、多个 Registry 聚合、包签名或强制远程吊销。

## 2. 总体架构

```text
扩展源码仓库
    │
    │ CI: validate → pack → approve → npm publish
    ▼
┌──────────────────────────────────────────────┐
│ Nexus Repository                            │
│ npm (hosted): codew-extensions              │
│ scope: @codew-ext                           │
│ immutable versions / RBAC / search / audit  │
└──────────────────────┬───────────────────────┘
                       │ npm metadata + tarball
                       ▼
             Nexus npm Package Provider
                       │
              integrity + safe extract
                       │
                       ▼
             User Extension Store
                       │ exact version + packageSha256
                       ▼
             Workspace Activation
```

Nexus 不直接写入 Workspace。Code Workspace 不信任 Nexus 返回的可执行内容：下载后仍须验证 npm tarball integrity、npm envelope、Extension manifest、入口摘要和解包后的完整 package digest。

## 3. Nexus 仓库配置

创建专用仓库：

| 字段 | 建议值 |
|---|---|
| Recipe | `npm (hosted)` |
| Name | `codew-extensions` |
| Online | enabled |
| Blob store | 按公司备份与容量策略选择 |
| Deployment policy | `Disable redeploy` |
| Cleanup | 正式版本不自动清理；预发布版本可单独清理 |
| Anonymous access | disabled |

客户端和 CI 直接使用 hosted endpoint：

```text
https://nexus.example.com/repository/codew-extensions/
```

不要让 Code Workspace 使用混合 npmjs.org proxy 的 npm group。直接访问专用 hosted repository 可以避免公网同名包回退、依赖混淆和无关搜索结果。

Nexus 官方资料：

- [npm Registry](https://help.sonatype.com/en/npm-registry.html)
- [Publishing npm Packages](https://help.sonatype.com/en/publishing-npm-packages.html)
- [Configurable Repository Fields](https://help.sonatype.com/en/configurable-repository-fields.html)

## 4. 包命名与内容

所有扩展使用固定 npm scope `@codew-ext`，npm 包名与 Extension manifest ID 建立一一映射：

```text
manifest.id                     npm package
monitor                         @codew-ext/monitor
zhuiyi-jira-mcp                 @codew-ext/zhuiyi-jira-mcp
zhuiyi-opensvn-mcp              @codew-ext/zhuiyi-opensvn-mcp
```

npm tarball 使用包装层，真实扩展包位于固定的 `extension/` 子目录：

```text
package/
├── package.json
└── extension/
    ├── manifest.json
    ├── init.js
    ├── runtime.js
    ├── lib/
    └── assets/
```

包装层的 `package.json` 用于 Nexus/npm 运输，不属于 Extension package digest。Code Workspace 解包后只对 `extension/` 计算现有规范目录摘要，因此同一个内置扩展和 Nexus 扩展可以得到相同 `packageSha256`。

示例运输元数据：

```json
{
  "name": "@codew-ext/zhuiyi-jira-mcp",
  "version": "1.1.0",
  "description": "为 Codex 和 Claude 配置 Jira MCP 服务",
  "keywords": ["code-workspace-extension", "jira", "mcp"],
  "codeWorkspace": {
    "schemaVersion": 1,
    "extensionId": "zhuiyi-jira-mcp",
    "extensionSpecVersion": 1,
    "packageRoot": "extension",
    "packageSha256": "c69503ed5b372e5f9536b6b4ef74e75f521c22f2a96c7a0445446c1f5db1a417"
  },
  "files": ["extension"]
}
```

`codeWorkspace` 只用于发现和下载前筛选，不是可信执行事实。下载后必须重新读取并验证 `extension/manifest.json`。

运输 envelope 的规范性 JSON Schema 是 `schemas/extension-npm-transport-envelope-v1.json`。Code Workspace 生成的 envelope 不包含 dependencies、optionalDependencies、peerDependencies、bundled dependencies、lifecycle scripts 或 Registry URL；发布目标由 CI 的 `npm publish --registry` 参数提供。

发布校验必须拒绝：

- `dependencies`、`optionalDependencies`、`peerDependencies` 和 bundled dependencies；
- `preinstall`、`install`、`postinstall`、`prepare` 等生命周期脚本；
- npm package name、version 与 manifest ID、version 不一致；
- `packageRoot` 不是固定的 `extension`；
- manifest、安装入口或 runtime 入口摘要不匹配；
- 不受支持的 Extension Spec；
- 符号链接、特殊文件、路径逃逸和超限包。

### 4.1 打包依赖与资源限制

打包使用 `tar@7.5.22` 创建和读取 gzip tarball。该包采用 BlueOak-1.0.0 许可证；当前锁文件中的传递依赖为 `@isaacs/fs-minipass@4.0.1`（ISC）、`chownr@3.0.0`（BlueOak-1.0.0）、`minipass@7.1.3`（BlueOak-1.0.0）、`minizlib@3.1.0`（MIT）和 `yallist@5.0.0`（BlueOak-1.0.0）。实现不调用系统 `tar`。

首版资源限制为：

- 最多 1024 个扩展载荷文件；
- 单个普通文件最大 2 MiB；
- 扩展载荷总大小最大 16 MiB；
- npm 运输 envelope 最大 64 KiB。

当前最大的普通内置扩展是 `monitor@1.1.0`，约 204 KiB、13 个文件，最大单文件约 78 KiB；上述限制为其保留约 75 倍总大小余量。打包只归档普通文件，目录仅用于遍历；符号链接、硬链接、设备、socket、FIFO、路径逃逸、重复路径和超限内容都会被拒绝。

### 4.2 系统扩展发布策略

`extensions/.system/` 中的系统扩展由 Host 版本和 `init` 流程管理，不进入 Nexus 扩展包的自动发布集合。这个排除是发布策略，不是打包协议分支；如果未来策略允许发布系统扩展，仍使用相同的 `extension pack`、npm envelope 和 `package/extension/` 布局。

## 5. 权限模型

建议建立三个 Nexus 角色：

| 角色 | 用途 | 权限 |
|---|---|---|
| `codew-extension-reader` | 开发者和 Code Workspace | `browse`、`read`、搜索 |
| `codew-extension-publisher` | 受控 CI 服务账号 | `browse`、`read`、`add`，仅在实际发布流程需要时增加 `edit` |
| `codew-extension-admin` | 制品库管理员 | 仓库配置、删除和事故处置 |

Reader 至少需要针对 `codew-extensions` 的 npm repository view `browse/read` 和 `nx-search-read`。Publisher 不授予 `delete`；仓库继续使用 `Disable redeploy`，禁止同名同版本覆盖。

权限设计应在公司 Nexus 实例中以最小权限 smoke test 验证。Nexus privilege action 及角色说明见：

- [Privileges](https://help.sonatype.com/en/privileges.html)
- [Access Control](https://help.sonatype.com/en/access-control.html)
- [Search API](https://help.sonatype.com/en/search-api.html)

## 6. 认证与凭证

自建 Nexus 应启用 npm Bearer Token Realm。用户可以使用 npm CLI 对专用 repository 登录：

```bash
npm login \
  --auth-type=legacy \
  --registry=https://nexus.example.com/repository/codew-extensions/
```

Code Workspace 复用用户级 npm 配置中与该 Registry URL 精确匹配的凭证；不得读取目标 Workspace 内的 `.npmrc` 作为可信凭证来源。CI 使用独立服务账号或 Nexus 提供的服务账号 Token。

凭证不得写入：

- `.codew/`；
- Workspace extension state；
- Extension Store registry；
- CLI JSON result、诊断或日志；
- npm 扩展包和 manifest。

认证失败只报告 Registry 身份、HTTP 状态和可执行的登录修复建议。详细配置见 [Nexus npm Security](https://help.sonatype.com/en/npm-security.html)。

## 7. 发布流程

正式版本在发布前完成审批；不要把 Nexus dist-tag 当成唯一审批门禁。

```text
1. 检出扩展源码
2. 校验 Extension Spec、manifest 和入口摘要
3. 生成 npm 运输 envelope
4. 生成 tarball 并检查文件清单
5. 使用 Reader 等价路径做解包和 package digest 验证
6. 人工或 CI 环境审批
7. npm publish 到 codew-extensions
8. 从 Nexus 重新下载并执行 smoke verification
```

示例：

```bash
codew extension pack extensions/zhuiyi-jira-mcp/1.1.0 \
  --output dist/extensions

npm publish dist/extensions/codew-ext-zhuiyi-jira-mcp-1.1.0.tgz \
  --registry=https://nexus.example.com/repository/codew-extensions/
```

`extension pack` 不读取或写入 Workspace 配置，不执行扩展入口，不运行 `npm pack`、`npm install` 或任何生命周期脚本，也不持有 Nexus 凭证。输出目录缺失时会递归创建。它会在输出目录的同目录临时文件中生成 tarball，重新读取并验证 envelope、manifest、入口摘要和 `package/extension/` 的 package digest，然后原子提交 `codew-ext-<extension-id>-<version>.tgz`。目标文件已存在时拒绝覆盖。

仓库 CI 使用 `npm run pack:extensions` 对全部普通内置扩展执行同一 smoke test，并检查每个 tarball 的文件清单。该 job 只产出制品，不自动执行 `npm publish`。

正式发布使用普通 SemVer；测试版本使用 prerelease：

```text
1.2.0-alpha.1
1.2.0-beta.1
1.2.0-rc.1
```

Code Workspace 默认只解析最高的、非 deprecated 的兼容正式版本。预发布版本必须显式请求。

## 8. 发现与安装

发现使用 Nexus REST Search API，并固定：

- repository 为 `codew-extensions`；
- format 为 `npm`；
- scope 为 `@codew-ext`；
- 分页使用 continuation token；
- 搜索结果再通过 npm metadata 和 Extension envelope 筛选。

安装流程：

```text
读取 Nexus/npm package metadata
→ 过滤 prerelease、deprecated 和不兼容版本
→ 固定精确 SemVer、tarball URL 和 integrity
→ 下载到临时文件
→ 校验 npm integrity
→ 安全解包并验证 npm envelope
→ 验证 Extension manifest、入口和 package digest
→ 原子导入 User Extension Store
→ 执行现有 Workspace activation 事务
```

远端搜索和下载失败不得破坏已有本地 Store 或 Workspace activation。已在 Store 中且摘要匹配的精确版本可以离线复用。

## 9. 废弃、事故和删除

Nexus 支持 `npm deprecate`，但不支持 npm `unpublish`。普通缺陷版本应标记 deprecated；Code Workspace 默认版本解析排除 deprecated 版本，精确安装时必须给出明确警告或拒绝。

```bash
npm deprecate \
  --registry=https://nexus.example.com/repository/codew-extensions/ \
  @codew-ext/example@1.2.0 \
  "存在缺陷，请升级到 1.2.1"
```

严重安全事件由 Nexus 管理员删除远端组件并发布安全公告。删除远端包不能停止已经进入用户本地 Store 的代码；跨客户端强制吊销需要未来独立的签名策略或 revocation feed，不属于第一版。

官方说明：[Deprecating npm Packages](https://help.sonatype.com/en/deprecating-npm-packages.html)。

## 10. 保留、备份与监控

- 正式扩展版本不自动清理，确保新设备和旧 Workspace 能恢复精确版本。
- 只对 prerelease 应用按年龄或使用情况的 cleanup policy。
- Nexus blob store 与数据库按公司灾备标准共同备份。
- 监控认证失败、发布失败、重复版本发布、下载错误率、存储容量和 cleanup task。
- 定期使用 Reader 凭证执行搜索、metadata、tarball 下载和完整验证 smoke test。

Nexus cleanup policy 说明见 [Cleanup Policies](https://help.sonatype.com/en/cleanup-policies.html)。

## 11. 上线验收清单

- [ ] `codew-extensions` 是独立 `npm (hosted)` repository。
- [ ] Deployment policy 为 `Disable redeploy`。
- [ ] Code Workspace 不经由包含公网 proxy 的 npm group 下载扩展。
- [ ] npm Bearer Token Realm 或公司批准的 Token 方案可用。
- [ ] Reader、Publisher、Admin 权限已用独立账号验证。
- [ ] Publisher 没有 delete 权限，普通开发者没有 add/edit/delete 权限。
- [ ] `@codew-ext/*` 包只能由受控 CI 发布。
- [ ] 正式版本不适用自动 cleanup。
- [ ] 下载后执行 npm integrity 与 Extension package digest 双重验证。
- [ ] Nexus 及 CLI 日志不包含凭证。
- [ ] 已验证搜索、安装、离线缓存、deprecated 和重复发布失败场景。

## 12. 项目改造顺序

项目改造拆成三个 OpenSpec change，必须按以下顺序执行：

1. `phase-06-package-extensions-for-nexus`：建立 npm 分发包装合同和可复用打包校验能力。
2. `phase-07-add-nexus-extension-provider`：实现 Nexus/npm 元数据、认证、下载、完整性校验和 Store 导入 Provider。
3. `phase-08-enable-registry-extension-lifecycle`：增加发现、详情、远端安装、精确版本和升级 CLI，并接入现有 Workspace 事务。

后续 change 不得复制前序实现；必须依赖前序已经固化的包合同和 Provider 公共接口。
