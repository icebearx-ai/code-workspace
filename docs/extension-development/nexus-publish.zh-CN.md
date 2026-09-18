# Nexus npm 扩展包上传与验证指南

本文面向需要把 Code Workspace 扩展发布到公司 Nexus 的开发者，覆盖从登录、打包、上传到远端验证的完整流程。

本文只描述 **普通扩展** 的发布。系统扩展是否发布由发布策略决定，不要默认上传 `extensions/.system/` 下的包。

## 1. 前置条件

- 你有 `codew-extensions` 仓库的发布权限；
- 你使用的是专用 hosted repository，而不是包含公网 proxy 的 npm group；
- 本机 Node.js 版本满足项目要求；
- 扩展已通过本地开发和安装测试；
- 你准备发布一个从未发布过的新版本。

公司 Nexus 地址：

```text
https://pkg.in.wezhuiyi.com/repository/codew-extensions/
```

如你的环境使用不同 Nexus 实例，请把后文中的地址替换为实际 hosted repository URL。

## 2. 配置 npm 并登录

建议先把 Registry 地址保存为变量：

```bash
export NEXUS=https://pkg.in.wezhuiyi.com/repository/codew-extensions/
```

把固定 scope 指向该 Registry：

```bash
npm config set @codew-ext:registry "$NEXUS"
```

登录：

```bash
npm login \
  --auth-type=legacy \
  --registry="$NEXUS"
```

确认登录状态：

```bash
npm whoami --registry="$NEXUS"
```

预期输出你的 Nexus 用户名。

公司 Nexus 当前使用 bearer token 认证。`npm login` 会在用户级 `~/.npmrc` 中写入类似下面的键：

```text
//pkg.in.wezhuiyi.com/repository/codew-extensions/:_authToken=<token>
```

不要把该 token 提交到仓库、写入项目 `.npmrc`、打印到日志，或粘贴到文档中。

## 3. 打包扩展

在仓库根目录执行：

```bash
codew extension pack extensions/<extension-id>/<version> --output dist/extensions --json
```

示例：

```bash
codew extension pack extensions/monitor/1.1.0 --output dist/extensions --json
```

成功时会生成：

```text
dist/extensions/codew-ext-<extension-id>-<version>.tgz
```

例如：

```text
dist/extensions/codew-ext-monitor-1.1.0.tgz
```

请保留 JSON 输出中的以下字段，后面会用它们核对远端结果：

- `npmName`
- `version`
- `tarball.integrity`
- `manifestSha256`
- `entrySha256`
- `packageSha256`
- `tarball.files`

如果想把结果保存成文件：

```bash
node bin/code-workspace.js extension pack extensions/monitor/1.1.0 --output dist/extensions --json > dist/extensions/pack-result.json
```

## 4. 上传到 Nexus

使用标准 `npm publish` 上传 tarball：

```bash
npm publish \
  dist/extensions/codew-ext-monitor-1.1.0.tgz \
  --registry="$NEXUS"
```

要点：

- 只发布 `extension pack` 生成的 `.tgz`；
- 不要在扩展目录中手工添加运输用 `package.json`;
- 不要发布已有版本；
- 如果 Nexus 提示版本已存在，说明该版本已经发布过，应该提升版本号，不要尝试覆盖；
- CI 中应使用专用服务账号，不应把个人 token 写入仓库或日志。

`extension pack` 生成的包不包含 lifecycle scripts，也不会声明 dependencies。`npm publish` 上传的是已经验证过的 tarball，不会触发扩展代码执行。

## 5. 验证远端元数据

先确认版本已经可见：

```bash
npm view @codew-ext/monitor versions --registry="$NEXUS"
```

再查看精确版本的 tarball 和 integrity：

```bash
npm view @codew-ext/monitor@1.1.0 \
  dist.tarball \
  dist.integrity \
  --registry="$NEXUS"
```

预期结果：

- `dist.tarball` 指向同一个 Nexus hosted repository；
- `dist.integrity` 是 `sha512-...`;
- 该值应与本地 `extension pack` 输出的 `tarball.integrity` 一致。

如果本地结果保存在 `dist/extensions/pack-result.json`，可以读取它：

```bash
node -e "console.log(require('./dist/extensions/pack-result.json').tarball.integrity)"
```

## 6. 下载并核对远端 tarball

创建临时目录并下载远端包：

```bash
mkdir -p /tmp/codew-nexus-verify

npm pack \
  @codew-ext/monitor@1.1.0 \
  --registry="$NEXUS" \
  --pack-destination /tmp/codew-nexus-verify
```

计算下载文件的 SHA-512 SRI：

```bash
node -e "const c=require('node:crypto'),f=require('node:fs');console.log('sha512-'+c.createHash('sha512').update(f.readFileSync(process.argv[1])).digest('base64'))" \
  /tmp/codew-nexus-verify/codew-ext-monitor-1.1.0.tgz
```

该输出必须与远端 `dist.integrity` 和本地 `tarball.integrity` 完全一致。

检查文件清单：

```bash
tar -tzf /tmp/codew-nexus-verify/codew-ext-monitor-1.1.0.tgz | sort
```

预期规则：

- 必须包含 `package/package.json`;
- 其余文件必须全部位于 `package/extension/` 下；
- 不应出现 `package/extension/` 之外的额外包装文件；
- 不应出现符号链接、硬链接或特殊文件。

## 7. 用 Provider 做端到端验证

如果你在 Code Workspace 仓库内，可以直接使用 Nexus Provider 做一次下载、校验和导入测试。

在仓库根目录执行：

```bash
node - <<'NODE'
const {
  createNexusExtensionPackageProvider,
} = require("./src/core/nexus-extension-provider");

const registry = "https://pkg.in.wezhuiyi.com/repository/codew-extensions/";

(async () => {
  const provider = await createNexusExtensionPackageProvider({
    registryUrl: registry,
  });

  const health = await provider.health({
    healthPackageName: "@codew-ext/monitor",
  });
  console.log("HEALTH");
  console.log(JSON.stringify(health, null, 2));

  const candidate = await provider.getPackageCandidate(
    "monitor",
    "1.1.0"
  );
  console.log("CANDIDATE");
  console.log(JSON.stringify(candidate, null, 2));

  const imported = await provider.import("monitor", "1.1.0", {
    storeRoot: "/tmp/codew-nexus-store",
  });
  console.log("IMPORTED");
  console.log(JSON.stringify(imported, null, 2));

  const search = await provider.search();
  console.log("SEARCH");
  console.log(JSON.stringify(search, null, 2));
})().catch((error) => {
  console.error(error.code, error.message, error.details);
  process.exit(1);
});
NODE
```

预期结果：

- `HEALTH.ok` 为 `true`;
- `authentication.authenticated` 为 `true`;
- `CANDIDATE.packageSha256` 与本地 `extension pack` 输出一致；
- `IMPORTED.provenance.kind` 为 `"nexus-npm"`;
- `SEARCH.items` 中能看到 `@codew-ext/monitor`;
- Store 中没有凭证或敏感 URL。

检查 Store registry 是否泄漏敏感信息：

```bash
grep -E "token|Authorization|npmrc" \
  /tmp/codew-nexus-store/.registry.json
```

该命令应没有任何输出。

## 8. 清理

测试完成后，可以删除临时目录：

```bash
rm -rf /tmp/codew-nexus-verify /tmp/codew-nexus-store
```

如果你发布的是临时测试版本，建议标记为 deprecated：

```bash
npm deprecate \
  @codew-ext/monitor@1.1.0 \
  "temporary smoke test" \
  --registry="$NEXUS"
```

Nexus 不支持 `unpublish`。错误版本应使用 `deprecate` 标记，而不是尝试删除。

## 9. 常见问题

### 401 未认证

检查：

```bash
npm whoami --registry="$NEXUS"
```

如果失败，重新执行 `npm login`。

### 403 无权限

说明当前账号没有发布权限。需要联系 Nexus 管理员，把账号加入 `codew-extension-publisher` 角色。

### 404 版本不存在

先检查：

```bash
npm view @codew-ext/monitor versions --registry="$NEXUS"
```

如果没有目标版本，说明上传没有成功，或包名、版本写错。

### 版本已存在

Nexus 通常启用 `Disable redeploy`。同名同版本不能重复上传。需要提升版本号，重新打包并上传。

### integrity 不一致

说明远端 tarball 与本地生成结果不同。不要继续使用该包。应：

1. 重新执行扩展打包命令；
2. 核对本地 `tarball.integrity`;
3. 检查远端 `dist.integrity`;
4. 如仍不一致，停止发布并排查 Nexus 或上传流程。

## 10. 发布检查清单

- [ ] 使用专用 Nexus hosted repository；
- [ ] `npm whoami` 能返回用户名；
- [ ] 扩展打包成功；
- [ ] tarball 文件清单符合 `package/extension/` 布局；
- [ ] 本地 `tarball.integrity` 与远端 `dist.integrity` 一致；
- [ ] Provider 端到端验证通过；
- [ ] Store provenance 为 `nexus-npm`;
- [ ] Store registry 中没有 token、Authorization 或 `.npmrc` 路径；
- [ ] 发布后版本不可覆盖；
- [ ] 如为测试版本，已标记 deprecated。
