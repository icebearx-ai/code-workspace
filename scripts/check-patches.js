const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { applyPatch, parsePatch } = require("diff");

const { ARTIFACTS_ROOT, loadManagedManifest, resolveArtifact } = require("../src/core/managed-files");
const { sha256 } = require("../src/core/fs");

function normalizeText(value) {
  const normalized = String(value).replace(/\r\n?/g, "\n");
  return normalized.endsWith("\n") ? normalized : `${normalized}\n`;
}

function stripPatchPrefix(file) {
  return file.replace(/^[ab]\//, "");
}

function checkPatchSource(manifest, source) {
  const patchFile = resolveArtifact(source.path);
  const descriptor = manifest.resources.openspec;
  const baselineRoot = fs.mkdtempSync(path.join(os.tmpdir(), "openspec-patch-check-"));
  try {
    execFileSync("openspec", [
      "init",
      ".",
      "--tools",
      descriptor.tools.join(","),
      "--profile",
      descriptor.profile,
    ], { cwd: baselineRoot, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

    const patches = parsePatch(fs.readFileSync(patchFile, "utf8"));
    const entries = manifest.managedFiles.filter((entry) => entry.provenance?.sourceId === source.id);
    const byTarget = new Map(entries.map((entry) => [entry.target, entry]));
    for (const patch of patches) {
      const target = stripPatchPrefix(patch.newFileName || "");
      const entry = byTarget.get(target);
      if (!entry) throw new Error(`Patch target is not declared as a managed file: ${target}`);
      const baselineFile = path.join(baselineRoot, target);
      if (!fs.existsSync(baselineFile)) throw new Error(`Generated OpenSpec baseline is missing: ${target}`);
      const baseline = normalizeText(fs.readFileSync(baselineFile, "utf8"));
      const accepted = (entry.replaceable || []).some((item) => item.sha256 === sha256(baseline));
      if (!accepted) throw new Error(`Generated OpenSpec baseline fingerprint is not replaceable: ${target}`);
      const result = applyPatch(baseline, patch);
      if (result === false) throw new Error(`Patch cannot be applied to generated baseline: ${target}`);
      const desired = normalizeText(fs.readFileSync(path.join(ARTIFACTS_ROOT, entry.desired.source), "utf8"));
      if (normalizeText(result) !== desired || sha256(desired) !== entry.desired.sha256) {
        throw new Error(`Compiled patch output differs from the managed desired file: ${target}`);
      }
      byTarget.delete(target);
    }
    if (byTarget.size > 0) throw new Error(`Managed patch outputs have no patch entry: ${[...byTarget.keys()].join(", ")}`);
    return patches.length;
  } finally {
    fs.rmSync(baselineRoot, { recursive: true, force: true });
  }
}

function main() {
  const manifest = loadManagedManifest();
  let checked = 0;
  for (const source of manifest.sources || []) {
    if (source.kind === "patch") checked += checkPatchSource(manifest, source);
  }
  process.stdout.write(`Patch consistency check passed (${checked} managed outputs).\n`);
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`ERROR ${error.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = { checkPatchSource, normalizeText, stripPatchPrefix };
