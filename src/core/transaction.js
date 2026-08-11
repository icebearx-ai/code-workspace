const fs = require("node:fs");
const path = require("node:path");

const { atomicWrite } = require("./fs");

const RETAINED_EFFECT_STATUSES = new Set(["applied", "possibly-applied"]);

function normalizeRetainedEffect(effect) {
  if (!effect || typeof effect !== "object" || !effect.kind) {
    throw new Error("Retained effects require a kind");
  }
  const status = effect.status || (effect.verified === true ? "applied" : "possibly-applied");
  if (!RETAINED_EFFECT_STATUSES.has(status)) {
    throw new Error(`Invalid retained effect status: ${status}`);
  }
  return { ...effect, status };
}

function attachRetainedEffects(error, effects) {
  const target = error instanceof Error ? error : new Error(String(error));
  const additions = (effects || []).filter(Boolean).map(normalizeRetainedEffect);
  if (additions.length === 0) return target;
  const previousEffects = target.details?.effects || {};
  target.details = {
    ...(target.details || {}),
    effects: {
      ...previousEffects,
      retained: [
        ...(previousEffects.retained || []).map(normalizeRetainedEffect),
        ...additions,
      ],
    },
  };
  return target;
}

function uniqueFiles(files) {
  return [...new Set(files.map((file) => path.resolve(file)))];
}

function missingParents(file) {
  const missing = [];
  let directory = path.dirname(file);
  while (!fs.existsSync(directory)) {
    missing.push(directory);
    const parent = path.dirname(directory);
    if (parent === directory) break;
    directory = parent;
  }
  return missing;
}

function createFileTransaction(files) {
  const snapshots = uniqueFiles(files).map((file) => ({
    file,
    existed: fs.existsSync(file),
    content: fs.existsSync(file) ? fs.readFileSync(file) : null,
    missingParents: missingParents(file),
  }));
  const externalEffects = [];
  let finished = false;

  return {
    recordExternalEffect(effect) {
      if (effect?.verified !== true) {
        throw new Error(`Cannot record an unverified external effect: ${effect?.kind || "unknown"}`);
      }
      externalEffects.push(normalizeRetainedEffect({ ...effect, status: "applied" }));
    },
    commit() {
      finished = true;
    },
    rollback(error) {
      if (finished) return;
      const rollbackErrors = [];
      const restored = [];
      const removed = [];
      for (const snapshot of snapshots.slice().reverse()) {
        try {
          if (snapshot.existed) {
            atomicWrite(snapshot.file, snapshot.content);
            restored.push(snapshot.file);
          } else if (fs.existsSync(snapshot.file)) {
            fs.unlinkSync(snapshot.file);
            removed.push(snapshot.file);
          }
        } catch (rollbackError) {
          rollbackErrors.push(`${snapshot.file}: ${rollbackError.message}`);
        }
      }
      const directories = snapshots.flatMap((snapshot) => snapshot.missingParents).sort((left, right) => right.length - left.length);
      for (const directory of [...new Set(directories)]) {
        try {
          if (fs.existsSync(directory) && fs.readdirSync(directory).length === 0) fs.rmdirSync(directory);
        } catch (rollbackError) {
          rollbackErrors.push(`${directory}: ${rollbackError.message}`);
        }
      }
      finished = true;
      if (error) {
        const previousEffects = error.details?.effects || {};
        const retained = [
          ...(previousEffects.retained || []).map(normalizeRetainedEffect),
          ...externalEffects.map((effect) => ({ ...effect, retained: true })),
        ];
        error.details = {
          ...(error.details || {}),
          workspaceRolledBack: rollbackErrors.length === 0,
          ...(externalEffects.length > 0 ? { externalEffects } : {}),
          ...(rollbackErrors.length > 0 ? { rollbackErrors } : {}),
          effects: {
            restored: [...new Set([...(previousEffects.restored || []), ...restored])],
            removed: [...new Set([...(previousEffects.removed || []), ...removed])],
            retained,
            rollbackFailures: [...(previousEffects.rollbackFailures || []), ...rollbackErrors],
          },
        };
      }
    },
    get externalEffects() {
      return externalEffects.map((effect) => ({ ...effect }));
    },
  };
}

module.exports = {
  attachRetainedEffects,
  createFileTransaction,
  missingParents,
  normalizeRetainedEffect,
  uniqueFiles,
};
