const { styleText } = require("node:util");
const { runExtensionPicker } = require("./extension-picker");
const { runClackExtensionPicker } = require("./clack-extension-picker");

function formatExtensionChoice(entry, options = {}) {
  const title = options.includeId ? `${entry.id} · ${entry.name}` : entry.name;
  const suffix = options.installed ? " · installed" : "";
  return `${styleText("bold", title)}\n  ${styleText("dim", `${entry.description}${suffix}`)}`;
}

async function createInteractiveUi(options = {}) {
  const clack = await import("@clack/prompts");
  const input = options.input || process.stdin;
  const output = options.output || process.stdout;
  const common = { input, output };
  const cancelMessage = options.cancelMessage || "Initialization cancelled. No changes were made.";
  const cancelCode = options.cancelCode || "INIT_CANCELLED";

  function unwrap(value) {
    if (!clack.isCancel(value)) return value;
    clack.cancel(cancelMessage, common);
    const error = new Error(cancelMessage);
    error.code = cancelCode;
    throw error;
  }

  return {
    intro(message = "Code Workspace setup") {
      clack.intro(message, common);
    },
    note(title, lines) {
      clack.note(lines.join("\n"), title, common);
    },
    async text(label, initial) {
      return unwrap(await clack.text({
        ...common,
        message: label,
        placeholder: initial,
        defaultValue: initial,
      }));
    },
    async select(label, choices, initial = 0) {
      return unwrap(await clack.select({
        ...common,
        message: label,
        options: choices,
        initialValue: choices[initial]?.value,
      }));
    },
    async multiselect(label, choices, initialValues = []) {
      return unwrap(await clack.multiselect({
        ...common,
        message: label,
        options: choices,
        initialValues,
        required: false,
      }));
    },
    async extensionPicker(options = {}) {
      return runClackExtensionPicker({
        input,
        output,
        ...options,
        prompts: {
          isCancel: clack.isCancel,
          text: (promptOptions) => clack.text({ ...common, ...promptOptions }),
          autocompleteMultiselect: (promptOptions) => clack.autocompleteMultiselect({ ...common, ...promptOptions }),
          select: (promptOptions) => clack.select({ ...common, ...promptOptions }),
          spinner: () => clack.spinner({ output }),
          note: (title, lines) => clack.note(lines.join("\n"), title, common),
        },
      });
    },
    async confirm(label, initial = true) {
      return unwrap(await clack.confirm({ ...common, message: label, initialValue: initial }));
    },
    cancel(message) {
      clack.cancel(message, common);
    },
    close(message) {
      clack.outro(message, common);
    },
  };
}

module.exports = { createInteractiveUi, formatExtensionChoice, runExtensionPicker, runClackExtensionPicker };
