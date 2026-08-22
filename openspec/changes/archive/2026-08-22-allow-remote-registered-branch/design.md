## Context

The existing `use-registered` command performs a clean-worktree and local-branch preflight before `git switch`. Its external-effect contract intentionally forbids implicit branch creation and fetch. Remote support must therefore be explicit and must not make the command layer execute raw Git commands.

## Decisions

### Explicit modes

- No new option: require an existing local registered branch, preserving compatibility.
- `--allow-remote`: use one unique existing `refs/remotes/<remote>/<branch>` reference; do not access the network.
- `--remote <name>`: fetch only `refs/heads/<branch>` from the named configured remote, then create a local tracking branch. The option itself is the user's authorization for network access.
- Reject `--allow-remote` combined with `--remote` as redundant and ambiguous.

### Planning and interaction

Inspection records remote-tracking candidates without changing state. The command builds an acquisition plan before confirmation. Confirmation lists whether the operation is a local switch, tracking-branch creation, or fetch plus creation plus switch. `--yes` suppresses the prompt only for already authorized non-interactive callers; JSON/non-TTY calls without it return the existing confirmation diagnostic.

### Core operations

The core layer owns remote enumeration, exact fetch, tracking-branch creation, and verification. For fetch mode it uses an explicit branch refspec and `--no-tags`, then resolves the fetched remote HEAD before creating the local branch. It never overwrites an existing local branch.

### Failure and compensation

Fetch failure leaves the current branch unchanged and returns a stable fetch diagnostic. After a branch has been created/switched, existing compensation attempts to restore the original branch. The first implementation does not auto-delete a newly created branch; if it remains after a failure, the result reports it as a retained Git effect with manual remediation.

### Batch behavior

Batch commands retain best-effort per-project execution and one confirmation boundary. The confirmation lists each project's acquisition mode and remote. A failure in one project does not hide completed results for other projects.

## Data and diagnostics

Successful switch results retain existing `before`/`after` fields and add:

```json
{
  "acquisition": {
    "mode": "local|remote-tracking|fetched",
    "remote": "origin",
    "remoteBranch": "origin/main",
    "targetHead": "<oid>",
    "localBranchCreated": true
  }
}
```

Stable errors include `PROJECT_BRANCH_REMOTE_AMBIGUOUS`, `PROJECT_BRANCH_REMOTE_MISSING`, `PROJECT_BRANCH_FETCH_FAILED`, and `PROJECT_BRANCH_CREATE_FAILED`. Existing missing-local behavior remains `PROJECT_REGISTERED_BRANCH_MISSING` when no remote mode was requested.

## Verification strategy

Cover parser contracts, local compatibility, unique/ambiguous remote-tracking refs, explicit fetch success/failure, remote configuration errors, post-switch verification and compensation, retained created branches, batch summaries, text/JSON output, and Skill/documented command references.
