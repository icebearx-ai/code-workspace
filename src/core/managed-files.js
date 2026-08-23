const fs = require("node:fs");
const path = require("node:path");

const packageJson = require("../../package.json");
const { loadState, saveState } = require("./config");
const { WorkspaceError } = require("./errors");
const { atomicWrite, sha256 } = require("./fs");
const { DEFAULT_WORKSPACE_LANGUAGE, workspaceGuide } = require("./language");
const { CODEX_HOOKS_TARGET, composeHookContent } = require("./extension-artifacts");

const PACKAGE_ROOT = path.resolve(__dirname, "..", "..");
const ARTIFACTS_ROOT = path.join(PACKAGE_ROOT, "artifacts");
const MANIFEST_FILE = path.join(ARTIFACTS_ROOT, "manifest.json");

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.keys(value).sort().map((key) => [key, canonicalize(value[key])])
  );
}

function definitionSha256(entry) {
  return sha256(JSON.stringify(canonicalize(entry)));
}

function renderManagedContent(entry, variables = {}) {
  let content = fs.readFileSync(entry.sourceFile, "utf8");
  const values = {
    WORKSPACE_LANGUAGE: DEFAULT_WORKSPACE_LANGUAGE,
    WORKSPACE_USER_GUIDE: workspaceGuide(DEFAULT_WORKSPACE_LANGUAGE),
    ...variables,
    ...(entry.render?.values || {}),
  };
  const required = entry.render?.variables || [];
  for (const name of required) {
    if (!/^[A-Z][A-Z0-9_]*$/.test(name)) throw new Error(`Invalid managed template variable: ${name}`);
    if (values[name] === undefined) throw new Error(`Missing managed template variable ${name} for ${entry.target}`);
    const token = `{{${name}}}`;
    if (!content.includes(token)) throw new Error(`Managed template ${entry.target} does not contain ${token}`);
    content = content.split(token).join(String(values[name]));
  }
  const unresolved = content.match(/{{[A-Z][A-Z0-9_]*}}/);
  if (unresolved) throw new Error(`Unresolved managed template variable ${unresolved[0]} in ${entry.target}`);
  return Buffer.from(content);
}

function extensionHookState(root, provided) {
  if (provided !== undefined) return provided;
  const file = path.join(root, ".code-workspace", "ext-manifest.json");
  if (!fs.existsSync(file)) return { schemaVersion: 1, experimental: true, extensions: {} };
  try {
    const state = JSON.parse(fs.readFileSync(file, "utf8"));
    return state?.schemaVersion === 1 && state.experimental === true && state.extensions && typeof state.extensions === "object" ? state : null;
  } catch {
    return null;
  }
}

function hasExtensionHooks(state) {
  if (!state) return false;
  return Object.values(state.extensions || {}).some((value) => (value.installed?.artifacts || []).some((artifact) => artifact.kind === "codex-hooks"));
}

function desiredManagedContent(root, entry, variables, extensionState, includeCore = true) {
  if (entry.target !== CODEX_HOOKS_TARGET) return renderManagedContent(entry, variables);
  const target = path.join(root, entry.target);
  if (extensionState === null && fs.existsSync(target)) return fs.readFileSync(target);
  const base = includeCore ? renderManagedContent(entry, variables) : Buffer.from('{\n  "hooks": {}\n}\n');
  return composeHookContent(base, extensionState || { extensions: {} });
}

function resolveArtifact(relativePath) {
  const resolved = path.resolve(ARTIFACTS_ROOT, relativePath);
  if (resolved !== ARTIFACTS_ROOT && !resolved.startsWith(`${ARTIFACTS_ROOT}${path.sep}`)) {
    throw new Error(`Artifact escapes artifacts directory: ${relativePath}`);
  }
  return resolved;
}

function verifySource(reference, label) {
  if (!reference?.source || !/^[a-f0-9]{64}$/.test(reference.sha256 || "")) {
    throw new Error(`Invalid ${label} source definition`);
  }
  const file = resolveArtifact(reference.source);
  if (!fs.existsSync(file)) throw new Error(`Missing ${label} source: ${reference.source}`);
  const actual = sha256(fs.readFileSync(file));
  if (actual !== reference.sha256) throw new Error(`${label} source checksum mismatch: ${reference.source}`);
  return file;
}

function loadManagedManifest(file = MANIFEST_FILE) {
  if (!fs.existsSync(file)) throw new Error(`Missing managed files manifest: ${file}`);
  const manifest = JSON.parse(fs.readFileSync(file, "utf8"));
  if (manifest.schemaVersion !== 2) throw new Error(`Unsupported managed files manifest schema: ${manifest.schemaVersion}`);
  if (manifest.releaseVersion !== packageJson.version) {
    throw new Error(`Manifest release ${manifest.releaseVersion} does not match package ${packageJson.version}`);
  }
  if (!Array.isArray(manifest.tools) || manifest.tools.length === 0 || manifest.tools.some((tool) => !["claude", "codex"].includes(tool))) {
    throw new Error("Managed files manifest contains invalid default tools");
  }
  if (!Array.isArray(manifest.managedFiles) || manifest.managedFiles.length === 0) {
    throw new Error("Managed files manifest contains no managed files");
  }

  const sourceIds = new Set();
  for (const source of manifest.sources || []) {
    if (!source.id || sourceIds.has(source.id) || source.kind !== "asset" || !source.path || !/^[a-f0-9]{64}$/.test(source.sha256 || "")) {
      throw new Error(`Invalid or duplicate artifact source: ${source.id || "<missing>"}`);
    }
    sourceIds.add(source.id);
    const sourceFile = resolveArtifact(source.path);
    if (!fs.existsSync(sourceFile)) throw new Error(`Missing artifact source: ${source.path}`);
    if (sha256(fs.readFileSync(sourceFile)) !== source.sha256) {
      throw new Error(`Artifact source checksum mismatch: ${source.path}`);
    }
  }

  const ids = new Set();
  const targets = new Set();
  for (const entry of manifest.managedFiles || []) {
    if (!entry.id || ids.has(entry.id)) throw new Error(`Duplicate or missing managed file id: ${entry.id || "<missing>"}`);
    const normalizedTarget = entry.target && path.posix.normalize(entry.target);
    if (
      !entry.target ||
      normalizedTarget !== entry.target ||
      normalizedTarget === ".." ||
      normalizedTarget.startsWith("../") ||
      normalizedTarget.startsWith("/") ||
      normalizedTarget.includes("\\") ||
      targets.has(normalizedTarget)
    ) {
      throw new Error(`Duplicate or invalid managed target: ${entry.target || "<missing>"}`);
    }
    ids.add(entry.id);
    targets.add(normalizedTarget);
    Object.defineProperty(entry, "sourceFile", {
      value: verifySource(entry.desired, `managed file ${entry.id}`),
      enumerable: false,
    });
    for (const accepted of entry.replaceable || []) {
      if (!/^[a-f0-9]{64}$/.test(accepted.sha256 || "")) {
        throw new Error(`Invalid replaceable fingerprint for managed file ${entry.id}`);
      }
    }
    if (entry.provenance?.sourceId && !sourceIds.has(entry.provenance.sourceId)) {
      throw new Error(`Unknown provenance source ${entry.provenance.sourceId} for managed file ${entry.id}`);
    }
    for (const tool of entry.tools || []) {
      if (!["claude", "codex"].includes(tool)) throw new Error(`Unsupported managed file tool: ${tool}`);
    }
    for (const capability of entry.capabilities || []) {
      if (capability !== "monitor") throw new Error(`Unsupported managed file capability: ${capability}`);
    }
    if (entry.render) {
      if (!Array.isArray(entry.render.variables) || entry.render.variables.length === 0) {
        throw new Error(`Invalid managed file render definition: ${entry.id}`);
      }
      const renderValues = entry.render.values || {};
      if (!renderValues || typeof renderValues !== "object" || Array.isArray(renderValues)) {
        throw new Error(`Invalid managed file render values: ${entry.id}`);
      }
      const declared = new Set();
      for (const variable of entry.render.variables) {
        if (!/^[A-Z][A-Z0-9_]*$/.test(variable)) throw new Error(`Invalid managed template variable: ${variable}`);
        if (declared.has(variable)) throw new Error(`Duplicate managed template variable: ${variable}`);
        declared.add(variable);
      }
      for (const [name, value] of Object.entries(renderValues)) {
        if (!/^[A-Z][A-Z0-9_]*$/.test(name) || !declared.has(name) || typeof value !== "string") {
          throw new Error(`Invalid managed file render value ${name}: ${entry.id}`);
        }
      }
    }
  }
  return manifest;
}

function selectedManagedFiles(manifest, tools, capabilities = []) {
  const selected = new Set(tools || []);
  const enabledCapabilities = new Set(capabilities || []);
  return manifest.managedFiles.filter((entry) =>
    (!entry.tools?.length || entry.tools.some((tool) => selected.has(tool))) &&
    (!entry.capabilities?.length || entry.capabilities.every((capability) => enabledCapabilities.has(capability)))
  );
}

function previousInstalledSha(state, entry) {
  const previous = state?.managedFiles?.[entry.target];
  return previous?.installedSha256 || previous?.sha256 || null;
}

function classifyManagedFile(root, entry, state, variables = {}, extensionState, includeCore = true) {
  const target = path.join(root, entry.target);
  const desiredSha256 = sha256(desiredManagedContent(root, entry, variables, extensionState, includeCore));
  if (!fs.existsSync(target)) return { state: "missing", target, sha256: null, desiredSha256 };
  const actualSha256 = sha256(fs.readFileSync(target));
  if (actualSha256 === desiredSha256) return { state: "current", target, sha256: actualSha256, desiredSha256 };
  if (actualSha256 === previousInstalledSha(state, entry)) return { state: "managed-old", target, sha256: actualSha256, desiredSha256 };
  if ((entry.replaceable || []).some((accepted) => accepted.sha256 === actualSha256)) {
    return { state: "replaceable", target, sha256: actualSha256, desiredSha256 };
  }
  return { state: "unknown", target, sha256: actualSha256, desiredSha256 };
}

function inspectManagedFiles(root, manifest, tools, capabilities = [], variables = {}, options = {}) {
  const state = loadState(root);
  const hooksState = extensionHookState(root, options.extensionState);
  const coreSelected = new Set(selectedManagedFiles(manifest, tools, capabilities).map((entry) => entry.id));
  const selected = new Set(coreSelected);
  const hookEntry = manifest.managedFiles.find((entry) => entry.target === CODEX_HOOKS_TARGET);
  if (hookEntry && (hasExtensionHooks(hooksState) || (hooksState === null && fs.existsSync(path.join(root, CODEX_HOOKS_TARGET))))) selected.add(hookEntry.id);
  const output = { current: [], managedOld: [], replaceable: [], missing: [], unknown: [], files: [] };
  for (const entry of manifest.managedFiles.filter((entry) => selected.has(entry.id))) {
    const classified = classifyManagedFile(root, entry, state, variables, hooksState, coreSelected.has(entry.id));
    const key = classified.state === "managed-old" ? "managedOld" : classified.state;
    output[key].push(entry.target);
    output.files.push({
      id: entry.id,
      target: entry.target,
      state: classified.state,
      sha256: classified.sha256,
      desiredSha256: classified.desiredSha256,
      provenance: entry.provenance,
    });
  }
  return output;
}

function planManagedFiles(root, manifest, tools, options = {}) {
  const state = loadState(root) || { schemaVersion: 2, managedFiles: {} };
  const plans = [];
  const hooksState = extensionHookState(root, options.extensionState);
  const coreSelected = new Set(selectedManagedFiles(manifest, tools, options.capabilities).map((entry) => entry.id));
  const selected = new Set(coreSelected);
  const hookEntry = manifest.managedFiles.find((entry) => entry.target === CODEX_HOOKS_TARGET);
  if (hookEntry && (hasExtensionHooks(hooksState) || (hooksState === null && fs.existsSync(path.join(root, CODEX_HOOKS_TARGET))))) selected.add(hookEntry.id);
  for (const entry of manifest.managedFiles) {
    if (!selected.has(entry.id)) {
      const previousSha = previousInstalledSha(state, entry);
      if (!previousSha) continue;
      const target = path.join(root, entry.target);
      const exists = fs.existsSync(target);
      const actualSha = exists ? sha256(fs.readFileSync(target)) : null;
      if (exists && actualSha !== previousSha && !options.force) {
        throw new WorkspaceError("MANAGED_FILE_UNKNOWN", `Managed file contains unknown changes: ${entry.target}`, { target: entry.target });
      }
      plans.push({
        entry,
        target,
        action: exists ? "remove" : "forget",
        previous: exists ? fs.readFileSync(target) : null,
        reason: "not-selected",
        desiredSha256: null,
      });
      continue;
    }
    const classified = classifyManagedFile(root, entry, state, options.variables, hooksState, coreSelected.has(entry.id));
    if (classified.state === "current") {
      plans.push({ entry, target: classified.target, action: "skip", previous: null, reason: "current", desiredSha256: classified.desiredSha256 });
      continue;
    }
    if (classified.state === "missing" && !entry.allowMissing) {
      throw new WorkspaceError("MANAGED_FILE_MISSING", `Managed file target is missing: ${entry.target}`, { target: entry.target });
    }
    if (classified.state === "unknown" && !options.force) {
      throw new WorkspaceError("MANAGED_FILE_UNKNOWN", `Managed file contains unknown changes: ${entry.target}`, { target: entry.target });
    }
    plans.push({
      entry,
      target: classified.target,
      action: "write",
      reason: classified.state,
      previous: fs.existsSync(classified.target) ? fs.readFileSync(classified.target) : null,
      content: desiredManagedContent(root, entry, options.variables, hooksState, coreSelected.has(entry.id)),
      desiredSha256: classified.desiredSha256,
    });
  }
  return { plans, state };
}

function installManagedFiles(root, manifest, tools, options = {}) {
  const { plans, state } = planManagedFiles(root, manifest, tools, options);
  const written = [];
  try {
    for (const plan of plans) {
      if (plan.action === "write") atomicWrite(plan.target, plan.content);
      else if (plan.action === "remove" && fs.existsSync(plan.target)) fs.unlinkSync(plan.target);
      else continue;
      written.push(plan);
    }
    const nextManaged = { ...(state.managedFiles || {}) };
    for (const plan of plans) {
      if (["remove", "forget"].includes(plan.action)) delete nextManaged[plan.entry.target];
      else {
        nextManaged[plan.entry.target] = {
          artifactId: plan.entry.id,
          definitionSha256: definitionSha256(plan.entry),
          installedSha256: plan.desiredSha256,
        };
      }
    }
    saveState(root, { ...state, schemaVersion: 2, managedFiles: nextManaged });
  } catch (error) {
    for (const plan of written.reverse()) {
      if (plan.action === "remove") atomicWrite(plan.target, plan.previous);
      else if (plan.previous === null) {
        if (fs.existsSync(plan.target)) fs.unlinkSync(plan.target);
      } else atomicWrite(plan.target, plan.previous);
    }
    throw error;
  }
  return plans.map((plan) => ({
    id: plan.entry.id,
    target: plan.entry.target,
    action: plan.action,
    reason: plan.reason,
  }));
}

module.exports = {
  ARTIFACTS_ROOT,
  MANIFEST_FILE,
  canonicalize,
  classifyManagedFile,
  definitionSha256,
  inspectManagedFiles,
  installManagedFiles,
  loadManagedManifest,
  planManagedFiles,
  renderManagedContent,
  resolveArtifact,
  selectedManagedFiles,
};
