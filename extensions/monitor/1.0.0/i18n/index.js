const fs = require("node:fs");
const path = require("node:path");

const LOCALES_DIRECTORY = path.join(__dirname, "locales");
const MONITOR_LOCALES = Object.freeze(
  fs.readdirSync(LOCALES_DIRECTORY)
    .filter((file) => file.endsWith(".js"))
    .sort()
    .map((file) => require(path.join(LOCALES_DIRECTORY, file)))
    .sort((left, right) => left.code.localeCompare(right.code))
);
const LOCALES_BY_CODE = new Map(MONITOR_LOCALES.map((locale) => [locale.code, locale]));

if (MONITOR_LOCALES.length === 0) throw new Error("At least one monitor locale must be registered");
if (LOCALES_BY_CODE.size !== MONITOR_LOCALES.length) throw new Error("Duplicate monitor locale code");
for (const locale of MONITOR_LOCALES) {
  if (!locale?.code || !locale.label || !locale.messages) throw new Error(`Invalid monitor locale: ${locale?.code || "<missing>"}`);
}
const defaults = MONITOR_LOCALES.filter((locale) => locale.default === true);
if (defaults.length !== 1) throw new Error("Exactly one monitor locale must be the default");

const DEFAULT_MONITOR_LANGUAGE = defaults[0].code;
const MONITOR_MESSAGES = Object.freeze(Object.fromEntries(
  MONITOR_LOCALES.map((locale) => [locale.code, locale.messages])
));

function getMonitorLocale(code) {
  const locale = LOCALES_BY_CODE.get(String(code || "").trim());
  if (!locale) throw new Error(`Unsupported monitor locale: ${code || "<missing>"}`);
  return locale;
}

module.exports = { DEFAULT_MONITOR_LANGUAGE, MONITOR_LOCALES, MONITOR_MESSAGES, getMonitorLocale };
