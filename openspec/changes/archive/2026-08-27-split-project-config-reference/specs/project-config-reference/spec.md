## ADDED Requirements

### Requirement: 主配置必须引用独立项目配置

Code Workspace SHALL require `.code-workspace/config.yaml` to contain `projects.ref: config-projects.yaml` and SHALL use that file as the only project registry source.

#### Scenario: 初始化生成拆分配置

- **WHEN** a workspace is initialized successfully
- **THEN** `.code-workspace/config.yaml` contains the `projects.ref` object and `.code-workspace/config-projects.yaml` exists with `schemaVersion: 1` and an empty `projects` array

#### Scenario: 内联项目配置被拒绝

- **WHEN** a configuration contains `projects` as an array or omits the required reference
- **THEN** configuration loading fails with a stable project-reference diagnostic and does not infer or merge a project source

#### Scenario: 引用文件无效

- **WHEN** `projects.ref` is missing, names a different file, escapes the workspace directory, is a URL, or resolves to a missing/non-regular file
- **THEN** configuration loading fails with a diagnostic containing the main configuration file, referenced path, and remediation

### Requirement: 项目配置文件必须使用独立版本和现有项目记录

The referenced `config-projects.yaml` SHALL be a YAML object with `schemaVersion: 1` and an array-valued `projects` member; each active record SHALL preserve the existing non-empty `name`, `location`, `branch`, `type`, and `context` fields.

#### Scenario: 合法项目配置被解析

- **WHEN** the referenced file contains the required version and projects array
- **THEN** configuration projections expose the same normalized `config.projects` array currently consumed by project commands

#### Scenario: 项目配置格式错误

- **WHEN** the referenced file cannot be parsed, has an unsupported version, or its `projects` member is not an array
- **THEN** the projects configuration domain is invalid with a stable diagnostic tied to the referenced file

### Requirement: 现有项目 CLI 语义保持不变

Project add, remove, list, show, verify, permission synchronization, and branch commands SHALL retain their existing arguments, confirmation policy, result shape, and logical behavior while reading and writing the referenced project file.

#### Scenario: 项目新增只更新项目文件

- **WHEN** a confirmed `project add` adds a non-conflicting project
- **THEN** the project appears in `config-projects.yaml`, `config.yaml` keeps the same reference, and the existing postcondition and permission verification run

#### Scenario: 项目删除仍然删除记录

- **WHEN** a confirmed `project remove` removes a registered project
- **THEN** the project is removed from `config-projects.yaml` and the existing permission revoke behavior is preserved

#### Scenario: 分支更新写入项目文件

- **WHEN** `project branch accept-actual` successfully updates a registered branch
- **THEN** only the matching record in `config-projects.yaml` changes, with stale-plan detection and postcondition verification preserved

### Requirement: 跨文件写入必须具备事务和验证

Any project configuration mutation SHALL snapshot and restore every configuration file it can change, apply the existing permission transaction, verify the persisted logical project array, and commit only after all postconditions pass.

#### Scenario: 项目文件写入失败时回滚

- **WHEN** a project configuration or permission stage fails after mutation begins
- **THEN** the previous `config.yaml`, `config-projects.yaml`, and permission files are restored and the result reports the stable update failure

#### Scenario: 并发修改被拒绝

- **WHEN** the referenced project file changes after a project mutation plan is prepared
- **THEN** the operation fails with stale-plan/conflict diagnostics and does not overwrite the newer project configuration

### Requirement: 文档必须说明唯一的拆分格式

README.md SHALL document the split configuration format with examples of both `config.yaml` and `config-projects.yaml`, state that split mode is mandatory, and state that inline project arrays are unsupported.

#### Scenario: 用户可按文档创建配置

- **WHEN** a user reads the project configuration section in README.md
- **THEN** the document shows the exact `projects.ref: config-projects.yaml` syntax, the external file schema, and the file location constraints
