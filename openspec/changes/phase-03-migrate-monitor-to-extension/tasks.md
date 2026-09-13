## 1. Monitor extension package

- [x] 1.1 Create the versioned `extensions/monitor` package and manifest entries for activation and service runtime.
- [x] 1.2 Move Monitor Store, API, Dashboard, i18n and event mapping into the extension package.
- [x] 1.3 Add `init.js` activation output for Workspace Observer Hooks and reporting configuration.
- [x] 1.4 Add global service entry that uses user-level data and the generic Runtime Host contract.

## 2. Multi-Workspace service behavior

- [x] 2.1 Implement service identity, compatibility group and singleton startup policy for Monitor.
- [x] 2.2 Aggregate events from multiple Workspace identities without writing aggregate state to a Workspace.
- [x] 2.3 Preserve Session lifecycle, statistics, deletion, SSE, Dashboard and i18n behavior.
- [x] 2.4 Make Observer reporting failure-open and prevent observer decisions from blocking Agent tools.

## 3. CLI and Workspace migration

- [x] 3.1 Route `codew ext monitor serve` through the generic Runtime Host.
- [x] 3.2 Convert `codew monitor` into a thin compatibility alias with existing common options.
- [x] 3.3 Migrate existing Monitor configuration and Hooks transactionally to Workspace activation.
- [x] 3.4 Ensure uninstall removes only the current Workspace activation and does not stop shared service or delete user data.

## 4. Core separation and regression

- [x] 4.1 Remove all `extensions/monitor` imports of `src/monitor` and add package-boundary checks.
- [x] 4.2 Run identical contract scenarios against the legacy and extension Monitor implementations.
- [x] 4.3 Add tests for two Workspaces, one service, activation uninstall and incompatible versions.
- [x] 4.4 Document the follow-up removal Change for legacy core Monitor after compatibility evidence is collected.
