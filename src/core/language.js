const fs = require("node:fs");
const path = require("node:path");

const yaml = require("js-yaml");

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

function parseContextLanguage(context, options = {}) {
  const text = String(context || "");
  const current = text.match(/^Language:\s*([^\s]+)\s*$/m);
  if (current) return { language: normalizeLanguage(current[1]), legacy: false };
  if (options.allowLegacy !== false && /^语言：中文（简体）\s*$/m.test(text)) {
    return { language: "zh-CN", legacy: true };
  }
  return null;
}

function readOpenSpecLanguage(root, options = {}) {
  const file = path.join(root, "openspec", "config.yaml");
  if (!fs.existsSync(file)) {
    if (options.required === false) return null;
    throw new WorkspaceError("OPENSPEC_CONFIG_MISSING", `Missing OpenSpec config: ${file}`, { file });
  }
  const config = yaml.load(fs.readFileSync(file, "utf8")) || {};
  const parsed = parseContextLanguage(config.context, options);
  if (parsed) return { ...parsed, source: "openspec/config.yaml", file };
  if (options.required === false) return null;
  throw new WorkspaceError("OPENSPEC_LANGUAGE_MISSING", "OpenSpec context does not declare a supported `Language: <language>` value");
}

function stateLanguage(root) {
  const value = loadState(root)?.workspaceLanguage;
  if (!value) return null;
  return normalizeLanguage(value);
}

function legacyWorkspaceLanguageSelection(root) {
  const previous = stateLanguage(root);
  const configured = readOpenSpecLanguage(root, { required: false, allowLegacy: true });
  if (previous && configured && previous !== configured.language) {
    throw new WorkspaceError("WORKSPACE_LANGUAGE_CONFLICT", `Legacy workspace language sources conflict: state.json=${previous}, openspec/config.yaml=${configured.language}.`, {
      stateLanguage: previous,
      openSpecLanguage: configured.language,
      remediation: `Re-run openspec-w update --language <${SUPPORTED_LANGUAGES.map((entry) => entry.value).join("|")}> to choose explicitly.`,
    });
  }
  const language = previous || configured?.language || null;
  if (!language) return null;
  return {
    language,
    source: previous && configured ? "legacy-state+openspec-context" : previous ? "legacy-state" : "openspec-context",
    legacy: true,
    evidence: {
      ...(previous ? { state: { file: statePath(root), language: previous } } : {}),
      ...(configured ? { openspec: configured } : {}),
    },
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
  parseContextLanguage,
  readOpenSpecLanguage,
  resolveWorkspaceLanguage,
  resolveWorkspaceLanguageSelection,
  stateLanguage,
  workspaceGuide,
};
