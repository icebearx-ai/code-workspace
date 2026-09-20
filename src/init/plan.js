function createInitPlan({ root, workspace, tools, language, extensions = [], extensionRemovals = [] }) {
  return {
    root,
    workspace,
    tools: tools.slice(),
    language,
    extensions: extensions.slice(),
    extensionRemovals: extensionRemovals.slice(),
  };
}

module.exports = { createInitPlan };
