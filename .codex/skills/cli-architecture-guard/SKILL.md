---
name: cli-architecture-guard
description: Guard the OpenSpec Workspace CLI architecture when adding, removing, reviewing, or modifying commands, options, parsing, routing, configuration domains, JSON results, errors, confirmation, transactions, verification, rollback, or documented CLI examples. Use this skill for every change under src/cli or to core services used by CLI commands, even when the user does not explicitly request an architecture review.
---

# CLI Architecture Guard

Keep CLI changes aligned with the repository's command contract, layering, safety, and output conventions.

## Required context

Read `docs/cli-architecture.md` from the repository root completely before reviewing or changing CLI behavior. Treat it as the normative architecture for this repository.

Inspect the relevant existing implementation before deciding on a design:

- `src/cli/registry.js`
- `src/cli/parser.js`
- `src/cli.js`
- `src/cli/result.js`
- `src/cli/confirmation.js`
- the affected file under `src/cli/commands/`
- the affected service under `src/core/`
- adjacent CLI contract and failure-injection tests

## Workflow

1. Determine whether the user requested implementation, review, or diagnosis. Do not turn a review-only request into a code change.
2. Inspect the current diff and preserve unrelated user changes.
3. Write down the contract for every affected command before implementation:

```yaml
command: project example
workspace: required
config: [projects]
interaction: required
effects: planned-write
arguments:
  - name: name
    required: true
options:
  yes: boolean
writes:
  - .openspec-workspace/config.yaml
verification:
  - persisted state matches the requested state
rollback:
  - restore every workspace file changed by the command
```

4. Implement within the declared boundaries. If the command layer needs raw configuration access or filesystem writes, add or extend a core API instead of bypassing the boundary.
5. Add tests appropriate to the command's effects. Cover parsing and output for every command; add confirmation, idempotency, postcondition, failure-injection, and rollback coverage for planned writes.
6. Run:

```bash
node scripts/check-cli-architecture.js
npm test
```

The checker is a repository-owned tool, not a Skill implementation detail. `npm run cli:architecture-check` is the equivalent public project command for developers and CI. Run `npm run check` before handing off a completed implementation when the environment permits packaging checks.

## Decision rules

- Register command semantics in `src/cli/registry.js`; do not parse options inside handlers.
- Load only the configuration domains required by the command.
- Keep command modules focused on planning, confirmation, transaction orchestration, verification, and result construction.
- Put raw configuration reading, domain mutation, serialization, and atomic persistence behind core APIs.
- Use the shared confirmation, result, diagnostic, and error models.
- Verify target state before committing a write transaction; an exit code or successful write call is not a sufficient postcondition.
- Preserve stable error codes and include remediation when the user can take a concrete recovery action.
- Validate documented commands with the real parser.
- Do not weaken the checker to make a violation pass. If the architecture must evolve, update the reference, checker, and tests together and explain the reason.

## Completion report

Use this compact report for implementation and architecture-review requests:

```text
CLI architecture guard: PASS|FAIL

- Registry and parser contract: PASS|FAIL
- Configuration-domain isolation: PASS|FAIL
- Command/core layering: PASS|FAIL
- Transaction and postconditions: PASS|FAIL|N/A
- Output and errors: PASS|FAIL
- Tests and documented commands: PASS|FAIL
```

List concrete violations after the report. Do not report `PASS` if required checks were skipped or known violations remain.
