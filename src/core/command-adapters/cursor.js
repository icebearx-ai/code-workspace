"use strict";

const path = require("node:path");

const cursorAdapter = {
  toolId: "cursor",
  skillsDir: ".cursor/skills",
  commandsDir: ".cursor/commands",
  hookSupport: false,
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
};

module.exports = { cursorAdapter };
