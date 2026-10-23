"use strict";

const fs = require("node:fs");
const path = require("node:path");

const { getAdapter } = require("./command-adapters");
const { getToolDefinition } = require("./agent-tools");
const { WorkspaceError } = require("./errors");

// Skills that should be distributed to all selected tools
const SKILL_DISTRIBUTION = Object.freeze([
  { id: "codew-getting-started", manifestId: "getting-started-skill" },
  { id: "codew-add-projects", manifestId: "add-projects-skill" },
  { id: "codew-resolve-branch", manifestId: "resolve-branch-skill" },
]);

// Find the source SKILL.md for a skill from existing managed files
function findSkillSource(manifest, skillId) {
  // Look for a managed file whose target contains this skill name
  const pattern = new RegExp(`codew-${skillId}/SKILL\\.md$`);
  const entry = manifest.managedFiles.find((e) => pattern.test(e.target));
  if (!entry) return null;
  return entry;
}

// Generate and install skill files for tools that don't have explicit manifest entries
function distributeSkillsToTools(root, manifest, tools) {
  const results = [];
  for (const toolId of tools) {
    const adapter = getAdapter(toolId);
    if (!adapter) continue;

    // Check if this tool already has manifest-managed skill entries
    const hasManagedSkills = manifest.managedFiles.some(
      (e) => e.target.startsWith(adapter.skillsDir) && e.tools?.includes(toolId)
    );
    if (hasManagedSkills) continue; // Already handled by manifest

    // For tools without manifest entries, copy the codex skill as the source
    for (const { id: skillId } of SKILL_DISTRIBUTION) {
      // Use the claude or codex skill as source content
      const sourceEntry = manifest.managedFiles.find(
        (e) => e.target.includes(skillId) && (e.target.includes(".claude/") || e.target.includes(".codex/"))
      );
      if (!sourceEntry) continue;

      const skillDir = path.join(root, adapter.skillsDir, skillId.replace("codew-", "codew-"));
      const skillFile = path.join(skillDir, "SKILL.md");

      // Read source content from the artifacts template
      const sourceRelative = sourceEntry.desired?.source;
      if (!sourceRelative) continue;
      const sourceFile = path.join(__dirname, "..", "..", "artifacts", sourceRelative);
      if (!fs.existsSync(sourceFile)) continue;

      fs.mkdirSync(skillDir, { recursive: true });
      fs.copyFileSync(sourceFile, skillFile);
      results.push({ toolId, skillId, target: path.relative(root, skillFile), action: "write" });
    }
  }
  return results;
}

module.exports = { SKILL_DISTRIBUTION, distributeSkillsToTools, findSkillSource };
