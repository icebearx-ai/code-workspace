const assert = require("node:assert/strict");
const test = require("node:test");

const { stripVTControlCharacters } = require("node:util");

const {
  createPageOptionFilter,
  pageOptions,
  runClackExtensionPicker,
  selectedSummary,
} = require("../init/clack-extension-picker");

function makePrompts({ textValues = [], multiValues = [], selectValues = [] } = {}) {
  const calls = { text: [], multi: [], select: [], spinner: [] };
  const text = [...textValues];
  const multi = [...multiValues];
  const select = [...selectValues];
  return {
    calls,
    isCancel: () => false,
    async text(options) {
      calls.text.push(options);
      return text.shift() ?? "";
    },
    async autocompleteMultiselect(options) {
      calls.multi.push(options);
      return multi.shift() ?? [];
    },
    async select(options) {
      calls.select.push(options);
      return select.shift() ?? "done";
    },
    spinner() {
      return {
        start(message) { calls.spinner.push(["start", message]); },
        stop(message) { calls.spinner.push(["stop", message]); },
      };
    },
    note() {},
  };
}

function page(pageIndex, items, hasNext = false) {
  return { pageIndex, items, hasNext, complete: !hasNext, diagnostics: [] };
}

test("Clack picker renders two-line extension options and separates the footer", () => {
  const options = pageOptions(page(0, [
    {
      id: "monitor",
      name: "Monitor",
      version: "1.2.3",
      description: "Monitor agent sessions",
      status: "not-installed",
      disabled: false,
    },
    {
      id: "current",
      version: "2.0.0",
      description: "",
      status: "installed-current",
      disabled: true,
    },
  ]));

  assert.equal(
    stripVTControlCharacters(options[0].label),
    "monitor · v1.2.3 · not installed\n  Monitor agent sessions",
  );
  assert.equal(
    stripVTControlCharacters(options[1].label),
    "current · v2.0.0 · installed\n  No description\n",
  );
  assert.equal(options[0].disabled, false);
  assert.equal(options[1].disabled, true);
  assert.equal(options[0].hint, undefined);
  assert.equal(stripVTControlCharacters(options[1].label).split("\n").length, 3);
});

test("Clack picker does not repeat a description used as the display name", () => {
  const options = pageOptions(page(0, [{
    id: "monitor",
    name: "监控 Agent 会话、执行状态与待授权请求",
    version: "1.1.0",
    description: "监控 Agent 会话、执行状态与待授权请求",
    status: "not-installed",
  }]));

  assert.equal(
    stripVTControlCharacters(options[0].label),
    "monitor · v1.1.0 · not installed\n  监控 Agent 会话、执行状态与待授权请求\n",
  );
});

test("Clack picker uses concise English status labels", () => {
  const options = pageOptions(page(0, [{
    id: "jira",
    version: "2.0.0",
    description: "Jira",
    status: "installed-outdated",
  }]));
  assert.equal(
    stripVTControlCharacters(options[0].label),
    "jira · v2.0.0 · update available\n  Jira\n",
  );
});

test("Clack picker exposes selected extension names in prompt messages", async () => {
  assert.equal(selectedSummary(new Map([["monitor", "install"], ["jira", "update"]])), "Selected: monitor, jira");
  const prompts = makePrompts({
    multiValues: [["alpha"], []],
    selectValues: ["next", "done"],
  });
  let nextCalls = 0;
  await runClackExtensionPicker({
    prompts,
    selectedIds: ["preselected"],
    pageProvider: async () => ({
      next: async () => {
        nextCalls += 1;
        return nextCalls === 1
          ? page(0, [{ id: "alpha", status: "not-installed", action: "install" }], true)
          : page(1, [{ id: "beta", status: "not-installed", action: "install" }]);
      },
      close() {},
    }),
  });
  assert.equal(prompts.calls.text.length, 0);
  assert.match(prompts.calls.multi[0].message, /Search extensions/);
  assert.match(prompts.calls.multi[0].message, /Selected: preselected/);
  assert.match(prompts.calls.multi[1].message, /Selected: preselected, alpha/);
  assert.match(prompts.calls.select[0].message, /Selected: preselected, alpha/);
});

test("Clack picker keeps the footer gap after local filtering", () => {
  const options = pageOptions(page(0, [
    { id: "monitor", version: "1.0.0", description: "Monitor", status: "not-installed" },
    { id: "jira", version: "2.0.0", description: "Jira", status: "not-installed" },
  ]));
  const filter = createPageOptionFilter(options, { placeholder: "Type extension ID or keyword" });

  assert.equal(filter("mon", options[0]), true);
  assert.equal(filter("mon", options[1]), false);
  assert.equal(stripVTControlCharacters(options[0].label).endsWith("\n"), true);
  assert.equal(stripVTControlCharacters(options[1].label).endsWith("\n"), true);
  assert.equal(filter("jira", options[0]), false);
  assert.equal(filter("jira", options[1]), true);
  assert.equal(stripVTControlCharacters(options[0].label).endsWith("\n"), false);
  assert.equal(stripVTControlCharacters(options[1].label).endsWith("\n"), true);
  assert.equal(filter("Type extension ID or keyword", options[0]), false);
  assert.equal(stripVTControlCharacters(options[1].label).endsWith("\n"), true);
  filter("", options[0]);
  assert.equal(stripVTControlCharacters(options[1].label).endsWith("\n"), true);
});

test("Clack picker searches once, selects across pages, and preserves actions", async () => {
  const calls = [];
  const prompts = makePrompts({
    multiValues: [["beta"], ["gamma"]],
    selectValues: ["next", "done"],
  });
  let nextCalls = 0;
  const result = await runClackExtensionPicker({
    prompts,
    query: "jira",
    pageProvider: async (query) => {
      calls.push(query);
      return {
        next: async () => {
          nextCalls += 1;
          return nextCalls === 1
            ? page(0, [
              { id: "current", name: "Current", status: "installed-current", disabled: true, action: "none" },
              { id: "beta", name: "Beta", status: "not-installed", action: "install" },
            ], true)
            : page(1, [{ id: "gamma", name: "Gamma", status: "installed-outdated", action: "update" }]);
        },
        previous: async () => page(0, [{ id: "beta", name: "Beta", status: "not-installed", action: "install" }], true),
        close() {},
      };
    },
  });
  assert.equal(result.status, "submitted");
  assert.deepEqual(result.selections, [
    { id: "beta", action: "install" },
    { id: "gamma", action: "update" },
  ]);
  assert.deepEqual(calls, ["jira"]);
  assert.equal(prompts.calls.text.length, 0);
  assert.equal(prompts.calls.multi[0].options[0].disabled, true);
  assert.deepEqual(prompts.calls.multi[0].initialValues, []);
  assert.deepEqual(prompts.calls.multi[1].initialValues, []);
  assert.match(prompts.calls.multi[1].message, /Selected: beta/);
  assert.match(prompts.calls.select[0].message, /Selected: beta/);
});

test("Clack picker preserves a prior page selection when navigating back", async () => {
  const prompts = makePrompts({
    multiValues: [["alpha"], [], ["alpha"]],
    selectValues: ["next", "previous", "done"],
  });
  let nextCalls = 0;
  const result = await runClackExtensionPicker({
    prompts,
    pageProvider: async () => ({
      next: async () => {
        nextCalls += 1;
        return nextCalls === 1
          ? page(0, [{ id: "alpha", status: "not-installed", action: "install" }], true)
          : page(1, [{ id: "beta", status: "not-installed", action: "install" }]);
      },
      previous: async () => page(0, [{ id: "alpha", status: "not-installed", action: "install" }], true),
      close() {},
    }),
  });
  assert.equal(result.status, "submitted");
  assert.deepEqual(result.selections, [{ id: "alpha", action: "install" }]);
  assert.deepEqual(prompts.calls.multi[2].initialValues, ["alpha"]);
});

test("Clack picker cancellation returns no selections", async () => {
  const cancel = Symbol("cancel");
  const prompts = makePrompts({ multiValues: [cancel] });
  prompts.isCancel = (value) => value === cancel;
  const result = await runClackExtensionPicker({
    prompts,
    pageProvider: async () => ({
      next: async () => page(0, [{ id: "monitor", status: "not-installed", action: "install" }]),
      close() {},
    }),
  });
  assert.deepEqual(result, { status: "cancelled", selections: [] });
});

test("Clack picker asks for a Nexus query only after Search again", async () => {
  const calls = [];
  const prompts = makePrompts({
    textValues: ["jira"],
    multiValues: [[], []],
    selectValues: ["search", "done"],
  });
  const result = await runClackExtensionPicker({
    prompts,
    pageProvider: async (query) => {
      calls.push(query);
      return {
        next: async () => page(0, [{ id: "extension", status: "not-installed", action: "install" }]),
        close() {},
      };
    },
  });
  assert.equal(result.status, "submitted");
  assert.deepEqual(calls, ["", "jira"]);
  assert.equal(prompts.calls.text.length, 1);
  assert.equal(prompts.calls.text[0].message, "Search extensions");
});

test("Clack picker retries a failed initial page without losing the session", async () => {
  const prompts = makePrompts({
    multiValues: [[]],
    selectValues: ["retry", "done"],
  });
  let attempts = 0;
  const result = await runClackExtensionPicker({
    prompts,
    query: "monitor",
    pageProvider: async () => ({
      next: async () => {
        attempts += 1;
        if (attempts === 1) throw new Error("temporary Nexus failure");
        return page(0, [{ id: "monitor", status: "not-installed", action: "install" }]);
      },
      close() {},
    }),
  });
  assert.equal(result.status, "submitted");
  assert.equal(attempts, 2);
});
