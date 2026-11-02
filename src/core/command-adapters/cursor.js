"use strict";

const path = require("node:path");

const cursorAdapter = {
  toolId: "cursor",
  skillsDir: ".cursor/skills",
  commandsDir: ".cursor/commands",
  hook: {
    supported: true,
    configPath: path.join(".cursor", "hooks.json"),
    outputFormat: "additional_context",
    envVar: "CURSOR_PLUGIN_ROOT",
  },
  getCommandPath(commandId) {
    return path.join(".cursor", "commands", `codew-${commandId}.md`);
  },
  formatCommand(content) {
    return `---
name: /codew-${content.name}
id: codew-${content.name}
category: ${content.category || "workspace"}
description: ${content.description}
---

${content.body}
`;
  },
  getHookConfig(contextScriptRelativePath) {
    return {
      version: 1,
      hooks: {
        sessionStart: [
          {
            command: `./${contextScriptRelativePath}`,
          },
        ],
      },
    };
  },
  formatContextOutput(contextData) {
    const context = JSON.stringify(contextData).replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n");
    return JSON.stringify({ additional_context: context });
  },
};

module.exports = { cursorAdapter };
