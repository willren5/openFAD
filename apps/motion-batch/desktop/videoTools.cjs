const fs = require("node:fs");
const path = require("node:path");

function configureBundledFfmpeg({
  toolRoot,
  resourcesPath = process.resourcesPath,
  execPath = process.execPath,
  env = process.env,
  platform = process.platform,
  arch = process.arch,
  existsSync = fs.existsSync
} = {}) {
  const bundled = resolveBundledVideoTools({
    toolRoot,
    resourcesPath,
    execPath,
    platform,
    arch,
    existsSync
  });
  if (!bundled) return null;

  env.FFMPEG_PATH = bundled.ffmpegPath;
  env.FFPROBE_PATH = bundled.ffprobePath;
  env.PATH = prependPath(env.PATH, bundled.binDir);
  return bundled;
}

function resolveBundledVideoTools({
  toolRoot,
  resourcesPath,
  execPath,
  platform = process.platform,
  arch = process.arch,
  existsSync = fs.existsSync
} = {}) {
  const exe = platform === "win32" ? ".exe" : "";
  const candidates = [
    resourcesPath ? path.join(resourcesPath, "bin") : "",
    execPath ? path.join(path.dirname(execPath), "bin") : "",
    toolRoot ? path.join(toolRoot, "vendor", "ffmpeg", platformFolder(platform), arch) : ""
  ].filter(Boolean);

  for (const binDir of candidates) {
    const ffmpegPath = path.join(binDir, `ffmpeg${exe}`);
    const ffprobePath = path.join(binDir, `ffprobe${exe}`);
    if (existsSync(ffmpegPath) && existsSync(ffprobePath)) {
      return { binDir, ffmpegPath, ffprobePath };
    }
  }
  return null;
}

function prependPath(currentPath, binDir) {
  const existing = String(currentPath ?? "");
  return existing ? `${binDir}${path.delimiter}${existing}` : binDir;
}

function platformFolder(platform = process.platform) {
  if (platform === "win32") return "win";
  if (platform === "darwin") return "mac";
  return platform;
}

module.exports = {
  configureBundledFfmpeg,
  resolveBundledVideoTools,
  platformFolder
};
