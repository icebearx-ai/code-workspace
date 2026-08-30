"use strict";

const fs = require("node:fs");
const path = require("node:path");

const { atomicWrite } = require("./fs");
const { WorkspaceError } = require("./errors");

const PACKAGE_ROOT = path.resolve(__dirname, "..", "..");
const CODEX_TEMPLATE = path.join(PACKAGE_ROOT, "artifacts", "templates", "codex", "task-coordination-hooks.json");
const CLAUDE_TEMPLATE = path.join(PACKAGE_ROOT, "artifacts", "templates", "claude", "task-coordination-settings.json");
const CODEX_TARGET = ".codex/hooks.json";
const CLAUDE_TARGET = ".claude/settings.json";

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
  return entry?.hooks?.some((hook) => hook?.type === "command" && String(hook.command || "").includes(`code-workspace-task-hook ${provider}`));
}

function mergeHooks(document, fragment, provider) {
  const output = { ...document, hooks: { ...(document.hooks || {}) } };
  for (const [event, entries] of Object.entries(fragment.hooks || {})) {
    const current = Array.isArray(output.hooks[event]) ? [...output.hooks[event]] : [];
    const additions = (Array.isArray(entries) ? entries : []).filter((entry) => !current.some((existing) => hookCommand(existing, provider) && JSON.stringify(existing) === JSON.stringify(entry)));
    output.hooks[event] = [...current, ...additions];
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

function installCoordinationHooks(root, tools = ["codex", "claude"], options = {}) {
  const selected = [...new Set(tools)].filter((tool) => ["codex", "claude"].includes(tool));
  const plans = [];
  for (const tool of selected) {
    const target = path.join(root, tool === "codex" ? CODEX_TARGET : CLAUDE_TARGET);
    const fragment = JSON.parse(fs.readFileSync(tool === "codex" ? CODEX_TEMPLATE : CLAUDE_TEMPLATE, "utf8"));
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

function removeCoordinationHooks(root, tools = ["codex", "claude"], options = {}) {
  const selected = [...new Set(tools)].filter((tool) => ["codex", "claude"].includes(tool));
  const plans = [];
  for (const tool of selected) {
    const target = path.join(root, tool === "codex" ? CODEX_TARGET : CLAUDE_TARGET);
    if (!fs.existsSync(target)) { plans.push({ tool, target, action: "skip" }); continue; }
    const before = loadJson(target, {});
    const after = stripHooks(before, tool);
    plans.push({ tool, target, action: JSON.stringify(before) === JSON.stringify(after) ? "skip" : "write", before, after });
  }
  if (options.dryRun) return plans.map(({ before: _before, after: _after, ...plan }) => plan);
  for (const plan of plans) if (plan.action === "write") writeJson(plan.target, plan.after);
  return plans.map(({ before: _before, after: _after, ...plan }) => plan);
}

function installCoordinationArtifacts(root, tools = ["codex", "claude"], options = {}) {
  const selected = [...new Set(tools)].filter((tool) => ["codex", "claude"].includes(tool));
  const plans = selected.map((tool) => {
    const source = tool === "codex" ? CODEX_TEMPLATE : CLAUDE_TEMPLATE;
    const target = path.join(root, tool === "codex" ? ".codex/task-coordination-hooks.json" : ".claude/task-coordination-settings.json");
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

module.exports = { CODEX_TARGET, CLAUDE_TARGET, CODEX_TEMPLATE, CLAUDE_TEMPLATE, mergeHooks, stripHooks, installCoordinationHooks, removeCoordinationHooks, installCoordinationArtifacts };
