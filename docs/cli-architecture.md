# CLI Architecture Contract

This document defines the CLI architecture contract for Code Workspace.

## 1. Command declaration

Every command is declared in `src/cli/registry.js`. Its declaration is the source of truth for:

- command path;
- positional arguments;
- option names and types;
- workspace requirement;
- configuration domains;
- interaction policy;
- effect classification.

Handlers must consume the parser result. They must not reinterpret raw `argv`, silently accept unknown options, or ignore extra positionals.

A command may declare only its final positional argument as `variadic: true`. The parser then accepts zero or more values for an optional variadic argument, or one or more values for a required variadic argument. Each value remains a separate shell argument; commands must not invent comma-delimited positional parsing.

Supported classifications are:

```text
workspace: none | optional | required | target
interaction: never | optional | required
effects: read-only | planned-write | external
config: identity | language | monitor | projects | complete
```

Use `complete` only when a command genuinely requires every configuration domain.

## 2. Recognition and loading order

The runtime order is:

```text
parse and recognize command
→ resolve workspace requirement
→ load declared configuration projection
→ dispatch handler
```

Command validity must not depend on the current directory being a workspace. A command with `workspace: none` must remain workspace-independent.

## 3. Configuration boundaries

Commands load the smallest configuration projection needed for their behavior. An invalid unrelated domain must not block the command.

The command layer may call public core APIs such as projections, domain services, transaction helpers, or canonical configuration saves. It must not:

- import `src/core/fs.js`;
- call `atomicWrite` directly;
- call `readConfigDocument` or `renderConfigDocument` directly;
- serialize workspace configuration itself;
- directly create, overwrite, rename, or delete workspace files.

When a command needs a targeted mutation that the core layer does not expose, add a core API. That API owns raw document access, concurrency checks, mutation, canonical rendering, and atomic persistence.

Presentation formatting is not configuration persistence. A command may use YAML to render read-only text output as long as that output is not written back as workspace configuration.

## 4. Command execution model

Read-only commands inspect state and return a result without writing or prompting.

Planned writes follow this model:

```text
inspect
→ plan
→ validate plan
→ apply declared confirmation policy
→ start transaction
→ call core operation
→ verify complete postconditions
→ commit
```

Failure after transaction start must roll back or explicitly report retained external effects. A successful process exit or write call does not prove the target state is complete.

Commands with `interaction: required` use the shared confirmation helper and declare a boolean `--yes` option. JSON and non-TTY execution must not prompt.

External-effect commands must verify observable postconditions when possible and report effects that cannot be rolled back.

Commands that accept several independent targets use best-effort batching unless their contract explicitly requires one atomic set. They apply one confirmation boundary before the first effect, preserve the existing transaction or compensation boundary for each target, continue after a target-specific failure, and return a complete ordered summary. A batch-level failure must not hide successful or skipped target results.

## 5. Results and errors

All handlers return the shared result model through `success()`, `fromDiagnostics()`, or another result helper. JSON output uses the stable envelope:

```json
{
  "schemaVersion": 1,
  "ok": true,
  "command": "project.list",
  "data": {},
  "diagnostics": []
}
```

Expected failures use `WorkspaceError` with a stable code. Include structured details such as the affected file, project, expected value, actual value, and remediation when available.

Warnings belong in diagnostics so JSON and text renderers can apply their respective output policies.

Single-target invocations retain their established data contract. Multi-target invocations return `data.scope: "selection"`, the requested target names, ordered per-target results, and succeeded/skipped/failed counts. Their top-level `ok` is false when any target fails, while the data still reports every completed target.

## 6. Required tests

Every new or changed command covers:

- valid option ordering;
- unknown options and extra positionals through the shared parser;
- text and JSON result behavior;
- stable error codes;
- declared configuration-domain isolation;
- documented command references when examples change.

Planned writes additionally cover:

- confirmation before mutation;
- idempotent or skip behavior when already current;
- every meaningful write or verification failure stage;
- filesystem state after rollback;
- concurrency or stale-plan detection where state can change between planning and apply;
- complete postcondition verification before commit.

## 7. Architecture changes

These rules guard the intended boundaries, not accidental implementation details. A deliberate architecture change is allowed only when the reference, deterministic checker, and tests are updated together with a clear rationale. Do not add local exceptions inside a command merely to bypass the guard.
