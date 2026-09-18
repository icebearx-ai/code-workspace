## 1. Provider 与配置边界

- [x] 1.1 确认 `phase-06-package-extensions-for-nexus` 已完成，并以其 envelope/schema 和安全归档读取器为唯一运输合同
- [x] 1.2 定义 Package Provider、远端 package candidate、search page 和非敏感 provenance 公共类型
- [x] 1.3 实现固定 `@codew-ext` scope 的显式/用户级 npm Registry 配置解析，禁止项目与 Workspace `.npmrc`
- [x] 1.4 选择并集成维护中的 npm config/fetch/integrity 依赖，完成许可证与秘密处理审查
- [x] 1.5 实现 Registry URL、Nexus origin、repository path 和测试 loopback 例外校验

## 2. 认证、元数据与搜索

- [x] 2.1 实现按精确 Registry URL 作用域解析 bearer/basic 凭证的 credential adapter
- [x] 2.2 实现 npm packument 获取、schema 限制、package/version/envelope 和 SHA-512 integrity 校验
- [x] 2.3 实现 Nexus Search API repository/format/scope 过滤、continuation 分页、去重和响应转换
- [x] 2.4 实现 Registry 健康检查，分别报告配置、认证、metadata 和 Search 能力
- [x] 2.5 为 401、403、404、429、超时、响应超限和不兼容响应定义稳定错误与脱敏 remediation

## 3. 安全下载与解包

- [x] 3.1 实现带连接/总超时和响应体上限的流式 tarball 下载及增量 SRI 校验
- [x] 3.2 实现逐跳同 Registry 重定向验证，并证明 Authorization 不会跨 origin/path 转发
- [x] 3.3 复用 phase-06 安全读取器解包固定包装，拒绝路径逃逸、链接、特殊文件、重复/大小写冲突和资源超限
- [x] 3.4 重新验证 npm envelope、Extension manifest、entry/runtime 摘要和完整 packageSha256
- [x] 3.5 确保所有网络、integrity 和解包失败都清理临时路径且不更新 Store

## 4. Store provenance 与 Provider 集成

- [x] 4.1 为 Store registry 增加兼容旧 schema 的结构化 builtin/Nexus provenance 模型和延迟迁移
- [x] 4.2 通过现有 package lock、临时目录和原子提交导入 Nexus candidate
- [x] 4.3 实现同 `id@version` 同 digest 复用和不同 digest 稳定冲突，不按 Provider 优先级覆盖
- [x] 4.4 验证 Store registry 永不保存 token、Authorization、`.npmrc` 路径或敏感 tarball query
- [x] 4.5 让 runtime 与 activation resolver 继续只依赖 Store 精确 version/digest，不直接访问 Nexus

## 5. 测试、文档与验收

- [x] 5.1 建立本地 Nexus/npm HTTP fixture，覆盖 packument、Search 分页、认证、重定向、流式下载和限流
- [x] 5.2 覆盖恶意 tar、integrity 错误、运输/manifest 身份替换、未知规范和同版本摘要冲突
- [x] 5.3 覆盖 Store 旧 registry 读取/迁移、引用保留、并发导入、失败清理和 GC 兼容
- [x] 5.4 用公司 Nexus 版本记录一组脱敏契约响应，验证 Community/Pro 与实际认证方式
- [x] 5.5 更新 Nexus 文档中的登录、权限、URL、失败修复和 smoke test，并运行完整测试与项目 check
