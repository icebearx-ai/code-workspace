## 1. Boundary and compatibility preparation

- [x] 1.1 Inventory every import, export, package entry, documentation reference and test reference to `src/monitor`.
- [x] 1.2 Add extension-only parity tests covering Session lifecycle, statistics, deletion, SSE, Dashboard, i18n and multi-Workspace aggregation.
- [x] 1.3 Add regression tests proving `codew monitor`, `codew monitor report` and `codew ext monitor serve` do not load `src/monitor`.

## 2. Remove legacy implementation

- [x] 2.1 Delete `src/monitor/index.js`, `src/monitor/page.js` and `src/monitor/i18n/` after all consumers use the extension package.
- [x] 2.2 Remove legacy Monitor exports from `src/index.js` and any public compatibility exports that expose core Monitor business APIs.
- [x] 2.3 Remove core Monitor-specific managed-file capability, templates and initialization branches while preserving extension Hook activation behavior.
- [x] 2.4 Update npm package files, scripts and documentation so `src/monitor` is no longer shipped or referenced.

## 3. CLI and state compatibility

- [x] 3.1 Keep `codew monitor` as a thin alias to the generic Runtime Host with existing port and error behavior.
- [x] 3.2 Keep `codew monitor report` failure-open and verify that unavailable or incompatible services never block Agent tools.
- [x] 3.3 Verify old Workspace `ext-manifest.json` records can still be uninstalled without the legacy Monitor source package.
- [x] 3.4 Verify shared Monitor service identity, compatibility-group checks, User Store references and user-level runtime data remain unchanged.

## 4. Verification and follow-up

- [x] 4.1 Run the complete legacy-to-extension parity matrix and remove tests that directly instantiate the deleted core implementation.
- [x] 4.2 Run CLI architecture checks, full test suite, npm pack check and strict OpenSpec validation.
- [x] 4.3 Add a release note documenting the breaking removal and the required Monitor extension package/runtime prerequisites.
- [x] 4.4 Confirm repository-wide search returns no `src/monitor` imports or package references and record rollback evidence.

<!-- Verification evidence (2026-09-13):
- npm test: 239 pass / 1 skipped (sandbox loopback) / 0 fail
- cli:architecture-check: passed (24 commands, 12 command modules, 92 documented references)
- pack:check: 124 files, no src/monitor in tarball
- openspec validate phase-04-remove-legacy-monitor-core --strict: valid
- Smoke: codew monitor serve (snapshot API + dashboard HTML), codew monitor report failure-open (exit 0)
- Uninstall architecture: planExtensionUninstall reads installed state only (src/core/extensions.js:1326)
- Rollback: revert the phase-04 commits; user-level Monitor runtime data and extension Store are untouched by the removal
-->
