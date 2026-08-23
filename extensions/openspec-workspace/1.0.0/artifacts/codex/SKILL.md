---
name: code-workspace-openspec-propose
description: Create an OpenSpec change for a selected Code Workspace project after resolving and verifying that project's registered scope.
---

# Code Workspace OpenSpec Propose

Use this skill only when the user explicitly asks to create an OpenSpec proposal for a project registered in Code Workspace.

1. Resolve exactly one target project with `code-w project show "<project-name>" --json` and retain its `location`, `branch`, `type`, and `context` as the working boundary.
2. Verify that target with `code-w project verify "<project-name>" --json`. If branch reconciliation is required, stop and use the Code Workspace branch-resolution workflow before creating a change.
3. Change the working directory to the verified project location. Do not create the OpenSpec change in the Workspace registry directory.
4. Follow the installed OpenSpec propose workflow in that project. Derive a kebab-case change name, create the change, and generate every artifact required for apply.
5. Report the project name, change name, artifact paths, validation status, and whether the change is ready to implement.

Do not modify `.code-workspace/`, do not broaden the request to other registered projects, and do not implement or archive the change unless the user asks.
