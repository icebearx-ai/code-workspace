const fs = require("node:fs");
const path = require("node:path");

const { WorkspaceError } = require("./errors");
const {
  SUPPORTED_EXTENSION_SPEC_VERSIONS,
  discoverSystemExtensions,
  isSystemExtensionId,
  normalizeExtensionNames,
  parseSemver,
  resolveExtensionPlans,
} = require("./extensions");
const {
  packageRecordFromDirectory,
  packageRoot,
  listPackageReferences,
} = require("./extension-store");
const {
  NPM_SCOPE,
  createNexusExtensionPackageProvider,
} = require("./nexus-extension-provider");

const DEFAULT_SEARCH_LIMIT = 50;
const DEFAULT_BROWSE_METADATA_CONCURRENCY = 4;
const DEFAULT_BROWSE_METADATA_TIMEOUT_MS = 10_000;

function lifecycleError(code, message, details = {}) {
  return new WorkspaceError(code, message, details);
}

function isPrerelease(version) {
  return parseSemver(version).prerelease.length > 0;
}

function compareVersions(left, right) {
  return -compareSemverSafe(left, right);
}

function compareSemverSafe(left, right) {
  const a = parseSemver(left);
  const b = parseSemver(right);
  for (const key of ["major", "minor", "patch"]) {
    if (a[key] !== b[key]) return a[key] < b[key] ? -1 : 1;
  }
  if (a.prerelease.length === 0 || b.prerelease.length === 0) {
    return a.prerelease.length === b.prerelease.length ? 0 : a.prerelease.length === 0 ? 1 : -1;
  }
  const length = Math.max(a.prerelease.length, b.prerelease.length);
  for (let index = 0; index < length; index += 1) {
    if (a.prerelease[index] === undefined) return -1;
    if (b.prerelease[index] === undefined) return 1;
    const left = a.prerelease[index];
    const right = b.prerelease[index];
    const leftNumeric = /^\d+$/.test(left);
    const rightNumeric = /^\d+$/.test(right);
    const compared = leftNumeric && rightNumeric
      ? Number(left) - Number(right)
      : leftNumeric ? -1 : rightNumeric ? 1 : left < right ? -1 : left > right ? 1 : 0;
    if (compared !== 0) return compared;
  }
  return 0;
}

async function resolveRegistryProvider(options = {}) {
  if (options.offline === true) return null;
  if (options.provider) return options.provider;
  try {
    return await createNexusExtensionPackageProvider(options);
  } catch (error) {
    if (error.code === "EXTENSION_REGISTRY_NOT_CONFIGURED") return null;
    throw error;
  }
}

function metadataVersionModel(entry) {
  const supported = SUPPORTED_EXTENSION_SPEC_VERSIONS.includes(entry.extensionSpecVersion);
  const prerelease = isPrerelease(entry.version);
  const reasons = [
    ...(supported ? [] : ["unsupported-extension-spec"]),
    ...(prerelease ? ["prerelease"] : []),
    ...(entry.deprecated ? ["deprecated"] : []),
  ];
  return Object.freeze({
    version: entry.version,
    extensionSpecVersion: entry.extensionSpecVersion,
    packageSha256: entry.transport.codeWorkspace.packageSha256,
    prerelease,
    deprecated: entry.deprecated,
    ...(entry.deprecatedReason ? { deprecatedReason: entry.deprecatedReason } : {}),
    metadataCompatible: supported,
    eligibilityReasons: Object.freeze(reasons),
  });
}

function defaultMetadataCandidate(versions) {
  return versions.find((entry) => entry.metadataCompatible && !entry.prerelease && !entry.deprecated) || null;
}

function extensionIdFromName(value) {
  const names = normalizeExtensionNames([value]);
  return names[0];
}

async function searchRegistryExtensions(options = {}) {
  const provider = options.provider || await createNexusExtensionPackageProvider(options);
  const query = String(options.query || "").trim();
  const limit = options.limit === undefined ? DEFAULT_SEARCH_LIMIT : options.limit;
  if (!Number.isSafeInteger(limit) || limit < 1) {
    throw lifecycleError("EXTENSION_SEARCH_LIMIT_INVALID", "Search limit must be a positive integer", { limit });
  }
  const page = await provider.search({ query, ...(options.maxPages ? { maxPages: options.maxPages } : {}) });
  const identities = page.items.filter((entry) => {
    if (!query) return true;
    const text = `${entry.packageName} ${entry.extensionId}`.toLowerCase();
    return query.toLowerCase().split(/\s+/).filter(Boolean).every((token) => text.includes(token));
  });
  const truncatedByIdentity = identities.length > limit;
  const selectedIdentities = identities.slice(0, limit);
  const items = [];
  const warnings = [];
  for (const identity of selectedIdentities) {
    try {
      const metadata = await provider.getPackageMetadata(identity.extensionId);
      const versions = metadata.versions.map(metadataVersionModel);
      items.push(Object.freeze({
        packageName: identity.packageName,
        extensionId: identity.extensionId,
        name: metadata.description,
        description: metadata.description,
        latestCandidate: defaultMetadataCandidate(versions),
        versionCount: versions.length,
      }));
    } catch (error) {
      warnings.push({
        code: error.code || "EXTENSION_REGISTRY_METADATA_INVALID",
        severity: "warning",
        message: error.message,
        extension: identity.extensionId,
      });
    }
  }
  items.sort((left, right) => left.extensionId.localeCompare(right.extensionId));
  return Object.freeze({
    schemaVersion: 1,
    query,
    registry: Object.freeze({
      scope: NPM_SCOPE,
      origin: provider.configuration.registryOrigin,
      repository: provider.configuration.repository,
    }),
    items: Object.freeze(items),
    limit,
    truncated: truncatedByIdentity || page.continuationToken !== null,
    complete: page.continuationToken === null && !truncatedByIdentity,
    diagnostics: Object.freeze(warnings),
  });
}

function sanitizeBrowseMessage(value) {
  return String(value || "Registry request failed")
    .replace(/authorization\s*[:=]\s*bearer\s+[^\s,;]+/gi, "authorization: [redacted]")
    .replace(/authorization\s*[:=]\s*[^\s,;]+/gi, "authorization: [redacted]")
    .replace(/bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [redacted]")
    .replace(/(token|password|passwd|_authToken)\s*[:=]\s*[^\s,;]+/gi, "$1: [redacted]")
    .replace(/([?&](?:token|password|passwd|auth|authorization)=[^&#\s]*)/gi, "$1".replace(/=.*/, "=[redacted]"))
    .replace(/continuationToken\s*[:=]\s*[^\s,;]+/gi, "continuationToken: [redacted]");
}

function browseDiagnostic(error, extension) {
  return Object.freeze({
    code: error?.code || "EXTENSION_REGISTRY_METADATA_INVALID",
    severity: "warning",
    retryable: true,
    message: sanitizeBrowseMessage(error?.message),
    ...(extension ? { extension } : {}),
  });
}

function validateBrowsePositiveInteger(value, code, label) {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw lifecycleError(code, `${label} must be a positive integer`, { [label]: value });
  }
  return value;
}

function withBrowseTimeout(promise, timeoutMs) {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) return promise;
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(lifecycleError("EXTENSION_REGISTRY_METADATA_TIMEOUT", "Extension metadata request timed out", { timeoutMs })), timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

async function mapBrowseWorkers(values, worker, concurrency) {
  const results = new Array(values.length);
  let cursor = 0;
  async function run() {
    while (true) {
      const index = cursor;
      cursor += 1;
      if (index >= values.length) return;
      results[index] = await worker(values[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, values.length) }, () => run()));
  return results;
}

function browseRegistrySummary(provider) {
  return Object.freeze({
    scope: NPM_SCOPE,
    origin: provider.configuration?.registryOrigin || null,
    repository: provider.configuration?.repository || null,
  });
}

function browseIdentityMatches(identity, query) {
  const tokens = String(query || "").toLowerCase().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return true;
  const text = `${identity.packageName} ${identity.extensionId}`.toLowerCase();
  return tokens.every((token) => text.includes(token));
}

async function createRegistryExtensionBrowseSession(options = {}) {
  const provider = options.provider || await createNexusExtensionPackageProvider(options);
  const query = String(options.query || "").trim();
  const metadataConcurrency = validateBrowsePositiveInteger(
    options.metadataConcurrency === undefined ? DEFAULT_BROWSE_METADATA_CONCURRENCY : options.metadataConcurrency,
    "EXTENSION_REGISTRY_BROWSE_CONCURRENCY_INVALID",
    "metadataConcurrency"
  );
  const metadataTimeoutMs = options.metadataTimeoutMs === undefined
    ? (provider.limits?.totalTimeoutMs || DEFAULT_BROWSE_METADATA_TIMEOUT_MS)
    : validateBrowsePositiveInteger(options.metadataTimeoutMs, "EXTENSION_REGISTRY_BROWSE_TIMEOUT_INVALID", "metadataTimeoutMs");
  const pages = [];
  const metadataCache = new Map();
  const seenIdentities = new Set();
  let currentIndex = -1;
  let closed = false;

  function assertOpen() {
    if (closed) throw lifecycleError("EXTENSION_REGISTRY_BROWSE_SESSION_CLOSED", "Extension Registry browse session is closed");
  }

  async function getMetadata(identity, force = false) {
    if (!force && metadataCache.has(identity.extensionId)) return metadataCache.get(identity.extensionId);
    const request = withBrowseTimeout(
      provider.getPackageMetadata(identity.extensionId, { totalTimeoutMs: metadataTimeoutMs }),
      metadataTimeoutMs
    ).then((metadata) => {
      const versions = metadata.versions.map(metadataVersionModel);
      return Object.freeze({
        packageName: identity.packageName,
        extensionId: identity.extensionId,
        name: metadata.description,
        description: metadata.description,
        latestCandidate: defaultMetadataCandidate(versions),
        versionCount: versions.length,
      });
    });
    metadataCache.set(identity.extensionId, request);
    try {
      return await request;
    } catch (error) {
      metadataCache.delete(identity.extensionId);
      throw error;
    }
  }

  async function materializePage(index, identities, continuationToken, forceMetadata = false) {
    const diagnostics = [];
    const results = await mapBrowseWorkers(identities, async (identity) => {
      try {
        return { item: await getMetadata(identity, forceMetadata) };
      } catch (error) {
        diagnostics.push(browseDiagnostic(error, identity.extensionId));
        return { item: null };
      }
    }, metadataConcurrency);
    const items = results.filter((result) => result.item).map((result) => result.item);
    items.sort((left, right) => left.extensionId.localeCompare(right.extensionId));
    const publicPage = Object.freeze({
      schemaVersion: 1,
      query,
      pageIndex: index,
      items: Object.freeze(items),
      hasNext: continuationToken !== null,
      complete: continuationToken === null,
      partial: diagnostics.length > 0,
      registry: browseRegistrySummary(provider),
      diagnostics: Object.freeze(diagnostics.sort((left, right) => (left.extension || "").localeCompare(right.extension || ""))),
    });
    return { publicPage, continuationToken, identities };
  }

  async function fetchPage(index, continuationToken) {
    let searchPage;
    try {
      const search = provider.searchPage || provider.search;
      searchPage = await search.call(provider, {
        query,
        maxPages: 1,
        ...(continuationToken ? { continuationToken } : {}),
      });
    } catch (error) {
      throw lifecycleError("EXTENSION_REGISTRY_BROWSE_PAGE_FAILED", sanitizeBrowseMessage(error.message), {
        query,
        pageIndex: index,
        retryable: true,
        ...(error.code ? { causeCode: error.code } : {}),
      });
    }
    const identities = [];
    for (const identity of searchPage.items || []) {
      if (!browseIdentityMatches(identity, query) || seenIdentities.has(identity.extensionId)) continue;
      seenIdentities.add(identity.extensionId);
      identities.push(Object.freeze({ packageName: identity.packageName, extensionId: identity.extensionId }));
    }
    return materializePage(index, identities, searchPage.continuationToken || null);
  }

  async function next() {
    assertOpen();
    if (currentIndex + 1 < pages.length) {
      currentIndex += 1;
      return pages[currentIndex].publicPage;
    }
    const index = pages.length;
    const continuationToken = index === 0 ? null : pages[index - 1].continuationToken;
    if (index > 0 && continuationToken === null) return pages[currentIndex].publicPage;
    const page = await fetchPage(index, continuationToken);
    pages.push(page);
    currentIndex = index;
    return page.publicPage;
  }

  async function previous() {
    assertOpen();
    if (currentIndex > 0) currentIndex -= 1;
    return currentIndex >= 0 ? pages[currentIndex].publicPage : null;
  }

  async function retry() {
    assertOpen();
    if (currentIndex < 0) return next();
    const current = pages[currentIndex];
    const page = await materializePage(currentIndex, current.identities, current.continuationToken, true);
    pages[currentIndex] = page;
    return page.publicPage;
  }

  function current() {
    assertOpen();
    return currentIndex >= 0 ? pages[currentIndex].publicPage : null;
  }

  function close() {
    if (closed) return;
    closed = true;
    pages.length = 0;
    metadataCache.clear();
    seenIdentities.clear();
  }

  return Object.freeze({ query, next, previous, retry, current, close });
}

async function getRegistryExtensionInfo(options = {}) {
  const provider = options.provider || await createNexusExtensionPackageProvider(options);
  const extensionId = extensionIdFromName(options.name || options.id);
  const metadata = await provider.getPackageMetadata(extensionId);
  const versions = metadata.versions.map(metadataVersionModel);
  return Object.freeze({
    schemaVersion: 1,
    packageName: metadata.packageName,
    extensionId,
    description: metadata.description,
    registry: Object.freeze({
      scope: NPM_SCOPE,
      origin: provider.configuration.registryOrigin,
      repository: provider.configuration.repository,
    }),
    versions: Object.freeze(versions),
    defaultCandidate: defaultMetadataCandidate(versions),
    verification: Object.freeze({
      level: "metadata-only",
      description: "Compatibility is pre-screened from npm metadata. The tarball, manifest, entry, runtime, and package digest are verified before installation.",
    }),
  });
}

function storeChoiceFacts(storeRoot) {
  const byId = new Map();
  for (const record of listPackageReferences(storeRoot)) {
    try {
      const packageRecord = packageRecordFromDirectory(packageRoot(storeRoot, record.id, record.version), {
        id: record.id,
        version: record.version,
      });
      if (!SUPPORTED_EXTENSION_SPEC_VERSIONS.includes(packageRecord.manifest.extensionSpecVersion)) continue;
      if (isPrerelease(packageRecord.version)) continue;
      const current = byId.get(record.id);
      if (!current || compareVersions(packageRecord.version, current.version) < 0) byId.set(record.id, packageRecord);
    } catch (error) {
      if (error.code !== "EXTENSION_STORE_PACKAGE_MISSING") throw error;
    }
  }
  return byId;
}

function choiceCandidate(id, version, packageSha256, source, name, description, extensionSpecVersion) {
  return { id, version, packageSha256, source, name, description, extensionSpecVersion };
}

function mergeChoiceCandidates(id, candidates) {
  const selected = candidates.reduce((best, candidate) => {
    if (!best) return candidate;
    const compared = compareVersions(candidate.version, best.version);
    if (compared < 0) return candidate;
    if (compared === 0 && candidate.packageSha256 !== best.packageSha256) {
      throw lifecycleError("EXTENSION_REGISTRY_PACKAGE_CONFLICT", `Providers disagree on the package digest for ${id}@${candidate.version}`, {
        extension: id,
        version: candidate.version,
        packageSha256: candidate.packageSha256,
        conflictingPackageSha256: best.packageSha256,
        sources: [...new Set([candidate.source, best.source])].sort(),
      });
    }
    return best;
  }, null);
  return selected || null;
}

async function listRegistryExtensionChoices(options = {}) {
  const provider = await resolveRegistryProvider(options);
  const systemIds = new Set(discoverSystemExtensions({
    tolerant: true,
    ...(options.extensionsRoot ? { extensionsRoot: options.extensionsRoot } : {}),
  }).catalog.map((entry) => entry.id));
  const remote = provider ? await searchRegistryExtensions({ provider, ...options }) : null;
  const storeRoot = options.storeRoot || options.extensionStoreRoot;
  const store = storeRoot ? storeChoiceFacts(storeRoot) : new Map();
  const byId = new Map();

  if (remote) {
    for (const item of remote.items) {
      if (systemIds.has(item.extensionId)) continue;
      if (!byId.has(item.extensionId)) byId.set(item.extensionId, []);
      if (item.latestCandidate) {
        byId.get(item.extensionId).push(choiceCandidate(
          item.extensionId,
          item.latestCandidate.version,
          item.latestCandidate.packageSha256,
          "nexus",
          item.name,
          item.description,
          item.latestCandidate.extensionSpecVersion
        ));
      }
    }
  }
  for (const [id, packageRecord] of store) {
    if (systemIds.has(id)) continue;
    if (!byId.has(id)) byId.set(id, []);
    byId.get(id).push(choiceCandidate(
      id,
      packageRecord.version,
      packageRecord.packageSha256,
      "store",
      packageRecord.manifest.name,
      packageRecord.manifest.description,
      packageRecord.manifest.extensionSpecVersion
    ));
  }

  const choices = [];
  for (const [id, candidates] of byId) {
    const selected = mergeChoiceCandidates(id, candidates);
    choices.push(Object.freeze({
      id,
      name: selected?.name || id,
      description: selected?.description || `${id} has no default compatible version`,
      version: selected?.version || null,
      extensionSpecVersion: selected?.extensionSpecVersion || null,
      packageSha256: selected?.packageSha256 || null,
      source: selected?.source || null,
      available: Boolean(selected),
    }));
  }
  return Object.freeze(choices.sort((left, right) => left.id.localeCompare(right.id)).map(Object.freeze));
}

function builtinFact(id, options = {}) {
  if (!isSystemExtensionId(id, options)) return { candidates: [], diagnostics: [] };
  const catalogResult = discoverSystemExtensions({
    tolerant: true,
    ...(options.extensionsRoot ? { extensionsRoot: options.extensionsRoot } : {}),
  });
  const catalog = catalogResult;
  const entry = catalog.catalog.find((item) => item.id === id);
  if (!entry) {
    return {
      candidates: [],
      diagnostics: catalogResult.invalid.filter((item) => item.id === id).map((item) => ({
        code: item.code,
        severity: "warning",
        message: item.message,
        extension: id,
      })),
    };
  }
  return {
    candidates: entry.versions.filter((version) => version.supported).map((version) => ({
      version: version.version,
      extensionSpecVersion: version.extensionSpecVersion,
      packageSha256: version.packageSha256,
      source: "builtin",
      local: true,
      package: version,
    })),
    diagnostics: [],
  };
}

function storeFacts(id, options = {}) {
  if (!options.storeRoot && !options.extensionStoreRoot) return [];
  const storeRoot = options.storeRoot || options.extensionStoreRoot;
  const records = listPackageReferences(storeRoot, { id });
  const candidates = [];
  for (const record of records) {
    try {
      const root = packageRoot(storeRoot, id, record.version);
      if (!fs.existsSync(path.join(root, "manifest.json"))) continue;
      const packageRecord = packageRecordFromDirectory(root, { id, version: record.version });
      candidates.push({
        version: record.version,
        extensionSpecVersion: packageRecord.manifest.extensionSpecVersion,
        packageSha256: packageRecord.packageSha256,
        source: "store",
        local: true,
        package: packageRecord,
        provenance: record.provenance,
      });
    } catch (error) {
      if (error.code !== "EXTENSION_STORE_PACKAGE_MISSING") throw error;
    }
  }
  return candidates;
}

async function nexusFacts(id, provider, options = {}) {
  if (!provider) return { candidates: [], configured: false };
  try {
    const metadata = await provider.getPackageMetadata(id, options);
    return {
      candidates: metadata.versions.map((entry) => ({
        version: entry.version,
        extensionSpecVersion: entry.extensionSpecVersion,
        packageSha256: entry.transport.codeWorkspace.packageSha256,
        source: "nexus",
        local: false,
        deprecated: entry.deprecated,
        ...(entry.deprecatedReason ? { deprecatedReason: entry.deprecatedReason } : {}),
        package: entry,
      })),
      configured: true,
    };
  } catch (error) {
    if (error.code === "EXTENSION_REGISTRY_PACKAGE_NOT_FOUND") return { candidates: [], configured: true };
    throw error;
  }
}

function mergeCandidateFacts(id, facts) {
  const byVersion = new Map();
  for (const fact of facts) {
    const existing = byVersion.get(fact.version);
    if (!existing) {
      byVersion.set(fact.version, {
        version: fact.version,
        extensionSpecVersion: fact.extensionSpecVersion,
        packageSha256: fact.packageSha256,
        sources: new Set([fact.source]),
        localFact: fact.local ? fact : null,
        deprecated: fact.deprecated === true,
        ...(fact.deprecatedReason ? { deprecatedReason: fact.deprecatedReason } : {}),
      });
      continue;
    }
    if (existing.packageSha256 !== fact.packageSha256) {
      throw lifecycleError("EXTENSION_REGISTRY_PACKAGE_CONFLICT", `Providers disagree on the package digest for ${id}@${fact.version}`, {
        extension: id,
        version: fact.version,
        packageSha256: fact.packageSha256,
        conflictingPackageSha256: existing.packageSha256,
        sources: [...existing.sources, fact.source].sort(),
      });
    }
    existing.sources.add(fact.source);
    if (fact.local && !existing.localFact) existing.localFact = fact;
    if (fact.deprecated) {
      existing.deprecated = true;
      if (fact.deprecatedReason) existing.deprecatedReason = fact.deprecatedReason;
    }
  }
  return [...byVersion.values()]
    .map((entry) => ({
      ...entry,
      sources: Object.freeze([...entry.sources].sort()),
      local: Boolean(entry.localFact),
    }))
    .sort((left, right) => compareVersions(left.version, right.version))
    .map((entry) => Object.freeze(entry));
}

function chooseCandidate(id, candidates, options = {}) {
  const supported = candidates.filter((entry) => SUPPORTED_EXTENSION_SPEC_VERSIONS.includes(entry.extensionSpecVersion));
  if (options.version) {
    const version = parseSemver(options.version).raw;
    const candidate = supported.find((entry) => entry.version === version);
    if (!candidate) {
      throw lifecycleError("EXTENSION_REGISTRY_PACKAGE_NOT_FOUND", `Extension ${id}@${version} was not found in the available providers`, {
        extension: id,
        version,
      });
    }
    if (candidate.deprecated && options.allowDeprecated !== true) {
      throw lifecycleError("EXTENSION_REGISTRY_PACKAGE_DEPRECATED", `Extension ${id}@${version} is deprecated`, {
        extension: id,
        version,
        ...(candidate.deprecatedReason ? { reason: candidate.deprecatedReason } : {}),
        remediation: "Request the exact deprecated version with --allow-deprecated if this is intentional.",
      });
    }
    return candidate;
  }
  const candidate = supported.find((entry) => !isPrerelease(entry.version) && !entry.deprecated);
  if (!candidate) {
    throw lifecycleError("EXTENSION_NO_DEFAULT_CANDIDATE", `Extension ${id} has no stable, non-deprecated version compatible with this Host`, {
      extension: id,
      supportedExtensionSpecVersions: [...SUPPORTED_EXTENSION_SPEC_VERSIONS],
    });
  }
  return candidate;
}

async function resolveRegistryExtensionCandidate(options = {}) {
  const id = extensionIdFromName(options.name || options.id);
  if (isSystemExtensionId(id, options)) {
    const facts = builtinFact(id, options);
    return {
      id,
      candidates: mergeCandidateFacts(id, facts.candidates),
      selected: chooseCandidate(id, mergeCandidateFacts(id, facts.candidates), options),
      provider: null,
      registryConfigured: false,
      system: true,
      resolutionScope: "builtin-only",
      diagnostics: facts.diagnostics,
    };
  }
  const provider = await resolveRegistryProvider(options);
  const store = storeFacts(id, options);
  const remote = await nexusFacts(id, provider, options);
  const candidates = mergeCandidateFacts(id, [...store, ...remote.candidates]);
  if (candidates.length === 0) {
    throw lifecycleError("EXTENSION_NOT_FOUND", `Extension is not available from the configured providers: ${id}`, { extension: id });
  }
  return {
    id,
    candidates,
    selected: chooseCandidate(id, candidates, options),
    provider,
    registryConfigured: remote.configured,
    system: false,
    resolutionScope: options.offline === true || !remote.configured ? "local-only" : "registry",
    diagnostics: [],
  };
}

function planFromPackageRecord(id, packageRecord, options = {}) {
  const manifest = {
    ...packageRecord.manifest,
    capabilities: {
      networkHosts: packageRecord.manifest.capabilities?.networkHosts || [],
    },
  };
  const versionRecord = {
    id,
    version: packageRecord.version,
    extensionSpecVersion: packageRecord.manifest.extensionSpecVersion,
    sourceRoot: packageRecord.root || packageRecord.sourceRoot,
    manifestFile: packageRecord.manifestFile || `${packageRecord.root || packageRecord.sourceRoot}/manifest.json`,
    entryFile: packageRecord.entryFile || `${packageRecord.root || packageRecord.sourceRoot}/${packageRecord.manifest.entry}`,
    manifest,
    manifestSha256: packageRecord.manifestSha256,
    entrySha256: packageRecord.entrySha256,
    packageSha256: packageRecord.packageSha256,
    supported: true,
  };
  const catalogEntry = {
    id,
    system: false,
    name: packageRecord.manifest.name,
    description: packageRecord.manifest.description,
    versions: [versionRecord],
    latestSupported: versionRecord,
  };
  const plan = resolveExtensionPlans([catalogEntry], [id], {
    tools: options.tools || [],
    state: options.state,
  })[0];
  return Object.freeze({
    ...plan,
    source: options.source || (packageRecord.provenance?.kind === "nexus-npm" ? "nexus" : "store"),
    provenance: packageRecord.provenance || Object.freeze({ kind: "nexus" }),
    resolutionScope: options.resolutionScope || "registry",
    requestedVersion: options.requestedVersion || null,
  });
}

async function prepareRegistryExtensionPlans(options = {}) {
  const requested = normalizeExtensionNames(options.requested || []);
  if (options.version && requested.length !== 1) {
    throw lifecycleError("EXTENSION_VERSION_SELECTION_INVALID", "--version requires exactly one extension name", {
      names: requested,
      remediation: "Use extension install <name> --version <exact-semver>, or omit --version for a batch.",
    });
  }
  if (options.version) parseSemver(options.version);
  const plans = [];
  const failures = [];
  const diagnostics = [];
  if (options.stateError) {
    for (const id of requested) {
      failures.push({ id, version: null, status: "failed", code: options.stateError.code || "EXTENSION_STATE_INVALID", message: options.stateError.message, statePersisted: false, phase: "prepare" });
    }
    return { plans, failures, diagnostics };
  }
  const planningState = structuredClone(options.state);
  for (const id of requested) {
    try {
      if (isSystemExtensionId(id, options)) {
        throw lifecycleError("EXTENSION_SYSTEM_MANAGED", `System extension is managed automatically by init: ${id}`, { extension: id });
      }
      const resolution = await resolveRegistryExtensionCandidate({ ...options, name: id });
      const selected = resolution.selected;
      let packageRecord = selected.localFact?.package;
      if (!packageRecord) {
        packageRecord = await resolution.provider.import(id, selected.version, {
          ...(options.storeRoot ? { storeRoot: options.storeRoot } : {}),
          ...(options.extensionStoreRoot ? { storeRoot: options.extensionStoreRoot } : {}),
          ...(options.version ? { version: options.version } : {}),
          allowDeprecated: options.allowDeprecated === true,
        });
      }
      const plan = planFromPackageRecord(id, packageRecord, {
        tools: options.tools,
        state: planningState,
        source: selected.sources.includes("store") ? "store" : "nexus",
        resolutionScope: resolution.resolutionScope,
        requestedVersion: options.version || null,
      });
      plans.push(plan);
      planningState.extensions[id] = {
        installed: {
          system: false,
          artifacts: plan.artifacts.map((artifact) => ({ id: artifact.id, kind: artifact.kind, ownership: artifact.ownership, target: artifact.target, ...(artifact.selector ? { selector: artifact.selector } : {}) })),
          hooks: plan.hooks.map((hook) => ({ ...hook })),
        },
      };
    } catch (error) {
      failures.push({
        id,
        version: options.version || null,
        status: "failed",
        code: error.code || "EXTENSION_INSTALL_FAILED",
        message: error.message,
        statePersisted: false,
        phase: "prepare",
      });
    }
  }
  return { plans, failures, diagnostics };
}

module.exports = {
  DEFAULT_BROWSE_METADATA_CONCURRENCY,
  DEFAULT_BROWSE_METADATA_TIMEOUT_MS,
  DEFAULT_SEARCH_LIMIT,
  createExtensionBrowseSession: createRegistryExtensionBrowseSession,
  createRegistryExtensionBrowseSession,
  getRegistryExtensionInfo,
  listRegistryExtensionChoices,
  prepareRegistryExtensionPlans,
  resolveRegistryExtensionCandidate,
  searchRegistryExtensions,
};
