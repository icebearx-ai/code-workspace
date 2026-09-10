---
description: When explicitly invoked with one or more project paths, inspect Git worktrees read-only, generate concise AI project context, register the completed records in one stdin transaction, and apply Agent directory authorization.
argument-hint: "<project path> [additional project paths]"
---

Run this workflow only when the user explicitly invokes `/code-workspace:add-projects` and provides one or more project paths. Do not infer this invocation from a general request to inspect, update, or add a project. The values in `$ARGUMENTS` are the project paths; preserve quoted paths as single arguments. If no path is provided, ask the user for one or more paths and do not inspect or modify anything.

Expected invocation: `/code-workspace:add-projects /absolute/path/to/project-a /absolute/path/to/project-b`

## Collect evidence once

Use one read-only terminal invocation for `code-workspace language --json` and every supplied path. Inspect each path independently and continue after a path-specific failure:

```bash
code-workspace language --json
for path in "<path-a>" "<path-b>"; do
  printf '\n__PROJECT__ %s\n' "$path"
  output="$(code-workspace project inspect "$path" --json)"
  status=$?
  printf '%s\n' "$output"
  printf '__STATUS__ %s\n' "$status"
done
```

Require the standard envelope fields `schemaVersion`, `ok`, `command`, `data`, and `diagnostics`. Use `data.language` and the labels in `data.projectContext` for every generated project context in this invocation. If the language command fails, stop: the workspace language contract is unavailable.

For each inspection:

- When `ok` is true, treat only `data.project.location`, `data.project.branch`, and `data.project.facts` as CLI-verified facts, then inspect the repository read-only.
- When `ok` is false, retain the path, diagnostic code, message, and remediation. Do not inspect that repository or create a project record for it.
- Continue collecting the remaining paths. Do not stop at the first failed project.

## Prepare records

For each valid inspection, read only what is needed to understand the repository, starting with README files, root manifests, and relevant entry points or module directories. Do not modify the project repository.

Produce a complete project record with `name`, canonical `location`, current `branch`, a concise semantic `type`, and `context`.

Generate `context` as concise, stable project navigation for an AI that has not read the repository. Use exactly four semantic lines in this order: `responsibility`, `technologyStack`, `codeLocations`, and `projectBoundary`. Prefix each line with the corresponding label returned in `data.projectContext`; do not translate or replace those labels yourself. Write descriptions in the returned workspace `data.language`. Keep project names, paths, branches, technology names, identifiers, and code symbols unchanged. Prefer 150-400 Chinese characters or comparable English length. Do not include exhaustive dependencies, volatile command details, filler, or unsupported guesses.

## Confirm once

Present all valid records and every failed path together. If any path failed, state clearly that only the valid records will be written and do not treat the failed paths as ignored without user confirmation. Ask for one decision:

- add the valid records;
- correct and retry failed paths;
- cancel.

If there are no valid records, stop without writing.

## Register through stdin

After confirmation, serialize one JSON document with `schemaVersion: 1` and a non-empty `projects` array containing only the confirmed valid records. Send it to `code-workspace project add` over stdin:

```bash
code-workspace project add --stdin --yes --json
```

Use the runtime's native stdin channel when available. Do not create a temporary JSON file and do not place the JSON document in command arguments. If a shell heredoc is the only available transport, use a unique, unpredictable, quoted delimiter and pass the serialized JSON unchanged.

Completion requires `ok: true`, the expected registered projects, and every applicable permission result to report `verified: true`. `project add` performs the existing configuration and authorization postcondition verification inside its transaction. Do not run `code-workspace project verify --json` by default; run it only when the user explicitly asks for an independent final check.

Do not hand-edit `.code-workspace/config.yaml` or permission files.

$ARGUMENTS
