## 1. Runtime manifest and resolution

- [x] 1.1 Define runtime entry, protocol version, execution scope, mode, service id and compatibility metadata.
- [x] 1.2 Update manifest validation and schema without changing installation-only extensions.
- [x] 1.3 Resolve workspace runtime from activation and global runtime from the User Extension Store.
- [x] 1.4 Add stable errors for unavailable package, stale entry, missing activation and unsupported capability.

## 2. `ext` CLI

- [x] 2.1 Register static `ext` command with optional Workspace resolution and no extension-specific options.
- [x] 2.2 Implement extension-id boundary and opaque argv parsing, including explicit `--` compatibility.
- [x] 2.3 Implement generic runtime dispatch and unified text/JSON result handling for oneshot commands.
- [x] 2.4 Ensure no dynamic top-level command registration or Monitor-specific handler exists.

## 3. Runtime process host

- [x] 3.1 Implement oneshot execution with context isolation, output limits, timeout, exit-code and result validation.
- [x] 3.2 Implement service execution with inherited stdio, readiness timeout and process-group management.
- [x] 3.3 Forward SIGINT/SIGTERM and release runtime references on normal, failed and signaled exits.
- [x] 3.4 Prevent global services from receiving arbitrary Workspace paths or private configuration.

## 4. Service compatibility

- [x] 4.1 Implement service identity, compatibility-group and singleton policy validation.
- [x] 4.2 Reject incompatible service activation without silently replacing a running service.
- [x] 4.3 Add runtime process records that pin Store packages until service exit.

## 5. Tests and architecture checks

- [x] 5.1 Add parser tests for Host options, opaque extension options and invalid ordering.
- [x] 5.2 Add oneshot fixture tests for success, invalid JSON, timeout, output limit and identity mismatch.
- [x] 5.3 Add service fixture tests for readiness, long-running behavior, signals and startup failure.
- [x] 5.4 Run CLI architecture checks and verify the kernel has no extension-specific business imports.
