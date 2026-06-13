#!/usr/bin/env node
"use strict";

const { spawn } = require("node:child_process");
const path = require("node:path");

function buildMacElectronBuilderEnvironment({ env = process.env } = {}) {
  return {
    ...env,
    CSC_IDENTITY_AUTO_DISCOVERY: "false"
  };
}

function buildMacElectronBuilderInvocation({
  nodeExecutable = process.execPath,
  cwd = process.cwd()
} = {}) {
  return {
    command: nodeExecutable,
    args: [
      path.join(cwd, "node_modules", "electron-builder", "out", "cli", "cli.js"),
      "--mac",
      "dmg",
      "--arm64",
      "--config.directories.output=dist/macos"
    ]
  };
}

async function run() {
  if (process.platform !== "darwin") {
    throw new Error("macOS DMG packaging must run on macOS.");
  }
  const invocation = buildMacElectronBuilderInvocation();
  const child = spawn(invocation.command, invocation.args, {
    env: buildMacElectronBuilderEnvironment(),
    shell: false,
    stdio: "inherit"
  });

  child.on("error", (error) => {
    console.error(error.message);
    process.exit(1);
  });
  child.on("exit", (code, signal) => {
    if (signal) {
      process.kill(process.pid, signal);
      return;
    }
    process.exit(code ?? 1);
  });
}

if (require.main === module) {
  run().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}

module.exports = {
  buildMacElectronBuilderEnvironment,
  buildMacElectronBuilderInvocation
};
