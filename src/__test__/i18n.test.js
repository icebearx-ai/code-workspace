const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const { LOCALES, getLocale, interpolate } = require("../i18n");

function leafKeys(value, prefix = "") {
  return Object.entries(value).flatMap(([key, entry]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    if (entry && typeof entry === "object" && !Array.isArray(entry)) return leafKeys(entry, path);
    return [path];
  });
}

test("locale resources expose the same translation keys", () => {
  assert(LOCALES.length > 0);
  assert.equal(new Set(LOCALES.map((locale) => locale.code)).size, LOCALES.length);
  const metadata = new Set(["code", "label", "default"]);
  const expected = leafKeys(LOCALES[0]).filter((key) => !metadata.has(key));
  for (const locale of LOCALES) {
    assert.deepEqual(
      leafKeys(locale).filter((key) => !metadata.has(key)),
      expected,
      locale.code
    );
  }
});

test("each locale has a workspace guide named after its language code", () => {
  for (const locale of LOCALES) {
    assert(fs.existsSync(path.join(__dirname, "..", "..", "artifacts", "templates", "user-guide", `${locale.code}.md`)), locale.code);
  }
});

test("locale resources are plain data and support named interpolation", () => {
  assert.deepEqual(JSON.parse(JSON.stringify(LOCALES)), LOCALES);
  assert.equal(interpolate("{known} {missing}", { known: "ok" }), "ok {missing}");
});
