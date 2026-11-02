"use strict";

const os = require("node:os");
const path = require("node:path");

function getCodexHome() {
  const envHome = process.env.CODEX_HOME?.trim();
  return path.resolve(envHome ? envHome : path.join(os.homedir(), ".codex"));
}

const codexAdapter = {
  toolId: "codex",
  skillsDir: ".codex/skills",
  commandsDir: null,
  hook: {
    supported: true,
    configPath: path.join(".codex", "hooks.json"),
    outputFormat: "additionalContext",
    envVar: "CODEX_HOME",
  },
  getCommandPath(commandId) {
    return path.join(getCodexHome(), "prompts", `codew-${commandId}.md`);
  },
  formatCommand(content) {
    return `---
description: ${content.description}
argument-hint: command arguments
---

${content.body}
`;
  },
  getHookConfig(contextScriptRelativePath) {
    return {
      hooks: {
        SessionStart: [
          {
            hooks: [
              {
                type: "command",
                command: `bash "./${contextScriptRelativePath}"`,
              },
            ],
          },
        ],
      },
    };
  },
  formatContextOutput(contextData) {
    const context = JSON.stringify(contextData).replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n");
    return JSON.stringify({ additionalContext: context });
  },
};

module.exports = { codexAdapter };
