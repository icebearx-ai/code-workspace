const fs = require("node:fs");
const path = require("node:path");

const { atomicWrite } = require("./fs");
const { WorkspaceError } = require("./errors");

const START = "# BEGIN workspace-permissions:openspec-workspace";
const END = "# END workspace-permissions:openspec-workspace";

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function blockPattern(start, end) {
  return new RegExp(`${escapeRegExp(start)}[\\s\\S]*?${escapeRegExp(end)}\\n?`, "g");
}

function render(projects) {
  const roots = projects.map((project) => `  ${JSON.stringify(project.location)},`).join("\n");
  return `${START}\nsandbox_mode = "workspace-write"\napproval_policy = "on-request"\n\n[sandbox_workspace_write]\nwritable_roots = [\n${roots}\n]\n${END}\n`;
}

function unmanagedConflicts(text) {
  const stripped = text.replace(blockPattern(START, END), "");
  const conflicts = [];
  let section = "";
  for (const line of stripped.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const header = trimmed.match(/^\[([^\]]+)\]$/);
    if (header) {
      section = header[1];
      if (section === "sandbox_workspace_write") conflicts.push("[sandbox_workspace_write]");
      continue;
    }
    if (!section && /^(sandbox_mode|approval_policy)\s*=/.test(trimmed)) conflicts.push(trimmed.split("=")[0].trim());
  }
  return [...new Set(conflicts)];
}

function syncPermissions(root, projects, options = {}) {
  const file = path.join(root, ".codex", "config.toml");
  const current = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
  const conflicts = unmanagedConflicts(current);
  if (conflicts.length > 0) throw new WorkspaceError("WORKSPACE_PERMISSIONS_CONFLICT", `Unmanaged Codex sandbox configuration conflicts: ${conflicts.join(", ")}`, { conflicts });
  const outside = current
    .replace(blockPattern(START, END), "")
    .replace(/^\s+/, "");
  const desired = `${render(projects)}${outside ? `\n${outside}` : ""}`;
  const normalized = desired.endsWith("\n") ? desired : `${desired}\n`;
  if (normalized === current) return { action: "skip", file, writableRoots: projects.length };
  (options.atomicWrite || atomicWrite)(file, normalized);
  let actual;
  try {
    actual = fs.readFileSync(file, "utf8");
  } catch (error) {
    throw new WorkspaceError("WORKSPACE_PERMISSIONS_VERIFY_FAILED", `Cannot verify synchronized Codex permissions: ${error.message}`, {
      file,
      cause: error.code || error.name,
      remediation: "Re-run openspec-w sync after checking write access to .codex/config.toml.",
    });
  }
  if (actual !== normalized || !actual.includes(START) || !actual.includes(END)) {
    throw new WorkspaceError("WORKSPACE_PERMISSIONS_VERIFY_FAILED", "Synchronized Codex permissions did not match the planned managed block.", {
      file,
      writableRoots: projects.length,
      remediation: "Inspect .codex/config.toml and re-run openspec-w sync.",
    });
  }
  return { action: "write", file, writableRoots: projects.length };
}

module.exports = { END, START, render, syncPermissions, unmanagedConflicts };
