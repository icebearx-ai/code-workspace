const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");

const { resolveNexusProviderConfiguration } = require("../core/nexus-extension-provider");
const { userConfigPath } = require("../core/user-config");

const cli = path.resolve(__dirname, "..", "..", "bin", "code-workspace.js");

function temporaryRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "code-workspace-config-command-"));
}

function run(file, args) {
  return spawnSync(process.execPath, [cli, ...args], {
    env: { ...process.env, CODE_WORKSPACE_CONFIG: file },
    cwd: os.tmpdir(),
    encoding: "utf8",
  });
}

function json(result) {
  return JSON.parse(result.stdout);
}

test("config commands manage user-level extension settings without a Workspace", () => {
  const root = temporaryRoot();
  const file = path.join(root, "config.json");
  try {
    assert.equal(userConfigPath({ home: root }), path.join(root, ".code-workspace", "config.json"));
    const defaults = run(file, ["config", "list", "--json"]);
    assert.equal(defaults.status, 0, defaults.stderr);
    assert.equal(json(defaults).data.settings[0].value, "https://pkg.in.wezhuiyi.com/repository/codew-extensions/");

    const setRegistry = run(file, ["config", "set", "extensions.registry", "https://nexus.example.com/repository/extensions/", "--json"]);
    assert.equal(setRegistry.status, 0, setRegistry.stderr);
    const setScope = run(file, ["config", "set", "extensions.scope", "@acme-ext", "--json"]);
    assert.equal(setScope.status, 0, setScope.stderr);
    const setAuth = run(file, ["config", "set", "extensions.auth-type", "web", "--json"]);
    assert.equal(setAuth.status, 0, setAuth.stderr);

    const getAlias = run(file, ["config", "get", "@codew-ext:registry", "--json"]);
    assert.equal(json(getAlias).data.value, "https://nexus.example.com/repository/extensions/");
    const listed = json(run(file, ["config", "list", "--json"]));
    assert.deepEqual(listed.data.settings.map((entry) => [entry.key, entry.value, entry.source]), [
      ["extensions.registry", "https://nexus.example.com/repository/extensions/", "user"],
      ["extensions.scope", "@acme-ext", "user"],
      ["extensions.auth-type", "web", "user"],
    ]);

    const deleted = run(file, ["config", "delete", "extensions.scope", "--json"]);
    assert.equal(deleted.status, 0, deleted.stderr);
    assert.equal(json(run(file, ["config", "get", "extensions.scope", "--json"])).data.value, "@codew-ext");
    assert.equal(JSON.stringify(JSON.parse(fs.readFileSync(file, "utf8"))).includes("token"), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
test("Nexus provider consumes Code Workspace settings and keeps npm credentials separate", async () => {
  const root = temporaryRoot();
  const file = path.join(root, "config.json");
  fs.writeFileSync(file, JSON.stringify({
    schemaVersion: 1,
    extensions: {
      registry: "https://nexus.example.com/repository/extensions/",
      scope: "@acme-ext",
      authType: "web",
    },
  }));
  try {
    const configuration = await resolveNexusProviderConfiguration({
      file,
      home: root,
      defaultRegistryUrl: null,
      environment: {},
    });
    assert.equal(configuration.registryUrl, "https://nexus.example.com/repository/extensions/");
    assert.equal(configuration.scope, "@acme-ext");
    assert.equal(configuration.authType, "web");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
