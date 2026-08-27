## Context

当前 Host 使用 manifest 的 `codeWorkspace` SemVer 范围与 `package.json.version` 判断扩展兼容性，但实际依赖由 manifest、init context/result、输出语义和生命周期规则共同决定。现有实现还同时存在 manifest schema v2、context/result schema v1、installed protocol v2 和 Workspace state schema v1；这些组件版本各有用途，却缺少一个对扩展开发者公开的整体规范版本。

本次变更在不改变 CLI 和四种基础输出语义的前提下，引入 Extension Spec v1 作为公共兼容边界。

## Goals / Non-Goals

**Goals:**

- Host 通过明确版本集合声明支持的 Extension Spec。
- 扩展声明自己实现的唯一 Extension Spec 版本，兼容性不依赖任何产品版本。
- Spec v1 明确绑定 manifest、context、result、输出和生命周期语义。
- 规范性定义与面向读者的说明文档具有清晰、可发布的目录边界。
- 同一扩展可同时包含基于不同规范版本实现的多个扩展版本，Host 选择其支持的最高扩展 SemVer。
- 新 Host 继续读取和卸载已有 installed protocol v1/v2 状态。

**Non-Goals:**

- 不设计规范版本范围、特性协商或可选 capability negotiation。
- 不新增输出类型、CLI 命令或外部扩展仓库。
- 不承诺旧 Host 能处理新 installed 状态；旧 Host 遇到未知状态只能安全失败。
- 不改变 Jira MCP 的下载、解压和校验私有逻辑。

## Decisions

### 1. 使用离散规范版本集合，不使用产品或规范范围

Host 暴露 `SUPPORTED_EXTENSION_SPEC_VERSIONS = [1]`，manifest 声明 `extensionSpecVersion: 1`。只有集合包含关系才表示可执行；不使用 `>=1 <2`，避免对未知规范作推测性兼容。

产品版本只描述 Code Workspace 发布，扩展 SemVer 只描述扩展发布，两者均不参与公共协议兼容判断。

### 2. Extension Spec 是组件规范的公开集合

Extension Spec v1 固定包含：manifest schema v3、init context schema v1、init result schema v1、四种输出语义、staging/result 约束以及安装/升级/卸载生命周期。组件 schema 保留各自版本，`extensionSpecVersion` 是扩展开发者与 Host 之间的整体兼容键。

manifest 升级到 schema v3，删除 `codeWorkspace` 并增加 `extensionSpecVersion`。context 和 result 保持 schema v1，同时回显同一 `extensionSpecVersion`，Host 验证它与计划一致。

### 3. 保留稳定发现 envelope，未知规范不执行

所有未来规范版本必须保留 `extensionSpecVersion`、`id`、`name` 和 `version` 发现 envelope。Host 可读取未知规范版本的身份，但不得按未知 schema 深度解释入口、能力或输出。

同一扩展存在多个版本时，Host 跳过不支持的规范版本并从受支持版本中选择最高扩展 SemVer。若没有受支持版本，返回 `EXTENSION_SPEC_UNSUPPORTED`，详情包含 Host 支持集合和仓库中发现的规范版本。

### 4. 新 installed 事实显式记录规范版本

新安装写入 installed protocol v3，增加 `extensionSpecVersion`。protocol v3 的其他 artifact 语义沿用 protocol v2。Host 继续接受 protocol v1/v2，以支持验证和卸载历史制品；旧状态在重新安装或升级成功后自然写成 v3。

卸载不要求当前 Host 仍支持该扩展的执行规范，因为卸载只依据 installed artifact 事实且不执行扩展代码。

### 5. CLI 契约保持不变

`init`、`extension install` 和 `extension uninstall` 的 registry、参数、配置投影、确认、锁、事务和 JSON envelope 不变。交互文案中的“兼容”改为“Host 支持的规范版本”，错误从产品版本不兼容改为规范版本不受支持。

### 6. 规范性制品与说明文档分离

Extension Spec 的规范性文字定义发布在 `spec/extension/<version>/`，Spec v1 的固定路径为 `spec/extension/v1/specification.zh-CN.md`。`docs/` 只承担使用说明、架构解释和示例，不成为兼容性或一致性判断的事实来源。

组件 JSON Schema 继续保留在已有 `schemas/` 路径并由规范性文件引用。本次不移动 schema，避免目录整理无意改变已发布的机器接口，也不复制 schema 形成两个事实来源。

### 7. 双语规范属于同一版本

Spec v1 同时发布 `specification.zh-CN.md` 和 `specification.en-US.md`，文件顶部提供双向语言链接。两份文件共享相同的规范版本、章节结构和 JSON Schema，不形成两个 Extension Spec 版本。

中文版本是解释基准，英文版本是完整规范译本。两者出现不同一致性结论时视为规范缺陷，修复前不得根据翻译差异扩展或收缩 Host 与扩展的兼容判断。

## Risks / Trade-offs

- [规范编号存在但文档不完整] → 发布独立中文 Extension Spec v1 文档，并明确其组件 schema 和可观察语义。
- [规范性契约与说明文档混放] → 使用独立版本目录发布规范；`docs/` 只引用，不重复定义。
- [双语规范产生两个事实来源] → 两版共享版本和结构，提供相互切换链接，并明确中文为解释基准。
- [未知规范 manifest 结构变化导致旧 Host 无法发现] → 将四个 envelope 字段定义为跨规范稳定前缀；缺失时按无效仓库条目处理。
- [同一扩展最高版本使用未知规范] → 跳过该版本并选择较低的受支持版本，而不是使整个扩展失效。
- [installed protocol v3 增加迁移成本] → 不批量重写现有状态，只在该扩展下一次成功安装或升级时迁移。
- [多个版本数字仍可能混淆] → 文档明确区分 Extension Spec、组件 schema、installed record 和产品/扩展 SemVer。

## Migration Plan

1. 在 `spec/extension/v1/` 发布 Extension Spec v1 规范性定义，并发布 manifest schema v3。
2. Host 声明支持 `{1}`，发现与执行改为规范集合判断。
3. 两个内置扩展迁移到 manifest schema v3 / Extension Spec v1，并更新入口摘要。
4. 新安装写入 installed protocol v3；继续读取和卸载 protocol v1/v2。
5. 删除测试中的产品版本注入和范围测试，增加混合规范版本选择、未知规范拒绝及旧状态卸载测试。
6. 更新说明文档和 npm 发布清单，使规范目录随包发布且 `docs/` 只保留引用。
7. 发布完整英文规范并在中英文版本间提供双向切换。

回滚到旧 Host 时，旧 Host 可能无法读取 protocol v3 installed 状态，因此发布回滚必须恢复与旧 Host 匹配的 Workspace 状态备份；本次不声称支持任意二进制降级。

## Open Questions

无。规范版本首版采用整数 `1`，后续只有机器可观察契约变化时才发布新版本。
