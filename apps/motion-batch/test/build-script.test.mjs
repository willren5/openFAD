import { createRequire } from "node:module";
import crypto from "node:crypto";
import { chmod, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import assert from "node:assert/strict";

const require = createRequire(import.meta.url);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");

test("Windows package script uses the 7za-safe build wrapper", async () => {
  const pkg = require("../package.json");
  assert.equal(pkg.scripts["icon:win"], "node ./scripts/generate-win-icon.cjs");
  assert.equal(pkg.scripts["fetch:ffmpeg:win"], "node ./scripts/fetch-win-ffmpeg.cjs");
  assert.equal(pkg.scripts["prepare:dist:win"], "node ./scripts/prepare-win-nsis.cjs");
  assert.equal(pkg.scripts["dist:win"], "node ./scripts/dist-win.cjs");
  assert.equal(pkg.scripts["dist:mac"], "node ./scripts/dist-mac.cjs");
  assert.equal(pkg.scripts["verify:dist:win"], "node ./scripts/verify-win-ffmpeg.cjs");
  assert.equal(pkg.scripts["smoke:dist:win"], "node ./scripts/smoke-win-runtime.cjs");
  assert.equal(pkg.scripts["verify:smoke:win"], "node ./scripts/verify-win-smoke-evidence.cjs");
});

test("Windows package icon is reproducible from source", async () => {
  const pkg = require("../package.json");
  const { buildIco, DEFAULT_SIZES } = require("../scripts/generate-win-icon.cjs");
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const icon = buildIco(DEFAULT_SIZES.map((size) => ({ size, data: png })));
  const entries = parseIcoDirectory(icon);

  assert.equal(pkg.build.win.icon, "build/icon.ico");
  assert.equal(pkg.scripts["icon:win"], "node ./scripts/generate-win-icon.cjs");
  assert.deepEqual(entries.map((entry) => entry.width).sort((a, b) => a - b), [16, 24, 32, 48, 64, 128, 256]);
  assert.ok(entries.every((entry) => entry.bitDepth === 32));
  assert.ok(entries.every((entry) => entry.bytesInRes > 0));
});

test("build wrapper uses the local 7za shim on macOS arm64", async () => {
  const { buildElectronBuilderEnvironment } = require("../scripts/dist-win.cjs");
  const env = buildElectronBuilderEnvironment({
    env: { PATH: "/usr/bin" },
    platform: "darwin",
    arch: "arm64",
    cwd: projectRoot
  });

  assert.equal(env.USE_SYSTEM_7ZA, "true");
  assert.match(env.NODE_OPTIONS, /--require=\.\/scripts\/electron-builder-preload\.cjs/);
  assert.equal(env.PATH.split(path.delimiter)[0], path.join(projectRoot, "scripts", "bin"));
});

test("electron-builder preload stages 7za through a short custom path", async () => {
  const { stageSevenZipForElectronBuilder } = require("../scripts/electron-builder-preload.cjs");
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "apple-motion-7za-"));
  const fakeProject = path.join(tempDir, "project");
  const sourcePath = path.join(fakeProject, "node_modules", "7zip-bin", "mac", "arm64", "7za");
  const tempRoot = path.join(tempDir, "native-tools");
  await mkdir(path.dirname(sourcePath), { recursive: true });
  await writeFile(sourcePath, "fake 7za");
  await chmod(sourcePath, 0o755);

  const stagedPath = stageSevenZipForElectronBuilder({
    projectRoot: fakeProject,
    platform: "darwin",
    arch: "arm64",
    tempRoot
  });

  assert.match(stagedPath, new RegExp(`^${escapeRegExp(tempRoot)}`));
  assert.equal(await readFile(stagedPath, "utf8"), "fake 7za");
});

test("electron-builder preload avoids a second 7za launch for NSIS package size estimates", async () => {
  const { patchSevenZipListEstimate } = require("../scripts/electron-builder-preload.cjs");
  const builderUtil = require("builder-util");
  const originalExec = builderUtil.exec;
  const stagedSevenZipPath = "/tmp/fad-test-7za";

  try {
    delete builderUtil.__fadAppleMotionSevenZipListPatched;
    builderUtil.exec = async () => "real exec";
    assert.equal(patchSevenZipListEstimate({ stagedSevenZipPath }), true);
    assert.equal(await builderUtil.exec(stagedSevenZipPath, ["l", "package.7z"]), "0 0 0 files");
    assert.equal(await builderUtil.exec("/usr/bin/zip", ["--version"]), "real exec");
  } finally {
    builderUtil.exec = originalExec;
    delete builderUtil.__fadAppleMotionSevenZipListPatched;
  }
});

test("build wrapper launches electron-builder through node instead of the shebang shim", async () => {
  const { buildElectronBuilderInvocation } = require("../scripts/dist-win.cjs");

  const invocation = buildElectronBuilderInvocation({
    nodeExecutable: "/usr/local/bin/node",
    cwd: projectRoot
  });

  assert.equal(invocation.command, "/usr/local/bin/node");
  assert.deepEqual(invocation.args, [
    path.join(projectRoot, "node_modules", "electron-builder", "out", "cli", "cli.js"),
    "--win",
    "portable",
    "--x64"
  ]);
});

test("macOS package wrapper launches an unsigned arm64 DMG build", async () => {
  const {
    buildMacElectronBuilderEnvironment,
    buildMacElectronBuilderInvocation
  } = require("../scripts/dist-mac.cjs");

  const env = buildMacElectronBuilderEnvironment({ env: { PATH: "/usr/bin" } });
  const invocation = buildMacElectronBuilderInvocation({
    nodeExecutable: "/usr/local/bin/node",
    cwd: projectRoot
  });

  assert.equal(env.CSC_IDENTITY_AUTO_DISCOVERY, "false");
  assert.equal(invocation.command, "/usr/local/bin/node");
  assert.deepEqual(invocation.args, [
    path.join(projectRoot, "node_modules", "electron-builder", "out", "cli", "cli.js"),
    "--mac",
    "dmg",
    "--arm64",
    "--config.directories.output=dist/macos"
  ]);
});

test("build wrapper stages app-builder helper through a short custom path on macOS", async () => {
  const { prepareAppBuilderBinary } = require("../scripts/dist-win.cjs");
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "apple-motion-app-builder-"));
  const fakeProject = path.join(tempDir, "project");
  const sourcePath = path.join(fakeProject, "node_modules", "app-builder-bin", "mac", "app-builder_arm64");
  const tempRoot = path.join(tempDir, "native-tools");
  const verified = [];
  await mkdir(path.dirname(sourcePath), { recursive: true });
  await writeFile(sourcePath, "fake app-builder");
  await chmod(sourcePath, 0o755);

  const env = await prepareAppBuilderBinary({
    env: { PATH: "/usr/bin" },
    projectRoot: fakeProject,
    platform: "darwin",
    arch: "arm64",
    tempRoot,
    verifyExecutable: async (binaryPath) => {
      verified.push(binaryPath);
    }
  });

  assert.equal(env.PATH, "/usr/bin");
  assert.match(env.CUSTOM_APP_BUILDER_PATH, new RegExp(`^${escapeRegExp(tempRoot)}`));
  assert.deepEqual(verified, [env.CUSTOM_APP_BUILDER_PATH]);
  assert.equal(await readFile(env.CUSTOM_APP_BUILDER_PATH, "utf8"), "fake app-builder");
});

test("build wrapper honors an explicit custom app-builder helper", async () => {
  const { prepareAppBuilderBinary } = require("../scripts/dist-win.cjs");
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "apple-motion-app-builder-"));
  const customPath = path.join(tempDir, "app-builder_arm64");
  const verified = [];
  await writeFile(customPath, "fake app-builder");
  await chmod(customPath, 0o755);

  const env = await prepareAppBuilderBinary({
    env: { CUSTOM_APP_BUILDER_PATH: customPath },
    platform: "darwin",
    verifyExecutable: async (binaryPath) => {
      verified.push(binaryPath);
    }
  });

  assert.equal(env.CUSTOM_APP_BUILDER_PATH, customPath);
  assert.deepEqual(verified, [customPath]);
});

test("build wrapper verifies pinned Windows FFmpeg resources before packaging", async () => {
  const wrapper = await readFile(path.join(projectRoot, "scripts", "dist-win.cjs"), "utf8");
  assert.match(wrapper, /verifyWinFfmpegResources\(\)/);
  assert.ok(wrapper.indexOf("verifyWinFfmpegResources()") < wrapper.indexOf("spawn(invocation.command"));
});

test("build wrapper prepares pinned NSIS tools before packaging", async () => {
  const wrapper = await readFile(path.join(projectRoot, "scripts", "dist-win.cjs"), "utf8");
  assert.match(wrapper, /prepareWinNsisToolchain/);
  assert.ok(wrapper.indexOf("prepareWinNsisToolchain") < wrapper.indexOf("spawn(invocation.command"));
});

test("Windows FFmpeg manifest covers every packaged binary resource", async () => {
  const pkg = require("../package.json");
  const manifest = require("../scripts/win-ffmpeg-manifest.json");
  const packaged = pkg.build.win.extraResources.flatMap((resource) => {
    return resource.filter.map((fileName) => path.posix.join(resource.from, fileName));
  }).sort();
  const pinned = manifest.resources.map((resource) => resource.path).sort();

  assert.deepEqual(pinned, packaged);
  assert.equal(pkg.build.extraResources, undefined);
  assert.match(manifest.archive.url, /^https:\/\/github\.com\/BtbN\/FFmpeg-Builds\/releases\/download\/autobuild-2026-06-04-14-00\//);
  assert.match(manifest.archive.sha256, /^[a-f0-9]{64}$/);
  for (const resource of manifest.resources) {
    assert.equal(Number.isInteger(resource.size) && resource.size > 0, true);
    assert.match(resource.sha256, /^[a-f0-9]{64}$/);
  }
});

test("Windows portable build does not require macOS winCodeSign or Wine downloads", async () => {
  const pkg = require("../package.json");
  assert.equal(pkg.build.win.signAndEditExecutable, false);
  assert.equal(pkg.build.win.forceCodeSigning, false);
});

test("Windows runtime smoke resolves packaged app, isolated user data, and bundled tools", async () => {
  const {
    buildAppLaunchArgs,
    buildDryRunPlan,
    buildRuntimeSmokeEnvironment,
    buildSampleVideoArgs,
    parseArgs,
    prepareLaunchPlan,
    resolveRuntimePaths
  } = require("../scripts/smoke-win-runtime.cjs");
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "apple-motion-win-smoke-"));
  const appPath = path.join(tempDir, "win-unpacked", "openFAD Motion Batch.exe");
  const workDir = path.join(tempDir, "evidence");
  const paths = resolveRuntimePaths({ appPath, workDir });
  const options = parseArgs([
    "--app", appPath,
    "--work-dir", workDir,
    "--debug-port", "9444",
    "--timeout-ms", "12345",
    "--skip-full-render",
    "--dry-run"
  ]);
  const env = buildRuntimeSmokeEnvironment({
    env: { PATH: "C:\\Windows\\System32" },
    paths,
    brokenToolDir: path.join(workDir, "broken")
  });
  const plan = buildDryRunPlan({ options, paths });

  assert.deepEqual(buildAppLaunchArgs({ debugPort: 9444 }), [
    "--remote-debugging-port=9444",
    "--remote-allow-origins=http://127.0.0.1:9444"
  ]);
  assert.equal(paths.resourcesDir, path.join(path.dirname(appPath), "resources"));
  assert.equal(paths.ffmpegPath, path.join(path.dirname(appPath), "resources", "bin", "ffmpeg.exe"));
  assert.equal(paths.userDataDir, path.join(workDir, "user-data"));
  assert.equal(env.OPENFAD_MOTION_USER_DATA_DIR, paths.userDataDir);
  assert.equal(env.FFMPEG_PATH, path.join(workDir, "broken", "missing-ffmpeg.exe"));
  assert.equal(env.FFPROBE_PATH, path.join(workDir, "broken", "missing-ffprobe.exe"));
  assert.equal(env.PATH, path.join(workDir, "broken"));
  assert.equal(plan.skipFullRender, true);
  assert.equal(plan.bundledFfmpeg, paths.ffmpegPath);
  assert.equal(plan.poisonedEnv.PATH, path.join(workDir, "broken-tools"));

  const audioSampleArgs = buildSampleVideoArgs({ inputPath: "out.mp4" });
  assert.ok(audioSampleArgs.some((arg) => arg.startsWith("sine=frequency=440")));
  assert.ok(hasAdjacentArgs(audioSampleArgs, "-map", "1:a:0"));
  assert.equal(audioSampleArgs.includes("-an"), false);

  const silentSampleArgs = buildSampleVideoArgs({ inputPath: "out.mp4", includeAudio: false });
  assert.equal(silentSampleArgs.some((arg) => arg.startsWith("sine=frequency=440")), false);
  assert.equal(silentSampleArgs.includes("-an"), true);

  await assert.rejects(
    () => prepareLaunchPlan({ debugPort: 9444, isPortOpen: async () => true }),
    /Remote debugging port 9444 is already in use/
  );
  const launchPlan = await prepareLaunchPlan({ debugPort: 9444, isPortOpen: async () => false });
  assert.deepEqual(launchPlan.appLaunchArgs, buildAppLaunchArgs({ debugPort: 9444 }));

  const autoPortOptions = parseArgs(["--debug-port", "auto", "--dry-run"]);
  assert.equal(autoPortOptions.debugPort, 0);
});

test("Windows runtime smoke evidence records outcome and release-gate eligibility", async () => {
  const {
    buildRuntimeSmokeEnvironment,
    createSmokeEvidence,
    assertReportEvidence,
    assertJobStatus,
    markSmokeEvidenceFailed,
    markSmokeEvidencePassed,
    parseArgs,
    resolveRuntimePaths
  } = require("../scripts/smoke-win-runtime.cjs");
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "apple-motion-win-evidence-"));
  const appPath = path.join(tempDir, "win-unpacked", "openFAD Motion Batch.exe");
  const workDir = path.join(tempDir, "evidence");
  const scriptPath = path.join(tempDir, "smoke-win-runtime.cjs");
  await mkdir(path.dirname(appPath), { recursive: true });
  await writeFile(appPath, "packaged app");
  await writeFile(scriptPath, "smoke script");
  const paths = resolveRuntimePaths({ appPath, workDir });
  await mkdir(paths.binDir, { recursive: true });
  await writeFile(paths.ffmpegPath, "ffmpeg");
  await writeFile(paths.ffprobePath, "ffprobe");
  const options = parseArgs([
    "--app", appPath,
    "--work-dir", workDir,
    "--debug-port", "9555",
    "--timeout-ms", "12345",
    "--skip-full-render"
  ]);
  const env = buildRuntimeSmokeEnvironment({ paths, env: { PATH: "C:\\Windows\\System32" } });
  const evidence = createSmokeEvidence({
    options,
    paths,
    env,
    scriptPath,
    platform: "win32",
    arch: "x64",
    nodeVersion: "v-test",
    now: new Date("2026-06-10T00:00:00.000Z")
  });

  assert.equal(evidence.schemaVersion, 1);
  assert.equal(evidence.status, "running");
  assert.equal(evidence.smokePassed, false);
  assert.equal(evidence.passed, false);
  assert.equal(evidence.startedAt, "2026-06-10T00:00:00.000Z");
  assert.equal(evidence.platform, "win32");
  assert.equal(evidence.arch, "x64");
  assert.equal(evidence.nodeVersion, "v-test");
  assert.equal(evidence.options.timeoutMs, 12345);
  assert.equal(evidence.options.skipFullRender, true);
  assert.equal(evidence.releaseGate.fullRenderRequired, true);
  assert.equal(evidence.releaseGate.fullRenderSkipped, true);
  assert.equal(evidence.releaseGate.passed, false);
  assert.match(evidence.releaseGate.reason, /running/i);
  assert.equal(evidence.script.path, scriptPath);
  assert.equal(evidence.script.sha256, crypto.createHash("sha256").update("smoke script").digest("hex"));

  markSmokeEvidenceFailed(evidence, new TypeError("CDP WebSocket timed out"));
  assert.equal(evidence.status, "failed");
  assert.equal(evidence.smokePassed, false);
  assert.equal(evidence.passed, false);
  assert.equal(evidence.releaseGate.passed, false);
  assert.equal(evidence.failure.name, "TypeError");
  assert.equal(evidence.failure.message, "CDP WebSocket timed out");

  const fullGateEvidence = createSmokeEvidence({
    options: { ...options, skipFullRender: false },
    paths,
    env,
    scriptPath
  });
  markSmokeEvidencePassed(fullGateEvidence);
  assert.equal(fullGateEvidence.status, "passed");
  assert.equal(fullGateEvidence.smokePassed, true);
  assert.equal(fullGateEvidence.passed, true);
  assert.equal(fullGateEvidence.releaseGate.passed, true);
  assert.equal(fullGateEvidence.releaseGate.reason, "");

  const partialGateEvidence = createSmokeEvidence({ options, paths, env, scriptPath });
  markSmokeEvidencePassed(partialGateEvidence);
  assert.equal(partialGateEvidence.status, "passed");
  assert.equal(partialGateEvidence.smokePassed, true);
  assert.equal(partialGateEvidence.passed, false);
  assert.equal(partialGateEvidence.releaseGate.passed, false);
  assert.match(partialGateEvidence.releaseGate.reason, /--skip-full-render/);

  assert.doesNotThrow(() => assertJobStatus({ status: "succeeded" }, ["succeeded"], "Full render smoke"));
  assert.throws(
    () => assertJobStatus({ status: "warning" }, ["succeeded"], "Full render smoke"),
    /ended with warning instead of succeeded/
  );
  assert.doesNotThrow(() => assertReportEvidence({
    ok: true,
    items: [
      { target: "1x1", warnings: [] },
      { target: "3x4", warnings: [] }
    ]
  }));
  assert.throws(
    () => assertReportEvidence({
      ok: true,
      items: [
        { target: "1x1", warnings: [] },
        { target: "3x4", warnings: ["1 near-black frame detected."] }
      ]
    }),
    /must not contain warnings/
  );
});

test("Windows runtime smoke evidence verifier rejects partial, warning, and incomplete release evidence", async () => {
  const { verifyWinSmokeEvidence } = require("../scripts/verify-win-smoke-evidence.cjs");
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "apple-motion-win-evidence-verify-"));
  const evidencePath = path.join(tempDir, "evidence.json");
  const appPath = path.join(tempDir, "openFAD Motion Batch.exe");
  const ffmpegPath = path.join(tempDir, "ffmpeg.exe");
  const ffprobePath = path.join(tempDir, "ffprobe.exe");
  const oneByOnePath = path.join(tempDir, "one-by-one.mp4");
  const threeByFourPath = path.join(tempDir, "three-by-four.mp4");
  const previewPath = path.join(tempDir, "preview.png");
  const reportJsonPath = path.join(tempDir, "report.json");
  const reportHtmlPath = path.join(tempDir, "report.html");
  const screenshots = {
    empty: path.join(tempDir, "01-empty.png"),
    previewStarted: path.join(tempDir, "02-preview-started.png"),
    previewed: path.join(tempDir, "03-previewed.png"),
    overwriteDialog: path.join(tempDir, "04-overwrite-dialog.png"),
    overwriteConfirmDialog: path.join(tempDir, "05-overwrite-confirm-dialog.png"),
    cancelActive: path.join(tempDir, "06-cancel-active.png"),
    cancelled: path.join(tempDir, "07-cancelled.png"),
    missingFfprobe: path.join(tempDir, "08-missing-ffprobe.png"),
    fullStarted: path.join(tempDir, "09-full-started.png"),
    fullFinished: path.join(tempDir, "10-full-finished.png")
  };
  await Promise.all([
    writeFile(appPath, "app"),
    writeFile(ffmpegPath, "ffmpeg"),
    writeFile(ffprobePath, "ffprobe"),
    writeFile(oneByOnePath, "one"),
    writeFile(threeByFourPath, "three"),
    writeFile(previewPath, "preview"),
    writeFile(reportJsonPath, "{}"),
    writeFile(reportHtmlPath, "<html></html>"),
    ...Object.values(screenshots).map((filePath) => writeFile(filePath, "png"))
  ]);
  const passingEvidence = {
    schemaVersion: 1,
    status: "passed",
    smokePassed: true,
    passed: true,
    startedAt: "2026-06-10T00:00:00.000Z",
    finishedAt: "2026-06-10T00:10:00.000Z",
    options: { skipFullRender: false },
    releaseGate: { passed: true, fullRenderRequired: true, fullRenderSkipped: false, reason: "" },
    appPath,
    appSha256: sha256("app"),
    poisonedEnvironment: {
      OPENFAD_MOTION_USER_DATA_DIR: path.join(tempDir, "user-data"),
      FFMPEG_PATH: path.join(tempDir, "broken", "missing-ffmpeg.exe"),
      FFPROBE_PATH: path.join(tempDir, "broken", "missing-ffprobe.exe"),
      PATH: path.join(tempDir, "broken")
    },
    bundledTools: {
      ffmpeg: { path: ffmpegPath, sha256: sha256("ffmpeg") },
      ffprobe: { path: ffprobePath, sha256: sha256("ffprobe") }
    },
    inputProbe: probeWithStreams(["video", "audio"]),
    overwriteInputProbe: probeWithStreams(["video", "audio"]),
    cancelInputProbe: probeWithStreams(["video", "audio"]),
    jobs: {
      preview: { status: "previewed" },
      overwrite: { status: "previewed" },
      cancel: { status: "cancelled" },
      full: { status: "succeeded" }
    },
    screenshots,
    assets: {
      preview: { path: previewPath, exists: true, size: 7, sha256: sha256("preview"), endpointSha256: sha256("preview") },
      fullPreview: { assetId: "asset-preview", endpointSha256: sha256("preview") },
      reportHtml: { assetId: "asset-report" }
    },
    outputs: {
      oneByOne: outputEvidence(oneByOnePath, "one", 3840, 3840),
      threeByFour: outputEvidence(threeByFourPath, "three", 2048, 2732),
      preview: { path: previewPath, exists: true, size: 7, sha256: sha256("preview") },
      reportJson: {
        path: reportJsonPath,
        exists: true,
        size: 2,
        sha256: sha256("{}"),
        parsed: {
          ok: true,
          items: [
            { target: "1x1", warnings: [] },
            { target: "3x4", warnings: [] }
          ]
        }
      },
      reportHtml: { path: reportHtmlPath, exists: true, size: 13, sha256: sha256("<html></html>") }
    },
    reveal: {
      preview: { ok: true },
      report: { ok: true },
      staleAsset: { status: 403, payload: { error: "没有访问权限。" } }
    }
  };
  await writeFile(evidencePath, `${JSON.stringify(passingEvidence, null, 2)}\n`);

  const verified = verifyWinSmokeEvidence({ evidencePath });
  assert.equal(verified.evidencePath, evidencePath);
  assert.equal(verified.outputs.length, 2);
  assert.equal(verified.screenshots.length, Object.keys(screenshots).length);

  await writeFile(evidencePath, `${JSON.stringify({ ...passingEvidence, passed: false, releaseGate: { ...passingEvidence.releaseGate, passed: false } }, null, 2)}\n`);
  assert.throws(() => verifyWinSmokeEvidence({ evidencePath }), /releaseGate\.passed must be true/);

  await writeFile(evidencePath, `${JSON.stringify({ ...passingEvidence, options: { skipFullRender: true } }, null, 2)}\n`);
  assert.throws(() => verifyWinSmokeEvidence({ evidencePath }), /skipFullRender must be false/);

  await writeFile(evidencePath, `${JSON.stringify({
    ...passingEvidence,
    jobs: { ...passingEvidence.jobs, full: { status: "warning" } },
    outputs: {
      ...passingEvidence.outputs,
      reportJson: {
        ...passingEvidence.outputs.reportJson,
        parsed: {
          ok: true,
          items: [
            { target: "1x1", warnings: [] },
            { target: "3x4", warnings: ["near-black frame"] }
          ]
        }
      }
    }
  }, null, 2)}\n`);
  assert.throws(() => verifyWinSmokeEvidence({ evidencePath }), /full job must finish with status succeeded/);

  await writeFile(evidencePath, `${JSON.stringify({
    ...passingEvidence,
    outputs: {
      ...passingEvidence.outputs,
      oneByOne: {
        ...passingEvidence.outputs.oneByOne,
        streams: [...passingEvidence.outputs.oneByOne.streams, { codec_type: "audio" }]
      }
    }
  }, null, 2)}\n`);
  assert.throws(() => verifyWinSmokeEvidence({ evidencePath }), /must contain exactly one video stream/);
});

test("Windows runtime smoke bounds HTTP and CDP transport calls", async () => {
  const { CdpClient, requestJson } = require("../scripts/smoke-win-runtime.cjs");

  await assert.rejects(
    () => requestJson("http://127.0.0.1:9/hung", {
      timeoutMs: 5,
      fetchImpl: (_url, { signal }) => new Promise((_resolve, reject) => {
        signal.addEventListener("abort", () => reject(signal.reason), { once: true });
      })
    }),
    /timed out/i
  );

  const socket = new FakeCdpSocket();
  const client = new CdpClient(socket, { commandTimeoutMs: 5 });
  await assert.rejects(
    () => client.send("Runtime.evaluate"),
    /timed out/i
  );
  assert.equal(client.pending.size, 0);
});

test("Windows NSIS preparer verifies explicit local toolchain paths", async () => {
  const { prepareWinNsisToolchain } = require("../scripts/prepare-win-nsis.cjs");
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "apple-motion-nsis-"));
  const nsisDir = path.join(tempDir, "nsis");
  const resourcesDir = path.join(tempDir, "resources");
  await createFakeNsisTree(nsisDir);
  await createFakeNsisResourcesTree(resourcesDir);

  const result = await prepareWinNsisToolchain({
    env: {
      ELECTRON_BUILDER_NSIS_DIR: nsisDir,
      ELECTRON_BUILDER_NSIS_RESOURCES_DIR: resourcesDir
    },
    platform: "darwin"
  });

  assert.equal(result.source, "environment");
  assert.equal(result.env.ELECTRON_BUILDER_NSIS_DIR, nsisDir);
  assert.equal(result.env.ELECTRON_BUILDER_NSIS_RESOURCES_DIR, resourcesDir);
});

test("Windows NSIS preparer rejects partial explicit local toolchain paths", async () => {
  const { prepareWinNsisToolchain } = require("../scripts/prepare-win-nsis.cjs");

  await assert.rejects(
    () => prepareWinNsisToolchain({
      env: { ELECTRON_BUILDER_NSIS_DIR: "/tmp/nsis-only" },
      platform: "darwin"
    }),
    /Set both ELECTRON_BUILDER_NSIS_DIR and ELECTRON_BUILDER_NSIS_RESOURCES_DIR/
  );
});

test("Windows NSIS preparer downloads, verifies, extracts, and exports local cache paths", async () => {
  const { prepareWinNsisToolchain } = require("../scripts/prepare-win-nsis.cjs");
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "apple-motion-nsis-"));
  const cacheRoot = path.join(tempDir, "cache");
  const downloads = [];
  const fakeArtifacts = {
    nsis: fakeArtifact("nsis", "fake-nsis.7z", "fake nsis archive"),
    nsisResources: fakeArtifact("nsis-resources", "fake-nsis-resources.7z", "fake resources archive")
  };

  const result = await prepareWinNsisToolchain({
    cacheRoot,
    env: {},
    platform: "darwin",
    stageNativeTools: false,
    artifacts: fakeArtifacts,
    downloadFile: async (url, destination, { artifact }) => {
      downloads.push(url);
      await writeFile(destination, artifact.fakeBytes);
    },
    extractArchive: async (_archivePath, outputDir, { artifact }) => {
      if (artifact.key === "nsis") {
        await createFakeNsisTree(outputDir);
      } else {
        await createFakeNsisResourcesTree(outputDir);
      }
    }
  });

  assert.deepEqual(downloads, ["https://example.test/fake-nsis.7z", "https://example.test/fake-nsis-resources.7z"]);
  assert.equal(result.source, "project-cache");
  assert.equal(result.env.ELECTRON_BUILDER_NSIS_DIR, path.join(cacheRoot, "nsis"));
  assert.equal(result.env.ELECTRON_BUILDER_NSIS_RESOURCES_DIR, path.join(cacheRoot, "nsis-resources"));
});

test("Windows NSIS preparer stages cached macOS toolchain through short native paths", async () => {
  const { prepareWinNsisToolchain } = require("../scripts/prepare-win-nsis.cjs");
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "apple-motion-nsis-"));
  const cacheRoot = path.join(tempDir, "cache");
  const nativeToolsRoot = path.join(tempDir, "native-tools");
  const fakeArtifacts = {
    nsis: fakeArtifact("nsis", "fake-nsis.7z", "fake nsis archive"),
    nsisResources: fakeArtifact("nsis-resources", "fake-nsis-resources.7z", "fake resources archive")
  };

  const result = await prepareWinNsisToolchain({
    cacheRoot,
    nativeToolsRoot,
    env: {},
    platform: "darwin",
    artifacts: fakeArtifacts,
    downloadFile: async (_url, destination, { artifact }) => {
      await writeFile(destination, artifact.fakeBytes);
    },
    extractArchive: async (_archivePath, outputDir, { artifact }) => {
      if (artifact.key === "nsis") {
        await createFakeNsisTree(outputDir);
      } else {
        await createFakeNsisResourcesTree(outputDir);
      }
    }
  });

  assert.equal(result.source, "project-cache-staged");
  assert.match(result.env.ELECTRON_BUILDER_NSIS_DIR, new RegExp(`^${escapeRegExp(nativeToolsRoot)}`));
  assert.match(result.env.ELECTRON_BUILDER_NSIS_RESOURCES_DIR, new RegExp(`^${escapeRegExp(nativeToolsRoot)}`));
  assert.equal(await readFile(path.join(result.env.ELECTRON_BUILDER_NSIS_DIR, "mac", "makensis"), "utf8"), "fake makensis");
  assert.equal(await readFile(path.join(result.env.ELECTRON_BUILDER_NSIS_RESOURCES_DIR, "plugins", "x86-unicode", "StdUtils.dll"), "utf8"), "fake stdutils");
});

test("Windows FFmpeg verifier accepts resources that match the manifest", async () => {
  const { verifyWinFfmpegResources } = require("../scripts/verify-win-ffmpeg.cjs");
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "apple-motion-win-ffmpeg-"));
  const project = path.join(tempDir, "project");
  const ffmpegPath = path.join(project, "vendor/ffmpeg/win/x64/ffmpeg.exe");
  const ffprobePath = path.join(project, "vendor/ffmpeg/win/x64/ffprobe.exe");
  const manifestPath = path.join(tempDir, "manifest.json");
  await mkdir(path.dirname(ffmpegPath), { recursive: true });
  await writeFile(ffmpegPath, "fake ffmpeg");
  await writeFile(ffprobePath, "fake ffprobe");
  await writeFile(manifestPath, JSON.stringify({
    version: 1,
    label: "test ffmpeg",
    resources: [
      { path: "vendor/ffmpeg/win/x64/ffmpeg.exe", size: 11, sha256: sha256("fake ffmpeg") },
      { path: "vendor/ffmpeg/win/x64/ffprobe.exe", size: 12, sha256: sha256("fake ffprobe") }
    ]
  }));

  const result = verifyWinFfmpegResources({ projectRoot: project, manifestPath });

  assert.deepEqual(result.verified, [
    "vendor/ffmpeg/win/x64/ffmpeg.exe",
    "vendor/ffmpeg/win/x64/ffprobe.exe"
  ]);
});

test("Windows FFmpeg verifier fails before packaging when resources are missing or drifted", async () => {
  const { verifyWinFfmpegResources } = require("../scripts/verify-win-ffmpeg.cjs");
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "apple-motion-win-ffmpeg-"));
  const project = path.join(tempDir, "project");
  const ffmpegPath = path.join(project, "vendor/ffmpeg/win/x64/ffmpeg.exe");
  const manifestPath = path.join(tempDir, "manifest.json");
  await mkdir(path.dirname(ffmpegPath), { recursive: true });
  await writeFile(manifestPath, JSON.stringify({
    version: 1,
    label: "test ffmpeg",
    resources: [
      { path: "vendor/ffmpeg/win/x64/ffmpeg.exe", size: 11, sha256: sha256("fake ffmpeg") }
    ]
  }));

  assert.throws(() => verifyWinFfmpegResources({ projectRoot: project, manifestPath }), /Missing Windows FFmpeg resource/);

  await writeFile(ffmpegPath, "wrong bytes");
  assert.throws(() => verifyWinFfmpegResources({ projectRoot: project, manifestPath }), /checksum mismatch|size mismatch/);
});

test("Windows FFmpeg fetcher downloads, extracts, stages, and verifies pinned resources", async () => {
  const { archiveMemberPath, prepareWinFfmpegResources } = require("../scripts/fetch-win-ffmpeg.cjs");
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "apple-motion-fetch-win-ffmpeg-"));
  const project = path.join(tempDir, "project");
  const manifestPath = path.join(tempDir, "manifest.json");
  const archiveBytes = Buffer.from("fake archive");
  const archive = {
    name: "fake-ffmpeg.zip",
    rootDir: "fake-ffmpeg",
    url: "https://example.test/fake-ffmpeg.zip",
    size: archiveBytes.length,
    sha256: sha256(archiveBytes)
  };
  await writeFile(manifestPath, JSON.stringify({
    version: 1,
    label: "test ffmpeg",
    archive,
    resources: [
      { path: "vendor/ffmpeg/win/x64/ffmpeg.exe", size: 11, sha256: sha256("fake ffmpeg") },
      { path: "vendor/ffmpeg/win/x64/ffprobe.exe", size: 12, sha256: sha256("fake ffprobe") }
    ]
  }));

  assert.equal(
    archiveMemberPath(archive, { path: "vendor/ffmpeg/win/x64/ffmpeg.exe" }),
    path.join("fake-ffmpeg", "bin", "ffmpeg.exe")
  );

  const result = await prepareWinFfmpegResources({
    projectRoot: project,
    manifestPath,
    cacheRoot: path.join(tempDir, "cache"),
    downloadFile: async (_url, destination) => {
      await writeFile(destination, archiveBytes);
    },
    extractArchive: async (_archivePath, outputDir) => {
      await mkdir(path.join(outputDir, "fake-ffmpeg", "bin"), { recursive: true });
      await writeFile(path.join(outputDir, "fake-ffmpeg", "bin", "ffmpeg.exe"), "fake ffmpeg");
      await writeFile(path.join(outputDir, "fake-ffmpeg", "bin", "ffprobe.exe"), "fake ffprobe");
    }
  });

  assert.equal(result.source, "download");
  assert.deepEqual(result.verified, [
    "vendor/ffmpeg/win/x64/ffmpeg.exe",
    "vendor/ffmpeg/win/x64/ffprobe.exe"
  ]);
});

test("local 7za shim routes macOS arm64 builds to the working x64 binary", async () => {
  const shim = await readFile(path.join(projectRoot, "scripts", "bin", "7za"), "utf8");
  assert.match(shim, /mac\/x64\/7za/);
  assert.match(shim, /openfad-motion-batch-native-tools\/7za-x64-\$\$/);
  assert.match(shim, /cp "\$X64_7ZA" "\$STAGED_7ZA"/);
  assert.match(shim, /chmod \+x/);
  assert.match(shim, /exec "\$STAGED_7ZA" "\$@"/);
});

test("Windows NSIS preparer uses system bsdtar before bundled 7za when available", async () => {
  const { resolveArchiveExtractor } = require("../scripts/prepare-win-nsis.cjs");

  const bsdtar = resolveArchiveExtractor({
    platform: "darwin",
    hasCommand: (command) => command === "bsdtar"
  });
  assert.equal(bsdtar.label, "bsdtar");
  assert.deepEqual(bsdtar.args("in.7z", "out"), ["-xf", "in.7z", "-C", "out"]);

  const fallback = resolveArchiveExtractor({
    projectRoot,
    platform: "darwin",
    arch: "arm64",
    hasCommand: () => false
  });
  assert.equal(fallback.label, "7za");
  assert.match(fallback.command, /scripts\/bin\/7za$/);
});

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function probeWithStreams(codecTypes) {
  return {
    streams: codecTypes.map((codecType, index) => ({
      index,
      codec_type: codecType,
      codec_name: codecType === "video" ? "h264" : "aac",
      width: codecType === "video" ? 1920 : undefined,
      height: codecType === "video" ? 1080 : undefined
    })),
    format: { duration: "9.000000", bit_rate: "50000000" }
  };
}

function outputEvidence(filePath, bytes, width, height) {
  return {
    path: filePath,
    exists: true,
    size: bytes.length,
    sha256: sha256(bytes),
    streams: [{
      index: 0,
      codec_type: "video",
      codec_name: "h264",
      width,
      height,
      duration: "9.000000",
      bit_rate: "50000000",
      color_space: "bt709",
      color_primaries: "bt709",
      color_transfer: "bt709"
    }],
    format: { duration: "9.000000", bit_rate: "50000000" }
  };
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function parseIcoDirectory(buffer) {
  assert.equal(buffer.readUInt16LE(0), 0);
  assert.equal(buffer.readUInt16LE(2), 1);
  const count = buffer.readUInt16LE(4);
  const entries = [];
  for (let index = 0; index < count; index += 1) {
    const offset = 6 + (index * 16);
    const widthByte = buffer.readUInt8(offset);
    const heightByte = buffer.readUInt8(offset + 1);
    const width = widthByte === 0 ? 256 : widthByte;
    const height = heightByte === 0 ? 256 : heightByte;
    entries.push({
      width,
      height,
      bitDepth: buffer.readUInt16LE(offset + 6),
      bytesInRes: buffer.readUInt32LE(offset + 8),
      imageOffset: buffer.readUInt32LE(offset + 12)
    });
  }
  assert.ok(entries.every((entry) => entry.width === entry.height));
  assert.ok(entries.every((entry) => entry.imageOffset + entry.bytesInRes <= buffer.length));
  return entries;
}

function hasAdjacentArgs(args, left, right) {
  return args.some((arg, index) => arg === left && args[index + 1] === right);
}

class FakeCdpSocket {
  constructor() {
    this.listeners = new Map();
    this.sentMessages = [];
  }

  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) ?? [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  send(message) {
    this.sentMessages.push(message);
  }

  close() {
    for (const listener of this.listeners.get("close") ?? []) listener({});
  }
}

function fakeArtifact(directory, archiveName, fakeBytes) {
  return {
    key: directory === "nsis" ? "nsis" : "nsisResources",
    label: directory,
    directory,
    archiveName,
    url: `https://example.test/${archiveName}`,
    sha512: crypto.createHash("sha512").update(fakeBytes).digest("base64"),
    fakeBytes
  };
}

async function createFakeNsisTree(root) {
  await mkdir(path.join(root, "mac"), { recursive: true });
  await mkdir(path.join(root, "Bin"), { recursive: true });
  await writeFile(path.join(root, "mac", "makensis"), "fake makensis");
  await writeFile(path.join(root, "Bin", "makensis.exe"), "fake makensis exe");
  await writeFile(path.join(root, "elevate.exe"), "fake elevate");
}

async function createFakeNsisResourcesTree(root) {
  await mkdir(path.join(root, "plugins", "x86-unicode"), { recursive: true });
  await writeFile(path.join(root, "plugins", "x86-unicode", "StdUtils.dll"), "fake stdutils");
}
