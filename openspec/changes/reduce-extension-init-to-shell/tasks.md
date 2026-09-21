## 1. Shell generation

- [x] 1.1 Remove default output, target, and template options from scaffold generation; generate an empty root README.md and a root .gitignore containing /dist.
- [x] 1.2 Generate a capability-neutral manifest and empty init entry with correct base metadata and digests.
- [x] 1.3 Allow digest update to operate on incomplete shell manifests while preserving strict pack validation.
- [x] 1.4 Load static scaffold files recursively from `artifacts/templates/extension-init/`; keep only dynamic metadata and digest generation in code.

## 2. CLI interaction and contracts

- [x] 2.1 Remove target/template options from the init registry contract.
- [x] 2.2 Add TTY prompts for id, display name, description, and version only, with explicit options taking precedence.
- [x] 2.3 Return clear incomplete-capability diagnostics from pack.

## 3. Tests and docs

- [x] 3.1 Update scaffold tests for the shell files, root README.md/.gitignore defaults, and generic metadata behavior.
- [x] 3.2 Add tests proving incomplete shells cannot pack and can update digests.
- [x] 3.3 Update extension development documentation.
- [x] 3.4 Run architecture, test, and package checks.
