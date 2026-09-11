## MODIFIED Requirements

### Requirement: 现有项目 CLI 语义保持不变

Project add, remove, list, show, verify, permission synchronization, and branch commands SHALL retain their existing arguments, confirmation policy, result shape, and logical behavior while reading and writing the referenced project file. `project add` SHALL additionally accept an explicit `--stdin` batch input mode without changing the behavior of its existing path, `--project-file`, or `--projects-file` input modes.

#### Scenario: 项目新增只更新项目文件

- **WHEN** a confirmed `project add` adds a non-conflicting project
- **THEN** the project appears in the referenced project file, `config.yaml` keeps the same reference, and the existing postcondition and permission verification run

#### Scenario: 从 stdin 批量新增项目

- **WHEN** `project add --stdin --yes --json` receives a valid schema-version-1 batch JSON document on stdin
- **THEN** the command validates and adds every non-conflicting project through the existing confirmation, permission planning, transaction, verification, and rollback contract

#### Scenario: stdin 输入模式互斥

- **WHEN** `project add --stdin` is combined with a positional path, `--project-file`, or `--projects-file`
- **THEN** the command fails with `PROJECT_INPUT_MODE_CONFLICT` before reading stdin or changing any file

#### Scenario: stdin 非交互确认

- **WHEN** `project add --stdin` is invoked without `--yes`
- **THEN** the command fails with `CLI_CONFIRMATION_REQUIRED` before consuming stdin or changing any file

#### Scenario: 空或超限 stdin

- **WHEN** stdin is empty or exceeds the supported input size limit
- **THEN** the command fails with `PROJECT_INPUT_EMPTY` or `PROJECT_INPUT_TOO_LARGE` respectively and does not change any file

#### Scenario: 非法 stdin JSON

- **WHEN** stdin cannot be parsed as JSON or does not contain a valid non-empty project batch
- **THEN** the command fails with the existing stable project input diagnostic and does not change any file

#### Scenario: 项目删除仍然删除记录

- **WHEN** a confirmed `project remove` removes a registered project
- **THEN** the project is removed from the referenced project file and the existing permission revoke behavior is preserved

#### Scenario: 分支更新写入项目文件

- **WHEN** `project branch accept-actual` successfully updates a registered branch
- **THEN** only the matching record in the referenced project file changes, with stale-plan detection and postcondition verification preserved
