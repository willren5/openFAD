#!/usr/bin/env node
"use strict";

const { spawn } = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const { prepareWinNsisToolchain } = require("./prepare-win-nsis.cjs");
const { verifyWinFfmpegResources } = require("./verify-win-ffmpeg.cjs");

function buildElectronBuilderEnvironment({
  env = process.env,
  platform = process.platform,
  arch = process.arch,
  cwd = process.cwd()
} = {}) {
  const nextEnv = { ...env };
  if (platform === "darwin" && arch === "arm64") {
    nextEnv.USE_SYSTEM_7ZA = "true";
    nextEnv.NODE_OPTIONS = [
      env.NODE_OPTIONS,
      "--require=./scripts/electron-builder-preload.cjs"
    ].filter(Boolean).join(" ");
    nextEnv.PATH = [
      path.join(cwd, "scripts", "bin"),
      env.PATH
    ].filter(Boolean).join(path.delimiter);
  }
  return nextEnv;
}

function buildElectronBuilderInvocation({
  nodeExecutable = process.execPath,
  cwd = process.cwd()
} = {}) {
  return {
    command: nodeExecutable,
    args: [
      path.join(cwd, "node_modules", "electron-builder", "out", "cli", "cli.js"),
      "--win",
      "portable",
      "--x64"
    ]
  };
}

async function prepareAppBuilderBinary({
  env = process.env,
  projectRoot = process.cwd(),
  platform = process.platform,
  arch = process.arch,
  tempRoot = defaultNativeToolsRoot(),
  verifyExecutable = verifyAppBuilderExecutable
} = {}) {
  const customPath = normalizeEnvPath(env.CUSTOM_APP_BUILDER_PATH);
  if (customPath) {
    assertExecutableFile(customPath, "custom app-builder binary");
    await verifyExecutable(customPath);
    return { ...env };
  }
  if (platform !== "darwin") {
    return { ...env };
  }

  const sourcePath = resolveBundledAppBuilderPath({ projectRoot, platform, arch });
  assertExecutableFile(sourcePath, "bundled app-builder binary");
  const digest = sha256File(sourcePath).slice(0, 16);
  const targetDir = path.join(tempRoot, `${platform}-${arch}-${digest}-${process.pid}-${Date.now()}`);
  const targetPath = path.join(targetDir, path.basename(sourcePath));
  fs.mkdirSync(targetDir, { recursive: true });
  fs.copyFileSync(sourcePath, targetPath);
  fs.chmodSync(targetPath, 0o755);
  await verifyExecutable(targetPath);
  return {
    ...env,
    CUSTOM_APP_BUILDER_PATH: targetPath
  };
}

function resolveBundledAppBuilderPath({
  projectRoot = process.cwd(),
  platform = process.platform,
  arch = process.arch
} = {}) {
  if (platform !== "darwin") {
    throw new Error(`Unsupported local app-builder staging platform: ${platform}`);
  }
  const binaryName = arch === "arm64" ? "app-builder_arm64" : "app-builder_amd64";
  return path.join(projectRoot, "node_modules", "app-builder-bin", "mac", binaryName);
}

function verifyAppBuilderExecutable(binaryPath) {
  const result = spawn(binaryPath, ["--version"], {
    stdio: ["ignore", "ignore", "pipe"]
  });
  const timeout = setTimeout(() => result.kill(), 5000);
  return new Promise((resolve, reject) => {
    result.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    result.on("exit", (code, signal) => {
      clearTimeout(timeout);
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`app-builder preflight failed for ${binaryPath}: ${signal ? `signal ${signal}` : `exit ${code ?? 1}`}`));
    });
  });
}

async function run() {
  verifyWinFfmpegResources();
  const nativeToolEnv = await prepareAppBuilderBinary({
    env: buildElectronBuilderEnvironment()
  });
  const prepared = await prepareWinNsisToolchain({
    env: nativeToolEnv,
    log: (message) => console.log(message)
  });
  const invocation = buildElectronBuilderInvocation();
  const child = spawn(invocation.command, invocation.args, {
    env: prepared.env,
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
  buildElectronBuilderEnvironment,
  buildElectronBuilderInvocation,
  prepareAppBuilderBinary,
  resolveBundledAppBuilderPath
};

function assertExecutableFile(filePath, label) {
  let stat;
  try {
    stat = fs.statSync(filePath);
  } catch (error) {
    if (error.code === "ENOENT") throw new Error(`Missing ${label}: ${filePath}`);
    throw error;
  }
  if (!stat.isFile()) throw new Error(`${label} is not a file: ${filePath}`);
}

function sha256File(filePath) {
  const hash = crypto.createHash("sha256");
  const file = fs.openSync(filePath, "r");
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  try {
    let bytesRead = 0;
    while ((bytesRead = fs.readSync(file, buffer, 0, buffer.length, null)) > 0) {
      hash.update(buffer.subarray(0, bytesRead));
    }
    return hash.digest("hex");
  } finally {
    fs.closeSync(file);
  }
}

function normalizeEnvPath(value) {
  const normalized = typeof value === "string" ? value.trim() : "";
  return normalized.length > 0 ? normalized : null;
}

function defaultNativeToolsRoot() {
  return process.env.OPENFAD_MOTION_NATIVE_TOOLS_DIR || "/tmp/openfad-motion-batch-native-tools";
}
