# OpenSpec Workspace 发布包 CLI 真实环境手工验收用例

本文用于在 npm 包发布后，使用 registry 中的真实发布包、真实全局安装路径以及机器上真实的 Node.js、npm、Git 和 OpenSpec 环境，对全部 CLI 契约进行一次完整黑盒验收。覆盖 19 条注册命令路径、3 个全局选项、文本/JSON 输出、交互确认、旧配置兼容、文件副作用和常见失败边界。

测试过程中不得从源码目录执行 `node bin/openspec-workspace.js`，不得使用 `npm install <本地源码路径>`，也不得临时覆盖 npm cache、prefix 或 PATH 来绕过实际部署环境。命令清单以发布包中的 CLI registry 为准。执行结果与本文不一致时，应记录实际退出码、stdout、stderr、诊断 code 和文件差异，不要直接修改预期结果来迁就当前实现。

## 1. 测试范围与通过标准

优先级约定：

- P0：发布阻断；参数语义、数据安全、输出协议或核心命令失败。
- P1：主要功能、兼容性和诊断质量。
- P2：交互体验、帮助、补全和观察项。

所有 JSON 用例都必须满足：

- stdout 只有一个合法 JSON 文档，stderr 为空。
- 顶层字段固定为 `schemaVersion`、`ok`、`command`、`data`、`diagnostics`。
- `schemaVersion` 为 `1`。
- 成功时退出码为 `0`、`ok` 为 `true`。
- 失败时退出码非 `0`、`ok` 为 `false`，且至少有一个稳定诊断 code。
- warning 进入 `diagnostics`，不能额外污染 stderr。

所有文本用例都必须满足：

- 正常结果写 stdout。
- warning 和 error 写 stderr。
- error 尽可能包含稳定 code 对应的清晰消息和 remediation。
- 只读命令不得修改工作区文件。
- 写命令失败后，检查配置、state、权限文件和受管文件是否保持原状；无法回滚的外部效果必须被明确报告。

## 2. 环境准备

“真实环境”指真实操作系统、真实用户权限、真实 npm registry、真实全局安装目录以及真实 OpenSpec/Git 命令。它不意味着可以在业务工作区中执行破坏性测试。

测试分为两层：

- 真实业务工作区：只执行明确标记为只读的冒烟命令。
- 专用验收工作区：在同一台真实机器上创建，用于 init、update、project、sync、故障和兼容性测试。

禁止在业务工作区执行 `init`、`update`、`project add/remove`、`sync`、`--force`、配置破坏、文件删除或旧版本迁移测试。

前置条件：

- Node.js `>=20.19.0`
- npm
- Git
- OpenSpec `1.5.0`
- `curl`
- 推荐安装 `jq`
- 至少两个空闲的本地端口，例如 `43211`、`43212`
- 当前 npm 用户具备实际部署所需的全局安装权限；不要为了测试临时使用不同的 sudo/npm prefix 策略

### 2.1 记录安装前的真实环境

```sh
export PACKAGE_NAME="@icebearx-ai/openspec-workspace"
# 必须改成刚刚发布到 registry 的精确版本，禁止使用 latest 代替。
export RELEASE_VERSION="0.1.0-beta.10"
export TEST_BASE="$(mktemp -d "${TMPDIR:-/tmp}/openspec-workspace-release.XXXXXX")"

date
uname -a
node --version
npm --version
git --version
openspec --version
npm config get registry
npm config get prefix
npm root -g
command -v node
command -v npm
command -v openspec || true
command -v openspec-workspace || true
command -v openspec-w || true
npm list -g "$PACKAGE_NAME" --depth=0 || true
```

将安装前已经存在的 OpenSpec Workspace 版本和 bin 路径记录到测试报告。测试结束后若需要恢复旧版本，必须使用这里记录的精确版本。

### 2.2 从真实 registry 安装精确发布版本

```sh
npm view "$PACKAGE_NAME@$RELEASE_VERSION" \
  name version dist.tarball dist.integrity engines bin

npm install -g "$PACKAGE_NAME@$RELEASE_VERSION"
hash -r

command -v openspec-workspace
command -v openspec-w
npm list -g "$PACKAGE_NAME" --depth=0
openspec-workspace version
openspec-w version
```

预期：

- `npm view` 返回的版本与 `RELEASE_VERSION` 完全相同。
- 安装来源是配置中的真实 registry，而不是源码路径或本地 tarball。
- 两个 bin 都能从实际全局 prefix 解析。
- 两个 bin 输出的版本都与 `RELEASE_VERSION` 完全相同。
- npm 安装过程中没有 checksum、权限、缺文件或 engine 警告。

### 2.3 验证实际安装包内容

```sh
export GLOBAL_NPM_ROOT="$(npm root -g)"
export INSTALLED_PACKAGE_ROOT="$GLOBAL_NPM_ROOT/@icebearx-ai/openspec-workspace"

node - "$INSTALLED_PACKAGE_ROOT" "$RELEASE_VERSION" <<'NODE'
const fs = require("node:fs");
const path = require("node:path");
const root = process.argv[2];
const expectedVersion = process.argv[3];
const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
if (pkg.version !== expectedVersion) throw new Error(`installed=${pkg.version}, expected=${expectedVersion}`);
for (const target of [
  "bin/openspec-workspace.js",
  "src/cli.js",
  "src/cli/registry.js",
  "src/core/config.js",
  "src/core/transaction.js",
  "artifacts/manifest.json",
  "artifacts/templates/codex/skills/openspec-workspace-add-projects/SKILL.md",
  "README.md",
  "README.zh-CN.md",
]) {
  if (!fs.existsSync(path.join(root, target))) throw new Error(`missing packaged file: ${target}`);
}
console.log(JSON.stringify({ name: pkg.name, version: pkg.version, bin: pkg.bin }, null, 2));
NODE

cd "$TEST_BASE"
openspec-w help
openspec-w version --json
```

预期：从源码仓库之外的 cwd 仍能加载所有运行时依赖和资产；不能依赖未打包的源码文件。

### 2.4 发布包安装专项用例

| ID | P | 操作 | 预期 |
|---|---:|---|---|
| CLI-RLS-001 | P0 | 查询 `npm view "$PACKAGE_NAME@$RELEASE_VERSION"` | registry 中精确版本存在；name、engines、bin、integrity 正确。 |
| CLI-RLS-002 | P0 | 按实际部署方式执行全局安装 | 安装成功；不需要临时切换 registry、cache、prefix 或用户。 |
| CLI-RLS-003 | P0 | 检查两个 `command -v` 和两个 version 命令 | 两个 bin 都来自全局 prefix，版本完全一致。 |
| CLI-RLS-004 | P0 | 在源码目录之外执行 help/version | 不依赖当前仓库、开发依赖或未打包文件。 |
| CLI-RLS-005 | P0 | 执行上面的安装包内容检查脚本 | 所有运行时、manifest、模板、Skill、README 均实际存在。 |
| CLI-RLS-006 | P0 | 在真实用户权限下首次运行 CLI | 无 EACCES、root-owned cache、模块解析或 executable bit 问题。 |
| CLI-RLS-007 | P1 | 对相同精确版本再次执行 `npm install -g` | 重装成功；bin 和版本保持一致。 |
| CLI-RLS-008 | P0 | 先用上一发布版本初始化专用工作区，再升级全局包到本版本并运行 update/doctor | UUID、项目、语言、工具选择保留；迁移明确；Doctor 健康。 |
| CLI-RLS-009 | P1 | 若发布流程要求，卸载本版本并重新安装 | 卸载后两个 bin 都不可用；重装后恢复；不得遗留指向旧包的坏链接。 |
| CLI-RLS-010 | P1 | 比较 registry metadata、CLI version、已安装 package.json | 三处版本完全一致。 |

`CLI-RLS-008` 在完成 2.6 和 2.7 的 Git 项目夹具后执行。跨版本升级使用单独工作区，示例流程如下：

```sh
export PREVIOUS_VERSION="<上一发布版本>"
export UPGRADE_WS="$TEST_BASE/workspace-upgrade"

npm install -g "$PACKAGE_NAME@$PREVIOUS_VERSION"
hash -r
openspec-w version

# 使用上一版本真实支持的命令初始化，并保留语言、工具和一个项目记录。
openspec-w init "$UPGRADE_WS" --tools codex --language en-US --yes --json
cd "$UPGRADE_WS"
openspec-w project add "$PROJECT_A" \
  --name frontend-app \
  --spec-prefix frontend-app \
  --type frontend \
  --context-file "$TEST_BASE/frontend-context.txt" \
  --yes \
  --json

cp "$UPGRADE_WS/.openspec-workspace/config.yaml" "$TEST_BASE/upgrade-before-config.yaml"
cp "$UPGRADE_WS/.openspec-workspace/state.json" "$TEST_BASE/upgrade-before-state.json"

npm install -g "$PACKAGE_NAME@$RELEASE_VERSION"
hash -r
cd "$UPGRADE_WS"
openspec-w update --json
openspec-w project list --json
openspec-w language --json
openspec-w doctor --json
```

升级前后需要人工比较 workspace UUID、projects、language、tools 和用户自定义内容；允许的 Schema 迁移必须出现在 migration 结果中。

### 2.5 真实业务工作区只读冒烟

如需验证现有业务工作区，只执行下面的只读命令。先记录工作区文件 hash 或 Git 状态，执行后确认没有变化。

```sh
export REAL_WORKSPACE="/absolute/path/to/existing-workspace"
cd "$REAL_WORKSPACE"

openspec-w language --json
openspec-w project list --json
openspec-w project verify --json
openspec-w context --json
openspec-w validate --json
openspec-w doctor --json
```

这些命令可以如实报告业务工作区已有问题，不要求全部 `ok=true`；验收重点是没有崩溃、没有隐式写入、输出符合协议、诊断与实际状态一致。

### 2.6 创建专用验收路径和 Git 项目

以下目录位于真实机器的临时区，但所有 Node/npm/OpenSpec/Git 命令、权限和网络环境都是真实的。

```sh
export WS_ROOT="$TEST_BASE/workspace-main"
export PROJECT_A="$TEST_BASE/frontend-app"
export PROJECT_B="$TEST_BASE/backend-api"
export PROJECT_DASH="$TEST_BASE/-repository"

make_git_project() {
  local target="$1"
  local package_name="$2"
  mkdir -p "$target"
  git -C "$target" init -b main
  git -C "$target" config user.name "CLI Manual Test"
  git -C "$target" config user.email "cli-manual@example.invalid"
  printf '{"name":"%s","version":"1.0.0"}\n' "$package_name" > "$target/package.json"
  printf '# %s\n' "$package_name" > "$target/README.md"
  git -C "$target" add package.json README.md
  git -C "$target" commit -m "fixture"
}

make_git_project "$PROJECT_A" "frontend-app"
make_git_project "$PROJECT_B" "backend-api"
make_git_project "$PROJECT_DASH" "dash-repository"

printf '职责：前端应用。\n技术栈：React。\n代码定位：src。\n项目边界：浏览器端。\n' > "$TEST_BASE/frontend-context.txt"
```

### 2.7 创建项目输入文件

```sh
cat > "$TEST_BASE/frontend-project.json" <<EOF
{
  "schemaVersion": 1,
  "project": {
    "name": "frontend-app",
    "specPrefix": "frontend-app",
    "location": "$PROJECT_A",
    "branch": "main",
    "type": "frontend",
    "context": "职责：前端应用。技术栈：React。代码定位：src。项目边界：浏览器端。"
  }
}
EOF

cat > "$TEST_BASE/backend-projects.json" <<EOF
{
  "schemaVersion": 1,
  "projects": [
    {
      "name": "backend-api",
      "specPrefix": "backend-api",
      "location": "$PROJECT_B",
      "branch": "main",
      "type": "backend",
      "context": "职责：后端 API。技术栈：Node.js。代码定位：src。项目边界：服务端。"
    }
  ]
}
EOF
```

### 2.8 结果记录模板

每条用例至少记录以下内容：

执行时可直接把各表 ID 前标记为 `✅`、`❌` 或 `⏸`，分别表示 PASS、FAIL、BLOCKED；详细证据按下表记录。

| 字段 | 记录内容 |
|---|---|
| 用例 ID | 例如 `CLI-GEN-001` |
| 执行时间 | 本地时间 |
| 被测版本 | `openspec-w version` |
| 命令 | 完整命令和 cwd |
| 退出码 | `echo $?` |
| stdout/stderr | 原始输出或附件路径 |
| 文件差异 | `git diff --no-index`、hash 或人工检查结果 |
| 结果 | PASS / FAIL / BLOCKED |
| 缺陷编号 | 如有 |

### 2.9 用例隔离约定

除明确要求连续验证 CRUD 状态的用例外，凡是包含“修改、删除、破坏、制造冲突、切换工具或切换语言”的场景，都应先复制主工作区再执行：

```sh
export CASE_ROOT="$TEST_BASE/case-<case-id>"
cp -R "$WS_ROOT" "$CASE_ROOT"
cd "$CASE_ROOT"
```

每个用例使用全新的 `CASE_ROOT`。不要把破坏性用例产生的状态带入下一条用例；用例完成后回到 `$WS_ROOT`。

## 3. 全局参数、解析器、帮助和版本

| ID | P | 操作 | 预期 |
|---|---:|---|---|
| CLI-GEN-001 | P0 | 在非工作区运行 `openspec-w` | 退出码 0；显示完整帮助；不要求工作区。 |
| CLI-GEN-002 | P1 | `openspec-w help` | 退出码 0；列出全部注册命令、命令选项、语言和全局选项。 |
| CLI-GEN-003 | P1 | `openspec-w --help` | 与 `help` 等价。 |
| CLI-GEN-004 | P1 | `openspec-w project inspect --help` | 即使缺少必填 path 也返回帮助，退出码 0。 |
| CLI-GEN-005 | P0 | `openspec-w help --json` | 标准 JSON 信封；`command="help"`；`data.commands` 非空。 |
| CLI-GEN-006 | P1 | `openspec-w version`、`openspec-w --version` | 两者版本一致，退出码 0。 |
| CLI-GEN-007 | P1 | `openspec-w version --json` | `command="version"`；`data.version` 等于文本版本。 |
| CLI-GEN-008 | P0 | 比较 `openspec-workspace version` 与 `openspec-w version` | 两个 bin 别名行为一致。 |
| CLI-GEN-009 | P0 | 在非工作区运行 `openspec-w unknown --json` | 先报 `CLI_UNKNOWN_COMMAND`，不能报 `WORKSPACE_NOT_FOUND`；`command=null`。 |
| CLI-GEN-010 | P0 | 在非工作区运行 `openspec-w project list --json` | `WORKSPACE_NOT_FOUND`。 |
| CLI-GEN-011 | P0 | `openspec-w update --froce --json` | `CLI_UNKNOWN_OPTION`；`command="update"`；不能静默忽略。 |
| CLI-GEN-012 | P0 | `openspec-w project list unexpected --json` | `CLI_EXTRA_ARGUMENT`。 |
| CLI-GEN-013 | P0 | `openspec-w project list --json --json` | `CLI_DUPLICATE_OPTION`。 |
| CLI-GEN-014 | P0 | `openspec-w project list --json=false` | `CLI_INVALID_OPTION_VALUE`；仍以 JSON 输出该解析错误。 |
| CLI-GEN-015 | P0 | `openspec-w update --tools --json` | `CLI_OPTION_VALUE_REQUIRED`。 |
| CLI-GEN-016 | P0 | 分别执行 `openspec-w --json project inspect "$PROJECT_A"` 与 `openspec-w project inspect "$PROJECT_A" --json` | 两者均成功，`data.project.location` 一致。 |
| CLI-GEN-017 | P0 | `cd "$TEST_BASE"` 后执行 `openspec-w project inspect -- -repository --json` | 以 `-` 开头的路径被当作位置参数，不能当作选项。 |
| CLI-GEN-018 | P0 | 运行任意 JSON 失败命令并分别重定向 stdout/stderr | stdout 是唯一 JSON；stderr 为空；退出码非 0。 |

## 4. `init`

以下用例使用独立目标目录，避免彼此污染。

| ID | P | 操作 | 预期 |
|---|---:|---|---|
| CLI-INIT-001 | P1 | `openspec-w init "$TEST_BASE/init-cancel"`，在 wizard 最终确认时取消 | 输出取消信息；无 `.openspec-workspace`、受管文件或新建目标文件。 |
| CLI-INIT-002 | P0 | `openspec-w init "$TEST_BASE/init-interactive"`，完成 wizard，选择 en-US、Codex、关闭 Monitor | 成功；生成配置、state、OpenSpec 基线和 Codex 资产；配置值与选择一致。 |
| CLI-INIT-003 | P0 | `mkdir "$TEST_BASE/init-default" && cd "$TEST_BASE/init-default" && openspec-w init --tools none --language en-US --yes --json` | 默认目标为当前目录；`data.root` 为当前目录。 |
| CLI-INIT-004 | P0 | `openspec-w init --yes "$TEST_BASE/init-order-a" --tools none --language en-US --json` | `--yes` 不吞掉路径；目标目录正确。 |
| CLI-INIT-005 | P0 | `openspec-w init "$TEST_BASE/init-order-b" --yes --tools none --language en-US --json` | 与上一用例语义一致。 |
| CLI-INIT-006 | P0 | `openspec-w init "$TEST_BASE/init-no-confirm" --tools none --language en-US --json` | `CLI_CONFIRMATION_REQUIRED`；目标没有任何初始化文件。 |
| CLI-INIT-007 | P1 | `openspec-w init "$TEST_BASE/init-none" --tools none --language en-US --yes --json` | `data.tools.tools=[]`；不会安装 Claude/Codex 专属资产。 |
| CLI-INIT-008 | P1 | `openspec-w init "$TEST_BASE/init-claude" --tools claude --language en-US --yes --json` | 只安装 Claude 资产；state tools 为 `claude`。 |
| CLI-INIT-009 | P1 | `openspec-w init "$TEST_BASE/init-codex" --tools codex --monitor --monitor-url http://127.0.0.1:43211 --language zh-CN --yes --json` | 安装 Codex 资产和 hooks；Monitor 启用；语言为 zh-CN。 |
| CLI-INIT-010 | P1 | `openspec-w init "$TEST_BASE/init-no-monitor" --tools codex --no-monitor --language en-US --yes --json` | Monitor 禁用；不安装 monitor hook 资产。 |
| CLI-INIT-011 | P1 | `openspec-w init "$TEST_BASE/init-all" --tools all --language en-US --yes --json` | Claude 与 Codex 资产都存在；最终工具来源为 CLI。 |
| CLI-INIT-012 | P1 | 增加 `--workspace-name payments` | `config.yaml` 和 JSON 中名称均为 `payments`，UUID 合法且非空。 |
| CLI-INIT-013 | P0 | 使用 `--language fr-FR` | 失败；诊断为 `WORKSPACE_LANGUAGE_INVALID`；不提交工作区状态。 |
| CLI-INIT-014 | P0 | 使用 `--tools vscode` | `CLI_INVALID_TOOLS`，包含 supported tools。 |
| CLI-INIT-015 | P0 | 使用 `--monitor-url https://example.com:43211` | `MONITOR_CONFIG_INVALID`；只允许 HTTP loopback。 |
| CLI-INIT-016 | P1 | 使用不受支持的 `--openspec-version 9.9.9` | 非 0；说明受支持版本；不得安装未知版本。记录实际稳定 code。 |
| CLI-INIT-017 | P0 | 对已经成功初始化的目录重复执行相同 init | UUID 不变；受管文件应为 skip/current；Doctor 仍健康。 |
| CLI-INIT-018 | P0 | 修改一个受管文件后，不带 `--force` 重跑 init | 失败并保护本地修改；配置和其他受管文件不得部分更新。 |
| CLI-INIT-019 | P0 | 在上一用例目录加 `--force` 重跑 | 成功覆盖未知修改；Doctor 恢复健康。 |
| CLI-INIT-020 | P2 | 同时传 `--monitor --no-monitor` | 观察项：理想契约应拒绝互斥选项；记录当前实际行为并提交产品决策。 |
| CLI-INIT-021 | P1 | 将已初始化目录改为 schemaVersion 1、删除 `workspace.language`、在 state 写入 `workspaceLanguage`，再运行 `init --yes --json` | 成功迁移到当前 Schema；语言保留；旧 state 字段删除；JSON 包含 migration steps。 |
| CLI-INIT-022 | P1 | 对同样的旧目录运行交互式 init | 能进入 wizard 并完成迁移，不能在 wizard 前被严格配置加载阻断。 |

### 4.1 建立后续测试的主工作区

```sh
openspec-w init "$WS_ROOT" \
  --tools codex \
  --no-monitor \
  --workspace-name cli-manual \
  --language en-US \
  --yes \
  --json

cd "$WS_ROOT"
openspec-w doctor --json
```

预期：初始化和 Doctor 都成功。后续除非特别说明，cwd 均为 `$WS_ROOT`。

## 5. `update`

| ID | P | 操作 | 预期 |
|---|---:|---|---|
| CLI-UPD-001 | P0 | `openspec-w update --json` | 成功；标准信封；工具来自 `workspace-state`；无须 `--yes`。 |
| CLI-UPD-002 | P1 | 再次执行相同 update | 幂等；大部分 managedFiles 为 skip/current。 |
| CLI-UPD-003 | P0 | `openspec-w update --language zh-CN --json` | config 语言和派生的 OpenSpec context、USER_GUIDE 同步切换；项目 context 不改变。 |
| CLI-UPD-004 | P0 | `openspec-w update --tools claude --json` | state tools 改为 Claude；Codex 专属受管资产被清理；Claude 资产存在。 |
| CLI-UPD-005 | P0 | 再运行 `openspec-w update --json` | 延续 state 中的 Claude，不回退到 manifest 默认。 |
| CLI-UPD-006 | P0 | 修改受管文件后执行 update，不带 `--force` | `MANAGED_FILE_UNKNOWN`；配置、state 和其他资产不发生部分变化。 |
| CLI-UPD-007 | P0 | 对上一场景执行 `openspec-w update --force --json` | 成功覆盖未知受管修改；`forcedUnknown` 包含对应目标。 |
| CLI-UPD-008 | P1 | `openspec-w update --tools none --json` | state tools 为空；清理工具专属资产；工具中立资产保留。 |
| CLI-UPD-009 | P0 | `openspec-w update --tools vscode --json` | `CLI_INVALID_TOOLS`，无文件变化。 |
| CLI-UPD-010 | P0 | `openspec-w update --language fr-FR --json` | 稳定语言错误，无文件变化。 |
| CLI-UPD-011 | P1 | 在旧配置副本中删除 language，并提供一致的旧 state/OpenSpec language 后 update | 成功迁移；输出同时包含 Schema、language 和 state-cleanup 步骤。 |
| CLI-UPD-012 | P0 | 制造旧 state 与 OpenSpec context 语言冲突后 update | `WORKSPACE_LANGUAGE_CONFLICT`；提示显式 `--language`；配置和 state 原样保留。 |
| CLI-UPD-013 | P0 | 把 config schemaVersion 改为 `99` 后 update | `CONFIG_SCHEMA_VERSION_UNSUPPORTED`；不能重写未来版本配置。 |
| CLI-UPD-014 | P1 | 删除临时副本中的一个 OpenSpec 必需目录后 update | 执行上游准备；只有后置条件完整时成功；失败时报告可能保留的上游输出。 |

## 6. `language`

| ID | P | 操作 | 预期 |
|---|---:|---|---|
| CLI-LANG-001 | P0 | `openspec-w language` | stdout 只输出当前语言代码。 |
| CLI-LANG-002 | P0 | `openspec-w language --json` | `command="language"`；`data.language`、`data.label`、`data.projectContext` 存在。 |
| CLI-LANG-003 | P1 | 破坏无关的 `monitor.url` 后，在副本中运行 language | 仍成功，证明只加载 language 域。 |
| CLI-LANG-004 | P0 | 删除 `workspace.language` 后运行 language | `WORKSPACE_LANGUAGE_MISSING`，包含 config 文件路径和 remediation。 |
| CLI-LANG-005 | P0 | 写入非法语言后运行 language | `WORKSPACE_LANGUAGE_INVALID`，包含 actual 和 supported。 |
| CLI-LANG-006 | P1 | 在非工作区运行 language | `WORKSPACE_NOT_FOUND`。 |

## 7. `project inspect`

| ID | P | 操作 | 预期 |
|---|---:|---|---|
| CLI-PINS-001 | P0 | 在非工作区运行 `openspec-w project inspect "$PROJECT_A"` | 成功；不依赖工作区。 |
| CLI-PINS-002 | P0 | 加 `--json` | `command="project.inspect"`；`data.kind="project-inspection"`；包含 branch 和 facts。 |
| CLI-PINS-003 | P1 | 检查 `facts.manifestFiles`、`readmeFiles`、`topLevelEntries` | 包含 fixture 文件，不包含 `.git`。 |
| CLI-PINS-004 | P0 | 检查不存在路径 | `PROJECT_LOCATION_MISSING`。 |
| CLI-PINS-005 | P1 | 传普通文件路径 | `PROJECT_LOCATION_NOT_DIRECTORY`。 |
| CLI-PINS-006 | P0 | 传 Git 仓库子目录 | `PROJECT_LOCATION_NOT_WORKTREE_ROOT`。 |
| CLI-PINS-007 | P0 | 传非 Git 目录 | `GIT_COMMAND_FAILED`。 |
| CLI-PINS-008 | P1 | 在 detached HEAD 状态检查临时仓库 | 非 0；不能伪造 branch；记录诊断 code。 |
| CLI-PINS-009 | P0 | 从 `$TEST_BASE` 执行 `openspec-w project inspect -- -repository --json` | 正确识别以 `-` 开头的路径。 |

## 8. `project add`

执行本节前确认主工作区项目列表为空。

```sh
cd "$WS_ROOT"
openspec-w project list --json
```

| ID | P | 操作 | 预期 |
|---|---:|---|---|
| CLI-PADD-001 | P0 | 使用路径模式添加 A：`openspec-w project add "$PROJECT_A" --name frontend-app --spec-prefix frontend-app --type frontend --context-file "$TEST_BASE/frontend-context.txt" --yes --json` | 成功；config 新增完整记录；同步 `.codex/config.toml`。 |
| CLI-PADD-002 | P1 | 对完全相同的 A 重复执行上一命令 | 成功且 `data.action="skip"`；不重复写项目。 |
| CLI-PADD-003 | P0 | `openspec-w project add --project-file "$TEST_BASE/frontend-project.json" --yes --json` | 在空工作区副本中成功添加单条记录。 |
| CLI-PADD-004 | P0 | `openspec-w project add --projects-file "$TEST_BASE/backend-projects.json" --yes --json` | 主工作区成功批量添加 B。 |
| CLI-PADD-005 | P0 | JSON 模式去掉 `--yes` 添加新项目 | `CLI_CONFIRMATION_REQUIRED`；config 和权限文件 hash 不变。 |
| CLI-PADD-006 | P1 | 文本交互模式回答 `n` | `CLI_CANCELLED`；无写入。 |
| CLI-PADD-007 | P1 | 文本交互模式回答 `y` | 成功写入。 |
| CLI-PADD-008 | P0 | 路径模式省略 `--name` 或任一必填记录字段 | `PROJECT_INPUT_FIELD_REQUIRED`，指出具体字段。 |
| CLI-PADD-009 | P0 | 同时使用 `--context` 与 `--context-file` | `PROJECT_INPUT_MODE_CONFLICT`。 |
| CLI-PADD-010 | P0 | 同时使用 `--project-file` 与 `--projects-file` | `PROJECT_INPUT_MODE_CONFLICT`。 |
| CLI-PADD-011 | P0 | 位置路径与 `--project-file` 同时使用 | `PROJECT_INPUT_MODE_CONFLICT`。 |
| CLI-PADD-012 | P1 | project JSON 使用 schemaVersion `99` | `PROJECT_INPUT_SCHEMA_UNSUPPORTED`。 |
| CLI-PADD-013 | P0 | project JSON 增加未知字段 | `PROJECT_INPUT_UNKNOWN_FIELD`。 |
| CLI-PADD-014 | P0 | project JSON location 使用相对路径 | `PROJECT_LOCATION_NOT_ABSOLUTE`。 |
| CLI-PADD-015 | P0 | project JSON branch 与真实分支不一致 | `PROJECT_BRANCH_MISMATCH`。 |
| CLI-PADD-016 | P0 | 批量文件中放入两个相同 specPrefix 的不同项目 | 整批失败，含 `DUPLICATE_SPEC_PREFIX`；不能只写第一条。 |
| CLI-PADD-017 | P0 | 在工作区副本自身执行 `git init -b main` 并提交一个文件，再尝试把该工作区根注册为项目 | 失败，含 `PROJECT_OVERLAPS_WORKSPACE`。 |
| CLI-PADD-018 | P0 | 在 `.codex/config.toml` 制造未托管 `sandbox_mode` 冲突，再添加新项目 | `PROJECT_CONFIGURATION_UPDATE_FAILED`；config 回滚；权限文件保持原样。 |
| CLI-PADD-019 | P1 | 使用相同 name、不同 location/specPrefix 添加项目 | `PROJECT_CONFLICT`。 |
| CLI-PADD-020 | P2 | 同时提供位置参数和未来可能冲突的同义选项组合 | 观察项：确认所有输入模式都有明确互斥规则，不能静默选一个。 |

## 9. `project list`、`project show`、`project verify`、`project remove`

本节主工作区应已有 `frontend-app` 和 `backend-api`。

| ID | P | 操作 | 预期 |
|---|---:|---|---|
| CLI-PLIST-001 | P1 | 在空工作区运行 `project list` | 输出 `No local projects configured.`，退出码 0。 |
| CLI-PLIST-002 | P0 | `openspec-w project list --json` | `data.projects` 含 A、B；无多余输出。 |
| CLI-PLIST-003 | P0 | 在缺少 language 的旧配置副本运行 list | 仍成功且不写回配置。 |
| CLI-PLIST-004 | P0 | 把 projects 改成非数组后 list | `PROJECT_REGISTRY_INVALID`。 |
| CLI-PSHOW-001 | P1 | `openspec-w project show frontend-app` | 输出该项目 YAML。 |
| CLI-PSHOW-002 | P1 | `openspec-w project show --name backend-api --json` | `data.project.name="backend-api"`。 |
| CLI-PSHOW-003 | P0 | 查询不存在项目 | `PROJECT_NOT_FOUND`。 |
| CLI-PSHOW-004 | P2 | 同时传位置 name 与不同的 `--name` | 观察项：理想契约应拒绝歧义；记录当前实际选择。 |
| CLI-PVER-001 | P0 | `openspec-w project verify --json` | 当前项目有效，退出码 0。 |
| CLI-PVER-002 | P1 | 空工作区 verify | `ok=true`；diagnostics 含 warning `NO_PROJECTS`。 |
| CLI-PVER-003 | P0 | 把 A 切换到 `feature` 分支后 verify，再切回 main | verify 失败并包含 `PROJECT_BRANCH_MISMATCH`；不能改写 config。 |
| CLI-PVER-004 | P0 | 在配置副本中制造重复 name、prefix 或 path | 分别得到稳定的 duplicate 诊断。 |
| CLI-PVER-005 | P0 | A 有效、B 分支不一致时运行 `openspec-w project verify A --json` | 成功；`data.scope="project"`、`data.project.name="A"` 且 `data.projects` 只含 A。 |
| CLI-PVER-006 | P0 | A 有效、B 分支不一致时运行全局 verify | 仍失败并包含 B 的 `PROJECT_BRANCH_MISMATCH`。 |
| CLI-PVER-007 | P0 | 定向校验不存在项目 | `PROJECT_NOT_FOUND`；配置不变。 |
| CLI-PVER-008 | P0 | 选中项目参与重复 prefix、重复 path 或嵌套 path 冲突 | 定向校验保留与选中项目相关的稳定冲突诊断。 |
| CLI-PREM-001 | P0 | 在工作区副本执行 `project remove backend-api --yes --json` | 成功；项目删除；权限根同步减少。 |
| CLI-PREM-002 | P0 | JSON 模式不带 `--yes` 删除 | `CLI_CONFIRMATION_REQUIRED`；配置不变。 |
| CLI-PREM-003 | P1 | 文本交互回答 `n` | `CLI_CANCELLED`；配置不变。 |
| CLI-PREM-004 | P0 | 删除不存在项目 | `PROJECT_NOT_FOUND`。 |
| CLI-PREM-005 | P0 | 制造权限配置冲突后删除项目 | `PROJECT_CONFIGURATION_UPDATE_FAILED`；删除操作回滚。 |

## 10. 准备有效的 OpenSpec change fixture

```sh
export CHANGE_NAME="manual-auth-change"
export CHANGE_ROOT="$WS_ROOT/openspec/changes/$CHANGE_NAME"

mkdir -p "$CHANGE_ROOT/specs/frontend-app-auth"

cat > "$CHANGE_ROOT/proposal.md" <<'EOF'
# Manual auth change

## Affected Projects

- `frontend-app`: add authentication UI

## Capabilities

### New Capabilities

- Project: `frontend-app`; Capability: `frontend-app-auth`; Description: Add authentication UI
EOF

cat > "$CHANGE_ROOT/tasks.md" <<'EOF'
## 1. frontend-app: authentication UI

- [ ] 1.1 Implement the UI
EOF

cat > "$CHANGE_ROOT/specs/frontend-app-auth/spec.md" <<'EOF'
# frontend-app-auth

## Requirements

### Requirement: Authentication UI

The frontend SHALL render an authentication UI.
EOF
```

## 11. `change validate`

| ID | P | 操作 | 预期 |
|---|---:|---|---|
| CLI-CHG-001 | P0 | `openspec-w change validate "$CHANGE_NAME" --json` | `command="change.validate"`；`ok=true`。 |
| CLI-CHG-002 | P1 | `openspec-w change validate --change "$CHANGE_NAME" --json` | 与位置参数形式等价。 |
| CLI-CHG-003 | P0 | 不提供 change 名称 | `ok=false`；diagnostics 含 `CHANGE_REQUIRED`。 |
| CLI-CHG-004 | P0 | 验证不存在 change | `CHANGE_NOT_FOUND`。 |
| CLI-CHG-005 | P1 | 在副本中删除 proposal.md | `PROPOSAL_MISSING`，并按实际内容收集其他相关诊断。 |
| CLI-CHG-006 | P1 | 在副本中删除 tasks.md | `TASKS_MISSING`。 |
| CLI-CHG-007 | P0 | proposal 引用未知项目 | `UNKNOWN_AFFECTED_PROJECT`。 |
| CLI-CHG-008 | P0 | Affected Projects 有项目但 tasks 缺对应分组 | `AFFECTED_PROJECT_WITHOUT_TASKS`。 |
| CLI-CHG-009 | P0 | capability 不使用项目 specPrefix | `CAPABILITY_PREFIX_MISMATCH`。 |
| CLI-CHG-010 | P0 | 声明 capability 但删除 delta spec | `DELTA_SPEC_MISSING`。 |
| CLI-CHG-011 | P0 | 增加未声明的 delta spec | `UNDECLARED_DELTA_SPEC`。 |
| CLI-CHG-012 | P1 | 在缺少 workspace.language 的旧配置副本验证 change | 不应被 language 阻断。 |

## 12. `context`

| ID | P | 操作 | 预期 |
|---|---:|---|---|
| CLI-CTX-001 | P0 | `openspec-w context` | 文本包含 workspace root、A、B 及其 context。 |
| CLI-CTX-002 | P0 | `openspec-w context --json` | `data.workspaceRoot` 正确；`data.projects` 含 A、B。 |
| CLI-CTX-003 | P1 | `openspec-w context --project frontend-app --json` | 只返回 A。 |
| CLI-CTX-004 | P1 | `openspec-w context --change "$CHANGE_NAME" --json` | `data.change.affectedProjects` 含 A；projects 只含 A。 |
| CLI-CTX-005 | P1 | 同时传 `--change` 和匹配的 `--project` | 返回交集。 |
| CLI-CTX-006 | P2 | 使用不存在的 `--project` | 观察项：当前可能返回空成功；确认产品是否应改为 `PROJECT_NOT_FOUND`。 |
| CLI-CTX-007 | P2 | 使用不存在的 `--change` | 观察项：确认是否应返回 `CHANGE_NOT_FOUND`，不能让自动化误以为 change 没有项目。 |
| CLI-CTX-008 | P0 | 在缺少 language、monitor 非法但 projects 有效的配置副本运行 context | 仍成功，证明只依赖 projects 域。 |

## 13. `sync`

| ID | P | 操作 | 预期 |
|---|---:|---|---|
| CLI-SYNC-001 | P0 | `openspec-w sync --json` | 成功；`.codex/config.toml` 中 managed block 包含 A、B 的绝对路径。 |
| CLI-SYNC-002 | P1 | 重复 sync | `data.action="skip"`，文件内容不变。 |
| CLI-SYNC-003 | P1 | 空工作区 sync | 成功但带 `NO_PROJECTS` warning；写入或保持空 writable roots。 |
| CLI-SYNC-004 | P0 | A 实际分支与配置不符时 sync | 失败；不写权限文件。 |
| CLI-SYNC-005 | P0 | 在 managed block 外写入 `sandbox_mode = "read-only"` 后 sync | `WORKSPACE_PERMISSIONS_CONFLICT`；不覆盖用户配置。 |
| CLI-SYNC-006 | P0 | 在缺少 language 的旧配置副本 sync | 成功且不迁移 config。 |

## 14. `validate`

| ID | P | 操作 | 预期 |
|---|---:|---|---|
| CLI-VAL-001 | P0 | `openspec-w validate --json` | 项目、主 specs、全部 change 均有效时 `ok=true`。 |
| CLI-VAL-002 | P1 | 空工作区 validate | `ok=true`，含 `NO_PROJECTS` warning。 |
| CLI-VAL-003 | P0 | 在 `openspec/specs/unknown-owner/spec.md` 创建未知前缀主 spec | `UNKNOWN_SPEC_OWNER`。 |
| CLI-VAL-004 | P0 | 破坏有效 change 的 capability 或 tasks | 聚合对应 change 诊断，退出码非 0。 |
| CLI-VAL-005 | P0 | 项目 branch 不一致 | `PROJECT_BRANCH_MISMATCH`；后续 change 检查可停止，但诊断不能伪造成功。 |
| CLI-VAL-006 | P1 | 缺少 language 的旧配置 | 不被 language 阻断。 |

## 15. `doctor`

| ID | P | 操作 | 预期 |
|---|---:|---|---|
| CLI-DOC-001 | P0 | `openspec-w doctor --json` | 健康工作区 `ok=true`；data 包含 projects、openspecVersion、tools、capabilities。 |
| CLI-DOC-002 | P1 | 文本模式 doctor | 健康摘要写 stdout；warning 写 stderr。 |
| CLI-DOC-003 | P0 | 修改一个受管文件 | `MANAGED_FILE_UNKNOWN` 或对应 outdated 诊断。 |
| CLI-DOC-004 | P0 | 删除一个受管文件 | `MANAGED_FILE_MISSING`。 |
| CLI-DOC-005 | P0 | config 写入非法 language，同时保留一个 branch 错误项目 | 同时报告 language 与 project branch 错误；不能清空 projects。 |
| CLI-DOC-006 | P1 | identity 非法但 language 有效 | 记录是否错误退化到默认语言并产生次生 managed-file 诊断；若出现则登记缺陷。 |
| CLI-DOC-007 | P0 | monitor URL 非法但 projects 有效 | 报 monitor 错误，同时继续检查 projects。 |
| CLI-DOC-008 | P0 | schemaVersion `99` | `CONFIG_SCHEMA_VERSION_UNSUPPORTED`，不重写配置。 |
| CLI-DOC-009 | P0 | 删除 state.json 或把 status 改为 unhealthy | `INIT_STATE_UNHEALTHY`。 |
| CLI-DOC-010 | P1 | state 的 releaseVersion 与当前包不一致 | `INIT_RELEASE_OUTDATED`。 |
| CLI-DOC-011 | P1 | state OpenSpec version 与实际命令不一致 | `INIT_OPENSPEC_STATE_MISMATCH`。 |
| CLI-DOC-012 | P0 | state tools 仅 Codex，省略 `--tools` 运行 doctor | `data.tools.source="workspace-state"`；不能按 manifest 默认推导 Claude。 |
| CLI-DOC-013 | P0 | Monitor 启用但 tools 不含 Codex | `MONITOR_CODEX_REQUIRED`。 |

## 16. `monitor`

本节需要两个终端。

先创建启用 Monitor 的工作区：

```sh
export WS_MONITOR="$TEST_BASE/workspace-monitor"
openspec-w init "$WS_MONITOR" \
  --tools codex \
  --monitor \
  --monitor-url http://127.0.0.1:43211 \
  --language en-US \
  --yes \
  --json
```

在终端 A：

```sh
cd "$WS_MONITOR"
openspec-w monitor -p 43211
```

| ID | P | 操作 | 预期 |
|---|---:|---|---|
| CLI-MON-001 | P0 | 启动 `monitor -p 43211` | 绑定 `127.0.0.1`；打印 dashboard 和 API 地址；进程持续运行。 |
| CLI-MON-002 | P1 | `curl -fsS http://127.0.0.1:43211/api/v1/health` | 返回 `{"ok":true}`。 |
| CLI-MON-003 | P1 | curl `/`、`/api/v1/snapshot`、`/api/v1/workspaces`、`/api/v1/events` | HTML/API 均可访问，JSON 结构正确。 |
| CLI-MON-004 | P0 | monitor 已占用 43211 时，再启动同端口 | `MONITOR_PORT_IN_USE`，含换端口 remediation。 |
| CLI-MON-005 | P0 | `openspec-w monitor --port 0`、`65536`、`abc` | 非 0；说明端口范围；记录实际稳定 code。 |
| CLI-MON-006 | P0 | `openspec-w monitor --json` | `CLI_JSON_UNSUPPORTED`，不能启动长运行服务。 |
| CLI-MON-007 | P1 | `openspec-w monitor -p 43212` | 短别名生效；服务监听 43212。 |
| CLI-MON-008 | P1 | 在终端 A 按 Ctrl-C | 服务优雅退出，端口释放，退出码 0。 |

## 17. `monitor report`

重新启动 43211 Monitor 后，在终端 B 执行：

```sh
cd "$WS_MONITOR"
printf '%s\n' '{"hook_event_name":"UserPromptSubmit","session_id":"manual-session","turn_id":"turn-1","cwd":"/tmp","model":"manual-model"}' \
  | openspec-w monitor report --json
```

| ID | P | 操作 | 预期 |
|---|---:|---|---|
| CLI-MREP-001 | P0 | 发送上面的 UserPromptSubmit | `ok=true`；`data.action="report"`；snapshot 中出现 workspace/session/turn。 |
| CLI-MREP-002 | P1 | 依次发送 PermissionRequest、PostToolUse、SubagentStart、SubagentStop、Stop、SessionEnd | eventType/status 映射正确；不包含 prompt/tool 敏感正文。 |
| CLI-MREP-003 | P1 | 向 Monitor 禁用工作区发送合法事件 | fail-open；`action="skip"`、reason 为 monitor disabled；退出码 0。 |
| CLI-MREP-004 | P1 | 发送未知 `hook_event_name` | `action="skip"`、reason 为 unsupported event。 |
| CLI-MREP-005 | P0 | 输入非法 JSON | fail-open；标准成功信封内 `action="skip"`，并给出 `MONITOR_EVENT_INVALID` errorCode。 |
| CLI-MREP-006 | P1 | 在非工作区发送事件 | fail-open；退出码 0；`action="skip"`。 |
| CLI-MREP-007 | P1 | Monitor 未启动时发送合法事件 | 300ms 左右超时/失败开放；`action="skip"`、reason 为 monitor unavailable。 |
| CLI-MREP-008 | P1 | 检查 report JSON stdout/stderr | stdout 只有标准信封，stderr 为空，适合 Hook 调用。 |

## 18. `completion`

| ID | P | 操作 | 预期 |
|---|---:|---|---|
| CLI-COMP-001 | P1 | `openspec-w completion` | 默认生成 zsh 脚本，包含全部顶层命令。 |
| CLI-COMP-002 | P1 | `openspec-w completion --shell zsh` 并用 `zsh -n` 检查 | 语法合法。 |
| CLI-COMP-003 | P1 | `openspec-w completion --shell bash` 并用 `bash -n` 检查 | 语法合法，包含两个 bin 名称。 |
| CLI-COMP-004 | P0 | `openspec-w completion --shell fish --json` | `CLI_COMPLETION_SHELL_UNSUPPORTED`，列出 bash/zsh。 |
| CLI-COMP-005 | P1 | `openspec-w completion --shell bash --json` | 标准信封；`data.shell="bash"`；脚本文本不额外写 stderr。 |

## 19. 跨命令兼容矩阵

### 19.1 旧配置缺少 language

对一个 schemaVersion 1、缺少 `workspace.language` 但 projects 有效的只读副本执行：

| 命令 | 预期 |
|---|---|
| `project list --json` | 成功，不写配置。 |
| `project show frontend-app --json` | 成功，不写配置。 |
| `project verify --json` | 成功，不被 language 阻断。 |
| `project inspect "$PROJECT_A" --json` | 成功且完全不依赖工作区。 |
| `change validate "$CHANGE_NAME" --json` | 根据 change/project 内容判断，不被 language 阻断。 |
| `context --json` | 成功。 |
| `sync --json` | 成功，只写权限文件，不迁移 config。 |
| `validate --json` | 成功或返回真实业务诊断。 |
| `doctor --json` | 报 language 缺失，但保留其他有效域的诊断。 |
| `language --json` | `WORKSPACE_LANGUAGE_MISSING`。 |
| `update --json` | 显式执行兼容迁移。 |
| `init --yes --json` | 显式执行兼容迁移。 |

### 19.2 每个主要命令的输出协议

至少对以下命令各执行一次文本模式和 JSON 模式：

- `init`
- `update`
- `language`
- `project inspect`
- `project add`
- `project remove`
- `project list`
- `project show`
- `project verify`
- `change validate`
- `context`
- `sync`
- `validate`
- `doctor`
- `completion`
- `help`
- `version`
- `monitor report`

`monitor` 是长运行服务，使用 API 检查机器可读状态；`monitor --json` 应明确拒绝。

## 20. 写操作最终状态核对

每次 init/update/project 写操作后，至少检查：

```sh
find "$WS_ROOT/.openspec-workspace" -maxdepth 2 -type f -print
openspec-w project list --json
openspec-w project verify --json
openspec-w validate --json
openspec-w doctor --json
```

失败写操作前后建议记录：

```sh
find "$WS_ROOT" -type f -not -path '*/.git/*' -exec shasum -a 256 {} \; | sort > "$TEST_BASE/before.sha256"
# 执行预期失败的命令
find "$WS_ROOT" -type f -not -path '*/.git/*' -exec shasum -a 256 {} \; | sort > "$TEST_BASE/after.sha256"
diff -u "$TEST_BASE/before.sha256" "$TEST_BASE/after.sha256"
```

允许存在的差异必须能在命令结果中解释。若 JSON 的 `diagnostics[].effects` 声称已经恢复或保留某个效果，应与实际文件系统一致。

## 21. 发布判定

满足以下条件才建议通过手工回归：

- registry metadata、全局安装 package.json 和两个 CLI version 完全一致。
- CLI 在源码仓库之外运行正常，发布包没有缺失运行时文件或资产。
- 从上一发布版本升级后的 UUID、项目、语言、工具选择和用户内容保持正确。
- 所有 P0 用例 PASS。
- P1 无未评估的数据安全、兼容性或自动化协议问题。
- JSON 模式没有混入普通文本或 stderr。
- 未知选项、额外参数和互斥输入没有被静默接受。
- 旧配置的只读命令不产生隐式迁移写入。
- init/update/project 的失败场景没有不可解释的工作区文件差异。
- 外部命令留下的效果在 JSON 和默认文本模式都能被用户看见。
- Doctor 不因一个无效配置域丢失其他有效域。
- 两个 bin 别名、README、Skill 示例与真实命令契约一致。

建议最终汇总格式：

| 分类 | 总数 | PASS | FAIL | BLOCKED |
|---|---:|---:|---:|---:|
| 全局与解析 | 18 |  |  |  |
| init | 22 |  |  |  |
| update/language | 20 |  |  |  |
| project | 46 |  |  |  |
| change/context | 20 |  |  |  |
| sync/validate/doctor | 25 |  |  |  |
| monitor/report | 16 |  |  |  |
| completion | 5 |  |  |  |
| 发布包安装专项 | 10 |  |  |  |
| **合计** | **182** |  |  |  |

观察项不应计为 PASS；需要明确产品决策后转成正式通过或失败标准。
