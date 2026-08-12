function createInitPlan({ root, workspace, tools, monitor, language }) {
  return {
    root,
    workspace,
    tools: tools.slice(),
    monitor: { ...monitor },
    language,
  };
}

module.exports = { createInitPlan };
