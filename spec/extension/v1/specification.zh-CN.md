# Code Workspace Extension Spec v1

[简体中文](./specification.zh-CN.md) | [English](./specification.en-US.md)

> 状态：规范性（Normative）  
> Extension Spec 版本：1  
> 语言：简体中文（解释基准）  
> 规范发布路径：`spec/extension/v1/specification.zh-CN.md`

本文档与其引用的 JSON Schema 共同构成 Code Workspace Extension Spec v1。扩展与 Host 的兼容性只由 `extensionSpecVersion` 判断，不依赖 Code Workspace 产品版本或扩展版本。

## 0. 文档地位与一致性

### 0.1 规范关键字

本文中的“必须”“不得”表示一致性要求；“应当”表示除非存在明确且可说明的理由，否则需要遵守；“可以”表示允许但不强制。

### 0.2 规范组成

Extension Spec v1 的规范性制品包括：

- 本文定义的入口、能力、输出、staging、安装、升级、验证和卸载语义；
- manifest schema v3：`schemas/extension-manifest-v3.json`；
- init context schema v1：`schemas/extension-init-context-v1.json`；
- init result schema v1：`schemas/extension-init-result-v1.json`。

JSON Schema 规定文档结构，本文规定跨文档和生命周期语义。二者出现冲突时属于规范缺陷，Host 和扩展不得自行猜测兼容性。

中文与英文规范必须表达相同的一致性要求并保持对应章节结构。两种语言产生不同解释时，差异属于规范缺陷；修正前以中文版本为解释基准，不得将翻译差异当作兼容能力。

### 0.3 一致性主体

符合 Spec v1 的 Host 必须实现本文对 Host 的全部要求，并且只执行通过 Spec v1 schema 和生命周期校验的扩展。符合 Spec v1 的扩展必须声明 `extensionSpecVersion: 1`，遵守对应 schema，并且不得绕过 Host 管理真实 Workspace 制品。

本文中的 JSON、命令和目录结构示例均为非规范性示例；它们用于说明规则，不能扩大或缩小规范要求。

## 1. 版本与兼容性

Extension Spec 使用离散正整数版本。Host 必须明确列出自己实现的版本集合；扩展必须声明一个版本。

```text
兼容 ⇔ extension.extensionSpecVersion ∈ host.supportedExtensionSpecVersions
```

组件的 `schemaVersion` 只描述单个 JSON 文档格式；`extensionSpecVersion` 描述 Host 与扩展之间的完整开发和执行契约。

产品发布、扩展私有实现或扩展 SemVer 变化不会自动产生新的 Extension Spec。只有 manifest、context/result、输出或生命周期出现不向后兼容的机器可观察变化时，才发布新的规范版本。

## 2. 稳定发现 Envelope

所有规范版本的 manifest 必须保留以下字段，使旧 Host 可以识别但不执行未知规范：

```json
{
  "extensionSpecVersion": 1,
  "id": "example-extension",
  "name": "Example Extension",
  "version": "1.0.0"
}
```

Host 对未知 `extensionSpecVersion` 只能读取上述字段，不得解释入口、能力或输出。一个扩展包含多个版本时，Host 从自己支持的规范实现中选择最高扩展 SemVer。

## 3. Manifest

Spec v1 manifest 使用 schema v3。manifest 是安装权限和最大输出范围的静态声明，不是扩展执行后的报告。

```json
{
  "schemaVersion": 3,
  "extensionSpecVersion": 1,
  "experimental": true,
  "id": "example-extension",
  "name": "Example Extension",
  "version": "1.0.0",
  "entry": "init.js",
  "entrySha256": "<sha256>",
  "timeoutMs": 30000,
  "capabilities": {
    "networkHosts": ["example.com"]
  },
  "outputs": [
    {
      "id": "runtime",
      "kind": "directory",
      "ownership": "exclusive",
      "target": ".code-workspace/extensions/example-extension/1.0.0"
    }
  ]
}
```

`codeWorkspace` 产品版本范围不属于 Extension Spec，不得出现在 Spec v1 manifest 中。

Host 在确认前冻结 manifest、入口及完整扩展版本目录摘要，在执行前重新验证。扩展不得通过动态 result 扩大 manifest 声明。

## 4. 执行入口

入口必须是扩展版本目录中的 `init.js`，由 Host 使用当前 Node 运行时执行：

```text
node init.js --context <context.json> --output <staging-directory> --result <result.json>
```

Host 只传递运行所需的环境变量白名单。子进程隔离不是安全沙箱；Spec v1 只执行可信内置扩展。

入口必须在 manifest 声明的超时内退出。失败、超时、缺少 result 或非法 result 均不得产生真实 Workspace 写入。

## 5. Context 与 Result

context 和 result 必须同时回显 `extensionSpecVersion: 1`。该值必须与冻结计划一致。

context 只包含扩展身份、非敏感 Workspace 元数据和工具选择，不包含真实 Workspace 根目录或凭证。

result 只包含扩展身份和 `{id, source}` 列表。它不得声明 target、kind、ownership、selector、摘要或网络能力。

## 6. 能力声明

Spec v1 只定义 `capabilities.networkHosts`。该字段用于安装计划、确认和诊断，表达扩展预期访问的 HTTPS host。

在没有 OS 级 enforcement 时，Host 不得声称它能阻止可信扩展访问其他网络或用户资源。

## 7. 输出类型

Spec v1 支持四种输出：

| kind | ownership | 生命周期语义 |
|---|---|---|
| `file` | `exclusive` | Host 独占写入、摘要、漂移检查和删除单个普通文件 |
| `directory` | `exclusive` | Host 独占替换、规范目录摘要、漂移检查和递归删除目录 |
| `text-block` | `shared` | Host 以扩展 id/output id 标记并管理文本片段 |
| `json-member` | `shared` | Host 以 JSON Pointer selector 管理单个成员并保留其他内容 |

公共输出不得包含 Jira、MCP、npm、归档或特定 Agent 产品的业务类型。

### 7.1 抽象 Hook 声明

扩展可以声明可插拔的 Workspace Hook。Hook 不是扩展输出文件，也不得直接声明
`PreToolUse`、`SessionStart` 等 Provider 原生名称。manifest 的 `hooks` 是一个可选数组，
每项至少包含 `id`、`event` 和 `command`：

```json
{
  "hooks": [
    {
      "id": "audit-task",
      "event": "task.activity",
      "command": "code-workspace-plugin-audit",
      "tools": ["codex", "claude"],
      "matcher": "*",
      "timeoutMs": 2
    }
  ]
}
```

支持的抽象事件为 `task.started`、`task.activity`、`write.before`、`write.after`、
`task.turn-ended`、`task.ended`、`task.subagent-started` 和 `task.subagent-ended`。
`session.start`、`session.activity`、`session.end`、`turn.end`、`subagent.start`、
`subagent.end`、`pre-write` 和 `post-write` 作为兼容别名会被规范化为上述事件。
`tools` 缺省时表示适用于 Host 支持的全部工具。`command` 是可信扩展提供的 Hook
执行入口；Host 只负责声明校验、适配器渲染和生命周期治理，不把它解释为任意原生
配置片段。

Codex 与 Claude 的适配器会把一个抽象事件映射到各自的原生事件，并只合成扩展拥有的
局部 entry。安装、升级和卸载均依据 Workspace 中的 installed 状态完成；卸载不执行
扩展代码，并保留用户及其他扩展的 Hook。扩展 Hook 被手动删除、重复或修改时，Host
必须 fail closed 并回滚本次事务。

## 8. Staging 验证

扩展只能在 Host 提供的 staging 目录生成候选内容。Host 必须：

- 规范化 result source 并拒绝路径逃逸；
- 要求 result 恰好返回本次适用的全部 output id；
- 拒绝未知、重复、缺失、重叠或额外输出；
- 拒绝符号链接、设备、socket、FIFO 和其他特殊文件；
- 根据真实 staging 内容计算文件或目录摘要。

扩展报告的摘要不能作为 installed 事实。

## 9. 安装、升级与卸载

每个扩展使用独立事务提交其独占输出、共享 contribution 和 installed 状态。完整后置条件通过前不得提交。

新安装必须记录：

- installed record 版本；
- `extensionSpecVersion`；
- 扩展版本；
- manifest 和完整扩展包摘要；
- 输出所有权以及 Host 计算的 installed 事实。

幂等判断必须同时验证 installed 状态和真实 Workspace。升级失败必须恢复旧制品和旧 installed 状态。

卸载只依据 installed 状态，不读取当前扩展包，也不执行扩展代码。Host 即使不再支持某个扩展的执行规范，只要仍能读取对应 installed record，就必须能够安全验证和卸载其制品。

## 10. 规范演进

新扩展完全复用 Spec v1 能力时，不得修改 Host 核心或公共 schema。

新公共能力只有同时具备跨扩展语义以及安装、验证、升级、回滚和卸载闭环时，才可以进入后续规范版本。Host 对未知规范版本必须安全失败，不得按数字范围猜测兼容。

Spec v1 发布后，其机器可观察语义保持不变。仅文字澄清且不改变一致性结果的修订可以继续发布在本目录；任何破坏性变化必须使用新的 `spec/extension/<version>/` 目录和新的 `extensionSpecVersion`。
