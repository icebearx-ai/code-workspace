# Monitor 扩展化实施提案包

## 文档元数据

- 变更名称：`extract-monitor-extension`
- 实施状态：已完成，OpenSpec 任务 `15/15`
- 补丁基线：`2d30e324b7d54c435a57c131b2571264c37777de`
- 完整补丁：[extract-monitor-extension.patch](./extract-monitor-extension.patch)
- 补丁大小：401,200 bytes，6,066 行
- 补丁 SHA-256：`cff9896fbc14dabc69e82b378680add6fda1441b11114648288bd84f20f71ff7`

本目录用于移交本次 Monitor 扩展化工作的方案、决策、实现边界和代码补丁。补丁是在加入本提案包之前生成的，因此不包含本目录自身的文件；它包含本次工作区相对于上述基线的已跟踪修改、新增文件和 OpenSpec 变更文件。

## 一页结论

本次将 Monitor 从 Code Workspace 核心业务中抽离为内置扩展，同时在核心保留稳定、与扩展数量无关的通用扩展 CLI 扩展点。核心负责扩展发现、安装/升级/卸载、制品校验、Hook 合成、配置生命周期和 CLI Host；Monitor 扩展负责 Store、HTTP Server、Dashboard、事件映射、国际化、资源和运行时配置。

核心配置不再生成新的 `monitor` 域。Monitor 配置固定为：

```text
<workspace>/.code-workspace/config-monitor.yaml
```

Monitor observer Hook 与写保护 Hook 使用不同协议、runner 和 marker，前者 failure-open、只上报观察事件，后者继续 failure-closed、负责写入协调和 ALLOW/DENY 决策。两者不共享 task ledger、claim、写入 scope 或 Monitor API。

## 需求边界

### 本次实现

- Monitor 独立扩展包：`extensions/monitor/0.1.0/`。
- 通用命令：`code-w ext <extension-id> ...`。
- 扩展 CLI 的入口摘要、协议版本、作用域、超时、结果 envelope、参数透传、错误和输出限制校验。
- 长驻 CLI 的独立子进程、启动阶段超时、SIGINT/SIGTERM 转发和退出清理。
- `config-<extension-id>.yaml` 的路径、读写、升级保留和卸载保留语义；Monitor 使用 `config-monitor.yaml`。
- Codex/Claude 独立 observer Hook 适配和 failure-open acknowledgement。
- 旧 `config.monitor`、旧 `code-w monitor report` Hook 的原子迁移。
- 旧 `code-w monitor` 到 `code-w ext monitor` 的兼容别名。
- Monitor 扩展制品、Hook、配置和运行期数据的安装、升级、卸载语义。
- 相关 Extension Spec、manifest schema、CLI 架构文档、README 和测试更新。

### 明确不做

- 不修改 Monitor 的 Session 生命周期判定、十分钟失活阈值、统计、删除 API、Dashboard 交互、SSE 或事件业务映射。
- 不把 observer Hook 与写保护 Hook 合并。
- 不把扩展子进程描述为恶意代码安全沙箱；扩展仍是可信代码，隔离主要是故障和生命周期隔离。
- 不允许扩展 CLI 绕过 Host 生命周期、声明未授权 Workspace target 或解释扩展私有参数。

## 总体架构

```text
Agent 原生事件
      │
      ▼
Codex / Claude Provider adaptor
      │  提取 provider-neutral 事件和元数据
      ├──────────────► Monitor observer runner
      │                 failure-open / acknowledgement
      │                 HTTP 上报到 global Monitor runtime
      │
      └──────────────► Task coordination runner
                        failure-closed / allow-deny
                        ledger、claim、写入范围协调

code-w ext <id> args
      │
      ▼
核心 CLI Host
      │  发现、冻结、校验 manifest 和入口摘要
      ▼
独立扩展 CLI 子进程
      │
      ├─ 一次性调用：JSON result envelope
      └─ 长驻调用：独立生命周期和信号转发

Workspace 状态                         Global runtime
  ext-manifest.json                     Monitor Server
  config-monitor.yaml          ◄──────  多 Workspace 事件汇总
  observer Hook 制品
```

### 作用域

- Workspace-scoped：Monitor 扩展安装状态、observer Hook 和 `config-monitor.yaml`。
- Global-scoped：Monitor Server，由 `code-w ext monitor` 启动，可汇总多个 Workspace。
- 核心 Host 不为 Monitor 增加特殊 dispatcher 分支；global runtime 通过通用 registry 发现。

## 关键执行流程

### 安装或初始化

1. Host 发现受支持的版本化扩展 manifest。
2. 在写入前校验入口路径、SHA-256、Extension Spec、Hook 协议和制品声明。
3. 以 Workspace 操作锁和文件事务安装扩展输出、`config-monitor.yaml` 默认模板及 observer Hook。
4. 合成 Codex/Claude 原生 Hook，保留用户 Hook、写保护 Hook 和其他扩展 Hook。
5. 验证文件、Hook marker、扩展状态和配置路径，之后提交事务。

显式执行 `code-w init . --extensions none --yes` 时，不安装 Monitor 扩展、不生成 `config-monitor.yaml`，也不安装 Monitor observer Hook。

### `code-w ext`

核心 registry 只注册一次 `ext`。核心只解释扩展 ID 和通用执行边界；扩展 ID 后的参数原样透传，使用 `--` 时可明确分隔扩展私有参数。

一次性 CLI 必须返回与计划扩展身份匹配的 JSON envelope。Host 会验证入口摘要、manifest/package 是否发生漂移、退出码、超时、输出上限和 envelope 字段。

长驻 CLI 使用独立子进程，不使用一次性 `spawnSync` 的生命周期超时。`timeoutMs` 只限制启动阶段；Host 转发 SIGINT/SIGTERM，进程退出后清理临时上下文。

示例：

```bash
code-w extension install monitor --yes
code-w ext monitor
code-w ext monitor status --json
code-w ext monitor -- --port 3212
```

### Hook 事件路径

Provider adaptor 负责识别 Codex/Claude 原生事件、提取通用字段并排除敏感正文；随后分流到两个独立协议：

- `observer`：发送 Session、Prompt、Tool、Stop、SessionEnd 等观察事件；异常、配置错误或 Monitor 不可达时返回中性 acknowledgement，不阻断 Agent。
- `coordination`：执行写入范围、task lifecycle、ledger、claim 和 ALLOW/DENY 决策；保持 failure-closed。

observer 模块不导入 task coordination 模块，写保护模块也不调用 Monitor API、Store 或 observer 状态。

### 旧配置和 Hook 迁移

迁移检测以下任一旧状态：

- `.code-workspace/config.yaml` 中存在 `monitor` 域；
- Codex 或 Claude 原生配置中存在 `code-w monitor report` 旧 Hook。

迁移会在一个文件事务中：

1. 将旧 Monitor 配置写入 `config-monitor.yaml`（若新文件已存在，以用户新配置为准）；
2. 将旧 Hook 替换为独立 observer Hook；
3. 从核心 `config.yaml` 删除旧 `monitor` 域；
4. 清理旧核心托管 Hook 状态；
5. 完成后验证；任一阶段失败则回滚，不删除旧来源。

### 卸载

卸载基于已安装状态，不执行扩展代码。它删除扩展拥有的制品和 observer Hook，但默认保留：

- `config-monitor.yaml`；
- 用户自定义 Hook；
- 写保护/协调 Hook；
- Monitor 运行期用户数据。

## 主要决策

完整决策记录见 [decisions.md](./decisions.md)。核心决策摘要如下：

| 编号 | 决策 | 结果 |
| --- | --- | --- |
| D1 | 双协议 Hook 边界 | observer 与写保护独立安装、执行、标记和失败策略 |
| D2 | 静态通用 `ext` | 扩展数量变化不修改核心 registry |
| D3 | 双作用域 Monitor | Workspace 管理 Hook/状态，Global runtime 管理 Server |
| D4 | 扩展配置文件独立 | `config-monitor.yaml` 不进入核心 `config.yaml` |
| D5 | 渐进迁移 | 旧配置/Hook 原子迁移，保留 `code-w monitor` 别名 |
| D6 | 长驻 CLI 独立进程 | 启动超时与服务生命周期分离，转发终止信号 |
| D7 | 可信扩展而非安全沙箱 | Host 提供校验和故障隔离，不承诺恶意代码防护 |
| D8 | 兼容代码保留 | legacy API、旧参数和 `src/monitor/*` 作为非破坏性桥接保留 |

## 变更文件范围

### 核心 Host、CLI 与配置

- `src/core/extensions.js`：manifest CLI 元数据、global runtime registry、CLI Host、长驻调用。
- `src/core/config.js`：扩展配置文件 API、旧 Monitor 配置/Hook 迁移。
- `src/core/hooks.js`、`src/hooks/adapters/*`：协议分流、Provider 适配、写保护能力懒加载。
- `src/cli/registry.js`、`src/cli/commands/ext.js`、`src/cli.js`：通用 `ext` 路由。
- `src/cli/commands/init.js`、`src/cli/commands/update.js`、`src/cli/commands/monitor.js`：初始化、更新、兼容别名。
- `schemas/extension-manifest-v3.json`、`spec/extension/v1/*`、`docs/cli-architecture.md`：契约和架构文档。

### Monitor 扩展

- `extensions/monitor/0.1.0/manifest.json`
- `extensions/monitor/0.1.0/init.js`
- `extensions/monitor/0.1.0/cli.js`
- `extensions/monitor/0.1.0/runtime/index.js`
- `extensions/monitor/0.1.0/runtime/observer.js`
- `extensions/monitor/0.1.0/runtime/config.js`
- `extensions/monitor/0.1.0/runtime/page.js`
- `extensions/monitor/0.1.0/runtime/i18n/*`
- `extensions/monitor/0.1.0/assets/*`
- `bin/code-workspace-monitor-hook.js`

### 测试和规划材料

- `src/__test__/monitor-extension.test.js`：安装、迁移、卸载、CLI、Hook 解耦、业务基线和运行时覆盖。
- `openspec/changes/extract-monitor-extension/`：proposal、design、spec、tasks；任务已全部完成。

## 验证结果

在补丁生成前完成以下验证：

```text
247 tests
245 pass
2 skip
0 fail
```

跳过项为 Gitee Jira 外部依赖测试，以及当前 sandbox 不允许 loopback listener 的 Monitor Server 测试。

通过的检查：

```bash
node scripts/check-cli-architecture.js
npm test
npm_config_cache=/private/tmp/code-workspace-npm-cache npm run check
openspec validate extract-monitor-extension --json --no-interactive
git diff --check
```

## 补丁使用

补丁面向基线 `2d30e324b7d54c435a57c131b2571264c37777de`。在干净 checkout 中使用：

```bash
git apply --check proposal/extract-monitor-extension/extract-monitor-extension.patch
git apply proposal/extract-monitor-extension/extract-monitor-extension.patch
```

补丁包含二进制资源的 Git binary patch。应用后建议执行：

```bash
npm test
node scripts/check-cli-architecture.js
npm_config_cache=/private/tmp/code-workspace-npm-cache npm run check
```

如果目标分支已经包含部分变更，应先按文件或 commit 范围拆分应用，避免重复应用导致冲突；不要用强制覆盖方式处理用户已有的 Hook、配置或运行期数据。

## 归档和后续工作

- OpenSpec 变更当前已完成但尚未 archive；归档应作为独立操作执行。
- 未来如清理 legacy `src/monitor/*`、`config.monitor` 或旧 CLI 参数，应先评估可见 API 和兼容测试的破坏性影响。
- `code-w ext` 已作为后续扩展 CLI 通用扩展点，但本版本仍只信任随包提供的内置扩展，不开放任意网络扩展源。
