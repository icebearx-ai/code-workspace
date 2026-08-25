## ADDED Requirements

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

## MODIFIED Requirements

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
