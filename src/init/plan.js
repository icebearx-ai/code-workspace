function createInitPlan({ root, workspace, tools, language }) {
  return {
    root,
    workspace,
    tools: tools.slice(),
    language,
  };
}

module.exports = { createInitPlan };
