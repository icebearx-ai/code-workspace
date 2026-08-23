const fs = require("node:fs");
const path = require("node:path");

const TOML = require("@iarna/toml");

const { WorkspaceError } = require("./errors");
const { sha256 } = require("./fs");

const CODEX_CONFIG_TARGET = ".codex/config.toml";
const CODEX_HOOKS_TARGET = ".codex/hooks.json";
const ARTIFACT_KINDS = new Set(["file", "codex-config-block", "codex-hooks"]);

function artifactError(code, message, details = {}) {
  return new WorkspaceError(code, message, details);
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]));
}

function canonicalJson(value) {
  return JSON.stringify(canonicalize(value));
}

function targetForArtifact(artifact) {
  if (artifact.kind === "codex-config-block") return CODEX_CONFIG_TARGET;
  if (artifact.kind === "codex-hooks") return CODEX_HOOKS_TARGET;
  return artifact.target;
}

function configMarkers(extensionId, artifactId) {
  return {
    start: `# BEGIN code-workspace-extension:${extensionId}:${artifactId}`,
    end: `# END code-workspace-extension:${extensionId}:${artifactId}`,
  };
}

function normalizeConfigFragment(content, artifact) {
  const text = Buffer.isBuffer(content) ? content.toString("utf8") : String(content);
  if (!text.trim() || !text.endsWith("\n") || text.includes("# BEGIN code-workspace-extension:") || text.includes("# END code-workspace-extension:")) {
    throw artifactError("EXTENSION_CONFIG_BLOCK_INVALID", `Extension config block ${artifact.id} must be non-empty, newline-terminated TOML without Host markers`, { artifact: artifact.id });
  }
  try {
    TOML.parse(text);
  } catch (error) {
    throw artifactError("EXTENSION_CONFIG_BLOCK_INVALID", `Extension config block ${artifact.id} is invalid TOML: ${error.message}`, { artifact: artifact.id });
  }
  return text;
}

function configBlock(extensionId, artifactId, fragment) {
  const markers = configMarkers(extensionId, artifactId);
  return `${markers.start}\n${fragment}${markers.end}\n`;
}

function findConfigBlock(text, extensionId, artifactId) {
  const markers = configMarkers(extensionId, artifactId);
  const start = text.indexOf(`${markers.start}\n`);
  if (start < 0) return null;
  const contentStart = start + markers.start.length + 1;
  const end = text.indexOf(markers.end, contentStart);
  if (end < 0 || text.indexOf(`${markers.start}\n`, contentStart) >= 0) {
    throw artifactError("EXTENSION_CONFIG_BLOCK_MODIFIED", `Extension config block markers are invalid for ${extensionId}/${artifactId}`, { extension: extensionId, artifact: artifactId });
  }
  const after = end + markers.end.length;
  const blockEnd = text[after] === "\n" ? after + 1 : after;
  return { start, end: blockEnd, fragment: text.slice(contentStart, end) };
}

function removeConfigBlock(text, extensionId, artifact) {
  const found = findConfigBlock(text, extensionId, artifact.id);
  if (!found) throw artifactError("EXTENSION_CONFIG_BLOCK_MODIFIED", `Installed extension config block is missing: ${extensionId}/${artifact.id}`, { extension: extensionId, artifact: artifact.id });
  const actualSha256 = sha256(Buffer.from(found.fragment));
  if (actualSha256 !== artifact.installedSha256) {
    throw artifactError("EXTENSION_CONFIG_BLOCK_MODIFIED", `Installed extension config block contains local changes: ${extensionId}/${artifact.id}`, { extension: extensionId, artifact: artifact.id, expectedSha256: artifact.installedSha256, actualSha256 });
  }
  return `${text.slice(0, found.start)}${text.slice(found.end)}`;
}

function validateHookEntry(entry, event, artifact) {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) throw artifactError("EXTENSION_HOOKS_INVALID", `Invalid Hook entry for ${event}`, { artifact: artifact.id, event });
  if (entry.matcher !== undefined && typeof entry.matcher !== "string") throw artifactError("EXTENSION_HOOKS_INVALID", `Invalid Hook matcher for ${event}`, { artifact: artifact.id, event });
  if (!Array.isArray(entry.hooks) || entry.hooks.length === 0) throw artifactError("EXTENSION_HOOKS_INVALID", `Hook entry for ${event} must contain hooks`, { artifact: artifact.id, event });
  for (const hook of entry.hooks) {
    if (!hook || typeof hook !== "object" || Array.isArray(hook) || hook.type !== "command" || typeof hook.command !== "string" || !hook.command.trim()) {
      throw artifactError("EXTENSION_HOOKS_INVALID", `Only non-empty command Hooks are supported for ${event}`, { artifact: artifact.id, event });
    }
    if (hook.timeout !== undefined && (!Number.isInteger(hook.timeout) || hook.timeout < 1 || hook.timeout > 300)) {
      throw artifactError("EXTENSION_HOOKS_INVALID", `Hook timeout for ${event} must be an integer from 1 to 300`, { artifact: artifact.id, event });
    }
  }
}

function normalizeHookFragment(content, artifact) {
  let value;
  try {
    value = JSON.parse(Buffer.isBuffer(content) ? content.toString("utf8") : String(content));
  } catch (error) {
    throw artifactError("EXTENSION_HOOKS_INVALID", `Cannot parse Hook fragment ${artifact.id}: ${error.message}`, { artifact: artifact.id });
  }
  if (value?.schemaVersion !== 1 || !value.hooks || typeof value.hooks !== "object" || Array.isArray(value.hooks)) {
    throw artifactError("EXTENSION_HOOKS_INVALID", `Hook fragment ${artifact.id} must use schemaVersion 1 and a hooks object`, { artifact: artifact.id });
  }
  const hooks = {};
  for (const event of Object.keys(value.hooks).sort()) {
    if (!/^[A-Za-z][A-Za-z0-9]*$/.test(event) || !Array.isArray(value.hooks[event]) || value.hooks[event].length === 0) {
      throw artifactError("EXTENSION_HOOKS_INVALID", `Invalid Hook event ${event}`, { artifact: artifact.id, event });
    }
    hooks[event] = value.hooks[event].map((entry) => {
      validateHookEntry(entry, event, artifact);
      return canonicalize(entry);
    });
  }
  return { schemaVersion: 1, hooks };
}

function installedRecord(artifact, verified) {
  const target = targetForArtifact(artifact);
  if (artifact.kind === "codex-config-block") {
    normalizeConfigFragment(verified.content, artifact);
    return { id: artifact.id, kind: artifact.kind, target, installedSha256: verified.installedSha256 };
  }
  if (artifact.kind === "codex-hooks") {
    const payload = normalizeHookFragment(verified.content, artifact);
    return { id: artifact.id, kind: artifact.kind, target, installedSha256: verified.installedSha256, payload };
  }
  return { id: artifact.id, kind: "file", target, installedSha256: verified.installedSha256 };
}

function readText(file) {
  return fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
}

function readHooks(file) {
  if (!fs.existsSync(file)) return { hooks: {} };
  try {
    const value = JSON.parse(fs.readFileSync(file, "utf8"));
    if (!value || typeof value !== "object" || Array.isArray(value) || !value.hooks || typeof value.hooks !== "object" || Array.isArray(value.hooks)) throw new Error("hooks must be an object");
    return structuredClone(value);
  } catch (error) {
    throw artifactError("EXTENSION_HOOKS_TARGET_INVALID", `Cannot parse ${CODEX_HOOKS_TARGET}: ${error.message}`, { target: CODEX_HOOKS_TARGET });
  }
}

function hookArtifacts(state) {
  const entries = [];
  for (const [extensionId, value] of Object.entries(state.extensions || {})) {
    for (const artifact of value.installed?.artifacts || []) {
      if (artifact.kind === "codex-hooks") entries.push({ extensionId, artifact });
    }
  }
  return entries.sort((left, right) => left.extensionId.localeCompare(right.extensionId) || left.artifact.id.localeCompare(right.artifact.id));
}

function removeHookContribution(document, extensionId, artifact) {
  for (const [event, entries] of Object.entries(artifact.payload?.hooks || {})) {
    const current = document.hooks[event];
    if (!Array.isArray(current)) throw artifactError("EXTENSION_HOOKS_MODIFIED", `Installed Hook contribution is missing for ${extensionId}/${artifact.id}`, { extension: extensionId, artifact: artifact.id, event });
    for (const expected of entries) {
      const matches = current.map((entry, index) => canonicalJson(entry) === canonicalJson(expected) ? index : -1).filter((index) => index >= 0);
      if (matches.length !== 1) throw artifactError("EXTENSION_HOOKS_MODIFIED", `Installed Hook contribution is missing or ambiguous for ${extensionId}/${artifact.id}`, { extension: extensionId, artifact: artifact.id, event });
      current.splice(matches[0], 1);
    }
    if (current.length === 0) delete document.hooks[event];
  }
}

function addHookContribution(document, extensionId, artifact) {
  for (const [event, entries] of Object.entries(artifact.payload?.hooks || {})) {
    const current = document.hooks[event] ||= [];
    for (const entry of entries) {
      if (current.some((existing) => canonicalJson(existing) === canonicalJson(entry))) {
        throw artifactError("EXTENSION_HOOK_CONFLICT", `Hook contribution conflicts for ${extensionId}/${artifact.id}`, { extension: extensionId, artifact: artifact.id, event });
      }
      current.push(structuredClone(entry));
    }
  }
}

function composeHooks(root, previousState, nextState) {
  const file = path.join(root, CODEX_HOOKS_TARGET);
  const document = readHooks(file);
  for (const { extensionId, artifact } of hookArtifacts(previousState)) removeHookContribution(document, extensionId, artifact);
  for (const { extensionId, artifact } of hookArtifacts(nextState)) addHookContribution(document, extensionId, artifact);
  const emptyOwnedDocument = Object.keys(document.hooks).length === 0 && Object.keys(document).every((key) => key === "hooks");
  const content = emptyOwnedDocument ? null : `${JSON.stringify(document, null, 2)}\n`;
  return { file, content };
}

function composeHookContent(baseContent, state) {
  let document;
  try {
    document = JSON.parse(Buffer.isBuffer(baseContent) ? baseContent.toString("utf8") : String(baseContent));
  } catch (error) {
    throw artifactError("EXTENSION_HOOKS_TARGET_INVALID", `Cannot parse core Hook content: ${error.message}`, { target: CODEX_HOOKS_TARGET });
  }
  for (const { extensionId, artifact } of hookArtifacts(state)) addHookContribution(document, extensionId, artifact);
  return Buffer.from(`${JSON.stringify(document, null, 2)}\n`);
}

function fileArtifacts(installed) {
  return (installed?.artifacts || []).filter((artifact) => (artifact.kind || "file") === "file");
}

function configArtifacts(installed) {
  return (installed?.artifacts || []).filter((artifact) => artifact.kind === "codex-config-block");
}

function hooksArtifacts(installed) {
  return (installed?.artifacts || []).filter((artifact) => artifact.kind === "codex-hooks");
}

function planArtifactTransition(root, extensionId, previousInstalled, nextInstalled, previousState, nextState, verifiedById = new Map()) {
  const writes = new Map();
  const removes = new Set();
  const previousFiles = new Map(fileArtifacts(previousInstalled).map((artifact) => [artifact.target, artifact]));
  const nextFiles = new Map(fileArtifacts(nextInstalled).map((artifact) => [artifact.target, artifact]));

  for (const [target, artifact] of previousFiles) {
    const file = path.join(root, ...target.split("/"));
    if (!fs.existsSync(file) || sha256(fs.readFileSync(file)) !== artifact.installedSha256) {
      throw artifactError("EXTENSION_ARTIFACT_MODIFIED", `Installed extension artifact contains local changes: ${target}`, { extension: extensionId, target });
    }
    if (!nextFiles.has(target)) removes.add(file);
  }
  for (const [target, artifact] of nextFiles) {
    const file = path.join(root, ...target.split("/"));
    if (fs.existsSync(file) && !previousFiles.has(target)) throw artifactError("EXTENSION_TARGET_OCCUPIED", `Extension target already exists and is not owned by ${extensionId}: ${target}`, { extension: extensionId, target });
    const verified = verifiedById.get(artifact.id);
    if (!verified) throw artifactError("EXTENSION_ARTIFACT_MISSING", `Missing verified file artifact ${artifact.id}`, { extension: extensionId, artifact: artifact.id });
    writes.set(file, verified.content);
  }

  const previousConfig = configArtifacts(previousInstalled);
  const nextConfig = configArtifacts(nextInstalled);
  if (previousConfig.length > 0 || nextConfig.length > 0) {
    const file = path.join(root, CODEX_CONFIG_TARGET);
    let content = readText(file);
    for (const artifact of previousConfig) content = removeConfigBlock(content, extensionId, artifact);
    for (const artifact of nextConfig.sort((left, right) => left.id.localeCompare(right.id))) {
      if (findConfigBlock(content, extensionId, artifact.id)) throw artifactError("EXTENSION_CONFIG_BLOCK_CONFLICT", `Extension config block already exists: ${extensionId}/${artifact.id}`, { extension: extensionId, artifact: artifact.id });
      const verified = verifiedById.get(artifact.id);
      if (!verified) throw artifactError("EXTENSION_ARTIFACT_MISSING", `Missing verified config artifact ${artifact.id}`, { extension: extensionId, artifact: artifact.id });
      content = `${content}${content && !content.endsWith("\n") ? "\n" : ""}${content ? "\n" : ""}${configBlock(extensionId, artifact.id, normalizeConfigFragment(verified.content, artifact))}`;
    }
    try {
      TOML.parse(content);
    } catch (error) {
      throw artifactError("EXTENSION_CONFIG_CONFLICT", `Extension config blocks produce invalid Codex TOML: ${error.message}`, { extension: extensionId, target: CODEX_CONFIG_TARGET });
    }
    if (content) writes.set(file, content);
    else removes.add(file);
  }

  if (hooksArtifacts(previousInstalled).length > 0 || hooksArtifacts(nextInstalled).length > 0) {
    const hooks = composeHooks(root, previousState, nextState);
    if (hooks.content === null) removes.add(hooks.file);
    else writes.set(hooks.file, hooks.content);
  }
  return { writes, removes };
}

function verifyArtifactTransition(transition) {
  for (const [file, content] of transition.writes) {
    if (!fs.existsSync(file) || !fs.readFileSync(file).equals(Buffer.isBuffer(content) ? content : Buffer.from(content))) {
      throw artifactError("EXTENSION_POSTCONDITION_FAILED", `Extension target could not be verified: ${file}`, { file });
    }
  }
  for (const file of transition.removes) {
    if (fs.existsSync(file)) throw artifactError("EXTENSION_POSTCONDITION_FAILED", `Obsolete extension target was not removed: ${file}`, { file });
  }
}

function installedArtifactsCurrent(root, extensionId, installed, state) {
  try {
    for (const artifact of fileArtifacts(installed)) {
      const file = path.join(root, ...artifact.target.split("/"));
      if (!fs.existsSync(file) || sha256(fs.readFileSync(file)) !== artifact.installedSha256) return false;
    }
    const config = readText(path.join(root, CODEX_CONFIG_TARGET));
    for (const artifact of configArtifacts(installed)) {
      const found = findConfigBlock(config, extensionId, artifact.id);
      if (!found || sha256(Buffer.from(found.fragment)) !== artifact.installedSha256) return false;
    }
    if (hooksArtifacts(installed).length > 0) composeHooks(root, state, state);
    return true;
  } catch {
    return false;
  }
}

function removeEmptyParents(root, file) {
  const stop = path.resolve(root);
  let directory = path.dirname(file);
  while (directory !== stop && directory.startsWith(`${stop}${path.sep}`)) {
    if (!fs.existsSync(directory) || fs.readdirSync(directory).length > 0) break;
    fs.rmdirSync(directory);
    directory = path.dirname(directory);
  }
}

module.exports = {
  ARTIFACT_KINDS,
  CODEX_CONFIG_TARGET,
  CODEX_HOOKS_TARGET,
  composeHookContent,
  installedArtifactsCurrent,
  installedRecord,
  planArtifactTransition,
  removeEmptyParents,
  targetForArtifact,
  verifyArtifactTransition,
};
