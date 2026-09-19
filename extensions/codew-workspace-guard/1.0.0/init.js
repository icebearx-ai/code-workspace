#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");

const ID = "codew-workspace-guard";
const VERSION = "1.0.0";

function option(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

function writeAsset(outputRoot, source, target, replacements = {}) {
  const destination = path.join(outputRoot, ...target.split("/"));
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  let content = fs.readFileSync(path.join(__dirname, ...source.split("/")), "utf8");
  for (const [token, value] of Object.entries(replacements)) content = content.split(token).join(value);
  fs.writeFileSync(destination, content);
}

function main() {
  const contextFile = option("--context");
  const outputRoot = option("--output");
  const resultFile = option("--result");
  if (!contextFile || !outputRoot || !resultFile) throw new Error("Usage: init.js --context <file> --output <directory> --result <file>");
  const context = JSON.parse(fs.readFileSync(contextFile, "utf8"));
  if (context.schemaVersion !== 1 || context.extensionSpecVersion !== 1 || context.extension?.id !== ID || context.extension.version !== VERSION) throw new Error("Invalid extension context");
  const outputs = [];
  const add = (id, source) => outputs.push({ id, source });

  if (context.tools.includes("codex")) {
    writeAsset(outputRoot, "assets/templates/WORKSPACE_GUARD.md.template", "AGENTS.md", {
      "{{ADD_PROJECTS_INVOCATION}}": "$codew-add-projects /absolute/path/to/project",
    });
    add("workspace-codex-instructions", "AGENTS.md");
    writeAsset(outputRoot, "assets/codew-add-projects.SKILL.md", "codex/skills/codew-add-projects/SKILL.md");
    add("codex-add-projects-skill", "codex/skills/codew-add-projects/SKILL.md");
    writeAsset(outputRoot, "assets/codex/add-projects-openai.yaml", "codex/skills/codew-add-projects/agents/openai.yaml");
    add("codex-add-projects-openai", "codex/skills/codew-add-projects/agents/openai.yaml");
    writeAsset(outputRoot, "assets/codew-resolve-branch.SKILL.md", "codex/skills/codew-resolve-branch/SKILL.md");
    add("codex-resolve-branch-skill", "codex/skills/codew-resolve-branch/SKILL.md");
    writeAsset(outputRoot, "assets/codex/resolve-branch-openai.yaml", "codex/skills/codew-resolve-branch/agents/openai.yaml");
    add("codex-resolve-branch-openai", "codex/skills/codew-resolve-branch/agents/openai.yaml");
  }
  if (context.tools.includes("claude")) {
    writeAsset(outputRoot, "assets/templates/WORKSPACE_GUARD.md.template", "CLAUDE.md", {
      "{{ADD_PROJECTS_INVOCATION}}": "/codew:add-projects /absolute/path/to/project",
    });
    add("workspace-claude-instructions", "CLAUDE.md");
    writeAsset(outputRoot, "assets/codew-add-projects.SKILL.md", "claude/skills/codew-add-projects/SKILL.md");
    add("claude-add-projects-skill", "claude/skills/codew-add-projects/SKILL.md");
    writeAsset(outputRoot, "assets/claude/add-projects.md", "claude/commands/codew/add-projects.md");
    add("claude-add-projects-command", "claude/commands/codew/add-projects.md");
    writeAsset(outputRoot, "assets/codew-resolve-branch.SKILL.md", "claude/skills/codew-resolve-branch/SKILL.md");
    add("claude-resolve-branch-skill", "claude/skills/codew-resolve-branch/SKILL.md");
  }

  fs.writeFileSync(resultFile, `${JSON.stringify({ schemaVersion: 1, extensionSpecVersion: 1, extension: { id: ID, version: VERSION }, outputs }, null, 2)}\n`, { mode: 0o600 });
}

try { main(); } catch (error) { process.stderr.write(`${error.message}\n`); process.exitCode = 1; }
