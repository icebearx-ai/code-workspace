"use strict";

const path = require("node:path");

const windsurfAdapter = {
  toolId: "windsurf",
  skillsDir: ".windsurf/skills",
  commandsDir: ".windsurf/workflows",
  hook: {
    supported: true,
    configPath: path.join(".windsurf", "hooks.json"),
    outputFormat: "additionalContext",
    envVar: "WINDSURF_PLUGIN_ROOT",
  },
  getCommandPath(commandId) {
    return path.join(".windsurf", "workflows", `codew-${commandId}.md`);
  },
  formatCommand(content) {
    return `${content.body}\n`;
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

module.exports = { windsurfAdapter };
