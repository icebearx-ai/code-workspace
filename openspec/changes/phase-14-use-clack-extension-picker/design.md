## Context

The current shared extension picker owns `readline` raw mode, key normalization, and terminal-frame rendering. This duplicates behavior already implemented by `@clack/prompts` and is unreliable in IDE terminals and captured output environments. The Registry browse session already provides server-side pagination, lazy metadata loading, previous/next navigation, retry, and query isolation; only the presentation layer needs to change.

The picker is used by both interactive `init` and TTY `extension search`. Its result must remain a list of extension ids plus install/update actions so the existing planning and transaction layers remain unchanged.

## Goals / Non-Goals

**Goals:**

- Use `@clack/prompts` for all production picker input and rendering.
- Submit a search query before contacting Nexus rather than querying for every typed character.
- Support multi-selection on each page, explicit previous/next page actions, search-again, retry, completion, and cancellation.
- Preserve selections and install/update actions across pages and new searches.
- Keep installed-latest disabled, installed-outdated selectable as update, uninstalled selectable as install, and system extensions hidden.
- Provide spinner feedback while Nexus pages and metadata are loading.

**Non-Goals:**

- Do not change the Nexus API or browse-session pagination contract.
- Do not change extension state mapping, install/update planning, confirmation, transactions, or result envelopes.
- Do not preserve the old single-screen left/right raw-mode interaction as a compatibility requirement.
- Do not change JSON, non-TTY, or `--yes` search behavior.

## Decisions

1. **Use Clack prompts instead of custom raw mode.** Production `extensionPicker` will compose Clack `text`, `autocompleteMultiselect`, `select`, `spinner`, and cancellation handling. The existing custom raw-mode implementation is not used by production paths after migration. This reuses the renderer and key handling already used by the rest of the interactive CLI.

2. **Use an explicit query-submit boundary.** A Clack text prompt collects the global Nexus query. The browse session is created only after Enter, so network latency cannot block or drop individual search keystrokes. `autocompleteMultiselect` may still filter the currently loaded page locally.

3. **Use one multi-select prompt per server page.** Each page is mapped to Clack options with `value`, descriptive `label`, status `hint`, and `disabled` state. `maxItems` is used for viewport scrolling; server pagination remains owned by the browse session.

4. **Use a page-action select prompt.** After confirming a page, a Clack select prompt offers only valid actions: next page, previous page, search again, done, retry when needed, and cancel. This replaces left/right global key handling while keeping pagination explicit and discoverable.

5. **Keep selection state outside prompts.** A shared map keyed by extension id stores selected ids and actions. Before displaying a page, selections belonging to that page are passed as `initialValues`; after the prompt returns, current-page values are merged back. Search changes and page navigation therefore do not lose selections.

6. **Preserve lifecycle boundaries.** `createRegistryExtensionPicker` continues to provide a browse-session adapter and status mapping. The Clack picker returns the same `{ status, selections }` contract consumed by `init` and `extension search`; no command handler or transaction code is duplicated.

7. **Show latency and recoverable failures explicitly.** A Clack spinner wraps `session.next`, `session.previous`, and `session.retry`. A page failure is presented through a Clack action prompt so the user can retry, search again, or cancel without writing Workspace state. Partial metadata diagnostics remain non-fatal and are shown as a note/status message.

8. **Keep a narrow test seam.** The picker accepts an injected prompt facade and browse-session provider in tests. Production uses the Clack facade from `createInteractiveUi`; tests do not need a real TTY and can deterministically exercise prompt results, pagination, cancellation, and selection merging.

## Risks / Trade-offs

- [One page requires an additional action prompt] → The flow is less compact than the old single screen, but every action is visible and does not depend on terminal-specific arrow behavior.
- [Search is submitted instead of live server filtering] → This avoids per-keystroke network requests; page-local autocomplete still provides fast local filtering.
- [A user must navigate back to deselect an item from a prior page] → Selected values are restored when the page is revisited, preserving full control without custom cross-page raw state.
- [Clack prompt API changes in a future dependency upgrade] → Keep the prompt facade narrow and cover it with injected tests.

## Migration Plan

1. Add the Clack picker flow behind the existing `ui.extensionPicker` contract.
2. Add unit tests for prompt orchestration and selection/action merging, plus init/search integration coverage.
3. Switch production UI to the new flow and remove custom raw-mode rendering from the production path.
4. Run the full test suite, CLI architecture checks, and package dry-run.
5. If migration fails, restore the previous picker call site; Registry lifecycle and command transaction code remain unaffected.

## Open Questions

- None for this phase. Left/right single-screen pagination is intentionally replaced by the explicit page-action prompt.
