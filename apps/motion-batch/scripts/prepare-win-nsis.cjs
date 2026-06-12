#!/usr/bin/env node
"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { Readable } = require("node:stream");
const { pipeline } = require("node:stream/promises");
const { setTimeout: delay } = require("node:timers/promises");
const { spawnSync } = require("node:child_process");

const PROJECT_ROOT = path.resolve(__dirname, "..");
const DEFAULT_CACHE_ROOT = path.join(PROJECT_ROOT, ".cache", "electron-builder-binaries");

const NSIS_ARTIFACT = {
  key: "nsis",
  label: "electron-builder NSIS",
  directory: "nsis-3.0.4.1",
  archiveName: "nsis-3.0.4.1.7z",
  url: "https://github.com/electron-userland/electron-builder-binaries/releases/download/nsis-3.0.4.1/nsis-3.0.4.1.7z",
  sha512: "VKMiizYdmNdJOWpRGz4trl4lD++BvYP2irAXpMilheUP0pc93iKlWAoP843Vlraj8YG19CVn0j+dCo/hURz9+Q=="
};

const NSIS_RESOURCES_ARTIFACT = {
  key: "nsisResources",
  label: "electron-builder NSIS resources",
  directory: "nsis-resources-3.4.1",
  archiveName: "nsis-resources-3.4.1.7z",
  url: "https://github.com/electron-userland/electron-builder-binaries/releases/download/nsis-resources-3.4.1/nsis-resources-3.4.1.7z",
  sha512: "Dqd6g+2buwwvoG1Vyf6BHR1b+25QMmPcwZx40atOT57gH27rkjOei1L0JTldxZu4NFoEmW4kJgZ3DlSWVON3+Q=="
};

async function prepareWinNsisToolchain({
  projectRoot = PROJECT_ROOT,
  env = process.env,
  cacheRoot = env.OPENFAD_MOTION_NSIS_CACHE || path.join(projectRoot, ".cache", "electron-builder-binaries"),
  platform = process.platform,
  arch = process.arch,
  artifacts = {
    nsis: NSIS_ARTIFACT,
    nsisResources: NSIS_RESOURCES_ARTIFACT
  },
  downloadFile = defaultDownloadFile,
  extractArchive = defaultExtractArchive,
  stageNativeTools = platform === "darwin",
  nativeToolsRoot = env.OPENFAD_MOTION_NATIVE_TOOLS_DIR || "/tmp/openfad-motion-batch-native-tools",
  log = () => {}
} = {}) {
  const customNsisDir = normalizeEnvPath(env.ELECTRON_BUILDER_NSIS_DIR);
  const customResourcesDir = normalizeEnvPath(env.ELECTRON_BUILDER_NSIS_RESOURCES_DIR);

  if (customNsisDir || customResourcesDir) {
    if (!customNsisDir || !customResourcesDir) {
      throw new Error("Set both ELECTRON_BUILDER_NSIS_DIR and ELECTRON_BUILDER_NSIS_RESOURCES_DIR, or unset both so the project can prepare a pinned local NSIS toolchain.");
    }
    verifyNsisDirectory(customNsisDir, { platform });
    verifyNsisResourcesDirectory(customResourcesDir);
    return {
      env: { ...env },
      nsisDir: customNsisDir,
      nsisResourcesDir: customResourcesDir,
      source: "environment"
    };
  }

  const nsisDir = await ensureArtifactDirectory(artifacts.nsis, {
    cacheRoot,
    projectRoot,
    platform,
    arch,
    verifyDirectory: (directory) => verifyNsisDirectory(directory, { platform }),
    downloadFile,
    extractArchive,
    log
  });
  const nsisResourcesDir = await ensureArtifactDirectory(artifacts.nsisResources, {
    cacheRoot,
    projectRoot,
    platform,
    arch,
    verifyDirectory: verifyNsisResourcesDirectory,
    downloadFile,
    extractArchive,
    log
  });

  const staged = stageNativeTools
    ? stageNsisToolchainForNativeExecution({ nsisDir, nsisResourcesDir, platform, nativeToolsRoot })
    : { nsisDir, nsisResourcesDir, sourceSuffix: "" };

  return {
    env: {
      ...env,
      ELECTRON_BUILDER_NSIS_DIR: staged.nsisDir,
      ELECTRON_BUILDER_NSIS_RESOURCES_DIR: staged.nsisResourcesDir
    },
    nsisDir: staged.nsisDir,
    nsisResourcesDir: staged.nsisResourcesDir,
    source: `project-cache${staged.sourceSuffix}`
  };
}

function stageNsisToolchainForNativeExecution({
  nsisDir,
  nsisResourcesDir,
  platform = process.platform,
  nativeToolsRoot = "/tmp/openfad-motion-batch-native-tools"
} = {}) {
  if (platform !== "darwin") {
    return { nsisDir, nsisResourcesDir, sourceSuffix: "" };
  }
  const digest = sha512File(resolveMakensisPath(nsisDir, platform)).slice(0, 16).replace(/[^A-Za-z0-9]/g, "");
  const unique = `${process.pid}-${Date.now()}`;
  const stagedNsisDir = path.join(nativeToolsRoot, `nsis-${digest}-${unique}`);
  const stagedResourcesDir = path.join(nativeToolsRoot, `nsis-resources-${unique}`);
  fs.rmSync(stagedNsisDir, { recursive: true, force: true });
  fs.rmSync(stagedResourcesDir, { recursive: true, force: true });
  fs.mkdirSync(nativeToolsRoot, { recursive: true });
  fs.cpSync(nsisDir, stagedNsisDir, { recursive: true });
  fs.cpSync(nsisResourcesDir, stagedResourcesDir, { recursive: true });
  verifyNsisDirectory(stagedNsisDir, { platform });
  verifyNsisResourcesDirectory(stagedResourcesDir);
  return {
    nsisDir: stagedNsisDir,
    nsisResourcesDir: stagedResourcesDir,
    sourceSuffix: "-staged"
  };
}

async function ensureArtifactDirectory(artifact, {
  cacheRoot,
  projectRoot,
  platform,
  arch,
  verifyDirectory,
  downloadFile,
  extractArchive,
  log
}) {
  const targetDir = path.join(cacheRoot, artifact.directory);
  if (directoryIsUsable(targetDir, verifyDirectory)) {
    return targetDir;
  }

  fs.mkdirSync(cacheRoot, { recursive: true });
  const archivePath = path.join(cacheRoot, artifact.archiveName);
  const tempDir = path.join(cacheRoot, `.${artifact.directory}.${process.pid}.${Date.now()}`);

  try {
    log(`Downloading ${artifact.label} ${artifact.archiveName}`);
    await downloadFile(artifact.url, archivePath, { artifact });
    verifyArchiveChecksum(archivePath, artifact);
    fs.rmSync(tempDir, { recursive: true, force: true });
    await extractArchive(archivePath, tempDir, { artifact, projectRoot, platform, arch });
    verifyDirectory(tempDir);
    fs.rmSync(targetDir, { recursive: true, force: true });
    fs.renameSync(tempDir, targetDir);
    verifyDirectory(targetDir);
    return targetDir;
  } catch (error) {
    fs.rmSync(tempDir, { recursive: true, force: true });
    throw error;
  } finally {
    fs.rmSync(archivePath, { force: true });
  }
}

function directoryIsUsable(directoryPath, verifyDirectory) {
  try {
    verifyDirectory(directoryPath);
    return true;
  } catch {
    return false;
  }
}

async function defaultDownloadFile(url, destination, {
  retries = 5,
  timeoutMs = 240_000
} = {}) {
  let lastError = null;
  for (let attempt = 1; attempt <= retries; attempt += 1) {
    try {
      await downloadOnce(url, destination, { timeoutMs });
      return;
    } catch (error) {
      lastError = error;
      fs.rmSync(destination, { force: true });
      if (attempt < retries) {
        await delay(Math.min(1000 * attempt, 5000));
      }
    }
  }
  throw new Error(`Failed to download ${url} after ${retries} attempts: ${lastError?.message ?? "unknown error"}`);
}

async function downloadOnce(url, destination, { timeoutMs }) {
  if (typeof fetch !== "function") {
    throw new Error("This Node.js runtime does not provide fetch; Node 20 or newer is required.");
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  timer.unref?.();
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status} ${response.statusText}`);
    }
    if (!response.body) {
      throw new Error("download response did not include a body");
    }
    await pipeline(Readable.fromWeb(response.body), fs.createWriteStream(destination));
  } finally {
    clearTimeout(timer);
  }
}

function defaultExtractArchive(archivePath, outputDir, { projectRoot = PROJECT_ROOT, platform = process.platform, arch = process.arch } = {}) {
  const extractor = resolveArchiveExtractor({ projectRoot, platform, arch });
  fs.mkdirSync(outputDir, { recursive: true });
  const result = spawnSync(extractor.command, extractor.args(archivePath, outputDir), {
    encoding: "utf8",
    maxBuffer: 20 * 1024 * 1024
  });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    const detail = [result.stdout, result.stderr].filter(Boolean).join("\n").trim();
    const status = result.signal ? `signal ${result.signal}` : `exit ${result.status}`;
    throw new Error(`Failed to extract ${path.basename(archivePath)} with ${extractor.label} (${status}).${detail ? `\n${detail}` : ""}`);
  }
}

function resolveArchiveExtractor({
  projectRoot = PROJECT_ROOT,
  platform = process.platform,
  arch = process.arch,
  hasCommand = commandExists
} = {}) {
  if (platform !== "win32" && hasCommand("bsdtar")) {
    return {
      label: "bsdtar",
      command: "bsdtar",
      args: (archivePath, outputDir) => ["-xf", archivePath, "-C", outputDir]
    };
  }

  const sevenZipPath = resolveSevenZipPath({ projectRoot, platform, arch });
  return {
    label: "7za",
    command: sevenZipPath,
    args: (archivePath, outputDir) => ["x", archivePath, `-o${outputDir}`, "-y"]
  };
}

function resolveSevenZipPath({ projectRoot = PROJECT_ROOT, platform = process.platform, arch = process.arch } = {}) {
  if (platform === "darwin" && arch === "arm64") {
    return path.join(projectRoot, "scripts", "bin", "7za");
  }
  return require("7zip-bin").path7za;
}

function commandExists(command) {
  const result = spawnSync("sh", ["-c", `command -v ${command}`], { stdio: "ignore" });
  return result.status === 0;
}

function verifyArchiveChecksum(archivePath, artifact) {
  const actual = sha512File(archivePath);
  if (actual !== artifact.sha512) {
    throw new Error(`${artifact.label} checksum mismatch for ${artifact.archiveName}: expected ${artifact.sha512}, found ${actual}.`);
  }
}

function verifyNsisDirectory(directoryPath, { platform = process.platform } = {}) {
  assertDirectory(directoryPath, "NSIS directory");
  assertFile(resolveMakensisPath(directoryPath, platform), "NSIS makensis binary");
  assertFile(path.join(directoryPath, "elevate.exe"), "NSIS elevate helper");
  const makensis = resolveMakensisPath(directoryPath, platform);
  if (platform !== "win32") {
    fs.chmodSync(makensis, 0o755);
  }
}

function verifyNsisResourcesDirectory(directoryPath) {
  assertDirectory(directoryPath, "NSIS resources directory");
  assertFile(path.join(directoryPath, "plugins", "x86-unicode", "StdUtils.dll"), "NSIS StdUtils plugin");
}

function resolveMakensisPath(directoryPath, platform = process.platform) {
  if (platform === "win32") return path.join(directoryPath, "Bin", "makensis.exe");
  if (platform === "darwin") return path.join(directoryPath, "mac", "makensis");
  return path.join(directoryPath, "linux", "makensis");
}

function assertDirectory(directoryPath, label) {
  let stat;
  try {
    stat = fs.statSync(directoryPath);
  } catch (error) {
    if (error.code === "ENOENT") throw new Error(`Missing ${label}: ${directoryPath}`);
    throw error;
  }
  if (!stat.isDirectory()) throw new Error(`${label} is not a directory: ${directoryPath}`);
}

function assertFile(filePath, label) {
  let stat;
  try {
    stat = fs.statSync(filePath);
  } catch (error) {
    if (error.code === "ENOENT") throw new Error(`Missing ${label}: ${filePath}`);
    throw error;
  }
  if (!stat.isFile()) throw new Error(`${label} is not a file: ${filePath}`);
}

function sha512File(filePath) {
  const hash = crypto.createHash("sha512");
  const file = fs.openSync(filePath, "r");
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  try {
    let bytesRead = 0;
    while ((bytesRead = fs.readSync(file, buffer, 0, buffer.length, null)) > 0) {
      hash.update(buffer.subarray(0, bytesRead));
    }
    return hash.digest("base64");
  } finally {
    fs.closeSync(file);
  }
}

function normalizeEnvPath(value) {
  const normalized = typeof value === "string" ? value.trim() : "";
  return normalized.length > 0 ? normalized : null;
}

async function run() {
  const result = await prepareWinNsisToolchain({
    log: (message) => console.log(message)
  });
  console.log(`Prepared Windows NSIS toolchain from ${result.source}: ${result.nsisDir}`);
  console.log(`Prepared Windows NSIS resources from ${result.source}: ${result.nsisResourcesDir}`);
}

if (require.main === module) {
  run().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}

module.exports = {
  DEFAULT_CACHE_ROOT,
  NSIS_ARTIFACT,
  NSIS_RESOURCES_ARTIFACT,
  prepareWinNsisToolchain,
  resolveArchiveExtractor,
  resolveMakensisPath,
  resolveSevenZipPath,
  stageNsisToolchainForNativeExecution,
  verifyNsisDirectory,
  verifyNsisResourcesDirectory
};
