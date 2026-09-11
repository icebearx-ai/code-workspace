## 1. Extension Package

- [ ] 1.1 创建 `extensions/monitor/<version>/` manifest、runtime CLI、配置声明和 observer Hook 声明。
- [ ] 1.2 迁移 Monitor Store、HTTP API、Dashboard、i18n 和静态资源到扩展包。
- [ ] 1.3 确保扩展 runtime 不导入核心 Monitor 模块，并使用通用 context/配置路径。
- [ ] 1.4 增加扩展包摘要、入口摘要和 package files 覆盖。

## 2. Runtime Integration

- [ ] 2.1 通过通用 `ext` global runtime 启动 Monitor 服务并保持长驻生命周期。
- [ ] 2.2 通过扩展配置读取 enable、url 和其他现有设置，不修改 `config.monitor`。
- [ ] 2.3 为 Codex 和 Claude 安装 observer Hooks，并映射到现有 Monitor API。
- [ ] 2.4 验证多 Workspace 上报、删除 Session、SSE、i18n 和十分钟失活规则。

## 3. Opt-in Lifecycle

- [ ] 3.1 支持 `extension install monitor --yes`、升级和卸载，但不改变 init/update 默认选择。
- [ ] 3.2 验证 Workspace 安装状态、配置、Observer Hook 和 global service 生命周期互相独立。
- [ ] 3.3 验证卸载扩展不删除 core Monitor 配置、用户数据或其他 Hook。
- [ ] 3.4 增加用户文档，明确核心 Monitor 与扩展 Monitor 并存的 opt-in 使用方式。

## 4. Behavioral Parity

- [ ] 4.1 将现有 Monitor 测试拆分为共享业务基线和实现适配套件。
- [ ] 4.2 对核心实现与扩展实现运行 Session、统计、删除、页面和 API 对等测试。
- [ ] 4.3 覆盖服务不可达、observer failure-open、多 Workspace 和升级失败回滚。
- [ ] 4.4 运行完整测试、CLI architecture checker、OpenSpec validate 和 package dry-run。
