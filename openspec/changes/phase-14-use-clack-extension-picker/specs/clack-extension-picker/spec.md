## ADDED Requirements

### Requirement: Clack-based extension search flow
The production interactive extension picker SHALL use `@clack/prompts` primitives for query input, page selection, page actions, loading feedback, and cancellation, and SHALL NOT require application-owned raw-mode event parsing or full-screen ANSI rendering.

#### Scenario: Search query is submitted before Registry access
- **WHEN** the user opens the picker and types a query
- **THEN** the picker does not request Nexus metadata until the user submits the query prompt

#### Scenario: Picker cancellation
- **WHEN** the user cancels any Clack prompt
- **THEN** the picker returns a cancelled result with no selections and no Workspace write

### Requirement: Page-local multi-selection
The picker SHALL render each loaded Registry page with Clack multi-selection options. Each option SHALL preserve the mapped extension id, description, install/update action, and disabled state.

#### Scenario: Select an installable extension
- **WHEN** the current page contains an uninstalled extension and the user selects it
- **THEN** the picker returns the extension id with action `install`

#### Scenario: Select an outdated extension
- **WHEN** the current page contains an installed extension whose candidate is newer
- **THEN** the picker allows selection and returns action `update`

#### Scenario: Latest and unavailable extensions
- **WHEN** an extension is installed at the latest candidate or has no usable candidate
- **THEN** the option is disabled and cannot be selected

### Requirement: Explicit page navigation
After a page multi-select prompt completes, the picker SHALL present an explicit page-action prompt offering only actions valid for the current browse state, including previous page, next page, search again, done, retry when a page failed, and cancel as applicable.

#### Scenario: Next page
- **WHEN** the current page reports another page
- **THEN** the page-action prompt offers next page and loading it preserves selections from the current page

#### Scenario: Last page
- **WHEN** the current page has no continuation
- **THEN** next page is not offered and the user can still choose previous page, search again, done, or cancel

### Requirement: Selection preservation across pages and queries
The picker SHALL preserve selected extension ids and their actions while navigating pages or submitting a new search query, and SHALL restore selections when a previously visited page is shown again.

#### Scenario: Return to a previous page
- **WHEN** the user selects an extension on page one, visits page two, and returns to page one
- **THEN** the page-one option is shown selected and remains part of the final result unless explicitly deselected

#### Scenario: Search again
- **WHEN** the user submits a new query after making selections
- **THEN** previous selections remain tracked, and matching options on the new result pages are initialized as selected

### Requirement: Loading and recoverable Registry failures
The picker SHALL show Clack spinner feedback while loading a Registry page and SHALL expose retry, search-again, and cancel actions when a page request fails. Partial metadata diagnostics SHALL not discard successfully loaded page items.

#### Scenario: Slow Nexus page
- **WHEN** a page request takes measurable time
- **THEN** the picker displays a loading message until the page is available

#### Scenario: Retryable page failure
- **WHEN** a page request fails with a recoverable Registry error
- **THEN** the picker keeps the current selection state and allows retry without writing Workspace state

### Requirement: Existing lifecycle contract remains unchanged
The Clack picker SHALL return the existing picker result contract consumed by `init` and TTY `extension search`, and SHALL leave status mapping, system-extension filtering, confirmation, install/update planning, transactions, rollback, and non-interactive search behavior unchanged.

#### Scenario: Init consumes selections
- **WHEN** init completes the Clack picker with selected extensions
- **THEN** init receives the same extension ids and actions used by the existing registry lifecycle adapter

#### Scenario: Non-interactive search
- **WHEN** `extension search` runs in JSON, non-TTY, or `--yes` mode
- **THEN** it remains read-only and does not invoke the Clack picker
