const path = require("node:path");

const { loadState, resolveWorkspaceDev } = require("../../core/config");
const { WorkspaceError } = require("../../core/errors");
const { acquireInitLock } = require("../../core/init-lock");
const { compareVersions, loadInitManifest, minimumFromRange, runCommand } = require("../../core/init");
const { initializeWorkspace } = require("../../core/initializer");
const { resolveWorkspaceTools } = require("../../core/tools");
const { collectInitPlan } = require("../../init/wizard");
const { success } = require("../result");

function migrationData(plan) {
  if (!plan) return null;
  return {
    fromVersion: plan.schema.fromVersion,
    toVersion: plan.schema.toVersion,
    changed: plan.changed,
    steps: plan.steps,
    schemaSteps: plan.schema.steps,
    language: plan.language,
    writeTargets: plan.writeTargets,
  };
}

function parseDevOption(value) {
  if (value === undefined) return undefined;
  if (value === "true") return true;
  if (value === "false") return false;
  throw new WorkspaceError("CLI_INVALID_OPTION_VALUE", "--dev requires true or false", {
    option: "dev",
    value,
    allowed: ["true", "false"],
  });
}

async function executeInit(invocation) {
  const root = path.resolve(invocation.args[0] || ".");
  const releaseInitLock = await acquireInitLock(root);
  try {
    return await executeInitUnlocked(invocation, root);
  } finally {
    await releaseInitLock();
  }
}

async function executeInitUnlocked(invocation, root) {
  const { options } = invocation;
  const requestedDev = parseDevOption(options.dev);
  const dev = resolveWorkspaceDev(root, requestedDev);
  if (options.json && options.yes !== true) {
    throw new WorkspaceError("CLI_CONFIRMATION_REQUIRED", "Workspace initialization requires explicit confirmation in JSON mode.", {
      remediation: "Re-run with --yes.",
    });
  }
  const run = options.json
    ? (command, commandArgs, runOptions = {}) => runCommand(command, commandArgs, { ...runOptions, capture: true })
    : runCommand;
  const manifest = loadInitManifest();
  const minimumNode = minimumFromRange(manifest.requirements.node);
  if (compareVersions(process.versions.node, minimumNode) < 0) {
    throw new WorkspaceError("NODE_VERSION_UNSUPPORTED", `Node ${minimumNode} or newer is required; found ${process.versions.node}`, {
      actual: process.versions.node,
      required: minimumNode,
    });
  }
  const existingState = loadState(root);
  const resolvedTools = resolveWorkspaceTools({
    explicit: options.tools,
    state: existingState,
    manifestTools: manifest.tools,
  });
  const interactive = invocation.dependencies?.interactive ?? (!options.json && !options.yes && process.stdin.isTTY && process.stdout.isTTY);
  let plan = null;
  if (interactive) {
    try {
      plan = await collectInitPlan(root, manifest, {
        run,
        tools: options.tools !== undefined ? resolvedTools.tools : undefined,
        initialTools: resolvedTools.tools,
        workspaceName: options["workspace-name"],
        language: options.language,
        dev: requestedDev,
      });
    } catch (error) {
      if (error.code === "INIT_CANCELLED") {
        return success("init", { action: "cancel" }, "Initialization cancelled. No changes were made.");
      }
      throw error;
    }
  }
  const tools = plan?.tools || resolvedTools.tools;
  const selectedDev = plan?.workspace?.dev ?? dev;
  const toolSelection = {
    tools,
    source: plan ? (options.tools !== undefined ? "cli" : "interactive") : resolvedTools.source,
  };
  const result = await initializeWorkspace(root, {
    run,
    tools,
    dev: selectedDev,
    force: options.force === true,
    yes: plan ? true : options.yes === true,
    workspaceName: plan?.workspace.name || options["workspace-name"],
    workspaceUuid: plan?.workspace.uuid,
    language: plan?.language || options.language,
    interactive: false,
    initPlan: plan,
    onStage: null,
  });
  const data = {
    root: result.root,
    releaseVersion: result.manifest.releaseVersion,
    nodeVersion: result.nodeVersion,
    dependencies: result.dependencies,
    obsoleteFiles: result.obsoleteFiles,
    managedFiles: result.managedFiles,
    localConfig: result.localConfig,
    workspace: result.workspaceConfig.workspace,
    dev: result.workspaceConfig.workspace.dev,
    language: result.language,
    tools: toolSelection,
    migration: migrationData(result.migration),
    permissions: result.permissions,
    verification: result.verification,
    plan: result.initPlan,
    stages: result.stages.map((stage) => stage.name),
  };
  const lines = [
    "Code Workspace is ready.",
    `Workspace: ${result.workspaceConfig.workspace.name} (${result.workspaceConfig.workspace.uuid})`,
    `Language: ${result.language}`,
    `Tools: ${tools.length ? tools.join(", ") : "none"} (${toolSelection.source})`,
  ];
  if (result.workspaceConfig.workspace.dev !== false && (result.localConfig.action === "write" || result.permissions.action === "skip")) {
    lines.push(tools.length > 0
      ? "Add local projects with the `codew-add-projects` skill."
      : "Add local projects with `code-workspace project inspect`, then register a complete project record.");
  }
  return success("init", data, lines.join("\n"));
}

module.exports = { executeInit, migrationData, parseDevOption };
