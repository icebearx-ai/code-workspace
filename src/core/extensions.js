const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const packageJson = require("../../package.json");
const { OBSOLETE_ASSETS } = require("./assets");
const { CONFIG_FILE, LOCAL_DIRECTORY, STATE_FILE, configPath } = require("./config");
const { WorkspaceError } = require("./errors");
const { atomicWrite, sha256 } = require("./fs");
const { loadManagedManifest } = require("./managed-files");
const { permissionTargets } = require("./permissions");
const { createFileTransaction } = require("./transaction");
const {
  ARTIFACT_KINDS,
  CODEX_CONFIG_TARGET,
  CODEX_HOOKS_TARGET,
  installedArtifactsCurrent,
  installedRecord,
  planArtifactTransition,
  removeEmptyParents,
  targetForArtifact,
  verifyArtifactTransition,
} = require("./extension-artifacts");

const PACKAGE_ROOT = path.resolve(__dirname, "..", "..");
const EXTENSIONS_ROOT = path.join(PACKAGE_ROOT, "extensions");
const EXTENSION_STATE_FILE = "ext-manifest.json";
const EXTENSION_NAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const SUPPORTED_TOOLS = new Set(["claude", "codex"]);
const SEMVER_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;

function extensionError(code, message, details = {}) {
  return new WorkspaceError(code, message, details);
}

function parseSemver(value) {
  const text = String(value || "").trim();
  const match = text.match(SEMVER_PATTERN);
  if (!match) throw extensionError("EXTENSION_SEMVER_INVALID", `Invalid semantic version: ${value}`, { version: value });
  const prerelease = match[4] ? match[4].split(".") : [];
  for (const identifier of prerelease) {
    if (/^\d+$/.test(identifier) && identifier.length > 1 && identifier.startsWith("0")) {
      throw extensionError("EXTENSION_SEMVER_INVALID", `Invalid semantic version: ${value}`, { version: value });
    }
  }
  return {
    raw: text,
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease,
    build: match[5] ? match[5].split(".") : [],
  };
}

function compareIdentifiers(left, right) {
  const leftNumeric = /^\d+$/.test(left);
  const rightNumeric = /^\d+$/.test(right);
  if (leftNumeric && rightNumeric) return Number(left) - Number(right);
  if (leftNumeric) return -1;
  if (rightNumeric) return 1;
  return left < right ? -1 : left > right ? 1 : 0;
}

function compareSemver(leftValue, rightValue) {
  const left = typeof leftValue === "string" ? parseSemver(leftValue) : leftValue;
  const right = typeof rightValue === "string" ? parseSemver(rightValue) : rightValue;
  for (const key of ["major", "minor", "patch"]) {
    if (left[key] !== right[key]) return left[key] < right[key] ? -1 : 1;
  }
  if (left.prerelease.length === 0 || right.prerelease.length === 0) {
    return left.prerelease.length === right.prerelease.length ? 0 : left.prerelease.length === 0 ? 1 : -1;
  }
  const length = Math.max(left.prerelease.length, right.prerelease.length);
  for (let index = 0; index < length; index += 1) {
    if (left.prerelease[index] === undefined) return -1;
    if (right.prerelease[index] === undefined) return 1;
    const compared = compareIdentifiers(left.prerelease[index], right.prerelease[index]);
    if (compared !== 0) return compared < 0 ? -1 : 1;
  }
  return 0;
}

function comparatorMatches(version, comparator) {
  const match = comparator.match(/^(>=|<=|>|<|=)?(.+)$/);
  const operator = match[1] || "=";
  const compared = compareSemver(version, parseSemver(match[2]));
  return operator === ">=" ? compared >= 0
    : operator === "<=" ? compared <= 0
      : operator === ">" ? compared > 0
        : operator === "<" ? compared < 0
          : compared === 0;
}

function satisfiesSemverRange(versionValue, rangeValue) {
  const version = parseSemver(versionValue);
  const range = String(rangeValue || "").trim();
  if (!range) throw extensionError("EXTENSION_SEMVER_RANGE_INVALID", "Extension compatibility range is required");
  const alternatives = range.split(/\s*\|\|\s*/);
  if (alternatives.some((entry) => !entry)) throw extensionError("EXTENSION_SEMVER_RANGE_INVALID", `Invalid semantic version range: ${range}`, { range });
  try {
    return alternatives.some((alternative) => {
      const comparators = alternative.split(/\s+/).filter(Boolean);
      if (comparators.length === 0) return false;
      return comparators.every((comparator) => comparatorMatches(version, comparator));
    });
  } catch (error) {
    if (error.code === "EXTENSION_SEMVER_INVALID") {
      throw extensionError("EXTENSION_SEMVER_RANGE_INVALID", `Invalid semantic version range: ${range}`, { range });
    }
    throw error;
  }
}

function validateExtensionName(value, label = "extension") {
  const name = String(value || "");
  if (!EXTENSION_NAME_PATTERN.test(name)) {
    throw extensionError("EXTENSION_NAME_INVALID", `Invalid ${label} name: ${name || "<missing>"}`, { extension: name || null });
  }
  return name;
}

function normalizeArtifactTarget(value) {
  const target = String(value || "");
  const segments = target.split("/");
  if (
    !target || target.includes("\\") || path.posix.isAbsolute(target) ||
    segments.some((segment) => !segment || segment === "." || segment === "..") ||
    path.posix.normalize(target) !== target
  ) {
    throw extensionError("EXTENSION_ARTIFACT_TARGET_INVALID", `Invalid extension artifact target: ${target || "<missing>"}`, { target: target || null });
  }
  return target;
}

function coreManagedTargets() {
  const manifest = loadManagedManifest();
  const root = path.parse(PACKAGE_ROOT).root;
  return new Set([
    `${LOCAL_DIRECTORY}/${CONFIG_FILE}`,
    `${LOCAL_DIRECTORY}/${STATE_FILE}`,
    `${LOCAL_DIRECTORY}/${EXTENSION_STATE_FILE}`,
    ".gitignore",
    ...manifest.managedFiles.map((entry) => entry.target),
    ...OBSOLETE_ASSETS,
    ...permissionTargets(root, ["claude", "codex"]).map((target) => path.relative(root, target).split(path.sep).join("/")),
  ]);
}

function validateManifest(value, options = {}) {
  const manifest = value;
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
    throw extensionError("EXTENSION_MANIFEST_INVALID", "Extension manifest must be a JSON object");
  }
  if (manifest.schemaVersion !== 1 || manifest.experimental !== true) {
    throw extensionError("EXTENSION_MANIFEST_INVALID", "Extension manifest must use schemaVersion 1 and experimental true");
  }
  const id = validateExtensionName(manifest.id);
  if (options.expectedId && id !== options.expectedId) {
    throw extensionError("EXTENSION_MANIFEST_ID_MISMATCH", `Extension manifest id ${id} does not match directory ${options.expectedId}`, { extension: id, expected: options.expectedId });
  }
  if (typeof manifest.name !== "string" || !manifest.name.trim() || [...manifest.name.trim()].length > 100) {
    throw extensionError("EXTENSION_MANIFEST_INVALID", `Extension ${id} has an invalid display name`, { extension: id });
  }
  const version = parseSemver(manifest.version).raw;
  if (options.expectedVersion && version !== options.expectedVersion) {
    throw extensionError("EXTENSION_MANIFEST_VERSION_MISMATCH", `Extension manifest version ${version} does not match directory ${options.expectedVersion}`, { extension: id, version, expected: options.expectedVersion });
  }
  if (manifest.entry !== "init.js") {
    throw extensionError("EXTENSION_MANIFEST_INVALID", `Extension ${id} entry must be init.js`, { extension: id, entry: manifest.entry });
  }
  if (!SHA256_PATTERN.test(manifest.entrySha256 || "")) {
    throw extensionError("EXTENSION_MANIFEST_INVALID", `Extension ${id} entrySha256 is invalid`, { extension: id });
  }
  satisfiesSemverRange(options.codeWorkspaceVersion || packageJson.version, manifest.codeWorkspace);
  if (!Number.isInteger(manifest.timeoutMs) || manifest.timeoutMs < 1 || manifest.timeoutMs > 300000) {
    throw extensionError("EXTENSION_MANIFEST_INVALID", `Extension ${id} timeoutMs must be an integer from 1 to 300000`, { extension: id, timeoutMs: manifest.timeoutMs });
  }
  if (!Array.isArray(manifest.artifacts) || manifest.artifacts.length === 0) {
    throw extensionError("EXTENSION_MANIFEST_INVALID", `Extension ${id} must declare at least one artifact`, { extension: id });
  }
  const ids = new Set();
  const targets = new Set();
  const outputs = new Set();
  const protectedTargets = options.protectedTargets || coreManagedTargets();
  const artifacts = manifest.artifacts.map((artifact) => {
    if (!artifact || typeof artifact !== "object" || Array.isArray(artifact)) {
      throw extensionError("EXTENSION_MANIFEST_INVALID", `Extension ${id} contains an invalid artifact`, { extension: id });
    }
    const artifactId = validateExtensionName(artifact.id, "artifact");
    const kind = artifact.kind || "file";
    if (!ARTIFACT_KINDS.has(kind)) throw extensionError("EXTENSION_MANIFEST_INVALID", `Extension ${id} artifact ${artifactId} has unsupported kind ${kind}`, { extension: id, artifact: artifactId, kind });
    const target = kind === "file"
      ? normalizeArtifactTarget(artifact.target)
      : kind === "codex-config-block" ? CODEX_CONFIG_TARGET : CODEX_HOOKS_TARGET;
    if (kind !== "file" && artifact.target !== undefined && normalizeArtifactTarget(artifact.target) !== target) {
      throw extensionError("EXTENSION_MANIFEST_INVALID", `Extension ${id} artifact ${artifactId} cannot override the Host target for ${kind}`, { extension: id, artifact: artifactId, target: artifact.target, expectedTarget: target });
    }
    const output = normalizeArtifactTarget(artifact.output || (kind === "file" ? target : ""));
    if (ids.has(artifactId)) throw extensionError("EXTENSION_ARTIFACT_DUPLICATE", `Extension ${id} repeats artifact id ${artifactId}`, { extension: id, artifact: artifactId });
    if (outputs.has(output)) throw extensionError("EXTENSION_ARTIFACT_DUPLICATE", `Extension ${id} repeats output ${output}`, { extension: id, output });
    if (kind === "file" && targets.has(target)) throw extensionError("EXTENSION_TARGET_CONFLICT", `Extension ${id} repeats target ${target}`, { extension: id, target });
    if (kind === "file" && protectedTargets.has(target)) throw extensionError("EXTENSION_CORE_TARGET_FORBIDDEN", `Extension ${id} cannot own Code Workspace core target ${target}`, { extension: id, target });
    if (!SHA256_PATTERN.test(artifact.sha256 || "")) {
      throw extensionError("EXTENSION_MANIFEST_INVALID", `Extension ${id} artifact ${artifactId} has an invalid sha256`, { extension: id, artifact: artifactId });
    }
    let tools;
    if (artifact.tools !== undefined) {
      if (!Array.isArray(artifact.tools) || artifact.tools.length === 0 || new Set(artifact.tools).size !== artifact.tools.length || artifact.tools.some((tool) => !SUPPORTED_TOOLS.has(tool))) {
        throw extensionError("EXTENSION_MANIFEST_INVALID", `Extension ${id} artifact ${artifactId} has invalid tools`, { extension: id, artifact: artifactId });
      }
      tools = artifact.tools.slice();
    }
    ids.add(artifactId);
    outputs.add(output);
    if (kind === "file") targets.add(target);
    return Object.freeze({ id: artifactId, kind, target, output, sha256: artifact.sha256, ...(tools ? { tools: Object.freeze(tools) } : {}) });
  });
  return Object.freeze({
    schemaVersion: 1,
    experimental: true,
    id,
    name: manifest.name.trim(),
    version,
    entry: manifest.entry,
    entrySha256: manifest.entrySha256,
    codeWorkspace: manifest.codeWorkspace,
    timeoutMs: manifest.timeoutMs,
    artifacts: Object.freeze(artifacts),
  });
}

function readJson(file, code) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (error) {
    throw extensionError(code, `Cannot parse ${file}: ${error.message}`, { file });
  }
}

function assertRegularFile(file, code, label) {
  let stat;
  try {
    stat = fs.lstatSync(file);
  } catch {
    throw extensionError(code, `Missing ${label}: ${file}`, { file });
  }
  if (!stat.isFile() || stat.isSymbolicLink()) throw extensionError(code, `${label} must be a regular file: ${file}`, { file });
}

function discoverExtensionEntry(extensionsRoot, extensionEntry, codeWorkspaceVersion) {
    if (!extensionEntry.isDirectory() || extensionEntry.isSymbolicLink()) {
      throw extensionError("EXTENSION_REPOSITORY_INVALID", `Extension repository entry must be a directory: ${extensionEntry.name}`, { entry: extensionEntry.name });
    }
    const id = validateExtensionName(extensionEntry.name);
    const extensionRoot = path.join(extensionsRoot, id);
    const versionEntries = fs.readdirSync(extensionRoot, { withFileTypes: true }).filter((entry) => !entry.name.startsWith("."));
    if (versionEntries.length === 0) throw extensionError("EXTENSION_REPOSITORY_INVALID", `Extension ${id} contains no versions`, { extension: id });
    const versions = [];
    for (const versionEntry of versionEntries) {
      if (!versionEntry.isDirectory() || versionEntry.isSymbolicLink()) {
        throw extensionError("EXTENSION_REPOSITORY_INVALID", `Extension version entry must be a directory: ${id}/${versionEntry.name}`, { extension: id, version: versionEntry.name });
      }
      const version = parseSemver(versionEntry.name).raw;
      const sourceRoot = path.join(extensionRoot, version);
      const manifestFile = path.join(sourceRoot, "manifest.json");
      const entryFile = path.join(sourceRoot, "init.js");
      assertRegularFile(manifestFile, "EXTENSION_MANIFEST_MISSING", "extension manifest");
      assertRegularFile(entryFile, "EXTENSION_ENTRY_MISSING", "extension entry");
      const manifestBytes = fs.readFileSync(manifestFile);
      const rawManifest = readJson(manifestFile, "EXTENSION_MANIFEST_PARSE_FAILED");
      const manifest = validateManifest(rawManifest, { expectedId: id, expectedVersion: version, codeWorkspaceVersion });
      const entrySha256 = sha256(fs.readFileSync(entryFile));
      if (entrySha256 !== manifest.entrySha256) {
        throw extensionError("EXTENSION_ENTRY_HASH_MISMATCH", `Extension entry hash mismatch: ${id}@${version}`, { extension: id, version, expectedSha256: manifest.entrySha256, actualSha256: entrySha256 });
      }
      versions.push(Object.freeze({
        id,
        version,
        sourceRoot,
        manifestFile,
        entryFile,
        manifest,
        manifestSha256: sha256(manifestBytes),
        entrySha256,
        compatible: satisfiesSemverRange(codeWorkspaceVersion, manifest.codeWorkspace),
      }));
    }
    versions.sort((left, right) => compareSemver(right.version, left.version));
    return Object.freeze({
      id,
      name: versions[0].manifest.name,
      versions: Object.freeze(versions),
      latestCompatible: versions.find((entry) => entry.compatible) || null,
    });
}

function discoverExtensions(options = {}) {
  const extensionsRoot = path.resolve(options.extensionsRoot || EXTENSIONS_ROOT);
  const codeWorkspaceVersion = options.codeWorkspaceVersion || packageJson.version;
  if (!fs.existsSync(extensionsRoot)) return options.tolerant ? { catalog: [], invalid: [] } : [];
  const entries = fs.readdirSync(extensionsRoot, { withFileTypes: true }).filter((entry) => !entry.name.startsWith("."));
  const catalog = [];
  const invalid = [];
  for (const extensionEntry of entries) {
    try {
      catalog.push(discoverExtensionEntry(extensionsRoot, extensionEntry, codeWorkspaceVersion));
    } catch (error) {
      if (!options.tolerant) throw error;
      invalid.push({ id: EXTENSION_NAME_PATTERN.test(extensionEntry.name) ? extensionEntry.name : null, entry: extensionEntry.name, code: error.code || "EXTENSION_REPOSITORY_INVALID", message: error.message });
    }
  }
  catalog.sort((left, right) => left.id.localeCompare(right.id));
  invalid.sort((left, right) => left.entry.localeCompare(right.entry));
  return options.tolerant ? { catalog, invalid } : catalog;
}

function extensionStatePath(root) {
  return path.join(path.resolve(root), LOCAL_DIRECTORY, EXTENSION_STATE_FILE);
}

function emptyExtensionState() {
  return { schemaVersion: 1, experimental: true, extensions: {} };
}

function validateInstalledState(id, installed) {
  if (installed === null) return null;
  if (!installed || typeof installed !== "object" || Array.isArray(installed)) throw extensionError("EXTENSION_STATE_INVALID", `Invalid installed state for ${id}`, { extension: id });
  parseSemver(installed.version);
  if (!SHA256_PATTERN.test(installed.manifestSha256 || "") || !Array.isArray(installed.artifacts)) {
    throw extensionError("EXTENSION_STATE_INVALID", `Invalid installed state for ${id}`, { extension: id });
  }
  const targets = new Set();
  const protectedTargets = coreManagedTargets();
  for (const artifact of installed.artifacts) {
    validateExtensionName(artifact?.id, "artifact");
    if (!SHA256_PATTERN.test(artifact.installedSha256 || "")) throw extensionError("EXTENSION_STATE_INVALID", `Invalid installed artifact state for ${id}`, { extension: id });
    const kind = artifact.kind || "file";
    if (!ARTIFACT_KINDS.has(kind)) throw extensionError("EXTENSION_STATE_INVALID", `Invalid installed artifact kind for ${id}: ${kind}`, { extension: id, kind });
    const target = normalizeArtifactTarget(artifact.target);
    if (target !== targetForArtifact({ ...artifact, kind })) throw extensionError("EXTENSION_STATE_INVALID", `Installed extension ${id} has an invalid target for ${kind}`, { extension: id, target, kind });
    if (kind === "file" && protectedTargets.has(target)) throw extensionError("EXTENSION_STATE_INVALID", `Installed extension ${id} claims core target ${target}`, { extension: id, target });
    if (kind === "file" && targets.has(target)) throw extensionError("EXTENSION_STATE_INVALID", `Duplicate installed target for ${id}: ${target}`, { extension: id, target });
    if (kind === "codex-hooks" && (!artifact.payload || artifact.payload.schemaVersion !== 1 || !artifact.payload.hooks)) {
      throw extensionError("EXTENSION_STATE_INVALID", `Installed Hook artifact for ${id} is missing its payload`, { extension: id, artifact: artifact.id });
    }
    if (kind === "file") targets.add(target);
  }
  return installed;
}

function loadExtensionState(root) {
  const file = extensionStatePath(root);
  if (!fs.existsSync(file)) return emptyExtensionState();
  const state = readJson(file, "EXTENSION_STATE_PARSE_FAILED");
  if (state?.schemaVersion !== 1 || state.experimental !== true || !state.extensions || typeof state.extensions !== "object" || Array.isArray(state.extensions)) {
    throw extensionError("EXTENSION_STATE_INVALID", `Invalid Workspace extension state: ${file}`, { file });
  }
  const owners = new Map();
  for (const [id, value] of Object.entries(state.extensions)) {
    validateExtensionName(id);
    if (!value || typeof value !== "object" || Array.isArray(value)) throw extensionError("EXTENSION_STATE_INVALID", `Invalid extension state for ${id}`, { extension: id });
    const installed = validateInstalledState(id, value.installed ?? null);
    if (value.lastAttempt !== undefined) {
      const attempt = value.lastAttempt;
      if (!attempt || typeof attempt !== "object" || !["installed", "failed"].includes(attempt.status) || !attempt.version) {
        throw extensionError("EXTENSION_STATE_INVALID", `Invalid lastAttempt state for ${id}`, { extension: id });
      }
      parseSemver(attempt.version);
      if (attempt.status === "failed" && (!attempt.code || !attempt.message)) throw extensionError("EXTENSION_STATE_INVALID", `Failed lastAttempt for ${id} requires code and message`, { extension: id });
    }
    for (const artifact of installed?.artifacts || []) {
      if ((artifact.kind || "file") !== "file") continue;
      const owner = owners.get(artifact.target);
      if (owner) throw extensionError("EXTENSION_STATE_INVALID", `Installed extensions ${owner} and ${id} both claim ${artifact.target}`, { extension: id, conflictingExtension: owner, target: artifact.target });
      owners.set(artifact.target, id);
    }
  }
  return state;
}

function inspectExtensionState(root) {
  try {
    return { state: loadExtensionState(root), error: null };
  } catch (error) {
    return { state: emptyExtensionState(), error };
  }
}

function saveExtensionState(root, state, options = {}) {
  (options.atomicWrite || atomicWrite)(extensionStatePath(root), `${JSON.stringify(state, null, 2)}\n`);
}

function parseExtensionSelection(value) {
  if (value === undefined) return null;
  const text = String(value).trim();
  if (!text) throw extensionError("EXTENSION_SELECTION_INVALID", "--extensions requires one or more extension names or none");
  if (text === "none") return [];
  const names = text.split(",").map((entry) => entry.trim());
  if (names.some((entry) => !entry) || names.includes("none")) {
    throw extensionError("EXTENSION_SELECTION_INVALID", `Invalid extension selection: ${text}`, { selection: text });
  }
  return normalizeExtensionNames(names);
}

function normalizeExtensionNames(values) {
  if (!Array.isArray(values)) throw extensionError("EXTENSION_SELECTION_INVALID", "Extension selection must be a list of names");
  const names = values.map((entry) => String(entry || "").trim());
  if (names.some((entry) => !entry) || new Set(names).size !== names.length) {
    throw extensionError("EXTENSION_SELECTION_INVALID", `Invalid extension selection: ${names.join(",")}`, { selection: names });
  }
  for (const name of names) {
    if (name.includes("@")) throw extensionError("EXTENSION_VERSION_SELECTION_UNSUPPORTED", `Extension versions cannot be selected explicitly: ${name}`, { extension: name });
    validateExtensionName(name);
  }
  return names;
}

function applicableArtifacts(manifest, tools = []) {
  const selected = new Set(tools);
  return manifest.artifacts.filter((artifact) => !artifact.tools || artifact.tools.some((tool) => selected.has(tool)));
}

function installedExtensionNames(state) {
  return Object.entries(state.extensions).filter(([, value]) => value.installed).map(([id]) => id);
}

function hasWorkspaceConfiguration(root) {
  return fs.existsSync(configPath(path.resolve(root)));
}

function resolveExtensionPlans(catalog, requested, options = {}) {
  const tools = options.tools || [];
  const state = options.state || emptyExtensionState();
  const byId = new Map(catalog.map((entry) => [entry.id, entry]));
  const plans = [];
  const owners = new Map();
  for (const [id, value] of Object.entries(state.extensions)) {
    if (!value.installed || requested.includes(id)) continue;
    for (const artifact of value.installed.artifacts) {
      if ((artifact.kind || "file") === "file") owners.set(artifact.target, id);
    }
  }
  for (const id of requested) {
    const extension = byId.get(id);
    if (!extension) throw extensionError("EXTENSION_NOT_FOUND", `Unknown built-in extension: ${id}`, { extension: id });
    if (!extension.latestCompatible) {
      throw extensionError("EXTENSION_VERSION_INCOMPATIBLE", `No compatible version of ${id} is available for Code Workspace ${packageJson.version}`, { extension: id, codeWorkspaceVersion: packageJson.version });
    }
    const resolved = extension.latestCompatible;
    const artifacts = applicableArtifacts(resolved.manifest, tools);
    for (const artifact of artifacts) {
      if (artifact.kind !== "file") continue;
      const owner = owners.get(artifact.target);
      if (owner) throw extensionError("EXTENSION_TARGET_CONFLICT", `Extensions ${owner} and ${id} both own ${artifact.target}`, { extension: id, conflictingExtension: owner, target: artifact.target });
      owners.set(artifact.target, id);
    }
    plans.push(Object.freeze({
      id,
      name: resolved.manifest.name,
      version: resolved.version,
      sourceRoot: resolved.sourceRoot,
      entryFile: resolved.entryFile,
      manifestFile: resolved.manifestFile,
      manifest: resolved.manifest,
      manifestSha256: resolved.manifestSha256,
      entrySha256: resolved.entrySha256,
      artifacts: Object.freeze(artifacts.slice()),
    }));
  }
  return Object.freeze(plans);
}

function prepareExtensionPlans(catalogResult, requested, options = {}) {
  const catalog = Array.isArray(catalogResult) ? catalogResult : catalogResult.catalog;
  const invalid = Array.isArray(catalogResult) ? [] : catalogResult.invalid;
  const failures = [];
  const diagnostics = invalid.map((entry) => ({ code: entry.code, severity: "warning", message: entry.message, extension: entry.id, entry: entry.entry }));
  const validIds = new Set(catalog.map((entry) => entry.id));
  const invalidById = new Map(invalid.filter((entry) => entry.id).map((entry) => [entry.id, entry]));
  for (const id of requested) {
    if (!validIds.has(id) && !invalidById.has(id)) throw extensionError("EXTENSION_NOT_FOUND", "Unknown built-in extension: " + id, { extension: id });
  }
  if (options.stateError) {
    for (const id of requested) failures.push({ id, version: null, status: "failed", code: options.stateError.code || "EXTENSION_STATE_INVALID", message: options.stateError.message, statePersisted: false, phase: "prepare" });
    diagnostics.push({ code: options.stateError.code || "EXTENSION_STATE_INVALID", severity: "warning", message: options.stateError.message });
    return { plans: [], failures, diagnostics };
  }
  const validRequested = [];
  for (const id of requested) {
    const invalidEntry = invalidById.get(id);
    if (invalidEntry) failures.push({ id, version: null, status: "failed", code: invalidEntry.code, message: invalidEntry.message, statePersisted: false, phase: "prepare" });
    else validRequested.push(id);
  }
  const plans = [];
  const planningState = structuredClone(options.state || emptyExtensionState());
  for (const id of validRequested) {
    try {
      const plan = resolveExtensionPlans(catalog, [id], { ...options, state: planningState })[0];
      plans.push(plan);
      planningState.extensions[id] = {
        installed: {
          artifacts: plan.artifacts.map((artifact) => ({ id: artifact.id, kind: artifact.kind, target: artifact.target })),
        },
      };
    } catch (error) {
      failures.push({ id, version: null, status: "failed", code: error.code || "EXTENSION_INIT_FAILED", message: error.message, statePersisted: false, phase: "prepare" });
    }
  }
  return { plans, failures, diagnostics };
}

function assertSafeWorkspaceTarget(root, target) {
  normalizeArtifactTarget(target);
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(resolvedRoot, ...target.split("/"));
  if (resolved === resolvedRoot || !resolved.startsWith(`${resolvedRoot}${path.sep}`)) {
    throw extensionError("EXTENSION_ARTIFACT_TARGET_INVALID", `Extension target escapes Workspace: ${target}`, { target });
  }
  let current = resolvedRoot;
  for (const segment of target.split("/")) {
    current = path.join(current, segment);
    if (!fs.existsSync(current)) continue;
    const stat = fs.lstatSync(current);
    if (stat.isSymbolicLink()) throw extensionError("EXTENSION_ARTIFACT_SYMLINK", `Extension target traverses a symbolic link: ${target}`, { target, path: current });
    if (current !== resolved && !stat.isDirectory()) throw extensionError("EXTENSION_ARTIFACT_TARGET_INVALID", `Extension target parent is not a directory: ${target}`, { target, path: current });
    if (current === resolved && !stat.isFile()) throw extensionError("EXTENSION_ARTIFACT_TARGET_INVALID", `Extension target exists and is not a regular file: ${target}`, { target, path: current });
  }
  return resolved;
}

function listOutputFiles(root) {
  const files = [];
  const visit = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      const relative = path.relative(root, file).split(path.sep).join("/");
      if (entry.isSymbolicLink()) throw extensionError("EXTENSION_OUTPUT_SYMLINK", `Extension output contains a symbolic link: ${relative}`, { target: relative });
      if (entry.isDirectory()) visit(file);
      else if (entry.isFile()) files.push(relative);
      else throw extensionError("EXTENSION_OUTPUT_INVALID", `Extension output is not a regular file: ${relative}`, { target: relative });
    }
  };
  visit(root);
  return files.sort();
}

function verifyExtensionOutput(outputRoot, artifacts) {
  const expected = new Map(artifacts.map((artifact) => [artifact.output || artifact.target, artifact]));
  const actual = listOutputFiles(outputRoot);
  for (const target of actual) {
    if (!expected.has(target)) throw extensionError("EXTENSION_ARTIFACT_UNDECLARED", `Extension generated undeclared artifact: ${target}`, { target });
  }
  const verified = [];
  for (const artifact of artifacts) {
    const output = artifact.output || artifact.target;
    const file = path.join(outputRoot, ...output.split("/"));
    if (!actual.includes(output)) throw extensionError("EXTENSION_ARTIFACT_MISSING", `Extension did not generate artifact: ${output}`, { output });
    const content = fs.readFileSync(file);
    const actualSha256 = sha256(content);
    if (actualSha256 !== artifact.sha256) {
      throw extensionError("EXTENSION_ARTIFACT_HASH_MISMATCH", `Extension artifact hash mismatch: ${output}`, { output, target: artifact.target, expectedSha256: artifact.sha256, actualSha256 });
    }
    verified.push({ ...artifact, file, content, installedSha256: actualSha256 });
  }
  return verified;
}

function runExtensionProcess(plan, contextFile, outputRoot, options = {}) {
  const runner = options.spawnSync || spawnSync;
  const environment = {};
  for (const name of ["PATH", "TMPDIR", "TMP", "TEMP", "LANG", "LC_ALL", "SystemRoot", "WINDIR", "PATHEXT"]) {
    if (process.env[name] !== undefined) environment[name] = process.env[name];
  }
  const result = runner(process.execPath, [plan.entryFile, "--context", contextFile, "--output", outputRoot], {
    cwd: plan.sourceRoot,
    env: environment,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: plan.manifest.timeoutMs,
    killSignal: "SIGKILL",
    maxBuffer: 1024 * 1024,
  });
  if (result.error?.code === "ETIMEDOUT" || result.signal === "SIGKILL") {
    throw extensionError("EXTENSION_INIT_TIMEOUT", `Extension ${plan.id} timed out after ${plan.manifest.timeoutMs}ms`, { extension: plan.id, timeoutMs: plan.manifest.timeoutMs });
  }
  if (result.error) throw extensionError("EXTENSION_INIT_FAILED", `Extension ${plan.id} failed to start: ${result.error.message}`, { extension: plan.id });
  if (result.status !== 0) {
    const detail = String(result.stderr || result.stdout || "").trim().split(/\r?\n/)[0];
    throw extensionError("EXTENSION_INIT_FAILED", `Extension ${plan.id} exited with status ${result.status}${detail ? `: ${detail}` : ""}`, { extension: plan.id, exitCode: result.status });
  }
  return result;
}

function stateFingerprint(root) {
  const file = extensionStatePath(root);
  return fs.existsSync(file) ? sha256(fs.readFileSync(file)) : null;
}

function installedIsCurrent(root, plan, installed, state) {
  if (!installed || installed.version !== plan.version || installed.manifestSha256 !== plan.manifestSha256) return false;
  if (installed.artifacts.length !== plan.artifacts.length) return false;
  const byId = new Map(installed.artifacts.map((artifact) => [artifact.id, artifact]));
  return plan.artifacts.every((artifact) => {
    const stateArtifact = byId.get(artifact.id);
    return stateArtifact && (stateArtifact.kind || "file") === artifact.kind && stateArtifact.target === targetForArtifact(artifact) && stateArtifact.installedSha256 === artifact.sha256;
  }) && installedArtifactsCurrent(root, plan.id, installed, state);
}

function assertInstallOwnership(root, plan, state) {
  const installed = state.extensions[plan.id]?.installed || null;
  const ownArtifacts = new Map((installed?.artifacts || []).filter((artifact) => (artifact.kind || "file") === "file").map((artifact) => [artifact.target, artifact]));
  const otherOwners = new Map();
  for (const [id, value] of Object.entries(state.extensions)) {
    if (id === plan.id || !value.installed) continue;
    for (const artifact of value.installed.artifacts) {
      if ((artifact.kind || "file") === "file") otherOwners.set(artifact.target, id);
    }
  }
  for (const artifact of plan.artifacts) {
    if (artifact.kind !== "file") continue;
    const owner = otherOwners.get(artifact.target);
    if (owner) throw extensionError("EXTENSION_TARGET_CONFLICT", `Extensions ${owner} and ${plan.id} both own ${artifact.target}`, { extension: plan.id, conflictingExtension: owner, target: artifact.target });
  }
  for (const artifact of [...plan.artifacts, ...(installed?.artifacts || [])]) {
    if ((artifact.kind || "file") !== "file") continue;
    const target = assertSafeWorkspaceTarget(root, artifact.target);
    if (!fs.existsSync(target)) continue;
    const own = ownArtifacts.get(artifact.target);
    if (!own) throw extensionError("EXTENSION_TARGET_OCCUPIED", `Extension target already exists and is not owned by ${plan.id}: ${artifact.target}`, { extension: plan.id, target: artifact.target });
    const actualSha256 = sha256(fs.readFileSync(target));
    if (actualSha256 !== own.installedSha256) {
      throw extensionError("EXTENSION_ARTIFACT_MODIFIED", `Installed extension artifact contains local changes: ${artifact.target}`, { extension: plan.id, target: artifact.target, expectedSha256: own.installedSha256, actualSha256 });
    }
  }
}

function recordFailedAttempt(root, plan, error, options = {}) {
  let transaction;
  try {
    const state = loadExtensionState(root);
    const next = structuredClone(state);
    const previous = next.extensions[plan.id]?.installed ?? null;
    next.extensions[plan.id] = {
      installed: previous,
      lastAttempt: { version: plan.version, status: "failed", code: error.code || "EXTENSION_INIT_FAILED", message: error.message },
    };
    transaction = createFileTransaction([extensionStatePath(root)]);
    saveExtensionState(root, next, options);
    options.injectFailure?.("after-failure-state-save", plan);
    const verified = loadExtensionState(root);
    const attempt = verified.extensions[plan.id]?.lastAttempt;
    if (!attempt || attempt.status !== "failed" || attempt.version !== plan.version || attempt.code !== (error.code || "EXTENSION_INIT_FAILED")) {
      throw extensionError("EXTENSION_STATE_VERIFY_FAILED", `Failed extension attempt state could not be verified for ${plan.id}`, { extension: plan.id });
    }
    transaction.commit();
    return true;
  } catch (stateError) {
    transaction?.rollback(stateError);
    return false;
  }
}

function installVerifiedArtifacts(root, plan, verified, previousState, options = {}) {
  const previousInstalled = previousState.extensions[plan.id]?.installed || null;
  for (const artifact of [...plan.artifacts, ...(previousInstalled?.artifacts || [])]) assertSafeWorkspaceTarget(root, targetForArtifact(artifact));
  const verifiedById = new Map(verified.map((artifact) => [artifact.id, artifact]));
  const installedArtifacts = verified.map((artifact) => installedRecord(artifact, artifact));
  const next = structuredClone(previousState);
  next.extensions[plan.id] = {
    installed: {
      version: plan.version,
      manifestSha256: plan.manifestSha256,
      artifacts: installedArtifacts,
    },
    lastAttempt: { version: plan.version, status: "installed" },
  };
  const transition = planArtifactTransition(root, plan.id, previousInstalled, next.extensions[plan.id].installed, previousState, next, verifiedById);
  const stateFile = extensionStatePath(root);
  const transaction = (options.createFileTransaction || createFileTransaction)([...transition.writes.keys(), ...transition.removes, stateFile]);
  try {
    for (const [file, content] of transition.writes) {
      (options.atomicWrite || atomicWrite)(file, content);
      options.injectFailure?.("after-artifact-write", { plan, file });
    }
    for (const file of transition.removes) if (fs.existsSync(file)) fs.unlinkSync(file);
    saveExtensionState(root, next, options);
    options.injectFailure?.("after-state-save", plan);
    verifyArtifactTransition(transition);
    const persisted = loadExtensionState(root).extensions[plan.id];
    if (!persisted || persisted.lastAttempt?.status !== "installed" || persisted.installed?.manifestSha256 !== plan.manifestSha256) {
      throw extensionError("EXTENSION_STATE_VERIFY_FAILED", `Installed extension state could not be verified for ${plan.id}`, { extension: plan.id });
    }
    options.injectFailure?.("after-verify", plan);
    transaction.commit();
    return persisted.installed;
  } catch (error) {
    transaction.rollback(error);
    if (error.details?.workspaceRolledBack === false) {
      throw extensionError("EXTENSION_ROLLBACK_INCOMPLETE", `Extension ${plan.id} failed and rollback was incomplete`, { extension: plan.id, causeCode: error.code || "EXTENSION_INSTALL_FAILED", causeMessage: error.message, rollbackErrors: error.details.rollbackErrors });
    }
    throw error;
  }
}

function executeExtension(root, plan, context, options = {}) {
  let temporaryRoot;
  let executionResult;
  try {
    const currentManifestSha = sha256(fs.readFileSync(plan.manifestFile));
    if (currentManifestSha !== plan.manifestSha256) throw extensionError("EXTENSION_PLAN_STALE", `Extension manifest changed after planning: ${plan.id}`, { extension: plan.id });
    const currentEntrySha = sha256(fs.readFileSync(plan.entryFile));
    if (currentEntrySha !== plan.entrySha256 || currentEntrySha !== plan.manifest.entrySha256) {
      throw extensionError("EXTENSION_PLAN_STALE", `Extension entry changed after planning: ${plan.id}`, { extension: plan.id, expectedSha256: plan.entrySha256, actualSha256: currentEntrySha });
    }
    validateManifest(readJson(plan.manifestFile, "EXTENSION_MANIFEST_PARSE_FAILED"), {
      expectedId: plan.id,
      expectedVersion: plan.version,
      codeWorkspaceVersion: packageJson.version,
    });
    const state = loadExtensionState(root);
    const installed = state.extensions[plan.id]?.installed || null;
    if (installedIsCurrent(root, plan, installed, state)) {
      executionResult = { id: plan.id, version: plan.version, status: "skipped", reason: "current" };
      return executionResult;
    }
    assertInstallOwnership(root, plan, state);
    const beforeState = stateFingerprint(root);
    temporaryRoot = fs.mkdtempSync(path.join(options.tempRoot || os.tmpdir(), `code-workspace-extension-${plan.id}-`));
    const outputRoot = path.join(temporaryRoot, "output");
    const contextFile = path.join(temporaryRoot, "context.json");
    fs.mkdirSync(outputRoot);
    fs.writeFileSync(contextFile, `${JSON.stringify(context, null, 2)}\n`, { mode: 0o600 });
    runExtensionProcess(plan, contextFile, outputRoot, options);
    options.injectFailure?.("after-process", plan);
    const verified = verifyExtensionOutput(outputRoot, plan.artifacts);
    options.injectFailure?.("after-output-verify", plan);
    if (stateFingerprint(root) !== beforeState) throw extensionError("EXTENSION_STATE_CONFLICT", `Extension state changed while ${plan.id} was running`, { extension: plan.id });
    const installedState = installVerifiedArtifacts(root, plan, verified, state, options);
    executionResult = { id: plan.id, version: plan.version, status: "installed", artifacts: installedState.artifacts };
    return executionResult;
  } catch (error) {
    const normalized = error.code ? error : extensionError("EXTENSION_INIT_FAILED", `Extension ${plan.id} failed: ${error.message}`, { extension: plan.id, cause: error.name });
    const statePersisted = recordFailedAttempt(root, plan, normalized, options);
    executionResult = { id: plan.id, version: plan.version, status: "failed", code: normalized.code, message: normalized.message, statePersisted };
    return executionResult;
  } finally {
    if (temporaryRoot) {
      try {
        (options.rmSync || fs.rmSync)(temporaryRoot, { recursive: true, force: true });
      } catch (error) {
        if (executionResult) {
          executionResult.warnings = [{
            code: "EXTENSION_STAGING_CLEANUP_FAILED",
            message: `Could not remove extension staging directory for ${plan.id}: ${error.message}`,
          }];
        }
      }
    }
  }
}

function runExtensionBatch(root, plans, context, options = {}) {
  const executed = [];
  for (const plan of plans) {
    const executionContext = typeof context === "function" ? context(plan) : {
      ...(context || {}),
      extension: { id: plan.id, version: plan.version },
    };
    executed.push(executeExtension(root, plan, executionContext, options));
  }
  const requested = options.requested || plans.map((plan) => plan.id);
  const byId = new Map([...executed, ...(options.preFailures || [])].map((entry) => [entry.id, entry]));
  const results = requested.map((id) => byId.get(id)).filter(Boolean);
  return {
    requested,
    results,
    summary: {
      installed: results.filter((entry) => entry.status === "installed").length,
      skipped: results.filter((entry) => entry.status === "skipped").length,
      failed: results.filter((entry) => entry.status === "failed").length,
    },
  };
}

function planExtensionUninstall(root, id) {
  const extensionId = validateExtensionName(id);
  const state = loadExtensionState(root);
  const installed = state.extensions[extensionId]?.installed || null;
  if (!installed) return Object.freeze({ root: path.resolve(root), id: extensionId, action: "skip", reason: "not-installed", targets: [] });
  for (const artifact of installed.artifacts) assertSafeWorkspaceTarget(root, targetForArtifact(artifact));
  const next = structuredClone(state);
  delete next.extensions[extensionId];
  const transition = planArtifactTransition(root, extensionId, installed, null, state, next);
  return Object.freeze({
    root: path.resolve(root),
    id: extensionId,
    action: "remove",
    version: installed.version,
    stateFingerprint: stateFingerprint(root),
    state,
    next,
    transition,
    targets: Object.freeze([...new Set([...transition.writes.keys(), ...transition.removes])].map((file) => path.relative(path.resolve(root), file).split(path.sep).join("/"))),
  });
}

function applyExtensionUninstall(plan, options = {}) {
  if (plan.action === "skip") return { id: plan.id, status: "skipped", reason: plan.reason, removed: [] };
  if (stateFingerprint(plan.root) !== plan.stateFingerprint) {
    throw extensionError("EXTENSION_STATE_CONFLICT", `Extension state changed before uninstalling ${plan.id}`, { extension: plan.id });
  }
  const currentState = loadExtensionState(plan.root);
  const installed = currentState.extensions[plan.id]?.installed;
  if (!installed || installed.version !== plan.version) throw extensionError("EXTENSION_STATE_CONFLICT", `Installed extension changed before uninstalling ${plan.id}`, { extension: plan.id });
  const next = structuredClone(currentState);
  delete next.extensions[plan.id];
  const transition = planArtifactTransition(plan.root, plan.id, installed, null, currentState, next);
  const stateFile = extensionStatePath(plan.root);
  const transaction = (options.createFileTransaction || createFileTransaction)([...transition.writes.keys(), ...transition.removes, stateFile]);
  try {
    for (const [file, content] of transition.writes) (options.atomicWrite || atomicWrite)(file, content);
    options.injectFailure?.("after-uninstall-write", plan);
    for (const file of transition.removes) if (fs.existsSync(file)) fs.unlinkSync(file);
    options.injectFailure?.("after-uninstall-remove", plan);
    saveExtensionState(plan.root, next, options);
    options.injectFailure?.("after-uninstall-state", plan);
    verifyArtifactTransition(transition);
    if (loadExtensionState(plan.root).extensions[plan.id]) throw extensionError("EXTENSION_STATE_VERIFY_FAILED", `Uninstalled extension state still exists for ${plan.id}`, { extension: plan.id });
    options.injectFailure?.("after-uninstall-verify", plan);
    for (const file of transition.removes) removeEmptyParents(plan.root, file);
    transaction.commit();
    return { id: plan.id, version: plan.version, status: "uninstalled", removed: plan.targets };
  } catch (error) {
    transaction.rollback(error);
    throw error;
  }
}

module.exports = {
  EXTENSIONS_ROOT,
  EXTENSION_NAME_PATTERN,
  EXTENSION_STATE_FILE,
  applicableArtifacts,
  applyExtensionUninstall,
  assertSafeWorkspaceTarget,
  compareSemver,
  coreManagedTargets,
  discoverExtensions,
  emptyExtensionState,
  executeExtension,
  extensionStatePath,
  hasWorkspaceConfiguration,
  inspectExtensionState,
  installedExtensionNames,
  loadExtensionState,
  normalizeArtifactTarget,
  normalizeExtensionNames,
  parseExtensionSelection,
  parseSemver,
  planExtensionUninstall,
  prepareExtensionPlans,
  resolveExtensionPlans,
  runExtensionBatch,
  satisfiesSemverRange,
  saveExtensionState,
  validateManifest,
  verifyExtensionOutput,
};
