# Extension Execution Protocol Specification

## Purpose

定义可信内置扩展从静态包冻结、隔离准备、staging 验证到 installed manifest 生命周期管理的通用协议，并约束 Host 与扩展之间的职责边界。

## Requirements

### Requirement: Extension Spec 作为完整兼容边界
Code Workspace SHALL 发布离散编号的 Extension Spec。每个规范版本 MUST 固定 manifest、init context、init result、能力和输出语义以及安装、升级、验证和卸载规则的完整集合。Host SHALL 明确列出自己实现的规范版本，扩展 SHALL 声明唯一 `extensionSpecVersion`；兼容性 MUST 仅由该版本是否属于 Host 支持集合决定，不得依赖 Code Workspace 产品版本。

#### Scenario: 产品版本升级但规范不变
- **WHEN** Code Workspace 发布新产品版本且支持的 Extension Spec 集合未变化
- **THEN** 基于受支持规范实现的扩展无需修改 manifest 兼容声明

#### Scenario: 发布新规范版本
- **WHEN** manifest、context/result、输出或生命周期出现不向后兼容的机器可观察变化
- **THEN** 系统发布新的 Extension Spec 版本，Host 显式增加支持，旧规范实现不得通过数值范围被推测为兼容

### Requirement: 规范性制品与说明性文档分离
Code Workspace SHALL 在独立的 `spec/extension/<version>/` 目录发布每个 Extension Spec 的中英文规范定义，并随包发布其引用的 JSON Schema。中英文文件 SHALL 提供双向语言链接、共享相同规范版本和对应章节结构；语言差异 MUST NOT 形成两个兼容性事实来源。`docs/` SHALL 只提供说明、架构背景和非规范性示例，MUST NOT 成为扩展一致性或兼容性判断的事实来源。同一 schema MUST NOT 通过复制形成多个规范性事实来源。

#### Scenario: 发布 Extension Spec v1 规范
- **WHEN** 执行 npm 包内容检查
- **THEN** 包中包含 `spec/extension/v1/specification.zh-CN.md`、`spec/extension/v1/specification.en-US.md` 和该规范引用的 `schemas/extension-*.json`

#### Scenario: 在中英文规范之间切换
- **WHEN** 开发者打开任一 Spec v1 语言文件
- **THEN** 文件顶部提供指向另一语言版本的相对链接，且两版声明相同的 Extension Spec 版本

#### Scenario: 说明文档引用规范
- **WHEN** 开发者从 `docs/` 阅读扩展使用或架构说明
- **THEN** 文档指向版本化规范目录，且不声明另一套兼容性或生命周期规则

### Requirement: Host 验证并冻结静态扩展包
Host SHALL 只执行符合受支持 Extension Spec 的可信内置扩展。静态 manifest SHALL 使用对应规范固定的 schema，并在执行前声明规范版本、身份、入口、超时、声明性能力和最大输出范围。Host SHALL 在规划时冻结 manifest、入口和完整扩展版本目录摘要，并在执行前重新验证。

#### Scenario: 扩展包在确认后未变化
- **WHEN** 当前 manifest、入口和扩展目录摘要均与冻结计划相同，且 manifest 的规范版本仍受 Host 支持
- **THEN** Host 可以在获取 Workspace 锁后执行扩展入口

#### Scenario: 辅助文件在确认后变化
- **WHEN** manifest 或入口未变，但扩展使用的模板、私有元数据或辅助代码发生变化
- **THEN** Host 以稳定 stale-plan 错误停止且不执行扩展或写入 Workspace

#### Scenario: 未知规范版本
- **WHEN** 扩展版本声明的 `extensionSpecVersion` 不属于 Host 支持集合
- **THEN** Host 只读取稳定发现 envelope，不解释入口、能力或输出，也不执行扩展代码

### Requirement: 扩展只返回静态范围内的实际输出
Host SHALL 为扩展创建独立 context、staging 和 result 临时路径，并以固定参数执行入口。Host SHALL 先根据工具选择确定本次适用输出；初始化 result SHALL 只包含扩展身份和 `{id, source}` 输出列表，并 MUST 恰好返回全部适用输出。

#### Scenario: 工具选择产生输出子集
- **WHEN** manifest 为 Codex 和 Claude 分别声明输出且本次只选择 Codex
- **THEN** 本次适用集合只包含运行目录和 Codex 输出，result 必须完整返回二者且 Host 不要求不适用的 Claude 输出

#### Scenario: 扩展执行后扩大目标
- **WHEN** result 引用未知输出 id、重复 id 或试图重新声明 target、kind、ownership 或 selector
- **THEN** Host 拒绝结果且真实 Workspace 无制品写入

#### Scenario: 扩展异常退出
- **WHEN** 入口超时、非零退出、缺少 result 或 result 无法解析
- **THEN** Host 清理临时路径并报告对应扩展失败，不保存成功状态

### Requirement: Host 独立验证 staging 和安装摘要
Host SHALL 规范化每个 result source，拒绝路径逃逸，并递归枚举 staging。Host SHALL 拒绝未声明的额外输出、缺失输出、符号链接和非普通文件/目录。文件和目录 installed 摘要 MUST 由 Host 根据 staging 实际内容计算，不得直接采用扩展报告值。

#### Scenario: 扩展生成声明目录
- **WHEN** result source 指向 staging 内只包含普通文件和目录的声明目录
- **THEN** Host 计算规范目录摘要并将其作为候选 installed 事实

#### Scenario: staging 包含额外顶层输出
- **WHEN** staging 中存在未被任何 result source 覆盖的文件或目录
- **THEN** Host 以稳定未声明输出错误拒绝安装

#### Scenario: staging 包含符号链接或特殊文件
- **WHEN** 任一候选输出树包含符号链接、设备、socket 或 FIFO
- **THEN** Host 拒绝安装且不向真实 Workspace提交内容

### Requirement: Host 只支持具有完整生命周期的基础输出
公共扩展协议 SHALL 支持独占 `file`、独占 `directory`、共享 `text-block` 和共享 `json-member`。每种输出 SHALL 具有确定的冲突、提交、摘要、升级、漂移检查和卸载语义。公共 schema MUST NOT 包含 Jira、MCP、npm、归档格式或下载实现字段。

#### Scenario: 新扩展复用基础输出
- **WHEN** 新内置扩展只声明已有四种输出和已有能力
- **THEN** 发布该扩展不需要修改核心 artifact 分支或公共 schema

#### Scenario: 未知输出类型
- **WHEN** manifest 声明 Host 不支持的输出 kind
- **THEN** 扩展发现以稳定兼容或 manifest 错误安全失败

### Requirement: installed manifest 是生命周期事实来源
Host SHALL 只在候选制品、共享 contribution、状态和完整后置条件全部成功后保存安装成功。新 installed 事实 SHALL 记录安装时的 Extension Spec 版本；幂等和升级 SHALL 同时验证 installed manifest 与真实 Workspace；卸载 SHALL 只依赖 installed manifest，MUST NOT 执行扩展入口或要求当前 Host 支持该执行规范。

#### Scenario: 状态存在但制品漂移
- **WHEN** installed manifest 记录成功但当前文件、目录或 contribution 与记录不一致
- **THEN** Host 不得报告 already current，并在写入或删除前报告本地修改

#### Scenario: 升级删除旧输出
- **WHEN** 新版本不再声明旧版本拥有且未被修改的输出
- **THEN** Host 在同一扩展事务中移除旧输出、安装新输出并更新规范版本和状态

#### Scenario: 卸载时扩展包或执行规范已不存在
- **WHEN** installed manifest 有效，但当前 npm 包已不包含对应扩展版本或 Host 已不再支持其执行规范
- **THEN** Host 仍能验证并卸载记录的输出，且不执行任何扩展代码

### Requirement: 扩展执行模型不被描述为安全沙箱
系统文档 SHALL 明确基础版只执行可信扩展，子进程隔离不是安全沙箱。声明的网络 host SHALL 用于计划、确认和诊断；在没有 OS 级 enforcement 时，系统 MUST NOT 声称能够阻止扩展访问其他网络或用户资源。

#### Scenario: 扩展声明网络访问
- **WHEN** 静态 manifest 声明一个或多个 HTTPS host
- **THEN** 安装计划和确认信息在执行前展示该外部访问意图
