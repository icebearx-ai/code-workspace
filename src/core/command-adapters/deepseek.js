"use strict";

const path = require("node:path");

const deepseekAdapter = {
  toolId: "deepseek",
  skillsDir: ".deepseek/skills",
  commandsDir: ".deepseek/prompts",
  hookSupport: false,
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
};

module.exports = { deepseekAdapter };
