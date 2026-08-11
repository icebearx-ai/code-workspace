const fs = require("node:fs");

const {
  CURRENT_CONFIG_VERSION,
  configPath,
  loadState,
  planConfigMigration,
  readConfigDocument,
  statePath,
} = require("./config");
const { resolveWorkspaceLanguageSelection } = require("./language");

function planWorkspaceMaintenance(root, options = {}) {
  const localConfig = configPath(root);
  const hasConfig = fs.existsSync(localConfig);
  const document = hasConfig ? readConfigDocument(root) : null;
  const schema = document ? planConfigMigration(document.value) : {
    fromVersion: null,
    toVersion: CURRENT_CONFIG_VERSION,
    steps: [],
    changed: false,
    value: null,
  };
  const language = resolveWorkspaceLanguageSelection(root, options);
  const configuredLanguage = document?.value?.workspace?.language || null;
  const languageChanged = configuredLanguage !== language.language;
  const state = loadState(root);
  const removeLegacyStateLanguage = Boolean(state && Object.prototype.hasOwnProperty.call(state, "workspaceLanguage"));
  const steps = [
    ...schema.steps.map((step) => ({ id: `config-schema-${step.fromVersion}-to-${step.toVersion}`, kind: "config-schema", ...step })),
    ...(languageChanged ? [{
      id: configuredLanguage ? "change-workspace-language" : "set-workspace-language",
      kind: "workspace-language",
      from: configuredLanguage,
      to: language.language,
      source: language.source,
    }] : []),
    ...(removeLegacyStateLanguage ? [{
      id: "remove-legacy-state-language",
      kind: "state-cleanup",
      target: "workspaceLanguage",
    }] : []),
  ];
  const writeTargets = [
    ...(schema.changed || languageChanged ? [localConfig] : []),
    ...(removeLegacyStateLanguage ? [statePath(root)] : []),
  ];
  return {
    schema: {
      fromVersion: schema.fromVersion,
      toVersion: schema.toVersion,
      changed: schema.changed,
      steps: schema.steps,
    },
    language: {
      value: language.language,
      source: language.source,
      legacy: language.legacy === true,
      changed: languageChanged,
      ...(language.evidence ? { evidence: language.evidence } : {}),
    },
    steps,
    writeTargets: [...new Set(writeTargets)],
    changed: steps.length > 0,
  };
}

module.exports = { planWorkspaceMaintenance };
