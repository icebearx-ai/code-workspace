const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { pipeline } = require("node:stream/promises");
const { Transform } = require("node:stream");

const Config = require("@npmcli/config");
const npmConfigDefinitions = require("@npmcli/config/lib/definitions");
const nerfDart = require("@npmcli/config/lib/nerf-dart");
const fetchLibrary = require("make-fetch-happen");
const ssri = require("ssri");

const { WorkspaceError } = require("./errors");
const { inspectExtensionPackageDirectory, parseSemver } = require("./extensions");
const {
  DEFAULT_PACKAGE_LIMITS,
  extensionNpmPackageName,
  extractExtensionTransportTarball,
  validateExtensionTransportEnvelope,
} = require("./extension-package");
const { ensureStoredExtensionPackage } = require("./extension-store");

const NPM_SCOPE = "@codew-ext";
const SEARCH_PATH = "/service/rest/v1/search";
const DEFAULT_REQUEST_LIMITS = Object.freeze({
  connectTimeoutMs: 10_000,
  totalTimeoutMs: 30_000,
  maxRedirects: 3,
  maxMetadataBytes: 2 * 1024 * 1024,
  maxTarballBytes: 32 * 1024 * 1024,
});

function nexusError(code, message, details = {}) {
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
    throw nexusError("EXTENSION_REGISTRY_URL_INVALID", "Nexus Registry URL is invalid", { registry: String(value || "") || null });
  }
  if (url.username || url.password || url.search || url.hash) {
    throw nexusError("EXTENSION_REGISTRY_URL_INVALID", "Nexus Registry URL must not contain credentials, query, or fragment", { registryOrigin: url.origin });
  }
  if (url.protocol !== "https:" && !(options.allowLoopback === true && isLoopbackHostname(url.hostname))) {
    throw nexusError("EXTENSION_REGISTRY_URL_INVALID", "Nexus Registry must use HTTPS", { registryOrigin: url.origin });
  }
  const match = url.pathname.match(/^\/repository\/([A-Za-z0-9][A-Za-z0-9._-]*)\/?$/);
  if (!match) {
    throw nexusError("EXTENSION_REGISTRY_URL_INVALID", "Nexus Registry URL must point to /repository/<name>/", {
      registryOrigin: url.origin,
      actualPath: url.pathname,
    });
  }
  url.pathname = `/repository/${match[1]}/`;
  return Object.freeze({
    url,
    registryUrl: url.toString(),
    registryOrigin: url.origin,
    repository: match[1],
  });
}

function safeUserConfigDirectory() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "code-workspace-npm-config-"));
  fs.writeFileSync(path.join(directory, "package.json"), '{"private":true}\n');
  return directory;
}

async function readUserNpmConfig(options = {}) {
  const home = options.home || os.homedir();
  const userConfig = options.userConfig || path.join(home, ".npmrc");
  const configDirectory = safeUserConfigDirectory();
  const config = new Config({
    npmPath: path.dirname(require.resolve("@npmcli/config/package.json")),
    definitions: npmConfigDefinitions.definitions,
    shorthands: npmConfigDefinitions.shorthands,
    flatten: npmConfigDefinitions.flatten,
    nerfDarts: npmConfigDefinitions.nerfDarts,
    argv: [process.execPath, "npm"],
    env: { HOME: home, NPM_CONFIG_USERCONFIG: userConfig },
    cwd: configDirectory,
  });
  try {
    await config.load();
    return config.data.get("user").raw || {};
  } finally {
    fs.rmSync(configDirectory, { recursive: true, force: true });
  }
}

function authorizationFromNpmrc(raw, registryUrl) {
  const scoped = nerfDart(registryUrl);
  const token = raw[`${scoped}:_authToken`];
  const basic = raw[`${scoped}:_auth`];
  const username = raw[`${scoped}:username`];
  const password = raw[`${scoped}:_password`];
  const present = [token, basic, username || password].filter((value) => value !== undefined && value !== null && value !== "");
  if (present.length > 1 || (username && !password) || (!username && password)) {
    throw nexusError("EXTENSION_REGISTRY_CREDENTIALS_INVALID", "Nexus npm credentials are ambiguous or incomplete", {
      registryOrigin: new URL(registryUrl).origin,
      remediation: "Keep only one complete bearer or basic credential for the exact Registry URL.",
    });
  }
  if (token) return `Bearer ${token}`;
  if (basic) return `Basic ${basic}`;
  if (username && password) return `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`;
  return null;
}

function createNexusCredentialAdapter({ registryUrl, explicitAuthorization }) {
  const registry = new URL(registryUrl);
  return Object.freeze({
    forUrl(value, expectedPath) {
      const url = new URL(value);
      const sameOrigin = url.origin === registry.origin;
      const sameRegistryPath = url.pathname.startsWith(registry.pathname);
      const searchPath = url.pathname === SEARCH_PATH;
      const allowedPath = expectedPath === "search" ? searchPath : sameRegistryPath;
      if (!sameOrigin || !allowedPath) return null;
      return explicitAuthorization || null;
    },
  });
}

async function resolveNexusProviderConfiguration(options = {}) {
  const environment = options.environment || process.env;
  const explicitRegistry = options.registryUrl || environment.CODE_WORKSPACE_NEXUS_REGISTRY;
  const explicitToken = options.bearerToken || environment.CODE_WORKSPACE_NEXUS_AUTH_TOKEN;
  const explicitBasic = options.basicAuthorization || environment.CODE_WORKSPACE_NEXUS_BASIC_AUTH;
  const explicitAuthorization = explicitToken ? `Bearer ${explicitToken}` : explicitBasic ? `Basic ${explicitBasic}` : null;
  let registry;
  let rawConfig = {};
  if (!explicitAuthorization) rawConfig = await readUserNpmConfig(options);
  if (explicitRegistry) {
    registry = validateRegistryUrl(explicitRegistry, options);
  } else {
    const configured = rawConfig[`${NPM_SCOPE}:registry`];
    if (!configured) {
      throw nexusError("EXTENSION_REGISTRY_NOT_CONFIGURED", `No npm registry is configured for ${NPM_SCOPE}`, {
        scope: NPM_SCOPE,
        remediation: `Run npm config set ${NPM_SCOPE}:registry <https://nexus.example.com/repository/codew-extensions/>`,
      });
    }
    registry = validateRegistryUrl(configured, options);
  }
  if (explicitToken && explicitBasic) {
    throw nexusError("EXTENSION_REGISTRY_CREDENTIALS_INVALID", "Only one explicit Nexus credential may be provided");
  }
  const authorization = explicitAuthorization || authorizationFromNpmrc(rawConfig, registry.registryUrl);
  return Object.freeze({
    ...registry,
    credentials: createNexusCredentialAdapter({ registryUrl: registry.registryUrl, explicitAuthorization: authorization }),
    hasCredentials: Boolean(authorization),
  });
}

function isSameRegistryUrl(value, configuration) {
  const url = new URL(value);
  return url.origin === configuration.registryOrigin && url.pathname.startsWith(configuration.url.pathname);
}

function assertRegistryUrl(value, configuration) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw nexusError("EXTENSION_REGISTRY_URL_INVALID", "Registry returned an invalid URL", { registryOrigin: configuration.registryOrigin });
  }
  if (!isSameRegistryUrl(url, configuration) || url.username || url.password || url.search || url.hash) {
    throw nexusError("EXTENSION_REGISTRY_URL_FORBIDDEN", "Registry URL leaves the configured Nexus repository", {
      registryOrigin: configuration.registryOrigin,
      repository: configuration.repository,
      path: url.pathname,
    });
  }
  return url;
}

function assertRequestUrl(value, configuration, expectedPath) {
  const url = new URL(value);
  if (expectedPath === "search") {
    if (url.origin !== configuration.registryOrigin || url.pathname !== SEARCH_PATH || url.username || url.password || url.hash) {
      throw nexusError("EXTENSION_REGISTRY_URL_FORBIDDEN", "Nexus Search URL is outside the configured Registry origin", {
        registryOrigin: configuration.registryOrigin,
        path: url.pathname,
      });
    }
    return url;
  }
  return assertRegistryUrl(value, configuration);
}

function statusError(response, configuration, context) {
  const details = {
    registryOrigin: configuration.registryOrigin,
    repository: configuration.repository,
    status: response.status,
  };
  if (response.status === 401) {
    return nexusError("EXTENSION_REGISTRY_UNAUTHENTICATED", "Nexus requires authentication for the configured extension Registry", {
      ...details,
      remediation: "Run npm login against the exact Nexus repository URL and verify the user-level npm credentials.",
    });
  }
  if (response.status === 403) {
    return nexusError("EXTENSION_REGISTRY_FORBIDDEN", "The Nexus credentials do not grant access to the extension Registry", {
      ...details,
      remediation: "Ask a Nexus administrator to grant the service or user account read access to the extension repository.",
    });
  }
  if (response.status === 404) return nexusError("EXTENSION_REGISTRY_PACKAGE_NOT_FOUND", `${context} was not found in Nexus`, details);
  if (response.status === 429) {
    return nexusError("EXTENSION_REGISTRY_RATE_LIMITED", "Nexus rate limited the extension Registry request", {
      ...details,
      remediation: "Wait for the Retry-After interval and retry the request.",
    });
  }
  return nexusError("EXTENSION_REGISTRY_HTTP_FAILED", `Nexus request failed with HTTP ${response.status}`, details);
}

async function requestWithRedirects(fetch, url, options) {
  const { configuration, expectedPath, limits, headers = {}, bodyOptions = {} } = options;
  const deadline = Date.now() + (options.totalTimeoutMs || limits.totalTimeoutMs);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), limits.totalTimeoutMs);
  let current = new URL(url);
  try {
    for (let redirect = 0; redirect <= limits.maxRedirects; redirect += 1) {
      assertRequestUrl(current, configuration, expectedPath);
      const remaining = Math.max(1, deadline - Date.now());
      const authorization = configuration.credentials.forUrl(current, expectedPath);
      let response;
      try {
        response = await fetch(current, {
          headers: {
            accept: "application/json",
            ...headers,
            ...(authorization ? { authorization } : {}),
          },
          redirect: "manual",
          follow: 0,
          retry: { retries: 0 },
          cache: "no-store",
          timeout: Math.min(limits.connectTimeoutMs, remaining),
          ...bodyOptions,
          signal: bodyOptions?.signal || controller.signal,
        });
      } catch (error) {
        if (error?.name === "AbortError" || error?.type === "request-timeout" || error?.code === "ETIMEDOUT" || error?.code === "ESOCKETTIMEDOUT") {
          throw nexusError("EXTENSION_REGISTRY_TIMEOUT", "Nexus request timed out", {
            registryOrigin: configuration.registryOrigin,
            repository: configuration.repository,
            timeoutMs: limits.totalTimeoutMs,
          });
        }
        throw nexusError("EXTENSION_REGISTRY_NETWORK_FAILED", `Nexus request failed: ${error.message}`, {
          registryOrigin: configuration.registryOrigin,
          repository: configuration.repository,
          cause: error.code,
        });
      }
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const location = response.headers.get("location");
        if (!location) throw nexusError("EXTENSION_REGISTRY_REDIRECT_INVALID", "Nexus returned a redirect without Location", { registryOrigin: configuration.registryOrigin, status: response.status });
        const next = new URL(location, current);
        if (next.origin !== configuration.registryOrigin || (expectedPath === "search" ? next.pathname !== SEARCH_PATH : !next.pathname.startsWith(configuration.url.pathname))) {
          throw nexusError("EXTENSION_REGISTRY_REDIRECT_FORBIDDEN", "Nexus redirect leaves the configured repository", {
            registryOrigin: configuration.registryOrigin,
            repository: configuration.repository,
            redirectOrigin: next.origin,
          });
        }
        if (expectedPath === "search") {
          const fixed = (url, name, expected) => url.searchParams.get(name) === expected;
          if (
            !fixed(next, "repository", configuration.repository) ||
            !fixed(next, "format", "npm") ||
            next.searchParams.get("q") !== current.searchParams.get("q") ||
            next.searchParams.get("continuationToken") !== current.searchParams.get("continuationToken")
          ) {
            throw nexusError("EXTENSION_REGISTRY_REDIRECT_FORBIDDEN", "Nexus redirect changed a fixed Search parameter", {
              registryOrigin: configuration.registryOrigin,
              repository: configuration.repository,
            });
          }
        }
        current = next;
        continue;
      }
      if (!response.ok) throw statusError(response, configuration, options.context || "Nexus resource");
      return response;
    }
    throw nexusError("EXTENSION_REGISTRY_REDIRECT_INVALID", "Nexus redirect limit exceeded", {
      registryOrigin: configuration.registryOrigin,
      maxRedirects: limits.maxRedirects,
    });
  } finally {
    clearTimeout(timer);
  }
}

async function readJsonResponse(response, configuration, limits) {
  const body = await response.buffer();
  if (body.length > limits.maxMetadataBytes) {
    throw nexusError("EXTENSION_REGISTRY_RESPONSE_TOO_LARGE", "Nexus metadata response exceeded the size limit", {
      registryOrigin: configuration.registryOrigin,
      repository: configuration.repository,
      maxBytes: limits.maxMetadataBytes,
    });
  }
  try {
    return JSON.parse(body.toString("utf8"));
  } catch (error) {
    throw nexusError("EXTENSION_REGISTRY_METADATA_INVALID", `Nexus metadata is not valid JSON: ${error.message}`, {
      registryOrigin: configuration.registryOrigin,
      repository: configuration.repository,
    });
  }
}

function packumentUrl(configuration, packageName) {
  return new URL(encodeURIComponent(packageName), configuration.registryUrl);
}

function normalizeIntegrity(value) {
  let parsed;
  try {
    parsed = ssri.parse(value, { strict: true });
  } catch {
    throw nexusError("EXTENSION_REGISTRY_INTEGRITY_INVALID", "Nexus package integrity is invalid");
  }
  if (!parsed) throw nexusError("EXTENSION_REGISTRY_INTEGRITY_INSECURE", "Nexus package must provide exactly one SHA-512 integrity digest");
  const sha512 = parsed.sha512 || [];
  if (sha512.length !== 1) {
    throw nexusError("EXTENSION_REGISTRY_INTEGRITY_INSECURE", "Nexus package must provide exactly one SHA-512 integrity digest");
  }
  return `sha512-${sha512[0].digest}`;
}

function packageVersionMetadata(configuration, packageName, version, value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw nexusError("EXTENSION_REGISTRY_METADATA_INVALID", `Nexus version metadata is invalid for ${packageName}@${version}`);
  }
  if (value.name !== undefined && value.name !== packageName) {
    throw nexusError("EXTENSION_NPM_IDENTITY_MISMATCH", "Nexus package name does not match the requested package", { expected: packageName, actual: value.name });
  }
  if (value.version !== version) {
    throw nexusError("EXTENSION_NPM_IDENTITY_MISMATCH", "Nexus package version does not match the requested version", { expected: version, actual: value.version ?? null });
  }
  const metadataEnvelope = value.codeWorkspace;
  const extensionId = packageName.slice(NPM_SCOPE.length + 1);
  const envelope = validateExtensionTransportEnvelope({
    name: packageName,
    version,
    description: value.description || metadataEnvelope?.description || `${extensionId} Code Workspace extension`,
    keywords: value.keywords || ["code-workspace-extension"],
    codeWorkspace: metadataEnvelope,
    files: value.files || ["extension"],
  }, {
    expectedId: extensionId,
    expectedVersion: version,
  });
  const dist = value.dist && typeof value.dist === "object" && !Array.isArray(value.dist) ? value.dist : {};
  const tarball = assertRegistryUrl(dist.tarball, configuration);
  const archiveIntegrity = normalizeIntegrity(dist.integrity);
  const deprecated = value.deprecated !== undefined && value.deprecated !== false && value.deprecated !== "";
  return Object.freeze({
    schemaVersion: 1,
    providerKind: "nexus-npm",
    packageName,
    extensionId,
    version,
    extensionSpecVersion: envelope.codeWorkspace.extensionSpecVersion,
    tarballUrl: tarball.toString(),
    archiveIntegrity,
    transport: envelope,
    deprecated,
    ...(deprecated ? { deprecatedReason: String(value.deprecated) } : {}),
  });
}

function packageVersionCandidate(configuration, packageName, version, value, options = {}) {
  const metadata = packageVersionMetadata(configuration, packageName, version, value);
  if (metadata.deprecated && options.allowDeprecated !== true) {
    throw nexusError("EXTENSION_REGISTRY_PACKAGE_DEPRECATED", `${packageName}@${version} is deprecated in Nexus`, {
      packageName,
      version,
      ...(metadata.deprecatedReason ? { reason: metadata.deprecatedReason } : {}),
    });
  }
  return metadata;
}

async function resolveNexusExtensionPackageCandidate(provider, id, version, options = {}) {
  const extensionId = String(id || "");
  const versionValue = parseSemver(version).raw;
  const packageName = extensionNpmPackageName(extensionId);
  const url = packumentUrl(provider.configuration, packageName);
  const response = await provider.requestJson(url, { expectedPath: "registry", context: `${packageName} metadata` }, options);
  const packument = await readJsonResponse(response, provider.configuration, provider.limits);
  if (!packument || typeof packument !== "object" || Array.isArray(packument) || packument.name !== packageName) {
    throw nexusError("EXTENSION_REGISTRY_METADATA_INVALID", "Nexus packument name is invalid", { packageName });
  }
  const versions = packument.versions && typeof packument.versions === "object" && !Array.isArray(packument.versions) ? packument.versions : {};
  const value = versions[versionValue];
  if (!value) throw nexusError("EXTENSION_REGISTRY_PACKAGE_NOT_FOUND", `${packageName}@${versionValue} was not found in Nexus`, { packageName, version: versionValue });
  return packageVersionCandidate(provider.configuration, packageName, versionValue, value);
}

async function getNexusExtensionPackageMetadata(provider, id) {
  const extensionId = String(id || "");
  const packageName = extensionNpmPackageName(extensionId);
  const response = await provider.requestJson(packumentUrl(provider.configuration, packageName), {
    expectedPath: "registry",
    context: `${packageName} metadata`,
  });
  const packument = await readJsonResponse(response, provider.configuration, provider.limits);
  if (!packument || typeof packument !== "object" || Array.isArray(packument) || packument.name !== packageName) {
    throw nexusError("EXTENSION_REGISTRY_METADATA_INVALID", "Nexus packument name is invalid", { packageName });
  }
  const versions = packument.versions && typeof packument.versions === "object" && !Array.isArray(packument.versions) ? packument.versions : {};
  const entries = Object.entries(versions)
    .map(([version, value]) => packageVersionMetadata(provider.configuration, packageName, version, value))
    .sort((left, right) => compareVersionStrings(right.version, left.version));
  return Object.freeze({
    schemaVersion: 1,
    packageName,
    extensionId,
    description: entries[0]?.transport.description || `${extensionId} Code Workspace extension`,
    versions: Object.freeze(entries),
  });
}

function compareVersionStrings(left, right) {
  const leftValue = parseSemver(left);
  const rightValue = parseSemver(right);
  for (const key of ["major", "minor", "patch"]) {
    if (leftValue[key] !== rightValue[key]) return leftValue[key] < rightValue[key] ? -1 : 1;
  }
  if (leftValue.prerelease.length === 0 || rightValue.prerelease.length === 0) {
    return leftValue.prerelease.length === rightValue.prerelease.length ? 0 : leftValue.prerelease.length === 0 ? 1 : -1;
  }
  const length = Math.max(leftValue.prerelease.length, rightValue.prerelease.length);
  for (let index = 0; index < length; index += 1) {
    if (leftValue.prerelease[index] === undefined) return -1;
    if (rightValue.prerelease[index] === undefined) return 1;
    const compared = comparePrereleaseIdentifiers(leftValue.prerelease[index], rightValue.prerelease[index]);
    if (compared !== 0) return compared;
  }
  return 0;
}

function comparePrereleaseIdentifiers(left, right) {
  const leftNumeric = /^\d+$/.test(left);
  const rightNumeric = /^\d+$/.test(right);
  if (leftNumeric && rightNumeric) return Number(left) - Number(right);
  if (leftNumeric) return -1;
  if (rightNumeric) return 1;
  return left < right ? -1 : left > right ? 1 : 0;
}

function packageNameFromSearchItem(item) {
  if (typeof item?.name !== "string" || !item.name) return null;
  if (item.name.startsWith(`${NPM_SCOPE}/`)) return item.name;
  const group = typeof item.group === "string" ? item.group.replace(/^@/, "") : item.group;
  const scope = NPM_SCOPE.slice(1);
  if (group === scope) return `${NPM_SCOPE}/${item.name}`;
  return null;
}

function searchUrl(configuration, continuationToken, query = "") {
  const url = new URL(SEARCH_PATH, configuration.registryOrigin);
  url.searchParams.set("repository", configuration.repository);
  url.searchParams.set("format", "npm");
  if (query) url.searchParams.set("q", query);
  if (continuationToken) url.searchParams.set("continuationToken", continuationToken);
  return url;
}

function normalizeSearchResponse(value, configuration, packageNameSeen) {
  if (!value || typeof value !== "object" || Array.isArray(value) || !Array.isArray(value.items)) {
    throw nexusError("EXTENSION_REGISTRY_SEARCH_INCOMPATIBLE", "Nexus Search response is incompatible with the extension Provider", {
      registryOrigin: configuration.registryOrigin,
      repository: configuration.repository,
    });
  }
  const items = [];
  for (const entry of value.items) {
    if (entry?.repository !== undefined && entry.repository !== configuration.repository) continue;
    if (entry?.format !== undefined && String(entry.format).toLowerCase() !== "npm") continue;
    const packageName = packageNameFromSearchItem(entry);
    if (!packageName || packageNameSeen.has(packageName)) continue;
    packageNameSeen.add(packageName);
    items.push(Object.freeze({
      packageName,
      extensionId: packageName.slice(NPM_SCOPE.length + 1),
    }));
  }
  const continuationToken = value.continuationToken === undefined || value.continuationToken === null || value.continuationToken === ""
    ? null
    : String(value.continuationToken);
  return { items, continuationToken };
}

async function searchNexusExtensionPackages(provider, options = {}) {
  const maxPages = options.maxPages === undefined ? 20 : options.maxPages;
  if (!Number.isSafeInteger(maxPages) || maxPages < 1) throw nexusError("EXTENSION_REGISTRY_SEARCH_INVALID", "Search maxPages must be a positive integer");
  const seen = new Set();
  const items = [];
  let continuationToken = null;
  let pages = 0;
  do {
    const response = await provider.requestJson(searchUrl(provider.configuration, continuationToken, options.query || ""), {
      expectedPath: "search",
      context: "Nexus Search",
    }, options);
    const value = await readJsonResponse(response, provider.configuration, provider.limits);
    const page = normalizeSearchResponse(value, provider.configuration, seen);
    pages += 1;
    items.push(...page.items);
    continuationToken = page.continuationToken;
  } while (continuationToken && pages < maxPages);
  return Object.freeze({
    items: Object.freeze(items.sort((left, right) => left.packageName.localeCompare(right.packageName))),
    continuationToken,
    complete: continuationToken === null,
    pages,
  });
}

class CountingStream extends Transform {
  constructor(maxBytes, context) {
    super();
    this.bytes = 0;
    this.maxBytes = maxBytes;
    this.context = context;
  }
  _transform(chunk, encoding, callback) {
    this.bytes += chunk.length;
    if (this.bytes > this.maxBytes) {
      callback(nexusError("EXTENSION_REGISTRY_RESPONSE_TOO_LARGE", `${this.context} exceeded the response size limit`, {
        maxBytes: this.maxBytes,
      }));
      return;
    }
    callback(null, chunk);
  }
}

function safeRuntimeEntry(sourceRoot, manifest) {
  const root = path.resolve(sourceRoot);
  const file = path.resolve(root, ...manifest.runtime.entry.split("/"));
  if (!file.startsWith(`${root}${path.sep}`)) {
    throw nexusError("EXTENSION_RUNTIME_ENTRY_INVALID", "Runtime entry escapes the Extension package root", { entry: manifest.runtime.entry });
  }
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw nexusError("EXTENSION_RUNTIME_ENTRY_INVALID", "Runtime entry must be a regular file", { entry: manifest.runtime.entry });
  }
  const digest = crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
  if (digest !== manifest.runtime.entrySha256) {
    throw nexusError("EXTENSION_RUNTIME_ENTRY_HASH_MISMATCH", "Runtime entry digest does not match the Extension manifest", {
      expectedSha256: manifest.runtime.entrySha256,
      actualSha256: digest,
    });
  }
  return digest;
}

async function downloadNexusExtensionPackage(provider, candidate, options = {}) {
  const maxTarballBytes = options.maxTarballBytes || provider.limits.maxTarballBytes;
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "code-workspace-nexus-package-"));
  const downloadController = new AbortController();
  const downloadTimeout = setTimeout(() => downloadController.abort(), options.totalTimeoutMs || provider.limits.totalTimeoutMs);
  try {
    const archiveFile = path.join(temporaryRoot, "package.tgz");
    const response = await provider.fetch(candidate.tarballUrl, {
      expectedPath: "registry",
      context: `${candidate.packageName}@${candidate.version} tarball`,
      headers: { accept: "application/octet-stream" },
      bodyOptions: { signal: downloadController.signal },
    }, options);
    const contentLength = Number(response.headers.get("content-length") || 0);
    if (contentLength > maxTarballBytes) {
      throw nexusError("EXTENSION_REGISTRY_RESPONSE_TOO_LARGE", "Nexus tarball exceeds the response size limit", { maxBytes: maxTarballBytes });
    }
    try {
      await pipeline(
        response.body,
        new CountingStream(maxTarballBytes, "Nexus tarball"),
        ssri.integrityStream({ integrity: candidate.archiveIntegrity, algorithms: ["sha512"], single: true }),
        fs.createWriteStream(archiveFile, { mode: 0o600 })
      );
    } catch (error) {
      if (error?.name === "AbortError" || error?.type === "request-timeout") {
        throw nexusError("EXTENSION_REGISTRY_TIMEOUT", "Nexus tarball download timed out", {
          packageName: candidate.packageName,
          version: candidate.version,
          timeoutMs: options.totalTimeoutMs || provider.limits.totalTimeoutMs,
        });
      }
      if (error?.code === "EINTEGRITY") {
        throw nexusError("EXTENSION_REGISTRY_INTEGRITY_MISMATCH", "Nexus tarball does not match its SHA-512 integrity", {
          packageName: candidate.packageName,
          version: candidate.version,
          expectedIntegrity: candidate.archiveIntegrity,
        });
      }
      if (error instanceof WorkspaceError) throw error;
      throw nexusError("EXTENSION_REGISTRY_DOWNLOAD_FAILED", `Nexus tarball download failed: ${error.message}`, {
        packageName: candidate.packageName,
        version: candidate.version,
        cause: error.code,
      });
    }
    const extracted = await extractExtensionTransportTarball(archiveFile, path.join(temporaryRoot, "unpacked"), {
      limits: options.packageLimits || DEFAULT_PACKAGE_LIMITS,
      expectedId: candidate.extensionId,
      expectedVersion: candidate.version,
      expectedExtensionSpecVersion: candidate.extensionSpecVersion,
      expectedPackageSha256: candidate.transport.codeWorkspace.packageSha256,
    });
    const inspected = inspectExtensionPackageDirectory(extracted.sourceRoot, {
      expectedId: candidate.extensionId,
      expectedVersion: candidate.version,
    });
    if (inspected.packageSha256 !== extracted.packageSha256 || inspected.manifestSha256 !== extracted.manifestSha256 || inspected.entrySha256 !== extracted.entrySha256) {
      throw nexusError("EXTENSION_NPM_PACKAGE_DIGEST_MISMATCH", "Unpacked Extension package does not match the npm transport envelope", {
        expectedSha256: candidate.transport.codeWorkspace.packageSha256,
        actualSha256: inspected.packageSha256,
      });
    }
    const runtimeEntrySha256 = inspected.manifest.runtime ? safeRuntimeEntry(inspected.sourceRoot, inspected.manifest) : null;
    return Object.freeze({
      schemaVersion: 1,
      providerKind: "nexus-npm",
      extensionId: inspected.id,
      version: inspected.version,
      extensionSpecVersion: inspected.extensionSpecVersion,
      sourceRoot: inspected.sourceRoot,
      temporaryRoot,
      manifestSha256: inspected.manifestSha256,
      entrySha256: inspected.entrySha256,
      runtimeEntrySha256,
      packageSha256: inspected.packageSha256,
      provenance: Object.freeze({
        kind: "nexus-npm",
        registryOrigin: provider.configuration.registryOrigin,
        repository: provider.configuration.repository,
        packageName: candidate.packageName,
        archiveIntegrity: candidate.archiveIntegrity,
      }),
    });
  } catch (error) {
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
    throw error;
  } finally {
    clearTimeout(downloadTimeout);
  }
}

async function importNexusExtensionPackage(provider, id, version, options = {}) {
  const candidate = await resolveNexusExtensionPackageCandidate(provider, id, version, options);
  const downloaded = await downloadNexusExtensionPackage(provider, candidate, options);
  try {
    return ensureStoredExtensionPackage({
      ...options,
      sourceRoot: downloaded.sourceRoot,
      id: downloaded.extensionId,
      version: downloaded.version,
      provenance: downloaded.provenance,
    });
  } finally {
    fs.rmSync(downloaded.temporaryRoot, { recursive: true, force: true });
  }
}

async function checkNexusExtensionRegistryHealth(provider, options = {}) {
  const checks = [];
  checks.push(Object.freeze({ id: "configuration", ok: true, registryOrigin: provider.configuration.registryOrigin, repository: provider.configuration.repository }));
  let metadataOk = false;
  try {
    const packageName = options.healthPackageName || `${NPM_SCOPE}/monitor`;
    const response = await provider.requestJson(packumentUrl(provider.configuration, packageName), { expectedPath: "registry", context: `${packageName} metadata` }, options);
    const packument = await readJsonResponse(response, provider.configuration, provider.limits);
    if (packument?.name !== packageName) throw nexusError("EXTENSION_REGISTRY_METADATA_INVALID", "Health check packument name mismatch");
    metadataOk = true;
    checks.push(Object.freeze({ id: "authentication", ok: provider.configuration.hasCredentials, status: response.status, authenticated: provider.configuration.hasCredentials }));
    checks.push(Object.freeze({ id: "metadata", ok: true, packageName }));
  } catch (error) {
    checks.push(Object.freeze({ id: error.code === "EXTENSION_REGISTRY_UNAUTHENTICATED" ? "authentication" : "metadata", ok: false, code: error.code, message: error.message }));
  }
  try {
    const response = await provider.requestJson(searchUrl(provider.configuration), { expectedPath: "search", context: "Nexus Search" }, { ...options, maxPages: 1 });
    const value = await readJsonResponse(response, provider.configuration, provider.limits);
    normalizeSearchResponse(value, provider.configuration, new Set());
    checks.push(Object.freeze({ id: "search", ok: true }));
  } catch (error) {
    checks.push(Object.freeze({ id: "search", ok: false, code: error.code, message: error.message }));
  }
  return Object.freeze({
    schemaVersion: 1,
    ok: metadataOk && checks.every((entry) => entry.ok),
    checks: Object.freeze(checks),
  });
}

async function createNexusExtensionPackageProvider(options = {}) {
  const configuration = await resolveNexusProviderConfiguration(options);
  const fetch = options.fetch || fetchLibrary;
  const storeRoot = options.storeRoot;
  const limits = Object.freeze({ ...DEFAULT_REQUEST_LIMITS, ...(options.requestLimits || {}) });
  const provider = Object.freeze({
    kind: "nexus-npm",
    providerId: "nexus-npm",
    configuration,
    storeRoot,
    limits,
    async getPackageCandidate(id, version, candidateOptions = {}) {
      return resolveNexusExtensionPackageCandidate(provider, id, version, candidateOptions);
    },
    async getPackageMetadata(id, metadataOptions = {}) {
      return getNexusExtensionPackageMetadata(provider, id, metadataOptions);
    },
    async search(searchOptions = {}) {
      return searchNexusExtensionPackages(provider, searchOptions);
    },
    async health(healthOptions = {}) {
      return checkNexusExtensionRegistryHealth(provider, healthOptions);
    },
    async import(id, version, importOptions = {}) {
      return importNexusExtensionPackage(provider, id, version, { storeRoot, ...importOptions });
    },
    async requestJson(url, fetchOptions = {}, requestOptions = {}) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), requestOptions.totalTimeoutMs || limits.totalTimeoutMs);
      try {
        const response = await requestWithRedirects(fetch, url, {
          ...fetchOptions,
          configuration,
          limits,
          totalTimeoutMs: requestOptions.totalTimeoutMs,
          bodyOptions: { signal: controller.signal },
        });
        const body = await response.buffer();
        return {
          status: response.status,
          ok: response.ok,
          headers: response.headers,
          async buffer() { return body; },
        };
      } catch (error) {
        if (error?.name === "AbortError" || error?.type === "request-timeout") {
          throw nexusError("EXTENSION_REGISTRY_TIMEOUT", "Nexus metadata request timed out", {
            registryOrigin: configuration.registryOrigin,
            repository: configuration.repository,
            timeoutMs: limits.totalTimeoutMs,
          });
        }
        throw error;
      } finally {
        clearTimeout(timeout);
      }
    },
    async fetch(url, fetchOptions = {}, requestOptions = {}) {
      return requestWithRedirects(fetch, url, {
        ...fetchOptions,
        configuration,
        limits,
        totalTimeoutMs: requestOptions.totalTimeoutMs,
      });
    },
  });
  return provider;
}

module.exports = {
  DEFAULT_REQUEST_LIMITS,
  NPM_SCOPE,
  checkNexusExtensionRegistryHealth,
  createNexusCredentialAdapter,
  createNexusExtensionPackageProvider,
  downloadNexusExtensionPackage,
  getNexusExtensionPackageMetadata,
  importNexusExtensionPackage,
  normalizeIntegrity,
  readUserNpmConfig,
  resolveNexusExtensionPackageCandidate,
  resolveNexusProviderConfiguration,
  searchNexusExtensionPackages,
  validateRegistryUrl,
};
