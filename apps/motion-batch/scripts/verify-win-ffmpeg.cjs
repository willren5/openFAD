#!/usr/bin/env node
"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const DEFAULT_MANIFEST = path.join(__dirname, "win-ffmpeg-manifest.json");

function loadWinFfmpegManifest(manifestPath = DEFAULT_MANIFEST) {
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  if (!Array.isArray(manifest.resources) || manifest.resources.length === 0) {
    throw new Error(`Invalid Windows FFmpeg manifest: ${manifestPath}`);
  }
  return manifest;
}

function verifyWinFfmpegResources({
  projectRoot = path.resolve(__dirname, ".."),
  manifestPath = DEFAULT_MANIFEST
} = {}) {
  const manifest = loadWinFfmpegManifest(manifestPath);
  const verified = [];
  for (const resource of manifest.resources) {
    const relativePath = assertRelativeResourcePath(resource.path);
    const absolutePath = path.join(projectRoot, relativePath);
    let stat;
    try {
      stat = fs.statSync(absolutePath);
    } catch (error) {
      if (error.code === "ENOENT") {
        throw new Error(`Missing Windows FFmpeg resource: ${relativePath}. Restore the exact files listed in ${path.relative(projectRoot, manifestPath)} before running npm run dist:win.`);
      }
      throw error;
    }
    if (!stat.isFile()) {
      throw new Error(`Windows FFmpeg resource is not a file: ${relativePath}`);
    }
    if (stat.size !== resource.size) {
      throw new Error(`Windows FFmpeg resource size mismatch for ${relativePath}: expected ${resource.size}, found ${stat.size}.`);
    }
    const actualSha256 = sha256File(absolutePath);
    if (actualSha256 !== resource.sha256) {
      throw new Error(`Windows FFmpeg resource checksum mismatch for ${relativePath}: expected ${resource.sha256}, found ${actualSha256}.`);
    }
    verified.push(relativePath);
  }
  return { manifest, verified };
}

function assertRelativeResourcePath(resourcePath) {
  if (typeof resourcePath !== "string" || resourcePath.length === 0) {
    throw new Error("Windows FFmpeg manifest contains an empty resource path.");
  }
  if (path.isAbsolute(resourcePath) || resourcePath.includes("..")) {
    throw new Error(`Windows FFmpeg manifest resource path must stay project-relative: ${resourcePath}`);
  }
  return resourcePath;
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

function run() {
  const { manifest, verified } = verifyWinFfmpegResources();
  console.log(`Verified ${manifest.label}: ${verified.join(", ")}`);
}

if (require.main === module) {
  try {
    run();
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}

module.exports = {
  loadWinFfmpegManifest,
  verifyWinFfmpegResources
};
