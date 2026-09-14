function createInitPlan({ root, workspace, tools, language, extensions = [] }) {
  return {
    root,
    workspace,
    tools: tools.slice(),
    language,
    extensions: extensions.slice(),
  };
}

module.exports = { createInitPlan };
