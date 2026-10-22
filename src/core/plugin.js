const fs = require("node:fs");
const path = require("node:path");

const { WorkspaceError } = require("./errors");
const { createFileTransaction } = require("./transaction");

const PLUGIN_DIR = ".claude-plugin";
const HOOKS_DIR = "hooks";
const HOOKS_FILE = "hooks.json";
const SCRIPTS_DIR = "scripts";
const CONTEXT_SCRIPT = "codew-context.sh";

const PLUGIN_JSON = {
  name: "code-workspace",
  description: "Code Workspace agent integration for local multi-project management",
  version: "1.0.0",
};

const HOOKS_JSON = {
  hooks: {
    SessionStart: [
      {
        hooks: [
          {
            type: "command",
            command: `bash "\${CLAUDE_PLUGIN_ROOT}/${SCRIPTS_DIR}/${CONTEXT_SCRIPT}"`,
          },
        ],
      },
    ],
  },
};

const CONTEXT_SCRIPT_CONTENT = `#!/usr/bin/env bash
# Code Workspace SessionStart hook - injects project context into Claude Code session.
CODEW=""
if [ -x "node_modules/.bin/codew" ]; then
  CODEW="node_modules/.bin/codew"
elif command -v codew &>/dev/null; then
  CODEW="codew"
fi
if [ -z "$CODEW" ]; then
  echo "Code Workspace CLI not found. Install with: npm install -g code-workspace-zhuiyi"
  exit 0
fi
output="$($CODEW context --json 2>/dev/null)"
if [ $? -ne 0 ] || [ -z "$output" ]; then
  echo "Code Workspace is not available or not initialized in this directory."
  exit 0
fi
echo "Code Workspace project context:"
echo "$output" | node -e "
const data = JSON.parse(require('fs').readFileSync(0, 'utf8'));
if (!data.ok) { console.log('Code Workspace context unavailable.'); process.exit(0); }
const d = data.data;
console.log('Workspace: ' + d.workspace.name + ' (health: ' + d.health + ')');
if (d.projects.length === 0) {
  console.log('No projects registered. Use codew-add-projects skill to add some.');
} else {
  for (const p of d.projects) {
    console.log('- ' + p.name + ' (' + (p.type || 'unknown') + ') at ' + p.location + ' [branch: ' + (p.registeredBranch || '?') + ']');
  }
}
const permIssues = d.permissions.filter(p => p.status === 'missing');
if (permIssues.length > 0) {
  console.log('Permission gaps detected for: ' + permIssues.map(p => p.tool).join(', '));
  console.log('Run: codew permissions apply --yes');
}
"
`;

function pluginFilePaths(root) {
  return [
    path.join(root, PLUGIN_DIR, "plugin.json"),
    path.join(root, HOOKS_DIR, HOOKS_FILE),
    path.join(root, SCRIPTS_DIR, CONTEXT_SCRIPT),
  ];
}

function planPluginInstall(root) {
  return pluginFilePaths(root).map((file) => ({
    file,
    relativePath: path.relative(root, file),
    action: fs.existsSync(file) ? "overwrite" : "create",
  }));
}

function planPluginUninstall(root) {
  return pluginFilePaths(root)
    .filter((file) => fs.existsSync(file))
    .map((file) => ({
      file,
      relativePath: path.relative(root, file),
      action: "remove",
    }));
}

function installPluginFiles(root) {
  const plans = planPluginInstall(root);
  const files = plans.map((plan) => plan.file);
  const transaction = createFileTransaction(files);
  try {
    fs.mkdirSync(path.join(root, PLUGIN_DIR), { recursive: true });
    fs.mkdirSync(path.join(root, HOOKS_DIR), { recursive: true });
    fs.mkdirSync(path.join(root, SCRIPTS_DIR), { recursive: true });

    fs.writeFileSync(files[0], JSON.stringify(PLUGIN_JSON, null, 2) + "\n");
    fs.writeFileSync(files[1], JSON.stringify(HOOKS_JSON, null, 2) + "\n");
    fs.writeFileSync(files[2], CONTEXT_SCRIPT_CONTENT, { mode: 0o755 });

    for (const file of files) {
      if (!fs.existsSync(file)) {
        throw new WorkspaceError("PLUGIN_POSTCONDITION_FAILED", `Plugin file was not created: ${file}`, { file });
      }
    }
    const scriptStat = fs.statSync(files[2]);
    if (!(scriptStat.mode & 0o100)) {
      throw new WorkspaceError("PLUGIN_SCRIPT_NOT_EXECUTABLE", `Context script is not executable: ${files[2]}`, { file: files[2] });
    }
    transaction.commit();
    return plans;
  } catch (error) {
    transaction.rollback(error);
    throw error;
  }
}

function uninstallPluginFiles(root) {
  const plans = planPluginUninstall(root);
  if (plans.length === 0) return { action: "skip", reason: "not-installed", removed: [] };
  const files = plans.map((plan) => plan.file);
  const transaction = createFileTransaction(files);
  try {
    for (const file of files) fs.unlinkSync(file);
    for (const dir of [path.join(root, SCRIPTS_DIR), path.join(root, HOOKS_DIR), path.join(root, PLUGIN_DIR)]) {
      if (fs.existsSync(dir) && fs.readdirSync(dir).length === 0) fs.rmdirSync(dir);
    }
    transaction.commit();
    return { action: "uninstall", removed: plans.map((plan) => plan.relativePath) };
  } catch (error) {
    transaction.rollback(error);
    throw error;
  }
}

module.exports = {
  CONTEXT_SCRIPT,
  HOOKS_DIR,
  PLUGIN_DIR,
  SCRIPTS_DIR,
  installPluginFiles,
  planPluginInstall,
  planPluginUninstall,
  uninstallPluginFiles,
};
