const fs = require("node:fs");
const path = require("node:path");

const { configPath, loadConfigProjection, loadState, statePath } = require("./config");
const { WorkspaceError } = require("./errors");
const { DEFAULT_LANGUAGE_CODE, LANGUAGE_OPTIONS, getLocale } = require("../i18n");

const DEFAULT_WORKSPACE_LANGUAGE = DEFAULT_LANGUAGE_CODE;
const PACKAGE_ROOT = path.resolve(__dirname, "..", "..");
const SUPPORTED_LANGUAGES = LANGUAGE_OPTIONS;
const SUPPORTED_LANGUAGE_VALUES = new Set(SUPPORTED_LANGUAGES.map((entry) => entry.value));

function normalizeLanguage(value) {
  const language = String(value || "").trim();
  if (!SUPPORTED_LANGUAGE_VALUES.has(language)) {
    throw new WorkspaceError("WORKSPACE_LANGUAGE_INVALID", `Unsupported workspace language: ${language || "<missing>"}; choose ${SUPPORTED_LANGUAGES.map((entry) => entry.value).join(", ")}`, {
      actual: language || null,
      supported: SUPPORTED_LANGUAGES.map((entry) => entry.value),
    });
  }
  return language;
}

function stateLanguage(root) {
  const value = loadState(root)?.workspaceLanguage;
  if (!value) return null;
  return normalizeLanguage(value);
}

function legacyWorkspaceLanguageSelection(root) {
  const previous = stateLanguage(root);
  if (!previous) return null;
  return {
    language: previous,
    source: "legacy-state",
    legacy: true,
    evidence: { state: { file: statePath(root), language: previous } },
  };
}

function legacyWorkspaceLanguage(root) {
  return legacyWorkspaceLanguageSelection(root)?.language || null;
}

function resolveWorkspaceLanguageSelection(root, options = {}) {
  if (options.language !== undefined) {
    return { language: normalizeLanguage(options.language), source: "cli", legacy: false };
  }
  const localConfig = configPath(root);
  if (fs.existsSync(localConfig)) {
    try {
      const configured = loadConfigProjection(root, ["language"]);
      if (configured.workspace?.language) {
        return {
          language: normalizeLanguage(configured.workspace.language),
          source: "workspace-config",
          legacy: false,
          evidence: { file: localConfig },
        };
      }
    } catch (error) {
      if (!options.allowLegacy || error.code !== "WORKSPACE_LANGUAGE_MISSING") throw error;
    }
  }
  if (options.allowLegacy) {
    const previous = legacyWorkspaceLanguageSelection(root);
    if (previous) return previous;
  }
  if (options.defaultLanguage === false) {
    throw new WorkspaceError("WORKSPACE_LANGUAGE_MISSING", "Workspace language is not configured.", {
      remediation: `Re-run openspec-w init . --language <${SUPPORTED_LANGUAGES.map((entry) => entry.value).join("|")}>.`,
    });
  }
  return {
    language: normalizeLanguage(options.defaultLanguage || DEFAULT_WORKSPACE_LANGUAGE),
    source: "default",
    legacy: false,
  };
}

function resolveWorkspaceLanguage(root, options = {}) {
  return resolveWorkspaceLanguageSelection(root, options).language;
}

function workspaceGuide(language) {
  const locale = getLocale(normalizeLanguage(language));
  const file = path.join(PACKAGE_ROOT, "artifacts", "templates", "user-guide", `${locale.code}.md`);
  if (!fs.existsSync(file)) throw new WorkspaceError("WORKSPACE_GUIDE_MISSING", `Missing workspace guide template for locale ${locale.code}: ${file}`, { file, language: locale.code });
  return fs.readFileSync(file, "utf8").trimEnd();
}

module.exports = {
  DEFAULT_WORKSPACE_LANGUAGE,
  SUPPORTED_LANGUAGES,
  normalizeLanguage,
  legacyWorkspaceLanguage,
  legacyWorkspaceLanguageSelection,
  resolveWorkspaceLanguage,
  resolveWorkspaceLanguageSelection,
  stateLanguage,
  workspaceGuide,
};
