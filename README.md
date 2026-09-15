# Code Workspace

Code Workspace is a local multi-project registry and safety layer for Claude Code and Codex. It manages workspace identity, project locations and branches, agent instructions, writable-root permissions, validation, and optional monitoring.

## Requirements

- Node.js 20.19.0 or newer
- Git repositories for projects you register

## Install

```bash
npm install -g @icebearx-ai/code-workspace
```

The package provides the `code-workspace` command and the shorter `codew` alias. The legacy `code-w` alias remains available for compatibility.

## Initialize

Interactive initialization:

```bash
code-workspace init .
```

Non-interactive initialization:

```bash
code-workspace init . \
  --tools claude,codex \
  --extensions none \
  --language en-US \
  --yes
```

Use `--tools claude`, `--tools codex`, or `--tools none` to override the default tool selection. Monitoring is not enabled implicitly; install the `monitor` extension with `--extensions monitor` or through the interactive extension picker.

Initialization writes only Workspace-owned state and integrations:

- `.codew/config.yaml`, its referenced project configuration file (default: `.codew/config-projects.yaml`), and `.codew/state.json`
- `USER_GUIDE.md`
- `CLAUDE.md` and/or `AGENTS.md`
- Workspace-specific commands and skills whose names start with `code-workspace-` or use the `/code-workspace` namespace
- `.codex/hooks.json` is written by the `monitor` extension when that extension is installed

It does not create `openspec/`, install native `/opsx` commands, or install native `openspec-*` skills.

### Experimental built-in extensions

`init` can install integrations from the versioned `extensions/` repository shipped inside this npm package. Select extension names interactively, or pass a comma-separated name list non-interactively. The dedicated install command accepts one or more names; without names it opens the built-in extension multiselect with no extensions selected, where each choice shows its name and a short description. ESC exits without changes:

```bash
codew init . --extensions zhuiyi-jira-mcp --yes
codew init . --extensions zhuiyi-opensvn-mcp --yes
codew init . --extensions none --yes
codew extension install
codew extension install zhuiyi-jira-mcp --yes
codew extension install zhuiyi-opensvn-mcp --yes
codew extension install zhuiyi-jira-prd-analysis --yes
codew extension install zhuiyi-jira-task-breakdown --yes
codew extension install zhuiyi-jira-issue-fix-summary --yes
codew extension install zhuiyi-guangda-coding-spec --yes
codew extension uninstall zhuiyi-jira-mcp --yes
codew extension uninstall zhuiyi-jira-prd-analysis --yes
```

The Workspace operation lock shared by init, extension install, and extension uninstall is configured in the Code Workspace project's `.env` (not in the target Workspace). `CODE_WORKSPACE_INIT_LOCK_UPDATE_MS` defaults to `5000`, and `CODE_WORKSPACE_INIT_LOCK_STALE_MS` defaults to `30000`; process environment variables take precedence. See `.env.example` for the project configuration names.

Users select names, not versions; `zhuiyi-jira-mcp@0.1.0` is intentionally rejected. Code Workspace resolves the highest extension SemVer implemented against a Host-supported Extension Spec before confirmation. A new non-interactive Workspace installs no extensions unless `--extensions` is provided. Re-initializing an existing Workspace defaults to its installed extensions and upgrades them when a newer supported built-in version exists. `none` skips extension work and does not uninstall existing artifacts.

`extension install` does not rerun core Workspace initialization. In JSON, non-TTY, or `--yes` mode, at least one extension name is required. Multiple names are installed in order with one confirmation boundary and independent transactions; any failure makes the install command fail while later extensions still run.

The bundled `zhuiyi-jira-mcp` and `zhuiyi-opensvn-mcp` extensions configure the Jira and OpenSVN MCP services for the selected Agent tools. They do not create an `openspec/` directory or install native OpenSpec commands.

The bundled `zhuiyi-jira-prd-analysis`, `zhuiyi-jira-task-breakdown`, and `zhuiyi-jira-issue-fix-summary` extensions install optional Codex and Claude Code skill files. They are independent extensions, are not installed by core `init` or `update`, and can be uninstalled separately. Install `zhuiyi-jira-mcp` separately when they need Jira access.

The bundled `zhuiyi-guangda-coding-spec` extension installs a Codex and Claude Code skill that applies the China Everbright Bank research, security, testing, and release rules to Guangda customer projects. It is independent of core `init` and `update`, can be uninstalled separately, and requires no MCP service.

The MCP runtime packages are not copied into the Workspace. Only their configuration is stored there; a launcher prepares and caches each package on demand in the user-level Extension Store.

`zhuiyi-opensvn-mcp` accesses OpenSVN static resources through `opssvn.in.wezhuiyi.com`. Its bundled configuration sets `SVN_OUTPUT_DIR` to `.mcp-cache-opensvn`, requires `SVN_AUTHORIZATION`, and defaults `SVN_MAX_RESOURCES` to `200`; credentials are not stored in the extension package and should be supplied through local configuration or the runtime environment.

Extension entries run in separate Node processes and generate files in temporary staging directories. The host rejects undeclared, missing, symbolic-link, non-file, path-escaping, conflicting, and checksum-mismatched artifacts before transactionally installing them. Per-Workspace state is stored in `.codew/ext-manifest.json`. A failed extension is reported as a warning and does not roll back successful core initialization or stop later extensions; a failed upgrade restores and retains the previous installed version.

Extensions may own complete files or declare Host-managed abstract Hooks. Codex and Claude
adaptors render those declarations into each provider's native configuration and dynamically plug
or unplug them during extension install, upgrade, and uninstall. Shared targets are composed and
verified by Code Workspace; extensions never patch the real Workspace directly. Uninstall uses
recorded installed state and does not execute extension code. Unknown changes to extension-owned
files or contributions stop the operation instead of being overwritten.

This is fault isolation, not a malicious-code security sandbox. The experimental release trusts only extension code shipped with Code Workspace; network sources, external extension directories, dependencies, arbitrary patches, force uninstall, disable commands, and automatic extension updates through `codew update` are not supported. The developer contract is in `docs/extensions.md`.

## Register projects

Inspecting a repository is read-only:

```bash
code-workspace project inspect /absolute/path/to/project --json
```

Claude Code users can invoke:

```text
/code-workspace:add-projects /absolute/path/to/project-a /absolute/path/to/project-b
```

Codex users can invoke `$code-workspace-add-projects` with the same explicit paths. For low-level automation, pass complete project records through stdin:

```bash
cat projects.json | code-workspace project add --stdin --yes --json
```

`--stdin` accepts `{ "schemaVersion": 1, "projects": [...] }` JSON with the same semantics as `--projects-file`, requires `--yes`, and fails before writing when input is empty, invalid, or larger than 1 MiB. `--stdin`, `--project-file`, `--projects-file`, and a positional path are mutually exclusive.

The registry stores each project's name, real location, registered branch, type, and context. The registered branch is the Code Workspace expected state; the actual branch is observed from the selected Git worktree. Workspace never guesses a path from a conversation or automatically decides which branch is authoritative.

Project registration is always stored in a separate file in the `.codew` directory. Initialization uses `config-projects.yaml` by default, while `projects.ref` may name any safe regular filename in that directory:

```yaml
# .codew/config.yaml
projects:
  ref: config-projects.yaml
```

The referenced file uses this format:

```yaml
# .codew/config-projects.yaml
schemaVersion: 1
projects:
  - name: payments
    location: /absolute/path/to/payments
    branch: main
    type: backend
    context: |-
      Service ownership and navigation context.
```

`projects.ref` is resolved relative to `config.yaml`. It must be one safe regular filename in the same `.codew` directory; URLs, globs, absolute paths, path traversal, and inline `projects` arrays are not supported. Existing project command arguments and behavior remain compatible, `project add` additionally supports `--stdin`, and project data is still read from and written to the referenced file. The `.codew/` directory is ignored by default, so Git history for this local registry requires an explicit repository policy.

For example, `ref: team-projects.yaml` makes the project registry `.codew/team-projects.yaml`; the default remains `config-projects.yaml`.

## Daily commands

```bash
code-workspace project list --json
code-workspace project show payments --json
code-workspace project verify payments --json
code-workspace project branch inspect payments --json
code-workspace project branch verify payments --json
code-workspace project branch use-registered payments --yes --json
code-workspace project branch accept-actual payments --yes --json
code-workspace project branch update-latest payments --json
code-workspace permissions apply --yes --json
code-workspace doctor --json
```

`project branch inspect` reports `registeredBranch`, `actualBranch`, whether they match, worktree cleanliness, local registered-branch availability, and remote-tracking candidates for only the named project. `project branch verify` is the narrower assertion used after reconciliation: it checks only whether the registered and actual branches match, without running overall project-health validation. A `PROJECT_BRANCH_MISMATCH` diagnostic uses `registeredBranch`, `actualBranch`, and `location`; consumers of older branch diagnostic/result fields must migrate to this canonical state contract.

The two reconciliation directions are deliberately separate:

- `project branch use-registered` switches the selected worktree to its registered branch. By default it requires confirmation, a clean worktree, and an existing local branch. `--allow-remote` permits creating a local tracking branch from one existing remote-tracking branch; `--remote <name>` explicitly authorizes fetching the registered branch from that remote before creating and switching the local tracking branch.
- `project branch accept-actual` updates only the selected registry record so its registered branch accepts the actual branch. Existing branch-adoption scripts should migrate to this command.

Both commands detect plan drift and verify postconditions. `project branch update-latest` is the separate, opt-in path for projects with `updateLatest: true`; it only fetches the configured upstream and fast-forwards a clean matching branch. Code Workspace never creates or downloads a branch and never performs stash, reset, rebase, non-fast-forward merge, production-code edits, or conflict resolution.

Users may manually set the optional project policy in the file named by `projects.ref` (default: `.codew/config-projects.yaml`):

```yaml
# .codew/config-projects.yaml
schemaVersion: 1
projects:
  - name: payments
    location: /absolute/path/to/payments
    branch: main
    type: backend
    context: |-
      Service ownership and navigation context.
    updateLatest: true
```

AI/Agent must not directly edit this file. They may read the policy and invoke the registered CLI command; users remain responsible for manual configuration changes.

`permissions apply` shows the complete authorization plan for the selected Agent tools, requires confirmation when changes are needed, applies and verifies the requested grants, and reports the result per tool. Agent directory access remains a user authorization. The command adds missing registered-project access but does not revoke additional directories; use `project remove` or edit the Agent settings explicitly to revoke access.

## Update and language

```bash
code-workspace update --json
code-workspace update --language zh-CN --json
code-workspace language --json
```

`update` refreshes only Workspace-owned managed assets and never changes Agent directory authorization. Unknown local edits stop the batch before writes; review them or pass `--force` explicitly.

## Monitor

Monitor ships as the built-in `monitor` extension. Install it into a workspace and run its dashboard through the generic extension runtime:

```bash
code-workspace extension install monitor --yes
code-workspace ext monitor serve --port 3211
```

The monitor binds to loopback, combines events from multiple initialized workspaces, and keeps hook reporting (`codew ext monitor report`) failure-open. Review and trust project hooks in Codex before relying on reports.

```bash
code-workspace completion --shell zsh
code-workspace completion --shell bash
```

`completion` prints a script generated from the full command registry, including subcommands and command-specific options. It does not install the script or modify shell configuration. With `--json`, the script is returned in `data.script`.

## Development

```bash
npm install
npm test
npm run check
npm run pack:check
```

The release manifest contains only Workspace-owned asset sources and managed files. Checksums make installation and update deterministic.
