# 内置扩展契约

Code Workspace 扩展是随 npm 包发布、位于 `extensions/<id>/<semver>/` 下的可信版本化软件包。它们不会从外部来源下载，也不是安全沙箱。

每个版本都包含 `manifest.json` 和 `init.js`。清单遵循 `schemas/extension-manifest-v1.json`。Code Workspace 会在确认前固定这两个文件的 hash，并在执行前再次验证。

Host 使用以下命令启动入口：

```text
node init.js --context <json-file> --output <empty-directory>
```

上下文仅包含 schema 版本、扩展标识、Workspace 显示标识/语言以及选中的工具。子进程只接收一小组环境变量白名单，并且契约不会向其提供真实 Workspace 路径。

入口将且仅将选中的制品写入其声明的 `output` 路径。`file` 的 `output` 默认取 `target`；共享制品类型必须显式声明 output。每个输出都必须是普通文件，且具有声明的 SHA-256。

支持的制品类型：

- `file`：扩展独占的 Workspace 相对路径文件。它不能指向由核心管理的目标或共享 Host 目标。
- `codex-config-block`：安装在 `.codex/config.toml` 稳定扩展标记内的 TOML 片段。Host 会保留配置块之外的内容，并验证完整的 TOML 文档。
- `codex-hooks`：合并到 `.codex/hooks.json` 中的 JSON Hook 片段。Host 会保留无关 Hook，并存储规范化后的贡献，以供升级和卸载使用。

扩展永远不会直接写入真实 Workspace，也不会提供卸载代码。规划、冲突处理、事务、验证、状态、回滚和移除均由 Host 负责。

`code-w extension install <id> --yes` 会在不重新执行 Workspace 核心初始化的情况下，安装或升级最高兼容内置版本，并支持传入多个 id。不传 id 时，交互 TTY 会列出全部有效内置扩展供多选；按 ESC 或提交空选择会无修改退出。JSON、非 TTY 和 `--yes` 调用必须至少提供一个 id。一个批次只确认一次，每个扩展使用独立事务；失败不会阻止后续扩展，但会使独立安装命令失败。

`code-w extension uninstall <id> --yes` 会从记录的状态中移除已安装扩展。即使内置扩展版本已不存在，它仍然可以工作。存在未知本地修改时，卸载会停止；初始契约特意不提供强制模式。

init、安装和卸载共享同一个 Workspace 操作锁，不能并发修改扩展制品或状态。

稳定的所有权键由扩展 id 和制品 id 组成。兼容升级中，当制品表示相同逻辑贡献时，其制品 id 和输出路径必须保持稳定。
