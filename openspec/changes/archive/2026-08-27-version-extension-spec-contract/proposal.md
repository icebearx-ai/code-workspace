## Why

当前扩展使用 Code Workspace 产品版本范围判断兼容性，但扩展真正依赖的是 manifest、执行上下文、执行结果、输出类型和生命周期语义组成的公共开发规范。产品版本范围既会产生未经验证的未来兼容承诺，也会使普通产品发布被迫修改扩展或测试。

## What Changes

- **BREAKING**：发布 manifest schema v3，移除 `codeWorkspace` 产品版本范围，新增明确的 `extensionSpecVersion`。
- Code Workspace 明确声明自己支持的扩展规范版本集合，只执行其支持版本实现的扩展。
- 将 manifest、init context/result、输出类型和生命周期语义定义为一个完整、不可猜测兼容的 Extension Spec v1。
- 将中英文规范定义发布在独立、版本化的 `spec/extension/v1/` 目录并提供双向语言切换；`docs/` 只保留说明性材料和规范引用。
- 扩展发现只按“Host 支持规范版本”过滤，再选择最高扩展 SemVer；不再读取 `package.json.version` 判断扩展兼容性。
- installed 状态记录安装时的扩展规范版本，使升级、验证和卸载具备明确事实依据；旧 protocol v1/v2 状态继续可读取和安全卸载。
- 更新两个内置扩展、公共 schema、中文架构文档和测试，移除测试对 `package.json.version` 的篡改。

## Capabilities

### New Capabilities

- 无。

### Modified Capabilities

- `extension-execution-protocol`：以 Extension Spec 版本集合取代产品版本范围，明确规范组成、兼容判定和演进边界。
- `workspace-init-extensions`：扩展发现、版本选择、installed 事实、诊断和内置扩展声明改用规范版本。

## Impact

- 影响公共 Extension Spec 规范目录和 schema、扩展核心发现/校验/执行逻辑、installed 状态、两个内置扩展 manifest、扩展文档及测试。
- `extension install/uninstall` 的命令路径、参数、确认、事务、结果 envelope 和配置投影保持不变。
- 不新增依赖，不改变扩展私有初始化逻辑，不扩大 Host 可理解的输出类型。
