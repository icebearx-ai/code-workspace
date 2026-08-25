# Built-in Extension Contract

Code Workspace extensions are trusted, versioned packages shipped under `extensions/<id>/<semver>/`. The extension process is fault-isolated, but it is not a security sandbox: bundled extension code runs with the current user's operating-system permissions.

Each version contains `manifest.json`, `init.js`, and any private templates, metadata, or helper code it needs. The current Host explicitly supports Extension Spec v1, defined in English at `spec/extension/v1/specification.en-US.md` and in Chinese at `spec/extension/v1/specification.zh-CN.md`, with these component schemas:

- `schemas/extension-manifest-v3.json`
- `schemas/extension-init-context-v1.json`
- `schemas/extension-init-result-v1.json`

The static manifest declares its `extensionSpecVersion`, identity, entry hash and timeout, declarative network hosts, and maximum output scope. The Host executes only explicitly supported specification versions; the Code Workspace product version is not an extension compatibility key. Code Workspace freezes the specification version, manifest, entry, and complete extension-version directory digest before confirmation, then verifies them again before execution.

The Host starts the entry with independent temporary paths:

```text
node init.js --context <context-file> --output <staging-directory> --result <result-file>
```

The context contains the specification version, extension identity, Workspace display metadata, and selected tools. It does not expose the real Workspace path. The result echoes the same specification version and contains only the extension identity and `{ id, source }` entries. It must return exactly every manifest output applicable to the selected tools; it cannot redefine target, kind, ownership, selector, or digest.

The Host recursively validates staging, rejects undeclared content, path escapes, symbolic links, and special files, and independently computes installed file and directory digests. Extensions never write the real Workspace or installed state directly and never provide uninstall code.

## Generic output kinds

- `file`: one extension-owned Workspace-relative regular file.
- `directory`: one extension-owned Workspace-relative directory tree containing only regular files and directories.
- `text-block`: a Host-marked fragment in a shared text file. `format: "toml"` validates both the fragment and the complete composed document.
- `json-member`: one JSON value owned at a declared JSON Pointer in a shared object document.

Exclusive targets cannot overlap core-managed paths or another extension's targets. Shared text blocks can coexist in the same text target. JSON member ownership rejects equal or parent/child selectors. The Host preserves user, core, and other extension content during install, upgrade, rollback, and uninstall.

Download protocols, archive formats, package managers, Jira, MCP, and individual Agent products are not public output kinds. An extension may use those details privately to prepare a candidate file or directory in staging. Declarative `networkHosts` are shown in the plan for review; they are not operating-system-level egress enforcement.

The installed manifest is the only installation fact. New records contain the installed-record version, Extension Spec version, extension version, frozen package and manifest digests, generic output ownership, Host-computed digests, and shared contribution data. Idempotency verifies both this state and the real Workspace. Upgrade handles retained, added, replaced, and removed outputs in one per-extension recoverable transaction. Uninstall reads only installed state, so it still works when the bundled package or execution specification is absent. Unknown local changes stop upgrade or uninstall; there is no force mode.

Previously published installed protocol-v1/v2 records for files, Codex configuration blocks, and Codex Hooks remain readable and uninstallable. They are compatibility state, not new Extension Spec v1 output kinds.

`init`, `extension install`, and `extension uninstall` share one non-blocking per-Workspace operation lock. A multi-extension install uses one confirmation boundary and an independent transaction per extension; a failure does not stop later extensions, but the overall command reports failure.

## Zhuiyi Jira MCP

Install it with:

```bash
code-w extension install zhuiyi-jira-mcp --yes
```

The Jira extension privately downloads the pinned Gitee release, verifies its fixed SHA-256, safely extracts it, and validates the npm package name, version, and `dist/index.js` entry inside staging. The archive already contains `dist` and runtime dependencies; initialization never runs `npm install`, `npm ci`, a build, or an archive script.

After validation, the Host installs only generic outputs:

```text
.code-workspace/extensions/zhuiyi-jira-mcp/0.1.0/   # directory
.codex/config.toml                                  # text-block when Codex is selected
.mcp.json#/mcpServers/zhuiyi-jira                   # json-member when Claude is selected
```

The generated configuration contains non-secret defaults only. It never persists a Jira cookie, token, email, or password; provide credentials in the environment that launches the Agent, for example:

```bash
export JIRA_COOKIE='JSESSIONID=...; atlassian.xsrf.token=...'
```

Downloaded attachments default to `.jira-attachments/` in the Workspace. They are runtime user data, not installation artifacts, and are retained when the extension is upgraded or uninstalled.
