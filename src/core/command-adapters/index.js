"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { createFileTransaction } = require("../transaction");

const { claudeAdapter } = require("./claude");
const { codexAdapter } = require("./codex");
const { cursorAdapter } = require("./cursor");
const { windsurfAdapter } = require("./windsurf");
const { geminiAdapter } = require("./gemini");
const { deepseekAdapter } = require("./deepseek");

const ADAPTERS = new Map([
  [claudeAdapter.toolId, claudeAdapter],
  [codexAdapter.toolId, codexAdapter],
  [cursorAdapter.toolId, cursorAdapter],
  [windsurfAdapter.toolId, windsurfAdapter],
  [geminiAdapter.toolId, geminiAdapter],
  [deepseekAdapter.toolId, deepseekAdapter],
]);

const CONTEXT_SCRIPT_DIR = "scripts";
const CONTEXT_SCRIPT_NAME = "codew-context.sh";

const CONTEXT_SCRIPT_CONTENT = `#!/usr/bin/env bash
# Code Workspace Agent hook - injects project context at session start.
# The calling platform's hook config determines how the output is interpreted.

CODEW=""
if [ -x "node_modules/.bin/codew" ]; then
  CODEW="node_modules/.bin/codew"
elif command -v codew &>/dev/null; then
  CODEW="codew"
fi
if [ -z "$CODEW" ]; then
  echo '{"additionalContext":"Code Workspace CLI not found. Install with: npm install -g code-workspace-zhuiyi"}'
  exit 0
fi

output="$($CODEW context --json 2>/dev/null)"
if [ $? -ne 0 ] || [ -z "$output" ]; then
  echo '{"additionalContext":"Code Workspace is not initialized in this directory."}'
  exit 0
fi

# Extract data and format as unified additionalContext
echo "$output" | node -e "
const data = JSON.parse(require('fs').readFileSync(0, 'utf8'));
if (!data.ok) { console.log(JSON.stringify({additionalContext: 'Code Workspace context unavailable.'})); process.exit(0); }
const d = data.data;
let ctx = 'Workspace: ' + d.workspace.name + ' (health: ' + d.health + ')';
if (d.projects.length === 0) {
  ctx += '\\\\nNo projects registered. Use codew-add-projects skill to add some.';
} else {
  for (const p of d.projects) {
    ctx += '\\\\n- ' + p.name + ' (' + (p.type || 'unknown') + ') at ' + p.location + ' [branch: ' + (p.registeredBranch || '?') + ']';
  }
}
const permIssues = d.permissions.filter(p => p.status === 'missing');
if (permIssues.length > 0) {
  ctx += '\\\\nPermission gaps: ' + permIssues.map(p => p.tool).join(', ') + '. Run: codew permissions apply --yes';
}
console.log(JSON.stringify({additionalContext: ctx}));
"
`;

function getAdapter(toolId) {
  return ADAPTERS.get(toolId) || null;
}

function getAdaptersForTools(toolIds) {
  return (toolIds || []).map((id) => getAdapter(id)).filter(Boolean);
}

function getContextScriptRelativePath() {
  return path.join(CONTEXT_SCRIPT_DIR, CONTEXT_SCRIPT_NAME);
}

function getContextScriptPath(root) {
  return path.join(root, CONTEXT_SCRIPT_DIR, CONTEXT_SCRIPT_NAME);
}

function installContextScript(root, options = {}) {
  const scriptPath = getContextScriptPath(root);
  const files = [scriptPath];
  const transaction = (options.createFileTransaction || createFileTransaction)(files);
  try {
    fs.mkdirSync(path.dirname(scriptPath), { recursive: true });
    fs.writeFileSync(scriptPath, CONTEXT_SCRIPT_CONTENT, { mode: 0o755 });
    if (!fs.existsSync(scriptPath)) {
      throw new Error(`Context script was not created: ${scriptPath}`);
    }
    transaction.commit();
    return { action: "write", target: path.relative(root, scriptPath) };
  } catch (error) {
    transaction.rollback(error);
    throw error;
  }
}

function installAgentHooks(root, tools, options = {}) {
  const adapters = getAdaptersForTools(tools);
  const results = [];

  // Write the unified context script once
  results.push(installContextScript(root, options));
  const scriptRelative = getContextScriptRelativePath();

  // Generate hook config for each adapter
  for (const adapter of adapters) {
    if (!adapter.hook?.supported) continue;
    const config = adapter.getHookConfig(scriptRelative);
    const configPath = path.join(root, adapter.hook.configPath);
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n");
    results.push({ action: "write", target: adapter.hook.configPath, toolId: adapter.toolId });
  }

  return results;
}

function uninstallAgentHooks(root, tools) {
  const adapters = getAdaptersForTools(tools);
  const removed = [];
  for (const adapter of adapters) {
    if (!adapter.hook?.supported) continue;
    const configPath = path.join(root, adapter.hook.configPath);
    if (fs.existsSync(configPath)) {
      fs.unlinkSync(configPath);
      removed.push(adapter.hook.configPath);
    }
  }
  const scriptPath = getContextScriptPath(root);
  if (fs.existsSync(scriptPath)) {
    fs.unlinkSync(scriptPath);
    removed.push(getContextScriptRelativePath());
  }
  return removed;
}

module.exports = {
  ADAPTERS,
  CONTEXT_SCRIPT_DIR,
  CONTEXT_SCRIPT_NAME,
  getAdapter,
  getAdaptersForTools,
  installAgentHooks,
  installContextScript,
  uninstallAgentHooks,
  claudeAdapter,
  codexAdapter,
  cursorAdapter,
  windsurfAdapter,
  geminiAdapter,
  deepseekAdapter,
};
