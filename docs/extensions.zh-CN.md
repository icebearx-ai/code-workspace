# 内置扩展契约

Code Workspace 扩展是随发布包提供、位于 `extensions/<id>/<semver>/` 下的可信版本化软件包。扩展进程具有故障隔离，但不是安全沙箱：内置扩展代码仍以当前用户的操作系统权限运行。

每个版本包含 `manifest.json`、`init.js`，以及扩展需要的私有模板、元数据或辅助代码。新扩展包遵循：

- `schemas/extension-manifest-v2.json`
- `schemas/extension-init-context-v1.json`
- `schemas/extension-init-result-v1.json`

静态 manifest 声明扩展身份、Host 兼容范围、入口摘要和超时、声明性网络 host，以及最大输出范围。Code Workspace 在确认前冻结 manifest、入口和完整扩展版本目录摘要，并在执行前重新验证三者。

Host 使用相互独立的临时路径启动入口：

```text
node init.js --context <context-file> --output <staging-directory> --result <result-file>
```

context 只包含扩展身份、Workspace 显示元数据和所选工具，不提供真实 Workspace 路径。result 只包含扩展身份和 `{ id, source }`。它必须完整返回本次工具选择所适用的全部 manifest 输出，不能重新声明 target、kind、ownership、selector 或摘要。

Host 递归验证 staging，拒绝未声明内容、路径逃逸、符号链接和特殊文件，并独立计算已安装文件或目录摘要。扩展不直接写入真实 Workspace 或 installed 状态，也不提供卸载脚本。

## 通用输出类型

- `file`：扩展独占的一个 Workspace 相对普通文件。
- `directory`：扩展独占的一个 Workspace 相对目录树，其中只能包含普通文件和目录。
- `text-block`：Host 使用稳定标记管理的共享文本片段；`format: "toml"` 会同时验证片段和合成后的完整文档。
- `json-member`：扩展在共享 JSON 对象文档的声明 JSON Pointer 位置拥有一个值。

独占目标不能与核心管理路径或其他扩展目标重叠。多个共享文本块可以共存于同一文本文件；JSON 成员所有权会拒绝相同 selector 及父子 selector。安装、升级、回滚和卸载均保留用户、核心及其他扩展的内容。

下载协议、归档格式、包管理器、Jira、MCP 和具体 Agent 产品都不是公共输出类型。扩展可以在私有实现中使用这些知识，在 staging 中准备候选文件或目录。声明的 `networkHosts` 会展示在计划中供用户确认，但不代表操作系统级网络出口强制隔离。

installed manifest 是唯一安装事实。它记录协议版本、扩展版本、冻结的扩展包和 manifest 摘要、通用输出所有权、Host 计算的摘要及共享 contribution 数据。幂等判断同时验证状态和真实 Workspace。升级在单扩展可恢复事务中处理保留、新增、替换和移除的输出。卸载只读取 installed 状态，因此扩展包已经不存在时仍可工作。发现未知本地修改时，升级或卸载会停止；基础版不提供强制模式。

已经发布的协议 v1 文件、Codex 配置块和 Codex Hooks installed 记录仍可读取和卸载；它们只属于兼容状态，不再是 manifest v2 的新输出类型。

`init`、`extension install` 和 `extension uninstall` 共用同一个非阻塞 Workspace 操作锁。多扩展安装只确认一次，每个扩展使用独立事务；单个失败不会阻止后续扩展，但整体命令会报告失败。

## Zhuiyi Jira MCP

安装：

```bash
code-w extension install zhuiyi-jira-mcp --yes
```

Jira 扩展在私有实现中下载固定的 Gitee 发布包，校验固定 SHA-256，安全解压，并在 staging 中验证 npm 包名称、版本和 `dist/index.js` 入口。归档已经包含 `dist` 和运行依赖；初始化不会执行 `npm install`、`npm ci`、构建或归档内脚本。

验证完成后，Host 只安装通用输出：

```text
.code-workspace/extensions/zhuiyi-jira-mcp/0.1.0/   # directory
.codex/config.toml                                  # 选择 Codex 时的 text-block
.mcp.json#/mcpServers/zhuiyi-jira                   # 选择 Claude 时的 json-member
```

生成配置只包含非敏感默认值，不会持久化 Jira Cookie、Token、邮箱或密码。用户需要在启动 Agent 的环境中提供凭证，例如：

```bash
export JIRA_COOKIE='JSESSIONID=...; atlassian.xsrf.token=...'
```

下载附件默认保存在 Workspace 的 `.jira-attachments/`。它是运行期用户数据，不是安装制品，扩展升级或卸载时都会保留。
