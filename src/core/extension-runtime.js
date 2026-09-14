const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");

const { WorkspaceError } = require("./errors");
const { atomicWrite, sha256 } = require("./fs");
const {
  addPackageReference,
  defaultExtensionStoreRoot,
  listPackageReferences,
  loadStoreRegistry,
  packageRecordFromDirectory,
  packageRoot,
  removePackageReference,
} = require("./extension-store");
const {
  compareSemver,
  loadExtensionState,
  validateManifest,
} = require("./extensions");
const {
  assertRuntimeSupported,
  SUPPORTED_RUNTIME_CAPABILITIES,
  SUPPORTED_RUNTIME_PROTOCOL_VERSIONS,
} = require("./extension-runtime-contract");

const RUNTIME_CONTEXT_SCHEMA_VERSION = 1;
const RUNTIME_RESULT_SCHEMA_VERSION = 1;
const RUNTIME_SERVICE_REGISTRY_FILE = ".runtime-services.json";
const DEFAULT_RUNTIME_OUTPUT_LIMIT = 1024 * 1024;
const ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function runtimeError(code, message, details = {}) {
  return new WorkspaceError(code, message, details);
}

function validateExtensionId(id) {
  const value = String(id || "");
  if (!ID_PATTERN.test(value)) throw runtimeError("EXTENSION_RUNTIME_ID_INVALID", `Invalid extension id: ${value || "<missing>"}`, { extension: value || null });
  return value;
}

function serviceRegistryPath(storeRoot) {
  return path.join(defaultExtensionStoreRoot({ storeRoot }), RUNTIME_SERVICE_REGISTRY_FILE);
}

function emptyServiceRegistry() {
  return { schemaVersion: 1, services: {} };
}

function loadRuntimeServiceRegistry(storeRoot) {
  const file = serviceRegistryPath(storeRoot);
  if (!fs.existsSync(file)) return emptyServiceRegistry();
  let value;
  try { value = JSON.parse(fs.readFileSync(file, "utf8")); } catch (error) {
    throw runtimeError("EXTENSION_RUNTIME_SERVICE_REGISTRY_INVALID", `Cannot parse runtime service registry: ${error.message}`, { file });
  }
  if (!value || value.schemaVersion !== 1 || !value.services || typeof value.services !== "object" || Array.isArray(value.services)) {
    throw runtimeError("EXTENSION_RUNTIME_SERVICE_REGISTRY_INVALID", `Invalid runtime service registry: ${file}`, { file });
  }
  return value;
}

function saveRuntimeServiceRegistry(storeRoot, registry) {
  const root = defaultExtensionStoreRoot({ storeRoot });
  fs.mkdirSync(root, { recursive: true });
  atomicWrite(serviceRegistryPath(root), `${JSON.stringify(registry, null, 2)}\n`);
}

function processAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; } catch (error) { return error.code === "EPERM"; }
}

function safeRemovePackageReference(storeRoot, id, version, type, value) {
  try { removePackageReference(storeRoot, id, version, type, value); } catch { /* preserve the original runtime result when cleanup cannot be persisted */ }
}

function runtimeEntryFile(packageDir, entry, id, version) {
  const root = path.resolve(packageDir);
  const file = path.resolve(root, ...entry.split("/"));
  if (!file.startsWith(`${root}${path.sep}`)) throw runtimeError("EXTENSION_RUNTIME_ENTRY_STALE", `Runtime entry escapes package root for ${id}@${version}`, { extension: id, version, entry });
  let stat;
  try { stat = fs.lstatSync(file); } catch { throw runtimeError("EXTENSION_RUNTIME_ENTRY_UNAVAILABLE", `Runtime entry is missing for ${id}@${version}`, { extension: id, version, entry }); }
  if (!stat.isFile() || stat.isSymbolicLink()) throw runtimeError("EXTENSION_RUNTIME_ENTRY_UNAVAILABLE", `Runtime entry must be a regular file for ${id}@${version}`, { extension: id, version, entry });
  return file;
}

function resolveStoredPackage(storeRoot, id, version, expectedPackageSha256, expectedManifestSha256) {
  const registry = loadStoreRegistry(storeRoot);
  const key = `${id}@${version}`;
  const record = registry.packages[key];
  const root = packageRoot(storeRoot, id, version);
  if (!record || !fs.existsSync(root)) throw runtimeError("EXTENSION_RUNTIME_PACKAGE_UNAVAILABLE", `Extension package ${key} is unavailable in the User Extension Store`, { extension: id, version, storeRoot });
  let packageRecord;
  try {
    packageRecord = packageRecordFromDirectory(root, {
      id,
      version,
      validate(manifest) { validateManifest(manifest, { expectedId: id, expectedVersion: version }); },
    });
  } catch (error) {
    if (error.code) throw runtimeError("EXTENSION_RUNTIME_PACKAGE_STALE", `Stored extension package ${key} failed integrity validation: ${error.message}`, { extension: id, version, causeCode: error.code });
    throw error;
  }
  if (record.packageSha256 !== packageRecord.packageSha256 || record.manifestSha256 !== packageRecord.manifestSha256 || record.entrySha256 !== packageRecord.entrySha256 || (expectedPackageSha256 && expectedPackageSha256 !== packageRecord.packageSha256) || (expectedManifestSha256 && expectedManifestSha256 !== packageRecord.manifestSha256)) {
    throw runtimeError("EXTENSION_RUNTIME_PACKAGE_STALE", `Stored extension package ${key} does not match its activation or registry digest`, {
      extension: id,
      version,
      expectedPackageSha256: expectedPackageSha256 || record.packageSha256,
      actualPackageSha256: packageRecord.packageSha256,
    });
  }
  const manifest = validateManifest(packageRecord.manifest, { expectedId: id, expectedVersion: version });
  const runtime = assertRuntimeSupported(manifest.runtime, id);
  const entryFile = runtimeEntryFile(root, runtime.entry, id, version);
  const entrySha256 = sha256(fs.readFileSync(entryFile));
  if (entrySha256 !== runtime.entrySha256) throw runtimeError("EXTENSION_RUNTIME_ENTRY_STALE", `Runtime entry digest does not match ${key}`, { extension: id, version, expectedSha256: runtime.entrySha256, actualSha256: entrySha256 });
  return Object.freeze({
    id,
    version,
    root: packageRecord.root,
    manifest,
    manifestSha256: packageRecord.manifestSha256,
    packageSha256: packageRecord.packageSha256,
    runtime,
    entryFile,
    entrySha256,
    storeRoot: defaultExtensionStoreRoot({ storeRoot }),
  });
}

function resolveExtensionRuntime(options = {}) {
  const id = validateExtensionId(options.id);
  const storeRoot = defaultExtensionStoreRoot({ storeRoot: options.storeRoot || options.extensionStoreRoot });
  const workspaceRoot = options.workspaceRoot ? path.resolve(options.workspaceRoot) : null;
  let activation = null;
  let activationError = null;
  if (workspaceRoot) {
    try { activation = loadExtensionState(workspaceRoot).extensions[id]?.installed || null; } catch (error) { activationError = error; }
  }
  if (activation) {
    const stored = resolveStoredPackage(storeRoot, id, activation.version, activation.packageSha256, activation.manifestSha256);
    if (stored.runtime.scope === "workspace" || stored.runtime.scope === "global") return Object.freeze({ ...stored, workspaceRoot, activation });
  }

  const registry = loadStoreRegistry(storeRoot);
  const candidates = [];
  let hadWorkspaceRuntime = false;
  for (const record of Object.values(registry.packages).filter((entry) => entry.id === id)) {
    try {
      const stored = resolveStoredPackage(storeRoot, id, record.version);
      if (stored.runtime.scope === "global") candidates.push(stored);
      else hadWorkspaceRuntime = true;
    } catch (error) {
      activationError ||= error;
    }
  }
  candidates.sort((left, right) => compareSemver(right.version, left.version));
  if (candidates.length > 0) return Object.freeze({ ...candidates[0], workspaceRoot: null, activation: null });
  if (hadWorkspaceRuntime || activationError?.code === "EXTENSION_RUNTIME_ACTIVATION_REQUIRED") {
    throw runtimeError("EXTENSION_RUNTIME_ACTIVATION_REQUIRED", `Extension ${id} requires a matching Workspace activation`, { extension: id, remediation: `Install the extension in this Workspace before running codew ext ${id}.` });
  }
  if (activationError?.code && activationError.code.startsWith("EXTENSION_RUNTIME_")) throw activationError;
  throw runtimeError("EXTENSION_RUNTIME_PACKAGE_UNAVAILABLE", `No usable runtime package for extension ${id} is available in the User Extension Store`, { extension: id, storeRoot });
}

function createRuntimeContext(plan, options = {}, readinessFile = null) {
  const context = {
    schemaVersion: RUNTIME_CONTEXT_SCHEMA_VERSION,
    runtimeProtocolVersion: plan.runtime.runtimeProtocolVersion,
    extension: { id: plan.id, version: plan.version },
    scope: plan.runtime.scope,
    mode: plan.runtime.mode,
    dataDirectory: options.dataDirectory || path.join(plan.storeRoot, ".runtime-data", plan.id),
  };
  if (plan.runtime.scope === "workspace" && options.workspace) {
    const workspace = options.workspace;
    context.workspace = {
      ...(typeof workspace.name === "string" ? { name: workspace.name } : {}),
      ...(typeof workspace.uuid === "string" ? { uuid: workspace.uuid } : {}),
      ...(typeof workspace.language === "string" ? { language: workspace.language } : {}),
    };
  }
  if (readinessFile) context.readiness = { type: "file", file: readinessFile };
  fs.mkdirSync(context.dataDirectory, { recursive: true });
  return Object.freeze(context);
}

function verifyRuntimePlan(plan) {
  const current = resolveStoredPackage(plan.storeRoot, plan.id, plan.version, plan.packageSha256, plan.manifestSha256);
  if (current.entrySha256 !== plan.entrySha256 || JSON.stringify(current.runtime) !== JSON.stringify(plan.runtime)) {
    throw runtimeError("EXTENSION_RUNTIME_ENTRY_STALE", `Runtime entry or metadata changed after planning for ${plan.id}@${plan.version}`, { extension: plan.id, version: plan.version });
  }
  return Object.freeze({ ...plan, ...current });
}

function minimalEnvironment(contextFile, dataDirectory) {
  const environment = {};
  for (const name of ["PATH", "TMPDIR", "TMP", "TEMP", "LANG", "LC_ALL", "SystemRoot", "WINDIR", "PATHEXT"]) {
    if (process.env[name] !== undefined) environment[name] = process.env[name];
  }
  environment.CODE_WORKSPACE_RUNTIME_CONTEXT = contextFile;
  environment.CODE_WORKSPACE_RUNTIME_DATA = dataDirectory;
  return environment;
}

function writeContext(tempRoot, plan, options, readinessFile = null) {
  const contextFile = path.join(tempRoot, "context.json");
  const context = createRuntimeContext(plan, options, readinessFile);
  fs.writeFileSync(contextFile, `${JSON.stringify(context, null, 2)}\n`, { mode: 0o600 });
  return { contextFile, context };
}

function validateRuntimeResult(value, plan) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw runtimeError("EXTENSION_RUNTIME_RESULT_INVALID", `Runtime ${plan.id} returned a non-object result`, { extension: plan.id });
  const allowed = new Set(["schemaVersion", "runtimeProtocolVersion", "extension", "data", "diagnostics", "text"]);
  const unknown = Object.keys(value).find((key) => !allowed.has(key));
  if (unknown) throw runtimeError("EXTENSION_RUNTIME_RESULT_INVALID", `Runtime ${plan.id} result contains unsupported field ${unknown}`, { extension: plan.id, field: unknown });
  if (value.schemaVersion !== RUNTIME_RESULT_SCHEMA_VERSION || value.runtimeProtocolVersion !== plan.runtime.runtimeProtocolVersion) throw runtimeError("EXTENSION_RUNTIME_RESULT_INVALID", `Runtime ${plan.id} result protocol does not match the Host plan`, { extension: plan.id, expectedRuntimeProtocolVersion: plan.runtime.runtimeProtocolVersion, actualRuntimeProtocolVersion: value.runtimeProtocolVersion ?? null });
  if (!value.extension || value.extension.id !== plan.id || value.extension.version !== plan.version) throw runtimeError("EXTENSION_RUNTIME_RESULT_IDENTITY_MISMATCH", `Runtime result identity does not match ${plan.id}@${plan.version}`, { extension: plan.id, version: plan.version, actual: value.extension || null });
  if (value.diagnostics !== undefined) {
    if (!Array.isArray(value.diagnostics)) throw runtimeError("EXTENSION_RUNTIME_RESULT_INVALID", `Runtime ${plan.id} diagnostics must be an array`, { extension: plan.id });
    for (const diagnostic of value.diagnostics) {
      if (!diagnostic || typeof diagnostic !== "object" || Array.isArray(diagnostic) || typeof diagnostic.code !== "string" || typeof diagnostic.message !== "string" || !["info", "warning", "error"].includes(diagnostic.severity || "error")) throw runtimeError("EXTENSION_RUNTIME_RESULT_INVALID", `Runtime ${plan.id} returned an invalid diagnostic`, { extension: plan.id });
      const invalid = Object.keys(diagnostic).find((key) => !["code", "severity", "message", "details"].includes(key));
      if (invalid) throw runtimeError("EXTENSION_RUNTIME_RESULT_INVALID", `Runtime ${plan.id} diagnostic contains unsupported field ${invalid}`, { extension: plan.id, field: invalid });
    }
  }
  if (value.text !== undefined && typeof value.text !== "string") throw runtimeError("EXTENSION_RUNTIME_RESULT_INVALID", `Runtime ${plan.id} result text must be a string`, { extension: plan.id });
  return Object.freeze({
    schemaVersion: value.schemaVersion,
    runtimeProtocolVersion: value.runtimeProtocolVersion,
    extension: Object.freeze({ id: plan.id, version: plan.version }),
    ...(Object.prototype.hasOwnProperty.call(value, "data") ? { data: value.data } : {}),
    ...(value.diagnostics ? { diagnostics: value.diagnostics } : {}),
    ...(value.text !== undefined ? { text: value.text } : {}),
  });
}

function runOneshotRuntime(plan, argv = [], options = {}) {
  plan = verifyRuntimePlan(plan);
  const tempRoot = fs.mkdtempSync(path.join(options.tempRoot || os.tmpdir(), `code-workspace-runtime-${plan.id}-`));
  const reference = `${process.pid}:${Date.now()}:${Math.random().toString(16).slice(2)}`;
  const limit = plan.runtime.maxOutputBytes || DEFAULT_RUNTIME_OUTPUT_LIMIT;
  try {
    addPackageReference(plan.storeRoot, plan.id, plan.version, "processes", reference);
    const { contextFile, context } = writeContext(tempRoot, plan, options);
    const runner = options.spawnSync || spawnSync;
    const result = runner(process.execPath, [plan.entryFile, ...argv], {
      cwd: plan.root,
      env: minimalEnvironment(contextFile, context.dataDirectory),
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: plan.runtime.timeoutMs,
      killSignal: "SIGKILL",
      maxBuffer: limit,
    });
    if (result.error?.code === "ENOBUFS" || String(result.error?.message || "").toLowerCase().includes("maxbuffer")) throw runtimeError("EXTENSION_RUNTIME_OUTPUT_LIMIT", `Runtime ${plan.id} exceeded its output limit`, { extension: plan.id, maxOutputBytes: limit });
    if (result.error?.code === "ETIMEDOUT" || (!result.error && result.signal === "SIGKILL")) throw runtimeError("EXTENSION_RUNTIME_TIMEOUT", `Runtime ${plan.id} timed out after ${plan.runtime.timeoutMs}ms`, { extension: plan.id, timeoutMs: plan.runtime.timeoutMs });
    if (result.error) throw runtimeError("EXTENSION_RUNTIME_START_FAILED", `Runtime ${plan.id} failed to start: ${result.error.message}`, { extension: plan.id });
    const stdout = String(result.stdout || "");
    const stderr = String(result.stderr || "");
    if (Buffer.byteLength(stdout) > limit || Buffer.byteLength(stderr) > limit) throw runtimeError("EXTENSION_RUNTIME_OUTPUT_LIMIT", `Runtime ${plan.id} exceeded its output limit`, { extension: plan.id, maxOutputBytes: limit });
    if (result.status !== 0) throw runtimeError("EXTENSION_RUNTIME_EXIT_FAILED", `Runtime ${plan.id} exited with status ${result.status}`, { extension: plan.id, exitCode: result.status, stderr: stderr.slice(0, 1024) });
    if (!stdout.trim()) throw runtimeError("EXTENSION_RUNTIME_RESULT_INVALID", `Runtime ${plan.id} returned empty stdout`, { extension: plan.id });
    let parsed;
    try { parsed = JSON.parse(stdout); } catch (error) { throw runtimeError("EXTENSION_RUNTIME_RESULT_INVALID", `Runtime ${plan.id} returned invalid JSON: ${error.message}`, { extension: plan.id }); }
    return validateRuntimeResult(parsed, plan);
  } finally {
    safeRemovePackageReference(plan.storeRoot, plan.id, plan.version, "processes", reference);
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

function killServiceProcess(child, signal) {
  if (!child || !child.pid) return;
  try {
    if (process.platform !== "win32") process.kill(-child.pid, signal);
    else child.kill(signal);
  } catch {
    try { child.kill(signal); } catch { /* process already exited */ }
  }
}

function waitForServiceReady(child, readinessFile, timeoutMs) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (fn, value) => { if (settled) return; settled = true; clearInterval(timer); clearTimeout(timeout); child.removeListener("exit", onExit); child.removeListener("error", onError); fn(value); };
    const onExit = (code, signal) => finish(reject, runtimeError("EXTENSION_RUNTIME_SERVICE_START_FAILED", `Runtime service exited before readiness (code=${code ?? "null"}, signal=${signal || "none"})`, { exitCode: code, signal }));
    const onError = (error) => finish(reject, runtimeError("EXTENSION_RUNTIME_SERVICE_START_FAILED", `Runtime service failed to start: ${error.message}`, { cause: error.code || error.name }));
    child.once("exit", onExit);
    child.once("error", onError);
    const timer = setInterval(() => {
      try {
        const stat = fs.lstatSync(readinessFile);
        if (stat.isFile() && !stat.isSymbolicLink()) finish(resolve, true);
      } catch { /* not ready yet */ }
    }, 20);
    const timeout = setTimeout(() => finish(reject, runtimeError("EXTENSION_RUNTIME_SERVICE_START_TIMEOUT", `Runtime service did not become ready within ${timeoutMs}ms`, { timeoutMs })), timeoutMs);
  });
}

function runServiceRuntime(plan, argv = [], options = {}) {
  plan = verifyRuntimePlan(plan);
  const service = plan.runtime.service;
  const storeRoot = plan.storeRoot;
  const services = loadRuntimeServiceRegistry(storeRoot);
  const existing = services.services[service.id];
  if (existing && processAlive(existing.pid)) {
    if (existing.compatibilityGroup !== service.compatibilityGroup) throw runtimeError("EXTENSION_SERVICE_COMPATIBILITY_CONFLICT", `Service ${service.id} is already running with incompatible group ${existing.compatibilityGroup}`, { serviceId: service.id, requestedCompatibilityGroup: service.compatibilityGroup, runningCompatibilityGroup: existing.compatibilityGroup });
    return Promise.resolve({ status: "shared", serviceId: service.id, pid: existing.pid, version: existing.version, compatibilityGroup: existing.compatibilityGroup });
  }
  if (existing) {
    delete services.services[service.id];
    saveRuntimeServiceRegistry(storeRoot, services);
    safeRemovePackageReference(storeRoot, existing.extensionId, existing.version, "processes", existing.reference);
  }

  const tempRoot = fs.mkdtempSync(path.join(options.tempRoot || os.tmpdir(), `code-workspace-runtime-service-${plan.id}-`));
  const readinessFile = path.join(tempRoot, "ready");
  const { contextFile, context } = writeContext(tempRoot, plan, options, readinessFile);
  const reference = `service:${service.id}:${process.pid}:${Date.now()}`;
  let child;
  let signalHandlers = [];
  const cleanup = () => {
    for (const [signal, handler] of signalHandlers) process.removeListener(signal, handler);
    signalHandlers = [];
    try {
      const current = loadRuntimeServiceRegistry(storeRoot);
      if (current.services[service.id]?.reference === reference) {
        delete current.services[service.id];
        saveRuntimeServiceRegistry(storeRoot, current);
      }
    } catch { /* preserve the process result if registry cleanup itself fails */ }
    safeRemovePackageReference(storeRoot, plan.id, plan.version, "processes", reference);
    fs.rmSync(tempRoot, { recursive: true, force: true });
  };
  try {
    addPackageReference(storeRoot, plan.id, plan.version, "processes", reference);
    child = spawn(process.execPath, [plan.entryFile, ...argv], {
      cwd: plan.root,
      env: minimalEnvironment(contextFile, context.dataDirectory),
      stdio: options.stdio || "inherit",
      detached: process.platform !== "win32",
    });
    services.services[service.id] = {
      extensionId: plan.id,
      version: plan.version,
      pid: child.pid,
      compatibilityGroup: service.compatibilityGroup,
      reference,
      startedAt: new Date().toISOString(),
      ready: false,
    };
    saveRuntimeServiceRegistry(storeRoot, services);
    signalHandlers = ["SIGINT", "SIGTERM"].map((signal) => {
      const handler = () => killServiceProcess(child, signal);
      process.on(signal, handler);
      return [signal, handler];
    });
    return waitForServiceReady(child, readinessFile, plan.runtime.timeoutMs)
      .then(() => {
        const readyRegistry = loadRuntimeServiceRegistry(storeRoot);
        if (readyRegistry.services[service.id]?.reference === reference) {
          readyRegistry.services[service.id].ready = true;
          saveRuntimeServiceRegistry(storeRoot, readyRegistry);
        }
        return new Promise((resolve, reject) => {
          child.once("exit", (code, signal) => {
            const result = { status: "stopped", serviceId: service.id, pid: child.pid, version: plan.version, exitCode: code, signal: signal || null };
            if ((code !== 0 && code !== null) && !["SIGINT", "SIGTERM"].includes(signal)) {
              reject(runtimeError("EXTENSION_RUNTIME_SERVICE_EXIT_FAILED", `Runtime service exited with status ${code}`, { serviceId: service.id, exitCode: code }));
              return;
            }
            resolve(result);
          });
          child.once("error", reject);
        });
      })
      .catch((error) => {
        killServiceProcess(child, "SIGTERM");
        setTimeout(() => killServiceProcess(child, "SIGKILL"), 500);
        throw error;
      })
      .finally(cleanup);
  } catch (error) {
    cleanup();
    throw error;
  }
}

// Short-lived command surface for service runtimes: inherited stdio, caller cwd,
// no service registry or readiness handshake. Convention: empty argv or "serve"
// starts the service; any other argv runs as a command.
function runCommandRuntime(plan, argv = [], options = {}) {
  plan = verifyRuntimePlan(plan);
  const tempRoot = fs.mkdtempSync(path.join(options.tempRoot || os.tmpdir(), `code-workspace-runtime-command-${plan.id}-`));
  const reference = `command:${process.pid}:${Date.now()}`;
  let settled = false;
  return new Promise((resolve, reject) => {
    try {
      addPackageReference(plan.storeRoot, plan.id, plan.version, "processes", reference);
      const { contextFile, context } = writeContext(tempRoot, plan, options);
      const child = spawn(process.execPath, [plan.entryFile, ...argv], {
        cwd: options.commandCwd || process.cwd(),
        env: minimalEnvironment(contextFile, context.dataDirectory),
        stdio: options.stdio || "inherit",
      });
      const timeout = setTimeout(() => killServiceProcess(child, "SIGKILL"), plan.runtime.timeoutMs);
      const finish = (fn, value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        try {
          safeRemovePackageReference(plan.storeRoot, plan.id, plan.version, "processes", reference);
          fs.rmSync(tempRoot, { recursive: true, force: true });
        } catch { /* best-effort cleanup */ }
        fn(value);
      };
      child.once("error", (error) => finish(reject, runtimeError("EXTENSION_RUNTIME_START_FAILED", `Runtime ${plan.id} failed to start: ${error.message}`, { extension: plan.id })));
      child.once("exit", (code, signal) => {
        if ((code !== 0 && code !== null) && !["SIGINT", "SIGTERM"].includes(signal)) {
          finish(reject, runtimeError("EXTENSION_RUNTIME_EXIT_FAILED", `Runtime ${plan.id} exited with status ${code}`, { extension: plan.id, exitCode: code, signal: signal || null }));
          return;
        }
        finish(resolve, { status: "completed", serviceId: plan.runtime.service?.id || null, exitCode: code, signal: signal || null });
      });
    } catch (error) {
      settled = true;
      try {
        safeRemovePackageReference(plan.storeRoot, plan.id, plan.version, "processes", reference);
        fs.rmSync(tempRoot, { recursive: true, force: true });
      } catch { /* best-effort cleanup */ }
      reject(error);
    }
  });
}

function executeExtensionRuntime(options = {}) {
  const plan = resolveExtensionRuntime(options);
  const argv = options.argv || [];
  if (plan.runtime.mode === "service" && options.json === true) {
    throw runtimeError("CLI_JSON_UNSUPPORTED", "Long-running extension services use inherited stdio and do not support Host --json output.");
  }
  if (plan.runtime.mode === "oneshot") return { plan, result: runOneshotRuntime(plan, argv, options) };
  const serviceStart = argv.length === 0 || argv[0] === "serve";
  if (serviceStart) return { plan, result: runServiceRuntime(plan, argv, options) };
  return { plan, result: runCommandRuntime(plan, argv, options) };
}

module.exports = {
  DEFAULT_RUNTIME_OUTPUT_LIMIT,
  RUNTIME_CONTEXT_SCHEMA_VERSION,
  RUNTIME_RESULT_SCHEMA_VERSION,
  RUNTIME_SERVICE_REGISTRY_FILE,
  SUPPORTED_RUNTIME_CAPABILITIES,
  SUPPORTED_RUNTIME_PROTOCOL_VERSIONS,
  createRuntimeContext,
  emptyServiceRegistry,
  executeExtensionRuntime,
  listPackageReferences,
  loadRuntimeServiceRegistry,
  minimalEnvironment,
  resolveExtensionRuntime,
  runCommandRuntime,
  runOneshotRuntime,
  runServiceRuntime,
  saveRuntimeServiceRegistry,
  serviceRegistryPath,
  validateRuntimeResult,
  verifyRuntimePlan,
};
