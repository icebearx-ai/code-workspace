const { LOCAL_DIRECTORY } = require("../core/config");
const { EXTENSION_STATE_FILE } = require("../core/extensions");

function pluralizeExtension(count) {
  return `extension${count === 1 ? "" : "s"}`;
}

function installAction(plan, actionFor) {
  const action = actionFor(plan);
  return action === "update" ? "Update" : "Install";
}

function formatExtensionChanges(installPlans = [], uninstallPlans = [], options = {}) {
  const plans = Array.from(installPlans || []);
  const removals = Array.from(uninstallPlans || []);
  const total = plans.length + removals.filter((plan) => plan?.action !== "skip").length;
  if (total === 0) return "No extension changes.";

  const hasInstall = plans.length > 0;
  const hasUninstall = removals.some((plan) => plan?.action !== "skip");
  const title = options.title || (hasInstall && hasUninstall
    ? `Apply ${total} extension changes:`
    : hasUninstall
      ? `Uninstall ${total} ${pluralizeExtension(total)}:`
      : `${options.action === "update" ? "Update" : "Install"} ${total} ${pluralizeExtension(total)}:`);
  const actionFor = options.actionFor || ((plan) => plan.action || options.action || "install");
  const lines = [title];

  for (const plan of plans) {
    const details = [plan.source, plan.extensionSpecVersion ? `Extension Spec ${plan.extensionSpecVersion}` : null].filter(Boolean);
    lines.push(`  ${installAction(plan, actionFor)} ${plan.id}@${plan.version}${details.length ? ` [${details.join("] [")}]` : ""}`);
    lines.push(`    PACKAGE ${plan.packageSha256}`);
    for (const host of plan.capabilities?.networkHosts || []) lines.push(`    NETWORK https://${host}`);
    for (const artifact of plan.artifacts || []) lines.push(`    WRITE ${artifact.target} (${artifact.kind})`);
    for (const hook of plan.hooks || []) {
      lines.push(`    HOOK ${hook.id} (${hook.event}${hook.tools?.length ? ` · ${hook.tools.join(",")}` : ""}) -> ${hook.command}`);
    }
  }

  for (const plan of removals) {
    if (!plan || plan.action === "skip") continue;
    const id = typeof plan === "string" ? plan : plan.id;
    const version = typeof plan === "string" ? null : plan.version;
    lines.push(`  Uninstall ${id}${version ? `@${version}` : ""}`);
    for (const target of plan.targets || []) lines.push(`    REMOVE ${target}`);
    lines.push(`    REMOVE ${LOCAL_DIRECTORY}/${EXTENSION_STATE_FILE} entry`);
  }
  return lines.join("\n");
}

module.exports = { formatExtensionChanges };
