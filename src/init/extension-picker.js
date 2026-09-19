const readline = require("node:readline");

const FOCUS_SEARCH = "search";
const FOCUS_LIST = "list";
const PICKER_STATUSES = Object.freeze([
  "not-installed",
  "installed-current",
  "installed-outdated",
  "unavailable",
]);

function pickerError(code, message, details = {}) {
  const error = new Error(message);
  error.code = code;
  error.details = details;
  return error;
}

function normalizePickerItem(value) {
  const item = value || {};
  const id = String(item.id || item.extensionId || "").trim();
  if (!id) throw pickerError("EXTENSION_PICKER_ITEM_INVALID", "Extension picker item requires an id");
  const status = PICKER_STATUSES.includes(item.status)
    ? item.status
    : item.available === false ? "unavailable" : "not-installed";
  const disabled = item.disabled === true || status === "installed-current" || status === "unavailable";
  const action = disabled ? "none" : status === "installed-outdated" ? "update" : "install";
  return Object.freeze({
    ...item,
    id,
    status,
    action,
    disabled,
    name: String(item.name || id),
    description: String(item.description || ""),
  });
}

function normalizePickerPage(value = {}) {
  const items = Array.from(value.items || [], normalizePickerItem)
    .sort((left, right) => left.id.localeCompare(right.id));
  return Object.freeze({
    schemaVersion: value.schemaVersion || 1,
    query: String(value.query || ""),
    pageIndex: Number.isSafeInteger(value.pageIndex) && value.pageIndex >= 0 ? value.pageIndex : 0,
    items: Object.freeze(items),
    hasNext: value.hasNext === true,
    complete: value.complete === true || value.hasNext !== true,
    partial: value.partial === true,
    diagnostics: Object.freeze(Array.from(value.diagnostics || [])),
    registry: value.registry || null,
  });
}

function createPickerState(options = {}) {
  const page = normalizePickerPage(options.page || {});
  return Object.freeze({
    focus: options.focus === FOCUS_LIST ? FOCUS_LIST : FOCUS_SEARCH,
    query: String(options.query || page.query || ""),
    queryCursor: String(options.query || page.query || "").length,
    pageIndex: page.pageIndex,
    items: page.items,
    hasNext: page.hasNext,
    complete: page.complete,
    partial: page.partial,
    diagnostics: page.diagnostics,
    cursor: 0,
    loading: false,
    error: null,
    selectedIds: Object.freeze([...(options.selectedIds || [])]),
    selectionActions: Object.freeze({ ...(options.selectionActions || {}) }),
    cancelled: false,
    submitted: false,
    statusMessage: "",
  });
}

function withState(state, changes) {
  return Object.freeze({ ...state, ...changes });
}

function selectedResult(state) {
  return state.selectedIds.map((id) => ({ id, action: state.selectionActions[id] || "install" }));
}

function currentItem(state) {
  return state.items[state.cursor] || null;
}

function clampCursor(items, cursor) {
  if (items.length === 0) return 0;
  return Math.max(0, Math.min(cursor, items.length - 1));
}

function toggleSelection(state) {
  const item = currentItem(state);
  if (!item || item.disabled) return { state, effect: null };
  const selected = new Set(state.selectedIds);
  const actions = { ...state.selectionActions };
  if (selected.has(item.id)) {
    selected.delete(item.id);
    delete actions[item.id];
  } else {
    selected.add(item.id);
    actions[item.id] = item.action;
  }
  return {
    state: withState(state, {
      selectedIds: Object.freeze([...selected]),
      selectionActions: Object.freeze(actions),
      statusMessage: selected.has(item.id) ? `${item.id} selected` : `${item.id} unselected`,
    }),
    effect: null,
  };
}

function applyPage(state, page) {
  const normalized = normalizePickerPage(page);
  const hasSelectableItem = normalized.items.some((item) => !item.disabled);
  const hasCurrentItem = normalized.items.some((item) => item.status === "installed-current");
  const hasUnavailableItem = normalized.items.some((item) => item.status === "unavailable");
  return withState(state, {
    pageIndex: normalized.pageIndex,
    items: normalized.items,
    hasNext: normalized.hasNext,
    complete: normalized.complete,
    partial: normalized.partial,
    diagnostics: normalized.diagnostics,
    cursor: clampCursor(normalized.items, state.cursor),
    loading: false,
    error: null,
    statusMessage: normalized.partial
      ? "Some extension metadata could not be loaded; press r to retry."
      : hasSelectableItem
        ? ""
        : hasCurrentItem && !hasUnavailableItem
          ? "All extensions on this page are already installed at the latest version; type a search or use ←/→ to browse."
          : "No selectable extensions on this page; type a search or use ←/→ to browse.",
  });
}

function pickerReducer(state, event = {}) {
  if (event.type === "load-start") return { state: withState(state, { loading: true, error: null, statusMessage: "Loading extensions…" }), effect: null };
  if (event.type === "page-loaded") return { state: applyPage(state, event.page), effect: null };
  if (event.type === "page-failed") return { state: withState(state, { loading: false, error: event.error || { code: "EXTENSION_PICKER_PAGE_FAILED", message: "Unable to load extensions." }, statusMessage: "Unable to load this page; press r to retry or Esc to cancel." }), effect: null };
  if (event.type === "cancel") return { state: withState(state, { cancelled: true, loading: false }), effect: "cancel" };
  if (event.type === "submit") return { state: withState(state, { submitted: true, loading: false }), effect: "submit" };
  if (event.type !== "key" || state.loading || state.cancelled || state.submitted) return { state, effect: null };

  // Node's readline keypress event names the Enter key as `return` (while
  // injected/test events commonly use `enter`). Normalize both spellings so
  // the same picker works in a real TTY and in deterministic callers.
  const key = String(event.key || "").toLowerCase() === "return"
    ? "enter"
    : String(event.key || "").toLowerCase();
  if (key === "escape" || key === "esc" || key === "ctrl-c") return pickerReducer(state, { type: "cancel" });
  if (key === "tab") return { state: withState(state, { focus: state.focus === FOCUS_SEARCH ? FOCUS_LIST : FOCUS_SEARCH, statusMessage: state.focus === FOCUS_SEARCH ? "List focus: ↑↓ move, Space select, ← previous, → next, Enter submit" : "Search focus: type to filter, Tab switches focus" }), effect: null };

  if (state.focus === FOCUS_SEARCH) {
    if (key === "enter") return { state: withState(state, { focus: FOCUS_LIST, statusMessage: "List focus: ↑↓ move, Space select, ← previous, → next, Enter submit" }), effect: null };
    if (key === "left") return { state: withState(state, { queryCursor: Math.max(0, state.queryCursor - 1) }), effect: null };
    if (key === "right") return { state: withState(state, { queryCursor: Math.min(state.query.length, state.queryCursor + 1) }), effect: null };
    if (key === "backspace") {
      if (state.queryCursor === 0) return { state, effect: null };
      const query = `${state.query.slice(0, state.queryCursor - 1)}${state.query.slice(state.queryCursor)}`;
      return { state: withState(state, { query, queryCursor: state.queryCursor - 1 }), effect: "query" };
    }
    if (key.length === 1 && key >= " ") {
      const query = `${state.query.slice(0, state.queryCursor)}${key}${state.query.slice(state.queryCursor)}`;
      return { state: withState(state, { query, queryCursor: state.queryCursor + 1 }), effect: "query" };
    }
    return { state, effect: null };
  }

  if (key === "up") return { state: withState(state, { cursor: clampCursor(state.items, state.cursor - 1) }), effect: null };
  if (key === "down") return { state: withState(state, { cursor: clampCursor(state.items, state.cursor + 1) }), effect: null };
  if (key === "home") return { state: withState(state, { cursor: 0 }), effect: null };
  if (key === "end") return { state: withState(state, { cursor: Math.max(0, state.items.length - 1) }), effect: null };
  if (key === "space") return toggleSelection(state);
  if (key === "left") return state.pageIndex > 0 ? { state: withState(state, { loading: true, statusMessage: "Loading previous page…" }), effect: "previous" } : { state, effect: null };
  if (key === "right") return state.hasNext ? { state: withState(state, { loading: true, statusMessage: "Loading next page…" }), effect: "next" } : { state, effect: null };
  if (key === "r" && state.error) return { state: withState(state, { loading: true, error: null, statusMessage: "Retrying…" }), effect: "retry" };
  if (key === "enter") return pickerReducer(state, { type: "submit" });
  return { state, effect: null };
}

function pickerStatusLabel(status) {
  return {
    "not-installed": "not installed",
    "installed-current": "installed · latest",
    "installed-outdated": "installed · update available",
    unavailable: "unavailable",
  }[status] || status;
}

function renderPickerState(state) {
  const page = `Page ${state.pageIndex + 1}${state.hasNext ? " · next page available" : " · last page"}`;
  const items = state.items.map((item, index) => {
    const marker = state.selectedIds.includes(item.id) ? "[x]" : "[ ]";
    const pointer = index === state.cursor && state.focus === FOCUS_LIST ? ">" : " ";
    const disabled = item.disabled ? " · disabled" : "";
    return `${pointer} ${marker} ${item.id} · ${item.name} · ${pickerStatusLabel(item.status)}${disabled}`;
  });
  return {
    lines: [
      `Extension picker · ${state.focus === FOCUS_SEARCH ? "search focus" : "list focus"}`,
      `Search: ${state.query.slice(0, state.queryCursor)}▏${state.query.slice(state.queryCursor)}`,
      page,
      state.focus === FOCUS_SEARCH
        ? "Type to search · Tab list · Enter list · Esc cancel"
        : "↑↓ move · Space select · ← previous · → next · Enter submit · Esc cancel",
      ...(state.focus === FOCUS_LIST
        ? [`← ${state.pageIndex > 0 ? "previous page" : "first page"} · → ${state.hasNext ? "next page" : "last page"}`]
        : []),
      ...(state.loading ? ["Loading…"] : []),
      ...(state.error ? [`Error: ${state.error.message || "Unable to load extensions."} · press r to retry`] : []),
      ...items,
      ...(state.statusMessage ? [state.statusMessage] : []),
    ],
    items,
    page,
  };
}

async function* keypressEvents(input) {
  readline.emitKeypressEvents(input);
  const hadRawMode = typeof input.isRaw === "boolean" ? input.isRaw : false;
  if (typeof input.setRawMode === "function") input.setRawMode(true);
  if (typeof input.resume === "function") input.resume();
  const queue = [];
  let wake;
  let ended = false;
  const onKey = (sequence, key = {}) => {
    queue.push(key.ctrl && key.name === "c" ? "ctrl-c" : key.name || sequence);
    if (wake) {
      const resolve = wake;
      wake = null;
      resolve();
    }
  };
  const onEnd = () => {
    ended = true;
    if (wake) {
      const resolve = wake;
      wake = null;
      resolve();
    }
  };
  input.on("keypress", onKey);
  input.once("end", onEnd);
  try {
    while (true) {
      if (queue.length === 0) {
        if (ended) return;
        await new Promise((resolve) => { wake = resolve; });
        if (ended && queue.length === 0) return;
      }
      while (queue.length > 0) yield queue.shift();
    }
  } finally {
    input.off("keypress", onKey);
    input.off("end", onEnd);
    if (typeof input.setRawMode === "function") input.setRawMode(hadRawMode);
  }
}

function resolvePageProvider(pageProvider, query) {
  if (typeof pageProvider === "function") return pageProvider(query);
  if (pageProvider && typeof pageProvider.createSession === "function") return pageProvider.createSession(query);
  throw pickerError("EXTENSION_PICKER_PROVIDER_INVALID", "Extension picker requires an injected page provider");
}

async function runExtensionPicker(options = {}) {
  const pageProvider = options.pageProvider;
  let renderedLines = 0;
  const render = options.render || ((state) => {
    if (!options.output?.write) return;
    const lines = renderPickerState(state).lines;
    // Redraw only the picker frame. This follows the same cursor/erase model
    // used by @clack/prompts and avoids clearing the entire terminal, which is
    // not honored by some IDE and captured-terminal implementations.
    const rewind = renderedLines > 0 ? `\u001b[${renderedLines}A\u001b[1G\u001b[0J` : "";
    options.output.write(`${rewind}${lines.join("\n")}\n`);
    renderedLines = lines.length + 1;
  });
  const events = options.events || keypressEvents(options.input || process.stdin);
  let state = createPickerState({ query: options.query || "", selectedIds: options.selectedIds, selectionActions: options.selectionActions });
  let session = await resolvePageProvider(pageProvider, state.query);

  async function load(method, event = "load-start") {
    state = pickerReducer(state, { type: event }).state;
    render(state, renderPickerState(state));
    try {
      const page = await session[method]();
      state = pickerReducer(state, { type: "page-loaded", page }).state;
      render(state, renderPickerState(state));
    } catch (error) {
      state = pickerReducer(state, { type: "page-failed", error }).state;
      render(state, renderPickerState(state));
    }
  }

  await load("next");
  for await (const key of events) {
    const reduced = pickerReducer(state, { type: "key", key });
    state = reduced.state;
    render(state, renderPickerState(state));
    if (reduced.effect === "cancel" || state.cancelled) return { status: "cancelled", selections: [] };
    if (reduced.effect === "submit" || state.submitted) return { status: "submitted", selections: selectedResult(state) };
    if (reduced.effect === "query") {
      if (session.close) session.close();
      session = await resolvePageProvider(pageProvider, state.query);
      await load("next");
      continue;
    }
    if (["previous", "next", "retry"].includes(reduced.effect)) {
      await load(reduced.effect);
    }
  }
  return { status: "cancelled", selections: [] };
}

module.exports = {
  FOCUS_LIST,
  FOCUS_SEARCH,
  PICKER_STATUSES,
  createPickerState,
  currentItem,
  normalizePickerItem,
  normalizePickerPage,
  pickerReducer,
  pickerStatusLabel,
  renderPickerState,
  runExtensionPicker,
  selectedResult,
};
