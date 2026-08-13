const fs = require("node:fs");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const readline = require("node:readline/promises");

const { cleanupObsoleteAssets, OBSOLETE_ASSETS } = require("./assets");
const {
  DEFAULT_MONITOR_URL,
  DEFAULT_WORKSPACE_NAME,
  configPath,
  ensureLocalIgnore,
  loadConfig,
  normalizeConfig,
  saveConfig,
  statePath,
} = require("./config");
const { doctorWorkspace } = require("./doctor");
const {
  MANIFEST_FILE,
  commitInitializationState,
  compareVersions,
  installWorkspaceDependencies,
  loadInitManifest,
  minimumFromRange,
  runCommand,
} = require("./init");
const { applyPermissionPlan, permissionTargets, planPermissionChanges } = require("./permissions");
const { installManagedFiles } = require("./managed-files");
const { DEFAULT_WORKSPACE_LANGUAGE, workspaceGuide } = require("./language");
const { planWorkspaceMaintenance } = require("./migration");
const { createFileTransaction } = require("./transaction");
const { validateProjects } = require("./validation");

const INITIALIZATION_STAGE_IDS = Object.freeze({
  "Configure workspace identity": "configure-workspace",
  "Validate manifest": "validate-manifest",
  "Install workspace dependencies": "install-dependencies",
  "Remove obsolete managed files": "cleanup-obsolete",
  "Install managed files": "install-managed-files",
  "Prepare local workspace configuration": "save-config",
  "Apply Agent workspace permissions": "apply-permissions",
  "Run strict workspace doctor": "strict-doctor",
  "Commit local initialization state": "commit-state",
  "Verify local initialization state": "final-verify",
});

async function collectWorkspaceSetup(root, options = {}) {
  const language = options.language || DEFAULT_WORKSPACE_LANGUAGE;
  const file = configPath(root);
  if (fs.existsSync(file)) {
    const current = loadConfig(root, { defaultLanguage: language });
    return normalizeConfig({
      ...current,
      workspace: current.workspace || {
        name: options.workspaceName || DEFAULT_WORKSPACE_NAME,
        uuid: randomUUID(),
      },
      monitor: {
        ...current.monitor,
        ...(options.monitor !== undefined ? { enable: options.monitor === true } : {}),
        ...(options.monitorUrl ? { url: options.monitorUrl } : {}),
      },
    });
  }

  const interactive = options.interactive ?? (process.stdin.isTTY && process.stdout.isTTY);
  let name = options.workspaceName;
  let monitorEnabled = options.monitor;
  if (interactive && (!name || (monitorEnabled === undefined && options.tools.includes("codex")))) {
    const prompt = readline.createInterface({ input: options.input || process.stdin, output: options.output || process.stdout });
    try {
      if (!name) name = (await prompt.question(`Workspace name [${DEFAULT_WORKSPACE_NAME}]: `)).trim() || DEFAULT_WORKSPACE_NAME;
      if (monitorEnabled === undefined && options.tools.includes("codex")) {
        monitorEnabled = /^y(?:es)?$/i.test((await prompt.question("Enable Codex Agent monitoring hooks? [y/N] ")).trim());
      }
    } finally {
      prompt.close();
    }
  }
  return normalizeConfig({
    schemaVersion: 2,
    workspace: { name: name || DEFAULT_WORKSPACE_NAME, uuid: options.workspaceUuid || randomUUID(), language },
    monitor: {
      enable: options.tools.includes("codex") && monitorEnabled !== false,
      url: options.monitorUrl || DEFAULT_MONITOR_URL,
    },
    projects: [],
  });
}

async function initializeWorkspaceStages(rootInput, options = {}) {
  const root = path.resolve(rootInput || ".");
  const migration = options.migration || planWorkspaceMaintenance(root, {
    language: options.language,
    defaultLanguage: DEFAULT_WORKSPACE_LANGUAGE,
    allowLegacy: true,
  });
  const language = migration.language.value;
  fs.mkdirSync(root, { recursive: true });
  const run = options.run || runCommand;
  options = { ...options, language };
  const stages = [];
  const stage = async (name, action) => {
    options.onStage?.(name);
    const value = await action();
    options.injectFailure?.(INITIALIZATION_STAGE_IDS[name] || name, value);
    stages.push({ name, result: value });
    return value;
  };

  const workspaceConfig = await stage("Configure workspace identity", () => collectWorkspaceSetup(root, options));
  const capabilities = workspaceConfig.monitor.enable ? ["monitor"] : [];

  const manifest = await stage("Validate manifest", () => loadInitManifest(options.manifestFile || MANIFEST_FILE));
  const minimumNode = minimumFromRange(manifest.requirements.node);
  const nodeVersion = options.nodeVersion || process.versions.node;
  if (compareVersions(nodeVersion, minimumNode) < 0) {
    throw new Error(`Node ${minimumNode} or newer is required; found ${nodeVersion}`);
  }

  const dependencies = await stage("Install workspace dependencies", () =>
    installWorkspaceDependencies(root, { run })
  );
  if (dependencies.action === "install") {
    options.transaction?.recordExternalEffect({
      kind: "retained-local-effect",
      name: "workspace dependencies",
      targets: dependencies.retainedPaths,
      verified: dependencies.verified === true,
    });
  }

  const obsoleteFiles = await stage("Remove obsolete managed files", () =>
    cleanupObsoleteAssets(root, options.tools, { force: options.force === true })
  );

  const managedFiles = await stage("Install managed files", () =>
    installManagedFiles(root, manifest, options.tools, {
      force: options.force === true,
      capabilities,
      variables: { WORKSPACE_LANGUAGE: language, WORKSPACE_USER_GUIDE: workspaceGuide(language) },
    })
  );

  const localConfig = await stage("Prepare local workspace configuration", () => {
    const file = configPath(root);
    const action = fs.existsSync(file) ? "skip" : "write";
    saveConfig(root, workspaceConfig);
    return { action, file: path.relative(root, file), gitignore: ensureLocalIgnore(root) };
  });

  const config = loadConfig(root);
  const projects = validateProjects(root, config);
  if (projects.errors.length > 0) {
    throw new Error(`Local project verification failed: ${projects.errors.join("; ")}`);
  }
  const permissions = await stage("Apply Agent workspace permissions", () => {
    const permissionPlan = planPermissionChanges({
      root,
      tools: options.tools,
      grants: config.projects.map((project) => project.location),
    });
    return applyPermissionPlan(permissionPlan, { transaction: options.transaction });
  });

  await stage("Run strict workspace doctor", () => {
    const result = doctorWorkspace(root, manifest, {
      allowIncompleteState: true,
      run,
      tools: options.tools,
      capabilities,
    });
    if (result.errors.length > 0) throw new Error(`Workspace doctor failed: ${result.errors.join("; ")}`);
    return { warnings: result.warnings, projects: config.projects.length };
  });

  const state = await stage("Commit local initialization state", () =>
    commitInitializationState(root, manifest, {
      manifestFile: options.manifestFile || MANIFEST_FILE,
      tools: options.tools,
      language,
    })
  );

  const verification = await stage("Verify local initialization state", () => {
    const result = doctorWorkspace(root, manifest, { run, tools: options.tools, capabilities });
    if (result.errors.length > 0) throw new Error(`Final workspace verification failed: ${result.errors.join("; ")}`);
    return { warnings: result.warnings, projects: config.projects.length };
  });

  return {
    root,
    manifest,
    nodeVersion,
    language,
    migration,
    dependencies,
    obsoleteFiles,
    managedFiles,
    localConfig,
    workspaceConfig: config,
    permissions,
    state,
    verification,
    initPlan: options.initPlan || null,
    stages,
  };
}

async function initializeWorkspace(rootInput, options = {}) {
  const root = path.resolve(rootInput || ".");
  const manifest = loadInitManifest(options.manifestFile || MANIFEST_FILE);
  const files = [
    statePath(root),
    configPath(root),
    path.join(root, ".gitignore"),
    path.join(root, ".codex", "config.toml"),
    ...permissionTargets(root, options.tools),
    ...manifest.managedFiles.map((entry) => path.join(root, entry.target)),
    ...OBSOLETE_ASSETS.map((target) => path.join(root, target)),
  ];
  const transaction = createFileTransaction(files);
  try {
    const result = await initializeWorkspaceStages(root, { ...options, transaction });
    transaction.commit();
    return result;
  } catch (error) {
    transaction.rollback(error);
    throw error;
  }
}

module.exports = { INITIALIZATION_STAGE_IDS, collectWorkspaceSetup, initializeWorkspace, initializeWorkspaceStages };
