"use strict";
const { runHook, runHookStdin, createAdapter } = require("../core/task-coordination-protocol");
module.exports = { provider: "codex", runHook: (input, options) => runHook("codex", input, options), runHookStdin: (options) => runHookStdin("codex", options), createAdapter: (options) => createAdapter("codex", options) };
