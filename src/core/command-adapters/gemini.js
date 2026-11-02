"use strict";

const path = require("node:path");

const geminiAdapter = {
  toolId: "gemini",
  skillsDir: ".gemini/skills",
  commandsDir: ".gemini/commands/codew",
  hook: {
    supported: true,
    configPath: path.join(".gemini", "hooks.json"),
    outputFormat: "additionalContext",
    envVar: "GEMINI_PLUGIN_ROOT",
  },
  getCommandPath(commandId) {
    return path.join(".gemini", "commands", "codew", `${commandId}.toml`);
  },
  formatCommand(content) {
    return `description = "${content.description}"

prompt = """
${content.body}
"""
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

module.exports = { geminiAdapter };
