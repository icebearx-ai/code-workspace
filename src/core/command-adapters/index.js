"use strict";

const { claudeAdapter } = require("./claude");
const { codexAdapter } = require("./codex");
const { cursorAdapter } = require("./cursor");
const { windsurfAdapter } = require("./windsurf");
const { geminiAdapter } = require("./gemini");
const { deepseekAdapter } = require("./deepseek");

const ADAPTERS = new Map([
  [claudeAdapter.toolId, claudeAdapter],
  [codexAdapter.toolId, codexAdapter],
  [cursorAdapter.toolId, cursorAdapter],
  [windsurfAdapter.toolId, windsurfAdapter],
  [geminiAdapter.toolId, geminiAdapter],
  [deepseekAdapter.toolId, deepseekAdapter],
]);

function getAdapter(toolId) {
  return ADAPTERS.get(toolId) || null;
}

function getAdaptersForTools(toolIds) {
  return toolIds.map((id) => getAdapter(id)).filter(Boolean);
}

function getAdaptersWithHookSupport() {
  return [...ADAPTERS.values()].filter((adapter) => adapter.hookSupport === true);
}

module.exports = {
  ADAPTERS,
  getAdapter,
  getAdaptersForTools,
  getAdaptersWithHookSupport,
  claudeAdapter,
  codexAdapter,
  cursorAdapter,
  windsurfAdapter,
  geminiAdapter,
  deepseekAdapter,
};
