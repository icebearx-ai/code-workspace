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
  hookSupport: false,
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
};

module.exports = { codexAdapter };
