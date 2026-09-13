## 1. Boundary and compatibility preparation

- [ ] 1.1 Inventory every import, export, package entry, documentation reference and test reference to `src/monitor`.
- [ ] 1.2 Add extension-only parity tests covering Session lifecycle, statistics, deletion, SSE, Dashboard, i18n and multi-Workspace aggregation.
- [ ] 1.3 Add regression tests proving `codew monitor`, `codew monitor report` and `codew ext monitor serve` do not load `src/monitor`.

## 2. Remove legacy implementation

- [ ] 2.1 Delete `src/monitor/index.js`, `src/monitor/page.js` and `src/monitor/i18n/` after all consumers use the extension package.
- [ ] 2.2 Remove legacy Monitor exports from `src/index.js` and any public compatibility exports that expose core Monitor business APIs.
- [ ] 2.3 Remove core Monitor-specific managed-file capability, templates and initialization branches while preserving extension Hook activation behavior.
- [ ] 2.4 Update npm package files, scripts and documentation so `src/monitor` is no longer shipped or referenced.

## 3. CLI and state compatibility

- [ ] 3.1 Keep `codew monitor` as a thin alias to the generic Runtime Host with existing port and error behavior.
- [ ] 3.2 Keep `codew monitor report` failure-open and verify that unavailable or incompatible services never block Agent tools.
- [ ] 3.3 Verify old Workspace `ext-manifest.json` records can still be uninstalled without the legacy Monitor source package.
- [ ] 3.4 Verify shared Monitor service identity, compatibility-group checks, User Store references and user-level runtime data remain unchanged.

## 4. Verification and follow-up

- [ ] 4.1 Run the complete legacy-to-extension parity matrix and remove tests that directly instantiate the deleted core implementation.
- [ ] 4.2 Run CLI architecture checks, full test suite, npm pack check and strict OpenSpec validation.
- [ ] 4.3 Add a release note documenting the breaking removal and the required Monitor extension package/runtime prerequisites.
- [ ] 4.4 Confirm repository-wide search returns no `src/monitor` imports or package references and record rollback evidence.
