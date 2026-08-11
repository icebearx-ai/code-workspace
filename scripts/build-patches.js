const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { createTwoFilesPatch } = require("diff");

const { atomicWrite, sha256 } = require("../src/core/fs");

const repositoryRoot = path.resolve(__dirname, "..");
const artifactsRoot = path.join(repositoryRoot, "artifacts");
const manifestFile = path.join(artifactsRoot, "manifest.json");
const checksumOnlySources = new Set([
  "templates/openspec/workspace-workflow/schema.yaml",
]);

function normalizeText(value) {
  const normalized = String(value).replace(/\r\n?/g, "\n");
  return normalized.endsWith("\n") ? normalized : `${normalized}\n`;
}

function stripPatchPrefix(file) {
  return file.replace(/^[ab]\//, "");
}

function normalizePatch(value) {
  return normalizeText(value).split("\n").map((line) => {
    if (/^\s+$/.test(line)) return "";
    return line === "+ " ? "+" : line;
  }).join("\n");
}

function generatePatch(manifest, source, baselineRoot) {
  const descriptor = manifest.resources.openspec;
  const entries = manifest.managedFiles
    .filter((entry) => entry.provenance?.sourceId === source.id)
    .sort((left, right) => left.target.localeCompare(right.target));
  if (entries.length === 0) throw new Error(`Patch source has no managed targets: ${source.id}`);
  const sections = [];
  for (const entry of entries) {
    const baselineFile = path.join(baselineRoot, stripPatchPrefix(entry.target));
    const desiredFile = path.join(artifactsRoot, entry.desired.source);
    if (!fs.existsSync(baselineFile)) throw new Error(`Generated OpenSpec baseline is missing: ${entry.target}`);
    if (!fs.existsSync(desiredFile)) throw new Error(`Compiled patch output is missing: ${entry.desired.source}`);
    const baseline = normalizeText(fs.readFileSync(baselineFile, "utf8"));
    const desired = normalizeText(fs.readFileSync(desiredFile, "utf8"));
    const baselineSha = sha256(baseline);
    if (!(entry.replaceable || []).some((accepted) => accepted.sha256 === baselineSha)) {
      throw new Error(`Generated OpenSpec baseline fingerprint is not replaceable: ${entry.target}`);
    }
    sections.push(createTwoFilesPatch(
      `a/${entry.target}`,
      `b/${entry.target}`,
      baseline,
      desired,
      `OpenSpec ${descriptor.selectedVersion}`,
      "workspace override"
    ));
    entry.desired.sha256 = sha256(desired);
  }
  const content = normalizePatch(sections.join("\n"));
  atomicWrite(path.join(artifactsRoot, source.path), content);
  source.sha256 = sha256(content);
  return entries.length;
}

function main() {
  const manifest = JSON.parse(fs.readFileSync(manifestFile, "utf8"));
  const descriptor = manifest.resources.openspec;
  const baselineRoot = fs.mkdtempSync(path.join(os.tmpdir(), "openspec-patch-build-"));
  let generated = 0;
  try {
    execFileSync("openspec", [
      "init",
      ".",
      "--tools",
      descriptor.tools.join(","),
      "--profile",
      descriptor.profile,
    ], { cwd: baselineRoot, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    for (const source of manifest.sources || []) {
      if (source.kind === "patch") generated += generatePatch(manifest, source, baselineRoot);
    }
    for (const entry of manifest.managedFiles || []) {
      if (!checksumOnlySources.has(entry.desired?.source)) continue;
      const file = path.join(artifactsRoot, entry.desired.source);
      entry.desired.sha256 = sha256(fs.readFileSync(file));
    }
    atomicWrite(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`);
  } finally {
    fs.rmSync(baselineRoot, { recursive: true, force: true });
  }
  process.stdout.write(`Regenerated ${generated} managed outputs across versioned OpenSpec patches.\n`);
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`ERROR ${error.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = { generatePatch, normalizePatch, normalizeText, stripPatchPrefix };
