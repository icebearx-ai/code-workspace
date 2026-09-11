## 1. Observer Contract

- [ ] 1.1 定义 observer capability、protocol 标识、观察事件名和版本化 envelope。
- [ ] 1.2 固定敏感信息排除规则、未知事件行为、warning 和稳定错误码。
- [ ] 1.3 定义 observer 中性 acknowledgement 与运行期 failure-open 语义。
- [ ] 1.4 更新 Extension Spec、manifest schema、Hook 文档和规范中英文文件。

## 2. Provider Adapters

- [ ] 2.1 为 Codex 增加 Session、Turn、Tool、Subagent、Permission 和结束事件的观察归一化。
- [ ] 2.2 为 Claude 增加对应归一化，包括 `PostToolUseFailure` 和结束失败状态。
- [ ] 2.3 将原生字段映射集中在 adaptor，确保 observer runtime 不依赖 Provider 私有字段。
- [ ] 2.4 实现 Provider 中性 acknowledgement 渲染并记录失败诊断而不阻断工具。

## 3. Hook Lifecycle Isolation

- [ ] 3.1 扩展 Hook 声明校验，区分 observer 与决策型协议和 contribution marker。
- [ ] 3.2 扩展原生配置合成、冲突检查、状态记录、后置验证和卸载，保持协议隔离。
- [ ] 3.3 阻止 observer 结果进入 ALLOW/DENY、claim、台账或写保护状态。
- [ ] 3.4 验证 observer 安装失败与 observer 运行失败使用不同语义。

## 4. Fixture and Regression

- [ ] 4.1 增加 Codex/Claude observer fixture，覆盖完整事件矩阵和中性输出。
- [ ] 4.2 覆盖服务不可达、超时、损坏输入、错误 acknowledgement 和决策字段拒绝。
- [ ] 4.3 覆盖 observer 与用户/其他决策 Hook 并存、修改漂移和事务卸载。
- [ ] 4.4 运行完整测试，证明现有 Hook、Monitor 和其他扩展行为未变化。
