## Context

phase-06 固定了 Nexus/npm tarball 的运输布局。当前 `extension-store.js` 只接受本地目录并以 `source: "builtin"` 记录来源；`extensions.js` 直接扫描随包目录。远端 Provider 必须在任何扩展代码执行之前完成网络、认证、归档和身份验证，并将结果转换为现有 Store 能理解的不可变目录。

本 Change 只建设 core Provider，不增加用户命令或 Workspace 写入。这样网络错误、凭证错误和恶意归档可以在独立层测试，后续 CLI 只消费冻结的 Provider 结果。

## Goals / Non-Goals

**Goals:**

- 从公司 Nexus npm hosted repository 查询扩展 metadata 与搜索结果。
- 复用用户级 npm 凭证而不把秘密写入 Workspace 或 Store。
- 安全下载、校验和解包 phase-06 tarball。
- 将验证后的真实扩展目录原子导入现有 Store，并记录非敏感来源证明。
- 保持内置 Provider 和离线 Store 解析能力。

**Non-Goals:**

- 不新增 CLI、交互选择或 Workspace activation。
- 不上传、发布、删除或修改 Nexus 制品和 dist-tag。
- 不支持任意 npm Registry、多 Registry 聚合或公网 fallback。
- 不提供包签名、恶意代码扫描或远程强制吊销。

## Decisions

### D1: Provider 只返回冻结包候选

引入通用 Package Provider 边界，Nexus 实现负责：

```text
search → metadata → exact version candidate → download → verify → unpack
```

候选包含 Extension ID、精确版本、Extension Spec、manifest/entry/package digest、临时 source root 和非敏感 provenance。Provider 不生成 Workspace artifacts，也不执行 `init.js`。Store 导入仍由 `extension-store` 公共 API 负责。

内置 Provider 适配现有发现目录。相同 `id@version` 的 candidate digest 不同视为供应链冲突，而不是按 Provider 优先级选择。

### D2: Registry 身份来自固定 scope 的用户级 npm 配置

首版固定 scope `@codew-ext`。Registry URL 优先从进程显式注入读取，否则从用户级 npm 配置中读取 `@codew-ext:registry`。仅加载用户级配置，不加载当前目录或祖先目录中的项目 `.npmrc`，避免不受信任 Workspace 改写 Registry 或凭证。

Registry URL 必须是 HTTPS Nexus repository endpoint，形如 `/repository/<name>/`；测试只允许显式注入的 loopback HTTP。Provider 从 URL 推导 Nexus origin 与 repository name，用于 Search API 和 packument 请求。

认证解析遵循 npm 的 URL scope，只向完全匹配的 Registry origin/path 附加 bearer/basic 凭证。实现优先采用维护中的 npm 配置与 fetch 库，而不是自写完整 `.npmrc` 语法。环境变量插值在内存中完成，结果不得进入错误 details。

### D3: 元数据只用于解析，tarball 才能建立可信包事实

Provider 使用 npm packument 获取 versions、deprecated 和 `dist.tarball`/`dist.integrity`。运输 envelope 可用于下载前过滤，但所有字段在解包后都必须与 `extension/manifest.json` 重新比对。

首版要求 SHA-512 SRI integrity。仅有 SHA-1 shasum 的版本被视为不可安全消费。Provider 不依赖可变 `latest` tag决定精确版本；版本选择留给 phase-08。

### D4: 网络访问采用固定边界和限额

所有请求设置连接/总超时、响应头和响应体大小上限。metadata、Search API 和 tarball URL 必须属于配置的 Nexus origin 与 repository；重定向逐跳验证，凭证绝不跨 origin 转发。下载流在写入临时文件时增量验证 SRI，不将完整包读入内存。

Provider 使用稳定错误区分未认证、无权限、不存在、限流、超时、响应超限、metadata 无效和 integrity 不匹配，并提供登录或联系管理员的修复建议。

### D5: 解包先验证运输层，再验证 Extension 层

安全解包器只接受 `package/package.json` 和 `package/extension/` 下的普通文件/目录，拒绝绝对路径、`..`、反斜杠、重复路径、大小写冲突、符号链接、硬链接和特殊文件，并限制文件数、单文件大小与总展开大小。

解包完成后按 phase-06 校验 envelope，再调用现有 manifest/schema/entry/directory digest 校验。任何失败只清理临时目录，不更新 Store registry。

### D6: Store provenance 版本化但不保存秘密

Store registry 升级为兼容读取的下一 schema，package record 增加结构化 provenance：

```json
{
  "kind": "nexus-npm",
  "registryOrigin": "https://nexus.example.com",
  "repository": "codew-extensions",
  "packageName": "@codew-ext/example",
  "archiveIntegrity": "sha512-..."
}
```

不保存 tarball query、Authorization、用户名、token 或 `.npmrc` 路径。旧 `source: "builtin"` 记录读取时投影为 builtin provenance；只有实际写入发生时才迁移 registry。

Store 最终目录仍为 `<store>/<id>/<version>`。已存在同版本时重新验证目录和 registry；digest 一致则复用并可补全 provenance，digest 不一致则稳定失败。

### D7: Nexus Search 是可分页的 core 能力

Provider 使用 `/service/rest/v1/search`，固定 repository/format 并使用 continuation token。结果只产生候选 package identity；详细版本仍从 npm packument读取。Search 的 HTTP 与 Nexus 版本差异封装在 Provider 中，不泄漏到 CLI。

## Risks / Trade-offs

- [公司 Nexus 版本返回的 npm metadata 有差异] → 对实际实例做 packument/Search 契约 fixture，未知字段容忍、必需安全字段缺失时失败。
- [读取用户 npm 配置导致秘密泄漏] → 使用专门 credential adapter、details 脱敏测试和禁止 Workspace `.npmrc`。
- [压缩炸弹或路径攻击] → 流式限额、逐条路径验证和不支持链接类型。
- [Store schema 迁移破坏已有引用] → 兼容读取旧 schema、延迟迁移、引用字段原样保留并增加回归测试。
- [Nexus 暂时不可用] → Provider 不修改现有 Store；精确已缓存包由 Store resolver 独立使用。

## Migration Plan

1. 定义 Provider 接口、Nexus 配置和 credential adapter。
2. 实现 packument/Search 客户端及稳定网络错误。
3. 实现流式下载、SRI 校验和安全解包。
4. 扩展 Store provenance schema并验证旧 registry 兼容。
5. 使用本地 HTTP/Nexus fixture 完成认证、重定向、超时、超限和恶意归档测试。
6. 回滚时停用 Nexus Provider；已导入 Store 包仍是合法不可变包，可供精确 activation/runtime 使用。

## Open Questions

- 实施前需要记录公司 Nexus 版本与 Community/Pro edition，冻结 Search API fixture。
- 需要确认公司用户级 npm 登录输出使用 bearer token 还是 basic/user token，以选择最小 credential adapter 测试矩阵。
