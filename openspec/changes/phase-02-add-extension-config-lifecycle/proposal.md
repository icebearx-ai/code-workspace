## Why

扩展配置目前没有独立生命周期。若扩展把配置写入核心 `config.yaml`，核心将被迫理解扩展业务字段，并让无关扩展的配置错误影响核心命令。用户也需要可修改、升级不丢失、卸载可保留的扩展配置。

## What Changes

- 定义通用扩展配置文件契约，由扩展声明文件名、默认值和可选的初始化内容。
- Host 负责安全的文件路径、创建、事务边界和保留策略；扩展负责配置 schema、校验和业务解释。
- 新安装可生成默认配置；升级默认保留用户修改；卸载默认保留配置和运行期用户数据。
- 扩展配置损坏或缺失不得阻断不依赖该扩展的核心命令。
- 使用独立测试扩展覆盖创建、升级、卸载、损坏配置和故障隔离，本阶段不引入 Monitor 专用迁移。

## Capabilities

### New Capabilities

- `extension-config-lifecycle`: 扩展专属配置文件的声明、创建、读取边界、升级保留、卸载保留和故障隔离。

### Modified Capabilities

- `extension-execution-protocol`: Manifest 和安装生命周期增加通用配置文件能力。

## Impact

影响扩展 manifest/schema、扩展安装与卸载计划、配置文件事务、Doctor/诊断边界及相关测试。不修改核心 `config.yaml` 的现有业务域，也不迁移任何 Monitor 配置。
