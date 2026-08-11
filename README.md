# OpenSpec Workspace

English | [简体中文](README.zh-CN.md)

`@icebearx-ai/openspec-workspace` extends OpenSpec with local multi-project and cross-project AI coding workflows.

OpenSpec remains responsible for proposals, specs, designs, tasks, apply, and archive. OpenSpec Workspace adds a local project registry, Git worktree and branch validation, capability ownership, cross-project task validation, AI context output, and Codex writable-root synchronization.

## Install

```bash
npm install -g @icebearx-ai/openspec-workspace
```

The package exposes two equivalent commands:

```bash
openspec-workspace --help
openspec-w --help
```

`openspec-workspace` is the canonical command for documentation and automation. `openspec-w` is the short interactive alias.

## Initialize

```bash
mkdir my-workspace
cd my-workspace

openspec-workspace init
```

The target directory is optional and defaults to the current directory. Pass a path only when initializing another directory, for example `openspec-workspace init ./my-workspace`.

`init` follows the complete managed initialization workflow:

1. Run a read-only preflight that validates the packaged manifest, checks Node.js, and detects both the global OpenSpec package and executable versions.
2. In an interactive terminal, use the `@clack/prompts` setup wizard to collect the workspace name, workspace language (`zh-CN` or `en-US`), an exact supported OpenSpec version, agent tools, and Codex monitoring settings with keyboard-selectable controls and consistent cancellation behavior. When `--tools` is omitted, the wizard provides a multi-select containing only Claude Code and Codex; both are initially selected and either can be deselected. Monitoring is selected by default whenever Codex is enabled; use `--no-monitor` to opt out. The Monitor language is selected separately in the dashboard.
3. Show the complete initialization plan, including global OpenSpec version changes, and ask for confirmation before writing files or installing packages.
4. Install the exact selected OpenSpec version with `npm install -g <package>@<version>` when it is missing, different, or inconsistent, then verify both the package and executable versions.
5. Generate a stable workspace UUID and preserve it on subsequent initialization runs.
6. Run `npm install` when initializing an OpenSpec Workspace source checkout.
7. Initialize OpenSpec and its selected native AI-tool baselines for a fresh target. An existing complete `openspec/` structure is preserved and does not re-enter upstream OpenSpec initialization merely because an AI-tool file is absent.
8. Remove obsolete managed files from earlier releases.
9. Install all templates, compiled patch outputs, and workspace schema files through one fingerprint-based managed-file mechanism.
10. Apply the versioned `config-yaml.patch` to select the `workspace-workflow` schema and install the OpenSpec Workspace project context.
11. Create the local-only project configuration and synchronize Codex writable roots when projects exist.
12. Run strict health checks, commit local initialization state, and verify the committed state.

Non-interactive installation or version changes use:

```bash
openspec-workspace init . \
  --tools claude,codex \
  --language zh-CN \
  --openspec-version 1.5.0 \
  --yes
```

`--yes` selects the manifest's recommended OpenSpec version when `--openspec-version` is omitted. `--json` never displays the interactive wizard, color, or progress UI. Because non-interactive commands cannot show the tool multi-select, omitting `--tools` in `--yes` or `--json` mode enables both Claude Code and Codex; pass `--tools claude`, `--tools codex`, or `--tools none` to override that default.

Initialization creates local-only state:

```text
.openspec-workspace/
├── config.yaml
└── state.json
```

The complete `.openspec-workspace/` directory is added to `.gitignore`. OpenSpec Workspace does not create or support shared project configuration.

Initialization installs one managed `USER_GUIDE.md` in the selected workspace language. It can be restored, updated, or switched to another supported language with `openspec-workspace update`.

## Add projects

Use the installed `openspec-workspace-add-projects` skill as the preferred user-facing workflow. The skill inspects repositories read-only, generates concise AI context, presents the completed records for confirmation, and calls the low-level CLI registration command.

The CLI exposes a read-only inspection command for skills and automation:

```bash
openspec-workspace project inspect /absolute/path/to/project --json
openspec-workspace project list
openspec-workspace project verify
openspec-workspace project verify <name>
openspec-workspace project sync-branch <name>
```

`project inspect` reports only verified Git and file-existence facts. It does not infer project type, technology stack, code ownership, or context, and it does not modify workspace files.

`project verify` without a name validates the whole registry. `project verify <name>` validates the selected project and configuration conflicts involving it, so unrelated project branch drift does not block targeted work.

Low-level registration requires a complete project record produced by a user or skill:

```bash
openspec-workspace project add --projects-file /path/to/projects.json --yes --json
```

Project records contain:

```yaml
schemaVersion: 1
workspace:
  name: openspec-workspace
  uuid: 123e4567-e89b-42d3-a456-426614174000
  language: zh-CN
monitor:
  enable: false
  url: http://127.0.0.1:3211
projects:
  - name: xxx-management
    specPrefix: xxx-management
    location: /absolute/path/to/xxx-management
    branch: release/1.0.0
    type: backend
    context: |
      职责：Xxx 产品的管理后端，提供管理和业务编排能力。
      技术栈：Java 8、Spring Boot、Maven、MySQL、Redis。
      代码定位：应用代码位于 src/main/java，接口层位于 controller，业务逻辑位于 service。
      项目边界：负责服务端规则和数据访问。
```

`type` and `context` are semantic fields supplied by the user or skill. The CLI validates and stores them but does not infer them. `context` remains unrestricted non-empty text; the managed add-projects skill first runs `openspec-workspace language --json`, uses `data.projectContext` from the standard result envelope, and generates four concise lines in `data.language`. Locale resources are centralized under `src/i18n/locales`; long-form user guides remain separate Markdown documents.

Query the language used by OpenSpec artifacts and newly generated project context with:

```bash
openspec-workspace language
openspec-workspace language --json
```

### Change the workspace language

To change an initialized workspace from Chinese to English, run this command from the workspace root:

```bash
openspec-w update --language en-US
```

The command updates `.openspec-workspace/config.yaml` at `workspace.language`, derives the `Language: en-US` directive in `openspec/config.yaml`, and switches the managed `USER_GUIDE.md`. If any managed file contains unknown local changes, nothing is changed and the command explains how to review the file or retry explicitly with `--force`. Verify the result with:

```bash
openspec-w language
openspec-w language --json
openspec-w doctor
```

The new language applies to subsequently generated OpenSpec proposal, spec, design, and tasks artifacts, as well as project context generated by later add-projects invocations. Existing OpenSpec artifacts and existing project context are not translated automatically. The Monitor language remains independent and must be selected manually on the Monitor page.

## Agent monitor

The monitor is a global service and is not owned by, configured by, or coupled to any individual workspace. Start it from any directory; one process accepts events from multiple workspaces and separates them by UUID while displaying their readable names:

```bash
openspec-w monitor
```

Open the printed address (by default `http://127.0.0.1:3211/`) to use the built-in live dashboard. It shows aggregate counts, workspace and session navigation, turn status, tool activity, and the incoming event stream.

It listens only on `127.0.0.1:3211`. If that port is occupied, choose another port and set the same base URL in each participating workspace's local `.openspec-workspace/config.yaml`:

```bash
openspec-w monitor -p 8080
```

```yaml
monitor:
  enable: true
  url: http://127.0.0.1:8080
```

Enable the capability interactively during `init`, or non-interactively with `--monitor`. The managed `.codex/hooks.json` reports lifecycle metadata to `/api/v1/events`; prompt text, tool inputs, responses, and transcripts are excluded. Reporting has a short timeout and fails open, so an unavailable monitor does not block coding. Because project hooks require trust, review and enable them with `/hooks` in Codex after initialization.

### Future: remote approval

Approving or rejecting Codex permission requests from the monitor is intentionally deferred. The feature requires a stable bidirectional Codex control protocol, exact routing back to the originating workspace and session, complete display of the request reason and effective command or permission scope, and protection against stale or duplicate decisions. Before implementation it must also be validated across supported Codex versions, Codex CLI and Codex app behavior, and macOS, Windows, and Linux. Until those compatibility and security requirements are satisfied, the monitor only records approval events and emits an optional sound cue.

Read APIs are available at `/api/v1/health`, `/api/v1/snapshot`, `/api/v1/workspaces`, `/api/v1/events`, and `/api/v1/stream` (SSE). Data is in memory and resets when the service stops.

## OpenSpec workflow

```bash
openspec new change add-feature
openspec-workspace change validate add-feature
openspec-workspace context --change add-feature
```

The workspace workflow expects:

- proposal `Affected Projects` entries to use local project names;
- capability IDs to use `<specPrefix>-<local-capability>`;
- task groups to use `## <n>. <project-name>:` headings;
- `Cross-project` groups to contain coordination rather than unowned production edits.

## Claude and Codex

OpenSpec installs its native Claude commands under the `opsx` prefix:

```text
/opsx:explore
/opsx:propose
/opsx:apply
/opsx:sync
/opsx:archive
```

OpenSpec Workspace adds only the multi-project extension:

```text
/opswx:add-projects
```

Initialization also installs concise English workspace guard instructions from one canonical template: `CLAUDE.md` when Claude is selected and `AGENTS.md` when Codex is selected. They identify the root as a workspace rather than a production project, require registry-based selection and targeted verification, and forbid direct edits to local workspace state. An unchanged managed `AGENT.md` from an earlier release is migrated safely during update; modified or unknown files remain protected.

The native OpenSpec skills remain under `openspec-*`, while thin versioned patches add multi-project guards to explore, propose, apply, and archive without taking ownership of OpenSpec's lifecycle. The guards select and verify only relevant projects, resolve apply locations from `openspec-workspace context --change <name> --json`, preserve project-prefixed capabilities, and enforce project-owned implementation boundaries. They never edit the Workspace registry or recover Git branches inline: both Claude and Codex receive `openspec-workspace-resolve-branch`, which owns the explicit safe recovery flow for `PROJECT_BRANCH_MISMATCH`. `workspace-workflow` is repo-local; standalone OpenSpec stores are not implicitly bound to the current Workspace registry.

Templates and patch outputs use the same managed-file state machine. This includes the versioned `openspec/config.yaml` output produced by `config-yaml.patch`. A target is replaceable only when it matches the desired fingerprint, the last installed fingerprint, or an explicitly declared upstream baseline. Unknown modifications stop the complete batch before any target is written. The reviewed patches remain under `artifacts/patches`; release checks prove that applying them to the pinned OpenSpec baseline produces the packaged complete outputs used at runtime. Run `openspec-workspace update` to restore managed outputs after OpenSpec regenerates its native assets.

## Commands

| Command | Purpose |
| --- | --- |
| `init [path]` | Create local configuration and install managed assets; `path` defaults to the current directory |
| `monitor [-p PORT]` | Run the global multi-workspace Agent monitor |
| `update` | Update managed Claude, Codex, and OpenSpec assets |
| `language` | Print the current Workspace language (`en-US` or `zh-CN`) |
| `project inspect/add/remove/list/show/verify [name]/sync-branch` | Inspect and manage local Git worktrees; verify all projects or one selected project; synchronize a registered branch from the actual worktree |
| `change validate <name>` | Validate project and capability ownership for one change |
| `context` | Print workspace, project, or change context |
| `sync` | Synchronize Codex writable roots |
| `validate` | Validate projects, specs, and all active changes |
| `doctor` | Report local workspace health |

Validation and query commands support `--json`. Managed-file updates support `--force` when the user explicitly wants to replace locally modified generated assets.

## Development

```bash
npm install
npm test
npm run patches:check
npm run pack:check
```

The package requires Node.js 20.19 or newer.
