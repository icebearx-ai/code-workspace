# Extension Execution Protocol Specification

## Purpose

定义可信内置扩展从静态包冻结、隔离准备、staging 验证到 installed manifest 生命周期管理的通用协议，并约束 Host 与扩展之间的职责边界。

## Requirements

### Requirement: Host 验证并冻结静态扩展包
Host SHALL 只执行符合静态 manifest v2 的可信内置扩展。静态 manifest SHALL 在执行前声明身份、兼容范围、入口、超时、声明性能力和最大输出范围。Host SHALL 在规划时冻结 manifest、入口和完整扩展版本目录摘要，并在执行前重新验证。

#### Scenario: 扩展包在确认后未变化
- **WHEN** 当前 manifest、入口和扩展目录摘要均与冻结计划相同
- **THEN** Host 可以在获取 Workspace 锁后执行扩展入口

#### Scenario: 辅助文件在确认后变化
- **WHEN** manifest 或入口未变，但扩展使用的模板、私有元数据或辅助代码发生变化
- **THEN** Host 以稳定 stale-plan 错误停止且不执行扩展或写入 Workspace

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
Host SHALL 只在候选制品、共享 contribution、状态和完整后置条件全部成功后保存安装成功。幂等和升级 SHALL 同时验证 installed manifest 与真实 Workspace；卸载 SHALL 只依赖 installed manifest，MUST NOT 执行扩展入口。

#### Scenario: 状态存在但制品漂移
- **WHEN** installed manifest 记录成功但当前文件、目录或 contribution 与记录不一致
- **THEN** Host 不得报告 already current，并在写入或删除前报告本地修改

#### Scenario: 升级删除旧输出
- **WHEN** 新版本不再声明旧版本拥有且未被修改的输出
- **THEN** Host 在同一扩展事务中移除旧输出、安装新输出并更新状态

#### Scenario: 卸载时扩展包已不存在
- **WHEN** installed manifest 有效但当前 npm 包已不包含对应扩展版本
- **THEN** Host 仍能验证并卸载记录的输出，且不执行任何扩展代码

### Requirement: 扩展执行模型不被描述为安全沙箱
系统文档 SHALL 明确基础版只执行可信扩展，子进程隔离不是安全沙箱。声明的网络 host SHALL 用于计划、确认和诊断；在没有 OS 级 enforcement 时，系统 MUST NOT 声称能够阻止扩展访问其他网络或用户资源。

#### Scenario: 扩展声明网络访问
- **WHEN** 静态 manifest 声明一个或多个 HTTPS host
- **THEN** 安装计划和确认信息在执行前展示该外部访问意图
