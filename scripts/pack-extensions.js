#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");

const {
  EXTENSION_PACKAGE_PREFIX,
  collectPackageFiles,
  inspectExtensionTransportTarball,
  packExtensionToDirectory,
} = require("../src/core/extension-package");
const { discoverExtensions, discoverSystemExtensions } = require("../src/core/extensions");

function outputValue(argv) {
  const index = argv.indexOf("--output");
  const value = index >= 0 ? argv[index + 1] : undefined;
  if (!value || value.startsWith("--")) {
    throw new Error("Usage: node scripts/pack-extensions.js --output <directory>");
  }
  return path.resolve(value);
}

function assertFileManifest(verified, sourceFiles) {
  const expected = [
    "package/package.json",
    ...sourceFiles.map((file) => `${EXTENSION_PACKAGE_PREFIX}/${file.relative}`),
  ];
  if (verified.files.length !== expected.length || verified.files.some((file, index) => file !== expected[index])) {
    throw new Error(`Tarball file manifest mismatch: ${verified.files.join(", ")}`);
  }
}

async function main() {
  const output = outputValue(process.argv.slice(2));
  fs.mkdirSync(output, { recursive: true });
  const manifestPath = path.join(output, "extension-packages.json");
  if (fs.existsSync(manifestPath)) throw new Error(`Package manifest already exists: ${manifestPath}`);

  const catalog = discoverExtensions();
  const systemIds = new Set(discoverSystemExtensions({ tolerant: true }).catalog.map((entry) => entry.id));
  const packages = [];
  const skipped = [];
  for (const extension of catalog) {
    if (systemIds.has(extension.id)) throw new Error(`System extension must not be published automatically: ${extension.id}`);
    for (const version of extension.versions) {
      if (!version.supported) {
        skipped.push({
          extensionId: extension.id,
          version: version.version,
          extensionSpecVersion: version.extensionSpecVersion,
          reason: "unsupported-extension-spec",
        });
        continue;
      }
      const result = await packExtensionToDirectory(version.sourceRoot, output);
      const sourceFiles = collectPackageFiles(version.sourceRoot);
      const verified = await inspectExtensionTransportTarball(result.tarball.path);
      assertFileManifest(verified, sourceFiles);
      if (verified.packageSha256 !== result.packageSha256) {
        throw new Error(`Package digest mismatch: ${extension.id}@${version.version}`);
      }
      packages.push(Object.freeze({
        extensionId: result.extensionId,
        version: result.version,
        extensionSpecVersion: result.extensionSpecVersion,
        npmName: result.npmName,
        file: result.tarball.filename,
        tarballIntegrity: result.tarball.integrity,
        manifestSha256: result.manifestSha256,
        entrySha256: result.entrySha256,
        packageSha256: result.packageSha256,
        files: result.tarball.files,
      }));
    }
  }
  const manifest = {
    schemaVersion: 1,
    npmScope: "@codew-ext",
    systemExtensionPolicy: "excluded-from-automatic-publish",
    packages: Object.freeze(packages),
    skipped: Object.freeze(skipped),
  };
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  process.stdout.write(packages.length > 0
    ? `Packed ${packages.length} extension tarballs into ${output}\n`
    : `No ordinary extensions to publish; wrote an empty package manifest to ${manifestPath}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});
