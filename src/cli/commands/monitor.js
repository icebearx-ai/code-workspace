const { loadConfigProjection, requireWorkspaceRoot } = require("../../core/config");
const { WorkspaceError } = require("../../core/errors");
const { reportHookEvent, startMonitor, validatePort } = require("../../monitor");
const { success } = require("../result");

async function readStdinJson(input = process.stdin) {
  const chunks = [];
  for await (const chunk of input) chunks.push(chunk);
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
  } catch (error) {
    throw new WorkspaceError("MONITOR_EVENT_INVALID", `Cannot parse monitor event JSON: ${error.message}`);
  }
}

async function executeMonitor(invocation) {
  const action = invocation.definition.path[1];
  if (action === "report") {
    try {
      const root = requireWorkspaceRoot(process.cwd());
      const report = await reportHookEvent(await readStdinJson(), loadConfigProjection(root, ["identity", "monitor"]));
      return success("monitor.report", report);
    } catch (error) {
      return success("monitor.report", { action: "skip", reason: "reporting failed open", errorCode: error.code || "MONITOR_REPORT_FAILED" });
    }
  }
  if (invocation.options.json) {
    throw new WorkspaceError("CLI_JSON_UNSUPPORTED", "The long-running monitor command does not support --json; use the dashboard API for machine-readable state.");
  }
  const port = validatePort(invocation.options.port);
  let monitor;
  try {
    monitor = await startMonitor({ port });
  } catch (error) {
    if (error.code === "EADDRINUSE") {
      throw new WorkspaceError("MONITOR_PORT_IN_USE", `Monitor port 127.0.0.1:${port} is already in use.`, {
        port,
        remediation: `Start another port with openspec-w monitor -p 8080, then update monitor.url.`,
      });
    }
    throw error;
  }
  const text = [
    `OpenSpec Workspace Monitor listening on http://${monitor.host}:${monitor.port}`,
    `Dashboard: http://${monitor.host}:${monitor.port}/`,
    `Workspaces report to http://${monitor.host}:${monitor.port}/api/v1/events`,
  ].join("\n");
  process.stdout.write(`${text}\n`);
  await new Promise((resolve) => {
    let closing = false;
    const close = () => {
      if (closing) return;
      closing = true;
      monitor.server.close(resolve);
    };
    process.once("SIGINT", close);
    process.once("SIGTERM", close);
  });
  return success("monitor", { host: monitor.host, port: monitor.port });
}

module.exports = { executeMonitor, readStdinJson };
