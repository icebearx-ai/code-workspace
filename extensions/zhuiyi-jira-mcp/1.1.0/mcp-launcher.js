#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");

const { prepareRelease, validatePackage } = require("./lib/archive");
const release = require("./release.json");

const extensionRoot = __dirname;
const storeRoot = path.dirname(path.dirname(extensionRoot));
const cacheRoot = path.join(storeRoot, ".runtime-data", release.package.name, release.package.version);
const packageRoot = path.join(cacheRoot, "package");
const entry = path.join(packageRoot, ...release.entry.split("/"));
const lock = `${packageRoot}.lock`;

function validPackage() {
  try {
    validatePackage(packageRoot, release);
    return true;
  } catch {
    return false;
  }
}

async function ensurePackage() {
  if (validPackage()) return;
  fs.mkdirSync(path.dirname(packageRoot), { recursive: true });
  let owner = false;
  try {
    fs.mkdirSync(lock);
    owner = true;
    if (!validPackage()) {
      const staging = `${packageRoot}.staging-${process.pid}-${Date.now()}`;
      try {
        await prepareRelease(release, staging);
        if (validPackage()) fs.rmSync(staging, { recursive: true, force: true });
        else fs.renameSync(staging, packageRoot);
      } finally {
        if (fs.existsSync(staging)) fs.rmSync(staging, { recursive: true, force: true });
      }
    }
  } finally {
    if (owner) fs.rmSync(lock, { recursive: true, force: true });
  }
  if (!validPackage()) throw new Error(`Unable to prepare ${release.package.name}@${release.package.version}`);
}

async function main() {
  await ensurePackage();
  const child = spawn(process.execPath, [entry], {
    cwd: process.cwd(),
    env: process.env,
    stdio: "inherit",
  });
  child.once("error", (error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
  child.once("exit", (code, signal) => {
    if (signal) process.kill(process.pid, signal);
    else process.exitCode = code || 0;
  });
}

main().catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
});
