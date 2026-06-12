"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const stagedSevenZipPath = stageSevenZipForElectronBuilder();
patchSevenZipListEstimate({ stagedSevenZipPath });

function stageSevenZipForElectronBuilder({
  projectRoot = process.cwd(),
  platform = process.platform,
  arch = process.arch,
  tempRoot = process.env.OPENFAD_MOTION_NATIVE_TOOLS_DIR || "/tmp/openfad-motion-batch-native-tools"
} = {}) {
  if (platform !== "darwin") return null;
  const sevenZipBin = require("7zip-bin");
  const sourcePath = resolveBundledSevenZipPath({ projectRoot, arch });
  const digest = sha256File(sourcePath).slice(0, 16);
  const targetDir = path.join(tempRoot, `7za-${arch}-${digest}-${process.pid}-${Date.now()}`);
  const targetPath = path.join(targetDir, "7za");
  fs.mkdirSync(targetDir, { recursive: true });
  fs.copyFileSync(sourcePath, targetPath);
  fs.chmodSync(targetPath, 0o755);
  sevenZipBin.path7za = targetPath;
  return targetPath;
}

function resolveBundledSevenZipPath({ projectRoot = process.cwd(), arch = process.arch } = {}) {
  const archPath = path.join(projectRoot, "node_modules", "7zip-bin", "mac", arch, "7za");
  if (fs.existsSync(archPath)) return archPath;
  return path.join(projectRoot, "node_modules", "7zip-bin", "mac", "x64", "7za");
}

function patchSevenZipListEstimate({ stagedSevenZipPath } = {}) {
  if (!stagedSevenZipPath) return false;
  const builderUtil = require("builder-util");
  if (builderUtil.__fadAppleMotionSevenZipListPatched) return true;
  const originalExec = builderUtil.exec;
  builderUtil.exec = function patchedExec(command, args, ...rest) {
    if (command === stagedSevenZipPath && Array.isArray(args) && args[0] === "l" && typeof args[1] === "string") {
      return Promise.resolve("0 0 0 files");
    }
    return originalExec.call(this, command, args, ...rest);
  };
  builderUtil.__fadAppleMotionSevenZipListPatched = true;
  return true;
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

module.exports = {
  patchSevenZipListEstimate,
  resolveBundledSevenZipPath,
  stageSevenZipForElectronBuilder
};
