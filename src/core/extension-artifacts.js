const fs = require("node:fs");
const path = require("node:path");

const TOML = require("@iarna/toml");

const { directoryDigest } = require("./directory-digest");
const { WorkspaceError } = require("./errors");
const { sha256 } = require("./fs");
const { planHookTransition } = require("./hooks");
const {
  CODEX_CONFIG_TARGET,
  CODEX_HOOKS_TARGET,
  LEGACY_ARTIFACT_KINDS,
  composeHookContent,
  legacyArtifactsCurrent,
  planLegacyArtifactTransition,
  targetForLegacyArtifact,
} = require("./extension-artifacts-legacy");

const ARTIFACT_KINDS = new Set(["file", "directory", "text-block", "json-member"]);

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
  return LEGACY_ARTIFACT_KINDS.has(artifact.kind) ? targetForLegacyArtifact(artifact) : artifact.target;
}

function textMarkers(extensionId, artifactId) {
  return {
    start: `# BEGIN code-workspace-extension:${extensionId}:${artifactId}`,
    end: `# END code-workspace-extension:${extensionId}:${artifactId}`,
  };
}

function normalizeTextFragment(content, artifact) {
  const text = Buffer.isBuffer(content) ? content.toString("utf8") : String(content);
  if (!text.trim() || !text.endsWith("\n") || text.includes("# BEGIN code-workspace-extension:") || text.includes("# END code-workspace-extension:")) {
    throw artifactError("EXTENSION_TEXT_BLOCK_INVALID", `Extension text block ${artifact.id} must be non-empty, newline-terminated text without Host markers`, { artifact: artifact.id });
  }
  if ((artifact.format || "text") === "toml") {
    try { TOML.parse(text); } catch (error) { throw artifactError("EXTENSION_TEXT_BLOCK_INVALID", `Extension text block ${artifact.id} is invalid TOML: ${error.message}`, { artifact: artifact.id }); }
  }
  return text;
}

function textBlock(extensionId, artifactId, fragment) {
  const markers = textMarkers(extensionId, artifactId);
  return `${markers.start}\n${fragment}${markers.end}\n`;
}

function findTextBlock(text, extensionId, artifactId) {
  const markers = textMarkers(extensionId, artifactId);
  const start = text.indexOf(`${markers.start}\n`);
  if (start < 0) return null;
  const contentStart = start + markers.start.length + 1;
  const end = text.indexOf(markers.end, contentStart);
  if (end < 0 || text.indexOf(`${markers.start}\n`, contentStart) >= 0) {
    throw artifactError("EXTENSION_TEXT_BLOCK_MODIFIED", `Extension text block markers are invalid for ${extensionId}/${artifactId}`, { extension: extensionId, artifact: artifactId });
  }
  const after = end + markers.end.length;
  return { start, end: text[after] === "\n" ? after + 1 : after, fragment: text.slice(contentStart, end) };
}

function removeTextBlock(text, extensionId, artifact) {
  const found = findTextBlock(text, extensionId, artifact.id);
  if (!found || sha256(Buffer.from(found.fragment)) !== artifact.installedSha256) {
    throw artifactError("EXTENSION_TEXT_BLOCK_MODIFIED", `Installed extension text block contains local changes: ${extensionId}/${artifact.id}`, { extension: extensionId, artifact: artifact.id, target: artifact.target });
  }
  return `${text.slice(0, found.start)}${text.slice(found.end)}`;
}

function decodePointer(selector) {
  if (typeof selector !== "string" || !selector.startsWith("/") || selector === "/") {
    throw artifactError("EXTENSION_JSON_SELECTOR_INVALID", `Invalid JSON member selector: ${selector || "<missing>"}`, { selector: selector || null });
  }
  return selector.slice(1).split("/").map((segment) => {
    if (!segment || /~(?![01])/.test(segment)) throw artifactError("EXTENSION_JSON_SELECTOR_INVALID", `Invalid JSON member selector: ${selector}`, { selector });
    return segment.replace(/~1/g, "/").replace(/~0/g, "~");
  });
}

function readJsonDocument(file) {
  if (!fs.existsSync(file)) return {};
  try {
    const value = JSON.parse(fs.readFileSync(file, "utf8"));
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("document root must be an object");
    return structuredClone(value);
  } catch (error) {
    throw artifactError("EXTENSION_JSON_TARGET_INVALID", `Cannot parse shared JSON target ${file}: ${error.message}`, { file });
  }
}

function removeJsonMember(document, extensionId, artifact) {
  const segments = decodePointer(artifact.selector);
  const parents = [];
  let current = document;
  for (const segment of segments.slice(0, -1)) {
    if (!current[segment] || typeof current[segment] !== "object" || Array.isArray(current[segment])) {
      throw artifactError("EXTENSION_JSON_MEMBER_MODIFIED", `Installed JSON member is missing: ${artifact.selector}`, { extension: extensionId, artifact: artifact.id, selector: artifact.selector });
    }
    parents.push([current, segment]);
    current = current[segment];
  }
  const key = segments.at(-1);
  if (!Object.prototype.hasOwnProperty.call(current, key) || canonicalJson(current[key]) !== canonicalJson(artifact.payload)) {
    throw artifactError("EXTENSION_JSON_MEMBER_MODIFIED", `Installed JSON member contains local changes: ${artifact.selector}`, { extension: extensionId, artifact: artifact.id, selector: artifact.selector });
  }
  delete current[key];
  for (const [parent, segment] of parents.reverse()) {
    const value = parent[segment];
    if (value && typeof value === "object" && !Array.isArray(value) && Object.keys(value).length === 0) delete parent[segment];
    else break;
  }
}

function addJsonMember(document, extensionId, artifact) {
  const segments = decodePointer(artifact.selector);
  let current = document;
  for (const segment of segments.slice(0, -1)) {
    if (current[segment] === undefined) current[segment] = {};
    if (!current[segment] || typeof current[segment] !== "object" || Array.isArray(current[segment])) {
      throw artifactError("EXTENSION_JSON_MEMBER_CONFLICT", `JSON selector parent is not an object: ${artifact.selector}`, { extension: extensionId, artifact: artifact.id, selector: artifact.selector });
    }
    current = current[segment];
  }
  const key = segments.at(-1);
  if (Object.prototype.hasOwnProperty.call(current, key)) {
    throw artifactError("EXTENSION_JSON_MEMBER_CONFLICT", `JSON member already exists: ${artifact.selector}`, { extension: extensionId, artifact: artifact.id, selector: artifact.selector });
  }
  current[key] = structuredClone(artifact.payload);
}

function installedRecord(artifact, verified) {
  const base = {
    id: artifact.id,
    kind: artifact.kind,
    ownership: artifact.ownership,
    target: artifact.target,
    installedSha256: verified.installedSha256,
  };
  if (artifact.kind === "text-block") return { ...base, format: artifact.format || "text" };
  if (artifact.kind === "json-member") {
    let payload;
    try { payload = JSON.parse(verified.content.toString("utf8")); } catch (error) { throw artifactError("EXTENSION_JSON_MEMBER_INVALID", `Cannot parse JSON contribution ${artifact.id}: ${error.message}`, { artifact: artifact.id }); }
    return { ...base, selector: artifact.selector, payload: canonicalize(payload) };
  }
  return base;
}

function artifactsOfKind(installed, kind) {
  return (installed?.artifacts || []).filter((artifact) => (artifact.kind || "file") === kind);
}

function mergeTransition(target, source) {
  for (const [file, content] of source.writes) target.writes.set(file, content);
  for (const file of source.removes) target.removes.add(file);
}

function planFileTransition(root, extensionId, previousInstalled, nextInstalled, verifiedById) {
  const writes = new Map();
  const removes = new Set();
  const previous = new Map(artifactsOfKind(previousInstalled, "file").map((artifact) => [artifact.target, artifact]));
  const next = new Map(artifactsOfKind(nextInstalled, "file").map((artifact) => [artifact.target, artifact]));
  for (const [target, artifact] of previous) {
    const file = path.join(root, ...target.split("/"));
    if (!fs.existsSync(file) || sha256(fs.readFileSync(file)) !== artifact.installedSha256) {
      throw artifactError("EXTENSION_ARTIFACT_MODIFIED", `Installed extension artifact contains local changes: ${target}`, { extension: extensionId, target });
    }
    if (!next.has(target)) removes.add(file);
  }
  for (const [target, artifact] of next) {
    const file = path.join(root, ...target.split("/"));
    if (fs.existsSync(file) && !previous.has(target)) throw artifactError("EXTENSION_TARGET_OCCUPIED", `Extension target already exists and is not owned by ${extensionId}: ${target}`, { extension: extensionId, target });
    const verified = verifiedById.get(artifact.id);
    if (!verified?.content) throw artifactError("EXTENSION_ARTIFACT_MISSING", `Missing verified file artifact ${artifact.id}`, { extension: extensionId, artifact: artifact.id });
    writes.set(file, verified.content);
  }
  return { writes, removes };
}

function planTextTransition(root, extensionId, previousInstalled, nextInstalled, verifiedById) {
  const transition = { writes: new Map(), removes: new Set() };
  const previous = artifactsOfKind(previousInstalled, "text-block");
  const next = artifactsOfKind(nextInstalled, "text-block");
  const targets = [...new Set([...previous, ...next].map((artifact) => artifact.target))];
  for (const target of targets) {
    const file = path.join(root, ...target.split("/"));
    let content = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
    for (const artifact of previous.filter((entry) => entry.target === target)) content = removeTextBlock(content, extensionId, artifact);
    for (const artifact of next.filter((entry) => entry.target === target).sort((left, right) => left.id.localeCompare(right.id))) {
      if (findTextBlock(content, extensionId, artifact.id)) throw artifactError("EXTENSION_TEXT_BLOCK_CONFLICT", `Extension text block already exists: ${extensionId}/${artifact.id}`, { extension: extensionId, artifact: artifact.id });
      const verified = verifiedById.get(artifact.id);
      if (!verified?.content) throw artifactError("EXTENSION_ARTIFACT_MISSING", `Missing verified text block ${artifact.id}`, { extension: extensionId, artifact: artifact.id });
      const fragment = normalizeTextFragment(verified.content, artifact);
      const separator = !content ? "" : content.endsWith("\n\n") ? "" : content.endsWith("\n") ? "\n" : "\n\n";
      content = `${content}${separator}${textBlock(extensionId, artifact.id, fragment)}`;
    }
    if ([...previous, ...next].some((artifact) => artifact.target === target && artifact.format === "toml")) {
      try { TOML.parse(content); } catch (error) { throw artifactError("EXTENSION_TEXT_BLOCK_CONFLICT", `Extension text blocks produce invalid TOML: ${error.message}`, { extension: extensionId, target }); }
    }
    if (content) transition.writes.set(file, content);
    else transition.removes.add(file);
  }
  return transition;
}

function planJsonTransition(root, extensionId, previousInstalled, nextInstalled) {
  const transition = { writes: new Map(), removes: new Set() };
  const previous = artifactsOfKind(previousInstalled, "json-member");
  const next = artifactsOfKind(nextInstalled, "json-member");
  const targets = [...new Set([...previous, ...next].map((artifact) => artifact.target))];
  for (const target of targets) {
    const file = path.join(root, ...target.split("/"));
    const document = readJsonDocument(file);
    for (const artifact of previous.filter((entry) => entry.target === target)) removeJsonMember(document, extensionId, artifact);
    for (const artifact of next.filter((entry) => entry.target === target).sort((left, right) => left.selector.localeCompare(right.selector))) addJsonMember(document, extensionId, artifact);
    if (Object.keys(document).length === 0) transition.removes.add(file);
    else transition.writes.set(file, `${JSON.stringify(document, null, 2)}\n`);
  }
  return transition;
}

function planArtifactTransition(root, extensionId, previousInstalled, nextInstalled, previousState, nextState, verifiedById = new Map()) {
  const transition = { writes: new Map(), removes: new Set() };
  mergeTransition(transition, planFileTransition(root, extensionId, previousInstalled, nextInstalled, verifiedById));
  mergeTransition(transition, planTextTransition(root, extensionId, previousInstalled, nextInstalled, verifiedById));
  mergeTransition(transition, planJsonTransition(root, extensionId, previousInstalled, nextInstalled));
  const legacyTransition = planLegacyArtifactTransition(root, extensionId, previousInstalled, nextInstalled, previousState, nextState);
  mergeTransition(transition, legacyTransition);
  // Generic plugin Hooks are shared native configuration contributions, not
  // file artifacts. They participate in the same transaction as all other
  // extension effects and are rebuilt from installed state.
  mergeTransition(transition, planHookTransition(root, previousState, nextState, { baseTransitions: legacyTransition }));
  for (const file of transition.writes.keys()) transition.removes.delete(file);
  return transition;
}

function verifyArtifactTransition(transition) {
  for (const [file, content] of transition.writes) {
    if (!fs.existsSync(file) || !fs.readFileSync(file).equals(Buffer.isBuffer(content) ? content : Buffer.from(content))) {
      throw artifactError("EXTENSION_POSTCONDITION_FAILED", `Extension target could not be verified: ${file}`, { file });
    }
  }
  for (const file of transition.removes) if (fs.existsSync(file)) throw artifactError("EXTENSION_POSTCONDITION_FAILED", `Obsolete extension target was not removed: ${file}`, { file });
}

function installedArtifactsCurrent(root, extensionId, installed, state) {
  try {
    for (const artifact of artifactsOfKind(installed, "file")) {
      const file = path.join(root, ...artifact.target.split("/"));
      if (!fs.existsSync(file) || sha256(fs.readFileSync(file)) !== artifact.installedSha256) return false;
    }
    for (const artifact of artifactsOfKind(installed, "directory")) {
      const directory = path.join(root, ...artifact.target.split("/"));
      if (!fs.existsSync(directory) || directoryDigest(directory) !== artifact.installedSha256) return false;
    }
    for (const artifact of artifactsOfKind(installed, "text-block")) {
      const file = path.join(root, ...artifact.target.split("/"));
      const content = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
      const found = findTextBlock(content, extensionId, artifact.id);
      if (!found || sha256(Buffer.from(found.fragment)) !== artifact.installedSha256) return false;
    }
    for (const artifact of artifactsOfKind(installed, "json-member")) {
      const document = readJsonDocument(path.join(root, ...artifact.target.split("/")));
      const segments = decodePointer(artifact.selector);
      let current = document;
      for (const segment of segments.slice(0, -1)) current = current?.[segment];
      if (!current || typeof current !== "object" || canonicalJson(current[segments.at(-1)]) !== canonicalJson(artifact.payload)) return false;
    }
    return legacyArtifactsCurrent(root, extensionId, installed, state);
  } catch {
    return false;
  }
}

function directoryArtifacts(installed) {
  return artifactsOfKind(installed, "directory");
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
  LEGACY_ARTIFACT_KINDS,
  canonicalize,
  composeHookContent,
  directoryArtifacts,
  installedArtifactsCurrent,
  installedRecord,
  planArtifactTransition,
  removeEmptyParents,
  targetForArtifact,
  verifyArtifactTransition,
};
