## 1. Clack picker implementation

- [x] 1.1 Add a prompt-facade based extension picker that collects a submitted Nexus query with Clack text and uses Clack autocomplete multi-select for each mapped page.
- [x] 1.2 Add explicit page-action prompts for next, previous, search again, done, retry, and cancel, including spinner feedback and page/session cleanup.
- [x] 1.3 Preserve selected ids and install/update actions across page navigation and new queries while keeping latest/unavailable options disabled.

## 2. Integration

- [x] 2.1 Switch the production interactive UI extensionPicker adapter to the Clack picker while preserving the existing registry-picker result contract.
- [x] 2.2 Keep init and TTY extension search lifecycle code unchanged except for consuming the new picker, and verify system extensions remain hidden.

## 3. Tests and validation

- [x] 3.1 Add deterministic prompt-facade tests for search submission, multi-select actions, pagination, retry, cancellation, and selection preservation.
- [x] 3.2 Update init/search integration tests for the Clack flow and verify JSON/non-TTY/--yes remain read-only.
- [x] 3.3 Run CLI architecture checks, full tests, package dry-run, and document the new interaction in README/help if needed.
