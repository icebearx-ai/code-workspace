const path = require("node:path");

const { loadState } = require("../../core/config");
const { WorkspaceError } = require("../../core/errors");
const { compareVersions, loadInitManifest, minimumFromRange, runCommand } = require("../../core/init");
const { initializeWorkspace } = require("../../core/initializer");
const { workspaceGuide } = require("../../core/language");
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

async function executeInit(invocation) {
  const { args, options } = invocation;
  const root = path.resolve(args[0] || ".");
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
    manifestTools: manifest.resources.openspec.tools,
  });
  const interactive = !options.json && !options.yes && process.stdin.isTTY && process.stdout.isTTY;
  let plan = null;
  if (interactive) {
    try {
      plan = await collectInitPlan(root, manifest, {
        run,
        tools: options.tools !== undefined ? resolvedTools.tools : undefined,
        initialTools: resolvedTools.tools,
        openspecVersion: options["openspec-version"],
        workspaceName: options["workspace-name"],
        monitor: options.monitor === true ? true : options["no-monitor"] === true ? false : undefined,
        monitorUrl: options["monitor-url"],
        language: options.language,
      });
    } catch (error) {
      if (error.code === "INIT_CANCELLED") {
        return success("init", { action: "cancel" }, "Initialization cancelled. No changes were made.");
      }
      throw error;
    }
  }
  const tools = plan?.tools || resolvedTools.tools;
  const toolSelection = { tools, source: plan ? (options.tools !== undefined ? "cli" : "interactive") : resolvedTools.source };
  const requestedVersion = plan?.openspec.selectedVersion || options["openspec-version"] || (options.yes ? manifest.resources.openspec.selectedVersion : undefined);
  const result = await initializeWorkspace(root, {
    run,
    tools,
    force: options.force === true,
    yes: plan ? true : options.yes === true,
    openspecVersion: requestedVersion,
    workspaceName: plan?.workspace.name || options["workspace-name"],
    workspaceUuid: plan?.workspace.uuid,
    monitor: plan?.monitor.enable ?? (options.monitor === true ? true : options["no-monitor"] === true ? false : undefined),
    monitorUrl: plan?.monitor.url || options["monitor-url"],
    language: plan?.language || options.language,
    interactive: false,
    initPlan: plan,
    onStage: null,
  });
  const data = {
    root: result.root,
    releaseVersion: result.manifest.releaseVersion,
    nodeVersion: result.nodeVersion,
    openspec: result.openspecResult,
    dependencies: result.dependencies,
    preparation: result.openSpecPreparation,
    obsoleteFiles: result.obsoleteFiles,
    managedFiles: result.managedFiles,
    schema: result.schema,
    localConfig: result.localConfig,
    workspace: result.workspaceConfig.workspace,
    monitor: result.workspaceConfig.monitor,
    language: result.language,
    tools: toolSelection,
    migration: migrationData(result.migration),
    permissions: result.permissions,
    verification: result.verification,
    plan: result.initPlan,
    stages: result.stages.map((stage) => stage.name),
  };
  const lines = [
    "OpenSpec Workspace is ready.",
    `Workspace: ${result.workspaceConfig.workspace.name} (${result.workspaceConfig.workspace.uuid})`,
    `Language: ${result.language}`,
    `Tools: ${tools.length ? tools.join(", ") : "none"} (${toolSelection.source})`,
  ];
  if (result.workspaceConfig.monitor.enable) {
    lines.push(`Codex monitoring reports to ${result.workspaceConfig.monitor.url}. Review and trust the project hooks with \`/hooks\` in Codex.`);
  }
  if (result.localConfig.action === "write" || result.permissions.writableRoots === 0) {
    lines.push(tools.length > 0
      ? "Add local projects with the `openspec-workspace-add-projects` skill."
      : "Add local projects with `openspec-workspace project inspect`, then register a complete project record.");
  }
  return success("init", data, lines.join("\n"));
}

module.exports = { executeInit, migrationData };
