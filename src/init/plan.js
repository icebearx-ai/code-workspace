function createInitPlan({ root, workspace, tools, monitor, language, extensions = [] }) {
  return {
    root,
    workspace,
    tools: tools.slice(),
    monitor: { ...monitor },
    language,
    extensions: extensions.slice(),
  };
}

module.exports = { createInitPlan };
