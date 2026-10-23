"use strict";

const { WorkspaceError } = require("./errors");

const AGENT_TOOLS = Object.freeze([
  { name: "Amazon Q Developer", value: "amazon-q", skillsDir: ".amazonq" },
  { name: "Antigravity", value: "antigravity", skillsDir: ".agent" },
  { name: "Auggie (Augment CLI)", value: "auggie", skillsDir: ".augment" },
  { name: "Bob Shell", value: "bob", skillsDir: ".bob" },
  { name: "Claude Code", value: "claude", skillsDir: ".claude" },
  { name: "Cline", value: "cline", skillsDir: ".cline" },
  { name: "Codex", value: "codex", skillsDir: ".codex" },
  { name: "ForgeCode", value: "forgecode", skillsDir: ".forge" },
  { name: "CodeBuddy Code (CLI)", value: "codebuddy", skillsDir: ".codebuddy" },
  { name: "Continue", value: "continue", skillsDir: ".continue" },
  { name: "CoStrict", value: "costrict", skillsDir: ".cospec" },
  { name: "Crush", value: "crush", skillsDir: ".crush" },
  { name: "Cursor", value: "cursor", skillsDir: ".cursor" },
  { name: "DeepSeek", value: "deepseek", skillsDir: ".deepseek" },
  { name: "Factory Droid", value: "factory", skillsDir: ".factory" },
  { name: "Gemini CLI", value: "gemini", skillsDir: ".gemini" },
  { name: "GitHub Copilot", value: "github-copilot", skillsDir: ".github" },
  { name: "iFlow", value: "iflow", skillsDir: ".iflow" },
  { name: "Junie", value: "junie", skillsDir: ".junie" },
  { name: "Kilo Code", value: "kilocode", skillsDir: ".kilocode" },
  { name: "Kimi CLI", value: "kimi", skillsDir: ".kimi" },
  { name: "Kiro", value: "kiro", skillsDir: ".kiro" },
  { name: "Lingma", value: "lingma", skillsDir: ".lingma" },
  { name: "Mistral Vibe", value: "vibe", skillsDir: ".vibe" },
  { name: "OpenCode", value: "opencode", skillsDir: ".opencode" },
  { name: "Pi", value: "pi", skillsDir: ".pi" },
  { name: "Qoder", value: "qoder", skillsDir: ".qoder" },
  { name: "Qwen Code", value: "qwen", skillsDir: ".qwen" },
  { name: "RooCode", value: "roocode", skillsDir: ".roo" },
  { name: "Trae", value: "trae", skillsDir: ".trae" },
  { name: "Windsurf", value: "windsurf", skillsDir: ".windsurf" },
]);

const SUPPORTED_TOOLS = Object.freeze(AGENT_TOOLS.map((t) => t.value));

function getToolDefinition(toolId) {
  return AGENT_TOOLS.find((t) => t.value === toolId) || null;
}

function normalizeTools(value, label = "tools") {
  let tools;
  if (Array.isArray(value)) tools = value;
  else if (value === "none") tools = [];
  else if (value === "all") tools = [...SUPPORTED_TOOLS];
  else tools = String(value || "").split(",").map((entry) => entry.trim()).filter(Boolean);
  const normalized = [...new Set(tools)];
  const unsupported = normalized.filter((tool) => !SUPPORTED_TOOLS.includes(tool));
  if (unsupported.length > 0) {
    throw new WorkspaceError("CLI_INVALID_TOOLS", `Unsupported AI tool${unsupported.length === 1 ? "" : "s"}: ${unsupported.join(", ")}`, {
      actual: unsupported,
      supported: SUPPORTED_TOOLS,
      source: label,
    });
  }
  return normalized;
}

function resolveWorkspaceTools(options = {}) {
  if (options.explicit !== undefined) {
    return { tools: normalizeTools(options.explicit, "cli"), source: "cli" };
  }
  const persisted = options.state?.tools;
  if (persisted !== undefined) {
    return { tools: normalizeTools(persisted, "workspace-state"), source: "workspace-state" };
  }
  return { tools: normalizeTools(options.manifestTools || ["claude", "codex"], "manifest"), source: "manifest" };
}

const PERMISSION_CAPABLE_TOOLS = Object.freeze(["claude", "codex"]);

function filterPermissionCapable(tools) {
  return (tools || []).filter((tool) => PERMISSION_CAPABLE_TOOLS.includes(tool));
}

module.exports = {
  AGENT_TOOLS,
  SUPPORTED_TOOLS,
  PERMISSION_CAPABLE_TOOLS,
  filterPermissionCapable,
  getToolDefinition,
  normalizeTools,
  resolveWorkspaceTools,
};
