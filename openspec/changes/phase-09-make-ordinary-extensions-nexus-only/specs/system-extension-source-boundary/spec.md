## ADDED Requirements

### Requirement: 移动后的系统扩展仍由 Host 管理
系统 SHALL 从包内 `extensions/` 根目录识别显式系统扩展 ID，并将其标记为 `system: true`；系统扩展不得依赖 `.system` 子目录存在。

#### Scenario: 识别移动后的 Workspace Guard
- **WHEN** `extensions/codew-workspace-guard/<version>/manifest.json` 存在
- **THEN** 系统发现结果包含该扩展并标记为系统扩展，普通发现结果不包含它

### Requirement: 系统扩展保持保护和自动生命周期
系统扩展 SHALL 继续使用受保护目标校验，由 `init` 自动请求，并且普通 extension install/uninstall/upgrade 命令 SHALL 拒绝手动管理。

#### Scenario: Nexus 出现系统同名包
- **WHEN** Nexus 返回与系统扩展 ID 相同的包
- **THEN** Host 忽略该远端候选，仍使用包内系统扩展

#### Scenario: 手动管理系统扩展
- **WHEN** 用户执行普通扩展 install、uninstall 或 upgrade 请求系统扩展
- **THEN** 命令在任何 Workspace 写入前返回 `EXTENSION_SYSTEM_MANAGED`

### Requirement: 普通扩展不再从包内目录解析
普通扩展 SHALL 不从包内扩展目录生成安装或运行时候选；普通扩展候选只能来自 Nexus 或已验证 Extension Store。

#### Scenario: 包内只剩系统扩展
- **WHEN** 普通目录为空且 Nexus 未配置
- **THEN** 普通扩展选择返回无可用候选或稳定 Registry 未配置诊断，不尝试读取系统扩展目录作为普通候选
