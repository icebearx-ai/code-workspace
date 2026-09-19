## Why

The current extension picker owns raw-mode input and terminal redraws, which is unreliable in IDE and captured-terminal environments. It also requests Nexus metadata while each search character is typed, making the UI difficult to use under normal network latency.

The picker should use the already-adopted `@clack/prompts` interaction primitives so search, multi-selection, cancellation, loading feedback, and terminal rendering follow one stable prompt implementation.

## What Changes

- Replace the custom raw-mode extension picker UI with a Clack-based flow.
- Use a submitted search prompt instead of issuing a Nexus request for every typed character.
- Use Clack autocomplete multi-select for selecting extensions on the current Nexus page.
- Use an explicit Clack page-action prompt for next page, previous page, search again, done, retry, and cancel.
- Preserve selected extensions and install/update actions across page changes and new searches.
- Keep system-extension filtering, installed-latest disabling, outdated-update behavior, Nexus loading feedback, and existing install/update transactions.
- Remove the production dependency on custom ANSI frame rendering and raw-mode event handling.
- Keep JSON, non-TTY, and `--yes` search behavior read-only and unchanged.

## Capabilities

### New Capabilities

- `clack-extension-picker`: Defines the Clack-based search, multi-select, pagination, loading, retry, cancellation, and selection-preservation interaction.

### Modified Capabilities

- `workspace-init-extensions`: Interactive ordinary-extension selection changes from a custom raw-mode picker to the Clack-based picker while retaining the existing install planning and system-extension rules.

## Impact

- Affects `src/init/ui.js`, the shared extension picker adapter, picker tests, and interactive init/search integration tests.
- Reuses `createRegistryExtensionBrowseSession` and the existing registry lifecycle/state mapping.
- Does not change Nexus APIs, extension installation transactions, CLI command contracts, or non-interactive result envelopes.
