const { styleText } = require("node:util");

const DEFAULT_MAX_ITEMS = 8;

function pickerCancelled(prompts, value) {
  return typeof prompts.isCancel === "function" && prompts.isCancel(value);
}

function normalizeQuery(value) {
  return String(value ?? "").trim();
}

function statusHint(item) {
  return {
    "not-installed": "not installed",
    "installed-current": "installed",
    "installed-outdated": "update available",
    unavailable: "unavailable",
  }[item.status] || item.status || "unknown";
}

function extensionOptionLabel(item, footerGap = false) {
  const id = String(item.id || "");
  const description = String(item.description || "").trim() || "No description";
  const version = item.version ? `v${item.version}` : "version unavailable";
  const lines = [
    `${styleText("bold", id)} · ${version} · ${statusHint(item)}`,
    `  ${styleText("dim", description)}`,
  ];
  return `${lines.join("\n")}${footerGap ? "\n" : ""}`;
}

function selectedSummary(selected) {
  const ids = selected instanceof Map ? [...selected.keys()] : [...(selected || [])];
  return ids.length ? `Selected: ${ids.join(", ")}` : "";
}

function pageMessage(page, selected) {
  const pageStatus = `Extensions · Page ${page.pageIndex + 1}${page.hasNext ? " · more available" : " · last page"} · Search extensions`;
  const summary = selectedSummary(selected);
  return summary ? `${pageStatus} · ${summary}` : pageStatus;
}

function mergePageSelections(selected, page, values) {
  const chosen = new Set(values || []);
  for (const item of page.items || []) {
    if (item.disabled) continue;
    if (chosen.has(item.id)) selected.set(item.id, item.action);
    else selected.delete(item.id);
  }
}

function selectedResult(selected) {
  return [...selected.entries()].map(([id, action]) => ({ id, action }));
}

function pageOptions(page) {
  const items = page.items || [];
  return items.map((item, index) => ({
    value: item.id,
    label: extensionOptionLabel(item, index === items.length - 1),
    disabled: item.disabled === true,
  }));
}

function createPageOptionFilter(options, { placeholder = "" } = {}) {
  const baseLabels = new Map(options.map((option) => [
    option,
    String(option.label || "").replace(/\n$/, ""),
  ]));
  const initialLabels = new Map(options.map((option) => [option, option.label]));
  let lastQuery = null;
  let lastMatch = null;

  return (query, option) => {
    const normalizedQuery = String(query || "").toLowerCase();
    const isPlaceholderProbe = placeholder && String(query || "") === placeholder;
    if (isPlaceholderProbe) {
      const label = baseLabels.get(option) || "";
      return label.toLowerCase().includes(normalizedQuery)
        || String(option.value).toLowerCase().includes(normalizedQuery);
    }
    if (normalizedQuery !== lastQuery) {
      lastQuery = normalizedQuery;
      lastMatch = null;
      for (const current of options) current.label = initialLabels.get(current);
    }

    const label = baseLabels.get(option) || "";
    const matches = !normalizedQuery
      || label.toLowerCase().includes(normalizedQuery)
      || String(option.value).toLowerCase().includes(normalizedQuery);
    if (matches) {
      if (lastMatch) lastMatch.label = baseLabels.get(lastMatch);
      option.label = `${label}\n`;
      lastMatch = option;
    }
    return matches;
  };
}

function actionOptions(page, selectedCount, failed = false) {
  const options = [];
  if (page?.hasNext) options.push({ value: "next", label: "Next page" });
  if (page && page.pageIndex > 0) options.push({ value: "previous", label: "Previous page" });
  if (failed) options.push({ value: "retry", label: "Retry loading this page" });
  options.push({ value: "search", label: "Search again" });
  options.push({ value: "done", label: `Done (${selectedCount} selected)` });
  options.push({ value: "cancel", label: "Cancel" });
  return options;
}

function failureActionOptions(page, selectedCount) {
  return actionOptions(page, selectedCount, true).filter((option) => !["next", "previous"].includes(option.value));
}

async function withSpinner(prompts, message, operation) {
  const progress = typeof prompts.spinner === "function" ? prompts.spinner() : null;
  progress?.start?.(message);
  try {
    const value = await operation();
    progress?.stop?.("Loaded");
    return { value, error: null };
  } catch (error) {
    progress?.stop?.("Unable to load extensions");
    return { value: null, error };
  }
}

async function runClackExtensionPicker(options = {}) {
  const prompts = options.prompts || {};
  const pageProvider = options.pageProvider;
  if (typeof pageProvider !== "function") {
    throw new Error("Clack extension picker requires a pageProvider");
  }
  for (const method of ["text", "autocompleteMultiselect", "select"]) {
    if (typeof prompts[method] !== "function") {
      throw new Error(`Clack extension picker requires prompts.${method}`);
    }
  }

  const selected = new Map();
  for (const id of options.selectedIds || []) selected.set(String(id), "install");
  let query = String(options.query || "");
  let session = null;
  let page = null;
  let promptForQuery = false;

  const closeSession = () => {
    try { session?.close?.(); } catch { /* best effort */ }
    session = null;
  };

  const askQuery = async () => {
    const summary = selectedSummary(selected);
    const value = await prompts.text({
      message: summary ? `Search extensions · ${summary}` : "Search extensions",
      placeholder: "Type an extension name or keyword",
      defaultValue: query,
    });
    if (pickerCancelled(prompts, value)) return { cancelled: true };
    query = normalizeQuery(value);
    return { cancelled: false };
  };

  const createQuerySession = async () => {
    closeSession();
    try {
      session = await pageProvider(query);
    } catch (error) {
      return { value: null, error };
    }
    const loaded = await withSpinner(prompts, "Loading extensions…", () => session.next());
    if (loaded.error) return loaded;
    page = loaded.value;
    return loaded;
  };

  const showPartialDiagnostics = () => {
    if (!page?.partial || !page.diagnostics?.length || typeof prompts.note !== "function") return;
    prompts.note("Some extensions could not be loaded", page.diagnostics.map((entry) => entry.message || String(entry)));
  };

  while (true) {
    if (promptForQuery) {
      const queryResult = await askQuery();
      if (queryResult.cancelled) {
        closeSession();
        return { status: "cancelled", selections: [] };
      }
      promptForQuery = false;
    }

    let loaded = await createQuerySession();
    while (loaded.error) {
      const action = await prompts.select({
        message: loaded.error.message || "Unable to load extensions",
        options: failureActionOptions(page, selected.size),
      });
      if (pickerCancelled(prompts, action) || action === "cancel") {
        closeSession();
        return { status: "cancelled", selections: [] };
      }
      if (action === "done") {
        closeSession();
        return { status: "submitted", selections: selectedResult(selected) };
      }
      if (action === "search") {
        promptForQuery = true;
        break;
      }
      if (action === "retry") {
        loaded = await withSpinner(prompts, "Retrying extensions…", () => session.next());
        if (!loaded.error) page = loaded.value;
        continue;
      }
      break;
    }
    if (loaded.error) continue;

    showPartialDiagnostics();
    let restartSearch = false;
    while (page) {
      const optionsForPage = pageOptions(page);
      const initialValues = optionsForPage
        .filter((item) => selected.has(item.value) && !item.disabled)
        .map((item) => item.value);
      const placeholder = "Type extension ID or keyword";
      const values = await prompts.autocompleteMultiselect({
        message: pageMessage(page, selected),
        placeholder,
        options: optionsForPage,
        filter: createPageOptionFilter(optionsForPage, { placeholder }),
        initialValues,
        required: false,
        maxItems: options.maxItems || DEFAULT_MAX_ITEMS,
      });
      if (pickerCancelled(prompts, values)) {
        closeSession();
        return { status: "cancelled", selections: [] };
      }
      mergePageSelections(selected, page, values);

      const action = await prompts.select({
        message: selectedSummary(selected)
          ? `Page ${page.pageIndex + 1} actions · ${selectedSummary(selected)}`
          : `Page ${page.pageIndex + 1} actions`,
        options: actionOptions(page, selected.size),
      });
      if (pickerCancelled(prompts, action) || action === "cancel") {
        closeSession();
        return { status: "cancelled", selections: [] };
      }
      if (action === "done") {
        closeSession();
        return {
          status: "submitted",
          selections: selectedResult(selected),
        };
      }
      if (action === "search") {
        promptForQuery = true;
        restartSearch = true;
        break;
      }

      const method = action === "previous" ? "previous" : "next";
      const next = await withSpinner(prompts, action === "previous" ? "Loading previous page…" : "Loading next page…", () => session[method]());
      if (next.error) {
        if (typeof prompts.note === "function") prompts.note("Unable to load page", [next.error.message || "Registry request failed."]);
        const retryAction = await prompts.select({
          message: "Page loading failed",
          options: failureActionOptions(page, selected.size),
        });
        if (pickerCancelled(prompts, retryAction) || retryAction === "cancel") {
          closeSession();
          return { status: "cancelled", selections: [] };
        }
        if (retryAction === "search") {
          restartSearch = true;
          break;
        }
        if (retryAction === "done") {
          closeSession();
          return {
            status: "submitted",
            selections: selectedResult(selected),
          };
        }
        if (retryAction === "retry") {
          const retried = await withSpinner(prompts, "Retrying extensions…", () => session[method]());
          if (!retried.error) page = retried.value;
          continue;
        }
        continue;
      }
      page = next.value;
      showPartialDiagnostics();
    }
    if (restartSearch) continue;
  }
}

module.exports = {
  actionOptions,
  createPageOptionFilter,
  extensionOptionLabel,
  failureActionOptions,
  mergePageSelections,
  pageOptions,
  runClackExtensionPicker,
  selectedSummary,
  selectedResult,
  statusHint,
};
