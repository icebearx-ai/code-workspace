const readline = require("node:readline/promises");

const { WorkspaceError } = require("../core/errors");

async function confirm(message, options = {}) {
  if (options.yes === true) return true;
  if (options.json || !process.stdin.isTTY) {
    throw new WorkspaceError(
      "CLI_CONFIRMATION_REQUIRED",
      `${message} Re-run with --yes to confirm non-interactively.`,
      { remediation: "Re-run the command with --yes." }
    );
  }
  const input = readline.createInterface({ input: options.input || process.stdin, output: options.output || process.stdout });
  try {
    return /^y(?:es)?$/i.test((await input.question(`${message} [y/N] `)).trim());
  } finally {
    input.close();
  }
}

module.exports = { confirm };
