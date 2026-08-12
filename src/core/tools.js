const { WorkspaceError } = require("./errors");

const SUPPORTED_TOOLS = Object.freeze(["claude", "codex"]);

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
  return { tools: normalizeTools(options.manifestTools || SUPPORTED_TOOLS, "manifest"), source: "manifest" };
}

module.exports = { SUPPORTED_TOOLS, normalizeTools, resolveWorkspaceTools };
