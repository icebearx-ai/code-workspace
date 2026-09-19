## MODIFIED Requirements

### Requirement: 发现内置扩展并解析兼容版本
系统 SHALL 只从包内 `extensions/` 发现系统扩展；普通扩展 SHALL 不再从包内目录发现，而是从 Nexus metadata 与已验证 Extension Store 合并候选。系统扩展和普通扩展均 SHALL 跳过不受 Host 支持的 Extension Spec，并冻结 manifest、入口及完整扩展版本目录摘要。

#### Scenario: 系统扩展从新位置发现
- **WHEN** 系统扩展位于 `extensions/codew-workspace-guard/<version>/`
- **THEN** Host 选择最高受支持版本并将其标记为 system

#### Scenario: 普通扩展不使用包内来源
- **WHEN** 包内不存在普通扩展目录且 Nexus 提供普通扩展
- **THEN** Host 从 Nexus/Store 解析普通扩展，不报告普通 builtin 缺失错误

### Requirement: init 提供明确的扩展选择语义
交互式 `init` SHALL 只选择 Nexus/Store 中的普通扩展，系统扩展 SHALL 自动加入计划并隐藏在普通选择列表中。未选择的普通已安装扩展 SHALL 保持不变。

#### Scenario: init 自动加入系统扩展
- **WHEN** 用户完成交互式 init 且未选择任何普通扩展
- **THEN** 系统扩展仍被请求并执行，普通扩展不被隐式安装

#### Scenario: none 不影响系统扩展
- **WHEN** 用户使用 `--extensions none`
- **THEN** 普通扩展不执行卸载或安装，系统扩展生命周期仍按系统策略处理
