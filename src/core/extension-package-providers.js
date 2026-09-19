const path = require("node:path");

const { inspectExtensionPackageDirectory, SYSTEM_EXTENSION_IDS } = require("./extensions");

function providerError(code, message, details = {}) {
  return new (require("./errors").WorkspaceError)(code, message, details);
}

function createBuiltinExtensionPackageProvider(options = {}) {
  const extensionsRoot = path.resolve(options.extensionsRoot || path.join(__dirname, "..", "..", "extensions"));
  return Object.freeze({
    kind: "builtin",
    providerId: "builtin",
    async getPackageCandidate(id, version) {
      if (!SYSTEM_EXTENSION_IDS.has(String(id || ""))) {
        throw providerError(
          "EXTENSION_BUILTIN_SOURCE_UNSUPPORTED",
          `Ordinary extension ${id} is not available from the built-in provider.`,
          { extension: id, remediation: "Use the configured Nexus Registry." }
        );
      }
      const inspected = inspectExtensionPackageDirectory(path.join(extensionsRoot, id, version), {
        expectedId: id,
        expectedVersion: version,
      });
      return Object.freeze({
        schemaVersion: 1,
        providerKind: "builtin",
        extensionId: inspected.id,
        version: inspected.version,
        extensionSpecVersion: inspected.extensionSpecVersion,
        sourceRoot: inspected.sourceRoot,
        manifestSha256: inspected.manifestSha256,
        entrySha256: inspected.entrySha256,
        packageSha256: inspected.packageSha256,
        provenance: Object.freeze({ kind: "builtin" }),
      });
    },
  });
}

module.exports = {
  createBuiltinExtensionPackageProvider,
  providerError,
};
