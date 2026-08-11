async function createInteractiveUi(options = {}) {
  const clack = await import("@clack/prompts");
  const input = options.input || process.stdin;
  const output = options.output || process.stdout;
  const common = { input, output };

  function unwrap(value) {
    if (!clack.isCancel(value)) return value;
    clack.cancel("Initialization cancelled. No changes were made.", common);
    const error = new Error("Initialization cancelled. No changes were made.");
    error.code = "INIT_CANCELLED";
    throw error;
  }

  return {
    intro() {
      clack.intro("OpenSpec Workspace setup", common);
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

module.exports = { createInteractiveUi };
