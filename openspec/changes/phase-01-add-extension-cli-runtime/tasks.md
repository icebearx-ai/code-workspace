## 1. Runtime CLI Contract

- [ ] 1.1 定义 runtime protocol version、capability set、CLI entry、摘要、scope 和 execution mode 的 manifest 字段及校验规则。
- [ ] 1.2 确定一次性与长驻模式的最小声明模型和稳定错误码。
- [ ] 1.3 更新扩展规范、JSON Schema、字段引用和规范说明，确保 v1 安装扩展无需迁移。
- [ ] 1.4 固化 Host 支持集合和未知必需 capability 的 fail-closed 语义。

## 2. CLI Namespace and Parser

- [ ] 2.1 在 registry 永久注册静态 `ext` 命令，不加入任何扩展私有选项。
- [ ] 2.2 扩展 parser 支持 extension-id 边界和 opaque argv，覆盖 `--json`、`-p`、`--` 与非法 Host option 顺序。
- [ ] 2.3 实现 `code-w ext` handler，完成扩展发现、runtime 解析、scope 判定和入口冻结校验。
- [ ] 2.4 实现统一 `ext` result、文本输出、JSON envelope、诊断和稳定错误映射。
- [ ] 2.5 更新 CLI architecture 文档、帮助和命令引用测试。

## 3. Process Execution

- [ ] 3.1 实现一次性 CLI 子进程、总超时、stdout/stderr 上限、退出码和 JSON result 校验。
- [ ] 3.2 实现长驻 CLI 的启动就绪、stdio 继承、进程组管理和 SIGINT/SIGTERM 转发。
- [ ] 3.3 保证临时 context 在成功、失败、信号退出和异常启动时都被清理。
- [ ] 3.4 实现 stable-plan、入口漂移、未知 capability、未安装和 global runtime 不可用等错误。

## 4. Fixture and Regression

- [ ] 4.1 增加 workspace-scoped 一次性 CLI fixture，覆盖成功、非 JSON、错误身份、超时和输出超限。
- [ ] 4.2 增加 global-scoped 长驻 CLI fixture，覆盖就绪、长时间运行、SIGTERM 和启动失败。
- [ ] 4.3 增加 parser、registry、package dry-run 和 CLI architecture checker 测试。
- [ ] 4.4 运行完整既有测试，证明 Monitor、安装生命周期和 v1 扩展行为未变化。
