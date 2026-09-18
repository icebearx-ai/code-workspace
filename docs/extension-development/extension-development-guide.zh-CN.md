# Code Workspace 扩展开发指南

本文面向要为 Code Workspace 编写扩展的开发者，覆盖扩展设计、目录结构、manifest、初始化协议、验证和 npm/Nexus 打包。

本文是开发指南，不是第二份规范。一致性要求以以下文件为准：

- `spec/extension/v1/specification.zh-CN.md`
- `schemas/extension-manifest-v3.json`
- `schemas/extension-init-context-v1.json`
- `schemas/extension-init-result-v1.json`
- `schemas/extension-npm-transport-envelope-v1.json`

## 1. 判断扩展边界

一个合理的扩展只解决一组内聚问题，例如安装一个 Skill、生成某个内部服务的 Agent 配置、声明一个 Workspace Hook，或提供一个与初始化分离的 runtime。不要把互不相关的输出放进同一个扩展。

Code Workspace 的边界是：

```text
扩展负责在 staging 中准备内容；
Host 负责确认、校验、事务提交、状态记录、升级和卸载。
```

设计原则：

- 只声明真正需要的输出；
- 优先管理具体文件，不要独占过大目录；
- 共享配置使用 `text-block` 或 `json-member`；
- 只声明实际访问的 HTTPS host；
- 不保存 Token、Cookie、密码或其他凭证；
- 不引入 npm 依赖或 lifecycle scripts；
- 同一个 context 应可重复生成同一组候选输出。

扩展进程不是安全沙箱。当前规范面向可信发布方，不要把不可信第三方代码作为扩展发布。

## 2. 包目录

内置扩展使用固定版本目录：

```text
extensions/<extension-id>/<version>/
├── manifest.json
├── init.js
└── assets/
    └── SKILL.md
```

外部扩展仓库可以使用任意仓库根目录，但交给 `extension pack` 的 `<source>` 必须直接指向包含 `manifest.json` 和 `init.js` 的版本目录。

命名要求：

- `extension-id` 必须匹配 `^[a-z0-9]+(?:-[a-z0-9]+)*$`；
- `version` 必须是完整 SemVer，例如 `1.0.0`；
- 已发布版本目录不可修改；新实现创建新的版本目录。

不要在扩展目录中添加运输用 `package.json`。npm 包装由 `extension pack` 生成；真实扩展目录的 `packageSha256` 是 Extension 身份的一部分。

## 3. manifest

Spec v1 使用 manifest schema v3。最小示例：

```json
{
  "schemaVersion": 3,
  "extensionSpecVersion": 1,
  "experimental": true,
  "id": "example-extension",
  "name": "Example Extension",
  "description": "Install an example Agent skill",
  "version": "1.0.0",
  "entry": "init.js",
  "entrySha256": "<init.js sha256>",
  "timeoutMs": 30000,
  "outputs": [
    {
      "id": "codex-skill",
      "kind": "file",
      "ownership": "exclusive",
      "target": ".codex/skills/example-extension/SKILL.md",
      "tools": ["codex"]
    }
  ]
}
```

计算入口摘要：

```bash
node -e "process.stdout.write(require('node:crypto').createHash('sha256').update(require('node:fs').readFileSync('extensions/example-extension/1.0.0/init.js')).digest('hex'))"
```

每次修改 `init.js` 后都必须更新 `entrySha256`。其他文件不需要手工写摘要；Host 和打包器会计算完整目录摘要。

### 3.1 身份与展示

- `schemaVersion` 必须是 `3`；
- `extensionSpecVersion` 当前必须是 `1`；
- `experimental` 必须是 `true`；
- `id` 和版本必须与目录身份一致；
- `name` 最长 100 个 Unicode 字符；
- `description` 必须是单行非空文本，最长 60 个 Unicode 字符；
- manifest 拒绝未知字段。

### 3.2 输出类型

| kind | ownership | 适用场景 |
|---|---|---|
| `file` | `exclusive` | Host 独占管理的一个普通文件 |
| `file` | `seeded` | 首次缺失时写入，之后不覆盖用户修改 |
| `directory` | `exclusive` | Host 独占替换和删除的完整目录 |
| `text-block` | `shared` | 向文本文件插入由 Host 管理的片段 |
| `json-member` | `shared` | 用 JSON Pointer 管理 JSON 的一个成员 |

规则：

- `target` 是相对 Workspace 的 POSIX 风格安全路径；
- 禁止绝对路径、反斜杠、`..`、`.`、空路径和重复分隔符；
- 不得指向 Code Workspace 核心管理路径；
- `json-member` 必须声明 `selector`；
- `text-block` 必须声明 `format: "text"` 或 `"toml"`；
- `tools` 可限制输出只适用于 `codex` 或 `claude`；
- 独占目标之间不得重叠。

建议：

- Skill、模板和静态文档使用 `file`；
- 用户可能修改的默认配置使用 `seeded`；
- `.gitignore` 和 TOML 片段使用 `text-block`；
- `.mcp.json` 的某个 server 使用 `json-member`；
- 只有整个目录都属于扩展时才使用 `directory`。

### 3.3 网络、Hook 与 runtime

如需访问 HTTPS host，在 `capabilities.networkHosts` 中声明小写 hostname，不包含协议、路径、端口或通配符。

Hook 使用抽象事件，例如 `task.started` 和 `write.before`。不要把 Provider 原生事件名或任意原生配置片段写入 manifest。Hook 的渲染、移除和漂移检查由 Host 管理。

`runtime` 是高级能力。只有确实需要与初始化分离的一次性命令或长驻服务时才声明，并必须提供 runtime entry 摘要、scope、mode、超时和 required 字段。初学者应先实现 outputs-only 扩展。

## 4. init.js

Host 以子进程运行：

```text
node init.js --context <context.json> --output <staging-directory> --result <result.json>
```

`init.js` 必须：

1. 读取并校验 context；
2. 只在 staging 目录生成候选输出；
3. 按当前工具选择返回恰好适用的 output id；
4. 写出符合 schema 的 result；
5. 在超时内退出。

最小实现：

```js
#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");

const ID = "example-extension";
const VERSION = "1.0.0";

function option(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

function main() {
  const contextFile = option("--context");
  const outputRoot = option("--output");
  const resultFile = option("--result");
  if (!contextFile || !outputRoot || !resultFile) {
    throw new Error("Usage: init.js --context <file> --output <directory> --result <file>");
  }

  const context = JSON.parse(fs.readFileSync(contextFile, "utf8"));
  if (
    context.schemaVersion !== 1 ||
    context.extensionSpecVersion !== 1 ||
    context.extension?.id !== ID ||
    context.extension.version !== VERSION ||
    !Array.isArray(context.tools)
  ) {
    throw new Error("Invalid extension context");
  }

  const outputs = [];
  if (context.tools.includes("codex")) {
    fs.mkdirSync(path.join(outputRoot, "skill"), { recursive: true });
    fs.copyFileSync(
      path.join(__dirname, "assets", "SKILL.md"),
      path.join(outputRoot, "skill", "SKILL.md")
    );
    outputs.push({ id: "codex-skill", source: "skill/SKILL.md" });
  }

  fs.writeFileSync(resultFile, `${JSON.stringify({
    schemaVersion: 1,
    extensionSpecVersion: 1,
    extension: { id: ID, version: VERSION },
    outputs,
  }, null, 2)}\n`);
}

try {
  main();
} catch (error) {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
}
```

### 4.1 result 语义

result 只包含身份和 `{ id, source }` 列表：

```json
{
  "schemaVersion": 1,
  "extensionSpecVersion": 1,
  "extension": { "id": "example-extension", "version": "1.0.0" },
  "outputs": [{ "id": "codex-skill", "source": "skill/SKILL.md" }]
}
```

`source` 是 staging 内的相对路径，不是 Workspace 目标路径。目标、类型、所有权、selector 和摘要都由 manifest 和 Host 决定。

Host 拒绝：

- 缺失、额外、重复或未知 output id；
- `source` 路径逃逸；
- 符号链接、设备、socket、FIFO 和特殊文件；
- staging 内容与 result 不一致；
- 扩展身份或 Extension Spec 不一致。

### 4.2 实现禁忌

- 不直接读写真实 Workspace；
- 不从 context 之外的路径猜测 Workspace root；
- 不把凭证写入日志、result、manifest 或候选文件；
- 不执行 `npm install`、`npm pack` 或 lifecycle scripts；
- 不依赖扩展目录外的全局文件；
- 不吞掉错误并返回成功。

## 5. 本地验证与安装测试

在临时 Workspace 安装内置扩展：

```bash
codew init /tmp/example-workspace --tools codex --extensions example-extension --yes
```

重复安装：

```bash
codew extension install example-extension --yes
```

卸载：

```bash
codew extension uninstall example-extension --yes
```

至少测试：

- Codex 和 Claude 分别选择时的输出集合；
- 重复安装；
- 升级；
- 卸载；
- 用户修改 seeded 文件后的再次安装；
- 共享输出与其他扩展共存；
- 初始化失败后 Workspace 无残留。

外部扩展的远端发现和安装属于后续 phase；当前外部扩展先用 pack 校验和受控测试流程。

## 6. npm/Nexus 打包

打包单个版本目录：

```bash
code-workspace extension pack extensions/example-extension/1.0.0 --output dist/extensions --json
```

输出目录缺失时会递归创建。目标文件已存在时命令拒绝覆盖；重复打包前使用新的输出目录，或清理上一次构建产物。

内置扩展可以一次打包并校验全部普通版本：

```bash
npm run pack:extensions
```

tarball 布局固定：

```text
package/
├── package.json
└── extension/
    ├── manifest.json
    ├── init.js
    └── ...
```

npm 身份固定映射为：

```text
@codew-ext/<extension-id>@<extension-version>
```

`package/package.json` 是运输 envelope，只用于 npm/Nexus 分发和发现提示；执行合同始终是 `package/extension/manifest.json`。`packageSha256` 只计算 `extension/`，运输 envelope 不进入该摘要。

打包器会：

- 校验 manifest、入口摘要、目录类型和 Extension Spec；
- 生成不含 dependencies、bundled dependencies 和 scripts 的 envelope；
- 只归档普通文件；
- 拒绝符号链接、硬链接、特殊文件、路径逃逸和重复路径；
- 限制最多 1024 个文件、单文件 2 MiB、载荷总计 16 MiB、envelope 64 KiB；
- 重新读取 tarball 并验证 envelope、manifest、入口和 package digest；
- 使用同目录临时文件并原子提交输出。

成功 JSON 返回 npm name、扩展身份、tarball 绝对路径、tarball integrity、manifest/entry/package digest 和文件清单。

## 7. 发布边界

`extension pack` 不发布、不登录 Nexus、不保存 Registry 凭证。受控 CI 可以对已验证 tarball 执行：

```bash
npm publish dist/extensions/codew-ext-example-extension-1.0.0.tgz --registry=https://nexus.example.com/repository/codew-extensions/
```

发布前确认：

- tarball 由当前源目录重新生成并通过 pack 校验；
- 版本从未发布过；
- npm name/version 与 manifest 一致；
- 文件清单只包含预期内容；
- 没有凭证或本地路径泄漏；
- 系统扩展没有进入普通扩展自动发布集合；
- CI 使用专用服务账号，普通开发者没有 publish 权限。

发布后仍以下载端重新校验为准：npm integrity、运输 envelope、Extension manifest、入口摘要和 `extension/` package digest 都必须重新验证。

完整的 Nexus 登录、上传、远端验证和 Provider 冒烟测试步骤见 `nexus-publish.zh-CN.md`。

## 8. 开发检查清单

- [ ] 目录名、manifest id 和版本一致；
- [ ] manifest 符合 schema v3；
- [ ] `init.js` 摘要与 `entrySha256` 一致；
- [ ] 没有未知 manifest 字段；
- [ ] 输出目标最小且不与核心或其他扩展冲突；
- [ ] `tools` 过滤和 result 输出一致；
- [ ] staging 内容普通、安全且与 result 完全一致；
- [ ] 无凭证、无 npm 依赖、无 lifecycle scripts；
- [ ] 安装、重复安装、升级和卸载测试通过；
- [ ] `extension pack` 成功并返回预期 digest；
- [ ] tarball 文件清单经过人工或 CI 复核。
