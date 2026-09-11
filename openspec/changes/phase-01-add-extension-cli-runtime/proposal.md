## Why

现有扩展机制主要解决安装期制品生成，扩展无法以稳定协议暴露运行时 CLI。每增加一个带 CLI 的能力，核心都必须新增命令、参数和路由，导致核心持续增重，也限制用户按需选择扩展。

## What Changes

- 引入通用 Runtime Extension CLI 契约，扩展通过 manifest 声明 CLI 入口、摘要、协议版本、作用域和一次性/长驻执行模式。
- 永久注册 `code-w ext <extension-id> ...` 这一核心命令；扩展 ID 之后的参数由扩展解释，核心不得持续解析扩展私有选项。
- 明确 Host 与扩展职责：Host 只负责发现、安装状态、入口完整性、超时、进程生命周期、输出上限和统一错误；扩展负责子命令、参数、帮助和业务结果。
- 支持 `workspace` 与 `global` 两种运行时作用域，并固定第一版的解析和失败语义。
- 提供一次性 CLI 与长驻 CLI 两套生命周期，长驻模式不得被一次性超时错误终止。
- 使用独立测试扩展验证 CLI 协议，本阶段不迁移或修改 Monitor。

## Capabilities

### New Capabilities

- `extension-cli-runtime`: 通用 `code-w ext` 命令、参数直通、作用域解析、入口校验以及一次性/长驻进程生命周期。

### Modified Capabilities

- `extension-execution-protocol`: 扩展规范新增运行时 CLI 声明和执行边界，同时保持现有安装期扩展兼容。

## Impact

影响 CLI registry/parser/dispatch、扩展 manifest 与规范、扩展发现和计划模型、进程执行层、CLI 架构检查及测试。不修改 Monitor 配置、Monitor CLI 或 Monitor Hook；现有扩展行为必须保持不变。
