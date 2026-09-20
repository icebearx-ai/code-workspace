const {
  compareSemver,
  emptyExtensionState,
} = require("../core/extensions");
const { createRegistryExtensionBrowseSession } = require("../core/extension-registry-lifecycle");

function mapPickerPage(page, state = emptyExtensionState(), systemIds = new Set()) {
  const items = (page.items || [])
    .filter((item) => !systemIds.has(item.extensionId))
    .map((item) => {
      const candidate = item.latestCandidate;
      const installed = state.extensions[item.extensionId]?.installed;
      let status = "not-installed";
      if (!candidate) status = "unavailable";
      else if (installed) {
        const same = installed.version === candidate.version && installed.packageSha256 === candidate.packageSha256;
        status = same || compareSemver(candidate.version, installed.version) < 0 ? "installed-current" : "installed-outdated";
      }
      return {
        id: item.extensionId,
        name: item.name || item.extensionId,
        description: item.description || "",
        version: candidate?.version || null,
        packageSha256: candidate?.packageSha256 || null,
        status,
        disabled: status === "unavailable",
        allowUninstall: Boolean(installed),
        action: status === "installed-outdated" ? "update" : status === "installed-current" ? "keep" : "install",
      };
    });
  return { ...page, items };
}

function createRegistryExtensionPicker({ dependencies = {}, state = emptyExtensionState(), systemIds = new Set() }) {
  const createSession = dependencies.createRegistryExtensionBrowseSession || createRegistryExtensionBrowseSession;
  const installedIds = Object.entries(state.extensions || {})
    .filter(([id, entry]) => entry?.installed && entry.installed.system !== true && !systemIds.has(id))
    .map(([id]) => id);
  const installedSelectionActions = Object.fromEntries(installedIds.map((id) => [id, "keep"]));
  return async ({ ui, query = "", selectedIds = [] }) => ui.extensionPicker({
    query,
    selectedIds: selectedIds.length > 0 ? selectedIds : installedIds,
    selectionActions: installedSelectionActions,
    installedIds,
    pageProvider: async (pageQuery) => {
      const session = await createSession({
        ...dependencies,
        query: pageQuery,
        provider: dependencies.nexusProvider,
      });
      const map = async (method) => mapPickerPage(await session[method](), state, systemIds);
      return {
        next: () => map("next"),
        previous: () => map("previous"),
        retry: () => map("retry"),
        current: () => {
          const page = session.current();
          return page ? mapPickerPage(page, state, systemIds) : null;
        },
        close: () => session.close(),
      };
    },
  }).then((result) => Array.isArray(result) ? result : result.status === "submitted" ? result.selections : []);
}

module.exports = { createRegistryExtensionPicker, mapPickerPage };
