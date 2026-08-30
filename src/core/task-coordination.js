"use strict";

/**
 * Provider-neutral task/write coordination core.
 *
 * The module intentionally keeps the persistence boundary in this core file;
 * CLI and Hook adapters only call the public inspect/plan/apply/event APIs.
 */
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const properLockfile = require("proper-lockfile");

const { atomicWrite, sha256 } = require("./fs");
const { WorkspaceError } = require("./errors");

const SCHEMA_VERSION = 1;
const ACTIVE = "ACTIVE";
const UNKNOWN = "UNKNOWN";
const ENDED = "ENDED";
const TASK_STATUSES = Object.freeze([ACTIVE, UNKNOWN, ENDED]);
const CLAIM_TYPES = Object.freeze(["WRITE_RESERVATION", "DIRTY_CLAIM"]);
const SCOPE_TYPES = Object.freeze(["EXACT_FILE", "DIRECTORY_TREE", "PROJECT_WIDE"]);
const DECISIONS = Object.freeze([
  "ALLOW",
  "CONFIRM_PROJECT",
  "DENY_FILE_CONFLICT",
  "DENY_UNKNOWN_WRITE_SCOPE",
  "UNKNOWN_OWNER_DECISION_REQUIRED",
  "RETRY_COORDINATION_FAILURE",
]);
const DECISION_ACTIONS = Object.freeze([
  "KEEP",
  "KEEP_AND_BLOCK",
  "APPROVE_PROJECT_PARALLEL",
  "RELEASE_CLAIM",
  "ABANDON_TASK_AND_RELEASE",
  "INSPECT",
]);
const DEFAULT_ACTIVITY_THRESHOLD_MS = 15 * 60 * 1000;
const DEFAULT_MUTEX_UPDATE_MS = 1000;
const DEFAULT_MUTEX_STALE_MS = 30000;
const DEFAULT_MUTEX_TIMEOUT_MS = 2500;

function coordinationError(code, message, details = {}) {
  return new WorkspaceError(code, message, details);
}

function injectFailure(options, stage, value) {
  if (typeof options.injectFailure !== "function") return;
  options.injectFailure(stage, value);
}

function isObject(value) {
  return value && typeof value === "object" && !Array.isArray(value);
}

function requiredString(value, field) {
  if (typeof value !== "string" || !value.trim()) {
    throw coordinationError("TASK_SCHEMA_INVALID", `${field} must be a non-empty string`, { field });
  }
  return value.trim();
}

function optionalString(value, field) {
  if (value == null) return null;
  return requiredString(value, field);
}

function nonNegativeInteger(value, field, fallback = 0) {
  const actual = value == null ? fallback : value;
  if (!Number.isSafeInteger(actual) || actual < 0) {
    throw coordinationError("TASK_SCHEMA_INVALID", `${field} must be a non-negative integer`, { field, value });
  }
  return actual;
}

function nowIso(clock = Date) {
  return new clock().toISOString();
}

function parseTime(value, field = "time") {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) throw coordinationError("TASK_SCHEMA_INVALID", `${field} must be an ISO timestamp`, { field, value });
  return new Date(timestamp).toISOString();
}

function taskGenerationKey(workspaceUuid, provider, nativeSessionId) {
  return `${requiredString(workspaceUuid, "workspaceUuid")}\u0000${requiredString(provider, "provider")}\u0000${requiredString(nativeSessionId, "nativeSessionId")}`;
}

function taskIdFor(identity) {
  const key = `${requiredString(identity.workspaceUuid, "workspaceUuid")}\u0000${requiredString(identity.provider, "provider")}\u0000${requiredString(identity.nativeSessionId, "nativeSessionId")}\u0000${nonNegativeInteger(identity.generation, "generation")}`;
  const digest = crypto.createHash("sha256").update(key).digest("hex").slice(0, 12);
  return `${String(identity.provider).toLowerCase()}-${digest}-g${identity.generation}`;
}

function normalizeTask(value, options = {}) {
  if (!isObject(value)) throw coordinationError("TASK_SCHEMA_INVALID", "task must be an object", { field: "task" });
  const workspaceUuid = requiredString(value.workspaceUuid, "workspaceUuid");
  const provider = requiredString(value.provider, "provider");
  const nativeSessionId = requiredString(value.nativeSessionId, "nativeSessionId");
  const generation = nonNegativeInteger(value.generation, "generation", 1);
  const status = value.status || ACTIVE;
  if (!TASK_STATUSES.includes(status)) throw coordinationError("TASK_SCHEMA_INVALID", `Unknown task status: ${status}`, { status });
  const startedAt = value.startedAt ? parseTime(value.startedAt, "startedAt") : nowIso(options.clock);
  const lastSeenAt = value.lastSeenAt ? parseTime(value.lastSeenAt, "lastSeenAt") : startedAt;
  const task = {
    taskId: value.taskId || taskIdFor({ workspaceUuid, provider, nativeSessionId, generation }),
    workspaceUuid,
    provider,
    nativeSessionId,
    generation,
    status,
    phase: optionalString(value.phase, "phase") || "STARTING",
    startedAt,
    lastSeenAt,
    lastEvent: optionalString(value.lastEvent, "lastEvent"),
    unknownSince: value.unknownSince ? parseTime(value.unknownSince, "unknownSince") : null,
    endedAt: value.endedAt ? parseTime(value.endedAt, "endedAt") : null,
    endReason: optionalString(value.endReason, "endReason"),
    revoked: value.revoked === true,
    runtimeEvidence: isObject(value.runtimeEvidence) ? { ...value.runtimeEvidence } : {},
    parentSessionId: optionalString(value.parentSessionId, "parentSessionId"),
    agentEvidence: Array.isArray(value.agentEvidence) ? value.agentEvidence.map((entry) => ({ ...entry })) : [],
  };
  if (task.status === ENDED && !task.endedAt) task.endedAt = task.lastSeenAt;
  if (task.status === ENDED && task.endReason == null) task.endReason = "SESSION_END";
  return task;
}

function normalizeScope(value, projectRealPath) {
  if (!isObject(value)) throw coordinationError("TASK_SCOPE_INVALID", "scope must be an object");
  const type = String(value.type || value.kind || "").toUpperCase();
  if (!SCOPE_TYPES.includes(type)) throw coordinationError("TASK_SCOPE_INVALID", `Unknown scope type: ${type}`, { type });
  const project = path.resolve(requiredString(value.projectRealPath || projectRealPath, "projectRealPath"));
  const target = value.path == null ? project : path.resolve(project, String(value.path));
  return {
    type,
    projectRealPath: project,
    path: type === "PROJECT_WIDE" ? project : target,
    normalizedPath: type === "PROJECT_WIDE" ? project : target,
    scopeId: `${type}:${type === "PROJECT_WIDE" ? project : target}`,
  };
}

function normalizeClaim(value) {
  if (!isObject(value)) throw coordinationError("TASK_SCHEMA_INVALID", "claim must be an object");
  const type = String(value.type || "").toUpperCase();
  if (!CLAIM_TYPES.includes(type)) throw coordinationError("TASK_SCHEMA_INVALID", `Unknown claim type: ${type}`, { type });
  const scope = normalizeScope(value.scope || value, value.projectRealPath);
  return {
    claimId: requiredString(value.claimId || crypto.randomUUID(), "claimId"),
    type,
    enforcement: value.enforcement !== false,
    taskId: requiredString(value.taskId, "taskId"),
    workspaceUuid: requiredString(value.workspaceUuid, "workspaceUuid"),
    generation: nonNegativeInteger(value.generation, "generation", 1),
    operationId: optionalString(value.operationId, "operationId"),
    toolName: optionalString(value.toolName, "toolName"),
    createdAt: value.createdAt ? parseTime(value.createdAt, "createdAt") : nowIso(),
    claimRevision: nonNegativeInteger(value.claimRevision, "claimRevision", 1),
    scope,
    beforeFingerprint: value.beforeFingerprint || null,
    beforeGit: value.beforeGit || null,
    currentFingerprint: value.currentFingerprint || null,
    currentGit: value.currentGit || null,
    dirtyToClean: value.dirtyToClean === true,
    releasedAt: value.releasedAt ? parseTime(value.releasedAt, "releasedAt") : null,
    releaseReason: optionalString(value.releaseReason, "releaseReason"),
  };
}

function normalizeParticipation(value) {
  if (!isObject(value)) throw coordinationError("TASK_SCHEMA_INVALID", "project participation must be an object");
  return {
    participationId: requiredString(value.participationId || crypto.randomUUID(), "participationId"),
    projectRealPath: path.resolve(requiredString(value.projectRealPath, "projectRealPath")),
    taskId: requiredString(value.taskId, "taskId"),
    workspaceUuid: requiredString(value.workspaceUuid, "workspaceUuid"),
    generation: nonNegativeInteger(value.generation, "generation", 1),
    status: value.status || ACTIVE,
    createdAt: value.createdAt ? parseTime(value.createdAt, "createdAt") : nowIso(),
    endedAt: value.endedAt ? parseTime(value.endedAt, "endedAt") : null,
    endReason: optionalString(value.endReason, "endReason"),
  };
}

function normalizeDecisionRequest(value) {
  if (!isObject(value)) throw coordinationError("TASK_SCHEMA_INVALID", "decision request must be an object");
  return {
    decisionRequestId: requiredString(value.decisionRequestId || crypto.randomUUID(), "decisionRequestId"),
    type: requiredString(value.type || "UNKNOWN_OWNER_DECISION_REQUIRED", "type"),
    status: value.status || "PENDING",
    requesterTaskId: optionalString(value.requesterTaskId, "requesterTaskId"),
    ownerTaskId: optionalString(value.ownerTaskId, "ownerTaskId"),
    ownerGeneration: value.ownerGeneration == null ? null : nonNegativeInteger(value.ownerGeneration, "ownerGeneration"),
    projectRealPath: value.projectRealPath ? path.resolve(value.projectRealPath) : null,
    claimId: optionalString(value.claimId, "claimId"),
    claimType: optionalString(value.claimType, "claimType"),
    scope: value.scope ? normalizeScope(value.scope, value.projectRealPath) : null,
    ledgerRevision: nonNegativeInteger(value.ledgerRevision, "ledgerRevision"),
    claimRevision: value.claimRevision == null ? null : nonNegativeInteger(value.claimRevision, "claimRevision"),
    evidenceHash: requiredString(value.evidenceHash || sha256(JSON.stringify(value.evidence || {})), "evidenceHash"),
    evidence: isObject(value.evidence) ? { ...value.evidence } : {},
    options: Array.isArray(value.options) ? [...value.options] : [],
    consequence: optionalString(value.consequence, "consequence"),
    createdAt: value.createdAt ? parseTime(value.createdAt, "createdAt") : nowIso(),
    resolvedAt: value.resolvedAt ? parseTime(value.resolvedAt, "resolvedAt") : null,
    resolution: optionalString(value.resolution, "resolution"),
    dedupeKey: optionalString(value.dedupeKey, "dedupeKey"),
  };
}

function emptyLedger() {
  return {
    schemaVersion: SCHEMA_VERSION,
    ledgerRevision: 0,
    tasks: {},
    sessionGenerations: {},
    revokedGenerations: {},
    participations: {},
    claims: {},
    decisions: {},
    approvals: {},
    processedEvents: {},
    audit: [],
  };
}

function normalizeLedger(value) {
  if (!isObject(value)) throw coordinationError("TASK_LEDGER_CORRUPT", "Task coordination ledger must be a JSON object");
  if (value.schemaVersion !== SCHEMA_VERSION) {
    throw coordinationError("TASK_LEDGER_SCHEMA_UNSUPPORTED", `Unsupported task coordination ledger schemaVersion: ${value.schemaVersion}`, {
      version: value.schemaVersion,
      supported: SCHEMA_VERSION,
    });
  }
  const ledger = {
    ...emptyLedger(),
    ...value,
    ledgerRevision: nonNegativeInteger(value.ledgerRevision, "ledgerRevision"),
    tasks: {},
    sessionGenerations: isObject(value.sessionGenerations) ? { ...value.sessionGenerations } : {},
    revokedGenerations: isObject(value.revokedGenerations) ? { ...value.revokedGenerations } : {},
    participations: {},
    claims: {},
    decisions: {},
    approvals: isObject(value.approvals) ? { ...value.approvals } : {},
    processedEvents: isObject(value.processedEvents) ? { ...value.processedEvents } : {},
    audit: Array.isArray(value.audit) ? value.audit.map((entry) => ({ ...entry })) : [],
  };
  for (const [key, task] of Object.entries(value.tasks || {})) ledger.tasks[key] = normalizeTask(task);
  for (const [key, entry] of Object.entries(value.participations || {})) ledger.participations[key] = normalizeParticipation(entry);
  for (const [key, claim] of Object.entries(value.claims || {})) ledger.claims[key] = normalizeClaim(claim);
  for (const [key, decision] of Object.entries(value.decisions || {})) ledger.decisions[key] = normalizeDecisionRequest(decision);
  return ledger;
}

function canonicalWorkspacePath(root) {
  const resolved = path.resolve(root);
  try { return fs.realpathSync.native(resolved); } catch { return resolved; }
}

function userStateBase(options = {}) {
  if (options.stateDirectory) return path.resolve(options.stateDirectory);
  const env = options.env || process.env;
  const candidate = env.XDG_STATE_HOME
    ? path.join(path.resolve(env.XDG_STATE_HOME), "code-workspace")
    : process.platform === "darwin"
      ? path.join(os.homedir(), "Library", "Application Support", "code-workspace")
      : process.platform === "win32" && env.LOCALAPPDATA
        ? path.join(path.resolve(env.LOCALAPPDATA), "code-workspace")
        : path.join(os.tmpdir(), "code-workspace-state");
  // Sandboxed CI/test runners may expose a read-only home directory. Keep
  // the platform convention when usable, otherwise use a deterministic
  // per-user temporary fallback rather than failing every Hook invocation.
  try {
    const parent = fs.existsSync(candidate) ? candidate : path.dirname(candidate);
    fs.accessSync(parent, fs.constants.W_OK);
    return candidate;
  } catch {
    return path.join(os.tmpdir(), "code-workspace-state");
  }
}

function resolveStateDirectory(options = {}) {
  const workspaceRoot = canonicalWorkspacePath(options.workspaceRoot || options.root || process.cwd());
  const workspaceUuid = requiredString(options.workspaceUuid || options.uuid || "unknown-workspace", "workspaceUuid");
  const workspaceHash = crypto.createHash("sha256").update(`${workspaceUuid}\u0000${workspaceRoot}`).digest("hex");
  const directory = path.join(userStateBase(options), "task-coordination", workspaceHash);
  return { directory, workspaceRoot, workspaceUuid, workspaceHash, ledgerPath: path.join(directory, "ledger.json"), lockPath: path.join(directory, "ledger.lock"), backupPath: path.join(directory, "ledger.json.bak") };
}

function ensureLedgerPaths(paths) {
  fs.mkdirSync(paths.directory, { recursive: true, mode: 0o700 });
  if (!fs.existsSync(paths.lockPath)) fs.writeFileSync(paths.lockPath, "", { mode: 0o600 });
  try { fs.chmodSync(paths.directory, 0o700); fs.chmodSync(paths.lockPath, 0o600); } catch { /* best effort on Windows */ }
}

function readLedger(pathsInput) {
  const paths = pathsInput.ledgerPath ? pathsInput : resolveStateDirectory(pathsInput);
  ensureLedgerPaths(paths);
  if (!fs.existsSync(paths.ledgerPath)) return emptyLedger();
  let parsed;
  try { parsed = JSON.parse(fs.readFileSync(paths.ledgerPath, "utf8")); }
  catch (error) {
    throw coordinationError("TASK_LEDGER_CORRUPT", `Cannot parse task coordination ledger ${paths.ledgerPath}: ${error.message}`, {
      file: paths.ledgerPath,
      backup: fs.existsSync(paths.backupPath) ? paths.backupPath : null,
      remediation: "Preserve the ledger, inspect the backup, then repair it explicitly before retrying.",
    });
  }
  try { return normalizeLedger(parsed); }
  catch (error) {
    if (error instanceof WorkspaceError) {
      error.details = { ...(error.details || {}), file: paths.ledgerPath, backup: fs.existsSync(paths.backupPath) ? paths.backupPath : null };
      throw error;
    }
    throw coordinationError("TASK_LEDGER_CORRUPT", `Invalid task coordination ledger ${paths.ledgerPath}: ${error.message}`, { file: paths.ledgerPath });
  }
}

function writeLedger(pathsInput, value, options = {}) {
  const paths = pathsInput.ledgerPath ? pathsInput : resolveStateDirectory(pathsInput);
  ensureLedgerPaths(paths);
  let ledger;
  try { ledger = normalizeLedger(value); }
  catch (error) { throw error instanceof WorkspaceError ? error : coordinationError("TASK_LEDGER_SCHEMA_INVALID", error.message, { file: paths.ledgerPath }); }
  const content = `${JSON.stringify(ledger, null, 2)}\n`;
  try {
    if (fs.existsSync(paths.ledgerPath)) fs.copyFileSync(paths.ledgerPath, paths.backupPath);
    atomicWrite(paths.ledgerPath, content);
    try { fs.chmodSync(paths.ledgerPath, 0o600); fs.chmodSync(paths.backupPath, 0o600); } catch { /* best effort */ }
  } catch (error) {
    throw coordinationError("TASK_LEDGER_WRITE_FAILED", `Cannot atomically write task coordination ledger ${paths.ledgerPath}: ${error.message}`, {
      file: paths.ledgerPath,
      backup: fs.existsSync(paths.backupPath) ? paths.backupPath : null,
      cause: error.code || error.name,
      remediation: "Retry after checking the external state directory permissions; the previous ledger was retained.",
    });
  }
  return ledger;
}

async function acquireLedgerMutex(pathsInput, options = {}) {
  const paths = pathsInput.ledgerPath ? pathsInput : resolveStateDirectory(pathsInput);
  ensureLedgerPaths(paths);
  const update = options.update || DEFAULT_MUTEX_UPDATE_MS;
  const stale = options.stale || DEFAULT_MUTEX_STALE_MS;
  const timeout = options.timeout == null ? DEFAULT_MUTEX_TIMEOUT_MS : options.timeout;
  let release;
  let timer;
  try {
    const acquire = properLockfile.lock(paths.lockPath, { realpath: false, retries: false, update, stale });
    const guarded = timeout > 0 ? Promise.race([
      acquire,
      new Promise((_, reject) => { timer = setTimeout(() => reject(Object.assign(new Error("ledger mutex acquisition timed out"), { code: "ELOCKED" })), timeout); }),
    ]) : acquire;
    release = await guarded;
    if (timer) clearTimeout(timer);
  } catch (error) {
    if (timer) clearTimeout(timer);
    throw coordinationError("RETRY_COORDINATION_FAILURE", `Could not acquire task coordination ledger mutex: ${error.message}`, {
      file: paths.lockPath,
      cause: error.code || error.name,
      remediation: "Retry the operation; no user interaction or external tool should wait while the ledger mutex is held.",
    });
  }
  let released = false;
  return async () => {
    if (released) return;
    released = true;
    try { await release(); }
    catch (error) { throw coordinationError("TASK_LEDGER_MUTEX_RELEASE_FAILED", `Could not release task coordination ledger mutex: ${error.message}`, { file: paths.lockPath, cause: error.code || error.name }); }
  };
}

async function withLedgerMutex(pathsInput, callback, options = {}) {
  const release = await acquireLedgerMutex(pathsInput, options);
  try { return await callback(); } finally { await release(); }
}

function mutateLedger(paths, mutator, options = {}) {
  return withLedgerMutex(paths, async () => {
    const before = readLedger(paths);
    const original = JSON.stringify(before);
    const mutated = mutator(before) || before;
    const next = normalizeLedger(mutated);
    const changed = original !== JSON.stringify(next);
    if (options.write !== false && changed) {
      next.ledgerRevision = before.ledgerRevision + 1;
      writeLedger(paths, next);
    }
    return next;
  }, options);
}

function nearestExistingParent(input) {
  let current = path.resolve(input);
  const suffix = [];
  while (!fs.existsSync(current)) {
    suffix.unshift(path.basename(current));
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return { parent: current, suffix };
}

function canonicalProjectTarget(projectRealPath, target, options = {}) {
  const project = canonicalWorkspacePath(projectRealPath);
  const candidate = path.isAbsolute(String(target)) ? String(target) : path.join(project, String(target));
  const existing = fs.existsSync(candidate) ? candidate : nearestExistingParent(candidate).parent;
  let base;
  try { base = fs.realpathSync.native(existing); } catch { base = path.resolve(existing); }
  const absentSuffix = fs.existsSync(candidate) ? [] : nearestExistingParent(candidate).suffix;
  const normalized = path.resolve(base, ...absentSuffix);
  const projectComparable = process.platform === "win32" ? project.toLowerCase() : project;
  const normalizedComparable = process.platform === "win32" ? normalized.toLowerCase() : normalized;
  const inside = normalizedComparable === projectComparable || normalizedComparable.startsWith(`${projectComparable}${path.sep}`);
  if (!inside) throw coordinationError("TASK_PATH_OUTSIDE_PROJECT", `Target path escapes project ${project}: ${target}`, { projectRealPath: project, target, normalizedPath: normalized });
  return normalized;
}

function normalizeScopes(projectRealPath, scopes, options = {}) {
  const inputs = Array.isArray(scopes) ? scopes : [scopes];
  if (inputs.length === 0) throw coordinationError("TASK_SCOPE_INVALID", "At least one write scope is required");
  const normalized = inputs.map((input) => {
    const value = typeof input === "string" ? { type: "EXACT_FILE", path: input } : { ...input };
    const type = String(value.type || value.kind || "EXACT_FILE").toUpperCase();
    if (!SCOPE_TYPES.includes(type)) throw coordinationError("TASK_SCOPE_INVALID", `Unknown scope type: ${type}`, { type });
    const scope = { type, projectRealPath: canonicalWorkspacePath(projectRealPath) };
    if (type !== "PROJECT_WIDE") scope.path = canonicalProjectTarget(scope.projectRealPath, value.path || value.target, options);
    else scope.path = scope.projectRealPath;
    scope.normalizedPath = scope.path;
    scope.scopeId = `${type}:${scope.path}`;
    return scope;
  });
  const unique = new Map(normalized.map((scope) => [scope.scopeId, scope]));
  return [...unique.values()].sort((left, right) => left.scopeId.localeCompare(right.scopeId));
}

function scopeOverlaps(left, right) {
  const leftProjectPath = canonicalWorkspacePath(left.projectRealPath);
  const rightProjectPath = canonicalWorkspacePath(right.projectRealPath);
  const projectLeft = process.platform === "win32" ? leftProjectPath.toLowerCase() : leftProjectPath;
  const projectRight = process.platform === "win32" ? rightProjectPath.toLowerCase() : rightProjectPath;
  if (projectLeft !== projectRight) return false;
  if (left.type === "PROJECT_WIDE" || right.type === "PROJECT_WIDE") return true;
  const canonicalScopePath = (scope, projectPath) => {
    if (scope.type === "PROJECT_WIDE") return projectPath;
    const relative = path.relative(path.resolve(scope.projectRealPath), path.resolve(scope.path));
    return canonicalProjectTarget(projectPath, relative);
  };
  const aPath = canonicalScopePath(left, leftProjectPath);
  const bPath = canonicalScopePath(right, rightProjectPath);
  const a = process.platform === "win32" ? aPath.toLowerCase() : aPath;
  const b = process.platform === "win32" ? bPath.toLowerCase() : bPath;
  if (left.type === "EXACT_FILE" && right.type === "EXACT_FILE") return a === b;
  if (left.type === "DIRECTORY_TREE" && right.type === "DIRECTORY_TREE") return a === b || a.startsWith(`${b}${path.sep}`) || b.startsWith(`${a}${path.sep}`);
  const file = left.type === "EXACT_FILE" ? a : b;
  const tree = left.type === "DIRECTORY_TREE" ? a : b;
  return file === tree || file.startsWith(`${tree}${path.sep}`);
}

function fingerprint(file) {
  const target = path.resolve(file);
  let stat;
  try { stat = fs.lstatSync(target); }
  catch (error) {
    if (error.code === "ENOENT") return { path: target, exists: false, type: "missing", mode: null, contentHash: null };
    throw coordinationError("TASK_FINGERPRINT_FAILED", `Cannot inspect ${target}: ${error.message}`, { path: target, cause: error.code || error.name });
  }
  const type = stat.isSymbolicLink() ? "symlink" : stat.isDirectory() ? "directory" : stat.isFile() ? "file" : "other";
  let contentHash = null;
  if (type === "file") {
    try { contentHash = sha256(fs.readFileSync(target)); }
    catch (error) { throw coordinationError("TASK_FINGERPRINT_FAILED", `Cannot hash ${target}: ${error.message}`, { path: target, cause: error.code || error.name }); }
  }
  return { path: target, exists: true, type, mode: stat.mode & 0o7777, size: stat.size, contentHash };
}

function parsePorcelainV2(raw) {
  const entries = [];
  const chunks = String(raw || "").split("\0").filter(Boolean);
  for (let index = 0; index < chunks.length; index += 1) {
    const chunk = chunks[index];
    const fields = chunk.split(" ");
    const code = chunk[0];
    const entry = { raw: chunk, code, path: fields.at(-1) || null, staged: ["1", "2"].includes(code) ? fields[1]?.[0] !== "." : null, worktree: ["1", "2"].includes(code) ? fields[1]?.[1] !== "." : null };
    if (code === "2" && chunks[index + 1] && !/^[12u?!#] /.test(chunks[index + 1])) entry.originalPath = chunks[++index];
    entries.push(entry);
  }
  return entries;
}

function gitPathStatus(projectRealPath, paths, options = {}) {
  const location = canonicalWorkspacePath(projectRealPath);
  const targets = (Array.isArray(paths) ? paths : [paths]).map((entry) => path.relative(location, entry) || ".");
  const args = ["-C", location, "status", "--porcelain=v2", "-z", "--untracked-files=all", "--", ...targets];
  const result = spawnSync("git", args, { encoding: "utf8", timeout: options.timeout || 5000 });
  if (result.error) throw coordinationError("TASK_GIT_STATUS_FAILED", `Cannot inspect Git status: ${result.error.message}`, { projectRealPath: location, args, cause: result.error.code || result.error.name });
  if (result.status !== 0) {
    const message = String(result.stderr || result.stdout || "").trim();
    const nonGit = /not a git repository/i.test(message);
    if (nonGit) return { git: false, dirty: false, entries: [], raw: "", error: message };
    throw coordinationError("TASK_GIT_STATUS_FAILED", message || "git status failed", { projectRealPath: location, args, exitCode: result.status });
  }
  const raw = String(result.stdout || "");
  const entries = parsePorcelainV2(raw);
  const ignoredResult = spawnSync("git", ["-C", location, "check-ignore", "-z", "--", ...targets], { encoding: "utf8", timeout: options.timeout || 5000 });
  const ignored = ignoredResult.status === 0 ? String(ignoredResult.stdout || "").split("\0").filter(Boolean) : [];
  const trackedResult = spawnSync("git", ["-C", location, "ls-files", "-z", "--", ...targets], { encoding: "utf8", timeout: options.timeout || 5000 });
  const tracked = trackedResult.status === 0 ? String(trackedResult.stdout || "").split("\0").filter(Boolean) : [];
  const untracked = entries.filter((entry) => entry.code === "?").map((entry) => entry.path);
  const pathStates = targets.map((target) => ({
    path: target,
    ignored: ignored.includes(target),
    untracked: untracked.includes(target),
    tracked: tracked.includes(target),
    dirty: entries.some((entry) => entry.path === target || entry.originalPath === target),
  }));
  return { git: true, dirty: entries.length > 0, entries, raw, ignored, untracked, tracked, pathStates };
}

function pathEvidence(projectRealPath, targets, options = {}) {
  const normalized = (Array.isArray(targets) ? targets : [targets]).map((target) => canonicalProjectTarget(projectRealPath, target));
  const fingerprints = normalized.map(fingerprint);
  const git = gitPathStatus(projectRealPath, normalized, options);
  return { paths: normalized, fingerprints, git, collectedAt: nowIso(options.clock) };
}

function taskForIdentity(ledger, identity) {
  const key = taskIdFor(identity);
  return ledger.tasks[key] || null;
}

function currentGeneration(ledger, identity) {
  return ledger.sessionGenerations[taskGenerationKey(identity.workspaceUuid, identity.provider, identity.nativeSessionId)] || 0;
}

function ensureTaskForEvent(ledger, identity, eventType, options = {}) {
  const parentSessionId = identity.parentSessionId || identity.nativeSessionId;
  const generationKey = taskGenerationKey(identity.workspaceUuid, identity.provider, parentSessionId);
  const suppliedGeneration = identity.generation == null ? null : nonNegativeInteger(identity.generation, "generation");
  let generation = suppliedGeneration || ledger.sessionGenerations[generationKey] || 0;
  const existing = generation ? ledger.tasks[taskIdFor({ ...identity, nativeSessionId: parentSessionId, generation })] : null;
  if (eventType === "task.started" || !existing) {
    if (!existing || existing.status === ENDED || existing.revoked) {
      generation = Math.max(generation + 1, 1);
      ledger.sessionGenerations[generationKey] = generation;
    }
  }
  const normalizedIdentity = { ...identity, nativeSessionId: parentSessionId, generation };
  const taskId = taskIdFor(normalizedIdentity);
  const revoked = ledger.revokedGenerations[taskId] === true || ledger.tasks[taskId]?.revoked === true;
  if (revoked && eventType !== "task.started") throw coordinationError("TASK_GENERATION_REVOKED", `Task generation has been revoked: ${taskId}`, { taskId, generation });
  if (!ledger.tasks[taskId]) {
    ledger.tasks[taskId] = normalizeTask({ ...normalizedIdentity, taskId, status: ACTIVE, phase: "STARTING", lastEvent: eventType, parentSessionId: identity.parentSessionId || null }, options);
  }
  return ledger.tasks[taskId];
}

function reconcileLedger(ledger, options = {}) {
  const threshold = options.activityThresholdMs == null ? DEFAULT_ACTIVITY_THRESHOLD_MS : options.activityThresholdMs;
  const now = options.now == null ? Date.now() : options.now;
  for (const task of Object.values(ledger.tasks)) {
    if (task.status !== ACTIVE) continue;
    const age = now - Date.parse(task.lastSeenAt);
    if (age > threshold) {
      task.status = UNKNOWN;
      task.unknownSince = task.unknownSince || new Date(now).toISOString();
      task.phase = task.phase || "UNKNOWN";
      for (const participation of Object.values(ledger.participations)) {
        if (participation.taskId === task.taskId && participation.status === ACTIVE) participation.status = UNKNOWN;
      }
      appendAudit(ledger, { action: "TASK_BECAME_UNKNOWN", taskId: task.taskId, at: new Date(now).toISOString(), ageMs: age });
    }
  }
}

function appendAudit(ledger, entry) {
  ledger.audit.push({ auditId: crypto.randomUUID(), at: nowIso(), ...entry });
  if (ledger.audit.length > 1000) ledger.audit.splice(0, ledger.audit.length - 1000);
}

function eventIdentity(input = {}) {
  const workspaceUuid = requiredString(input.workspaceUuid, "workspaceUuid");
  const provider = requiredString(input.provider, "provider");
  const nativeSessionId = requiredString(input.nativeSessionId || input.sessionId, "nativeSessionId");
  const agent = isObject(input.agent) ? input.agent : {};
  return {
    workspaceUuid,
    provider,
    nativeSessionId: agent.parentSessionId || input.parentSessionId || nativeSessionId,
    generation: input.generation,
    parentSessionId: agent.parentSessionId || input.parentSessionId || null,
    agent,
  };
}

function eventKey(event) {
  if (event.eventId) return requiredString(event.eventId, "eventId");
  return sha256(JSON.stringify({ provider: event.provider, nativeEventName: event.nativeEventName, nativeSessionId: event.nativeSessionId, operationId: event.operationId || null, eventType: event.eventType, occurredAt: event.occurredAt || null }));
}

async function applyTaskEvent(options = {}) {
  const event = options.event || options;
  const paths = options.paths || resolveStateDirectory({ workspaceRoot: options.workspaceRoot || options.root || event.cwd, workspaceUuid: event.workspaceUuid, stateDirectory: options.stateDirectory, env: options.env });
  const eventType = requiredString(event.eventType || event.type, "eventType");
  const identity = eventIdentity(event);
  return mutateLedger(paths, (ledger) => {
    reconcileLedger(ledger, options);
    const id = eventKey(event);
    if (ledger.processedEvents[id]) return ledger;
    const task = ensureTaskForEvent(ledger, identity, eventType, options);
    if (event.agent?.isSubagent) task.agentEvidence.push({ ...event.agent, eventType, at: event.occurredAt || nowIso() });
    const occurredAt = event.occurredAt ? parseTime(event.occurredAt, "occurredAt") : nowIso(options.clock);
    if (eventType === "task.ended") {
      task.status = ENDED;
      task.endedAt = occurredAt;
      task.endReason = event.endReason || "SESSION_END";
      task.phase = "ENDED";
      for (const claim of Object.values(ledger.claims)) {
        if (claim.taskId === task.taskId && claim.enforcement) {
          claim.enforcement = false; claim.releasedAt = occurredAt; claim.releaseReason = task.endReason;
        }
      }
      for (const participation of Object.values(ledger.participations)) {
        if (participation.taskId === task.taskId && participation.status !== ENDED) {
          participation.status = ENDED; participation.endedAt = occurredAt; participation.endReason = task.endReason;
        }
      }
      appendAudit(ledger, { action: "TASK_ENDED", taskId: task.taskId, reason: task.endReason });
    } else {
      if (task.status === UNKNOWN) {
        task.status = ACTIVE;
        for (const participation of Object.values(ledger.participations)) {
          if (participation.taskId === task.taskId && participation.status === UNKNOWN) participation.status = ACTIVE;
        }
      }
      task.lastSeenAt = occurredAt;
      task.lastEvent = eventType;
      task.phase = event.phase || ({ "task.started": "STARTING", "task.activity": "WAITING", "task.waiting": "WAITING", "task.turn-ended": "TURN_ENDED", "write.before": "TOOL_RUNNING", "write.after": "TOOL_FINISHED" }[eventType] || task.phase);
      task.runtimeEvidence = { ...task.runtimeEvidence, ...(event.runtimeEvidence || {}), ...(event.processEvidence ? { process: event.processEvidence } : {}) };
      if (eventType === "task.started") task.revoked = false;
    }
    ledger.processedEvents[id] = { eventType, taskId: task.taskId, at: occurredAt };
    appendAudit(ledger, { action: "EVENT", eventId: id, eventType, taskId: task.taskId });
    return ledger;
  }, options);
}

function activeClaims(ledger, options = {}) {
  const taskMap = ledger.tasks;
  return Object.values(ledger.claims).filter((claim) => claim.enforcement && claim.scope && (!options.projectRealPath || claim.scope.projectRealPath === options.projectRealPath)).filter((claim) => {
    const owner = taskMap[claim.taskId];
    return owner && (owner.status === ACTIVE || owner.status === UNKNOWN);
  });
}

function activeParticipations(ledger, projectRealPath) {
  return Object.values(ledger.participations).filter((entry) => entry.projectRealPath === projectRealPath && (entry.status === ACTIVE || entry.status === UNKNOWN)).filter((entry) => {
    const task = ledger.tasks[entry.taskId];
    return task && (task.status === ACTIVE || task.status === UNKNOWN);
  });
}

function evidenceForClaim(claim, owner, currentEvidence = null) {
  const evidence = {
    task: owner ? { taskId: owner.taskId, provider: owner.provider, nativeSessionId: owner.nativeSessionId, generation: owner.generation, status: owner.status, phase: owner.phase, lastEvent: owner.lastEvent, lastSeenAt: owner.lastSeenAt, unknownSince: owner.unknownSince } : null,
    claim: { claimId: claim.claimId, type: claim.type, scope: claim.scope, operationId: claim.operationId, toolName: claim.toolName, createdAt: claim.createdAt, claimRevision: claim.claimRevision },
    beforeFingerprint: claim.beforeFingerprint,
    currentFingerprint: claim.currentFingerprint,
    beforeGit: claim.beforeGit,
    currentGit: claim.currentGit,
    dirtyToClean: claim.dirtyToClean,
    process: owner?.runtimeEvidence?.process || null,
    currentEvidence,
  };
  return { evidence, evidenceHash: sha256(JSON.stringify(evidence)) };
}

function decisionKey(type, requesterTaskId, ownerTaskId, claimId, projectRealPath) {
  return sha256([type, requesterTaskId || "", ownerTaskId || "", claimId || "", projectRealPath || ""].join("\u0000"));
}

function findPendingDecision(ledger, key) {
  return Object.values(ledger.decisions).find((decision) => decision.status === "PENDING" && decision.dedupeKey === key) || null;
}

function createDecision(ledger, value) {
  const key = value.dedupeKey || decisionKey(value.type, value.requesterTaskId, value.ownerTaskId, value.claimId, value.projectRealPath);
  const existing = findPendingDecision(ledger, key);
  if (existing) return existing;
  const decision = normalizeDecisionRequest({ ...value, decisionRequestId: value.decisionRequestId || crypto.randomUUID(), dedupeKey: key, ledgerRevision: ledger.ledgerRevision, evidenceHash: value.evidenceHash || sha256(JSON.stringify(value.evidence || {})) });
  decision.dedupeKey = key;
  ledger.decisions[decision.decisionRequestId] = decision;
  appendAudit(ledger, { action: "DECISION_CREATED", decisionRequestId: decision.decisionRequestId, type: decision.type });
  return decision;
}

function projectParticipationFor(ledger, taskId, projectRealPath) {
  return Object.values(ledger.participations).find((entry) => entry.taskId === taskId && entry.projectRealPath === projectRealPath && entry.status !== ENDED) || null;
}

function approvalKey(projectRealPath, requesterTask, ownerTask) {
  return [projectRealPath, requesterTask.taskId, requesterTask.generation, ownerTask.taskId, ownerTask.generation].join("\u0000");
}

function hasApproval(ledger, projectRealPath, requester, owner) {
  const key = approvalKey(projectRealPath, requester, owner);
  const approval = ledger.approvals[key];
  if (!approval) return false;
  const ownerCurrent = ledger.tasks[owner.taskId];
  const requesterCurrent = ledger.tasks[requester.taskId];
  return ownerCurrent?.status === ACTIVE && requesterCurrent?.status === ACTIVE && approval.ownerGeneration === owner.generation && approval.requesterGeneration === requester.generation;
}

function buildClaim(task, scope, operationId, event, beforeEvidence, claimRevision) {
  return normalizeClaim({
    claimId: crypto.randomUUID(), type: "WRITE_RESERVATION", enforcement: true, taskId: task.taskId, workspaceUuid: task.workspaceUuid, generation: task.generation,
    operationId, toolName: event.tool?.name || event.toolName || null, createdAt: nowIso(), claimRevision, scope,
    beforeFingerprint: beforeEvidence?.fingerprints?.find((entry) => entry.path === scope.path) || null,
    beforeGit: beforeEvidence?.git || null,
  });
}

async function beforeWrite(options = {}) {
  const event = options.event || options;
  const identity = eventIdentity(event);
  const projectRealPath = canonicalWorkspacePath(options.projectRealPath || event.projectRealPath || event.project?.realPath);
  const scopes = normalizeScopes(projectRealPath, options.scopes || event.scopes || event.tool?.scopes || [{ type: "PROJECT_WIDE" }]);
  const operationId = requiredString(options.operationId || event.operationId || event.tool?.callId || crypto.randomUUID(), "operationId");
  const paths = options.paths || resolveStateDirectory({ workspaceRoot: options.workspaceRoot || options.root || event.cwd, workspaceUuid: identity.workspaceUuid, stateDirectory: options.stateDirectory, env: options.env });
  const targets = scopes.filter((scope) => scope.type !== "PROJECT_WIDE").map((scope) => scope.path);
  const maxRetries = options.maxRetries == null ? 2 : options.maxRetries;
  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    const observedRevision = readLedger(paths).ledgerRevision;
    const evidence = targets.length > 0 ? pathEvidence(projectRealPath, targets, options) : null;
    let result;
    try {
      result = await withLedgerMutex(paths, async () => {
      const ledger = readLedger(paths);
      const beforeRevision = ledger.ledgerRevision;
      if (beforeRevision !== observedRevision) return { decision: "RETRY_COORDINATION_FAILURE", retry: true, ledgerRevision: beforeRevision };
      reconcileLedger(ledger, options);
      const task = ensureTaskForEvent(ledger, identity, "write.before", options);
      if (task.status === ENDED || task.revoked) throw coordinationError("TASK_GENERATION_REVOKED", `Task generation is not writable: ${task.taskId}`, { taskId: task.taskId });
      const eventId = eventKey(event);
      const processed = ledger.processedEvents[eventId];
      if (processed?.eventType === "write.before") {
        return {
          decision: processed.decision,
          taskId: task.taskId,
          operationId: processed.operationId || operationId,
          decisionRequestId: processed.decisionRequestId || null,
          claims: Object.values(ledger.claims).filter((claim) => claim.taskId === task.taskId && claim.operationId === (processed.operationId || operationId)),
          duplicate: true,
          ledgerRevision: ledger.ledgerRevision,
        };
      }
      task.status = ACTIVE; task.lastSeenAt = nowIso(options.clock); task.lastEvent = "write.before"; task.phase = "TOOL_RUNNING";
      injectFailure(options, "write-before-decision", { taskId: task.taskId, ledgerRevision: beforeRevision });
      const existingClaims = activeClaims(ledger, { projectRealPath });
      const overlaps = [];
      for (const claim of existingClaims) {
        if (claim.taskId === task.taskId) continue;
        if (scopes.some((scope) => scopeOverlaps(scope, claim.scope))) overlaps.push(claim);
      }
      const hasProjectWide = scopes.some((scope) => scope.type === "PROJECT_WIDE");
      const participants = activeParticipations(ledger, projectRealPath).filter((entry) => entry.taskId !== task.taskId);
      if (hasProjectWide && (participants.length > 0 || existingClaims.some((claim) => claim.taskId !== task.taskId))) {
        ledger.processedEvents[eventId] = { eventType: "write.before", decision: "DENY_UNKNOWN_WRITE_SCOPE", taskId: task.taskId, operationId };
        ledger.ledgerRevision = beforeRevision + 1;
        writeLedger(paths, ledger);
        return { decision: "DENY_UNKNOWN_WRITE_SCOPE", taskId: task.taskId, scopes, evidence, owner: overlaps[0] ? ledger.tasks[overlaps[0].taskId] : null, ledgerRevision: ledger.ledgerRevision };
      }
      if (overlaps.length > 0) {
        const owner = ledger.tasks[overlaps[0].taskId];
        const claim = overlaps[0];
        const claimEvidence = evidenceForClaim(claim, owner, evidence);
        if (owner?.status === ACTIVE) {
          ledger.processedEvents[eventId] = { eventType: "write.before", decision: "DENY_FILE_CONFLICT", taskId: task.taskId, operationId, ownerTaskId: owner.taskId, claimId: claim.claimId };
          ledger.ledgerRevision = beforeRevision + 1;
          writeLedger(paths, ledger);
          return { decision: "DENY_FILE_CONFLICT", taskId: task.taskId, owner, claim, evidence: claimEvidence.evidence, evidenceHash: claimEvidence.evidenceHash, scopes, ledgerRevision: ledger.ledgerRevision, remediation: "Wait for the active task to finish or coordinate with its owner; there is no force override." };
        }
        const decision = createDecision(ledger, { type: "UNKNOWN_OWNER_DECISION_REQUIRED", requesterTaskId: task.taskId, ownerTaskId: owner?.taskId, ownerGeneration: owner?.generation, claimId: claim.claimId, claimType: claim.type, projectRealPath, scope: claim.scope, ledgerRevision: beforeRevision, claimRevision: claim.claimRevision, evidence: claimEvidence.evidence, evidenceHash: claimEvidence.evidenceHash, options: claim.type === "DIRTY_CLAIM" ? ["KEEP", "RELEASE_CLAIM", "INSPECT"] : ["KEEP", "ABANDON_TASK_AND_RELEASE", "INSPECT"], consequence: "The requester must retry write.before after the decision; this request does not grant a reservation." });
        ledger.processedEvents[eventId] = { eventType: "write.before", decision: "UNKNOWN_OWNER_DECISION_REQUIRED", taskId: task.taskId, operationId, decisionRequestId: decision.decisionRequestId, ownerTaskId: owner?.taskId, claimId: claim.claimId };
        ledger.ledgerRevision = beforeRevision + 1;
        decision.ledgerRevision = ledger.ledgerRevision;
        writeLedger(paths, ledger);
        return { decision: "UNKNOWN_OWNER_DECISION_REQUIRED", taskId: task.taskId, owner, claim, decisionRequestId: decision.decisionRequestId, evidence: claimEvidence.evidence, evidenceHash: claimEvidence.evidenceHash, scopes, ledgerRevision: ledger.ledgerRevision };
      }
      const ownerTasks = participants.map((entry) => ledger.tasks[entry.taskId]).filter(Boolean);
      const unapproved = ownerTasks.find((owner) => !hasApproval(ledger, projectRealPath, task, owner));
      if (unapproved) {
        const decision = createDecision(ledger, { type: "CONFIRM_PROJECT", requesterTaskId: task.taskId, ownerTaskId: unapproved.taskId, ownerGeneration: unapproved.generation, projectRealPath, ledgerRevision: beforeRevision, evidence: { requester: task, owner: unapproved, scopes }, options: ["APPROVE_PROJECT_PARALLEL", "INSPECT"], consequence: "Approve project parallelism, then retry the original tool call." });
        ledger.processedEvents[eventId] = { eventType: "write.before", decision: "CONFIRM_PROJECT", taskId: task.taskId, operationId, decisionRequestId: decision.decisionRequestId, ownerTaskId: unapproved.taskId };
        ledger.ledgerRevision = beforeRevision + 1;
        decision.ledgerRevision = ledger.ledgerRevision;
        writeLedger(paths, ledger);
        return { decision: "CONFIRM_PROJECT", taskId: task.taskId, owner: unapproved, decisionRequestId: decision.decisionRequestId, scopes, ledgerRevision: ledger.ledgerRevision };
      }
      if (!projectParticipationFor(ledger, task.taskId, projectRealPath)) {
        const participation = normalizeParticipation({ projectRealPath, taskId: task.taskId, workspaceUuid: task.workspaceUuid, generation: task.generation, status: ACTIVE });
        ledger.participations[participation.participationId] = participation;
      }
      const claims = scopes.map((scope) => buildClaim(task, scope, operationId, event, evidence, ledger.ledgerRevision + 1));
      for (const claim of claims) ledger.claims[claim.claimId] = claim;
      ledger.processedEvents[eventId] = { eventType: "write.before", decision: "ALLOW", taskId: task.taskId, operationId };
      appendAudit(ledger, { action: "WRITE_RESERVED", taskId: task.taskId, operationId, claims: claims.map((claim) => claim.claimId) });
      ledger.ledgerRevision = beforeRevision + 1;
      writeLedger(paths, ledger);
      return { decision: "ALLOW", taskId: task.taskId, operationId, claims, scopes, ledgerRevision: ledger.ledgerRevision, evidence };
      }, options);
    } catch (error) {
      if (error.code === "RETRY_COORDINATION_FAILURE" && attempt < maxRetries) continue;
      throw error;
    }
    if (result?.decision !== "RETRY_COORDINATION_FAILURE") return result;
  }
  return { decision: "RETRY_COORDINATION_FAILURE", remediation: "Retry the Hook operation after the coordination ledger becomes available." };
}

function fingerprintsChanged(before, after) {
  return JSON.stringify(before || null) !== JSON.stringify(after || null);
}

async function afterWrite(options = {}) {
  const event = options.event || options;
  const identity = eventIdentity(event);
  const paths = options.paths || resolveStateDirectory({ workspaceRoot: options.workspaceRoot || options.root || event.cwd, workspaceUuid: identity.workspaceUuid, stateDirectory: options.stateDirectory, env: options.env });
  const operationId = requiredString(options.operationId || event.operationId || event.tool?.callId, "operationId");
  // Capture filesystem/Git evidence before entering the ledger mutex. The
  // revision check below prevents a stale snapshot from releasing a claim.
  const observedLedger = readLedger(paths);
  let observedTaskId = taskIdFor({ ...identity, generation: identity.generation || currentGeneration(observedLedger, identity) });
  if (!identity.generation) {
    const operationClaim = Object.values(observedLedger.claims).find((claim) => claim.operationId === operationId && observedLedger.tasks[claim.taskId]?.provider === identity.provider && observedLedger.tasks[claim.taskId]?.nativeSessionId === identity.nativeSessionId);
    if (operationClaim) observedTaskId = operationClaim.taskId;
  }
  const evidenceSnapshots = {};
  for (const claim of Object.values(observedLedger.claims).filter((entry) => entry.taskId === observedTaskId && entry.operationId === operationId && entry.type === "WRITE_RESERVATION" && entry.enforcement)) {
    const target = claim.scope.type === "PROJECT_WIDE" ? claim.scope.projectRealPath : claim.scope.path;
    evidenceSnapshots[claim.claimId] = pathEvidence(claim.scope.projectRealPath, [target], options);
  }
  return withLedgerMutex(paths, async () => {
    const ledger = readLedger(paths);
    if (ledger.ledgerRevision !== observedLedger.ledgerRevision) throw coordinationError("RETRY_COORDINATION_FAILURE", "Ledger changed while collecting write-after evidence; retry the after-event.", { expectedRevision: observedLedger.ledgerRevision, actualRevision: ledger.ledgerRevision });
    let taskId = taskIdFor({ ...identity, generation: identity.generation || currentGeneration(ledger, identity) });
    if (!identity.generation) {
      const operationClaim = Object.values(ledger.claims).find((claim) => claim.operationId === operationId && ledger.tasks[claim.taskId]?.provider === identity.provider && ledger.tasks[claim.taskId]?.nativeSessionId === identity.nativeSessionId);
      if (operationClaim) taskId = operationClaim.taskId;
    }
    if (ledger.processedEvents[eventKey(event)]) return { action: "duplicate", taskId, operationId, ledgerRevision: ledger.ledgerRevision };
    const task = ledger.tasks[taskId];
    if (!task) throw coordinationError("TASK_NOT_FOUND", `Unknown task for write.after: ${taskId}`, { taskId });
    if (task.revoked) throw coordinationError("TASK_GENERATION_REVOKED", `Task generation has been revoked: ${taskId}`, { taskId });
    const claims = Object.values(ledger.claims).filter((claim) => claim.taskId === taskId && claim.operationId === operationId && claim.type === "WRITE_RESERVATION" && claim.enforcement);
    if (claims.length === 0) {
      ledger.processedEvents[eventKey(event)] = { eventType: "write.after", taskId, operationId, late: true };
      ledger.ledgerRevision += 1; writeLedger(paths, ledger);
      return { action: "late", taskId, operationId, ledgerRevision: ledger.ledgerRevision };
    }
    const convertedClaims = [];
    for (const claim of claims) {
      const target = claim.scope.type === "PROJECT_WIDE" ? claim.scope.projectRealPath : claim.scope.path;
      const current = evidenceSnapshots[claim.claimId] || pathEvidence(claim.scope.projectRealPath, [target], options);
      const beforeFp = claim.beforeFingerprint;
      const afterFp = current.fingerprints[0];
      const changed = fingerprintsChanged(beforeFp, afterFp);
      const pathState = current.git.pathStates?.[0] || null;
      const trackedClean = current.git.git && pathState?.tracked && !pathState.dirty;
      const dirty = trackedClean ? false : current.git.dirty || (afterFp.exists && !beforeFp?.exists) || changed;
      claim.currentFingerprint = afterFp;
      claim.currentGit = current.git;
      if (claim.scope.type === "PROJECT_WIDE" && current.git.git && current.git.entries.length > 0) {
        claim.enforcement = false; claim.releasedAt = nowIso(options.clock); claim.releaseReason = "PROJECT_WIDE_EXPANDED";
        const actualPaths = [...new Set(current.git.entries.flatMap((entry) => [entry.path, entry.originalPath]).filter(Boolean))];
        for (const relativePath of actualPaths) {
          const exactPath = canonicalProjectTarget(claim.scope.projectRealPath, relativePath);
          const exact = normalizeClaim({
            ...claim,
            claimId: crypto.randomUUID(),
            type: "DIRTY_CLAIM",
            enforcement: true,
            claimRevision: claim.claimRevision + 1,
            scope: { type: "EXACT_FILE", projectRealPath: claim.scope.projectRealPath, path: exactPath },
            beforeFingerprint: null,
            currentFingerprint: fingerprint(exactPath),
            releaseReason: null,
            releasedAt: null,
          });
          ledger.claims[exact.claimId] = exact;
          convertedClaims.push(exact);
        }
        continue;
      }
      if (!changed || (!dirty && event.success !== false)) {
        claim.enforcement = false; claim.releasedAt = nowIso(options.clock); claim.releaseReason = changed ? "TOOL_SELF_CLEAN" : "NO_CHANGE";
      } else {
        claim.type = "DIRTY_CLAIM"; claim.claimRevision += 1;
        if (!dirty) { claim.enforcement = false; claim.releaseReason = "CLEAN_AFTER_WRITE"; claim.releasedAt = nowIso(options.clock); }
      }
    }
    ledger.processedEvents[eventKey(event)] = { eventType: "write.after", taskId, operationId };
    ledger.ledgerRevision += 1;
    appendAudit(ledger, { action: "WRITE_AFTER", taskId, operationId, success: event.success !== false });
    injectFailure(options, "write-after-before-commit", { taskId, operationId, ledgerRevision: ledger.ledgerRevision });
    writeLedger(paths, ledger);
    return { action: "converted", taskId, operationId, claims: [...claims, ...convertedClaims].map((claim) => ({ ...claim })), ledgerRevision: ledger.ledgerRevision };
  }, options);
}

async function reconcileClaims(options = {}) {
  const paths = options.paths || resolveStateDirectory(options);
  return withLedgerMutex(paths, async () => {
    const ledger = readLedger(paths);
    let changed = false;
    for (const claim of Object.values(ledger.claims)) {
      if (!claim.enforcement || claim.type !== "DIRTY_CLAIM") continue;
      const task = ledger.tasks[claim.taskId];
      if (!task || task.status !== ACTIVE) continue;
      const target = claim.scope.type === "PROJECT_WIDE" ? claim.scope.projectRealPath : claim.scope.path;
      const evidence = pathEvidence(claim.scope.projectRealPath, [target], options);
      const restored = !evidence.fingerprints[0].exists && !claim.beforeFingerprint?.exists || JSON.stringify(evidence.fingerprints[0]) === JSON.stringify(claim.beforeFingerprint);
      const pathState = evidence.git.pathStates?.[0] || null;
      const trackedClean = evidence.git.git && pathState?.tracked && !pathState.dirty;
      const clean = trackedClean || (!evidence.git.git || pathState?.ignored) && restored;
      if (clean) { claim.enforcement = false; claim.releasedAt = nowIso(options.clock); claim.releaseReason = "DIRTY_TO_CLEAN"; claim.dirtyToClean = true; changed = true; }
      claim.currentFingerprint = evidence.fingerprints[0]; claim.currentGit = evidence.git;
    }
    if (changed) { ledger.ledgerRevision += 1; writeLedger(paths, ledger); }
    return ledger;
  }, options);
}

function inspectTasks(options = {}) {
  const paths = options.paths || resolveStateDirectory(options);
  const ledger = readLedger(paths);
  reconcileLedger(ledger, options);
  return { ledgerRevision: ledger.ledgerRevision, tasks: Object.values(ledger.tasks).map((task) => ({ ...task })), decisions: Object.values(ledger.decisions).filter((decision) => decision.status === "PENDING").map((decision) => ({ ...decision })) };
}

function inspectLocks(options = {}) {
  const paths = options.paths || resolveStateDirectory(options);
  const ledger = readLedger(paths);
  reconcileLedger(ledger, options);
  return { ledgerRevision: ledger.ledgerRevision, claims: Object.values(ledger.claims).map((claim) => ({ ...claim })), participations: Object.values(ledger.participations).map((entry) => ({ ...entry })) };
}

function inspectDecision(requestId, options = {}) {
  const paths = options.paths || resolveStateDirectory(options);
  const ledger = readLedger(paths);
  const decision = ledger.decisions[requestId];
  if (!decision) throw coordinationError("TASK_DECISION_NOT_FOUND", `Unknown task decision request: ${requestId}`, { decisionRequestId: requestId });
  return { ledgerRevision: ledger.ledgerRevision, decision: { ...decision }, owner: decision.ownerTaskId ? ledger.tasks[decision.ownerTaskId] || null : null, requester: decision.requesterTaskId ? ledger.tasks[decision.requesterTaskId] || null : null, claim: decision.claimId ? ledger.claims[decision.claimId] || null : null };
}

function planDecision(requestId, action, options = {}) {
  const inspected = inspectDecision(requestId, options);
  if (!DECISION_ACTIONS.includes(action)) throw coordinationError("TASK_DECISION_ACTION_INVALID", `Unsupported decision action: ${action}`, { action });
  const { decision, owner, claim } = inspected;
  if (decision.status !== "PENDING") throw coordinationError("TASK_DECISION_ALREADY_RESOLVED", `Decision request is already resolved: ${requestId}`, { decisionRequestId: requestId, resolution: decision.resolution });
  if (action === "RELEASE_CLAIM" && (owner?.status !== UNKNOWN || claim?.type !== "DIRTY_CLAIM")) throw coordinationError("TASK_DECISION_ACTION_NOT_ALLOWED", "release is only valid for an UNKNOWN DIRTY_CLAIM.", { decisionRequestId: requestId, ownerStatus: owner?.status || null, claimType: claim?.type || null });
  if (action === "ABANDON_TASK_AND_RELEASE" && owner?.status !== UNKNOWN) throw coordinationError("TASK_DECISION_ACTION_NOT_ALLOWED", "abandon is only valid for an UNKNOWN task generation.", { decisionRequestId: requestId, ownerStatus: owner?.status || null });
  if (action === "ABANDON_TASK_AND_RELEASE" && claim?.type === "DIRTY_CLAIM") throw coordinationError("TASK_DECISION_ACTION_NOT_ALLOWED", "A DIRTY_CLAIM can only be kept, inspected, or released; abandon is reserved for UNKNOWN reservations/project guards.", { decisionRequestId: requestId, claimType: claim.type });
  if (action === "APPROVE_PROJECT_PARALLEL" && decision.type !== "CONFIRM_PROJECT") throw coordinationError("TASK_DECISION_ACTION_NOT_ALLOWED", "approve is only valid for a project parallel confirmation.", { decisionRequestId: requestId, type: decision.type });
  if (action === "KEEP" && decision.type === "CONFIRM_PROJECT") throw coordinationError("TASK_DECISION_ACTION_NOT_ALLOWED", "Project parallel confirmation must use approve or an explicit project blocking decision.", { decisionRequestId: requestId, type: decision.type });
  if (action === "RELEASE_CLAIM" && claim?.type === "WRITE_RESERVATION") throw coordinationError("TASK_DECISION_ACTION_NOT_ALLOWED", "A WRITE_RESERVATION cannot be released as a single claim; abandon the whole generation.", { decisionRequestId: requestId });
  return { decisionRequestId: requestId, action, ledgerRevision: decision.ledgerRevision, ownerGeneration: decision.ownerGeneration, claimRevision: decision.claimRevision, evidenceHash: decision.evidenceHash, inspected };
}

async function applyDecision(plan, options = {}) {
  if (!plan || !plan.decisionRequestId) throw coordinationError("TASK_DECISION_PLAN_INVALID", "A decision plan is required");
  const paths = options.paths || resolveStateDirectory(options);
  return withLedgerMutex(paths, async () => {
    const ledger = readLedger(paths);
    const decision = ledger.decisions[plan.decisionRequestId];
    if (!decision || decision.status !== "PENDING") throw coordinationError("TASK_DECISION_STALE", "Decision request is no longer pending; inspect it again.", { decisionRequestId: plan.decisionRequestId });
    const owner = decision.ownerTaskId ? ledger.tasks[decision.ownerTaskId] : null;
    const claim = decision.claimId ? ledger.claims[decision.claimId] : null;
    // The plan carries the evidence hash captured by inspect.  Revision and
    // claimRevision are authoritative mutation guards; a changed claim must
    // increment one of them before a stale plan can be applied.  Keeping the
    // stored evidence hash stable also makes an immediate inspect→apply
    // round-trip deterministic when filesystem evidence is naturally volatile.
    if (ledger.ledgerRevision !== plan.ledgerRevision || decision.ledgerRevision !== plan.ledgerRevision || decision.ownerGeneration !== plan.ownerGeneration || decision.claimRevision !== plan.claimRevision || decision.evidenceHash !== plan.evidenceHash) throw coordinationError("TASK_DECISION_STALE", "Task decision evidence changed; inspect the request again before applying it.", { decisionRequestId: plan.decisionRequestId, expected: { ledgerRevision: plan.ledgerRevision, ownerGeneration: plan.ownerGeneration, claimRevision: plan.claimRevision, evidenceHash: plan.evidenceHash }, actual: { ledgerRevision: ledger.ledgerRevision, decisionLedgerRevision: decision.ledgerRevision, ownerGeneration: decision.ownerGeneration, claimRevision: decision.claimRevision, evidenceHash: decision.evidenceHash } });
    if (plan.action === "ABANDON_TASK_AND_RELEASE" && owner?.runtimeEvidence?.process?.alive === true) throw coordinationError("TASK_ABANDON_PROCESS_ALIVE", "The recorded Agent/tool process is still alive; stop it before abandoning this generation.", { decisionRequestId: plan.decisionRequestId, taskId: owner.taskId, remediation: "Stop the old Agent/tool process, then run task decision show and retry abandon." });
    if (plan.action === "RELEASE_CLAIM") {
      if (owner?.status !== UNKNOWN || claim?.type !== "DIRTY_CLAIM") throw coordinationError("TASK_DECISION_ACTION_NOT_ALLOWED", "release is only valid for an UNKNOWN DIRTY_CLAIM.", { decisionRequestId: plan.decisionRequestId });
      claim.enforcement = false; claim.releasedAt = nowIso(options.clock); claim.releaseReason = "USER_RELEASED";
    } else if (plan.action === "ABANDON_TASK_AND_RELEASE") {
      if (owner?.status !== UNKNOWN) throw coordinationError("TASK_DECISION_ACTION_NOT_ALLOWED", "abandon is only valid for UNKNOWN owner.", { decisionRequestId: plan.decisionRequestId });
      owner.status = ENDED; owner.revoked = true; owner.endedAt = nowIso(options.clock); owner.endReason = "USER_ABANDONED"; owner.phase = "ENDED";
      ledger.revokedGenerations[owner.taskId] = true;
      for (const entry of Object.values(ledger.claims)) if (entry.taskId === owner.taskId && entry.enforcement) { entry.enforcement = false; entry.releasedAt = owner.endedAt; entry.releaseReason = "USER_ABANDONED"; }
      for (const entry of Object.values(ledger.participations)) if (entry.taskId === owner.taskId && entry.status !== ENDED) { entry.status = ENDED; entry.endedAt = owner.endedAt; entry.endReason = "USER_ABANDONED"; }
    } else if (plan.action === "APPROVE_PROJECT_PARALLEL") {
      const requester = decision.requesterTaskId ? ledger.tasks[decision.requesterTaskId] : null;
      if (!requester || !owner || requester.status !== ACTIVE || owner.status !== ACTIVE) throw coordinationError("TASK_DECISION_ACTION_NOT_ALLOWED", "Project approval requires both task generations to remain ACTIVE.", { decisionRequestId: plan.decisionRequestId });
      ledger.approvals[approvalKey(decision.projectRealPath, requester, owner)] = { projectRealPath: decision.projectRealPath, requesterTaskId: requester.taskId, requesterGeneration: requester.generation, ownerTaskId: owner.taskId, ownerGeneration: owner.generation, approvedAt: nowIso(options.clock) };
    } else if (plan.action === "KEEP" || plan.action === "KEEP_AND_BLOCK" || plan.action === "INSPECT") {
      // KEEP/INSPECT are auditable no-op decisions. KEEP_AND_BLOCK is used for project guards.
    } else {
      throw coordinationError("TASK_DECISION_ACTION_NOT_ALLOWED", `Action ${plan.action} is not applicable to this decision.`, { decisionRequestId: plan.decisionRequestId });
    }
    decision.status = "RESOLVED";
    decision.resolution = plan.action;
    decision.resolvedAt = nowIso(options.clock);
    ledger.ledgerRevision += 1;
    appendAudit(ledger, { action: "DECISION_APPLIED", decisionRequestId: plan.decisionRequestId, resolution: plan.action });
    injectFailure(options, "decision-before-commit", { decisionRequestId: plan.decisionRequestId, action: plan.action, ledgerRevision: ledger.ledgerRevision });
    writeLedger(paths, ledger);
    return { applied: true, decision: { ...decision }, ledgerRevision: ledger.ledgerRevision, retryRequired: plan.action === "APPROVE_PROJECT_PARALLEL" || plan.action === "ABANDON_TASK_AND_RELEASE" };
  }, options);
}

function inspectTask(taskId, options = {}) {
  const result = inspectTasks(options);
  const task = result.tasks.find((entry) => entry.taskId === taskId);
  if (!task) throw coordinationError("TASK_NOT_FOUND", `Unknown task: ${taskId}`, { taskId });
  return { ...task, claims: inspectLocks(options).claims.filter((claim) => claim.taskId === taskId), decisions: result.decisions.filter((decision) => decision.ownerTaskId === taskId || decision.requesterTaskId === taskId) };
}

module.exports = {
  ACTIVE,
  UNKNOWN,
  ENDED,
  TASK_STATUSES,
  CLAIM_TYPES,
  SCOPE_TYPES,
  DECISIONS,
  DECISION_ACTIONS,
  SCHEMA_VERSION,
  DEFAULT_ACTIVITY_THRESHOLD_MS,
  coordinationError,
  emptyLedger,
  normalizeTask,
  normalizeClaim,
  normalizeScope,
  normalizeLedger,
  taskGenerationKey,
  taskIdFor,
  canonicalWorkspacePath,
  resolveStateDirectory,
  readLedger,
  writeLedger,
  acquireLedgerMutex,
  withLedgerMutex,
  mutateLedger,
  canonicalProjectTarget,
  normalizeScopes,
  scopeOverlaps,
  fingerprint,
  parsePorcelainV2,
  gitPathStatus,
  pathEvidence,
  eventIdentity,
  eventKey,
  reconcileLedger,
  applyTaskEvent,
  beforeWrite,
  afterWrite,
  reconcileClaims,
  inspectTasks,
  inspectTask,
  inspectLocks,
  inspectDecision,
  planDecision,
  applyDecision,
};
