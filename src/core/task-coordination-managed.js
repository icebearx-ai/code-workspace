"use strict";

const fs = require("node:fs");
const path = require("node:path");

const { atomicWrite } = require("./fs");
const { WorkspaceError } = require("./errors");
const { ADAPTERS, getAdapter } = require("../hooks/adapters");

const PACKAGE_ROOT = path.resolve(__dirname, "..", "..");
function adapterFor(provider) {
  return getAdapter(provider);
}

function templatePath(provider) {
  const adapter = adapterFor(provider);
  const relative = String(adapter.coordinationTemplate || "");
  const resolved = path.resolve(PACKAGE_ROOT, relative);
  if (!relative || (resolved !== PACKAGE_ROOT && !resolved.startsWith(`${PACKAGE_ROOT}${path.sep}`))) {
    throw new WorkspaceError("TASK_HOOK_TEMPLATE_INVALID", `Invalid coordination Hook template for ${provider}.`, { provider, template: relative || null });
  }
  return resolved;
}

function targetPath(root, provider) {
  return path.join(root, adapterFor(provider).target);
}

function coordinationHookTargets(root, tools = Object.keys(ADAPTERS)) {
  return [...new Set(tools || [])]
    .filter((tool) => Object.hasOwn(ADAPTERS, tool))
    .map((tool) => targetPath(root, tool));
}

// Kept as compatibility exports for callers that used the old constants. New
// code resolves all Provider targets/templates through the adaptor metadata.
const CODEX_TEMPLATE = templatePath("codex");
const CLAUDE_TEMPLATE = templatePath("claude");
const CODEX_TARGET = adapterFor("codex").target;
const CLAUDE_TARGET = adapterFor("claude").target;

function loadJson(file, fallback) {
  if (!fs.existsSync(file)) return fallback;
  try {
    const value = JSON.parse(fs.readFileSync(file, "utf8"));
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("root must be an object");
    return value;
  } catch (error) {
    throw new WorkspaceError("TASK_HOOK_CONFIG_INVALID", `Cannot parse ${file}: ${error.message}`, { file, remediation: "Repair the Hook configuration manually, then retry coordination Hook installation." });
  }
}

function hookCommand(entry, provider) {
  const marker = new RegExp(`(?:^|\\s)code-workspace-task-hook\\s+${provider}(?:\\s|$)`);
  return entry?.hooks?.some((hook) => hook?.type === "command" && marker.test(String(hook.command || "")));
}

function coordinationCommand(provider, root) {
  const command = `code-workspace-task-hook ${provider}`;
  if (!root) return command;
  const resolvedRoot = path.resolve(root);
  let canonicalRoot = resolvedRoot;
  try { canonicalRoot = fs.realpathSync.native(resolvedRoot); } catch { /* the root is created by the caller before installation */ }
  const encodedRoot = Buffer.from(canonicalRoot).toString("base64url");
  return `${command} --workspace-root-b64 ${encodedRoot}`;
}

function coordinationFragment(provider, root) {
  const source = JSON.parse(fs.readFileSync(templatePath(provider), "utf8"));
  if (!root) return source;
  for (const entries of Object.values(source.hooks || {})) {
    for (const entry of Array.isArray(entries) ? entries : []) {
      for (const hook of Array.isArray(entry.hooks) ? entry.hooks : []) {
        if (hook?.type === "command" && String(hook.command || "").includes(`code-workspace-task-hook ${provider}`)) {
          hook.command = coordinationCommand(provider, root);
        }
      }
    }
  }
  return source;
}

function mergeHooks(document, fragment, provider) {
  const output = { ...document, hooks: { ...(document.hooks || {}) } };
  for (const [event, entries] of Object.entries(fragment.hooks || {})) {
    const current = Array.isArray(output.hooks[event]) ? [...output.hooks[event]] : [];
    const retained = current.filter((existing) => !hookCommand(existing, provider));
    const additions = (Array.isArray(entries) ? entries : [])
      .filter((entry) => !retained.some((existing) => JSON.stringify(existing) === JSON.stringify(entry)));
    output.hooks[event] = [...retained, ...additions.map((entry) => structuredClone(entry))];
  }
  return output;
}

function stripHooks(document, provider) {
  const output = { ...document, hooks: { ...(document.hooks || {}) } };
  for (const [event, entries] of Object.entries(output.hooks)) {
    if (!Array.isArray(entries)) continue;
    const remaining = entries.filter((entry) => !hookCommand(entry, provider));
    if (remaining.length > 0) output.hooks[event] = remaining;
    else delete output.hooks[event];
  }
  if (Object.keys(output.hooks).length === 0) delete output.hooks;
  return output;
}

function writeJson(file, value) {
  atomicWrite(file, `${JSON.stringify(value, null, 2)}\n`);
}

function installCoordinationHooks(root, tools = Object.keys(ADAPTERS), options = {}) {
  const selected = [...new Set(tools)].filter((tool) => Object.hasOwn(ADAPTERS, tool));
  const plans = [];
  for (const tool of selected) {
    const target = targetPath(root, tool);
    const fragment = coordinationFragment(tool, root);
    const before = loadJson(target, {});
    const after = mergeHooks(before, fragment, tool);
    plans.push({ tool, target, action: JSON.stringify(before) === JSON.stringify(after) ? "skip" : "write", before, after });
  }
  if (options.dryRun) return plans.map(({ before: _before, after: _after, ...plan }) => plan);
  try {
    for (const plan of plans) {
      if (plan.action === "write") writeJson(plan.target, plan.after);
    }
  } catch (error) {
    for (const plan of plans.slice().reverse()) {
      try { if (plan.action === "write") writeJson(plan.target, plan.before); } catch { /* report original failure */ }
    }
    throw new WorkspaceError("TASK_HOOK_INSTALL_FAILED", `Could not install coordination Hooks: ${error.message}`, { cause: error.code || error.name, plans: plans.map(({ before: _before, after: _after, ...entry }) => entry) });
  }
  return plans.map(({ before: _before, after: _after, ...plan }) => plan);
}

function removeCoordinationHooks(root, tools = Object.keys(ADAPTERS), options = {}) {
  const selected = [...new Set(tools)].filter((tool) => Object.hasOwn(ADAPTERS, tool));
  const plans = [];
  for (const tool of selected) {
    const target = targetPath(root, tool);
    if (!fs.existsSync(target)) { plans.push({ tool, target, action: "skip" }); continue; }
    const before = loadJson(target, {});
    const after = stripHooks(before, tool);
    plans.push({ tool, target, action: JSON.stringify(before) === JSON.stringify(after) ? "skip" : "write", before, after });
  }
  if (options.dryRun) return plans.map(({ before: _before, after: _after, ...plan }) => plan);
  for (const plan of plans) if (plan.action === "write") writeJson(plan.target, plan.after);
  return plans.map(({ before: _before, after: _after, ...plan }) => plan);
}

function installCoordinationArtifacts(root, tools = Object.keys(ADAPTERS), options = {}) {
  const selected = [...new Set(tools)].filter((tool) => Object.hasOwn(ADAPTERS, tool));
  const plans = selected.map((tool) => {
    const source = templatePath(tool);
    const target = path.join(root, adapterFor(tool).coordinationArtifact);
    const content = fs.readFileSync(source);
    const exists = fs.existsSync(target);
    const current = exists ? fs.readFileSync(target) : null;
    if (exists && !current.equals(content) && options.force !== true) {
      throw new WorkspaceError("TASK_HOOK_ARTIFACT_UNKNOWN", `Coordination Hook artifact has unknown local changes: ${target}`, { tool, target, remediation: "Review the artifact or re-run with --force when replacement is intentional." });
    }
    return { tool, target, action: exists && current.equals(content) ? "skip" : "write", content };
  });
  if (!options.dryRun) for (const plan of plans) if (plan.action === "write") atomicWrite(plan.target, plan.content);
  return plans.map(({ content: _content, ...plan }) => plan);
}

module.exports = {
  CODEX_TARGET,
  CLAUDE_TARGET,
  CODEX_TEMPLATE,
  CLAUDE_TEMPLATE,
  coordinationFragment,
  coordinationHookTargets,
  mergeHooks,
  stripHooks,
  installCoordinationHooks,
  removeCoordinationHooks,
  installCoordinationArtifacts,
};
