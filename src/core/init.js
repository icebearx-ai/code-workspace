const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const packageJson = require("../../package.json");
const { WorkspaceError } = require("./errors");
const { sha256 } = require("./fs");
const { loadState, saveState } = require("./config");
const { MANIFEST_FILE, loadManagedManifest } = require("./managed-files");
const { attachRetainedEffects } = require("./transaction");

const PACKAGE_ROOT = path.resolve(__dirname, "..", "..");

function parseVersion(value) {
  const match = String(value || "").trim().match(/^v?(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/);
  if (!match) throw new Error(`Invalid semantic version: ${value}`);
  return match.slice(1).map(Number);
}

function compareVersions(left, right) {
  const a = parseVersion(left);
  const b = parseVersion(right);
  for (let index = 0; index < 3; index += 1) {
    if (a[index] < b[index]) return -1;
    if (a[index] > b[index]) return 1;
  }
  return 0;
}

function minimumFromRange(range) {
  const match = String(range || "").trim().match(/^>=\s*(v?\d+\.\d+\.\d+)$/);
  if (!match) throw new Error(`Unsupported version range: ${range}`);
  return match[1];
}

function runCommand(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    env: options.env || process.env,
    encoding: "utf8",
    stdio: options.capture ? ["ignore", "pipe", "pipe"] : "inherit",
    timeout: options.timeout,
  });
  if (result.error && !options.allowFailure) throw result.error;
  if (result.status !== 0 && !options.allowFailure) {
    const detail = String(result.stderr || result.stdout || "").trim().split(/\r?\n/)[0];
    throw new Error(`Command failed (${result.status ?? "spawn"}): ${command} ${args.join(" ")}${detail ? ` — ${detail}` : ""}`);
  }
  return result;
}

function loadInitManifest(file = MANIFEST_FILE) {
  const manifest = loadManagedManifest(file);
  minimumFromRange(manifest.requirements?.node);
  return manifest;
}

function installWorkspaceDependencies(root, options = {}) {
  const packageFile = path.join(root, "package.json");
  if (!fs.existsSync(packageFile)) return { action: "skip", reason: "target has no package.json" };
  let targetPackage;
  try {
    targetPackage = JSON.parse(fs.readFileSync(packageFile, "utf8"));
  } catch (error) {
    throw new Error(`Failed to parse target package.json: ${error.message}`);
  }
  if (targetPackage.name !== packageJson.name) {
    return { action: "skip", reason: `target package is ${targetPackage.name || "unnamed"}` };
  }
  const scope = ["node_modules", "package-lock.json"];
  const before = Object.fromEntries(scope.map((target) => [target, fs.existsSync(path.join(root, target))]));
  const retainedEffect = (missing = []) => {
    const after = Object.fromEntries(scope.map((target) => [target, fs.existsSync(path.join(root, target))]));
    const created = scope.filter((target) => !before[target] && after[target]);
    return {
      kind: "retained-local-effect",
      status: created.length > 0 ? "applied" : "possibly-applied",
      name: "workspace dependencies",
      command: "npm install",
      targets: scope,
      scope: { enumeration: "dependency-roots-only", complete: false },
      evidence: { before, after, ...(missing.length > 0 ? { missingPackages: missing } : {}) },
      remediation: "Run npm install again and verify the declared dependencies before continuing.",
    };
  };
  let installCompleted = false;
  try {
    (options.run || runCommand)("npm", ["install"], { cwd: root });
    installCompleted = true;
  } catch (cause) {
    const error = cause.code ? cause : new WorkspaceError("WORKSPACE_DEPENDENCY_INSTALL_FAILED", cause.message, { cause: cause.name });
    throw attachRetainedEffects(error, [retainedEffect()]);
  }
  const dependencies = {
    ...(targetPackage.dependencies || {}),
    ...(targetPackage.devDependencies || {}),
  };
  const missing = Object.keys(dependencies).filter((name) => !fs.existsSync(path.join(root, "node_modules", name, "package.json")));
  if (missing.length > 0) {
    const error = new WorkspaceError(
      "WORKSPACE_DEPENDENCY_VERIFICATION_FAILED",
      `Workspace dependency verification failed; missing installed packages: ${missing.join(", ")}`,
      { missing }
    );
    throw attachRetainedEffects(error, [retainedEffect(missing)]);
  }
  return {
    action: "install",
    verified: installCompleted,
    retainedPaths: ["node_modules", ...(fs.existsSync(path.join(root, "package-lock.json")) ? ["package-lock.json"] : [])],
  };
}

function commitInitializationState(root, manifest, options = {}) {
  const current = loadState(root) || {};
  const state = {
    ...current,
    schemaVersion: 2,
    status: "healthy",
    appliedReleaseVersion: manifest.releaseVersion,
    appliedManifestSha256: sha256(fs.readFileSync(options.manifestFile || MANIFEST_FILE)),
    tools: options.tools || manifest.tools,
  };
  delete state.resources;
  delete state.workspaceLanguage;
  saveState(root, state);
  return state;
}

function commitUpdateState(root, manifest, options = {}) {
  const current = loadState(root);
  if (!current) {
    throw new WorkspaceError(
      "UPDATE_STATE_MISSING",
      "Local initialization state is missing; update can only commit an existing workspace state.",
      { remediation: "Re-run openspec-w init . --yes before updating this workspace." }
    );
  }
  const state = {
    ...current,
    appliedReleaseVersion: manifest.releaseVersion,
    appliedManifestSha256: sha256(fs.readFileSync(options.manifestFile || MANIFEST_FILE)),
    ...(options.tools !== undefined ? { tools: options.tools } : {}),
  };
  delete state.resources;
  if (options.removeLegacyWorkspaceLanguage === true) delete state.workspaceLanguage;
  saveState(root, state);
  return state;
}

module.exports = {
  MANIFEST_FILE,
  PACKAGE_ROOT,
  compareVersions,
  commitInitializationState,
  commitUpdateState,
  installWorkspaceDependencies,
  loadInitManifest,
  minimumFromRange,
  parseVersion,
  runCommand,
};
