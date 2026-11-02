"use strict";

const path = require("node:path");

const claudeAdapter = {
  toolId: "claude",
  skillsDir: ".claude/skills",
  commandsDir: ".claude/commands/codew",
  hook: {
    supported: true,
    configPath: path.join(".claude-plugin", "plugin.json"),
    outputFormat: "hookSpecificOutput",
    envVar: "CLAUDE_PLUGIN_ROOT",
  },
  getCommandPath(commandId) {
    return path.join(".claude", "commands", "codew", `${commandId}.md`);
  },
  formatCommand(content) {
    return `---
name: ${content.name}
description: ${content.description}
category: ${content.category || "workspace"}
---

${content.body}
`;
  },
  getHookConfig(contextScriptRelativePath) {
    return {
      name: "code-workspace",
      description: "Code Workspace agent integration for local multi-project management",
      version: "1.0.0",
      hooks: {
        SessionStart: [
          {
            hooks: [
              {
                type: "command",
                command: `bash "\${CLAUDE_PLUGIN_ROOT}/${contextScriptRelativePath}"`,
              },
            ],
          },
        ],
      },
    };
  },
  formatContextOutput(contextData) {
    const context = JSON.stringify(contextData).replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n");
    return JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "SessionStart",
        additionalContext: context,
      },
    });
  },
};

module.exports = { claudeAdapter };
