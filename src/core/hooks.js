"use strict";

const fs = require("node:fs");
const path = require("node:path");

const { WorkspaceError } = require("./errors");
const { getAdapter, ADAPTERS } = require("../hooks/adapters");
const { ABSTRACT_HOOK_EVENTS, canonicalJson, normalizeAbstractEvent } = require("../hooks/adapters/common");

const SUPPORTED_HOOK_PROVIDERS = Object.freeze(Object.keys(ADAPTERS));
const HOOK_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const MAX_COMMAND_LENGTH = 4096;
const MAX_MATCHER_LENGTH = 1024;
const DEFAULT_TIMEOUT_MS = 2;

function hookError(code, message, details = {}) {
  return new WorkspaceError(code, message, details);
}

function validateHookId(value, label = "hook") {
  const id = String(value || "");
  if (!HOOK_ID_PATTERN.test(id)) throw hookError("HOOK_DECLARATION_INVALID", `Invalid ${label} id: ${id || "<missing>"}`, { id: id || null });
  return id;
}

function validateHookTools(value, extension) {
  if (value === undefined) return SUPPORTED_HOOK_PROVIDERS.slice();
  if (!Array.isArray(value) || value.length === 0 || new Set(value).size !== value.length || value.some((tool) => !SUPPORTED_HOOK_PROVIDERS.includes(tool))) {
    throw hookError("HOOK_DECLARATION_INVALID", `Extension ${extension} has invalid Hook tools`, { extension, tools: value });
  }
  return value.slice();
}

function validateHookDeclarations(value, extension) {
  if (value === undefined) return Object.freeze([]);
  if (!Array.isArray(value)) throw hookError("HOOK_DECLARATION_INVALID", `Extension ${extension} hooks must be an array`, { extension });
  const ids = new Set();
  const rendered = new Set();
  const hooks = value.map((raw) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw hookError("HOOK_DECLARATION_INVALID", `Extension ${extension} contains an invalid Hook declaration`, { extension });
    const allowed = new Set(["id", "event", "command", "tools", "matcher", "timeoutMs"]);
    const unknown = Object.keys(raw).find((key) => !allowed.has(key));
    if (unknown) throw hookError("HOOK_DECLARATION_INVALID", `Extension ${extension} Hook contains unsupported field ${unknown}`, { extension, field: unknown });
    const id = validateHookId(raw.id);
    if (ids.has(id)) throw hookError("HOOK_DECLARATION_DUPLICATE", `Extension ${extension} repeats Hook ${id}`, { extension, hook: id });
    let event;
    try { event = normalizeAbstractEvent(raw.event); } catch (error) {
      throw hookError(error.code || "HOOK_EVENT_UNSUPPORTED", error.message, { extension, hook: id, ...(error.details || {}) });
    }
    const command = String(raw.command || "").trim();
    if (!command || command.length > MAX_COMMAND_LENGTH || /[\r\n]/.test(command)) {
      throw hookError("HOOK_DECLARATION_INVALID", `Extension ${extension} Hook ${id} has an invalid command`, { extension, hook: id });
    }
    const tools = validateHookTools(raw.tools, extension);
    let matcher;
    if (raw.matcher !== undefined) {
      matcher = String(raw.matcher);
      if (!matcher || matcher.length > MAX_MATCHER_LENGTH || /[\r\n]/.test(matcher)) throw hookError("HOOK_DECLARATION_INVALID", `Extension ${extension} Hook ${id} has an invalid matcher`, { extension, hook: id });
    }
    const timeoutMs = raw.timeoutMs === undefined ? DEFAULT_TIMEOUT_MS : Number(raw.timeoutMs);
    if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 300000) throw hookError("HOOK_DECLARATION_INVALID", `Extension ${extension} Hook ${id} has an invalid timeoutMs`, { extension, hook: id, timeoutMs: raw.timeoutMs });
    const normalized = { id, event, command, tools: Object.freeze(tools), ...(matcher !== undefined ? { matcher } : {}), timeoutMs };
    for (const tool of tools) {
      const adapter = getAdapter(tool);
      for (const nativeEvent of adapter.nativeEvents(event)) {
        const key = `${tool}\u0000${nativeEvent}\u0000${canonicalJson({ matcher: matcher || null, command, timeoutMs })}`;
        if (rendered.has(key)) throw hookError("HOOK_DECLARATION_CONFLICT", `Extension ${extension} declares a duplicate native Hook`, { extension, hook: id, tool, nativeEvent });
        rendered.add(key);
      }
    }
    ids.add(id);
    return Object.freeze(normalized);
  });
  return Object.freeze(hooks);
}

function hookDeclarationsForTools(declarations, tools = SUPPORTED_HOOK_PROVIDERS) {
  const selected = new Set(tools);
  return (declarations || []).filter((hook) => hook.tools.some((tool) => selected.has(tool))).map((hook) => Object.freeze({
    ...hook,
    tools: Object.freeze(hook.tools.filter((tool) => selected.has(tool))),
  }));
}

function hookDeclarationKeys(declarations) {
  const keys = [];
  for (const hook of declarations || []) {
    for (const tool of hook.tools || []) {
      const adapter = getAdapter(tool);
      for (const nativeEvent of adapter.nativeEvents(hook.event)) {
        keys.push(`${tool}\u0000${nativeEvent}\u0000${canonicalJson({ matcher: hook.matcher || null, command: hook.command, timeoutMs: hook.timeoutMs })}`);
      }
    }
  }
  return keys;
}

function installedHooks(state, provider) {
  const result = [];
  for (const [extensionId, value] of Object.entries(state?.extensions || {})) {
    for (const hook of value?.installed?.hooks || []) {
      if (!hook.tools?.includes(provider)) continue;
      result.push({ extensionId, hook });
    }
  }
  return result.sort((left, right) => left.extensionId.localeCompare(right.extensionId) || left.hook.id.localeCompare(right.hook.id));
}

function readHookDocument(file, provider, providedContent) {
  if (providedContent !== undefined) {
    try {
      const value = JSON.parse(Buffer.isBuffer(providedContent) ? providedContent.toString("utf8") : String(providedContent));
      if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("document root must be an object");
      if (value.hooks !== undefined && (!value.hooks || typeof value.hooks !== "object" || Array.isArray(value.hooks))) throw new Error("hooks must be an object");
      return structuredClone(value);
    } catch (error) {
      throw hookError("HOOK_TARGET_INVALID", `Cannot parse ${provider} Hook target content: ${error.message}`, { provider });
    }
  }
  if (!fs.existsSync(file)) return {};
  try {
    const value = JSON.parse(fs.readFileSync(file, "utf8"));
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("document root must be an object");
    if (value.hooks !== undefined && (!value.hooks || typeof value.hooks !== "object" || Array.isArray(value.hooks))) throw new Error("hooks must be an object");
    return structuredClone(value);
  } catch (error) {
    throw hookError("HOOK_TARGET_INVALID", `Cannot parse ${provider} Hook target ${file}: ${error.message}`, { provider, file });
  }
}

function addHookContribution(document, contribution, provider) {
  const rendered = getAdapter(provider).renderDeclaration(contribution.hook);
  document.hooks ||= {};
  for (const [event, entries] of Object.entries(rendered)) {
    const current = document.hooks[event] ||= [];
    for (const entry of entries) {
      if (current.some((existing) => canonicalJson(existing) === canonicalJson(entry))) {
        throw hookError("HOOK_CONTRIBUTION_CONFLICT", `Hook contribution conflicts for ${contribution.extensionId}/${contribution.hook.id}`, { provider, extension: contribution.extensionId, hook: contribution.hook.id, event });
      }
      current.push(structuredClone(entry));
    }
  }
}

function removeHookContribution(document, contribution, provider) {
  const rendered = getAdapter(provider).renderDeclaration(contribution.hook);
  document.hooks ||= {};
  for (const [event, entries] of Object.entries(rendered)) {
    const current = document.hooks[event];
    if (!Array.isArray(current)) throw hookError("HOOK_CONTRIBUTION_MODIFIED", `Installed Hook contribution is missing for ${contribution.extensionId}/${contribution.hook.id}`, { provider, extension: contribution.extensionId, hook: contribution.hook.id, event });
    for (const expected of entries) {
      const matches = current.map((entry, index) => canonicalJson(entry) === canonicalJson(expected) ? index : -1).filter((index) => index >= 0);
      if (matches.length !== 1) throw hookError("HOOK_CONTRIBUTION_MODIFIED", `Installed Hook contribution is missing or ambiguous for ${contribution.extensionId}/${contribution.hook.id}`, { provider, extension: contribution.extensionId, hook: contribution.hook.id, event });
      current.splice(matches[0], 1);
    }
    if (current.length === 0) delete document.hooks[event];
  }
  if (Object.keys(document.hooks).length === 0) delete document.hooks;
}

function composeHookDocument(baseContent, provider, previousState, nextState) {
  let document;
  try {
    document = typeof baseContent === "string" || Buffer.isBuffer(baseContent)
      ? JSON.parse(Buffer.isBuffer(baseContent) ? baseContent.toString("utf8") : baseContent)
      : structuredClone(baseContent || {});
  } catch (error) {
    throw hookError("HOOK_TARGET_INVALID", `Cannot parse ${provider} Hook content: ${error.message}`, { provider });
  }
  if (!document || typeof document !== "object" || Array.isArray(document)) throw hookError("HOOK_TARGET_INVALID", `Invalid ${provider} Hook document`, { provider });
  for (const contribution of installedHooks(previousState, provider)) removeHookContribution(document, contribution, provider);
  for (const contribution of installedHooks(nextState, provider)) addHookContribution(document, contribution, provider);
  return document;
}

function hookTarget(root, provider) {
  const resolvedRoot = path.resolve(root);
  const relative = getAdapter(provider).target;
  let current = resolvedRoot;
  for (const segment of relative.split("/")) {
    current = path.join(current, segment);
    if (!fs.existsSync(current)) continue;
    const stat = fs.lstatSync(current);
    if (stat.isSymbolicLink()) throw hookError("HOOK_TARGET_INVALID", `Hook target traverses a symbolic link: ${relative}`, { provider, target: relative, path: current });
    if (current.endsWith(path.sep + path.basename(relative)) && !stat.isFile()) throw hookError("HOOK_TARGET_INVALID", `Hook target is not a regular file: ${relative}`, { provider, target: relative });
    if (!current.endsWith(path.sep + path.basename(relative)) && !stat.isDirectory()) throw hookError("HOOK_TARGET_INVALID", `Hook target parent is not a directory: ${relative}`, { provider, target: relative, path: current });
  }
  return path.join(resolvedRoot, relative);
}

function planHookTransition(root, previousState, nextState, options = {}) {
  const writes = new Map();
  const removes = new Set();
  for (const provider of options.providers || SUPPORTED_HOOK_PROVIDERS) {
    const previous = installedHooks(previousState, provider);
    const next = installedHooks(nextState, provider);
    if (previous.length === 0 && next.length === 0) continue;
    const file = hookTarget(root, provider);
    const baseTransitions = options.baseTransitions || { writes: new Map(), removes: new Set() };
    const before = baseTransitions.writes.has(file)
      ? readHookDocument(file, provider, baseTransitions.writes.get(file))
      : baseTransitions.removes.has(file)
        ? {}
        : readHookDocument(file, provider);
    const after = composeHookDocument(before, provider, previousState, nextState);
    if (JSON.stringify(before) === JSON.stringify(after)) continue;
    if (Object.keys(after).length === 0) removes.add(file);
    else writes.set(file, `${JSON.stringify(after, null, 2)}\n`);
  }
  return { writes, removes };
}

function verifyHookTransition(transition) {
  for (const [file, content] of transition.writes) {
    if (!fs.existsSync(file) || !fs.readFileSync(file).equals(Buffer.from(content))) throw hookError("HOOK_POSTCONDITION_FAILED", `Hook target could not be verified: ${file}`, { file });
  }
  for (const file of transition.removes) if (fs.existsSync(file)) throw hookError("HOOK_POSTCONDITION_FAILED", `Obsolete Hook target was not removed: ${file}`, { file });
}

function hooksCurrent(root, state) {
  try {
    for (const provider of SUPPORTED_HOOK_PROVIDERS) {
      if (installedHooks(state, provider).length === 0) continue;
      const file = hookTarget(root, provider);
      const document = readHookDocument(file, provider);
      const expected = composeHookDocument(document, provider, state, state);
      if (canonicalJson(document) !== canonicalJson(expected)) return false;
    }
    return true;
  } catch {
    return false;
  }
}

module.exports = {
  ABSTRACT_HOOK_EVENTS,
  DEFAULT_TIMEOUT_MS,
  SUPPORTED_HOOK_PROVIDERS,
  addHookContribution,
  composeHookDocument,
  hookDeclarationsForTools,
  hookDeclarationKeys,
  hookTarget,
  hooksCurrent,
  installedHooks,
  planHookTransition,
  readHookDocument,
  removeHookContribution,
  validateHookId,
  validateHookTools,
  validateHookDeclarations,
  verifyHookTransition,
};
