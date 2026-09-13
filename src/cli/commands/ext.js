const { commandResult, success } = require("../result");
const { executeExtensionRuntime } = require("../../core/extension-runtime");
const { ensureStoredExtensionPackage, defaultExtensionStoreRoot } = require("../../core/extension-store");
const { discoverExtensions } = require("../../core/extensions");

async function executeExt(invocation) {
  const id = invocation.args[0];
  const argv = invocation.args.slice(1);
  const extensionStoreRoot = invocation.dependencies?.extensionStoreRoot || defaultExtensionStoreRoot();
  const builtin = discoverExtensions({ tolerant: true }).catalog.find((entry) => entry.id === id)?.latestSupported;
  if (builtin) {
    ensureStoredExtensionPackage({ storeRoot: extensionStoreRoot, sourceRoot: builtin.sourceRoot, source: "builtin" });
  }
  const runtime = await executeExtensionRuntime({
    id,
    argv,
    workspaceRoot: invocation.root,
    extensionStoreRoot,
    workspace: invocation.config?.identity || invocation.config?.workspace,
    json: invocation.options.json === true,
  });
  if (runtime.plan.runtime.mode === "service") {
    const result = await runtime.result;
    return success("ext", {
      extension: { id: runtime.plan.id, version: runtime.plan.version },
      scope: runtime.plan.runtime.scope,
      mode: runtime.plan.runtime.mode,
      ...result,
    });
  }
  const envelope = runtime.result;
  const diagnostics = envelope.diagnostics || [];
  return commandResult("ext", {
    extension: { id: runtime.plan.id, version: runtime.plan.version },
    scope: runtime.plan.runtime.scope,
    mode: runtime.plan.runtime.mode,
    data: envelope.data ?? null,
  }, {
    diagnostics,
    text: envelope.text || "",
    renderTextOnError: true,
  });
}

module.exports = { executeExt };
