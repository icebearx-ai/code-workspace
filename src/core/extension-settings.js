const { WorkspaceError } = require("./errors");
const { readUserConfig, updateUserConfig } = require("./user-config");

const DEFAULT_EXTENSION_REGISTRY = "https://pkg.in.wezhuiyi.com/repository/codew-extensions/";
const DEFAULT_EXTENSION_SCOPE = "@codew-ext";
const DEFAULT_EXTENSION_AUTH_TYPE = "legacy";
const EXTENSION_SETTING_KEYS = Object.freeze({
  "extensions.registry": "registry",
  "extensions.scope": "scope",
  "extensions.auth-type": "authType",
  "@codew-ext:registry": "registry",
  registry: "registry",
  scope: "scope",
  "auth-type": "authType",
});

function settingsError(code, message, details = {}) {
  return new WorkspaceError(code, message, details);
}

function isLoopbackHostname(hostname) {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]" || hostname === "::1";
}

function validateRegistryUrl(value, options = {}) {
  let url;
  try {
    url = new URL(String(value || ""));
  } catch {
    throw settingsError("EXTENSION_REGISTRY_URL_INVALID", "Nexus Registry URL is invalid", { registry: String(value || "") || null });
  }
  if (url.username || url.password || url.search || url.hash) {
    throw settingsError("EXTENSION_REGISTRY_URL_INVALID", "Nexus Registry URL must not contain credentials, query, or fragment", { registryOrigin: url.origin });
  }
  if (url.protocol !== "https:" && !(options.allowLoopback === true && isLoopbackHostname(url.hostname))) {
    throw settingsError("EXTENSION_REGISTRY_URL_INVALID", "Nexus Registry must use HTTPS", { registryOrigin: url.origin });
  }
  const match = url.pathname.match(/^\/repository\/([A-Za-z0-9][A-Za-z0-9._-]*)\/?$/);
  if (!match) {
    throw settingsError("EXTENSION_REGISTRY_URL_INVALID", "Nexus Registry URL must point to /repository/<name>/", {
      registryOrigin: url.origin,
      actualPath: url.pathname,
    });
  }
  url.pathname = `/repository/${match[1]}/`;
  return Object.freeze({ url, registryUrl: url.toString(), registryOrigin: url.origin, repository: match[1] });
}

function normalizeScope(value) {
  const scope = String(value || "").trim();
  if (!/^@[a-z0-9][a-z0-9._-]*$/.test(scope)) {
    throw settingsError("EXTENSION_SCOPE_INVALID", "Extension npm scope must look like @scope", { scope: scope || null });
  }
  return scope;
}

function normalizeAuthType(value) {
  const authType = String(value || "").trim().toLowerCase();
  if (!new Set(["legacy", "web"]).has(authType)) {
    throw settingsError("EXTENSION_AUTH_TYPE_INVALID", "Extension npm auth-type must be legacy or web", { authType: authType || null });
  }
  return authType;
}

function resolveExtensionSettings(options = {}) {
  const document = readUserConfig(options);
  const raw = document.value.extensions && typeof document.value.extensions === "object" && !Array.isArray(document.value.extensions)
    ? document.value.extensions
    : {};
  const configured = {
    registry: Object.prototype.hasOwnProperty.call(raw, "registry"),
    scope: Object.prototype.hasOwnProperty.call(raw, "scope"),
    authType: Object.prototype.hasOwnProperty.call(raw, "authType"),
  };
  const registry = configured.registry ? validateRegistryUrl(raw.registry, options).registryUrl : DEFAULT_EXTENSION_REGISTRY;
  const scope = configured.scope ? normalizeScope(raw.scope) : DEFAULT_EXTENSION_SCOPE;
  const authType = configured.authType ? normalizeAuthType(raw.authType) : DEFAULT_EXTENSION_AUTH_TYPE;
  return Object.freeze({
    file: document.file,
    values: Object.freeze({ registry, scope, authType }),
    configured: Object.freeze(configured),
  });
}

function canonicalSettingKey(key) {
  const canonical = EXTENSION_SETTING_KEYS[String(key || "").trim()];
  if (!canonical) throw settingsError("USER_CONFIG_KEY_INVALID", `Unsupported Code Workspace configuration key: ${key || "<missing>"}`, {
    key: String(key || "") || null,
    supported: Object.keys(EXTENSION_SETTING_KEYS).filter((entry) => entry.startsWith("extensions.")),
  });
  return canonical;
}

function normalizeSettingValue(key, value, options = {}) {
  if (key === "registry") return validateRegistryUrl(value, options).registryUrl;
  if (key === "scope") return normalizeScope(value);
  return normalizeAuthType(value);
}

function listExtensionSettings(options = {}) {
  const settings = resolveExtensionSettings(options);
  return Object.freeze({
    file: settings.file,
    values: Object.freeze({
      "extensions.registry": Object.freeze({ value: settings.values.registry, source: settings.configured.registry ? "user" : "default" }),
      "extensions.scope": Object.freeze({ value: settings.values.scope, source: settings.configured.scope ? "user" : "default" }),
      "extensions.auth-type": Object.freeze({ value: settings.values.authType, source: settings.configured.authType ? "user" : "default" }),
    }),
  });
}

function setExtensionSetting(key, value, options = {}) {
  const canonical = canonicalSettingKey(key);
  const normalized = normalizeSettingValue(canonical, value, options);
  const persisted = updateUserConfig((document) => ({
    ...document,
    extensions: { ...(document.extensions || {}), [canonical]: normalized },
  }), options);
  return resolveExtensionSettings({ ...options, file: persisted.file });
}

function deleteExtensionSetting(key, options = {}) {
  const canonical = canonicalSettingKey(key);
  const persisted = updateUserConfig((document) => {
    const extensions = { ...(document.extensions || {}) };
    delete extensions[canonical];
    return { ...document, ...(Object.keys(extensions).length > 0 ? { extensions } : { extensions: undefined }) };
  }, options);
  return resolveExtensionSettings({ ...options, file: persisted.file });
}

module.exports = {
  DEFAULT_EXTENSION_AUTH_TYPE,
  DEFAULT_EXTENSION_REGISTRY,
  DEFAULT_EXTENSION_SCOPE,
  EXTENSION_SETTING_KEYS,
  canonicalSettingKey,
  deleteExtensionSetting,
  listExtensionSettings,
  normalizeAuthType,
  normalizeScope,
  resolveExtensionSettings,
  setExtensionSetting,
  validateRegistryUrl,
};
