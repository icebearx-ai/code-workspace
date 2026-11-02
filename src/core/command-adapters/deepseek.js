"use strict";

const path = require("node:path");

const deepseekAdapter = {
  toolId: "deepseek",
  skillsDir: ".deepseek/skills",
  commandsDir: ".deepseek/prompts",
  hook: {
    supported: true,
    configPath: path.join(".deepseek", "hooks.json"),
    outputFormat: "additionalContext",
    envVar: "DEEPSEEK_PLUGIN_ROOT",
  },
  getCommandPath(commandId) {
    return path.join(".deepseek", "prompts", `codew-${commandId}.md`);
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

module.exports = { deepseekAdapter };
