---
name: code-workspace-add-projects
description: When explicitly invoked with one or more project paths, inspect Git worktrees read-only, generate concise AI project context, register the completed records locally, and apply Agent directory authorization.
---

# Add local projects

Run this workflow only when the user explicitly invokes `$code-workspace-add-projects` and provides one or more project paths. Do not infer this invocation from a general request to inspect, update, or add a project. The arguments after the skill name are the project paths; preserve quoted paths as single arguments. If no path is provided, ask the user for one or more paths and do not inspect or modify anything.

Expected invocation: `$code-workspace-add-projects /absolute/path/to/project-a /absolute/path/to/project-b`

Before inspecting projects, run `code-workspace language --json` once. Require the standard envelope fields `schemaVersion`, `ok`, `command`, `data`, and `diagnostics`, then use `data.language` and the labels in `data.projectContext` for every generated project context in this invocation.

For each supplied path:

1. Run `code-workspace project inspect "<path>" --json`. Treat only its location, branch, manifest-file list, README-file list, and top-level entry list as CLI-verified facts.
2. Inspect the repository read-only. Read only what is needed to understand it, starting with README files, root manifests, and relevant entry points or module directories. Do not modify the project repository.
3. Produce a complete project record with `name`, canonical `location`, current `branch`, a concise semantic `type`, and `context`.
4. Generate `context` as concise, stable project navigation for an AI that has not read the repository. Use exactly four semantic lines in this order: `responsibility`, `technologyStack`, `codeLocations`, and `projectBoundary`. Prefix each line with the corresponding label returned in `data.projectContext`; do not translate or replace those labels yourself. Write descriptions in the returned workspace `data.language`. Keep project names, paths, branches, technology names, identifiers, and code symbols unchanged. Prefer 150-400 Chinese characters or comparable English length. Do not include exhaustive dependencies, volatile command details, filler, or unsupported guesses.

Present all completed records for confirmation. After confirmation, write them to a temporary JSON document with `schemaVersion: 1` and a non-empty `projects` array, then run:

```bash
code-workspace project add --projects-file <temporary-json-file> --yes --json
code-workspace project verify --json
```

Do not hand-edit `.code-workspace/config.yaml` or permission files. Completion requires successful registration, authorization application, and project verification.
