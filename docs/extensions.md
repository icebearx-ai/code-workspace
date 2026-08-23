# Built-in Extension Contract

Code Workspace extensions are trusted, versioned packages shipped inside the npm package under `extensions/<id>/<semver>/`. They are not downloaded from external sources and are not a security sandbox.

Each version contains `manifest.json` and `init.js`. The manifest follows `schemas/extension-manifest-v1.json`. Code Workspace freezes both file hashes before confirmation and verifies them again before execution.

The Host starts the entry with:

```text
node init.js --context <json-file> --output <empty-directory>
```

The context contains only schema version, extension identity, Workspace display identity/language, and selected tools. The child receives a small environment allowlist and never receives the real Workspace path through the contract.

The entry writes exactly the selected artifacts to their declared `output` paths. `file` defaults `output` to `target`; shared artifact kinds require an explicit output. Every output must be a regular file with the declared SHA-256.

Supported artifact kinds:

- `file`: an extension-owned Workspace-relative file. It cannot target a core-managed or shared Host target.
- `codex-config-block`: a TOML fragment installed inside stable extension markers in `.codex/config.toml`. The Host preserves content outside the block and validates the complete TOML document.
- `codex-hooks`: a JSON Hook fragment merged into `.codex/hooks.json`. The Host preserves unrelated hooks and stores the normalized contribution for upgrades and uninstall.

Extensions never write the real Workspace directly and never provide uninstall code. The Host owns planning, conflicts, transactions, verification, state, rollback, and removal.

`code-w extension install <id> --yes` installs or upgrades the highest compatible bundled version without rerunning core Workspace initialization. It accepts multiple ids. Without ids, an interactive TTY lists all valid bundled extensions for multiselect; ESC or an empty selection exits without changes. JSON, non-TTY, and `--yes` calls require at least one id. A batch uses one confirmation boundary and an independent transaction per extension; failures do not stop later extensions but make the standalone install command fail.

`code-w extension uninstall <id> --yes` removes an installed extension from recorded state. It works even when the bundled extension version is no longer present. Unknown local changes stop uninstall; the initial contract intentionally has no force mode.

Init, install, and uninstall share one per-Workspace operation lock so they cannot concurrently change extension artifacts or state.

Stable ownership keys are the extension id plus artifact id. Artifact ids and output paths must remain stable across compatible upgrades when they represent the same logical contribution.
