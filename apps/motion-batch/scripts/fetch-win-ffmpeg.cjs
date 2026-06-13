#!/usr/bin/env node
"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { Readable } = require("node:stream");
const { pipeline } = require("node:stream/promises");
const { setTimeout: delay } = require("node:timers/promises");
const { spawnSync } = require("node:child_process");

const { resolveArchiveExtractor } = require("./prepare-win-nsis.cjs");
const { verifyWinFfmpegResources } = require("./verify-win-ffmpeg.cjs");

const PROJECT_ROOT = path.resolve(__dirname, "..");
const DEFAULT_MANIFEST = path.join(__dirname, "win-ffmpeg-manifest.json");

async function prepareWinFfmpegResources({
  projectRoot = PROJECT_ROOT,
  manifestPath = DEFAULT_MANIFEST,
  cacheRoot = process.env.OPENFAD_MOTION_FFMPEG_CACHE || path.join(projectRoot, ".cache", "ffmpeg"),
  downloadFile = defaultDownloadFile,
  extractArchive = defaultExtractArchive,
  platform = process.platform,
  arch = process.arch,
  log = () => {}
} = {}) {
  try {
    const verified = verifyWinFfmpegResources({ projectRoot, manifestPath });
    return { source: "existing", ...verified };
  } catch {}

  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  if (!manifest.archive) {
    throw new Error(`Windows FFmpeg manifest is missing archive metadata: ${path.relative(projectRoot, manifestPath)}`);
  }

  fs.mkdirSync(cacheRoot, { recursive: true });
  const archivePath = path.join(cacheRoot, manifest.archive.name);
  const tempDir = path.join(cacheRoot, `.extract-${process.pid}-${Date.now()}`);

  try {
    if (!archiveIsUsable(archivePath, manifest.archive)) {
      log(`Downloading ${manifest.label}: ${manifest.archive.name}`);
      await downloadFile(manifest.archive.url, archivePath, { archive: manifest.archive });
    }
    verifyArchive(archivePath, manifest.archive);
    fs.rmSync(tempDir, { recursive: true, force: true });
    await extractArchive(archivePath, tempDir, { projectRoot, platform, arch });
    stageResourcesFromArchive({ projectRoot, tempDir, manifest });
    return { source: "download", ...verifyWinFfmpegResources({ projectRoot, manifestPath }) };
  } catch (error) {
    fs.rmSync(tempDir, { recursive: true, force: true });
    throw error;
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

function archiveIsUsable(archivePath, archive) {
  try {
    verifyArchive(archivePath, archive);
    return true;
  } catch {
    fs.rmSync(archivePath, { force: true });
    return false;
  }
}

function verifyArchive(archivePath, archive) {
  const stat = fs.statSync(archivePath);
  if (!stat.isFile()) throw new Error(`FFmpeg archive is not a file: ${archivePath}`);
  if (stat.size !== archive.size) {
    throw new Error(`FFmpeg archive size mismatch for ${archive.name}: expected ${archive.size}, found ${stat.size}.`);
  }
  const actual = sha256File(archivePath);
  if (actual !== archive.sha256) {
    throw new Error(`FFmpeg archive checksum mismatch for ${archive.name}: expected ${archive.sha256}, found ${actual}.`);
  }
}

function stageResourcesFromArchive({ projectRoot, tempDir, manifest }) {
  for (const resource of manifest.resources) {
    const source = path.join(tempDir, archiveMemberPath(manifest.archive, resource));
    const target = path.join(projectRoot, resource.path);
    assertFile(source, `archive member for ${resource.path}`);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(source, target);
  }
}

function archiveMemberPath(archive, resource) {
  const member = resource.archivePath || path.posix.join(archive.rootDir, "bin", path.posix.basename(resource.path));
  if (path.isAbsolute(member) || member.includes("..")) {
    throw new Error(`FFmpeg archive member path must stay archive-relative: ${member}`);
  }
  return member.split("/").join(path.sep);
}

async function defaultDownloadFile(url, destination, { retries = 5, timeoutMs = 600_000 } = {}) {
  let lastError = null;
  for (let attempt = 1; attempt <= retries; attempt += 1) {
    try {
      await downloadOnce(url, destination, { timeoutMs });
      return;
    } catch (error) {
      lastError = error;
      fs.rmSync(destination, { force: true });
      if (attempt < retries) await delay(Math.min(1000 * attempt, 5000));
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
    if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}`);
    if (!response.body) throw new Error("download response did not include a body");
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
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const detail = [result.stdout, result.stderr].filter(Boolean).join("\n").trim();
    const status = result.signal ? `signal ${result.signal}` : `exit ${result.status}`;
    throw new Error(`Failed to extract ${path.basename(archivePath)} with ${extractor.label} (${status}).${detail ? `\n${detail}` : ""}`);
  }
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

async function run() {
  const result = await prepareWinFfmpegResources({
    log: (message) => console.log(message)
  });
  console.log(`Prepared ${result.manifest.label} from ${result.source}: ${result.verified.join(", ")}`);
}

if (require.main === module) {
  run().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}

module.exports = {
  archiveMemberPath,
  prepareWinFfmpegResources,
  verifyArchive
};
