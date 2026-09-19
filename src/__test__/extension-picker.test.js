const assert = require("node:assert/strict");
const test = require("node:test");

const {
  FOCUS_LIST,
  FOCUS_SEARCH,
  createPickerState,
  normalizePickerItem,
  pickerReducer,
  renderPickerState,
  runExtensionPicker,
} = require("../init/extension-picker");

function page(pageIndex, items, hasNext = false) {
  return { pageIndex, items, hasNext, complete: !hasNext, query: "" };
}

test("picker reducer switches focus, edits search, moves, and toggles only enabled items", () => {
  const current = normalizePickerItem({ id: "current", status: "installed-current" });
  const fresh = normalizePickerItem({ id: "fresh", status: "not-installed" });
  let state = createPickerState({ page: page(0, [current, fresh]) });
  assert.equal(state.focus, FOCUS_SEARCH);
  let reduced = pickerReducer(state, { type: "key", key: "a" });
  state = reduced.state;
  assert.equal(state.query, "a");
  assert.equal(reduced.effect, "query");
  state = pickerReducer(state, { type: "key", key: "tab" }).state;
  assert.equal(state.focus, FOCUS_LIST);
  state = pickerReducer(state, { type: "key", key: "space" }).state;
  assert.deepEqual(state.selectedIds, []);
  state = pickerReducer(state, { type: "key", key: "down" }).state;
  state = pickerReducer(state, { type: "key", key: "space" }).state;
  assert.deepEqual(state.selectedIds, ["fresh"]);
  state = pickerReducer(state, { type: "key", key: "left" }).state;
  assert.equal(state.loading, false);
  state = pickerReducer(state, { type: "key", key: "enter" }).state;
  assert.equal(state.submitted, true);
});

test("picker treats the real TTY Enter key name (`return`) as submit", () => {
  let state = createPickerState({ page: page(0, [{ id: "fresh", status: "not-installed" }]) });
  state = pickerReducer(state, { type: "key", key: "tab" }).state;
  state = pickerReducer(state, { type: "key", key: "space" }).state;
  const reduced = pickerReducer(state, { type: "key", key: "return" });
  assert.equal(reduced.state.submitted, true);
  assert.equal(reduced.effect, "submit");
});

test("picker reducer maps list left/right to bounded page effects and blocks them while loading", () => {
  let state = createPickerState({ page: page(0, [{ id: "one" }], true) });
  state = pickerReducer(state, { type: "key", key: "tab" }).state;
  let reduced = pickerReducer(state, { type: "key", key: "left" });
  assert.equal(reduced.effect, null);
  reduced = pickerReducer(state, { type: "key", key: "right" });
  assert.equal(reduced.effect, "next");
  assert.equal(reduced.state.loading, true);
  reduced = pickerReducer(reduced.state, { type: "key", key: "right" });
  assert.equal(reduced.effect, null);
  state = pickerReducer(reduced.state, { type: "page-loaded", page: page(1, [{ id: "two" }], false) }).state;
  reduced = pickerReducer(state, { type: "key", key: "right" });
  assert.equal(reduced.effect, null);
  assert.match(renderPickerState(state).lines.join("\n"), /Page 2 · last page/);
});

test("injected picker runner preserves selections across pages and returns actions", async () => {
  const calls = [];
  const sessions = {
    "": {
      next: async () => page(0, [
        { id: "alpha", name: "Alpha", status: "not-installed" },
        { id: "beta", name: "Beta", status: "installed-current" },
        { id: "gamma", name: "Gamma", status: "installed-outdated" },
      ], true),
      previous: async () => page(0, [
        { id: "alpha", name: "Alpha", status: "not-installed" },
        { id: "beta", name: "Beta", status: "installed-current" },
        { id: "gamma", name: "Gamma", status: "installed-outdated" },
      ], true),
    },
  };
  let second = false;
  const pageProvider = (query) => {
    calls.push(query);
    const base = sessions[query];
    return {
      next: async () => {
        if (!second) {
          second = true;
          return base.next();
        }
        return page(1, [{ id: "delta", name: "Delta", status: "not-installed" }], false);
      },
      previous: base.previous,
      close() {},
    };
  };
  const rendered = [];
  const result = await runExtensionPicker({
    pageProvider,
    events: ["tab", "space", "down", "space", "down", "space", "right", "left", "enter"],
    render: (state) => rendered.push({ pageIndex: state.pageIndex, loading: state.loading }),
  });
  assert.equal(result.status, "submitted");
  assert.deepEqual(result.selections, [
    { id: "alpha", action: "install" },
    { id: "gamma", action: "update" },
  ]);
  assert.deepEqual(calls, [""]);
  assert(rendered.some((entry) => entry.pageIndex === 1));
  assert(rendered.some((entry) => entry.loading));
});

test("injected picker runner keeps failed page state for retry and supports cancellation", async () => {
  let attempts = 0;
  const pageProvider = () => ({
    next: async () => {
      attempts += 1;
      if (attempts === 2) throw Object.assign(new Error("temporary failure"), { code: "EXTENSION_REGISTRY_BROWSE_PAGE_FAILED" });
      return page(attempts - 1, [{ id: attempts === 1 ? "one" : "two" }], attempts === 1);
    },
    previous: async () => page(0, [{ id: "one" }], true),
    retry: async () => page(1, [{ id: "two" }], false),
  });
  const result = await runExtensionPicker({
    pageProvider,
    events: ["tab", "right", "r", "escape"],
    render: () => {},
  });
  assert.equal(result.status, "cancelled");
  assert.equal(attempts, 2);
});
