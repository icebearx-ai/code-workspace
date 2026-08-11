const fs = require("node:fs");
const path = require("node:path");

const LOCALES_DIRECTORY = path.join(__dirname, "locales");
const LOCALES = Object.freeze(
  fs.readdirSync(LOCALES_DIRECTORY)
    .filter((file) => file.endsWith(".js"))
    .sort()
    .map((file) => require(path.join(LOCALES_DIRECTORY, file)))
    .sort((left, right) => left.code.localeCompare(right.code))
);
const LOCALES_BY_CODE = new Map(LOCALES.map((locale) => [locale.code, locale]));
const LANGUAGE_CODES = Object.freeze(LOCALES.map((locale) => locale.code));
const LANGUAGE_OPTIONS = Object.freeze(LOCALES.map((locale) => Object.freeze({
  value: locale.code,
  label: locale.label,
})));

if (LOCALES_BY_CODE.size !== LOCALES.length) throw new Error("Duplicate locale code in i18n registry");
if (LOCALES.length === 0) throw new Error("At least one locale must be registered");
for (const locale of LOCALES) {
  if (!locale?.code || !/^[A-Za-z0-9-]+$/.test(locale.code) || !locale.label || !locale.projectContext) {
    throw new Error(`Invalid locale definition: ${locale?.code || "<missing>"}`);
  }
}
const defaults = LOCALES.filter((locale) => locale.default === true);
if (defaults.length !== 1) throw new Error("Exactly one locale must be the default");
const DEFAULT_LANGUAGE_CODE = defaults[0].code;

function getLocale(code) {
  const locale = LOCALES_BY_CODE.get(String(code || "").trim());
  if (!locale) throw new Error(`Unsupported locale: ${code || "<missing>"}`);
  return locale;
}

module.exports = {
  DEFAULT_LANGUAGE_CODE,
  LANGUAGE_CODES,
  LANGUAGE_OPTIONS,
  LOCALES,
  getLocale,
};
