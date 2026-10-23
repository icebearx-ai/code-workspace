"use strict";

const path = require("node:path");

const geminiAdapter = {
  toolId: "gemini",
  skillsDir: ".gemini/skills",
  commandsDir: ".gemini/commands/codew",
  hookSupport: false,
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
};

module.exports = { geminiAdapter };
