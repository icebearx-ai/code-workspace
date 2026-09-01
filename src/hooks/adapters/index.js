"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { HOOK_ADAPTER_CONTRACT_VERSION, HOOK_ADAPTER_METHODS } = require("./common");

function validateRelativePath(value, field, provider) {
  const relative = String(value || "");
  const normalized = path.posix.normalize(relative);
  if (
    !relative ||
    path.posix.isAbsolute(relative) ||
    relative.includes("\\") ||
    normalized !== relative ||
    normalized === ".." ||
    normalized.startsWith("../")
  ) {
    throw new Error(`Hook adapter ${provider} has invalid ${field}: ${relative || "<missing>"}`);
  }
  return relative;
}

function loadAdapters() {
  const adapters = {};
  const files = fs.readdirSync(__dirname)
    .filter((file) => /^[a-z0-9][a-z0-9-]*\.js$/i.test(file))
    .filter((file) => !["common.js", "index.js"].includes(file));
  for (const file of files) {
    const adapter = require(path.join(__dirname, file));
    if (!adapter || typeof adapter !== "object" || !adapter.provider) continue;
    const provider = String(adapter.provider).toLowerCase();
    if (!/^[a-z0-9][a-z0-9-]*$/.test(provider)) throw new Error(`Invalid Hook adapter provider: ${provider}`);
    if (adapter.contractVersion !== HOOK_ADAPTER_CONTRACT_VERSION) throw new Error(`Unsupported Hook adapter contract for ${provider}: ${adapter.contractVersion ?? "<missing>"}`);
    for (const field of ["target", "coordinationTemplate", "coordinationArtifact"]) validateRelativePath(adapter[field], field, provider);
    const missing = HOOK_ADAPTER_METHODS.filter((method) => typeof adapter[method] !== "function");
    if (missing.length > 0) throw new Error(`Hook adapter ${provider} is missing methods: ${missing.join(", ")}`);
    if (adapters[provider]) throw new Error(`Duplicate Hook adapter provider: ${provider}`);
    adapters[provider] = adapter;
  }
  return Object.freeze(adapters);
}

const ADAPTERS = loadAdapters();

function getAdapter(provider) {
  const adapter = ADAPTERS[String(provider || "").toLowerCase()];
  if (!adapter) {
    const error = new Error(`Unsupported Hook provider: ${provider}`);
    error.code = "HOOK_PROVIDER_UNSUPPORTED";
    error.details = { provider, supported: Object.keys(ADAPTERS) };
    throw error;
  }
  return adapter;
}

module.exports = { ADAPTERS, getAdapter, ...ADAPTERS };
