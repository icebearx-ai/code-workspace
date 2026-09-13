#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");
const { createMonitorServer, DEFAULT_MONITOR_HOST, DEFAULT_MONITOR_PORT } = require("./monitor");

function readContext() {
  const file = process.env.CODE_WORKSPACE_RUNTIME_CONTEXT;
  if (!file) throw new Error("CODE_WORKSPACE_RUNTIME_CONTEXT is required");
  const context = JSON.parse(fs.readFileSync(file, "utf8"));
  if (context.schemaVersion !== 1 || context.mode !== "service" || context.extension?.id !== "monitor") throw new Error("Invalid monitor runtime context");
  return context;
}

function option(name, fallback) {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

async function main() {
  const context = readContext();
  const dataDirectory = context.dataDirectory;
  fs.mkdirSync(dataDirectory, { recursive: true });
  const dataFile = path.join(dataDirectory, "monitor-events.json");
  let loading = true;
  let persisted = [];
  try {
    const value = JSON.parse(fs.readFileSync(dataFile, "utf8"));
    if (Array.isArray(value)) persisted = value;
  } catch { /* first run or an incomplete file */ }
  const save = () => {
    if (loading) return;
    const temporary = `${dataFile}.tmp-${process.pid}`;
    fs.writeFileSync(temporary, `${JSON.stringify(monitor.store.snapshot().events, null, 2)}\n`, { mode: 0o600 });
    fs.renameSync(temporary, dataFile);
  };
  const monitor = createMonitorServer({
    host: option("--host", DEFAULT_MONITOR_HOST),
    port: Number(option("--port", DEFAULT_MONITOR_PORT)),
    store: undefined,
    onChange: save,
  });
  // Rebind the callback to the concrete store and replay persisted facts.
  monitor.store = monitor.store;
  for (const event of persisted) {
    try { monitor.store.accept(event, true); } catch { /* ignore corrupt historical events */ }
  }
  loading = false;
  save();
  await new Promise((resolve, reject) => {
    const onError = (error) => reject(error);
    monitor.server.once("error", onError);
    monitor.server.listen(monitor.port, monitor.host, () => {
      monitor.server.off("error", onError);
      if (context.readiness?.file) fs.writeFileSync(context.readiness.file, "ready\n", { mode: 0o600 });
      resolve();
    });
  });
  process.stdout.write(`Code Workspace Monitor listening on http://${monitor.host}:${monitor.port}\n`);
  await new Promise((resolve) => {
    let closing = false;
    const close = () => {
      if (closing) return;
      closing = true;
      monitor.server.close(() => { save(); resolve(); });
    };
    process.once("SIGINT", close);
    process.once("SIGTERM", close);
  });
}

main().catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
});
