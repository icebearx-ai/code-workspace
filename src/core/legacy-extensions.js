"use strict";

const fs = require("node:fs");
const path = require("node:path");

const { LOCAL_DIRECTORY, loadState, saveState } = require("./config");
const { WorkspaceError } = require("./errors");
const { sha256 } = require("./fs");
const { createFileTransaction } = require("./transaction");

const LEGACY_EXTENSION_STATE_FILE = "ext-manifest.json";
const CODEX_HOOKS_TARGET = ".codex/hooks.json";
const SYSTEM_EXTENSION_ID = "codew-workspace-guard";
const REMOVED_EXTENSION_COMMAND_REMEDIATION = "Extensions were removed in Code Workspace 2.0; retain needed ordinary-extension files manually or remove them after review.";

function readJsonFile(file, code) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (error) {
    throw new WorkspaceError(code, `Cannot read legacy extension state: ${file}: ${error.message}`, {
      file,
      causeCode: error.code || error.name,
      remediation: "Repair the file manually or remove it after backing it up, then retry update.",
    });
  }
}

function legacyExtensionStatePath(root) {
  return path.join(path.resolve(root), LOCAL_DIRECTORY, LEGACY_EXTENSION_STATE_FILE);
}

function inspectLegacyExtensions(root) {
  const stateFile = legacyExtensionStatePath(root);
  if (!fs.existsSync(stateFile)) return { present: false, stateFile, state: null, extensions: [], system: null, hooksFile: path.join(path.resolve(root), CODEX_HOOKS_TARGET) };
  const state = readJsonFile(stateFile, "LEGACY_EXTENSION_STATE_INVALID");
  if (state?.schemaVersion !== 1 || state.experimental !== true || !state.extensions || typeof state.extensions !== "object" || Array.isArray(state.extensions)) {
    throw new WorkspaceError("LEGACY_EXTENSION_STATE_INVALID", `Invalid legacy extension state: ${stateFile}`, {
      file: stateFile,
      remediation: "Repair the legacy extension state manually, or remove it only after backing up ordinary-extension files.",
    });
  }
  const extensions = Object.entries(state.extensions).map(([id, value]) => ({
    id,
    system: value?.installed?.system === true,
    version: value?.installed?.version || null,
    artifacts: (value?.installed?.artifacts || []).map((artifact) => ({
      id: artifact.id,
      kind: artifact.kind || "file",
      ownership: artifact.ownership || null,
      target: artifact.target,
      installedSha256: artifact.installedSha256,
      selector: artifact.selector || null,
    })),
  }));
  return {
    present: true,
    stateFile,
    state,
    extensions,
    system: extensions.find((entry) => entry.id === SYSTEM_EXTENSION_ID) || null,
    hooksFile: path.join(path.resolve(root), CODEX_HOOKS_TARGET),
  };
}

function artifactTargetPath(root, target) {
  return path.join(path.resolve(root), ...(String(target || "")).split("/"));
}

function isUnmodifiedFileArtifact(root, artifact) {
  if (artifact.kind !== "file") return false;
  const file = artifactTargetPath(root, artifact.target);
  return fs.existsSync(file) && sha256(fs.readFileSync(file)) === artifact.installedSha256;
}

function legacyFileArtifacts(root, inspection) {
  return inspection.extensions.flatMap((extension) => extension.artifacts
    .filter((artifact) => artifact.kind === "file")
    .map((artifact) => ({ ...artifact, extensionId: extension.id, system: extension.system })));
}

function planLegacyExtensionCleanup(root) {
  const inspection = inspectLegacyExtensions(root);
  const plans = [];
  if (!inspection.present) return Object.freeze({ ...inspection, action: "skip", reason: "not-present", files: [], diagnostics: [] });

  const workspaceState = loadState(root);
  for (const artifact of legacyFileArtifacts(root, inspection)) {
    const currentManaged = workspaceState.managedFiles?.[artifact.target];
    const file = artifactTargetPath(root, artifact.target);
    if (currentManaged || artifact.system) continue;
    if (!fs.existsSync(file)) continue;
    if (!isUnmodifiedFileArtifact(root, artifact)) {
      plans.push({ target: artifact.target, file, action: "preserve", reason: "modified", extensionId: artifact.extensionId });
      continue;
    }
    plans.push({ target: artifact.target, file, action: "remove", reason: "legacy-owned", extensionId: artifact.extensionId, previous: fs.readFileSync(file) });
  }

  if (fs.existsSync(inspection.stateFile)) {
    plans.push({ target: `${LOCAL_DIRECTORY}/${LEGACY_EXTENSION_STATE_FILE}`, file: inspection.stateFile, action: "remove", reason: "legacy-state", previous: fs.readFileSync(inspection.stateFile) });
  }
  if (fs.existsSync(inspection.hooksFile)) {
    plans.push({ target: CODEX_HOOKS_TARGET, file: inspection.hooksFile, action: "remove", reason: "legacy-hooks", previous: fs.readFileSync(inspection.hooksFile) });
  }

  const diagnostics = plans.filter((plan) => plan.action === "preserve").map((plan) => ({
    code: "LEGACY_EXTENSION_FILE_MODIFIED",
    severity: "warning",
    message: `Legacy extension file contains local changes and was preserved: ${plan.target}`,
    target: plan.target,
    extension: plan.extensionId,
    remediation: "Review the file and remove it manually if it is no longer needed.",
  }));
  return Object.freeze({ ...inspection, action: plans.some((plan) => plan.action === "remove") ? "remove" : "skip", reason: plans.length > 0 ? "legacy-extension-state" : "empty", files: Object.freeze(plans), diagnostics: Object.freeze(diagnostics) });
}

function removeEmptyParents(root, file) {
  const stop = path.resolve(root);
  let directory = path.dirname(path.resolve(file));
  while (directory !== stop && directory.startsWith(`${stop}${path.sep}`)) {
    if (!fs.existsSync(directory) || fs.readdirSync(directory).length > 0) break;
    fs.rmdirSync(directory);
    directory = path.dirname(directory);
  }
}

function verifyLegacyCleanup(plan) {
  for (const entry of plan.files) {
    if (entry.action === "remove" && fs.existsSync(entry.file)) {
      throw new WorkspaceError("LEGACY_EXTENSION_CLEANUP_VERIFY_FAILED", `Legacy extension target was not removed: ${entry.target}`, {
        target: entry.target,
        remediation: "Retry update after reviewing the target.",
      });
    }
    if (entry.action === "preserve" && !fs.existsSync(entry.file)) {
      throw new WorkspaceError("LEGACY_EXTENSION_CLEANUP_VERIFY_FAILED", `Modified legacy extension target disappeared: ${entry.target}`, {
        target: entry.target,
        remediation: "Restore the file from backup before retrying update.",
      });
    }
  }
}

function applyLegacyExtensionCleanup(root, options = {}) {
  const frozen = planLegacyExtensionCleanup(root);
  if (!options.confirmed && frozen.files.some((plan) => plan.action === "remove")) {
    throw new WorkspaceError("LEGACY_EXTENSION_CLEANUP_CONFIRMATION_REQUIRED", "Legacy extension cleanup requires confirmation.", {
      targets: frozen.files.filter((plan) => plan.action === "remove").map((plan) => plan.target),
      remediation: "Review the update plan and retry with --yes, or remove legacy files manually.",
    });
  }
  if (frozen.files.length === 0) return { action: "skip", reason: frozen.reason, files: [], diagnostics: frozen.diagnostics };

  const current = planLegacyExtensionCleanup(root);
  if (JSON.stringify({ ...frozen, files: frozen.files.map(({ previous, ...entry }) => entry) }) !== JSON.stringify({ ...current, files: current.files.map(({ previous, ...entry }) => entry) })) {
    throw new WorkspaceError("LEGACY_EXTENSION_STATE_CONFLICT", "Legacy extension state changed before cleanup.", {
      remediation: "Re-run update and review the current plan.",
    });
  }

  const transaction = createFileTransaction(frozen.files.map((plan) => plan.file));
  const changed = [];
  try {
    for (const plan of frozen.files) {
      if (plan.action !== "remove") continue;
      fs.unlinkSync(plan.file);
      removeEmptyParents(root, plan.file);
      changed.push(plan);
    }
    verifyLegacyCleanup(frozen);
    transaction.commit();
    return { action: "cleanup", reason: frozen.reason, files: frozen.files.map(({ previous, ...plan }) => ({ ...plan })), diagnostics: frozen.diagnostics };
  } catch (error) {
    transaction.rollback(error);
    throw error;
  }
}

function legacyExtensionDiagnostics(root) {
  try {
    const plan = planLegacyExtensionCleanup(root);
    return plan.present && plan.files.length > 0
      ? [{
        code: "LEGACY_EXTENSION_STATE_PRESENT",
        severity: "warning",
        message: "Legacy extension state is present; update can review and remove safely identified files.",
        targets: plan.files.map((entry) => entry.target),
        remediation: REMOVED_EXTENSION_COMMAND_REMEDIATION,
      }]
      : [];
  } catch (error) {
    return [{
      code: error.code || "LEGACY_EXTENSION_STATE_INVALID",
      severity: "warning",
      message: error.message,
      remediation: error.details?.remediation || REMOVED_EXTENSION_COMMAND_REMEDIATION,
    }];
  }
}

module.exports = {
  CODEX_HOOKS_TARGET,
  LEGACY_EXTENSION_STATE_FILE,
  SYSTEM_EXTENSION_ID,
  applyLegacyExtensionCleanup,
  inspectLegacyExtensions,
  legacyExtensionDiagnostics,
  planLegacyExtensionCleanup,
};
