"use strict";

const codex = require("./codex");
const claude = require("./claude");
const ADAPTERS = Object.freeze({ codex, claude });

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

module.exports = { ADAPTERS, getAdapter, codex, claude };
