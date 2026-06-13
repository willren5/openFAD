#!/usr/bin/env node
"use strict";

const { spawn } = require("node:child_process");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const net = require("node:net");
const path = require("node:path");

const { USER_DATA_DIR_ENV } = require("../desktop/appPaths.cjs");

const DEFAULT_DEBUG_PORT = 9334;
const DEFAULT_TIMEOUT_MS = 15 * 60 * 1000;
const DEFAULT_TRANSPORT_TIMEOUT_MS = 30 * 1000;
const DEFAULT_APP_RELATIVE_PATH = path.join("dist", "windows", "win-unpacked", "openFAD Motion Batch.exe");
const DYNAMIC_DEBUG_PORT = 0;
const SMOKE_EVIDENCE_SCHEMA_VERSION = 1;

function parseArgs(argv) {
  const options = {
    appPath: "",
    workDir: "",
    debugPort: DEFAULT_DEBUG_PORT,
    timeoutMs: DEFAULT_TIMEOUT_MS,
    dryRun: false,
    keepOpen: false,
    skipFullRender: false,
    help: false
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") {
      options.help = true;
    } else if (arg === "--dry-run") {
      options.dryRun = true;
    } else if (arg === "--keep-open") {
      options.keepOpen = true;
    } else if (arg === "--skip-full-render") {
      options.skipFullRender = true;
    } else if (arg === "--app") {
      options.appPath = requireNextValue(argv, ++index, arg);
    } else if (arg === "--work-dir") {
      options.workDir = requireNextValue(argv, ++index, arg);
    } else if (arg === "--debug-port") {
      options.debugPort = parseDebugPort(requireNextValue(argv, ++index, arg), arg);
    } else if (arg === "--timeout-ms") {
      options.timeoutMs = parsePositiveInteger(requireNextValue(argv, ++index, arg), arg);
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }
  return options;
}

function requireNextValue(argv, index, option) {
  const value = argv[index];
  if (!value || value.startsWith("--")) throw new Error(`Missing value for ${option}`);
  return value;
}

function parsePositiveInteger(value, option) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) throw new Error(`${option} must be a positive integer.`);
  return parsed;
}

function parseDebugPort(value, option) {
  if (String(value).toLowerCase() === "auto") return DYNAMIC_DEBUG_PORT;
  return parsePositiveInteger(value, option);
}

function defaultAppPath(projectRoot = path.resolve(__dirname, "..")) {
  return path.join(projectRoot, DEFAULT_APP_RELATIVE_PATH);
}

function defaultWorkDir(projectRoot = path.resolve(__dirname, "..")) {
  return path.join(projectRoot, "tmp", "win-runtime-smoke");
}

function resolveRuntimePaths({
  appPath = defaultAppPath(),
  workDir = defaultWorkDir()
} = {}) {
  const resolvedAppPath = path.resolve(appPath);
  const appDir = path.dirname(resolvedAppPath);
  const resourcesDir = path.join(appDir, "resources");
  const binDir = path.join(resourcesDir, "bin");
  return {
    appPath: resolvedAppPath,
    appDir,
    resourcesDir,
    binDir,
    ffmpegPath: path.join(binDir, "ffmpeg.exe"),
    ffprobePath: path.join(binDir, "ffprobe.exe"),
    workDir: path.resolve(workDir),
    userDataDir: path.join(path.resolve(workDir), "user-data"),
    sourceDir: path.join(path.resolve(workDir), "source"),
    previewOutDir: path.join(path.resolve(workDir), "preview-out"),
    fullOutDir: path.join(path.resolve(workDir), "full-out"),
    overwriteSourceDir: path.join(path.resolve(workDir), "overwrite-source"),
    cancelSourceDir: path.join(path.resolve(workDir), "cancel-source"),
    cancelOutDir: path.join(path.resolve(workDir), "cancel-out"),
    screenshotsDir: path.join(path.resolve(workDir), "screenshots"),
    probesDir: path.join(path.resolve(workDir), "probes"),
    evidencePath: path.join(path.resolve(workDir), "evidence.json")
  };
}

function buildAppLaunchArgs({ debugPort = DEFAULT_DEBUG_PORT } = {}) {
  return [
    `--remote-debugging-port=${debugPort}`,
    `--remote-allow-origins=http://127.0.0.1:${debugPort}`
  ];
}

function buildLaunchPlan({ debugPort, launchedAfter = Date.now() }) {
  return {
    debugPort,
    appLaunchArgs: buildAppLaunchArgs({ debugPort }),
    launchedAfter
  };
}

async function prepareLaunchPlan({ debugPort = DEFAULT_DEBUG_PORT, isPortOpen = canConnectTcp } = {}) {
  const resolvedDebugPort = debugPort === DYNAMIC_DEBUG_PORT ? await findFreeTcpPort() : debugPort;
  if (await isPortOpen("127.0.0.1", resolvedDebugPort)) {
    throw new Error(`Remote debugging port ${resolvedDebugPort} is already in use. Stop the existing app or pass --debug-port auto.`);
  }
  return buildLaunchPlan({ debugPort: resolvedDebugPort });
}

function buildRuntimeSmokeEnvironment({
  env = process.env,
  paths,
  brokenToolDir = path.join(paths.workDir, "broken-tools")
} = {}) {
  const smokeEnv = { ...env };
  for (const key of Object.keys(smokeEnv)) {
    if (key.toLowerCase() === "path") delete smokeEnv[key];
  }
  return {
    ...smokeEnv,
    [USER_DATA_DIR_ENV]: paths.userDataDir,
    FFMPEG_PATH: path.join(brokenToolDir, "missing-ffmpeg.exe"),
    FFPROBE_PATH: path.join(brokenToolDir, "missing-ffprobe.exe"),
    PATH: brokenToolDir
  };
}

function usage() {
  return [
    "Usage: node ./scripts/smoke-win-runtime.cjs [options]",
    "",
    "Runs a real Windows packaged-runtime smoke against dist/windows/win-unpacked.",
    "",
    "Options:",
    "  --app <path>          Packaged openFAD Motion Batch.exe path",
    "  --work-dir <path>     Evidence/output directory",
    "  --debug-port <port>   Electron remote debugging port",
    "  --timeout-ms <ms>     Per-job wait timeout",
    "  --skip-full-render    Only run preview/UI checks, not full MP4 render",
    "  --keep-open           Leave the app running after smoke",
    "  --dry-run             Print resolved paths without launching the Windows app",
    "  --help                Show this help"
  ].join("\n");
}

async function run(options = parseArgs(process.argv.slice(2))) {
  if (options.help) {
    console.log(usage());
    return;
  }

  const paths = resolveRuntimePaths({
    appPath: options.appPath || defaultAppPath(),
    workDir: options.workDir || defaultWorkDir()
  });
  if (options.dryRun) {
    const launchPlan = options.debugPort === DYNAMIC_DEBUG_PORT
      ? buildLaunchPlan({ debugPort: await findFreeTcpPort(), launchedAfter: null })
      : null;
    const plan = buildDryRunPlan({ options, paths, launchPlan });
    console.log(JSON.stringify(plan, null, 2));
    return;
  }
  if (process.platform !== "win32") {
    throw new Error("Windows packaged runtime smoke must run on Windows. Use --dry-run on other hosts to inspect the planned paths.");
  }

  assertRuntimeInputs(paths);
  resetSmokeDirectory(paths);
  fs.mkdirSync(paths.sourceDir, { recursive: true });
  fs.mkdirSync(paths.previewOutDir, { recursive: true });
  fs.mkdirSync(paths.fullOutDir, { recursive: true });
  fs.mkdirSync(paths.overwriteSourceDir, { recursive: true });
  fs.mkdirSync(paths.cancelSourceDir, { recursive: true });
  fs.mkdirSync(paths.cancelOutDir, { recursive: true });
  fs.mkdirSync(paths.screenshotsDir, { recursive: true });
  fs.mkdirSync(paths.probesDir, { recursive: true });
  fs.mkdirSync(paths.userDataDir, { recursive: true });
  const env = buildRuntimeSmokeEnvironment({ paths });

  const evidence = createSmokeEvidence({ options, paths, env });

  const inputPath = path.join(paths.sourceDir, "rec709_9s.mp4");
  const overwriteInputPath = path.join(paths.overwriteSourceDir, "rec709_9s.mp4");
  const cancelInputPath = path.join(paths.cancelSourceDir, "cancel_34s.mp4");
  let app = null;
  let appOutput = { snapshot: () => [] };

  try {
    await generateSampleVideo({ ffmpegPath: paths.ffmpegPath, inputPath });
    await generateSampleVideo({ ffmpegPath: paths.ffmpegPath, inputPath: overwriteInputPath, variant: "bars" });
    await generateSampleVideo({
      ffmpegPath: paths.ffmpegPath,
      inputPath: cancelInputPath,
      durationSeconds: 34,
      size: "1920x1080"
    });
    evidence.inputProbe = await probeStreams({
      ffprobePath: paths.ffprobePath,
      filePath: inputPath,
      saveAs: path.join(paths.probesDir, "input-rec709_9s.json")
    });
    assertSourceHasAudio(evidence.inputProbe, "primary smoke input");
    evidence.overwriteInputProbe = await probeStreams({
      ffprobePath: paths.ffprobePath,
      filePath: overwriteInputPath,
      saveAs: path.join(paths.probesDir, "input-overwrite-rec709_9s.json")
    });
    assertSourceHasAudio(evidence.overwriteInputProbe, "overwrite smoke input");
    evidence.cancelInputProbe = await probeStreams({
      ffprobePath: paths.ffprobePath,
      filePath: cancelInputPath,
      saveAs: path.join(paths.probesDir, "input-cancel_34s.json")
    });
    assertSourceHasAudio(evidence.cancelInputProbe, "cancel smoke input");

    const launchPlan = await prepareLaunchPlan({ debugPort: options.debugPort });
    app = spawn(paths.appPath, launchPlan.appLaunchArgs, {
      env,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: false
    });
    appOutput = collectChildOutput(app);
    evidence.debugPort = launchPlan.debugPort;
    evidence.appLaunchArgs = launchPlan.appLaunchArgs;
    evidence.launchedAfter = new Date(launchPlan.launchedAfter).toISOString();
    const pageTarget = await waitForElectronPage(launchPlan.debugPort, options.timeoutMs, {
      launchedAfter: launchPlan.launchedAfter
    });
    const cdp = await CdpClient.connect(pageTarget.webSocketDebuggerUrl);
    try {
      await cdp.enable();
      evidence.pageTimeOrigin = await assertPageStartedAfterLaunch(cdp, launchPlan.launchedAfter);
      const baseUrl = new URL(pageTarget.url).origin;
      evidence.pageUrl = pageTarget.url;
      evidence.health = await fetchJson(`${baseUrl}/api/health`);
      assertBundledHealth(evidence.health);

      await cdp.waitFor("() => document.readyState === 'complete'", 10_000);
      await cdp.waitFor("() => document.querySelector('#startButton') && !document.querySelector('#startButton').disabled", 15_000);
      evidence.screenshots.empty = await cdp.screenshot(path.join(paths.screenshotsDir, "01-empty.png"));

      await runPreviewSmoke({ cdp, baseUrl, paths, inputPath, evidence, timeoutMs: options.timeoutMs });
      await runOverwriteSmoke({ cdp, baseUrl, paths, inputPath: overwriteInputPath, evidence, timeoutMs: options.timeoutMs });
      await runCancelSmoke({ cdp, baseUrl, paths, inputPath: cancelInputPath, evidence, timeoutMs: options.timeoutMs });
      await runMissingToolSmoke({ cdp, paths, inputPath, evidence });
      if (!options.skipFullRender) {
        await runFullRenderSmoke({ cdp, baseUrl, paths, inputPath, evidence, timeoutMs: options.timeoutMs });
        await runRevealSmoke({ baseUrl, evidence });
      }
      markSmokeEvidencePassed(evidence);
    } finally {
      cdp.close();
    }
  } catch (error) {
    markSmokeEvidenceFailed(evidence, error);
    throw error;
  } finally {
    evidence.finishedAt = new Date().toISOString();
    evidence.appOutput = appOutput.snapshot();
    fs.writeFileSync(paths.evidencePath, `${JSON.stringify(evidence, null, 2)}\n`);
    if (app && !options.keepOpen) terminateProcess(app);
  }

  console.log(`Windows packaged runtime smoke evidence: ${paths.evidencePath}`);
}

function createSmokeEvidence({
  options,
  paths,
  env,
  scriptPath = __filename,
  platform = process.platform,
  arch = process.arch,
  nodeVersion = process.version,
  now = new Date()
}) {
  const skipFullRender = Boolean(options.skipFullRender);
  return {
    schemaVersion: SMOKE_EVIDENCE_SCHEMA_VERSION,
    status: "running",
    smokePassed: false,
    passed: false,
    startedAt: now.toISOString(),
    platform,
    arch,
    nodeVersion,
    script: {
      path: scriptPath,
      sha256: sha256File(scriptPath)
    },
    options: {
      timeoutMs: options.timeoutMs,
      skipFullRender,
      keepOpen: Boolean(options.keepOpen),
      requestedDebugPort: options.debugPort
    },
    releaseGate: buildReleaseGateStatus({ status: "running", skipFullRender }),
    appPath: paths.appPath,
    appSha256: sha256File(paths.appPath),
    poisonedEnvironment: sanitizedRuntimeEnvironment(env),
    bundledTools: {
      ffmpeg: { path: paths.ffmpegPath, sha256: sha256File(paths.ffmpegPath) },
      ffprobe: { path: paths.ffprobePath, sha256: sha256File(paths.ffprobePath) }
    },
    jobs: {},
    screenshots: {},
    assets: {},
    probes: {},
    outputs: {}
  };
}

function markSmokeEvidencePassed(evidence) {
  evidence.status = "passed";
  evidence.smokePassed = true;
  delete evidence.failure;
  evidence.releaseGate = buildReleaseGateStatus({
    status: "passed",
    skipFullRender: Boolean(evidence.options?.skipFullRender)
  });
  evidence.passed = evidence.releaseGate.passed;
}

function markSmokeEvidenceFailed(evidence, error) {
  evidence.status = "failed";
  evidence.smokePassed = false;
  evidence.passed = false;
  evidence.failure = {
    name: error?.name || "Error",
    message: sanitizeDiagnostic(error?.message || String(error))
  };
  evidence.releaseGate = buildReleaseGateStatus({
    status: "failed",
    skipFullRender: Boolean(evidence.options?.skipFullRender)
  });
}

function buildReleaseGateStatus({ status, skipFullRender }) {
  if (status === "passed" && !skipFullRender) {
    return {
      passed: true,
      fullRenderRequired: true,
      fullRenderSkipped: false,
      reason: ""
    };
  }
  if (status === "passed" && skipFullRender) {
    return {
      passed: false,
      fullRenderRequired: true,
      fullRenderSkipped: true,
      reason: "--skip-full-render omits full MP4 output probes and cannot satisfy the release gate."
    };
  }
  if (status === "failed") {
    return {
      passed: false,
      fullRenderRequired: true,
      fullRenderSkipped: skipFullRender,
      reason: "Smoke failed before the release gate completed."
    };
  }
  return {
    passed: false,
    fullRenderRequired: true,
    fullRenderSkipped: skipFullRender,
    reason: "Smoke is still running."
  };
}

function buildDryRunPlan({ options, paths, launchPlan = null }) {
  const resolvedDebugPort = launchPlan?.debugPort ?? options.debugPort;
  return {
    appPath: paths.appPath,
    workDir: paths.workDir,
    debugPort: resolvedDebugPort,
    timeoutMs: options.timeoutMs,
    skipFullRender: options.skipFullRender,
    appLaunchArgs: launchPlan?.appLaunchArgs ?? buildAppLaunchArgs({ debugPort: resolvedDebugPort }),
    userDataEnv: USER_DATA_DIR_ENV,
    userDataDir: paths.userDataDir,
    bundledFfmpeg: paths.ffmpegPath,
    bundledFfprobe: paths.ffprobePath,
    poisonedEnv: sanitizedRuntimeEnvironment(buildRuntimeSmokeEnvironment({ paths })),
    evidencePath: paths.evidencePath
  };
}

async function runPreviewSmoke({ cdp, baseUrl, paths, inputPath, evidence, timeoutMs }) {
  const knownJobIds = await currentJobIds(baseUrl);
  await setValue(cdp, "#inputPath", inputPath);
  await setValue(cdp, "#outDir", paths.previewOutDir);
  await setValue(cdp, "#fps", "30");
  await setValue(cdp, "#bitrate", "50M");
  await setChecked(cdp, "#qcOnly", false);
  await setChecked(cdp, "#previewOnly", true);
  await setChecked(cdp, "#overwrite", false);
  await setValue(cdp, "#ffmpegPath", "");
  await setValue(cdp, "#ffprobePath", "");
  await click(cdp, "#startButton");
  evidence.screenshots.previewStarted = await cdp.screenshot(path.join(paths.screenshotsDir, "02-preview-started.png"));
  const job = await waitForNewJob(baseUrl, knownJobIds, timeoutMs);
  evidence.jobs.previewInitial = job;
  const detail = await waitForJobFinal(baseUrl, job.id, timeoutMs);
  assertJobStatus(detail.job, ["previewed"], "Preview smoke");
  evidence.jobs.preview = detail.job;
  await cdp.waitFor("() => document.querySelector('#jobBadge')?.textContent?.includes('预览完成')", timeoutMs);
  await cdp.waitFor("() => document.querySelector('#previewImage')?.naturalWidth === 2048 && document.querySelector('#previewImage')?.naturalHeight === 2732", 15_000);
  evidence.previewState = await cdp.evaluateJson("(() => ({ badge: document.querySelector('#jobBadge')?.textContent || '', image: { src: document.querySelector('#previewImage')?.src || '', naturalWidth: document.querySelector('#previewImage')?.naturalWidth || 0, naturalHeight: document.querySelector('#previewImage')?.naturalHeight || 0, className: document.querySelector('#previewImage')?.className || '' }, queue: document.querySelector('#queueBody')?.innerText || '', log: document.querySelector('#jobLog')?.innerText || '' }))()");
  evidence.screenshots.previewed = await cdp.screenshot(path.join(paths.screenshotsDir, "03-previewed.png"));
  const previewPath = path.join(paths.previewOutDir, "rec709_9s__apple-motion-3x4-preview.png");
  const previewAssetId = firstResultAssetId(detail.job, "preview");
  evidence.assets.preview = {
    path: previewPath,
    assetId: previewAssetId,
    ...fileEvidence(previewPath),
    endpointSha256: await fetchAssetSha256(baseUrl, previewAssetId)
  };
}

async function runOverwriteSmoke({ cdp, baseUrl, paths, inputPath, evidence, timeoutMs }) {
  const outputPath = path.join(paths.previewOutDir, "rec709_9s__apple-motion-3x4-preview.png");
  const before = fileEvidence(outputPath);
  const disabledResponse = await postJsonExpectFailure(`${baseUrl}/api/jobs`, buildJobPayload({
    input: inputPath,
    outDir: paths.previewOutDir,
    previewOnly: true,
    overwrite: false
  }));
  evidence.overwrite = {
    disabledResponse,
    before
  };
  assertStatusCode(disabledResponse, 409, "Overwrite-disabled preflight");
  assertUserFacingMessage(disabledResponse.payload?.error, "Overwrite-disabled error");

  const knownJobIds = await currentJobIds(baseUrl);
  await setValue(cdp, "#inputPath", inputPath);
  await setValue(cdp, "#outDir", paths.previewOutDir);
  await setChecked(cdp, "#previewOnly", true);
  await setValue(cdp, "#ffmpegPath", "");
  await setValue(cdp, "#ffprobePath", "");
  await setChecked(cdp, "#overwrite", true);
  await click(cdp, "#startButton");
  await cdp.waitFor("() => !document.querySelector('#overwriteDialog').hidden", 10_000);
  evidence.overwriteDialog = await cdp.evaluateJson("(() => ({ text: document.querySelector('#overwriteDialog')?.innerText || '', activeElement: document.activeElement?.id || '' }))()");
  evidence.screenshots.overwriteDialog = await cdp.screenshot(path.join(paths.screenshotsDir, "04-overwrite-dialog.png"));
  await click(cdp, "#overwriteCancelButton");
  await cdp.waitFor("() => document.querySelector('#overwriteDialog').hidden", 10_000);
  const afterCancel = fileEvidence(outputPath);
  assert.equal(afterCancel.sha256, before.sha256, "Overwrite cancellation changed the existing preview file.");
  evidence.overwrite.afterCancel = afterCancel;

  await click(cdp, "#startButton");
  await cdp.waitFor("() => !document.querySelector('#overwriteDialog').hidden", 10_000);
  evidence.screenshots.overwriteConfirmDialog = await cdp.screenshot(path.join(paths.screenshotsDir, "05-overwrite-confirm-dialog.png"));
  await click(cdp, "#overwriteConfirmButton");
  const job = await waitForNewJob(baseUrl, knownJobIds, timeoutMs);
  evidence.jobs.overwriteInitial = job;
  const detail = await waitForJobFinal(baseUrl, job.id, timeoutMs);
  assertJobStatus(detail.job, ["previewed"], "Overwrite-confirm smoke");
  evidence.jobs.overwrite = detail.job;
  await cdp.waitFor("() => document.querySelector('#jobBadge')?.textContent?.includes('预览完成')", timeoutMs);
  const afterConfirm = fileEvidence(outputPath);
  if (afterConfirm.mtimeMs <= afterCancel.mtimeMs) {
    throw new Error("Overwrite confirmation did not replace the existing preview file.");
  }
  evidence.overwrite.afterConfirm = afterConfirm;
}

async function runMissingToolSmoke({ cdp, paths, inputPath, evidence }) {
  await setChecked(cdp, "#overwrite", false);
  await setChecked(cdp, "#previewOnly", true);
  await setValue(cdp, "#inputPath", inputPath);
  await setValue(cdp, "#outDir", path.join(paths.workDir, "missing-tool-out"));
  await cdp.evaluate("document.querySelector('details.advanced').open = true");
  await setValue(cdp, "#ffprobePath", path.join(paths.workDir, "missing-ffprobe.exe"));
  await click(cdp, "#startButton");
  await cdp.waitFor("() => !document.querySelector('#errorPanel').hidden && document.querySelector('#errorPanel').textContent.includes('FFprobe')", 10_000);
  evidence.missingFfprobeError = await cdp.evaluate("document.querySelector('#errorPanel')?.innerText || ''");
  assertUserFacingMessage(evidence.missingFfprobeError, "Missing FFprobe UI error");
  evidence.screenshots.missingFfprobe = await cdp.screenshot(path.join(paths.screenshotsDir, "08-missing-ffprobe.png"));
  await setValue(cdp, "#ffprobePath", "");
}

async function runCancelSmoke({ cdp, baseUrl, paths, inputPath, evidence, timeoutMs }) {
  const knownJobIds = await currentJobIds(baseUrl);
  await setChecked(cdp, "#previewOnly", false);
  await setChecked(cdp, "#qcOnly", false);
  await setChecked(cdp, "#overwrite", false);
  await setValue(cdp, "#inputPath", inputPath);
  await setValue(cdp, "#outDir", paths.cancelOutDir);
  await setValue(cdp, "#ffmpegPath", "");
  await setValue(cdp, "#ffprobePath", "");
  await click(cdp, "#startButton");
  const job = await waitForNewJob(baseUrl, knownJobIds, timeoutMs);
  evidence.jobs.cancelInitial = job;
  await cdp.waitFor("() => !document.querySelector('#stopButton')?.disabled", 30_000);
  evidence.screenshots.cancelActive = await cdp.screenshot(path.join(paths.screenshotsDir, "06-cancel-active.png"));
  await click(cdp, "#stopButton");
  const detail = await waitForJobFinal(baseUrl, job.id, timeoutMs);
  assertJobStatus(detail.job, ["cancelled"], "Cancel smoke");
  evidence.jobs.cancel = detail.job;
  evidence.cancelOutputs = expectedOutputEvidence(paths.cancelOutDir, "cancel_34s");
  for (const [label, output] of Object.entries(evidence.cancelOutputs)) {
    if (output.exists) throw new Error(`Cancel smoke left a finalized ${label} output at ${output.path}.`);
  }
  await cdp.waitFor("() => document.querySelector('#jobBadge')?.textContent?.includes('已停止')", 15_000);
  evidence.screenshots.cancelled = await cdp.screenshot(path.join(paths.screenshotsDir, "07-cancelled.png"));
}

async function runFullRenderSmoke({ cdp, baseUrl, paths, inputPath, evidence, timeoutMs }) {
  const knownJobIds = await currentJobIds(baseUrl);
  await setChecked(cdp, "#previewOnly", false);
  await setChecked(cdp, "#qcOnly", false);
  await setChecked(cdp, "#overwrite", false);
  await setValue(cdp, "#inputPath", inputPath);
  await setValue(cdp, "#outDir", paths.fullOutDir);
  await setValue(cdp, "#ffmpegPath", "");
  await setValue(cdp, "#ffprobePath", "");
  await click(cdp, "#startButton");
  const job = await waitForNewJob(baseUrl, knownJobIds, timeoutMs);
  evidence.jobs.fullInitial = job;
  evidence.screenshots.fullStarted = await cdp.screenshot(path.join(paths.screenshotsDir, "09-full-started.png"));
  const detail = await waitForJobFinal(baseUrl, job.id, timeoutMs);
  assertJobStatus(detail.job, ["succeeded"], "Full render smoke");
  evidence.jobs.full = detail.job;
  await cdp.waitFor("() => ['通过', '警告', '失败'].includes(document.querySelector('#jobBadge')?.textContent)", timeoutMs);
  const badge = await cdp.evaluate("document.querySelector('#jobBadge')?.textContent || ''");
  if (badge !== "通过") throw new Error(`Full render smoke ended with ${badge || "unknown"} in the packaged UI.`);
  evidence.screenshots.fullFinished = await cdp.screenshot(path.join(paths.screenshotsDir, "10-full-finished.png"));
  const oneByOne = path.join(paths.fullOutDir, "rec709_9s__apple-motion-1x1.mp4");
  const threeByFour = path.join(paths.fullOutDir, "rec709_9s__apple-motion-3x4.mp4");
  const preview = path.join(paths.fullOutDir, "rec709_9s__apple-motion-3x4-preview.png");
  const reportJson = path.join(paths.fullOutDir, "rec709_9s__apple-motion-qc.json");
  const reportHtml = path.join(paths.fullOutDir, "rec709_9s__apple-motion-qc.html");
  evidence.outputs.oneByOne = await probeVideoOnlyOutput({
    ffprobePath: paths.ffprobePath,
    filePath: oneByOne,
    expected: { width: 3840, height: 3840 },
    saveAs: path.join(paths.probesDir, "output-1x1.json")
  });
  evidence.outputs.threeByFour = await probeVideoOnlyOutput({
    ffprobePath: paths.ffprobePath,
    filePath: threeByFour,
    expected: { width: 2048, height: 2732 },
    saveAs: path.join(paths.probesDir, "output-3x4.json")
  });
  evidence.outputs.preview = fileEvidence(preview);
  evidence.outputs.reportJson = {
    ...fileEvidence(reportJson),
    parsed: JSON.parse(fs.readFileSync(reportJson, "utf8"))
  };
  evidence.outputs.reportHtml = fileEvidence(reportHtml);
  assertReportEvidence(evidence.outputs.reportJson.parsed);
  evidence.assets.fullPreview = {
    assetId: firstResultAssetId(detail.job, "preview"),
    endpointSha256: await fetchAssetSha256(baseUrl, firstResultAssetId(detail.job, "preview"))
  };
  evidence.assets.reportHtml = {
    assetId: firstResultAssetId(detail.job, "reportHtml")
  };
}

async function runRevealSmoke({ baseUrl, evidence }) {
  const reportAssetId = evidence.assets.reportHtml?.assetId;
  const previewAssetId = evidence.assets.fullPreview?.assetId || evidence.assets.preview?.assetId;
  evidence.reveal = {};
  if (!reportAssetId || !previewAssetId) {
    throw new Error("Reveal smoke requires preview and report asset ids from a finished packaged UI job.");
  }
  evidence.reveal.preview = await postJson(`${baseUrl}/api/reveal`, { id: previewAssetId });
  evidence.reveal.report = await postJson(`${baseUrl}/api/reveal`, { id: reportAssetId });
  const stale = await postJsonExpectFailure(`${baseUrl}/api/reveal`, { id: "stale-smoke-asset-id" });
  assertStatusCode(stale, 403, "Stale reveal asset");
  assertUserFacingMessage(stale.payload?.error, "Stale reveal error");
  evidence.reveal.staleAsset = stale;
}

async function generateSampleVideo({
  ffmpegPath,
  inputPath,
  durationSeconds = 9,
  size = "640x360",
  variant = "testsrc2",
  includeAudio = true
}) {
  await runProcess(ffmpegPath, buildSampleVideoArgs({
    inputPath,
    durationSeconds,
    size,
    variant,
    includeAudio
  }), { timeoutMs: 120_000 });
}

function buildSampleVideoArgs({
  inputPath,
  durationSeconds = 9,
  size = "640x360",
  variant = "testsrc2",
  includeAudio = true
} = {}) {
  const source = variant === "bars"
    ? `smptebars=size=${size}:rate=30:duration=${durationSeconds}`
    : `testsrc2=size=${size}:rate=30:duration=${durationSeconds}`;
  const args = [
    "-hide_banner",
    "-loglevel",
    "error",
    "-f",
    "lavfi",
    "-i",
    source
  ];
  if (includeAudio) {
    args.push(
      "-f",
      "lavfi",
      "-i",
      `sine=frequency=440:sample_rate=48000:duration=${durationSeconds}`
    );
  }
  args.push(
    "-map",
    "0:v:0"
  );
  if (includeAudio) {
    args.push(
      "-map",
      "1:a:0"
    );
  }
  args.push(
    "-vf",
    "format=yuv420p",
    "-c:v",
    "libx264",
    "-x264-params",
    "colorprim=bt709:transfer=bt709:colormatrix=bt709",
    "-pix_fmt",
    "yuv420p",
    "-colorspace",
    "bt709",
    "-color_primaries",
    "bt709",
    "-color_trc",
    "bt709"
  );
  if (includeAudio) {
    args.push(
      "-c:a",
      "aac",
      "-b:a",
      "128k",
      "-shortest"
    );
  } else {
    args.push("-an");
  }
  args.push(
    "-movflags",
    "+faststart",
    inputPath
  );
  return args;
}

async function probeVideoOnlyOutput({ ffprobePath, filePath, expected, saveAs }) {
  const probe = await probeStreams({ ffprobePath, filePath, saveAs });
  const streamTypes = probe.streams.map((stream) => stream.codec_type);
  if (streamTypes.length !== 1 || streamTypes[0] !== "video") {
    throw new Error(`Expected exactly one video stream in ${filePath}, found ${streamTypes.join(", ") || "none"}.`);
  }
  const video = probe.streams[0];
  const duration = Number(video.duration ?? probe.format?.duration);
  const bitRate = Number(video.bit_rate ?? probe.format?.bit_rate);
  if (video.width !== expected.width || video.height !== expected.height) {
    throw new Error(`Expected ${expected.width}x${expected.height} in ${filePath}, found ${video.width}x${video.height}.`);
  }
  if (video.codec_name !== "h264") {
    throw new Error(`Expected H.264 output in ${filePath}, found ${video.codec_name ?? "unknown"}.`);
  }
  if (!["bt709", "iec61966-2-1", "srgb", "rgb"].includes(String(video.color_space ?? "").toLowerCase())) {
    throw new Error(`Expected Rec.709/sRGB color space in ${filePath}, found ${video.color_space ?? "unknown"}.`);
  }
  if (!["bt709", "iec61966-2-1", "srgb", "rgb"].includes(String(video.color_primaries ?? "").toLowerCase())) {
    throw new Error(`Expected Rec.709/sRGB primaries in ${filePath}, found ${video.color_primaries ?? "unknown"}.`);
  }
  if (!["bt709", "iec61966-2-1", "srgb", "rgb"].includes(String(video.color_transfer ?? "").toLowerCase())) {
    throw new Error(`Expected Rec.709/sRGB transfer in ${filePath}, found ${video.color_transfer ?? "unknown"}.`);
  }
  if (!Number.isFinite(duration) || duration < 8 || duration > 35) {
    throw new Error(`Expected Apple-safe duration in ${filePath}, found ${duration}.`);
  }
  if (!Number.isFinite(bitRate) || bitRate < 45_000_000 || bitRate > 100_000_000) {
    throw new Error(`Expected 45-100 Mbps bitrate in ${filePath}, found ${bitRate}.`);
  }
  return { path: filePath, ...fileEvidence(filePath), streams: probe.streams, format: probe.format };
}

async function probeStreams({ ffprobePath, filePath, saveAs = "" }) {
  const result = await runProcess(ffprobePath, [
    "-v",
    "error",
    "-show_entries",
    "stream=index,codec_type,codec_name,width,height,sample_aspect_ratio,field_order,avg_frame_rate,r_frame_rate,duration,bit_rate,color_space,color_transfer,color_primaries:format=duration,bit_rate",
    "-of",
    "json",
    filePath
  ], { timeoutMs: 60_000 });
  const parsed = JSON.parse(result.stdout);
  if (saveAs) fs.writeFileSync(saveAs, `${JSON.stringify(parsed, null, 2)}\n`);
  return parsed;
}

async function runProcess(command, args, { timeoutMs }) {
  const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => {
    stdout += chunk.toString();
  });
  child.stderr.on("data", (chunk) => {
    stderr += chunk.toString();
  });
  const timeout = setTimeout(() => child.kill(), timeoutMs);
  return await new Promise((resolve, reject) => {
    child.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.on("close", (code, signal) => {
      clearTimeout(timeout);
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }
      reject(new Error(`${path.basename(command)} failed: ${signal ? `signal ${signal}` : `exit ${code ?? 1}`}`));
    });
  });
}

async function fetchJson(url) {
  const result = await requestJson(url);
  return result.payload;
}

async function postJson(url, body) {
  const result = await requestJson(url, {
    method: "POST",
    body
  });
  return result.payload;
}

async function postJsonExpectFailure(url, body) {
  const result = await requestJson(url, {
    method: "POST",
    body,
    expectOk: false
  });
  if (result.ok) throw new Error(`Expected request to fail: ${url}`);
  return result;
}

async function requestJson(url, {
  method = "GET",
  body = null,
  expectOk = true,
  timeoutMs = DEFAULT_TRANSPORT_TIMEOUT_MS,
  fetchImpl = fetch
} = {}) {
  const { response, bodyText } = await fetchWithBoundedBody(url, {
    method,
    headers: body === null ? undefined : { "content-type": "application/json" },
    body: body === null ? undefined : JSON.stringify(body),
    timeoutMs,
    fetchImpl,
    bodyKind: "text"
  });
  const payload = bodyText ? JSON.parse(bodyText) : {};
  const ok = response.ok && payload.ok !== false;
  if (expectOk && !ok) {
    throw new Error(`Request failed: ${method} ${url} (${response.status}) ${payload.error ?? ""}`);
  }
  return {
    ok,
    status: response.status,
    payload
  };
}

async function fetchWithBoundedBody(url, {
  method = "GET",
  headers,
  body,
  timeoutMs = DEFAULT_TRANSPORT_TIMEOUT_MS,
  fetchImpl = fetch,
  bodyKind = "text"
} = {}) {
  const boundedTimeoutMs = normalizeOperationTimeout(timeoutMs);
  const controller = new AbortController();
  const timeout = setTimeout(() => {
    controller.abort(createTransportTimeoutError(`${method} ${url}`, boundedTimeoutMs));
  }, boundedTimeoutMs);
  try {
    const response = await fetchImpl(url, {
      method,
      headers,
      body,
      signal: controller.signal
    });
    if (bodyKind === "arrayBuffer") {
      return { response, bodyBuffer: await response.arrayBuffer() };
    }
    return { response, bodyText: await response.text() };
  } catch (error) {
    if (controller.signal.aborted && controller.signal.reason) throw controller.signal.reason;
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchAssetSha256(baseUrl, assetId, { timeoutMs = DEFAULT_TRANSPORT_TIMEOUT_MS } = {}) {
  if (!assetId) throw new Error("Missing asset id.");
  const { response, bodyBuffer } = await fetchWithBoundedBody(`${baseUrl}/api/asset?id=${encodeURIComponent(assetId)}`, {
    timeoutMs,
    bodyKind: "arrayBuffer"
  });
  if (!response.ok) throw new Error(`Asset request failed (${response.status}) for ${assetId}.`);
  const buffer = Buffer.from(bodyBuffer);
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

function assertBundledHealth(health) {
  if (health.videoTools?.ffmpeg?.configured !== true || health.videoTools?.ffprobe?.configured !== true) {
    throw new Error("Packaged app did not report configured video tools. Bundled FFmpeg/FFprobe override may be broken.");
  }
}

async function assertPageStartedAfterLaunch(cdp, launchedAfter) {
  const timeOrigin = await cdp.evaluate("performance.timeOrigin");
  if (Number.isFinite(launchedAfter) && Number.isFinite(timeOrigin) && timeOrigin + 1_000 < launchedAfter) {
    throw new Error("Remote debugging target predates this smoke launch. Stop the stale app or pass --debug-port auto.");
  }
  return timeOrigin;
}

function assertSourceHasAudio(probe, label) {
  const streamTypes = (probe.streams ?? []).map((stream) => stream.codec_type);
  if (!streamTypes.includes("audio")) {
    throw new Error(`${label} must contain an audio stream so the smoke can prove packaged outputs strip audio.`);
  }
}

function buildJobPayload({
  input,
  outDir,
  previewOnly = false,
  qcOnly = false,
  overwrite = false,
  ffmpegPath = "",
  ffprobePath = ""
}) {
  return {
    input,
    outDir,
    mode: "scale-fill",
    encoder: "auto",
    container: "mp4",
    fps: "30",
    bitrate: "50M",
    qcOnly,
    previewOnly,
    overwrite,
    ffmpegPath,
    ffprobePath
  };
}

async function currentJobIds(baseUrl) {
  const payload = await fetchJson(`${baseUrl}/api/jobs`);
  return new Set((payload.jobs ?? []).map((job) => job.id));
}

async function waitForNewJob(baseUrl, knownJobIds, timeoutMs) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const payload = await fetchJson(`${baseUrl}/api/jobs`);
    const jobs = (payload.jobs ?? [])
      .filter((job) => !knownJobIds.has(job.id))
      .sort(compareJobsNewestFirst);
    if (jobs[0]) return jobs[0];
    await delay(200);
  }
  throw new Error("Timed out waiting for the packaged UI to create a new job.");
}

async function waitForJobFinal(baseUrl, jobId, timeoutMs) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const payload = await fetchJson(`${baseUrl}/api/jobs/${encodeURIComponent(jobId)}?full=1`);
    if (isFinalJobStatus(payload.job?.status)) return payload;
    await delay(500);
  }
  throw new Error(`Timed out waiting for packaged UI job ${jobId} to finish.`);
}

function compareJobsNewestFirst(left, right) {
  return String(right.createdAt ?? "").localeCompare(String(left.createdAt ?? ""));
}

function isFinalJobStatus(status) {
  return ["succeeded", "warning", "failed", "cancelled", "planned", "previewed"].includes(status);
}

function assertJobStatus(job, allowedStatuses, label) {
  if (!allowedStatuses.includes(job?.status)) {
    throw new Error(`${label} ended with ${job?.status ?? "unknown"} instead of ${allowedStatuses.join(" or ")}.`);
  }
  if (job.status === "failed") {
    assertUserFacingMessage(job.error ?? "", `${label} failure`);
  }
}

function firstResultAssetId(job, kind) {
  const assetId = job?.items?.find((item) => item?.result?.assetIds?.[kind])?.result?.assetIds?.[kind];
  if (!assetId) throw new Error(`Finished job did not expose a ${kind} asset id.`);
  return assetId;
}

function expectedOutputEvidence(outDir, baseName) {
  return {
    oneByOne: fileEvidence(path.join(outDir, `${baseName}__apple-motion-1x1.mp4`), { allowMissing: true }),
    threeByFour: fileEvidence(path.join(outDir, `${baseName}__apple-motion-3x4.mp4`), { allowMissing: true }),
    preview: fileEvidence(path.join(outDir, `${baseName}__apple-motion-3x4-preview.png`), { allowMissing: true }),
    reportJson: fileEvidence(path.join(outDir, `${baseName}__apple-motion-qc.json`), { allowMissing: true }),
    reportHtml: fileEvidence(path.join(outDir, `${baseName}__apple-motion-qc.html`), { allowMissing: true })
  };
}

function fileEvidence(filePath, { allowMissing = false } = {}) {
  const stat = fs.statSync(filePath, { throwIfNoEntry: false });
  if (!stat?.isFile()) {
    if (allowMissing) return { path: filePath, exists: false };
    throw new Error(`Expected file does not exist: ${filePath}`);
  }
  return {
    path: filePath,
    exists: true,
    size: stat.size,
    mtimeMs: stat.mtimeMs,
    sha256: sha256File(filePath)
  };
}

function assertReportEvidence(report) {
  if (report?.ok !== true) throw new Error("Full render JSON report is not PASS.");
  const items = report.items ?? [];
  const targets = new Set(items.map((item) => item.target));
  for (const target of ["1x1", "3x4"]) {
    if (!targets.has(target)) throw new Error(`Full render JSON report is missing ${target}.`);
  }
  for (const item of items) {
    if ((item?.warnings ?? []).length > 0) {
      throw new Error(`Full render JSON report target ${item.target ?? "unknown"} must not contain warnings for the release gate.`);
    }
  }
}

function assertStatusCode(result, expected, label) {
  if (result.status !== expected) {
    throw new Error(`${label} returned HTTP ${result.status}, expected ${expected}.`);
  }
}

function assertUserFacingMessage(message, label) {
  const text = String(message ?? "");
  if (!text.trim()) throw new Error(`${label} did not provide a user-facing error message.`);
  if (/\bat\s+.+:\d+:\d+/.test(text) || /Error:\s/.test(text) || /TypeError|ReferenceError|SyntaxError/.test(text)) {
    throw new Error(`${label} exposed a raw stack or exception type.`);
  }
  if (/[A-Za-z]:\\[^\s"]+|\/Users\/|\/tmp\/|\\{2}[^\\]+\\/.test(text)) {
    throw new Error(`${label} exposed a raw local path.`);
  }
}

function sanitizedRuntimeEnvironment(env) {
  return {
    [USER_DATA_DIR_ENV]: env[USER_DATA_DIR_ENV],
    FFMPEG_PATH: env.FFMPEG_PATH,
    FFPROBE_PATH: env.FFPROBE_PATH,
    PATH: env.PATH
  };
}

async function waitForElectronPage(debugPort, timeoutMs) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const targets = await requestJson(`http://127.0.0.1:${debugPort}/json/list`, {
      timeoutMs: boundedRemainingTimeout(started, timeoutMs)
    })
      .then((result) => Array.isArray(result.payload) ? result.payload : [])
      .catch(() => []);
    const page = targets.find((target) => target.type === "page" && target.url.startsWith("http://127.0.0.1:"));
    if (page) return page;
    await delay(250);
  }
  throw new Error(`Timed out waiting for Electron page on remote debugging port ${debugPort}.`);
}

function canConnectTcp(host, port, timeoutMs = 500) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(value);
    };
    socket.setTimeout(timeoutMs);
    socket.once("connect", () => finish(true));
    socket.once("timeout", () => finish(false));
    socket.once("error", () => finish(false));
    socket.connect(port, host);
  });
}

function findFreeTcpPort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : null;
      server.close((error) => {
        if (error) reject(error);
        else if (Number.isInteger(port)) resolve(port);
        else reject(new Error("Unable to resolve a free TCP port."));
      });
    });
  });
}

class CdpClient {
  static async connect(webSocketDebuggerUrl, { timeoutMs = DEFAULT_TRANSPORT_TIMEOUT_MS } = {}) {
    const WebSocketImpl = resolveCdpWebSocket();
    const socket = new WebSocketImpl(webSocketDebuggerUrl);
    const boundedTimeoutMs = normalizeOperationTimeout(timeoutMs);
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        socket.close();
        reject(createTransportTimeoutError(`CDP WebSocket connect ${webSocketDebuggerUrl}`, boundedTimeoutMs));
      }, boundedTimeoutMs);
      const settle = (callback) => (event) => {
        clearTimeout(timeout);
        callback(event);
      };
      socket.addEventListener("open", settle(resolve), { once: true });
      socket.addEventListener("error", settle(() => reject(new Error("CDP WebSocket failed before opening."))), { once: true });
      socket.addEventListener("close", settle(() => reject(new Error("CDP WebSocket closed before opening."))), { once: true });
    });
    return new CdpClient(socket);
  }

  constructor(socket, { commandTimeoutMs = DEFAULT_TRANSPORT_TIMEOUT_MS } = {}) {
    this.socket = socket;
    this.commandTimeoutMs = commandTimeoutMs;
    this.nextId = 1;
    this.pending = new Map();
    this.socket.addEventListener("message", (event) => {
      const message = JSON.parse(event.data);
      if (!message.id || !this.pending.has(message.id)) return;
      const { resolve, reject, timeout } = this.pending.get(message.id);
      this.pending.delete(message.id);
      clearTimeout(timeout);
      if (message.error) reject(new Error(`${message.error.message}: ${message.error.data ?? ""}`));
      else resolve(message.result);
    });
    this.socket.addEventListener("close", () => {
      this.rejectPending(new Error("CDP WebSocket closed before a command response arrived."));
    });
    this.socket.addEventListener("error", () => {
      this.rejectPending(new Error("CDP WebSocket failed before a command response arrived."));
    });
  }

  async enable() {
    await this.send("Runtime.enable");
    await this.send("Page.enable");
  }

  send(method, params = {}, { timeoutMs = this.commandTimeoutMs } = {}) {
    const id = this.nextId++;
    this.socket.send(JSON.stringify({ id, method, params }));
    const boundedTimeoutMs = normalizeOperationTimeout(timeoutMs);
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(createTransportTimeoutError(`CDP ${method}`, boundedTimeoutMs));
      }, boundedTimeoutMs);
      this.pending.set(id, { resolve, reject, timeout });
    });
  }

  async evaluate(expression, { timeoutMs = this.commandTimeoutMs } = {}) {
    const result = await this.send("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true,
      userGesture: true
    }, { timeoutMs });
    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text || "Runtime exception");
    }
    return result.result?.value;
  }

  async evaluateJson(expression) {
    return JSON.parse(await this.evaluate(`JSON.stringify(${expression})`));
  }

  async waitFor(predicateSource, timeoutMs) {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      if (await this.evaluate(`Boolean((${predicateSource})())`, { timeoutMs: boundedRemainingTimeout(started, timeoutMs) })) return;
      await delay(200);
    }
    throw new Error(`Timed out waiting for ${predicateSource}`);
  }

  async screenshot(filePath) {
    const result = await this.send("Page.captureScreenshot", {
      format: "png",
      captureBeyondViewport: false
    });
    fs.writeFileSync(filePath, Buffer.from(result.data, "base64"));
    return filePath;
  }

  close() {
    this.socket.close();
  }

  rejectPending(error) {
    for (const [id, pending] of this.pending.entries()) {
      clearTimeout(pending.timeout);
      pending.reject(error);
      this.pending.delete(id);
    }
  }
}

function resolveCdpWebSocket({
  globalObject = globalThis,
  requireImpl = require
} = {}) {
  if (typeof globalObject.WebSocket === "function") return globalObject.WebSocket;
  const { WebSocket: UndiciWebSocket } = requireImpl("undici");
  if (typeof UndiciWebSocket === "function") return UndiciWebSocket;
  throw new Error("CDP WebSocket client is unavailable. Install undici or use a Node runtime with WebSocket support.");
}

async function click(cdp, selector) {
  await cdp.evaluate(`document.querySelector(${JSON.stringify(selector)})?.click()`);
}

async function setValue(cdp, selector, value) {
  await cdp.evaluate(`(() => {
    const element = document.querySelector(${JSON.stringify(selector)});
    if (!element) throw new Error("Missing selector ${selector}");
    element.value = ${JSON.stringify(value)};
    element.dispatchEvent(new Event("input", { bubbles: true }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
  })()`);
}

async function setChecked(cdp, selector, checked) {
  await cdp.evaluate(`(() => {
    const element = document.querySelector(${JSON.stringify(selector)});
    if (!element) throw new Error("Missing selector ${selector}");
    element.checked = ${checked ? "true" : "false"};
    element.dispatchEvent(new Event("change", { bubbles: true }));
  })()`);
}

function collectChildOutput(child) {
  const lines = [];
  const append = (stream, chunk) => {
    for (const line of chunk.toString().split(/\r?\n/)) {
      if (line.trim()) lines.push({ stream, line: sanitizeDiagnostic(line) });
    }
    if (lines.length > 200) lines.splice(0, lines.length - 200);
  };
  child.stdout.on("data", (chunk) => append("stdout", chunk));
  child.stderr.on("data", (chunk) => append("stderr", chunk));
  return {
    snapshot() {
      return [...lines];
    }
  };
}

function sanitizeDiagnostic(value) {
  return String(value).replace(/[A-Za-z]:\\[^\s"]+/g, "[redacted path]");
}

function assertRuntimeInputs(paths) {
  for (const [label, filePath] of [
    ["packaged app", paths.appPath],
    ["bundled ffmpeg", paths.ffmpegPath],
    ["bundled ffprobe", paths.ffprobePath]
  ]) {
    const stat = fs.statSync(filePath, { throwIfNoEntry: false });
    if (!stat?.isFile()) throw new Error(`Missing ${label}: ${filePath}`);
  }
}

function resetSmokeDirectory(paths) {
  fs.rmSync(paths.workDir, { recursive: true, force: true });
  fs.mkdirSync(paths.workDir, { recursive: true });
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

function terminateProcess(child) {
  if (child.exitCode !== null || child.signalCode) return;
  child.kill();
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function boundedRemainingTimeout(started, totalTimeoutMs, maxTimeoutMs = DEFAULT_TRANSPORT_TIMEOUT_MS) {
  const remaining = totalTimeoutMs - (Date.now() - started);
  return normalizeOperationTimeout(Math.min(maxTimeoutMs, Math.max(1, remaining)));
}

function normalizeOperationTimeout(timeoutMs) {
  return Number.isFinite(timeoutMs) && timeoutMs > 0
    ? Math.max(1, Math.floor(timeoutMs))
    : DEFAULT_TRANSPORT_TIMEOUT_MS;
}

function createTransportTimeoutError(label, timeoutMs) {
  return new Error(`${label} timed out after ${timeoutMs} ms.`);
}

if (require.main === module) {
  run().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}

module.exports = {
  CdpClient,
  DEFAULT_APP_RELATIVE_PATH,
  DEFAULT_DEBUG_PORT,
  DEFAULT_TRANSPORT_TIMEOUT_MS,
  assertJobStatus,
  assertReportEvidence,
  buildAppLaunchArgs,
  buildDryRunPlan,
  buildRuntimeSmokeEnvironment,
  buildSampleVideoArgs,
  createSmokeEvidence,
  defaultAppPath,
  defaultWorkDir,
  markSmokeEvidenceFailed,
  markSmokeEvidencePassed,
  parseArgs,
  prepareLaunchPlan,
  requestJson,
  resolveCdpWebSocket,
  resolveRuntimePaths,
  usage
};
