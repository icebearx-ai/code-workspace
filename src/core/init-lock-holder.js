const { parentPort, workerData } = require("node:worker_threads");

const properLockfile = require("proper-lockfile");

(async () => {
  let release;
  try {
    release = await properLockfile.lock(workerData.target, {
      realpath: false,
      retries: false,
      update: workerData.update,
      stale: workerData.stale,
    });
    parentPort.postMessage({ type: "ready" });
    parentPort.on("message", async (message) => {
      if (message?.type !== "release") return;
      try {
        await release();
        parentPort.postMessage({ type: "released" });
      } catch (error) {
        parentPort.postMessage({ type: "release-error", code: error.code, message: error.message });
      } finally {
        process.exit(0);
      }
    });
  } catch (error) {
    parentPort.postMessage({ type: "error", code: error.code, message: error.message });
    process.exit(1);
  }
})();
