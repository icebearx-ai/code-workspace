## Context

phase-07 提供只读 Nexus Provider 和 Store 导入能力，但当前 CLI 只有面向内置 catalog 的 `extension install/uninstall`。本 Change 必须把外部读取与 Workspace 写入分开：搜索和详情不需要 Workspace；安装和升级必须先冻结远端候选，再进入现有确认、锁、逐扩展事务、后置验证和回滚流程。

现有命令支持批量最佳努力安装，用户不能选择版本，且 `name@version` 被明确拒绝。新增能力要保持这些稳定边界，同时避免“远端不可用时静默安装旧内置版本”或“运行时自动跟随 latest”。

## Goals / Non-Goals

**Goals:**

- 提供 Nexus 扩展搜索与详情的文本/JSON CLI。
- 让独立 install 从受信 Provider 解析最高兼容正式版本或精确版本。
- 提供显式 upgrade 命令并复用现有事务。
- 支持精确已缓存包离线复用和明确的 source/digest 冲突诊断。
- 保持系统扩展、init、uninstall 和 runtime 的安全边界。

**Non-Goals:**

- `init` 不隐式联网发现或安装普通远端扩展。
- 不支持 SemVer range、`name@version`、自动后台升级或 dist-tag 跟随。
- 不支持多个 Registry、跨 Registry 优先级或公网 fallback。
- 不新增远端删除、发布、签名或强制吊销命令。

## Decisions

### D1: 外部读取命令与 Workspace 写命令分离

新增命令合同：

```yaml
command: extension search
workspace: none
config: []
interaction: never
effects: external
arguments:
  - name: query
    required: false
options: {}
verification:
  - Nexus 页结果完成 schema 转换和 scope 过滤

command: extension info
workspace: none
config: []
interaction: never
effects: external
arguments:
  - name: name
    required: true
options: {}
verification:
  - npm identity 与返回版本集合一致
```

命令层只调用 core Provider service 和构造共享 result，不解析 URL、`.npmrc`、Nexus JSON 或 npm packument。

### D2: install 保留原命令并增加明确版本选项

更新合同：

```yaml
command: extension install
workspace: required
config: [identity, language]
interaction: required
effects: planned-write
arguments:
  - name: name
    required: false
    variadic: true
options:
  yes: boolean
  version: exact-semver
  allow-deprecated: boolean
  offline: boolean
writes:
  - extension-owned Workspace artifacts/contributions/hooks
  - .codew/ext-manifest.json
verification:
  - Store package matches frozen source/version/digest
  - all activation artifacts and installed state match
rollback:
  - existing per-extension transaction restores previous activation
```

`--version` 只允许与一个显式名称一起使用，必须是精确 SemVer；prerelease 只能通过精确 `--version` 请求。`--allow-deprecated` 只影响精确版本，不能让 deprecated 进入默认最高版本解析。`name@version` 继续拒绝。

没有 Registry 配置时行为与现有内置安装一致。配置 Registry 后，未指定版本的普通扩展需要成功获取完整远端版本事实，才能在内置与 Nexus 候选中选择最高兼容稳定版本；网络失败不得静默降级为旧内置版本。

### D3: upgrade 是显式的已安装扩展协调命令

```yaml
command: extension upgrade
workspace: required
config: [identity, language]
interaction: required
effects: planned-write
arguments:
  - name: name
    required: true
    variadic: true
options:
  yes: boolean
  offline: boolean
writes:
  - selected extension activation artifacts/state
verification:
  - each selected extension was installed before planning
  - final installed version/digest equals frozen target
rollback:
  - each failed extension restores its prior activation
```

upgrade 按请求顺序最佳努力处理，只接受已安装普通扩展，不处理系统扩展。已是最高版本时返回 skipped/current。首版 upgrade 不接受 `--version`；需要精确迁移时使用 `extension install <name> --version <exact>`，避免两个命令形成重复版本语义。

### D4: Provider 合并按身份和摘要而不是静默优先级

普通扩展 catalog 合并 builtin、Nexus metadata 和 Store cache：

- 相同 `id@version@packageSha256` 去重；
- 相同 `id@version` 不同 digest 稳定失败；
- 默认排除 prerelease、deprecated 和不受支持 Extension Spec；
- 系统扩展只查看 builtin Provider；
- Workspace activation 永远保存精确版本与 digest。

运输 envelope 中的 Extension Spec 只用于预筛选；候选下载后仍需 phase-07 验证才能进入安装计划。

### D5: 离线必须显式且不能伪装 latest

`--offline` 禁止任何 Registry 请求，只允许 builtin 与已验证 Store 包。未指定版本时可以从这些本地事实选择最高兼容稳定版本，但结果明确标记 resolution scope 为 `local-only`，不得声称是 Registry 最新版本。精确 `--version` 可直接复用匹配 Store 包。

运行时按 activation 精确解析 Store 的既有离线行为不变。

### D6: 搜索与详情使用稳定结果模型

`extension search` JSON data 返回 query、registry identity、ordered items、continuation/limit 信息和兼容性摘要；不返回凭证或原始 Nexus payload。`extension info` 返回包身份、description、可见版本、最高默认候选、deprecated 信息和来源，不下载或执行扩展代码。

安装/升级批次沿用 ordered per-target result 和 counts；新增 source、requestedVersion、resolvedVersion、packageSha256、offline 字段。任何 target 失败使独立命令顶层 `ok: false`，但保留其他 target 完整结果。

## Risks / Trade-offs

- [配置 Registry 后网络故障影响无版本 install] → 明确失败并提供 `--offline`，不以旧包冒充最新。
- [搜索结果无法判断真实兼容性] → 标记 metadata-level compatibility，安装前再下载并执行权威验证。
- [install 选项对批量命令产生歧义] → `--version`/`--allow-deprecated` 限制单目标，parser/handler 在任何写入前拒绝组合。
- [新增 upgrade 与 install 功能重叠] → upgrade 只表达“已安装集合到默认最高版本”，精确版本仍归 install。
- [远端读取与 planned-write 混合难以回滚] → 下载/Store 导入发生在 Workspace 事务前；Store 可保留无引用缓存，Workspace 失败只回滚 activation。

## Migration Plan

1. 注册 search/info/upgrade 合同及 install 新选项，先补 parser/help/completion 测试。
2. 实现 read-only discovery handlers 和稳定 JSON/text 输出。
3. 抽象 catalog merge/version resolver，覆盖冲突、deprecated、prerelease 和 offline。
4. 将远端 candidate preparation 接入现有 install 计划与确认，不改变 apply transaction。
5. 实现 upgrade 为 installed selection 上的同一计划/批处理编排。
6. 更新中英文文档，并用真实 parser 验证全部命令示例。
7. 回滚时移除新命令和选项；既有 activation、Store 包与 uninstall/runtime 继续有效。

## Open Questions

- 搜索首版是否需要公开 `--limit`/`--page-token`；默认建议先内部分页并设置固定上限，避免暴露 Nexus continuation token。
- 是否在后续 Change 让交互式 init 显示远端扩展；本 Change 明确不做。
