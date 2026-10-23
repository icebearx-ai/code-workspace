"use strict";

const path = require("node:path");

const windsurfAdapter = {
  toolId: "windsurf",
  skillsDir: ".windsurf/skills",
  commandsDir: ".windsurf/workflows",
  hookSupport: false,
  getCommandPath(commandId) {
    return path.join(".windsurf", "workflows", `codew-${commandId}.md`);
  },
  formatCommand(content) {
    return `${content.body}\n`;
  },
};

module.exports = { windsurfAdapter };
