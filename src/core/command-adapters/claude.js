"use strict";

const path = require("node:path");

const claudeAdapter = {
  toolId: "claude",
  skillsDir: ".claude/skills",
  commandsDir: ".claude/commands/codew",
  hookSupport: true,
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
};

module.exports = { claudeAdapter };
