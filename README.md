# Code Workspace

Code Workspace is a local multi-project registry and safety layer for Claude Code and Codex. It manages workspace identity, project locations and branches, agent instructions, writable-root permissions, validation, and optional monitoring.

## Requirements

- Node.js 20.19.0 or newer
- Git repositories for projects you register

## Install

```bash
npm install -g @icebearx-ai/code-workspace
```

The package provides `code-workspace` and the shorter alias `code-w`.

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

Use `--tools claude`, `--tools codex`, or `--tools none` to override the default tool selection. Codex monitoring is enabled by default when Codex is selected; use `--no-monitor` to disable it.

Initialization writes only Workspace-owned state and integrations:

- `.code-workspace/config.yaml` and `.code-workspace/state.json`
- `USER_GUIDE.md`
- `CLAUDE.md` and/or `AGENTS.md`
- Workspace-specific commands and skills whose names start with `code-workspace-` or use the `/code-workspace` namespace
- `.codex/hooks.json` when monitoring is enabled

It does not create `openspec/`, install native `/opsx` commands, or install native `openspec-*` skills.

### Experimental built-in extensions

`init` can install integrations from the versioned `extensions/` repository shipped inside this npm package. Select extension names interactively, or pass a comma-separated name list non-interactively. The dedicated install command accepts one or more names; without names it opens the built-in extension multiselect, where ESC exits without changes:

```bash
code-w init . --extensions openspec-workspace --yes
code-w init . --extensions none --yes
code-w extension install
code-w extension install openspec-workspace --yes
code-w extension uninstall openspec-workspace --yes
```

The Workspace operation lock shared by init, extension install, and extension uninstall is configured in the Code Workspace project's `.env` (not in the target Workspace). `CODE_WORKSPACE_INIT_LOCK_UPDATE_MS` defaults to `5000`, and `CODE_WORKSPACE_INIT_LOCK_STALE_MS` defaults to `30000`; process environment variables take precedence. See `.env.example` for the project configuration names.

Users select names, not versions; `openspec-workspace@1.0.0` is intentionally rejected. Code Workspace resolves the highest compatible SemVer before confirmation. A new non-interactive Workspace installs no extensions unless `--extensions` is provided. Re-initializing an existing Workspace defaults to its installed extensions and upgrades them when a newer compatible built-in version exists. `none` skips extension work and does not uninstall existing artifacts.

`extension install` does not rerun core Workspace initialization. In JSON, non-TTY, or `--yes` mode, at least one extension name is required. Multiple names are installed in order with one confirmation boundary and independent transactions; any failure makes the install command fail while later extensions still run.

The bundled `openspec-workspace` extension installs a namespaced `code-workspace-openspec-propose` skill for the selected Agent tools. It does not create an `openspec/` directory or install native OpenSpec commands.

Extension entries run in separate Node processes and generate files in temporary staging directories. The host rejects undeclared, missing, symbolic-link, non-file, path-escaping, conflicting, and checksum-mismatched artifacts before transactionally installing them. Per-Workspace state is stored in `.code-workspace/ext-manifest.json`. A failed extension is reported as a warning and does not roll back successful core initialization or stop later extensions; a failed upgrade restores and retains the previous installed version.

Extensions may own complete files or contribute Host-managed Codex TOML blocks and Hook fragments. Shared targets are composed and verified by Code Workspace; extensions never patch the real Workspace directly. Uninstall uses recorded installed state and does not execute extension code. Unknown changes to extension-owned files or contributions stop the operation instead of being overwritten.

This is fault isolation, not a malicious-code security sandbox. The experimental release trusts only extension code shipped with Code Workspace; network sources, external extension directories, dependencies, arbitrary patches, force uninstall, disable commands, and automatic extension updates through `code-w update` are not supported. The developer contract is in `docs/extensions.md`.

## Register projects

Inspecting a repository is read-only:

```bash
code-workspace project inspect /absolute/path/to/project --json
```

Claude Code users can invoke:

```text
/code-workspace:add-projects /absolute/path/to/project-a /absolute/path/to/project-b
```

Codex users can invoke `$code-workspace-add-projects` with the same explicit paths. For low-level automation, prepare a complete project record and run:

```bash
code-workspace project add --projects-file projects.json --yes --json
```

The registry stores each project's name, real location, registered branch, type, and context. The registered branch is the Code Workspace expected state; the actual branch is observed from the selected Git worktree. Workspace never guesses a path from a conversation or automatically decides which branch is authoritative.

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

Users may manually set the optional project policy in `.code-workspace/config.yaml`:

```yaml
projects:
  - name: payments
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

```bash
code-workspace monitor --port 3211
```

The monitor binds to loopback, combines events from multiple initialized workspaces, and keeps hook reporting failure-open. Review and trust project hooks in Codex before relying on reports.

## Completion

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
