import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import test from "node:test";
import assert from "node:assert/strict";

const execFileAsync = promisify(execFile);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");

test("packaged production source graph is visible to Git clean checkouts", async () => {
  const files = await collectProductionGraphFiles();
  const missing = [];
  for (const file of files) {
    if (!await isGitSourceFile(file)) missing.push(file);
  }

  assert.deepEqual(missing, []);
});

async function collectProductionGraphFiles() {
  const pkg = JSON.parse(await readFile(path.join(projectRoot, "package.json"), "utf8"));
  const entryFiles = new Set([
    normalizedRelativePath(pkg.main),
    normalizedRelativePath(pkg.bin["openfad-motion"]),
    "ui/server.mjs",
    "scripts/dist-win.cjs",
    "scripts/electron-builder-preload.cjs",
    "scripts/generate-win-icon.cjs",
    "scripts/prepare-win-nsis.cjs",
    "scripts/smoke-win-runtime.cjs",
    "scripts/verify-win-ffmpeg.cjs",
    "scripts/win-ffmpeg-manifest.json",
    "scripts/bin/7za",
    ...collectBuildFiles(pkg)
  ].filter(Boolean));

  const visited = new Set();
  const pending = [...entryFiles];
  while (pending.length > 0) {
    const file = pending.pop();
    if (visited.has(file) || !isSourceFile(file)) {
      visited.add(file);
      continue;
    }
    visited.add(file);
    for (const dependency of await collectLocalDependencies(file)) {
      if (!visited.has(dependency)) pending.push(dependency);
    }
  }

  return [...visited].sort();
}

function collectBuildFiles(pkg) {
  const files = [];
  for (const pattern of pkg.build?.files ?? []) {
    if (pattern.endsWith("/**/*")) {
      const directory = pattern.slice(0, -"/**/*".length);
      if (directory === "desktop") files.push(
        "desktop/bridgeLifecycle.cjs",
        "desktop/errorDialogs.cjs",
        "desktop/main.cjs",
        "desktop/pathPicker.cjs",
        "desktop/preload.cjs",
        "desktop/security.cjs",
        "desktop/videoTools.cjs"
      );
      if (directory === "src") files.push(
        "src/atomicOutput.mjs",
        "src/batch.mjs",
        "src/cli.mjs",
        "src/diagnostics.mjs",
        "src/encoder.mjs",
        "src/ffmpegArgs.mjs",
        "src/probe.mjs",
        "src/qc.mjs",
        "src/report.mjs",
        "src/spec.mjs"
      );
      if (directory === "ui") files.push(
        "ui/public/app.js",
        "ui/public/favicon.svg",
        "ui/public/index.html",
        "ui/public/styles.css",
        "ui/server.mjs"
      );
    } else {
      files.push(pattern);
    }
  }
  return files;
}

async function collectLocalDependencies(file) {
  const text = await readFile(path.join(projectRoot, file), "utf8");
  const dependencies = new Set();
  const patterns = [
    /import\s+(?:[^'"]+\s+from\s+)?["'](?<specifier>\.{1,2}\/[^"']+)["']/g,
    /await\s+import\(["'](?<specifier>\.{1,2}\/[^"']+)["']\)/g,
    /require\(["'](?<specifier>\.{1,2}\/[^"']+)["']\)/g,
    /preload:\s*path\.join\(__dirname,\s*["'](?<specifier>[^"']+)["']\)/g
  ];
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      const dependency = resolveDependency(file, match.groups.specifier);
      if (dependency) dependencies.add(dependency);
    }
  }
  return dependencies;
}

function resolveDependency(importer, specifier) {
  const importerDir = path.dirname(importer);
  const relative = specifier.startsWith(".")
    ? path.normalize(path.join(importerDir, specifier))
    : path.normalize(path.join(importerDir, specifier));
  return normalizedRelativePath(relative);
}

async function isGitSourceFile(file) {
  try {
    await execFileAsync("git", ["ls-files", "--error-unmatch", file], { cwd: projectRoot });
    return true;
  } catch {
    return false;
  }
}

function isSourceFile(file) {
  return /\.(?:mjs|cjs|js|json)$/.test(file);
}

function normalizedRelativePath(value) {
  if (!value || path.isAbsolute(value)) return null;
  return value.replace(/^\.\//, "").split(path.sep).join("/");
}
