"use strict";

module.exports = {
  ...require("./adapters"),
  codexTaskCoordination: require("./codex-task-coordination"),
  claudeTaskCoordination: require("./claude-task-coordination"),
};
