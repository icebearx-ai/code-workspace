const fs = require("node:fs");
const path = require("node:path");
const readline = require("node:readline/promises");
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
  const openspec = manifest.resources?.openspec;
  if (!openspec || !Array.isArray(openspec.supportedVersions) || openspec.supportedVersions.length === 0) {
    throw new Error("Init manifest must declare supported OpenSpec versions");
  }
  if (!openspec.supportedVersions.includes(openspec.selectedVersion)) {
    throw new Error("Selected OpenSpec version is not supported");
  }
  for (const version of openspec.supportedVersions) parseVersion(version);
  return manifest;
}

function installedGlobalVersion(result, packageName) {
  try {
    const parsed = JSON.parse(result.stdout || "{}");
    return parsed.dependencies?.[packageName]?.version || null;
  } catch {
    return null;
  }
}

function detectOpenSpec(openspec, options = {}) {
  const run = options.run || runCommand;
  const globalResult = run("npm", ["list", "-g", openspec.package, "--depth=0", "--json"], {
    cwd: options.root,
    capture: true,
    allowFailure: true,
  });
  const commandResult = run("openspec", ["--version"], {
    cwd: options.root,
    capture: true,
    allowFailure: true,
  });
  return {
    globalVersion: installedGlobalVersion(globalResult, openspec.package),
    commandVersion: commandResult.status === 0 ? String(commandResult.stdout || "").trim() : null,
  };
}

function isSupportedInstallation(detected, supportedVersions) {
  return Boolean(
    detected.globalVersion &&
    detected.commandVersion &&
    detected.globalVersion === detected.commandVersion &&
    supportedVersions.includes(detected.globalVersion)
  );
}

function detectOpenSpecEvidence(openspec, options) {
  try {
    return { observed: detectOpenSpec(openspec, options) };
  } catch (error) {
    return { observed: null, detectionError: error.message };
  }
}

async function askForVersion(versions, input = process.stdin, output = process.stdout) {
  output.write("可安装的 OpenSpec 版本：\n");
  versions.forEach((version, index) => output.write(`  ${index + 1}. ${version}\n`));
  const prompt = readline.createInterface({ input, output });
  try {
    const answer = await prompt.question(`选择版本 [1-${versions.length}]，输入 q 取消：`);
    if (answer.trim().toLowerCase() === "q") throw new Error("OpenSpec installation cancelled by user");
    const selected = Number(answer.trim() || "1") - 1;
    if (!Number.isInteger(selected) || !versions[selected]) throw new Error(`Invalid OpenSpec version selection: ${answer}`);
    return versions[selected];
  } finally {
    prompt.close();
  }
}

async function ensureOpenSpec(openspec, options = {}) {
  const run = options.run || runCommand;
  const detected = detectOpenSpec(openspec, { root: options.root, run });
  if (options.openspecVersion && !openspec.supportedVersions.includes(options.openspecVersion)) {
    throw new Error(`Unsupported OpenSpec version ${options.openspecVersion}; choose ${openspec.supportedVersions.join(", ")}`);
  }
  const interactive = options.interactive ?? (process.stdin.isTTY && process.stdout.isTTY);
  let selected = options.openspecVersion;
  if (!selected && interactive) selected = await askForVersion(openspec.supportedVersions, options.input, options.output);
  if (isSupportedInstallation(detected, openspec.supportedVersions) && (!selected || selected === detected.globalVersion)) {
    return { action: "skip", version: detected.globalVersion, detected };
  }
  if (!selected) {
    throw new Error(`OpenSpec must be installed or changed. Re-run with --openspec-version ${openspec.selectedVersion} --yes`);
  }
  if (!interactive && !options.yes) {
    throw new Error(`OpenSpec installation requires confirmation. Re-run with --openspec-version ${selected} --yes`);
  }
  let installCompleted = false;
  let evidenceAfter = null;
  try {
    run("npm", ["install", "-g", `${openspec.package}@${selected}`], { cwd: options.root });
    installCompleted = true;
    const verified = detectOpenSpec(openspec, { root: options.root, run });
    evidenceAfter = { observed: verified };
    if (verified.globalVersion !== selected || verified.commandVersion !== selected) {
      throw new WorkspaceError(
        "OPENSPEC_INSTALL_VERIFICATION_FAILED",
        `OpenSpec verification failed after install: global=${verified.globalVersion || "missing"}, command=${verified.commandVersion || "missing"}`,
        { requestedVersion: selected, observed: verified }
      );
    }
    return { action: "install", version: selected, detected: verified };
  } catch (cause) {
    evidenceAfter ||= detectOpenSpecEvidence(openspec, { root: options.root, run });
    const error = cause.code ? cause : new WorkspaceError(
      installCompleted ? "OPENSPEC_INSTALL_VERIFICATION_FAILED" : "OPENSPEC_INSTALL_FAILED",
      cause.message,
      { cause: cause.name }
    );
    const observed = evidenceAfter.observed;
    const changed = Boolean(observed && (
      observed.globalVersion !== detected.globalVersion || observed.commandVersion !== detected.commandVersion
    ));
    throw attachRetainedEffects(error, [{
      kind: "global-package",
      status: changed ? "applied" : "possibly-applied",
      name: "OpenSpec",
      package: openspec.package,
      requestedVersion: selected,
      evidence: { before: detected, after: evidenceAfter },
      remediation: `Verify with openspec --version and npm list -g ${openspec.package} --depth=0.`,
    }]);
  }
}

function expectedOpenSpecToolFiles(root, tools) {
  const files = [];
  const skills = [
    "openspec-apply-change",
    "openspec-archive-change",
    "openspec-explore",
    "openspec-propose",
    "openspec-sync-specs",
  ];
  if (tools.includes("claude")) {
    for (const command of ["apply", "archive", "explore", "propose", "sync"]) {
      files.push(path.join(root, ".claude", "commands", "opsx", `${command}.md`));
    }
    for (const skill of skills) files.push(path.join(root, ".claude", "skills", skill, "SKILL.md"));
  }
  if (tools.includes("codex")) {
    for (const skill of skills) files.push(path.join(root, ".codex", "skills", skill, "SKILL.md"));
  }
  return files;
}

function prepareOpenSpec(root, openspec, tools, options = {}) {
  const run = options.run || runCommand;
  // Tool integrations are managed in the following stage. Their absence must
  // not make an existing OpenSpec project re-enter upstream initialization.
  // A genuinely fresh target still needs upstream's complete native baseline.
  const required = [
    path.join(root, "openspec", "config.yaml"),
    path.join(root, "openspec", "specs"),
    path.join(root, "openspec", "changes"),
    path.join(root, "openspec", "changes", "archive"),
  ];
  const missing = required.filter((file) => !fs.existsSync(file));
  if (missing.length === 0) return { action: "skip", missing: [] };
  const retainedEffect = () => {
    const targets = missing.filter((file) => fs.existsSync(file)).map((file) => path.relative(root, file));
    return {
      kind: "upstream-command-output",
      status: targets.length > 0 ? "applied" : "possibly-applied",
      command: "openspec init",
      targets,
      scope: { root: "openspec", enumeration: "required-targets-only", complete: false },
      remediation: "Inspect the openspec directory before retrying initialization.",
    };
  };
  try {
    run("openspec", [
      "init",
      ".",
      "--tools",
      tools.length > 0 ? tools.join(",") : "none",
      "--profile",
      openspec.profile,
    ], { cwd: root });
  } catch (cause) {
    const error = cause.code ? cause : new WorkspaceError("OPENSPEC_INIT_FAILED", cause.message, { cause: cause.name });
    throw attachRetainedEffects(error, [retainedEffect()]);
  }
  const remaining = required.filter((file) => !fs.existsSync(file));
  if (remaining.length > 0) {
    const relative = remaining.map((file) => path.relative(root, file));
    const error = new WorkspaceError(
      "OPENSPEC_INIT_POSTCONDITION_FAILED",
      `OpenSpec init did not produce required files: ${relative.join(", ")}`,
      { missing: relative }
    );
    throw attachRetainedEffects(error, [retainedEffect()]);
  }
  return { action: "init", missing, verified: true };
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
    resources: {
      openspec: {
        version: options.openspecVersion || manifest.resources.openspec.selectedVersion,
        tools: options.tools || manifest.resources.openspec.tools,
        profile: options.profile || manifest.resources.openspec.profile,
        status: "healthy",
      },
    },
  };
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
    resources: {
      ...(current.resources || {}),
      openspec: {
        ...(current.resources?.openspec || {}),
        ...(options.tools !== undefined ? { tools: options.tools } : {}),
      },
    },
  };
  if (options.removeLegacyWorkspaceLanguage === true) delete state.workspaceLanguage;
  saveState(root, state);
  return state;
}

module.exports = {
  MANIFEST_FILE,
  PACKAGE_ROOT,
  askForVersion,
  compareVersions,
  commitInitializationState,
  commitUpdateState,
  detectOpenSpec,
  ensureOpenSpec,
  expectedOpenSpecToolFiles,
  installWorkspaceDependencies,
  isSupportedInstallation,
  loadInitManifest,
  minimumFromRange,
  parseVersion,
  prepareOpenSpec,
  runCommand,
};
