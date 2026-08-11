const fs = require("node:fs");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const readline = require("node:readline/promises");

const { cleanupObsoleteAssets, ensureWorkspaceSchemaSelection, OBSOLETE_ASSETS } = require("./assets");
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
  ensureOpenSpec,
  installWorkspaceDependencies,
  loadInitManifest,
  minimumFromRange,
  prepareOpenSpec,
  runCommand,
} = require("./init");
const { syncPermissions } = require("./permissions");
const { installManagedFiles } = require("./managed-files");
const { DEFAULT_WORKSPACE_LANGUAGE, workspaceGuide } = require("./language");
const { planWorkspaceMaintenance } = require("./migration");
const { createFileTransaction } = require("./transaction");
const { validateProjects } = require("./validation");

const INITIALIZATION_STAGE_IDS = Object.freeze({
  "Configure workspace identity": "configure-workspace",
  "Validate manifest": "validate-manifest",
  "Check OpenSpec": "check-openspec",
  "Install workspace dependencies": "install-dependencies",
  "Prepare OpenSpec initialization": "prepare-openspec",
  "Remove obsolete managed files": "cleanup-obsolete",
  "Install managed files": "install-managed-files",
  "Select OpenSpec Workspace schema": "verify-schema",
  "Prepare local workspace configuration": "save-config",
  "Synchronize Codex workspace permissions": "sync-permissions",
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

  const openspecResult = await stage("Check OpenSpec", () => ensureOpenSpec(manifest.resources.openspec, {
    root,
    run,
    yes: options.yes,
    openspecVersion: options.openspecVersion,
    interactive: options.interactive,
    input: options.input,
    output: options.output,
  }));
  if (openspecResult.action === "install") {
    options.transaction?.recordExternalEffect({ kind: "global-package", name: "OpenSpec", version: openspecResult.version, verified: true });
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

  const openSpecPreparation = await stage("Prepare OpenSpec initialization", () =>
    prepareOpenSpec(root, manifest.resources.openspec, options.tools, { run })
  );
  if (openSpecPreparation.action === "init") {
    options.transaction?.recordExternalEffect({
      kind: "upstream-command-output",
      command: "openspec init",
      targets: openSpecPreparation.missing.map((file) => path.relative(root, file)),
      verified: openSpecPreparation.verified === true,
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

  const schema = await stage("Select OpenSpec Workspace schema", () =>
    ensureWorkspaceSchemaSelection(root)
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
  const permissions = await stage("Synchronize Codex workspace permissions", () => {
    if (config.projects.length === 0) return { action: "skip", writableRoots: 0, reason: "no local projects configured" };
    return syncPermissions(root, config.projects);
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
      openspecVersion: openspecResult.version,
      tools: options.tools,
      profile: manifest.resources.openspec.profile,
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
    openspecResult,
    dependencies,
    openSpecPreparation,
    obsoleteFiles,
    managedFiles,
    schema,
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
