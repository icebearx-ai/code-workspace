function openSpecAction(detected, selectedVersion) {
  if (detected.globalVersion === selectedVersion && detected.commandVersion === selectedVersion) return "skip";
  if (!detected.globalVersion && !detected.commandVersion) return "install";
  if (detected.globalVersion !== detected.commandVersion) return "repair";
  return "switch";
}

function createInitPlan({ root, workspace, detected, selectedVersion, tools, monitor, language }) {
  return {
    root,
    workspace,
    openspec: {
      detectedVersion: detected.commandVersion || detected.globalVersion || null,
      selectedVersion,
      action: openSpecAction(detected, selectedVersion),
      scope: "global",
    },
    tools: tools.slice(),
    monitor: { ...monitor },
    language,
  };
}

module.exports = { createInitPlan, openSpecAction };
