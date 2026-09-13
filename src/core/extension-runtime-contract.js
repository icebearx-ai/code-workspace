const path = require("node:path");

const { WorkspaceError } = require("./errors");

const RUNTIME_PROTOCOL_VERSION = 1;
const SUPPORTED_RUNTIME_PROTOCOL_VERSIONS = Object.freeze([RUNTIME_PROTOCOL_VERSION]);
const SUPPORTED_RUNTIME_CAPABILITIES = Object.freeze([
  "cli",
  "oneshot-json-result",
  "service-readiness-file",
  "service-singleton-user",
]);
const ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const DEFAULT_RUNTIME_OUTPUT_LIMIT = 1024 * 1024;

function runtimeContractError(code, message, details = {}) {
  return new WorkspaceError(code, message, details);
}

function assertOnlyKeys(value, allowed, label) {
  const unknown = Object.keys(value).filter((key) => !allowed.has(key));
  if (unknown.length > 0) {
    throw runtimeContractError("EXTENSION_MANIFEST_INVALID", `${label} contains unsupported field ${unknown[0]}`, { field: unknown[0] });
  }
}

function validateId(value, label) {
  const id = String(value || "");
  if (!ID_PATTERN.test(id)) throw runtimeContractError("EXTENSION_MANIFEST_INVALID", `Invalid ${label}: ${id || "<missing>"}`, { [label]: id || null });
  return id;
}

function validateRuntimeEntry(value, extensionId) {
  const entry = String(value || "");
  if (!entry || entry.includes("\\") || path.posix.isAbsolute(entry) || entry.split("/").some((segment) => !segment || segment === "." || segment === "..")) {
    throw runtimeContractError("EXTENSION_MANIFEST_INVALID", `Extension ${extensionId} runtime entry is invalid`, { extension: extensionId, entry: entry || null });
  }
  return entry;
}

function requiredCapabilitiesForRuntime(runtime) {
  const required = new Set(["cli", ...(runtime.requires || [])]);
  if (runtime.mode === "oneshot") required.add("oneshot-json-result");
  if (runtime.mode === "service") {
    required.add("service-readiness-file");
    if (runtime.service.singleton === "user") required.add("service-singleton-user");
  }
  return Object.freeze([...required]);
}

function validateRuntimeDeclaration(value, extensionId) {
  if (value === undefined) return null;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw runtimeContractError("EXTENSION_MANIFEST_INVALID", `Extension ${extensionId} runtime must be an object`, { extension: extensionId });
  }
  assertOnlyKeys(value, new Set([
    "runtimeProtocolVersion",
    "requires",
    "entry",
    "entrySha256",
    "scope",
    "mode",
    "timeoutMs",
    "maxOutputBytes",
    "service",
  ]), `Extension ${extensionId} runtime`);
  if (!Number.isInteger(value.runtimeProtocolVersion) || value.runtimeProtocolVersion < 1) {
    throw runtimeContractError("EXTENSION_MANIFEST_INVALID", `Extension ${extensionId} runtimeProtocolVersion must be a positive integer`, { extension: extensionId, runtimeProtocolVersion: value.runtimeProtocolVersion ?? null });
  }
  const entry = validateRuntimeEntry(value.entry, extensionId);
  if (!SHA256_PATTERN.test(value.entrySha256 || "")) {
    throw runtimeContractError("EXTENSION_MANIFEST_INVALID", `Extension ${extensionId} runtime entrySha256 is invalid`, { extension: extensionId });
  }
  if (!["workspace", "global"].includes(value.scope)) {
    throw runtimeContractError("EXTENSION_MANIFEST_INVALID", `Extension ${extensionId} runtime scope must be workspace or global`, { extension: extensionId, scope: value.scope ?? null });
  }
  if (!["oneshot", "service"].includes(value.mode)) {
    throw runtimeContractError("EXTENSION_MANIFEST_INVALID", `Extension ${extensionId} runtime mode must be oneshot or service`, { extension: extensionId, mode: value.mode ?? null });
  }
  if (!Number.isInteger(value.timeoutMs) || value.timeoutMs < 1 || value.timeoutMs > 300000) {
    throw runtimeContractError("EXTENSION_MANIFEST_INVALID", `Extension ${extensionId} runtime timeoutMs must be an integer from 1 to 300000`, { extension: extensionId, timeoutMs: value.timeoutMs ?? null });
  }
  const requires = value.requires === undefined ? [] : value.requires;
  if (!Array.isArray(requires) || new Set(requires).size !== requires.length || requires.some((capability) => !ID_PATTERN.test(String(capability || "")))) {
    throw runtimeContractError("EXTENSION_MANIFEST_INVALID", `Extension ${extensionId} runtime requires must contain unique capability ids`, { extension: extensionId });
  }

  let service = null;
  let maxOutputBytes = null;
  if (value.mode === "oneshot") {
    if (value.service !== undefined) throw runtimeContractError("EXTENSION_MANIFEST_INVALID", `Extension ${extensionId} oneshot runtime cannot declare service metadata`, { extension: extensionId });
    if (value.maxOutputBytes !== undefined && (!Number.isInteger(value.maxOutputBytes) || value.maxOutputBytes < 1024 || value.maxOutputBytes > 4 * 1024 * 1024)) {
      throw runtimeContractError("EXTENSION_MANIFEST_INVALID", `Extension ${extensionId} oneshot maxOutputBytes must be an integer from 1024 to 4194304`, { extension: extensionId, maxOutputBytes: value.maxOutputBytes ?? null });
    }
    maxOutputBytes = value.maxOutputBytes || DEFAULT_RUNTIME_OUTPUT_LIMIT;
  } else {
    if (value.maxOutputBytes !== undefined) throw runtimeContractError("EXTENSION_MANIFEST_INVALID", `Extension ${extensionId} service runtime cannot declare maxOutputBytes`, { extension: extensionId });
    if (!value.service || typeof value.service !== "object" || Array.isArray(value.service)) {
      throw runtimeContractError("EXTENSION_MANIFEST_INVALID", `Extension ${extensionId} service runtime requires service metadata`, { extension: extensionId });
    }
    assertOnlyKeys(value.service, new Set(["id", "compatibilityGroup", "singleton"]), `Extension ${extensionId} runtime service`);
    const serviceId = validateId(value.service.id, "serviceId");
    const compatibilityGroup = validateId(value.service.compatibilityGroup, "compatibilityGroup");
    if (value.service.singleton !== "user") {
      throw runtimeContractError("EXTENSION_MANIFEST_INVALID", `Extension ${extensionId} service singleton policy must be user`, { extension: extensionId, singleton: value.service.singleton ?? null });
    }
    service = Object.freeze({ id: serviceId, compatibilityGroup, singleton: "user" });
  }

  const runtime = {
    runtimeProtocolVersion: value.runtimeProtocolVersion,
    requires: Object.freeze(requires.map(String)),
    entry,
    entrySha256: value.entrySha256,
    scope: value.scope,
    mode: value.mode,
    timeoutMs: value.timeoutMs,
    ...(maxOutputBytes ? { maxOutputBytes } : {}),
    ...(service ? { service } : {}),
  };
  return Object.freeze({ ...runtime, requiredCapabilities: requiredCapabilitiesForRuntime(runtime) });
}

function assertRuntimeSupported(runtime, extensionId) {
  if (!runtime) {
    throw runtimeContractError("EXTENSION_RUNTIME_CAPABILITY_UNSUPPORTED", `Extension ${extensionId} does not declare a runtime entry`, {
      extension: extensionId,
      capability: "cli",
      supportedRuntimeProtocolVersions: [...SUPPORTED_RUNTIME_PROTOCOL_VERSIONS],
      supportedRuntimeCapabilities: [...SUPPORTED_RUNTIME_CAPABILITIES],
    });
  }
  if (!SUPPORTED_RUNTIME_PROTOCOL_VERSIONS.includes(runtime.runtimeProtocolVersion)) {
    throw runtimeContractError("EXTENSION_RUNTIME_CAPABILITY_UNSUPPORTED", `Extension ${extensionId} requires unsupported runtime protocol ${runtime.runtimeProtocolVersion}`, {
      extension: extensionId,
      runtimeProtocolVersion: runtime.runtimeProtocolVersion,
      supportedRuntimeProtocolVersions: [...SUPPORTED_RUNTIME_PROTOCOL_VERSIONS],
    });
  }
  const unsupported = runtime.requiredCapabilities.filter((capability) => !SUPPORTED_RUNTIME_CAPABILITIES.includes(capability));
  if (unsupported.length > 0) {
    throw runtimeContractError("EXTENSION_RUNTIME_CAPABILITY_UNSUPPORTED", `Extension ${extensionId} requires unsupported runtime capability ${unsupported[0]}`, {
      extension: extensionId,
      unsupportedCapabilities: unsupported,
      supportedRuntimeCapabilities: [...SUPPORTED_RUNTIME_CAPABILITIES],
    });
  }
  return runtime;
}

module.exports = {
  RUNTIME_PROTOCOL_VERSION,
  SUPPORTED_RUNTIME_CAPABILITIES,
  SUPPORTED_RUNTIME_PROTOCOL_VERSIONS,
  assertRuntimeSupported,
  requiredCapabilitiesForRuntime,
  validateRuntimeDeclaration,
};
