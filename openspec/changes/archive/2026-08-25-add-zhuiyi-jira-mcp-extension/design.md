## Context

扩展 Host 已具备选择、统一确认、Workspace 操作锁、逐扩展事务、installed 状态、共享 contribution、回滚和卸载能力。现有扩展入口只能生成 manifest 预先列出的固定文件，Jira 草案因此把下载和目录安装实现到了 Host 中，并新增 `remote-archive`、`claude-mcp-server` 等领域类型。

`zhuiyi-jira-mcp-0.1.0.tar.gz` 已包含 `dist` 和运行依赖，不需要 npm 安装或构建。扩展需要访问固定 Gitee 地址、验证固定 SHA-256、安全解压并生成 Codex/Claude 配置。附件目录 `.jira-attachments/` 是运行期用户数据，不是安装制品。

扩展子进程是故障隔离而不是安全沙箱。本次只支持随 Code Workspace 发布或明确批准的可信扩展，不声称阻止恶意代码直接访问当前用户可访问的资源。

## Goals / Non-Goals

**Goals:**

- 明确定义扩展包、静态 manifest、staging、初始化结果、候选制品和 installed manifest。
- 扩展执行前冻结最大能力和输出范围；Host 根据工具选择确定本次适用输出，执行结果必须完整匹配该集合。
- Host 独立验证 staging、计算摘要，并通过可恢复事务提交、升级和卸载。
- 使用有限且通用的输出语义覆盖当前内置扩展和 Jira MCP。
- 新增另一个使用相同能力的扩展时，无需修改核心分支和公共 schema。
- 保持既有 CLI、确认、批处理、锁、错误结果和用户数据保留契约。

**Non-Goals:**

- 不支持任意第三方不可信扩展、安全沙箱、扩展市场或远程扩展发现。
- 不支持 Workspace 外部副作用、扩展自定义卸载代码或强制卸载本地修改。
- 不提供通用包管理器、归档格式、构建系统或万能配置合并器。
- 不管理运行期用户数据，不收集或持久化 Jira 凭证。
- 不为尚未出现的扩展类型预先设计协议。

## Decisions

### 1. 静态 manifest 声明最大范围，result 完整返回本次适用输出

manifest v2 声明扩展身份、Host 兼容范围、入口/hash、超时、声明性网络目标以及可能输出。每个输出具有稳定 id、有限 kind、所有权、Workspace 相对 target、可选 selector 和适用工具。

Host 使用独立临时文件启动入口：

```text
node init.js --context <file> --output <staging> --result <file>
```

result v1 只包含扩展身份及 `{ id, source }` 列表。Host 先按工具选择过滤静态输出，result 必须恰好返回全部适用输出。扩展不能在执行后改变 target、kind、ownership 或 selector，也不提供权威安装摘要。Host 将实际输出与静态声明匹配并自行计算摘要。

### 2. 冻结完整扩展包而不只冻结入口

入口可以读取同目录的模板、私有元数据和辅助模块。Host 在规划时计算完整扩展版本目录摘要，并在执行前重新验证 manifest、入口和目录摘要，防止确认后执行输入变化。

入口 hash 仍用于发布包内部完整性检查；目录摘要用于计划到执行之间的冻结。基础版不把该机制描述为防御恶意 npm 包。

### 3. 基础版只支持四种输出语义

- `file`：扩展独占普通文件。
- `directory`：扩展独占普通文件目录树。
- `text-block`：Host 以扩展/output 标记拥有共享文本文件中的片段，并验证最终文档。
- `json-member`：Host 以 JSON Pointer 拥有共享 JSON 对象中的单个成员值。

`remote-archive` 不是输出语义：下载和解压只是在扩展内部产生候选目录的方法。`claude-mcp-server` 不是输出语义：它使用 `json-member` 写入 `.mcp.json#/mcpServers/<name>`。

现有已发布状态所需的旧 `file`、Codex 配置块和 Hooks 记录可以保留兼容读取/卸载；新的公开协议不再按产品名称增加类型。

### 4. staging 验证和摘要由 Host 完成

每个 result source 必须是 staging 内的规范相对路径并匹配声明 kind。Host 递归枚举 staging，只允许 result 引用的文件或目录树；拒绝额外顶层输出、符号链接、设备、socket、FIFO 和路径逃逸。

文件摘要由 Host 对实际字节计算。目录摘要按规范相对路径、文件模式和文件 SHA-256 排序计算；空目录不作为有意义安装内容。扩展自有的下载 hash 只属于扩展业务校验，不能直接作为 installed 摘要。

### 5. installed manifest 是唯一安装事实

静态 manifest 是意图，result 是扩展声明，installed manifest 才是 Host 验证后的事实。状态记录扩展版本、manifest/package 摘要、输出 id、kind、target、selector、Host 摘要和共享 payload。

幂等判断必须同时检查状态和真实 Workspace。升级在单扩展事务中比较旧、新输出，处理保留、新增、替换和移除；未知本地修改在任何写入前失败。卸载只读 installed 状态，不读取当前扩展包，不执行 `init.js`。

### 6. 文件系统事务是可恢复事务

独占目录继续使用目标同文件系统 staging、备份和 rename。文件、目录、共享目标和状态一起纳入单扩展补偿事务；写入或后置验证失败时恢复旧内容和旧状态。

该事务不承诺数据库级跨文件原子性。无法完整恢复时必须返回明确失败和残留诊断，不能保存成功状态。

### 7. 网络能力是声明和确认，不是安全沙箱

manifest 可以声明有意访问的 HTTPS host，供计划、确认和诊断使用。当前可信子进程模型不具备 OS 级 egress enforcement，因此文档和错误不得把该声明描述成强安全边界。

Workspace 路径不进入 context；入口只接收 staging/result 临时路径和必要的非敏感选择信息，以减少误操作和信息暴露。

### 8. Jira 私有实现下载和解压

Jira 扩展在私有代码或元数据中固定 raw 下载 URL、归档 SHA-256、大小限制、单根目录、包名称/版本和运行入口。入口使用受限 Node 实现下载并安全解压到 staging，拒绝路径逃逸、特殊文件、重复路径、不安全链接和超过限制的归档。

该代码可以从当前 Host 草案迁移到扩展私有目录，但不得继续由 `src/core` 或公共 schema 解释。安装过程不运行 npm 命令或归档脚本。

### 9. CLI 契约保持不变

`init`、`extension install [name...]` 和 `extension uninstall <name>` 保持 registry、parser、Workspace 要求、配置投影、统一确认、批处理结果和 JSON envelope 不变。

确认文本展示声明的网络 host 和 Workspace 输出目标，不展示 Host 解释的 DOWNLOAD/EXTRACT 业务步骤。网络失败仍是对应扩展失败，同批后续扩展继续执行。

## Risks / Trade-offs

- [可信扩展可以绕过协议] → 明确该模型不是安全沙箱，只发布或批准受信代码；Host 保证仅限其提交路径。
- [manifest v2 增加迁移成本] → 内置扩展随包同步迁移；installed 状态单独维持旧记录的安全卸载兼容。
- [通用 contribution 仍可能扩张] → 只实现当前需要且具备完整移除语义的文本块和 JSON 对象成员；其他格式等待真实需求。
- [目录摘要和回滚有成本] → 当前 Jira 包规模受扩展私有限制且约 3 MB，保持流式摘要和单扩展事务。
- [网络 host 无法强制限制] → 在计划和文档中明确其声明性含义，未来安全隔离作为独立变更。
- [Gitee master 内容可替换] → 扩展固定归档 SHA-256，内容变化安全失败；后续发布可以改用不可变 tag，而不改变 Host 协议。

## Migration Plan

1. 先提交新 schema、runner 和通用输出测试，不接入 Jira 网络下载。
2. 迁移现有内置扩展到 manifest v2，并验证文件安装、幂等和卸载。
3. 接入独占目录、共享文本块和 JSON 成员，完成升级/回滚/卸载测试。
4. 将 Jira 下载解压代码迁入扩展并完成 fixture 与真实包 E2E。
5. 移除 Host 中当前未提交的 `remote-archive`、`claude-mcp-server` 及领域错误分支。
6. 保留旧 installed 状态的只读验证和卸载兼容，运行完整回归后发布。

## Open Questions

无。基础版范围外需求通过后续独立变更处理。
