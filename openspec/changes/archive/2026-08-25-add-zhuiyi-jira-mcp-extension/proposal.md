## Why

当前 Jira MCP 草案把远程下载、tar.gz 解压、npm 包身份和 Claude MCP server 直接建模为 Host artifact，导致每增加一种扩展业务都需要修改核心代码和公共 schema。扩展核心应治理生命周期和可观察副作用，而不理解 Jira、下载协议或具体 Agent 配置。

需要先建立一版基础、稳健且闭环的扩展执行协议，再通过该协议发布 `zhuiyi-jira-mcp`。Jira 扩展自行准备候选运行目录和配置，Host 只负责静态范围、staging、验证、提交、状态、升级和卸载。

## What Changes

- 新增静态 manifest v2、初始化 context v1 和初始化 result v1 协议。静态 manifest 在执行前声明能力和最大输出范围；result 只返回本次实际输出 id 与 staging 来源。
- Host 冻结完整扩展包、在独立 staging 中执行可信 `init.js`，拒绝越界、额外、缺失、符号链接或特殊文件，并独立计算摘要。
- 公共输出能力收敛为独占文件、独占目录、共享文本块和 JSON 对象成员；Host 不新增 `remote-archive` 或 `claude-mcp-server` 等领域类型。
- installed 状态继续作为幂等、升级、漂移检查和卸载的事实来源；卸载不执行扩展代码，并保留用户数据。
- `zhuiyi-jira-mcp` 的下载、固定 SHA-256 校验、安全解压和包结构校验移入扩展私有入口；安装预构建包时不执行 npm 安装或构建。
- 保持 `init`、`extension install`、`extension uninstall` 的命令、确认、锁、批处理和 JSON envelope 契约不变。

## Capabilities

### New Capabilities

- `extension-execution-protocol`: 可信扩展包的静态声明、staging 执行、动态结果、输出验证和 Host 提交协议。

### Modified Capabilities

- `workspace-init-extensions`: 使用通用文件、目录和共享 contribution 生命周期发布 `zhuiyi-jira-mcp`，并保持安装、升级和卸载闭环。

## Impact

- 新增扩展 manifest/context/result schema，重构扩展发现、规划、执行、制品合成、状态和卸载核心服务。
- 移除当前未提交草案中的 Host 下载和 Jira/Claude 专用 artifact 分支；复用目录摘要、目录事务、回滚及共享所有权能力。
- 迁移内置扩展到新静态协议，并保留已发布 installed 状态所需的兼容读取和卸载能力。
- 更新 Jira 扩展、测试、OpenSpec 和中英文扩展文档；不改变 CLI registry 或 parser 契约。
