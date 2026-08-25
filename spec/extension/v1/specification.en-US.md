# Code Workspace Extension Spec v1

[简体中文](./specification.zh-CN.md) | [English](./specification.en-US.md)

> Status: Normative translation  
> Extension Spec version: 1  
> Language: English  
> Interpretation baseline: `specification.zh-CN.md`  
> Published at: `spec/extension/v1/specification.en-US.md`

This document and the JSON Schemas it references together constitute Code Workspace Extension Spec v1. Compatibility between an extension and a Host is determined only by `extensionSpecVersion`; it does not depend on the Code Workspace product version or the extension version.

## 0. Document Status and Conformance

### 0.1 Normative Keywords

The terms MUST and MUST NOT express conformance requirements. SHOULD means that a requirement is expected unless there is a specific, explainable reason not to follow it. MAY indicates permitted but optional behavior.

### 0.2 Normative Components

The normative artifacts of Extension Spec v1 are:

- the entry, capability, output, staging, installation, upgrade, verification, and uninstall semantics defined by this document;
- manifest schema v3: `schemas/extension-manifest-v3.json`;
- init context schema v1: `schemas/extension-init-context-v1.json`;
- init result schema v1: `schemas/extension-init-result-v1.json`.

The JSON Schemas define document structure. This document defines cross-document and lifecycle semantics. A conflict between them is a specification defect; Hosts and extensions MUST NOT infer compatibility from such a conflict.

The Chinese and English specifications MUST express the same conformance requirements and preserve corresponding section structures. If the two languages produce different interpretations, the difference is a specification defect. Until corrected, the Chinese specification is the interpretation baseline, and a translation difference MUST NOT be treated as a compatibility capability.

### 0.3 Conforming Parties

A conforming Spec v1 Host MUST implement every Host requirement in this document and MUST execute only extensions that pass the Spec v1 schema and lifecycle validations. A conforming Spec v1 extension MUST declare `extensionSpecVersion: 1`, follow the corresponding schemas, and MUST NOT bypass the Host when managing artifacts in the real Workspace.

All JSON, command, and directory-layout examples in this document are non-normative. They illustrate the rules but do not expand or narrow the requirements.

## 1. Versioning and Compatibility

Extension Spec versions are discrete positive integers. A Host MUST explicitly list the versions it implements. An extension MUST declare exactly one version.

```text
compatible ⇔ extension.extensionSpecVersion ∈ host.supportedExtensionSpecVersions
```

A component `schemaVersion` describes the format of one JSON document. `extensionSpecVersion` describes the complete development and execution contract between a Host and an extension.

A product release, a private implementation change, or an extension SemVer change does not automatically create a new Extension Spec. A new specification version is required only when the manifest, context/result, output, or lifecycle contract has a non-backward-compatible, machine-observable change.

## 2. Stable Discovery Envelope

Every manifest in every specification version MUST retain the following fields so that an older Host can identify, but not execute, an unknown specification:

```json
{
  "extensionSpecVersion": 1,
  "id": "example-extension",
  "name": "Example Extension",
  "version": "1.0.0"
}
```

For an unknown `extensionSpecVersion`, the Host MUST read only these fields and MUST NOT interpret the entry, capabilities, or outputs. When an extension contains multiple versions, the Host selects the highest extension SemVer implemented against a specification version that the Host supports.

## 3. Manifest

A Spec v1 manifest uses manifest schema v3. The manifest is the static declaration of installation permissions and maximum output scope; it is not a post-execution report.

```json
{
  "schemaVersion": 3,
  "extensionSpecVersion": 1,
  "experimental": true,
  "id": "example-extension",
  "name": "Example Extension",
  "version": "1.0.0",
  "entry": "init.js",
  "entrySha256": "<sha256>",
  "timeoutMs": 30000,
  "capabilities": {
    "networkHosts": ["example.com"]
  },
  "outputs": [
    {
      "id": "runtime",
      "kind": "directory",
      "ownership": "exclusive",
      "target": ".code-workspace/extensions/example-extension/1.0.0"
    }
  ]
}
```

The `codeWorkspace` product-version range is not part of Extension Spec and MUST NOT appear in a Spec v1 manifest.

Before confirmation, the Host MUST freeze the manifest, entry, and complete extension-version directory digest. The Host MUST verify them again before execution. An extension MUST NOT use a dynamic result to expand the declarations in its manifest.

## 4. Execution Entry

The entry MUST be `init.js` inside the extension-version directory. The Host executes it with the current Node.js runtime:

```text
node init.js --context <context.json> --output <staging-directory> --result <result.json>
```

The Host MUST pass only the environment-variable allowlist required for execution. Process isolation is not a security sandbox; Spec v1 executes trusted bundled extensions only.

The entry MUST exit within the timeout declared by the manifest. A failure, timeout, missing result, or invalid result MUST NOT produce writes to the real Workspace.

## 5. Context and Result

The context and result MUST both echo `extensionSpecVersion: 1`. The value MUST match the frozen plan.

The context contains only extension identity, non-sensitive Workspace display metadata, and the selected tools. It MUST NOT contain the real Workspace root or credentials.

The result contains only the extension identity and a list of `{id, source}` entries. It MUST NOT declare targets, kinds, ownership, selectors, digests, or network capabilities.

## 6. Capability Declarations

Spec v1 defines only `capabilities.networkHosts`. The field is used in planning, confirmation, and diagnostics to describe the HTTPS hosts that the extension expects to access.

Without operating-system-level enforcement, the Host MUST NOT claim that it can prevent a trusted extension from accessing other network or user resources.

## 7. Output Kinds

Spec v1 supports four output kinds:

| kind | ownership | Lifecycle semantics |
|---|---|---|
| `file` | `exclusive` | The Host exclusively writes, digests, drift-checks, and removes one regular file |
| `directory` | `exclusive` | The Host exclusively replaces, canonically digests, drift-checks, and recursively removes a directory |
| `text-block` | `shared` | The Host manages a marked text contribution using the extension id and output id |
| `json-member` | `shared` | The Host manages one member selected by JSON Pointer while preserving other content |

Public output kinds MUST NOT encode private business concepts such as Jira, MCP, npm, archive formats, or individual Agent products.

## 8. Staging Verification

An extension MUST generate candidate content only inside the staging directory supplied by the Host. The Host MUST:

- normalize result sources and reject path traversal;
- require the result to return exactly every output id applicable to the current execution;
- reject unknown, duplicate, missing, overlapping, or extra outputs;
- reject symbolic links, devices, sockets, FIFOs, and other special files;
- compute file and directory digests from the actual staging content.

A digest reported by the extension MUST NOT be accepted as an installed fact.

## 9. Installation, Upgrade, and Uninstall

Each extension uses an independent transaction to commit its exclusive outputs, shared contributions, and installed state. The transaction MUST NOT commit until every postcondition passes.

A new installation MUST record:

- the installed-record version;
- `extensionSpecVersion`;
- the extension version;
- the manifest and complete extension-package digests;
- output ownership and the installed facts computed by the Host.

Idempotency MUST verify both installed state and the real Workspace. A failed upgrade MUST restore the previous artifacts and previous installed state.

Uninstall depends only on installed state. It MUST NOT read the current extension package or execute extension code. Even when the Host no longer supports the execution specification of an installed extension, it MUST safely verify and uninstall the artifacts whenever it can still read the corresponding installed record.

## 10. Specification Evolution

A new extension that fully reuses Spec v1 capabilities MUST NOT require changes to Host core or the public schemas.

A new public capability can enter a later specification version only when it has cross-extension semantics and a complete Host-managed installation, verification, upgrade, rollback, and uninstall lifecycle. A Host MUST fail safely on an unknown specification version and MUST NOT infer compatibility from numeric ranges.

After Spec v1 is published, its machine-observable semantics remain unchanged. Text-only clarifications that do not alter conformance outcomes MAY continue to be published in this directory. Any breaking change MUST use a new `spec/extension/<version>/` directory and a new `extensionSpecVersion`.
