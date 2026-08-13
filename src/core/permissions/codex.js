const fs = require("node:fs");
const path = require("node:path");

const { WorkspaceError } = require("../errors");
const { atomicWrite } = require("../fs");
const { assertFingerprint, planDirectoryMutation, readTarget } = require("./common");

const START = "# BEGIN workspace-permissions:code-workspace";
const END = "# END workspace-permissions:code-workspace";

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function blockPattern(start = START, end = END) {
  return new RegExp(`${escapeRegExp(start)}[\\s\\S]*?${escapeRegExp(end)}\\n?`, "g");
}

function render(directories) {
  const roots = directories.map((directory) => `  ${JSON.stringify(directory)},`).join("\n");
  return `${START}\nsandbox_mode = "workspace-write"\napproval_policy = "on-request"\n\n[sandbox_workspace_write]\nwritable_roots = [\n${roots}\n]\n${END}\n`;
}

function managedBlock(text) {
  return text.match(blockPattern())?.[0] || null;
}

function parseManagedRoots(text, file) {
  const block = managedBlock(text);
  if (!block) return [];
  const array = block.match(/writable_roots\s*=\s*\[([\s\S]*?)\]/)?.[1] || "";
  const roots = [];
  for (const line of array.split(/\r?\n/)) {
    const value = line.trim().replace(/,$/, "");
    if (!value) continue;
    try {
      const parsed = JSON.parse(value);
      if (typeof parsed !== "string") throw new Error("entry is not a string");
      roots.push(parsed);
    } catch (error) {
      throw new WorkspaceError("CODEX_PERMISSION_CONFIG_INVALID", `Cannot parse Codex writable root in ${file}: ${error.message}`, { file });
    }
  }
  return roots;
}

function unmanagedConflicts(text) {
  const stripped = text.replace(blockPattern(), "");
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

function desiredContent(current, directories) {
  const outside = current.replace(blockPattern(), "").replace(/^\s+/, "");
  const desired = `${render(directories)}${outside ? `\n${outside}` : ""}`;
  return desired.endsWith("\n") ? desired : `${desired}\n`;
}

const codexPermissionAdapter = {
  id: "codex",
  targets(root) {
    return [path.join(root, ".codex", "config.toml")];
  },
  inspect(root) {
    const target = readTarget(this.targets(root)[0]);
    const conflicts = unmanagedConflicts(target.content);
    if (conflicts.length > 0) {
      throw new WorkspaceError("WORKSPACE_PERMISSIONS_CONFLICT", `Unmanaged Codex sandbox configuration conflicts: ${conflicts.join(", ")}`, {
        tool: this.id,
        file: target.file,
        conflicts,
      });
    }
    return { ...target, directories: parseManagedRoots(target.content, target.file) };
  },
  plan({ current, grants, revokes }) {
    const mutation = planDirectoryMutation(current.directories, grants, revokes);
    return {
      tool: this.id,
      target: current.file,
      targets: [current.file],
      fingerprint: current.fingerprint,
      ...mutation,
      desiredContent: mutation.action === "write" ? desiredContent(current.content, mutation.desired) : current.content,
    };
  },
  assertCurrent(plan) {
    assertFingerprint(plan);
  },
  apply(plan, options = {}) {
    (options.atomicWrite || atomicWrite)(plan.target, plan.desiredContent);
  },
  verify(plan) {
    let actual;
    try {
      actual = fs.readFileSync(plan.target, "utf8");
    } catch (error) {
      throw new WorkspaceError("WORKSPACE_PERMISSION_VERIFY_FAILED", `Cannot verify Codex directory authorization: ${error.message}`, {
        tool: this.id,
        file: plan.target,
        remediation: "Inspect .codex/config.toml and re-run code-w permissions apply.",
      });
    }
    if (actual !== plan.desiredContent) {
      throw new WorkspaceError("WORKSPACE_PERMISSION_VERIFY_FAILED", "Codex directory authorization does not match the confirmed plan.", {
        tool: this.id,
        file: plan.target,
        remediation: "Inspect .codex/config.toml and re-run code-w permissions apply.",
      });
    }
  },
};

module.exports = { END, START, blockPattern, codexPermissionAdapter, parseManagedRoots, render, unmanagedConflicts };
