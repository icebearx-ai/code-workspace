# Follow-up Change: Remove legacy core Monitor

After one release cycle of extension/legacy contract evidence, create a numbered Change to remove `src/monitor/` and the legacy Monitor exports. The cleanup Change must first preserve the compatibility alias (`codew monitor`) by routing it exclusively through `codew ext monitor serve`, retain the failure-open report path, and delete the old implementation only after the parity and multi-Workspace tests in this Change remain green.

The cleanup must also remove the core monitor managed-file capability and any migration-only compatibility code, while preserving user-level Monitor runtime data and Workspace activation uninstall semantics.
