const fs = require("node:fs");

const PROJECT_NOT_AFFECTED = /不涉及|not\s+involved|not\s+affected/i;

function sectionText(markdown, title) {
  const lines = markdown.split(/\r?\n/);
  const startPattern = new RegExp(`^##\\s+${title}\\s*$`, "i");
  const start = lines.findIndex((line) => startPattern.test(line.trim()));
  if (start < 0) return "";
  const section = [];
  for (let index = start + 1; index < lines.length; index += 1) {
    if (/^##\s+/.test(lines[index])) break;
    section.push(lines[index]);
  }
  return section.join("\n");
}

function subsectionText(markdown, title) {
  const lines = markdown.split(/\r?\n/);
  const startPattern = new RegExp(`^###\\s+${title}\\s*$`, "i");
  const start = lines.findIndex((line) => startPattern.test(line.trim()));
  if (start < 0) return "";
  const section = [];
  for (let index = start + 1; index < lines.length; index += 1) {
    if (/^#{2,3}\s+/.test(lines[index])) break;
    section.push(lines[index]);
  }
  return section.join("\n");
}

function parseAffectedProjects(proposalFile) {
  if (!fs.existsSync(proposalFile)) return [];
  const section = sectionText(fs.readFileSync(proposalFile, "utf8"), "Affected Projects");
  const projects = new Set();
  for (const line of section.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("-") || PROJECT_NOT_AFFECTED.test(trimmed)) continue;
    const backtick = trimmed.match(/`([^`]+)`/);
    const plain = trimmed.match(/^-\s+([^:：\s]+)\s*[:：]/);
    const name = backtick ? backtick[1] : plain ? plain[1] : null;
    if (name) projects.add(name);
  }
  return [...projects].sort();
}

function parseCapabilitySection(markdown, title, kind) {
  const entries = [];
  const invalidLines = [];
  const pattern = /^-\s+Project\s*:\s*`([^`]+)`\s*;\s*Capability\s*:\s*`([^`]+)`\s*;\s*Description\s*:\s*(.+)$/i;
  for (const line of subsectionText(markdown, title).split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("-")) continue;
    const match = trimmed.match(pattern);
    if (!match) invalidLines.push(trimmed);
    else entries.push({ kind, project: match[1].trim(), id: match[2].trim() });
  }
  return { entries, invalidLines };
}

function parseProposalCapabilities(proposalFile) {
  if (!fs.existsSync(proposalFile)) return { entries: [], invalidLines: [] };
  const capabilities = sectionText(fs.readFileSync(proposalFile, "utf8"), "Capabilities");
  const added = parseCapabilitySection(capabilities, "New Capabilities", "new");
  const modified = parseCapabilitySection(capabilities, "Modified Capabilities", "modified");
  return {
    entries: [...added.entries, ...modified.entries],
    invalidLines: [...added.invalidLines, ...modified.invalidLines],
  };
}

function parseTaskProjects(tasksFile) {
  if (!fs.existsSync(tasksFile)) return [];
  const projects = new Set();
  for (const line of fs.readFileSync(tasksFile, "utf8").split(/\r?\n/)) {
    const match = line.match(/^##\s+\d+\.\s+([^:：]+)\s*[:：]/);
    if (match && match[1].trim() !== "Cross-project") projects.add(match[1].trim());
  }
  return [...projects].sort();
}

module.exports = { parseAffectedProjects, parseProposalCapabilities, parseTaskProjects };
