const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { Worker } = require("node:worker_threads");

const { WorkspaceError } = require("./errors");

const PACKAGE_ROOT = path.resolve(__dirname, "..", "..");
const LOCK_DIRECTORY = path.join(os.tmpdir(), "code-workspace-init-locks");
const UPDATE_ENV = "CODE_WORKSPACE_INIT_LOCK_UPDATE_MS";
const STALE_ENV = "CODE_WORKSPACE_INIT_LOCK_STALE_MS";
const DEFAULT_UPDATE_MS = 5000;
const DEFAULT_STALE_MS = 30000;

let projectEnvLoaded = false;

function loadProjectEnv() {
  if (projectEnvLoaded) return;
  projectEnvLoaded = true;
  if (typeof process.loadEnvFile !== "function") return;
  const envFile = path.join(PACKAGE_ROOT, ".env");
  try {
    process.loadEnvFile(envFile);
  } catch (error) {
    if (error.code !== "ENOENT") {
      throw new WorkspaceError("INIT_LOCK_CONFIG_INVALID", `Cannot load Code Workspace .env: ${error.message}`, { file: envFile });
    }
  }
}

function parseMilliseconds(value, fallback, name) {
  if (value === undefined || value === "") return fallback;
  const text = String(value).trim();
  if (!/^\d+$/.test(text)) {
    throw new WorkspaceError("INIT_LOCK_CONFIG_INVALID", `${name} must be a positive integer in milliseconds`, { variable: name, value });
  }
  const parsed = Number(text);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new WorkspaceError("INIT_LOCK_CONFIG_INVALID", `${name} must be a positive integer in milliseconds`, { variable: name, value });
  }
  return parsed;
}

function readInitLockConfig(options = {}) {
  if (!options.env) loadProjectEnv();
  const env = options.env || process.env;
  const update = parseMilliseconds(env[UPDATE_ENV], DEFAULT_UPDATE_MS, UPDATE_ENV);
  const stale = parseMilliseconds(env[STALE_ENV], DEFAULT_STALE_MS, STALE_ENV);
  if (stale <= update * 2) {
    throw new WorkspaceError("INIT_LOCK_CONFIG_INVALID", `${STALE_ENV} must be greater than twice ${UPDATE_ENV}`, {
      update,
      stale,
      updateVariable: UPDATE_ENV,
      staleVariable: STALE_ENV,
    });
  }
  return Object.freeze({ update, stale });
}

function canonicalWorkspacePath(root) {
  const resolved = path.resolve(root);
  try {
    return fs.realpathSync.native(resolved);
  } catch {
    return resolved;
  }
}

function workspaceLockTarget(root) {
  const key = crypto.createHash("sha256").update(canonicalWorkspacePath(root)).digest("hex");
  fs.mkdirSync(LOCK_DIRECTORY, { recursive: true });
  return path.join(LOCK_DIRECTORY, key);
}

async function acquireInitLock(root, options = {}) {
  const config = options.config || readInitLockConfig(options);
  const target = options.target || workspaceLockTarget(root);
  const worker = new Worker(path.join(__dirname, "init-lock-holder.js"), {
    workerData: { target, update: config.update, stale: config.stale },
  });
  return new Promise((resolve, reject) => {
    let settled = false;
    let releasing = false;
    let releaseResolve;
    let releaseReject;
    const fail = (error) => {
      if (settled) return;
      settled = true;
      reject(error);
    };
    worker.on("message", (message) => {
      if (message.type === "ready") {
        if (settled) return;
        settled = true;
        resolve(() => new Promise((releaseDone, releaseFailed) => {
          if (releasing) {
            releaseFailed(new WorkspaceError("INIT_LOCK_RELEASE_FAILED", "The init lock is already being released."));
            return;
          }
          releasing = true;
          releaseResolve = releaseDone;
          releaseReject = releaseFailed;
          worker.postMessage({ type: "release" });
        }));
      } else if (message.type === "released") {
        releaseResolve?.();
        releaseResolve = null;
        releaseReject = null;
      } else if (message.type === "release-error") {
        releaseReject?.(new WorkspaceError("INIT_LOCK_RELEASE_FAILED", `Could not release the init lock: ${message.message}`, { cause: message.code }));
        releaseResolve = null;
        releaseReject = null;
      } else if (message.type === "error") {
        const error = message.code === "ELOCKED"
          ? new WorkspaceError("INIT_ALREADY_RUNNING", "Another init operation is already running for this Workspace.", {
            workspace: canonicalWorkspacePath(root),
            remediation: "Wait for the existing init operation to finish, then retry.",
          })
          : new WorkspaceError("INIT_LOCK_ACQUIRE_FAILED", `Could not acquire the init lock: ${message.message}`, {
            workspace: canonicalWorkspacePath(root),
            cause: message.code,
          });
        fail(error);
      }
    });
    worker.on("error", (error) => {
      if (releasing) {
        releaseReject?.(new WorkspaceError("INIT_LOCK_RELEASE_FAILED", `Could not release the init lock: ${error.message}`, { cause: error.code || error.name }));
        releaseResolve = null;
        releaseReject = null;
      } else {
        fail(new WorkspaceError("INIT_LOCK_ACQUIRE_FAILED", `Could not acquire the init lock: ${error.message}`, {
          workspace: canonicalWorkspacePath(root),
          cause: error.code || error.name,
        }));
      }
    });
    worker.on("exit", (code) => {
      if (!releasing && !settled) {
        fail(new WorkspaceError("INIT_LOCK_ACQUIRE_FAILED", `The init lock worker exited before acquiring the lock (status ${code}).`, {
          workspace: canonicalWorkspacePath(root),
          exitCode: code,
        }));
      }
    });
  });
}

module.exports = {
  DEFAULT_STALE_MS,
  DEFAULT_UPDATE_MS,
  STALE_ENV,
  UPDATE_ENV,
  acquireInitLock,
  canonicalWorkspacePath,
  readInitLockConfig,
  workspaceLockTarget,
};
