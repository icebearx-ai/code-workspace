"use strict";
const { runHook, runHookStdin, createAdapter } = require("../core/task-coordination-protocol");
module.exports = { provider: "claude", runHook: (input, options) => runHook("claude", input, options), runHookStdin: (options) => runHookStdin("claude", options), createAdapter: (options) => createAdapter("claude", options) };
