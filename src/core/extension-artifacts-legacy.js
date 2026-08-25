const fs = require("node:fs");
const path = require("node:path");

const TOML = require("@iarna/toml");

const { WorkspaceError } = require("./errors");
const { sha256 } = require("./fs");

const CODEX_CONFIG_TARGET = ".codex/config.toml";
const CODEX_HOOKS_TARGET = ".codex/hooks.json";
const LEGACY_ARTIFACT_KINDS = new Set(["codex-config-block", "codex-hooks"]);

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

function targetForLegacyArtifact(artifact) {
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
  return { start, end: text[after] === "\n" ? after + 1 : after, fragment: text.slice(contentStart, end) };
}

function removeConfigBlock(text, extensionId, artifact) {
  const found = findConfigBlock(text, extensionId, artifact.id);
  if (!found || sha256(Buffer.from(found.fragment)) !== artifact.installedSha256) {
    throw artifactError("EXTENSION_CONFIG_BLOCK_MODIFIED", `Installed extension config block contains local changes: ${extensionId}/${artifact.id}`, { extension: extensionId, artifact: artifact.id });
  }
  return `${text.slice(0, found.start)}${text.slice(found.end)}`;
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
  return { file, content: emptyOwnedDocument ? null : `${JSON.stringify(document, null, 2)}\n` };
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

function legacyConfigArtifacts(installed) {
  return (installed?.artifacts || []).filter((artifact) => artifact.kind === "codex-config-block");
}

function legacyHooksArtifacts(installed) {
  return (installed?.artifacts || []).filter((artifact) => artifact.kind === "codex-hooks");
}

function planLegacyArtifactTransition(root, extensionId, previousInstalled, nextInstalled, previousState, nextState) {
  const writes = new Map();
  const removes = new Set();
  const previousConfig = legacyConfigArtifacts(previousInstalled);
  const nextConfig = legacyConfigArtifacts(nextInstalled);
  if (previousConfig.length > 0 || nextConfig.length > 0) {
    const file = path.join(root, CODEX_CONFIG_TARGET);
    let content = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
    for (const artifact of previousConfig) content = removeConfigBlock(content, extensionId, artifact);
    if (nextConfig.length > 0) throw artifactError("EXTENSION_STATE_INVALID", "Legacy config blocks cannot be newly installed by manifest v2", { extension: extensionId });
    if (content) {
      try { TOML.parse(content); } catch (error) { throw artifactError("EXTENSION_CONFIG_CONFLICT", `Removing legacy config block produces invalid TOML: ${error.message}`, { extension: extensionId, target: CODEX_CONFIG_TARGET }); }
      writes.set(file, content);
    } else removes.add(file);
  }
  if (legacyHooksArtifacts(previousInstalled).length > 0 || legacyHooksArtifacts(nextInstalled).length > 0) {
    const hooks = composeHooks(root, previousState, nextState);
    if (hooks.content === null) removes.add(hooks.file);
    else writes.set(hooks.file, hooks.content);
  }
  return { writes, removes };
}

function legacyArtifactsCurrent(root, extensionId, installed, state) {
  try {
    const config = fs.existsSync(path.join(root, CODEX_CONFIG_TARGET)) ? fs.readFileSync(path.join(root, CODEX_CONFIG_TARGET), "utf8") : "";
    for (const artifact of legacyConfigArtifacts(installed)) {
      const found = findConfigBlock(config, extensionId, artifact.id);
      if (!found || sha256(Buffer.from(found.fragment)) !== artifact.installedSha256) return false;
    }
    if (legacyHooksArtifacts(installed).length > 0) composeHooks(root, state, state);
    return true;
  } catch {
    return false;
  }
}

module.exports = {
  CODEX_CONFIG_TARGET,
  CODEX_HOOKS_TARGET,
  LEGACY_ARTIFACT_KINDS,
  composeHookContent,
  legacyArtifactsCurrent,
  planLegacyArtifactTransition,
  targetForLegacyArtifact,
};
