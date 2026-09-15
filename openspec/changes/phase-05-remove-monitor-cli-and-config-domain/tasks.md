## 1. 扩展 1.1.0 先行合入

- [x] 1.1 复制 `extensions/monitor/1.0.0` 为 `extensions/monitor/1.1.0`，runtime 入口识别 `report` argv：读 stdin、从 cwd 向上查找 `.codew/monitor-reporting.json`、POST、任何失败 exit 0。
- [x] 1.2 `reportHookEvent` 签名从核心 config 形态改为扩展制品形态（`{ enable, url, workspace }`），新增 `findReportingConfig` / `loadReportingConfig`。
- [x] 1.3 manifest 版本升至 1.1.0，Hook `command` 改为 `codew ext monitor report`，重算 entrySha256。

## 2. 通用 Host 短命令执行能力

- [x] 2.1 `src/core/extension-runtime.js` 新增 `runCommandRuntime`：以继承 stdio、调用方 cwd 执行 runtime 入口，超时仍为 `timeoutMs`，不经过 service 注册与 readiness。
- [x] 2.2 `executeExtensionRuntime` 按 argv 分发：空 argv 或 `serve` 走 singleton 服务，其他首参数走短命令。
- [x] 2.3 将 argv 约定写入 `spec/extension/v1/specification.{zh-CN,en-US}.md`（不修改 manifest schema）。

## 3. 删除核心 monitor 业务与配置域

- [x] 3.1 删除 `src/cli/commands/monitor.js` 及 `src/cli.js` 的 `executeMonitor` / `readStdinJson` 分发与导出。
- [x] 3.2 从 `src/cli/registry.js` 删除 `monitor` / `monitor report` 命令与 `--monitor` / `--no-monitor` / `--monitor-url` init 选项。
- [x] 3.3 `src/core/config.js` 解构丢弃 `monitor` 键，删除 `DEFAULT_MONITOR_URL` / `normalizeMonitor` / inspectConfigDomains 投影。
- [x] 3.4 `src/core/initializer.js` 取消 monitor 合并/提示/默认与 capabilities 注入。
- [x] 3.5 `src/core/doctor.js` 删除 monitor 校验、`MONITOR_CODEX_REQUIRED` 与 capabilities 派生。
- [x] 3.6 `src/core/managed-files.js` 删除 capability 校验分支与 `capabilities` 参数。
- [x] 3.7 `src/cli/commands/{init,update,extension}.js`、`src/init/{wizard,plan}.js` 删除 monitor 选项、自动激活、settings 特例与输出字段。

## 4. 测试、文档与验证

- [x] 4.1 测试全部切换到 `--extensions monitor` / `codew ext monitor report` 路径，删除退化对等测试。
- [x] 4.2 更新 README、user-guide 模板及 `artifacts/manifest.json` 哈希，使架构检查通过。
- [x] 4.3 新增 `docs/release-notes.md` 记录 phase-05 破坏性变更。
- [x] 4.4 运行完整测试、CLI 架构检查、npm pack 与 strict OpenSpec 校验，记录端到端冒烟证据。

<!-- Verification evidence (2026-09-13):
- npm test: 239 pass / 1 skipped (sandbox loopback) / 0 fail
- cli:architecture-check: passed
- pack:check: no src/monitor in tarball
- openspec validate phase-05-remove-monitor-cli-and-config-domain --strict: valid
- Smoke: codew ext monitor report failure-open (exit 0) delivers event to running monitor service
-->
