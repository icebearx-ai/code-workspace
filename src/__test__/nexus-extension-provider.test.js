const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const { EventEmitter } = require("node:events");
const os = require("node:os");
const path = require("node:path");
const { Readable } = require("node:stream");
const test = require("node:test");
const tar = require("tar");

const { sha256 } = require("../core/fs");
const { directoryDigest } = require("../core/directory-digest");
const {
  EXTENSION_PACKAGE_PREFIX,
  collectPackageFiles,
  inspectExtensionTransportTarball,
  packExtensionToDirectory,
} = require("../core/extension-package");
const { createBuiltinExtensionPackageProvider } = require("../core/extension-package-providers");
const { resolveExtensionRuntime } = require("../core/extension-runtime");
const {
  discoverExtensions,
  emptyExtensionState,
  executeExtension,
  loadExtensionState,
  resolveExtensionPlans,
} = require("../core/extensions");
const {
  createNexusExtensionPackageProvider,
  resolveNexusProviderConfiguration,
  validateRegistryUrl,
} = require("../core/nexus-extension-provider");
const {
  gcExtensionPackages,
  ensureStoredExtensionPackage,
  addPackageReference,
  loadStoreRegistry,
  packageRoot,
  removeWorkspaceReference,
} = require("../core/extension-store");

function temporaryRoot(prefix = "code-workspace-nexus-provider-") {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function writeExtension(root, options = {}) {
  const id = options.id || "example-extension";
  const version = options.version || "1.0.0";
  const init = options.init || "// initialization code\n";
  const runtime = options.runtime === undefined ? null : options.runtime;
  const manifest = {
    schemaVersion: 3,
    extensionSpecVersion: options.extensionSpecVersion || 1,
    experimental: true,
    id,
    name: options.name || "Example Extension",
    description: options.description || "Example extension summary.",
    version,
    entry: "init.js",
    entrySha256: sha256(Buffer.from(init, "utf8")),
    timeoutMs: 1000,
    outputs: [{ id: "skill", kind: "file", ownership: "exclusive", target: `.example/${id}.txt` }],
    ...(runtime ? { runtime } : {}),
  };
  fs.mkdirSync(root, { recursive: true });
  fs.writeFileSync(path.join(root, "init.js"), init);
  if (runtime) fs.writeFileSync(path.join(root, runtime.entry), options.runtimeEntry || "module.exports = () => {};\n");
  fs.writeFileSync(path.join(root, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}

function extensionRuntime(entry = "runtime.js", entrySha256) {
  const content = "module.exports = () => {};\n";
  return {
    runtimeProtocolVersion: 1,
    entry,
    entrySha256: entrySha256 || sha256(Buffer.from(content, "utf8")),
    scope: "workspace",
    mode: "oneshot",
    timeoutMs: 1000,
    maxOutputBytes: 4096,
  };
}

async function writeTransportTarball(source, target, envelope) {
  const staging = temporaryRoot("code-workspace-transport-");
  try {
    fs.mkdirSync(path.join(staging, "package", "extension"), { recursive: true });
    fs.writeFileSync(path.join(staging, "package", "package.json"), `${JSON.stringify(envelope, null, 2)}\n`);
    for (const file of collectPackageFiles(source)) {
      const destination = path.join(staging, EXTENSION_PACKAGE_PREFIX, file.relative);
      fs.mkdirSync(path.dirname(destination), { recursive: true });
      fs.copyFileSync(file.absolute, destination);
    }
    await tar.c({
      file: target,
      cwd: staging,
      portable: false,
      mtime: new Date(0),
      noDirRecurse: true,
      jobs: 1,
      sync: true,
    }, ["package/package.json", ...collectPackageFiles(source).map((file) => `${EXTENSION_PACKAGE_PREFIX}/${file.relative}`)]);
  } finally {
    fs.rmSync(staging, { recursive: true, force: true });
  }
}

class LocalHttpFixture extends EventEmitter {
  constructor(handler) {
    super();
    this.handler = handler;
    this.fetch = async (url, options = {}) => {
      const parsed = new URL(url);
      const request = {
        url: `${parsed.pathname}${parsed.search}`,
        method: options.method || "GET",
        headers: options.headers || {},
      };
      let status = 200;
      const headers = {};
      const chunks = [];
      let ended = false;
      const response = {
        writeHead(code, responseHeaders = {}) {
          status = code;
          Object.assign(headers, responseHeaders);
          return this;
        },
        write(chunk) {
          chunks.push(Buffer.from(chunk));
          return true;
        },
        end(chunk) {
          if (chunk !== undefined) chunks.push(Buffer.from(chunk));
          ended = true;
        },
      };
      this.handler(request, response);
      if (!ended) throw new Error(`Fixture handler did not end response: ${request.url}`);
      const body = Buffer.concat(chunks);
      return {
        status,
        ok: status >= 200 && status < 300,
        headers: new Map(Object.entries(headers)),
        body: Readable.from(body),
        async buffer() { return body; },
      };
    };
  }

  listen() {
    setImmediate(() => this.emit("listening"));
    return this;
  }

  close(callback) {
    setImmediate(() => callback?.());
  }

  address() {
    return { address: "127.0.0.1", family: "IPv4", port: 54321 };
  }
}

function startFixture(t, handler) {
  const server = new LocalHttpFixture(handler);
  server.listen(0, "127.0.0.1");
  t.after(() => new Promise((resolve) => server.close(resolve)));
  return server;
}

function json(response, value, status = 200, headers = {}) {
  const body = Buffer.from(`${JSON.stringify(value)}\n`);
  response.writeHead(status, { "content-type": "application/json", "content-length": body.length, ...headers });
  response.end(body);
}

async function preparePackage(options = {}) {
  const source = temporaryRoot();
  const output = temporaryRoot();
  writeExtension(source, {
    id: options.id || "example-extension",
    version: options.version || "1.0.0",
    ...(options.init ? { init: options.init } : {}),
    ...(options.runtime ? { runtime: options.runtime, runtimeEntry: options.runtimeEntry } : {}),
  });
  const packed = await packExtensionToDirectory(source, output);
  const inspectedTarball = await inspectExtensionTransportTarball(packed.tarball.path);
  return { source, output, packed, inspectedTarball };
}

function writeUserConfig(home, registryUrl, token = "nexus-token") {
  fs.mkdirSync(home, { recursive: true });
  const scoped = `//${new URL(registryUrl).host}${new URL(registryUrl).pathname}`;
  fs.writeFileSync(path.join(home, ".npmrc"), [
    `${"@codew-ext:registry"}=${registryUrl}`,
    `${scoped}:_authToken=${token}`,
    "",
  ].join("\n"));
}

async function providerFor(t, server, options = {}) {
  const registryUrl = `http://127.0.0.1:${server.address().port}/repository/extensions/`;
  const home = temporaryRoot("code-workspace-nexus-home-");
  writeUserConfig(home, registryUrl);
  const provider = await createNexusExtensionPackageProvider({
    home,
    allowLoopback: true,
    fetch: server.fetch,
    ...options,
  });
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  return { provider, registryUrl };
}

test("Nexus registry configuration allows HTTPS and explicit loopback fixtures only", async () => {
  assert.equal(validateRegistryUrl("https://nexus.example.com/repository/extensions/").repository, "extensions");
  assert.throws(() => validateRegistryUrl("https://nexus.example.com/npm/"), (error) => error.code === "EXTENSION_REGISTRY_URL_INVALID");
  assert.throws(() => validateRegistryUrl("http://127.0.0.1:4873/repository/extensions/"), (error) => error.code === "EXTENSION_REGISTRY_URL_INVALID");
  assert.equal(validateRegistryUrl("http://127.0.0.1:4873/repository/extensions/", { allowLoopback: true }).repository, "extensions");

  const home = temporaryRoot();
  writeUserConfig(home, "https://nexus.example.com/repository/extensions/");
  const configuration = await resolveNexusProviderConfiguration({ home });
  assert.equal(configuration.repository, "extensions");
  assert.equal(configuration.hasCredentials, true);
  assert.equal(configuration.credentials.forUrl("https://nexus.example.com/repository/extensions/@codew-ext%2Fexample", "registry"), "Bearer nexus-token");
  assert.equal(configuration.credentials.forUrl("https://evil.example.com/repository/extensions/@codew-ext%2Fexample", "registry"), null);
  fs.rmSync(home, { recursive: true, force: true });
});

test("Provider reads only the user-level npm config and imports a verified Nexus package", async (t) => {
  const fixture = await preparePackage();
  t.after(() => {
    fs.rmSync(fixture.source, { recursive: true, force: true });
    fs.rmSync(fixture.output, { recursive: true, force: true });
  });
  const requests = [];
  const server = startFixture(t, (request, response) => {
    requests.push({ url: request.url, authorization: request.headers.authorization });
    if (request.url.startsWith("/repository/extensions/") && !request.url.endsWith(".tgz")) {
      json(response, {
        _id: "@codew-ext/example-extension",
        name: "@codew-ext/example-extension",
        versions: {
          "1.0.0": {
            ...fixture.inspectedTarball.envelope,
            dist: {
              tarball: `http://127.0.0.1:${server.address().port}/repository/extensions/codew-ext-example-extension-1.0.0.tgz`,
              integrity: fixture.packed.tarball.integrity,
            },
          },
        },
      });
      return;
    }
    if (request.url === "/repository/extensions/codew-ext-example-extension-1.0.0.tgz") {
      const body = fs.readFileSync(fixture.packed.tarball.path);
      response.writeHead(200, { "content-type": "application/octet-stream", "content-length": body.length });
      response.end(body);
      return;
    }
    response.writeHead(404);
    response.end();
  });
  await new Promise((resolve) => server.on("listening", resolve));

  const workspace = temporaryRoot();
  fs.writeFileSync(path.join(workspace, ".npmrc"), "@codew-ext:registry=https://evil.example.com/repository/extensions/\n");
  t.after(() => fs.rmSync(workspace, { recursive: true, force: true }));
  const store = temporaryRoot();
  t.after(() => fs.rmSync(store, { recursive: true, force: true }));
  const { provider } = await providerFor(t, server, { storeRoot: store });
  const record = await provider.import("example-extension", "1.0.0");
  assert.equal(record.packageSha256, fixture.packed.packageSha256);
  assert.equal(record.provenance.kind, "nexus-npm");
  assert.equal(record.provenance.packageName, "@codew-ext/example-extension");
  assert.equal(record.provenance.archiveIntegrity, fixture.packed.tarball.integrity);
  assert.equal(directoryDigest(packageRoot(store, "example-extension", "1.0.0")), fixture.packed.packageSha256);
  assert(requests.length >= 2);
  assert(requests.every((entry) => entry.authorization === "Bearer nexus-token"));
  const registryText = fs.readFileSync(path.join(store, ".registry.json"), "utf8");
  assert.doesNotMatch(registryText, /nexus-token|Authorization|npmrc/i);
  addPackageReference(store, "example-extension", "1.0.0", "workspaces", "/workspace-a");
  assert.deepEqual(gcExtensionPackages(store).removed, []);
  removeWorkspaceReference(store, "example-extension", "1.0.0", "/workspace-a");
  assert.deepEqual(gcExtensionPackages(store).removed, ["example-extension@1.0.0"]);
  assert.equal(loadStoreRegistry(store).packages["example-extension@1.0.0"], undefined);
});

test("Provider validates exact packument identity, deprecation, and SHA-512 metadata", async (t) => {
  const fixture = await preparePackage();
  t.after(() => {
    fs.rmSync(fixture.source, { recursive: true, force: true });
    fs.rmSync(fixture.output, { recursive: true, force: true });
  });
  let versions;
  const makeVersions = () => Object.fromEntries(["1.0.1", "1.0.2", "1.0.3"].map((version, index) => [version, {
      ...fixture.inspectedTarball.envelope,
      version,
      deprecated: "broken",
      dist: { tarball: `http://127.0.0.1:${server.address().port}/repository/extensions/deprecated.tgz`, integrity: fixture.packed.tarball.integrity },
      ...(index === 1 ? { deprecated: undefined, dist: { tarball: `http://127.0.0.1:${server.address().port}/repository/extensions/sha1.tgz`, shasum: "a".repeat(40) } } : {}),
      ...(index === 2 ? { deprecated: undefined, dist: { tarball: "https://evil.example.com/repository/extensions/foreign.tgz", integrity: fixture.packed.tarball.integrity } } : {}),
    }]));
  const server = startFixture(t, (request, response) => {
    json(response, { name: "@codew-ext/example-extension", versions });
  });
  await new Promise((resolve) => server.on("listening", resolve));
  versions = makeVersions();
  const { provider } = await providerFor(t, server);
  await assert.rejects(provider.getPackageCandidate("example-extension", "1.0.1"), (error) => error.code === "EXTENSION_REGISTRY_PACKAGE_DEPRECATED");
  await assert.rejects(provider.getPackageCandidate("example-extension", "1.0.2"), (error) => error.code === "EXTENSION_REGISTRY_INTEGRITY_INSECURE");
  await assert.rejects(provider.getPackageCandidate("example-extension", "1.0.3"), (error) => error.code === "EXTENSION_REGISTRY_URL_FORBIDDEN");
  await assert.rejects(provider.getPackageCandidate("example-extension", "9.9.9"), (error) => error.code === "EXTENSION_REGISTRY_PACKAGE_NOT_FOUND");
});

test("Nexus Search paginates, filters, deduplicates, and reports continuation", async (t) => {
  let page = 0;
  const server = startFixture(t, (request, response) => {
    const url = new URL(request.url, "http://127.0.0.1");
    assert.equal(url.searchParams.get("repository"), "extensions");
    assert.equal(url.searchParams.get("format"), "npm");
    assert.equal(url.searchParams.get("q"), null);
    if (!url.searchParams.has("continuationToken")) {
      page += 1;
      json(response, {
        items: [
          { repository: "extensions", format: "npm", group: "codew-ext", name: "alpha" },
          { repository: "other", format: "npm", group: "codew-ext", name: "wrong-repository" },
          { repository: "extensions", format: "pypi", group: "codew-ext", name: "wrong-format" },
        ],
        continuationToken: "page-2",
      });
      return;
    }
    assert.equal(url.searchParams.get("continuationToken"), "page-2");
    page += 1;
    json(response, { items: [{ repository: "extensions", format: "npm", name: "@codew-ext/alpha" }, { repository: "extensions", format: "npm", group: "@codew-ext", name: "beta" }] });
  });
  await new Promise((resolve) => server.on("listening", resolve));
  const { provider } = await providerFor(t, server);
  const result = await provider.search();
  assert.deepEqual(result.items.map((entry) => entry.extensionId), ["alpha", "beta"]);
  assert.equal(result.complete, true);
  assert.equal(page, 2);
});

test("Nexus Search sends the user query without a field-expression prefix", async (t) => {
  const server = startFixture(t, (request, response) => {
    const url = new URL(request.url, "http://127.0.0.1");
    assert.equal(url.searchParams.get("repository"), "extensions");
    assert.equal(url.searchParams.get("format"), "npm");
    assert.equal(url.searchParams.get("q"), "monitor");
    json(response, { items: [{ repository: "extensions", format: "npm", group: "@codew-ext", name: "monitor" }] });
  });
  await new Promise((resolve) => server.on("listening", resolve));
  const { provider } = await providerFor(t, server);
  const result = await provider.search({ query: "monitor" });
  assert.deepEqual(result.items.map((entry) => entry.extensionId), ["monitor"]);
});

test("Registry errors are stable, sanitized, and redirect credentials stay path-scoped", async (t) => {
  const calls = [];
  const responses = new Map([
    ["https://nexus.example.com/repository/extensions/%40codew-ext%2Fexample-extension", { status: 401 }],
    ["https://nexus.example.com/repository/extensions/redirected", { status: 404 }],
    ["https://evil.example.com/repository/extensions/redirected", { status: 200, body: {} }],
  ]);
  const fetch = async (url, options) => {
    calls.push({ url: String(url), authorization: options.headers.authorization });
    const value = responses.get(String(url));
    if (value?.status === 302) {
      return {
        status: 302,
        ok: false,
        headers: new Map([["location", value.location]]),
        async buffer() { return Buffer.alloc(0); },
      };
    }
    if (value?.status !== 200) return { status: value?.status || 404, ok: false, headers: new Map(), async buffer() { return Buffer.alloc(0); } };
    return {
      status: 200,
      ok: true,
      headers: new Map(),
      async buffer() { return Buffer.from(JSON.stringify(value.body)); },
    };
  };
  const provider = await createNexusExtensionPackageProvider({
    registryUrl: "https://nexus.example.com/repository/extensions/",
    bearerToken: "secret-token",
    fetch,
  });
  await assert.rejects(provider.getPackageCandidate("example-extension", "1.0.0"), (error) => {
    assert.equal(error.code, "EXTENSION_REGISTRY_UNAUTHENTICATED");
    assert.equal(JSON.stringify(error.details).includes("secret-token"), false);
    assert.equal(error.details.remediation.includes("npm login"), true);
    return true;
  });

  responses.set("https://nexus.example.com/repository/extensions/%40codew-ext%2Fexample-extension", {
    status: 302,
    location: "https://nexus.example.com/repository/extensions/redirected",
  });
  const response = await provider.getPackageCandidate("example-extension", "1.0.0").catch((error) => error);
  assert.equal(response.code, "EXTENSION_REGISTRY_PACKAGE_NOT_FOUND");
  assert.equal(calls[1].authorization, "Bearer secret-token");
  assert.equal(calls[2].authorization, "Bearer secret-token");

  responses.set("https://nexus.example.com/repository/extensions/redirected", {
    status: 302,
    location: "https://evil.example.com/repository/extensions/redirected",
  });
  calls.length = 0;
  await assert.rejects(provider.getPackageCandidate("example-extension", "1.0.0"), (error) => error.code === "EXTENSION_REGISTRY_REDIRECT_FORBIDDEN");
  assert.equal(calls.length, 2);
  assert.equal(calls[1].authorization, "Bearer secret-token");
});

test("download verifies streaming integrity and cleans temporary content without updating Store", async (t) => {
  const fixture = await preparePackage();
  t.after(() => {
    fs.rmSync(fixture.source, { recursive: true, force: true });
    fs.rmSync(fixture.output, { recursive: true, force: true });
  });
  const corrupt = Buffer.concat([fs.readFileSync(fixture.packed.tarball.path), Buffer.from("corrupt\n")]);
  const server = startFixture(t, (request, response) => {
    if (request.url.endsWith(".tgz")) {
      response.writeHead(200, { "content-length": corrupt.length });
      response.end(corrupt);
      return;
    }
    json(response, {
      name: "@codew-ext/example-extension",
      versions: {
        "1.0.0": {
          ...fixture.inspectedTarball.envelope,
          dist: {
            tarball: `http://127.0.0.1:${server.address().port}/repository/extensions/codew-ext-example-extension-1.0.0.tgz`,
            integrity: fixture.packed.tarball.integrity,
          },
        },
      },
    });
  });
  await new Promise((resolve) => server.on("listening", resolve));
  const store = temporaryRoot();
  t.after(() => fs.rmSync(store, { recursive: true, force: true }));
  const { provider } = await providerFor(t, server, { storeRoot: store });
  await assert.rejects(provider.import("example-extension", "1.0.0"), (error) => error.code === "EXTENSION_REGISTRY_INTEGRITY_MISMATCH");
  assert.equal(fs.existsSync(path.join(store, ".registry.json")), false);
  assert.equal(fs.existsSync(path.join(store, "example-extension", "1.0.0")), false);
});

test("Provider rejects runtime digest drift even when archive integrity is valid", async (t) => {
  const fixture = await preparePackage({ runtime: extensionRuntime("runtime.js", "b".repeat(64)) });
  t.after(() => {
    fs.rmSync(fixture.source, { recursive: true, force: true });
    fs.rmSync(fixture.output, { recursive: true, force: true });
  });
  const server = startFixture(t, (request, response) => {
    if (request.url.endsWith(".tgz")) {
      const body = fs.readFileSync(fixture.packed.tarball.path);
      response.writeHead(200, { "content-length": body.length });
      response.end(body);
      return;
    }
    json(response, {
      name: "@codew-ext/example-extension",
      versions: {
        "1.0.0": {
          ...fixture.inspectedTarball.envelope,
          dist: {
            tarball: `http://127.0.0.1:${server.address().port}/repository/extensions/codew-ext-example-extension-1.0.0.tgz`,
            integrity: fixture.packed.tarball.integrity,
          },
        },
      },
    });
  });
  await new Promise((resolve) => server.on("listening", resolve));
  const store = temporaryRoot();
  t.after(() => fs.rmSync(store, { recursive: true, force: true }));
  const { provider } = await providerFor(t, server, { storeRoot: store });
  await assert.rejects(provider.import("example-extension", "1.0.0"), (error) => error.code === "EXTENSION_RUNTIME_ENTRY_HASH_MISMATCH");
  assert.equal(fs.existsSync(path.join(store, ".registry.json")), false);
});

test("Provider rejects a valid-integrity tarball whose manifest identity or spec was replaced", async (t) => {
  const fixture = await preparePackage();
  t.after(() => {
    fs.rmSync(fixture.source, { recursive: true, force: true });
    fs.rmSync(fixture.output, { recursive: true, force: true });
  });
  const maliciousRoot = temporaryRoot();
  t.after(() => fs.rmSync(maliciousRoot, { recursive: true, force: true }));

  const identitySource = path.join(maliciousRoot, "identity");
  fs.cpSync(fixture.source, identitySource, { recursive: true });
  const identityManifest = JSON.parse(fs.readFileSync(path.join(identitySource, "manifest.json"), "utf8"));
  identityManifest.id = "other-extension";
  fs.writeFileSync(path.join(identitySource, "manifest.json"), `${JSON.stringify(identityManifest, null, 2)}\n`);
  const identityEnvelope = {
    ...fixture.inspectedTarball.envelope,
    codeWorkspace: {
      ...fixture.inspectedTarball.envelope.codeWorkspace,
      packageSha256: directoryDigest(identitySource),
    },
  };
  const identityTarball = path.join(maliciousRoot, "identity.tgz");
  await writeTransportTarball(identitySource, identityTarball, identityEnvelope);

  const specSource = path.join(maliciousRoot, "spec");
  fs.cpSync(fixture.source, specSource, { recursive: true });
  const specManifest = JSON.parse(fs.readFileSync(path.join(specSource, "manifest.json"), "utf8"));
  specManifest.extensionSpecVersion = 2;
  fs.writeFileSync(path.join(specSource, "manifest.json"), `${JSON.stringify(specManifest, null, 2)}\n`);
  const specEnvelope = {
    ...fixture.inspectedTarball.envelope,
    codeWorkspace: {
      ...fixture.inspectedTarball.envelope.codeWorkspace,
      extensionSpecVersion: 2,
      packageSha256: directoryDigest(specSource),
    },
  };
  const specTarball = path.join(maliciousRoot, "spec.tgz");
  await writeTransportTarball(specSource, specTarball, specEnvelope);

  for (const [tarball, code] of [[identityTarball, "EXTENSION_NPM_IDENTITY_MISMATCH"], [specTarball, "EXTENSION_SPEC_UNSUPPORTED"]]) {
    const integrity = `sha512-${crypto.createHash("sha512").update(fs.readFileSync(tarball)).digest("base64")}`;
    const server = startFixture(t, (request, response) => {
      if (request.url.endsWith(".tgz")) {
        const body = fs.readFileSync(tarball);
        response.writeHead(200, { "content-length": body.length });
        response.end(body);
        return;
      }
      json(response, {
        name: "@codew-ext/example-extension",
        versions: {
          "1.0.0": {
            ...fixture.inspectedTarball.envelope,
            ...(tarball === identityTarball || tarball === specTarball ? {
              codeWorkspace: {
                ...fixture.inspectedTarball.envelope.codeWorkspace,
                ...(tarball === specTarball ? { extensionSpecVersion: 2 } : {}),
                packageSha256: directoryDigest(tarball === identityTarball ? identitySource : specSource),
              },
            } : {}),
            dist: {
              tarball: `http://127.0.0.1:${server.address().port}/repository/extensions/codew-ext-example-extension-1.0.0.tgz`,
              integrity,
            },
          },
        },
      });
    });
    await new Promise((resolve) => server.on("listening", resolve));
    const store = temporaryRoot();
    const { provider } = await providerFor(t, server, { storeRoot: store });
    await assert.rejects(provider.import("example-extension", "1.0.0"), (error) => error.code === code);
    assert.equal(fs.existsSync(path.join(store, ".registry.json")), false);
    fs.rmSync(store, { recursive: true, force: true });
  }
});

test("Store reads legacy provenance lazily and preserves references on migration", async (t) => {
  const fixture = await preparePackage();
  t.after(() => {
    fs.rmSync(fixture.source, { recursive: true, force: true });
    fs.rmSync(fixture.output, { recursive: true, force: true });
  });
  const store = temporaryRoot();
  t.after(() => fs.rmSync(store, { recursive: true, force: true }));
  fs.mkdirSync(path.join(store, "example-extension", "1.0.0"), { recursive: true });
  fs.cpSync(fixture.source, path.join(store, "example-extension", "1.0.0"), { recursive: true });
  const registryFile = path.join(store, ".registry.json");
  fs.writeFileSync(registryFile, `${JSON.stringify({
    schemaVersion: 1,
    packages: {
      "example-extension@1.0.0": {
        id: "example-extension",
        version: "1.0.0",
        manifestSha256: fixture.packed.manifestSha256,
        entrySha256: fixture.packed.entrySha256,
        packageSha256: fixture.packed.packageSha256,
        source: "builtin",
        references: { workspaces: ["/workspace-a"], processes: [], transactions: [], pins: [] },
      },
    },
  })}\n`);
  const legacy = loadStoreRegistry(store);
  assert.equal(legacy.schemaVersion, 2);
  assert.deepEqual(legacy.packages["example-extension@1.0.0"].provenance, { kind: "builtin" });
  assert.equal(JSON.parse(fs.readFileSync(registryFile, "utf8")).schemaVersion, 1);
  addPackageReference(store, "example-extension", "1.0.0", "workspaces", "/workspace-b");
  const migrated = JSON.parse(fs.readFileSync(registryFile, "utf8"));
  assert.equal(migrated.schemaVersion, 2);
  assert.deepEqual(migrated.packages["example-extension@1.0.0"].references.workspaces, ["/workspace-a", "/workspace-b"]);
});

test("built-in provider rejects ordinary extension sources", async (t) => {
  const fixture = await preparePackage();
  t.after(() => {
    fs.rmSync(fixture.source, { recursive: true, force: true });
    fs.rmSync(fixture.output, { recursive: true, force: true });
  });
  const builtin = createBuiltinExtensionPackageProvider({ extensionsRoot: path.join(fixture.source, "..") });
  const candidate = await builtin.getPackageCandidate("example-extension", "1.0.0").catch(() => null);
  assert.equal(candidate, null);
  const directRoot = temporaryRoot();
  fs.mkdirSync(path.join(directRoot, "example-extension", "1.0.0"), { recursive: true });
  fs.cpSync(fixture.source, path.join(directRoot, "example-extension", "1.0.0"), { recursive: true });
  t.after(() => fs.rmSync(directRoot, { recursive: true, force: true }));
  const direct = createBuiltinExtensionPackageProvider({ extensionsRoot: directRoot });
  await assert.rejects(
    () => direct.getPackageCandidate("example-extension", "1.0.0"),
    (error) => error.code === "EXTENSION_BUILTIN_SOURCE_UNSUPPORTED"
  );
});

test("Provider health separately reports metadata, authentication, and Search capability", async (t) => {
  const fixture = await preparePackage();
  t.after(() => {
    fs.rmSync(fixture.source, { recursive: true, force: true });
    fs.rmSync(fixture.output, { recursive: true, force: true });
  });
  const server = startFixture(t, (request, response) => {
    if (request.url.startsWith("/service/rest/v1/search")) {
      json(response, { items: [{ repository: "extensions", format: "npm", group: "@codew-ext", name: "example-extension" }] });
      return;
    }
    json(response, {
      name: "@codew-ext/example-extension",
      versions: {
        "1.0.0": {
          ...fixture.inspectedTarball.envelope,
          dist: {
            tarball: `http://127.0.0.1:${server.address().port}/repository/extensions/codew-ext-example-extension-1.0.0.tgz`,
            integrity: fixture.packed.tarball.integrity,
          },
        },
      },
    });
  });
  await new Promise((resolve) => server.on("listening", resolve));
  const { provider } = await providerFor(t, server);
  const health = await provider.health({ healthPackageName: "@codew-ext/example-extension" });
  assert.equal(health.ok, true);
  assert.deepEqual(health.checks.map((entry) => entry.id), ["configuration", "authentication", "metadata", "search"]);
  assert(health.checks.every((entry) => entry.ok));
});

test("Provider maps permission, rate-limit, timeout, oversized, and incompatible responses", async () => {
  const cases = [
    { status: 403, code: "EXTENSION_REGISTRY_FORBIDDEN" },
    { status: 429, code: "EXTENSION_REGISTRY_RATE_LIMITED" },
  ];
  for (const testCase of cases) {
    const provider = await createNexusExtensionPackageProvider({
      registryUrl: "https://nexus.example.com/repository/extensions/",
      bearerToken: "secret",
      fetch: async () => ({ status: testCase.status, ok: false, headers: new Map(), async buffer() { return Buffer.alloc(0); } }),
    });
    await assert.rejects(provider.getPackageCandidate("example-extension", "1.0.0"), (error) => error.code === testCase.code);
  }

  const timeoutProvider = await createNexusExtensionPackageProvider({
    registryUrl: "https://nexus.example.com/repository/extensions/",
    bearerToken: "secret",
    fetch: async () => { const error = new Error("request timed out"); error.type = "request-timeout"; throw error; },
  });
  await assert.rejects(timeoutProvider.getPackageCandidate("example-extension", "1.0.0"), (error) => error.code === "EXTENSION_REGISTRY_TIMEOUT");

  const oversizedProvider = await createNexusExtensionPackageProvider({
    registryUrl: "https://nexus.example.com/repository/extensions/",
    bearerToken: "secret",
    requestLimits: { maxMetadataBytes: 2 },
    fetch: async () => ({ status: 200, ok: true, headers: new Map(), async buffer() { return Buffer.alloc(3); } }),
  });
  await assert.rejects(oversizedProvider.getPackageCandidate("example-extension", "1.0.0"), (error) => error.code === "EXTENSION_REGISTRY_RESPONSE_TOO_LARGE");

  const incompatibleProvider = await createNexusExtensionPackageProvider({
    registryUrl: "https://nexus.example.com/repository/extensions/",
    bearerToken: "secret",
    fetch: async () => ({ status: 200, ok: true, headers: new Map(), async buffer() { return Buffer.from(JSON.stringify({ unexpected: true })); } }),
  });
  await assert.rejects(incompatibleProvider.search({ maxPages: 1 }), (error) => error.code === "EXTENSION_REGISTRY_SEARCH_INCOMPATIBLE");
});

test("Nexus import reuses an equal built-in digest and conflicts on a different same-version digest", async (t) => {
  const fixture = await preparePackage();
  t.after(() => {
    fs.rmSync(fixture.source, { recursive: true, force: true });
    fs.rmSync(fixture.output, { recursive: true, force: true });
  });
  const server = startFixture(t, (request, response) => {
    if (request.url.endsWith(".tgz")) {
      const body = fs.readFileSync(fixture.packed.tarball.path);
      response.writeHead(200, { "content-length": body.length });
      response.end(body);
      return;
    }
    json(response, {
      name: "@codew-ext/example-extension",
      versions: {
        "1.0.0": {
          ...fixture.inspectedTarball.envelope,
          dist: {
            tarball: `http://127.0.0.1:${server.address().port}/repository/extensions/codew-ext-example-extension-1.0.0.tgz`,
            integrity: fixture.packed.tarball.integrity,
          },
        },
      },
    });
  });
  await new Promise((resolve) => server.on("listening", resolve));

  const store = temporaryRoot();
  t.after(() => fs.rmSync(store, { recursive: true, force: true }));
  ensureStoredExtensionPackage({ storeRoot: store, sourceRoot: fixture.source, source: "builtin" });
  const { provider } = await providerFor(t, server, { storeRoot: store });
  const reused = await provider.import("example-extension", "1.0.0");
  assert.equal(reused.packageSha256, fixture.packed.packageSha256);
  assert.deepEqual(reused.provenance, { kind: "builtin" });

  fs.writeFileSync(path.join(packageRoot(store, "example-extension", "1.0.0"), "drift.txt"), "different package\n");
  await assert.rejects(provider.import("example-extension", "1.0.0"), (error) => error.code === "EXTENSION_STORE_PACKAGE_CONFLICT");
});

test("concurrent Nexus imports serialize on the Store package lock and commit one package", async (t) => {
  const fixture = await preparePackage();
  t.after(() => {
    fs.rmSync(fixture.source, { recursive: true, force: true });
    fs.rmSync(fixture.output, { recursive: true, force: true });
  });
  let tarballs = 0;
  const server = startFixture(t, (request, response) => {
    if (request.url.endsWith(".tgz")) {
      tarballs += 1;
      const body = fs.readFileSync(fixture.packed.tarball.path);
      response.writeHead(200, { "content-length": body.length });
      response.end(body);
      return;
    }
    json(response, {
      name: "@codew-ext/example-extension",
      versions: {
        "1.0.0": {
          ...fixture.inspectedTarball.envelope,
          dist: {
            tarball: `http://127.0.0.1:${server.address().port}/repository/extensions/codew-ext-example-extension-1.0.0.tgz`,
            integrity: fixture.packed.tarball.integrity,
          },
        },
      },
    });
  });
  await new Promise((resolve) => server.on("listening", resolve));
  const store = temporaryRoot();
  t.after(() => fs.rmSync(store, { recursive: true, force: true }));
  const { provider } = await providerFor(t, server, { storeRoot: store });
  const records = await Promise.all([
    provider.import("example-extension", "1.0.0"),
    provider.import("example-extension", "1.0.0"),
    provider.import("example-extension", "1.0.0"),
  ]);
  assert(records.every((record) => record.packageSha256 === fixture.packed.packageSha256));
  assert.equal(tarballs, 3);
  assert.equal(Object.keys(loadStoreRegistry(store).packages).length, 1);
});

test("activation and runtime resolvers use an imported Nexus package without network access", async (t) => {
  const init = [
    'const fs = require("node:fs");',
    'const path = require("node:path");',
    'const output = process.argv[process.argv.indexOf("--output") + 1];',
    'const result = process.argv[process.argv.indexOf("--result") + 1];',
    'const target = path.join(output, "skill.txt");',
    'fs.mkdirSync(path.dirname(target), { recursive: true });',
    'fs.writeFileSync(target, "nexus package\\n");',
    'fs.writeFileSync(result, JSON.stringify({ schemaVersion: 1, extensionSpecVersion: 1, extension: { id: "example-extension", version: "1.0.0" }, outputs: [{ id: "skill", source: "skill.txt" }] }));',
    "",
  ].join("\n");
  const fixture = await preparePackage({ runtime: extensionRuntime(), init });
  t.after(() => {
    fs.rmSync(fixture.source, { recursive: true, force: true });
    fs.rmSync(fixture.output, { recursive: true, force: true });
  });

  const repository = temporaryRoot();
  t.after(() => fs.rmSync(repository, { recursive: true, force: true }));
  fs.mkdirSync(path.join(repository, "example-extension", "1.0.0"), { recursive: true });
  fs.cpSync(fixture.source, path.join(repository, "example-extension", "1.0.0"), { recursive: true });
  const plan = resolveExtensionPlans(
    discoverExtensions({ extensionsRoot: repository }),
    ["example-extension"],
    { tools: ["codex"], state: emptyExtensionState() }
  )[0];
  const context = {
    schemaVersion: 1,
    extensionSpecVersion: plan.extensionSpecVersion,
    extension: { id: plan.id, version: plan.version },
    workspace: { name: "example", uuid: "123e4567-e89b-42d3-a456-426614174000", language: "zh-CN" },
    tools: ["codex"],
  };

  const server = startFixture(t, (request, response) => {
    if (request.url.endsWith(".tgz")) {
      const body = fs.readFileSync(fixture.packed.tarball.path);
      response.writeHead(200, { "content-length": body.length });
      response.end(body);
      return;
    }
    json(response, {
      name: "@codew-ext/example-extension",
      versions: {
        "1.0.0": {
          ...fixture.inspectedTarball.envelope,
          dist: {
            tarball: `http://127.0.0.1:${server.address().port}/repository/extensions/codew-ext-example-extension-1.0.0.tgz`,
            integrity: fixture.packed.tarball.integrity,
          },
        },
      },
    });
  });
  await new Promise((resolve) => server.on("listening", resolve));
  const store = temporaryRoot();
  t.after(() => fs.rmSync(store, { recursive: true, force: true }));
  const workspace = temporaryRoot();
  t.after(() => fs.rmSync(workspace, { recursive: true, force: true }));
  const { provider } = await providerFor(t, server, { storeRoot: store });
  await provider.import("example-extension", "1.0.0");

  fs.rmSync(repository, { recursive: true, force: true });
  const installed = executeExtension(workspace, plan, context, {
    useExtensionStore: true,
    extensionStoreRoot: store,
  });
  assert.equal(installed.status, "installed", installed.message || installed.code);
  assert.equal(fs.readFileSync(path.join(workspace, ".example", "example-extension.txt"), "utf8"), "nexus package\n");
  assert.equal(loadExtensionState(workspace).extensions["example-extension"].installed.packageSha256, plan.packageSha256);

  const runtime = resolveExtensionRuntime({
    id: "example-extension",
    storeRoot: store,
    workspaceRoot: workspace,
  });
  assert.equal(runtime.root, packageRoot(store, "example-extension", "1.0.0"));
  assert.equal(runtime.packageSha256, plan.packageSha256);
});
