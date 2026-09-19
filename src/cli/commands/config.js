const {
  canonicalSettingKey,
  deleteExtensionSetting,
  listExtensionSettings,
  resolveExtensionSettings,
  setExtensionSetting,
} = require("../../core/extension-settings");
const { success } = require("../result");

function settingEntries(options = {}) {
  const listed = listExtensionSettings(options);
  return Object.entries(listed.values).map(([key, entry]) => ({ key, value: entry.value, source: entry.source }));
}

function displayKey(canonical) {
  return canonical === "authType" ? "extensions.auth-type" : `extensions.${canonical}`;
}

function executeConfig(invocation) {
  const action = invocation.definition.path[1];
  const options = invocation.dependencies || {};
  if (action === "list") {
    const entries = settingEntries(options);
    return success("config.list", { file: listExtensionSettings(options).file, settings: entries }, entries.map((entry) => `${entry.key}=${entry.value} (${entry.source})`).join("\n"));
  }
  if (action === "get") {
    if (!invocation.args[0]) {
      const entries = settingEntries(options);
      return success("config.get", { file: listExtensionSettings(options).file, settings: entries }, entries.map((entry) => `${entry.key}=${entry.value} (${entry.source})`).join("\n"));
    }
    const key = canonicalSettingKey(invocation.args[0]);
    const settings = resolveExtensionSettings(options);
    const field = key === "authType" ? "authType" : key;
    const value = settings.values[field];
    const source = settings.configured[field] ? "user" : "default";
    return success("config.get", { file: settings.file, key: displayKey(key), value, source }, `${value}`);
  }
  if (action === "set") {
    const settings = setExtensionSetting(invocation.args[0], invocation.args[1], options);
    const canonical = canonicalSettingKey(invocation.args[0]);
    const key = displayKey(canonical);
    return success("config.set", { file: settings.file, key, value: settings.values[canonical] }, `Set ${key}=${settings.values[canonical]}`);
  }
  const settings = deleteExtensionSetting(invocation.args[0], options);
  const canonical = canonicalSettingKey(invocation.args[0]);
  const key = displayKey(canonical);
  return success("config.delete", { file: settings.file, key, value: settings.values[canonical], source: "default" }, `Reset ${key} to ${settings.values[canonical]}`);
}

module.exports = { executeConfig };
