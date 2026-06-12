import { access, chmod, mkdir, mkdtemp, readFile, readdir, realpath, rename, stat, symlink, truncate, unlink, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import assert from "node:assert/strict";

import { buildOutputPlan } from "../src/cli.mjs";
import * as uiServer from "../ui/server.mjs";
import { createUiServer, createUiState, defaultJobStorePath, flushUiState, isTrustedLocalHostRequest, normalizeJobOptions } from "../ui/server.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const toolRoot = path.resolve(__dirname, "..");
const privateUserRoot = `/${"Users"}/will`;

test("normalizes UI job options with cross-platform encoder choices", () => {
  const options = normalizeJobOptions({
    input: "D:\\covers\\source.mov",
    outDir: "D:\\covers\\out",
    encoder: "qsv",
    container: "mov",
    mode: "blur-extend",
    fps: "29.97",
    bitrate: "50M"
  }, { toolRoot });

  assert.equal(options.encoder, "qsv");
  assert.equal(options.container, "mov");
  assert.equal(options.mode, "blur-extend");
  assert.equal(options.fps, "29.97");
  assert.equal("ffmpegPath" in options, false);
  assert.equal("ffprobePath" in options, false);
});

test("UI defaults to automatic device-aware encoder selection", () => {
  const options = normalizeJobOptions({
    input: "cover.mov"
  }, { toolRoot });

  assert.equal(options.encoder, "auto");
});

test("UI defaults to automatic source frame-rate preservation", () => {
  const options = normalizeJobOptions({
    input: "cover.mov"
  }, { toolRoot });

  assert.equal(options.fps, "auto");
});

test("rejects mutually exclusive QC-only and preview-only modes", () => {
  assert.throws(() => normalizeJobOptions({
    input: "cover.mov",
    qcOnly: true,
    previewOnly: true
  }, { toolRoot }), /不能同时启用/);
});

test("rejects invalid UI frame rate and bitrate before queueing work", () => {
  assert.throws(() => normalizeJobOptions({
    input: "cover.mov",
    fps: "60"
  }, { toolRoot }), /帧率必须是 auto/);

  assert.throws(() => normalizeJobOptions({
    input: "cover.mov",
    bitrate: "5M"
  }, { toolRoot }), /码率必须在 45M 到 100M/);
});

test("normalizes explicit UI overwrite choice", () => {
  assert.equal(normalizeJobOptions({
    input: "cover.mov"
  }, { toolRoot }).overwrite, false);

  assert.equal(normalizeJobOptions({
    input: "cover.mov",
    overwrite: true
  }, { toolRoot }).overwrite, true);
});

test("UI rejects null JSON job creation payloads as client errors", async () => {
  const state = createUiState();
  const { server, baseUrl } = await listen(createUiServer({ toolRoot, state }));
  try {
    for (const body of ["null", "[]"]) {
      const response = await fetch(`${baseUrl}/api/jobs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body
      });
      const payload = await response.json();

      assert.equal(response.status, 400);
      assert.equal(payload.ok, false);
      assert.match(payload.error, /JSON 对象/);
      assert.doesNotMatch(payload.error, /TypeError|Cannot|reading|null/);
    }
    assert.equal(state.jobs.size, 0);
  } finally {
    await close(server);
  }
});

test("UI rejects null JSON reveal payloads as client errors", async () => {
  const { server, baseUrl } = await listen(createUiServer({ toolRoot }));
  try {
    for (const body of ["null", "[]"]) {
      const response = await fetch(`${baseUrl}/api/reveal`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body
      });
      const payload = await response.json();

      assert.equal(response.status, 400);
      assert.equal(payload.ok, false);
      assert.match(payload.error, /JSON 对象/);
      assert.doesNotMatch(payload.error, /TypeError|Cannot|reading|null/);
    }
  } finally {
    await close(server);
  }
});

test("default job store path uses the app data directory", () => {
  const appDataDir = path.join(os.tmpdir(), "openfad-motion-user-data");
  const previous = process.env.OPENFAD_MOTION_UI_JOB_STORE;
  delete process.env.OPENFAD_MOTION_UI_JOB_STORE;
  try {
    assert.equal(defaultJobStorePath({ appDataDir }), path.join(appDataDir, "jobs.json"));
  } finally {
    if (previous === undefined) delete process.env.OPENFAD_MOTION_UI_JOB_STORE;
    else process.env.OPENFAD_MOTION_UI_JOB_STORE = previous;
  }
});

test("UI server health endpoint returns local bridge metadata", async () => {
  const { server, baseUrl } = await listen(createUiServer({ toolRoot }));
  try {
    const response = await fetch(`${baseUrl}/api/health`);
    const payload = await response.json();
    assert.equal(response.status, 200);
    assert.equal(payload.ok, true);
    assert.equal(payload.toolRootLabel, "motion-batch");
    assert.equal("toolRoot" in payload, false);
    assert.doesNotMatch(JSON.stringify(payload), /\/Users|openFAD|tools\/apple-motion-batch/);
  } finally {
    await close(server);
  }
});

test("UI server health endpoint does not expose configured video tool paths", async () => {
  const previousFfmpegPath = process.env.FFMPEG_PATH;
  const previousFfprobePath = process.env.FFPROBE_PATH;
  process.env.FFMPEG_PATH = `${privateUserRoot}/.private-fixture/video/ffmpeg`;
  process.env.FFPROBE_PATH = `${privateUserRoot}/.private-fixture/video/ffprobe`;
  const { server, baseUrl } = await listen(createUiServer({ toolRoot }));
  try {
    const response = await fetch(`${baseUrl}/api/health`);
    const payload = await response.json();
    assert.equal(response.status, 200);
    assert.equal(payload.ok, true);
    assert.equal("ffmpegPath" in payload, false);
    assert.equal("ffprobePath" in payload, false);
    assert.deepEqual(payload.videoTools, {
      ffmpeg: { configured: true, label: "ffmpeg" },
      ffprobe: { configured: true, label: "ffprobe" }
    });
    assert.doesNotMatch(JSON.stringify(payload), /\/Users|\.private-fixture|video\/ffmpeg|video\/ffprobe/);
  } finally {
    await close(server);
    if (previousFfmpegPath === undefined) delete process.env.FFMPEG_PATH;
    else process.env.FFMPEG_PATH = previousFfmpegPath;
    if (previousFfprobePath === undefined) delete process.env.FFPROBE_PATH;
    else process.env.FFPROBE_PATH = previousFfprobePath;
  }
});

test("UI local trust rejects non-loopback peers with forged loopback Host headers", () => {
  assert.equal(isTrustedLocalHostRequest({
    hostHeader: "127.0.0.1:4387",
    localPort: 4387,
    remoteAddress: "192.168.1.10"
  }), false);
  assert.equal(isTrustedLocalHostRequest({
    hostHeader: "127.0.0.1:4387",
    localPort: 4387,
    remoteAddress: "::ffff:192.168.1.10"
  }), false);
  assert.equal(isTrustedLocalHostRequest({
    hostHeader: "127.0.0.1:4387",
    localPort: 4387,
    remoteAddress: "::ffff:127.0.0.1"
  }), true);
});

test("standalone UI server reports port conflicts without a raw Node stack", async () => {
  const occupiedServer = http.createServer((_, response) => response.end("busy"));
  const { server: occupied, port } = await listenOnRandomPort(occupiedServer);
  try {
    const result = await runStandaloneServer({
      OPENFAD_MOTION_UI_HOST: "127.0.0.1",
      OPENFAD_MOTION_UI_PORT: String(port)
    });

    assert.notEqual(result.code, 0);
    assert.match(result.stderr, new RegExp(`127\\.0\\.0\\.1:${port}`));
    assert.match(result.stderr, /端口|port/i);
    assert.doesNotMatch(result.stderr, /Unhandled 'error' event|node:events/);
  } finally {
    await close(occupied);
  }
});

test("UI API responses sanitize job store persistence failures", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "apple-motion-ui-"));
  const blockedParent = path.join(tempDir, "not-a-directory");
  const jobStorePath = path.join(blockedParent, "jobs.json");
  await writeFile(blockedParent, "blocks mkdir");

  const state = createUiState({
    jobStorePath
  });
  const job = createFakeLargeJob();
  state.jobs.set(job.id, job);
  await assert.rejects(() => flushUiState(state), /not-a-directory|ENOTDIR|EEXIST/);
  assert.match(state.persistError.message, /not-a-directory|ENOTDIR|EEXIST/);

  const { server, baseUrl } = await listen(createUiServer({ toolRoot, state }));
  try {
    const healthResponse = await fetch(`${baseUrl}/api/health`);
    const healthPayload = await healthResponse.json();
    assert.equal(healthResponse.status, 200);
    assert.deepEqual(healthPayload.persistence, {
      configured: true,
      ok: false,
      error: "任务恢复记录暂时无法写入。请确认应用数据目录可写后重试。"
    });
    assert.doesNotMatch(healthPayload.persistence.error, /not-a-directory|ENOTDIR|EEXIST|\/var\/|\/Users\//);

    const jobsResponse = await fetch(`${baseUrl}/api/jobs`);
    const jobsPayload = await jobsResponse.json();
    assert.equal(jobsResponse.status, 200);
    assert.equal(jobsPayload.persistence.ok, false);
    assert.equal(jobsPayload.persistence.error, healthPayload.persistence.error);

    const detailResponse = await fetch(`${baseUrl}/api/jobs/${job.id}`);
    const detailPayload = await detailResponse.json();
    assert.equal(detailResponse.status, 200);
    assert.equal(detailPayload.persistence.error, healthPayload.persistence.error);

    const missingResponse = await fetch(`${baseUrl}/api/jobs/missing`);
    const missingPayload = await missingResponse.json();
    assert.equal(missingResponse.status, 404);
    assert.equal(missingPayload.ok, false);
    assert.equal(missingPayload.persistence.error, healthPayload.persistence.error);
  } finally {
    await close(server);
  }
});

test("UI restores interrupted jobs from the local job store after a server restart", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "apple-motion-ui-"));
  const jobStorePath = path.join(tempDir, "jobs.json");
  const now = new Date().toISOString();
  await writeFile(jobStorePath, JSON.stringify({
    version: 1,
    jobs: [{
      id: "persisted-running",
      status: "running",
      options: {
        input: path.join(tempDir, "cover.mov"),
        outDir: path.join(tempDir, "out"),
        mode: "scale-fill",
        fps: "auto",
        bitrate: "50M",
        container: "mp4",
        encoder: "auto",
        dryRun: false,
        qcOnly: false,
        previewOnly: false,
        overwrite: false
      },
      createdAt: now,
      startedAt: now,
      finishedAt: null,
      current: path.join(tempDir, "cover.mov"),
      total: 1,
      completed: 0,
      passed: 0,
      warnings: 0,
      failed: 0,
      planned: 0,
      cancelRequested: false,
      error: null,
      currentStage: { name: "render", target: "3x4", state: "active", at: now },
      items: [{
        inputPath: path.join(tempDir, "cover.mov"),
        status: "processing",
        startedAt: now,
        finishedAt: null,
        error: null,
        result: null,
        currentStage: { name: "render", target: "3x4", state: "active", at: now },
        stages: [{ name: "render", target: "3x4", state: "active", at: now }]
      }],
      logs: [{ at: now, level: "info", message: "渲染任务已开始。" }],
      inputFiles: [path.join(tempDir, "cover.mov")]
    }]
  }));

  const state = createUiState({ jobStorePath });
  const restoredJob = state.jobs.get("persisted-running");
  assert.equal(restoredJob.current, null);
  assert.equal(restoredJob.currentStage.name, "recover");
  assert.equal(restoredJob.currentStage.state, "failed");
  assert.equal(restoredJob.total, 1);
  assert.equal(restoredJob.completed, 1);
  assert.equal(restoredJob.failed, 1);
  assert.equal(restoredJob.items[0].status, "failed");
  assert.equal(restoredJob.items[0].currentStage.name, "recover");
  assert.equal(restoredJob.items[0].currentStage.state, "failed");
  assert.notEqual(restoredJob.items[0].currentStage.state, "active");
  const { server, baseUrl } = await listen(createUiServer({ toolRoot, state }));
  try {
    const response = await fetch(`${baseUrl}/api/jobs`);
    const payload = await response.json();
    assert.equal(response.status, 200);
    assert.equal(payload.jobs.length, 1);
    assert.equal(payload.jobs[0].id, "persisted-running");
    assert.equal(payload.jobs[0].status, "failed");
    assert.equal(payload.jobs[0].completed, 1);
    assert.equal(payload.jobs[0].failed, 1);
    assert.match(payload.jobs[0].error, /上次本地桥接服务中断/);

    const detailResponse = await fetch(`${baseUrl}/api/jobs/persisted-running`);
    const detail = await detailResponse.json();
    assert.match(detail.job.logs.at(-1).message, /上次本地桥接服务中断/);
  } finally {
    await close(server);
  }
});

test("UI restores clipped interrupted jobs with reconciled aggregate counters", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "apple-motion-ui-"));
  const jobStorePath = path.join(tempDir, "jobs.json");
  const now = new Date().toISOString();
  await writeFile(jobStorePath, JSON.stringify({
    version: 1,
    jobs: [{
      id: "persisted-clipped-running",
      status: "running",
      options: {
        input: path.join(tempDir, "covers"),
        outDir: path.join(tempDir, "out"),
        mode: "scale-fill",
        fps: "auto",
        bitrate: "50M",
        container: "mp4",
        encoder: "auto",
        dryRun: false,
        qcOnly: false,
        previewOnly: false,
        overwrite: false
      },
      createdAt: now,
      startedAt: now,
      finishedAt: null,
      current: path.join(tempDir, "covers", "cover-1000.mov"),
      total: 1000,
      completed: 999,
      passed: 999,
      warnings: 0,
      failed: 0,
      planned: 0,
      cancelRequested: false,
      error: null,
      currentStage: { name: "render", target: "3x4", state: "active", at: now },
      items: [{
        inputPath: path.join(tempDir, "covers", "cover-1000.mov"),
        status: "processing",
        startedAt: now,
        finishedAt: null,
        error: null,
        result: null,
        currentStage: { name: "render", target: "3x4", state: "active", at: now }
      }],
      logs: [{ at: now, level: "info", message: "渲染任务已开始。" }],
      inputFiles: []
    }]
  }));

  const state = createUiState({ jobStorePath, storedItemsLimit: 0 });
  const restoredJob = state.jobs.get("persisted-clipped-running");
  assert.equal(restoredJob.status, "failed");
  assert.equal(restoredJob.items.length, 0);
  assert.equal(restoredJob.total, 1000);
  assert.equal(restoredJob.completed, 1000);
  assert.equal(restoredJob.passed, 999);
  assert.equal(restoredJob.failed, 1);

  const { server, baseUrl } = await listen(createUiServer({ toolRoot, state }));
  try {
    const response = await fetch(`${baseUrl}/api/jobs`);
    const payload = await response.json();
    assert.equal(response.status, 200);
    assert.equal(payload.jobs[0].completed, 1000);
    assert.equal(payload.jobs[0].failed, 1);
    assert.equal(payload.jobs[0].total, 1000);
  } finally {
    await close(server);
  }
});

test("UI prunes over-limit finished jobs restored from the local job store", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "apple-motion-ui-"));
  const jobStorePath = path.join(tempDir, "jobs.json");
  const now = new Date().toISOString();
  const storedJob = (id) => ({
    id,
    status: "planned",
    options: {
      input: path.join(tempDir, `${id}.mov`),
      outDir: path.join(tempDir, "out")
    },
    createdAt: now,
    startedAt: now,
    finishedAt: now,
    current: null,
    total: 1,
    completed: 1,
    passed: 0,
    warnings: 0,
    failed: 0,
    planned: 1,
    cancelRequested: false,
    error: null,
    currentStage: null,
    logs: [{ at: now, level: "info", message: `${id} planned` }],
    inputFiles: [path.join(tempDir, `${id}.mov`)],
    items: []
  });
  await writeFile(jobStorePath, JSON.stringify({
    version: 1,
    jobs: [storedJob("old-a"), storedJob("old-b"), storedJob("old-c")]
  }));

  const state = createUiState({ jobStorePath, maxJobs: 1 });
  assert.deepEqual([...state.jobs.keys()], ["old-c"]);

  await flushUiState(state);
  const persisted = JSON.parse(await readFile(jobStorePath, "utf8"));
  assert.deepEqual(persisted.jobs.map((job) => job.id), ["old-c"]);
});

test("UI restore pruning preserves a freshly interrupted job even when history retention is zero", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "apple-motion-ui-"));
  const jobStorePath = path.join(tempDir, "jobs.json");
  const now = new Date().toISOString();
  await writeFile(jobStorePath, JSON.stringify({
    version: 1,
    jobs: [{
      id: "old-planned",
      status: "planned",
      options: {
        input: path.join(tempDir, "old.mov"),
        outDir: path.join(tempDir, "out")
      },
      createdAt: now,
      startedAt: now,
      finishedAt: now,
      current: null,
      total: 1,
      completed: 1,
      passed: 0,
      warnings: 0,
      failed: 0,
      planned: 1,
      cancelRequested: false,
      error: null,
      currentStage: null,
      logs: [],
      inputFiles: [path.join(tempDir, "old.mov")],
      items: []
    }, {
      id: "crashed-active",
      status: "running",
      options: {
        input: path.join(tempDir, "active.mov"),
        outDir: path.join(tempDir, "out")
      },
      createdAt: now,
      startedAt: now,
      finishedAt: null,
      current: path.join(tempDir, "active.mov"),
      total: 1,
      completed: 0,
      passed: 0,
      warnings: 0,
      failed: 0,
      planned: 0,
      cancelRequested: false,
      error: null,
      currentStage: { name: "render", target: "3x4", state: "active", at: now },
      logs: [],
      inputFiles: [path.join(tempDir, "active.mov")],
      items: []
    }]
  }));

  const state = createUiState({ jobStorePath, maxJobs: 0 });
  assert.deepEqual([...state.jobs.keys()], ["crashed-active"]);
  const restoredJob = state.jobs.get("crashed-active");
  assert.equal(restoredJob.status, "failed");
  assert.match(restoredJob.error, /上次本地桥接服务中断/);

  await flushUiState(state);
  const persisted = JSON.parse(await readFile(jobStorePath, "utf8"));
  assert.deepEqual(persisted.jobs.map((job) => job.id), ["crashed-active"]);
});

test("UI does not authorize restored job-store asset paths for local reads or reveals", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "apple-motion-ui-"));
  const jobStorePath = path.join(tempDir, "jobs.json");
  const unrelatedFile = path.join(tempDir, "not-generated.txt");
  const now = new Date().toISOString();
  await writeFile(unrelatedFile, "LEAKED");
  await writeFile(jobStorePath, JSON.stringify({
    version: 1,
    jobs: [{
      id: "restored-asset-forgery",
      status: "succeeded",
      options: {
        input: path.join(tempDir, "cover.mov"),
        outDir: path.join(tempDir, "out")
      },
      createdAt: now,
      startedAt: now,
      finishedAt: now,
      current: null,
      total: 1,
      completed: 1,
      passed: 1,
      warnings: 0,
      failed: 0,
      planned: 0,
      cancelRequested: false,
      error: null,
      currentStage: null,
      logs: [],
      inputFiles: [path.join(tempDir, "cover.mov")],
      items: [{
        inputPath: path.join(tempDir, "cover.mov"),
        status: "passed",
        result: {
          outputPlan: {
            preview: path.join(tempDir, "out", "cover__apple-motion-3x4-preview.png"),
            reportHtml: path.join(tempDir, "out", "cover__apple-motion-qc.html")
          },
          status: "passed",
          assets: {
            preview: unrelatedFile,
            reportHtml: unrelatedFile
          },
          assetIds: {
            preview: "stale-preview-id-from-store",
            reportHtml: "stale-report-id-from-store"
          },
          issueSummary: {
            errorCount: 0,
            warningCount: 0,
            issues: []
          }
        }
      }]
    }]
  }));

  let revealCalled = false;
  const state = createUiState({ jobStorePath });
  const { server, baseUrl } = await listen(createUiServer({
    toolRoot,
    state,
    revealLauncher: async () => {
      revealCalled = true;
    }
  }));
  try {
    const assetResponse = await fetch(assetUrl(baseUrl, "forged-asset-id"));
    assert.equal(assetResponse.status, 403);

    const revealResponse = await fetch(`${baseUrl}/api/reveal`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: "forged-asset-id" })
    });
    const revealPayload = await revealResponse.json();

    assert.equal(revealResponse.status, 403);
    assert.equal(revealPayload.ok, false);
    assert.equal(revealCalled, false);

    const detailResponse = await fetch(`${baseUrl}/api/jobs/restored-asset-forgery`);
    const detailPayload = await detailResponse.json();
    assert.equal(detailResponse.status, 200);
    assert.deepEqual(detailPayload.job.items[0].result.assets, {});
    assert.deepEqual(detailPayload.job.items[0].result.assetIds, {});
    assert.equal(detailPayload.job.items[0].result.outputPlan.reportHtml, "HTML 报告");
    assert.doesNotMatch(JSON.stringify(detailPayload), new RegExp(escapeRegExp(tempDir)));
  } finally {
    await close(server);
  }
});

test("UI rejects stale path-style reveal payloads without touching the host shell", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "apple-motion-ui-"));
  const generatedAsset = path.join(tempDir, "cover__apple-motion-qc.html");
  await writeFile(generatedAsset, "<html></html>");
  const state = createUiState();
  await authorizeGeneratedAsset(state, generatedAsset);
  let revealCalled = false;
  const { server, baseUrl } = await listen(createUiServer({
    toolRoot,
    state,
    revealLauncher: async () => {
      revealCalled = true;
    }
  }));
  try {
    const response = await fetch(`${baseUrl}/api/reveal`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: generatedAsset })
    });
    const payload = await response.json();

    assert.equal(response.status, 400);
    assert.equal(payload.ok, false);
    assert.match(payload.error, /资产 ID/);
    assert.doesNotMatch(payload.error, /cover__apple-motion-qc|\/var\/|\/Users\//);
    assert.equal(revealCalled, false);
  } finally {
    await close(server);
  }
});

test("UI reauthorizes existing outputPlan assets after job-store restore without trusting stored asset overrides", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "apple-motion-ui-"));
  const jobStorePath = path.join(tempDir, "jobs.json");
  const outDir = path.join(tempDir, "out");
  const inputPath = path.join(tempDir, "cover.mov");
  const previewPath = path.join(outDir, "cover__apple-motion-3x4-preview.png");
  const reportHtmlPath = path.join(outDir, "cover__apple-motion-qc.html");
  const unrelatedFile = path.join(tempDir, "not-generated.txt");
  const now = new Date().toISOString();
  await mkdir(outDir);
  await writeFile(inputPath, "source");
  await writeFile(previewPath, "PREVIEW");
  await writeFile(reportHtmlPath, "<!doctype html><title>QC</title>");
  await writeFile(unrelatedFile, "LEAKED");
  await writeFile(jobStorePath, JSON.stringify({
    version: 1,
    jobs: [{
      id: "restored-output-plan-assets",
      status: "succeeded",
      options: {
        input: inputPath,
        outDir
      },
      createdAt: now,
      startedAt: now,
      finishedAt: now,
      current: null,
      total: 1,
      completed: 1,
      passed: 1,
      warnings: 0,
      failed: 0,
      planned: 0,
      cancelRequested: false,
      error: null,
      currentStage: null,
      logs: [],
      inputFiles: [inputPath],
      items: [{
        inputPath,
        status: "passed",
        result: {
          inputPath,
          outputPlan: {
            preview: previewPath,
            reportHtml: reportHtmlPath
          },
          status: "passed",
          assets: {
            preview: unrelatedFile,
            reportHtml: unrelatedFile
          },
          issueSummary: {
            errorCount: 0,
            warningCount: 0,
            issues: []
          }
        }
      }]
    }]
  }));

  const revealedPaths = [];
  const state = createUiState({ jobStorePath });
  const { server, baseUrl } = await listen(createUiServer({
    toolRoot,
    state,
    revealLauncher: async (targetPath) => {
      revealedPaths.push(targetPath);
    }
  }));
  try {
    const detailResponse = await fetch(`${baseUrl}/api/jobs/restored-output-plan-assets`);
    const detailPayload = await detailResponse.json();
    assert.equal(detailResponse.status, 200);
    assert.deepEqual(detailPayload.job.items[0].result.assets, {
      preview: "预览",
      reportHtml: "HTML 报告"
    });
    assert.doesNotMatch(JSON.stringify(detailPayload), new RegExp(escapeRegExp(tempDir)));
    const restoredAssetIds = detailPayload.job.items[0].result.assetIds;
    assert.equal(typeof restoredAssetIds.preview, "string");
    assert.equal(typeof restoredAssetIds.reportHtml, "string");

    const previewResponse = await fetch(assetUrl(baseUrl, restoredAssetIds.preview));
    assert.equal(previewResponse.status, 200);
    assert.equal(await previewResponse.text(), "PREVIEW");

    const revealResponse = await fetch(`${baseUrl}/api/reveal`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: restoredAssetIds.reportHtml })
    });
    const revealPayload = await revealResponse.json();
    assert.equal(revealResponse.status, 200);
    assert.equal(revealPayload.ok, true);
    assert.deepEqual(revealedPaths, [reportHtmlPath]);

    const forgedAssetResponse = await fetch(assetUrl(baseUrl, "forged-asset-id"));
    assert.equal(forgedAssetResponse.status, 403);
  } finally {
    await close(server);
  }
});

test("UI refuses restored outputPlan assets outside the job output directory", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "apple-motion-ui-"));
  const jobStorePath = path.join(tempDir, "jobs.json");
  const outDir = path.join(tempDir, "out");
  const inputPath = path.join(tempDir, "cover.mov");
  const unrelatedFile = path.join(tempDir, "not-generated.txt");
  const escapingReportPath = path.join(outDir, "cover__apple-motion-qc.html");
  const now = new Date().toISOString();
  await mkdir(outDir);
  await writeFile(inputPath, "source");
  await writeFile(unrelatedFile, "LEAKED");
  await symlink(unrelatedFile, escapingReportPath);
  await writeFile(jobStorePath, JSON.stringify({
    version: 1,
    jobs: [{
      id: "restored-output-plan-escape",
      status: "succeeded",
      options: {
        input: inputPath,
        outDir
      },
      createdAt: now,
      startedAt: now,
      finishedAt: now,
      current: null,
      total: 1,
      completed: 1,
      passed: 1,
      warnings: 0,
      failed: 0,
      planned: 0,
      cancelRequested: false,
      error: null,
      currentStage: null,
      logs: [],
      inputFiles: [inputPath],
      items: [{
        inputPath,
        status: "passed",
        result: {
          inputPath,
          outputPlan: {
            preview: unrelatedFile,
            reportHtml: escapingReportPath
          },
          status: "passed",
          issueSummary: {
            errorCount: 0,
            warningCount: 0,
            issues: []
          }
        }
      }]
    }]
  }));

  const state = createUiState({ jobStorePath });
  const { server, baseUrl } = await listen(createUiServer({ toolRoot, state }));
  try {
    const detailResponse = await fetch(`${baseUrl}/api/jobs/restored-output-plan-escape`);
    const detailPayload = await detailResponse.json();
    assert.equal(detailResponse.status, 200);
    assert.deepEqual(detailPayload.job.items[0].result.assets, {});
    assert.deepEqual(detailPayload.job.items[0].result.assetIds, {});

    const outsideResponse = await fetch(assetUrl(baseUrl, "outside-asset-id"));
    assert.equal(outsideResponse.status, 403);

    const symlinkResponse = await fetch(assetUrl(baseUrl, "symlink-asset-id"));
    assert.equal(symlinkResponse.status, 403);
  } finally {
    await close(server);
  }
});

test("UI job-store restore failures use localized job errors", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "apple-motion-ui-"));
  const jobStorePath = path.join(tempDir, "jobs.json");
  await writeFile(jobStorePath, `{ broken json ${privateUserRoot}/private-fixture`);

  const state = createUiState({ jobStorePath });
  const [job] = [...state.jobs.values()];
  assert.equal(job.status, "failed");
  assert.equal(job.error, "无法读取本地任务恢复记录。请重新开始任务。");
  assert.equal(job.logs.at(-1).message, job.error);
  assert.doesNotMatch(job.error, /Unexpected|JSON|broken|\/Users\//);

  const { server, baseUrl } = await listen(createUiServer({ toolRoot, state }));
  try {
    const response = await fetch(`${baseUrl}/api/jobs`);
    const payload = await response.json();
    assert.equal(response.status, 200);
    assert.equal(payload.jobs.length, 1);
    assert.equal(payload.jobs[0].error, job.error);
  } finally {
    await close(server);
  }
});

test("UI job-store restore failures can be reset without exposing or preserving the corrupt store", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "apple-motion-ui-"));
  const jobStorePath = path.join(tempDir, "jobs.json");
  const brokenStore = `{ broken json ${privateUserRoot}/private-fixture`;
  await writeFile(jobStorePath, brokenStore);

  const state = createUiState({ jobStorePath });
  assert.equal(state.restoreFailed, true);

  const { server, baseUrl } = await listen(createUiServer({ toolRoot, state }));
  try {
    const jobsResponse = await fetch(`${baseUrl}/api/jobs`);
    const jobsPayload = await jobsResponse.json();
    assert.equal(jobsResponse.status, 200);
    assert.equal(jobsPayload.restore.failed, true);
    assert.equal(jobsPayload.restore.error, "无法读取本地任务恢复记录。请重新开始任务。");
    assert.equal(jobsPayload.jobs.length, 1);

    const createResponse = await fetch(`${baseUrl}/api/jobs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ input: path.join(tempDir, "cover.mov") })
    });
    const createPayload = await createResponse.json();
    assert.equal(createResponse.status, 409);
    assert.equal(createPayload.ok, false);
    assert.match(createPayload.error, /请先重置本地任务恢复记录/);

    const resetResponse = await fetch(`${baseUrl}/api/jobs/recovery`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ confirm: "reset-restore-failure" })
    });
    const resetPayload = await resetResponse.json();
    assert.equal(resetResponse.status, 200);
    assert.equal(resetPayload.ok, true);
    assert.equal(resetPayload.reset, true);
    assert.equal(resetPayload.restore.failed, false);
    assert.deepEqual(resetPayload.jobs, []);
    assert.match(resetPayload.archivedLabel, /^jobs\.corrupt-\d{8}T\d{9}Z\.json$/);
    assert.doesNotMatch(JSON.stringify(resetPayload), /\/Users|broken json|secret/);

    const files = await readdir(tempDir);
    const corruptFile = files.find((file) => file.startsWith("jobs.corrupt-"));
    assert.ok(corruptFile);
    assert.equal(await readFile(path.join(tempDir, corruptFile), "utf8"), brokenStore);
    assert.equal(JSON.parse(await readFile(jobStorePath, "utf8")).jobs.length, 0);
    assert.equal(state.restoreFailed, false);
    assert.equal(state.jobs.size, 0);

    const jobsAfterResetResponse = await fetch(`${baseUrl}/api/jobs`);
    const jobsAfterResetPayload = await jobsAfterResetResponse.json();
    assert.equal(jobsAfterResetResponse.status, 200);
    assert.equal(jobsAfterResetPayload.restore.failed, false);
    assert.deepEqual(jobsAfterResetPayload.jobs, []);

    await flushUiState(state);
    assert.equal(JSON.parse(await readFile(jobStorePath, "utf8")).jobs.length, 0);
  } finally {
    await close(server);
  }
});

test("UI job-store restore rejects oversized files before parsing", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "apple-motion-ui-"));
  const jobStorePath = path.join(tempDir, "jobs.json");
  await writeFile(jobStorePath, JSON.stringify({
    version: 1,
    jobs: [],
    padding: "x".repeat(256)
  }));

  const state = createUiState({ jobStorePath, jobStoreMaxBytes: 64 });
  const jobs = [...state.jobs.values()];

  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].status, "failed");
  assert.equal(jobs[0].error, "无法读取本地任务恢复记录。请重新开始任务。");
  assert.equal(jobs[0].logs.at(-1).message, jobs[0].error);
  assert.doesNotMatch(jobs[0].error, /padding|jobs\.json|\/Users|x{10}/);
});

test("UI job-store restore handles malformed stored job payloads safely", async () => {
  const malformedStores = [
    { name: "null-payload", payload: "null" },
    { name: "null-job", payload: JSON.stringify({ version: 1, jobs: [null] }) },
    {
      name: "null-item",
      payload: JSON.stringify({
        version: 1,
        jobs: [{
          id: "malformed-restored-job",
          status: "running",
          items: [null],
          logs: [],
          inputFiles: []
        }]
      })
    }
  ];

  for (const malformedStore of malformedStores) {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), `apple-motion-ui-${malformedStore.name}-`));
    const jobStorePath = path.join(tempDir, "jobs.json");
    await writeFile(jobStorePath, malformedStore.payload);

    const state = createUiState({ jobStorePath });
    const jobs = [...state.jobs.values()];
    assert.equal(jobs.length, 1, malformedStore.name);
    assert.equal(jobs[0].status, "failed", malformedStore.name);
    assert.equal(jobs[0].error, "无法读取本地任务恢复记录。请重新开始任务。", malformedStore.name);
    assert.equal(jobs[0].logs.at(-1).message, jobs[0].error, malformedStore.name);
    assert.doesNotMatch(jobs[0].error, /TypeError|Cannot|reading|null|malformed-restored-job|\/Users\//);
  }
});

test("UI restores cancelling active jobs as cancelled instead of failed", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "apple-motion-ui-"));
  const jobStorePath = path.join(tempDir, "jobs.json");
  const now = new Date().toISOString();
  await writeFile(jobStorePath, JSON.stringify({
    version: 1,
    jobs: [{
      id: "persisted-cancelling",
      status: "running",
      options: {
        input: path.join(tempDir, "cover.mov"),
        outDir: path.join(tempDir, "out"),
        mode: "scale-fill",
        fps: "auto",
        bitrate: "50M",
        container: "mp4",
        encoder: "auto",
        dryRun: false,
        qcOnly: false,
        previewOnly: true,
        overwrite: false
      },
      createdAt: now,
      startedAt: now,
      finishedAt: null,
      current: path.join(tempDir, "cover.mov"),
      total: 1,
      completed: 0,
      passed: 0,
      warnings: 0,
      failed: 0,
      planned: 0,
      cancelRequested: true,
      error: null,
      currentStage: { name: "cancel", target: "job", state: "active", at: now },
      items: [{
        inputPath: path.join(tempDir, "cover.mov"),
        status: "processing",
        startedAt: now,
        finishedAt: null,
        error: null,
        result: null,
        currentStage: { name: "preview", target: "preview", state: "active", at: now },
        stages: []
      }],
      logs: [{ at: now, level: "warn", message: "已请求停止。正在停止当前处理。" }],
      inputFiles: [path.join(tempDir, "cover.mov")]
    }]
  }));

  const state = createUiState({ jobStorePath });
  const job = state.jobs.get("persisted-cancelling");
  assert.equal(job.status, "cancelled");
  assert.equal(job.error, null);
  assert.equal(job.failed, 0);
  assert.equal(job.completed, 1);
  assert.equal(job.current, null);
  assert.equal(job.currentStage.name, "cancel");
  assert.equal(job.currentStage.state, "cancelled");
  assert.equal(job.items[0].status, "cancelled");
  assert.equal(job.items[0].error, null);
  assert.equal(job.items[0].currentStage.name, "cancel");
  assert.equal(job.items[0].currentStage.state, "cancelled");
  assert.notEqual(job.items[0].currentStage.state, "active");
  assert.match(job.logs.at(-1).message, /任务正在停止/);
});

test("UI shutdown aborts pending job creation instead of timing out", async () => {
  const state = createUiState();
  const controller = new AbortController();
  state.jobCreationPending = true;
  state.jobCreationAbortController = controller;
  controller.signal.addEventListener("abort", () => {
    state.jobCreationPending = false;
    state.jobCreationAbortController = null;
  });

  await uiServer.shutdownUiState(state, { timeoutMs: 100 });

  assert.equal(controller.signal.aborted, true);
  assert.equal(state.jobCreationPending, false);
});

test("UI shutdown aborts a half-open pending job creation request", async () => {
  const state = createUiState();
  const { server, baseUrl } = await listen(createUiServer({ toolRoot, state }));
  const { port } = new URL(baseUrl);
  const socket = net.connect(Number(port), "127.0.0.1");
  try {
    await new Promise((resolve, reject) => {
      socket.once("connect", resolve);
      socket.once("error", reject);
    });
    socket.write([
      "POST /api/jobs HTTP/1.1",
      `Host: 127.0.0.1:${port}`,
      "Content-Type: application/json",
      "Content-Length: 1024",
      "",
      "{\"input\":"
    ].join("\r\n"));
    await waitForCondition(() => state.jobCreationPending && state.jobCreationAbortController);

    await uiServer.shutdownUiState(state, { timeoutMs: 250 });

    assert.equal(state.jobCreationPending, false);
    assert.equal(state.jobCreationAbortController, null);
  } finally {
    socket.destroy();
    await close(server);
  }
});

test("UI times out a half-open job creation body and accepts a later valid job", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "apple-motion-ui-"));
  const input = path.join(tempDir, "cover.mov");
  const outDir = path.join(tempDir, "out");
  await writeFile(input, "");

  const state = createUiState();
  const { server, baseUrl } = await listen(createUiServer({
    toolRoot,
    state,
    jobCreationBodyTimeoutMs: 50
  }));
  const { port } = new URL(baseUrl);
  const socket = net.connect(Number(port), "127.0.0.1");
  let rawResponse = "";
  const responsePromise = new Promise((resolve) => {
    socket.on("data", (chunk) => {
      rawResponse += chunk.toString();
    });
    socket.on("end", () => resolve(rawResponse));
    socket.on("close", () => resolve(rawResponse));
  });

  try {
    await new Promise((resolve, reject) => {
      socket.once("connect", resolve);
      socket.once("error", reject);
    });
    socket.write([
      "POST /api/jobs HTTP/1.1",
      `Host: 127.0.0.1:${port}`,
      "Content-Type: application/json",
      "Content-Length: 1024",
      "",
      "{\"input\":"
    ].join("\r\n"));
    await waitForCondition(() => state.jobCreationPending && state.jobCreationAbortController);

    const timeoutRaw = await Promise.race([
      responsePromise,
      delay(1000).then(() => rawResponse)
    ]);
    assert.match(timeoutRaw, /408/);
    assert.match(timeoutRaw, /请求内容读取超时/);
    await waitForCondition(() => !state.jobCreationPending && !state.jobCreationAbortController);

    const created = await createDryRunJob(baseUrl, input, outDir);
    assert.equal(created.ok, true);
    assert.equal(created.job.status, "queued");
  } finally {
    socket.destroy();
    await close(server);
  }
});

test("UI times out a half-open reveal body instead of leaving the local bridge connection open", async () => {
  const { server, baseUrl } = await listen(createUiServer({
    toolRoot,
    jobCreationBodyTimeoutMs: 50
  }));
  const { port } = new URL(baseUrl);
  const socket = net.connect(Number(port), "127.0.0.1");
  let rawResponse = "";
  const responsePromise = new Promise((resolve) => {
    socket.on("data", (chunk) => {
      rawResponse += chunk.toString();
    });
    socket.on("end", () => resolve(rawResponse));
    socket.on("close", () => resolve(rawResponse));
  });

  try {
    await new Promise((resolve, reject) => {
      socket.once("connect", resolve);
      socket.once("error", reject);
    });
    socket.write([
      "POST /api/reveal HTTP/1.1",
      `Host: 127.0.0.1:${port}`,
      "Content-Type: application/json",
      "Content-Length: 1024",
      "",
      "{\"path\":"
    ].join("\r\n"));

    const timeoutRaw = await Promise.race([
      responsePromise,
      delay(1000).then(() => rawResponse)
    ]);
    assert.match(timeoutRaw, /408/);
    assert.match(timeoutRaw, /请求内容读取超时/);
  } finally {
    socket.destroy();
    await close(server);
  }
});

test("UI job creation abort during persistence does not leave a hidden queued job", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "apple-motion-ui-"));
  const input = path.join(tempDir, "cover.mov");
  const outDir = path.join(tempDir, "out");
  const jobStorePath = path.join(tempDir, "jobs.json");
  await writeFile(input, "");

  const state = createUiState({ jobStorePath });
  let releaseInitialPersist;
  state.persistPromise = new Promise((resolve) => {
    releaseInitialPersist = resolve;
  });
  const { server, baseUrl } = await listen(createUiServer({ toolRoot, state }));
  const controller = new AbortController();
  try {
    const createPromise = fetch(`${baseUrl}/api/jobs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        input,
        outDir,
        dryRun: true
      })
    }).catch((error) => error);

    await waitForCondition(() => state.jobs.size === 1 && state.jobCreationPending);
    const [pendingJobId] = state.jobs.keys();
    controller.abort();
    await waitForCondition(() => state.jobCreationAbortController?.signal.aborted);
    releaseInitialPersist();
    const abortResult = await createPromise;

    assert.equal(abortResult.name, "AbortError");
    await waitForCondition(() => !state.jobCreationPending);
    assert.equal(state.jobs.has(pendingJobId), false);
    await flushUiState(state);
    const stored = JSON.parse(await readFile(jobStorePath, "utf8"));
    assert.deepEqual(stored.jobs, []);
  } finally {
    releaseInitialPersist?.();
    controller.abort();
    await close(server);
  }
});

test("standalone UI SIGTERM terminates active FFmpeg work before exiting", { timeout: 8000 }, async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "apple-motion-ui-"));
  const input = path.join(tempDir, "cover.mov");
  const outDir = path.join(tempDir, "out");
  const fakeFfmpeg = await writeFakeLongRunningFfmpeg(tempDir);
  const fakeFfprobe = await writeFakeCompliantFfprobe(tempDir);
  const startedPath = path.join(tempDir, "started.txt");
  const terminatedPath = path.join(tempDir, "terminated.txt");
  const pidPath = path.join(tempDir, "pid.txt");
  const port = await getUnusedPort();
  await writeFile(input, "");

  const standalone = await startStandaloneUiServer({
    HOME: tempDir,
    OPENFAD_MOTION_UI_PORT: String(port)
  });
  try {
    const createResponse = await fetch(`${standalone.baseUrl}/api/jobs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        input,
        outDir,
        previewOnly: true,
        ffmpegPath: fakeFfmpeg,
        ffprobePath: fakeFfprobe
      })
    });
    assert.equal(createResponse.status, 202);

    await waitForFile(startedPath);
    standalone.child.kill("SIGTERM");
    await standalone.exited;

    await waitForFile(terminatedPath, 1000);
  } finally {
    standalone.child.kill("SIGTERM");
    await terminatePidFile(pidPath);
  }
});

test("UI server persists active jobs when a runtime job store is configured", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "apple-motion-ui-"));
  const input = path.join(tempDir, "cover.mov");
  const outDir = path.join(tempDir, "out");
  const jobStorePath = path.join(tempDir, "user-data", "jobs.json");
  const fakeFfmpeg = await writeFakeLongRunningFfmpeg(tempDir);
  const fakeFfprobe = await writeFakeCompliantFfprobe(tempDir);
  await writeFile(input, "");

  const { server, baseUrl } = await listen(createUiServer({ toolRoot, jobStorePath }));
  try {
    const createResponse = await fetch(`${baseUrl}/api/jobs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        input,
        outDir,
        previewOnly: true,
        ffmpegPath: fakeFfmpeg,
        ffprobePath: fakeFfprobe
      })
    });
    const created = await createResponse.json();
    assert.equal(createResponse.status, 202);

    await waitForFile(path.join(tempDir, "started.txt"));
    const storedJob = await waitForStoredJob(jobStorePath, created.job.id, "running");
    assert.equal(storedJob.inputFiles[0], input);

    const restoredState = createUiState({ jobStorePath });
    const restoredJob = restoredState.jobs.get(created.job.id);
    assert.equal(restoredJob.status, "failed");
    assert.match(restoredJob.error, /上次本地桥接服务中断/);

    await fetch(`${baseUrl}/api/jobs/${created.job.id}/cancel`, { method: "POST" });
    await waitForFile(path.join(tempDir, "terminated.txt"));
    await waitForJob(baseUrl, created.job.id);
  } finally {
    await close(server);
  }
});

test("UI rejects job creation before starting work when the job store cannot write the initial recovery record", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "apple-motion-ui-"));
  const input = path.join(tempDir, "cover.mov");
  const outDir = path.join(tempDir, "out");
  const blockedParent = path.join(tempDir, "not-a-directory");
  const jobStorePath = path.join(blockedParent, "jobs.json");
  const fakeFfmpeg = await writeFakeLongRunningFfmpeg(tempDir);
  const fakeFfprobe = await writeFakeCompliantFfprobe(tempDir);
  await writeFile(input, "");
  const state = createUiState({ jobStorePath });
  await writeFile(blockedParent, "blocks mkdir");

  const { server, baseUrl } = await listen(createUiServer({ toolRoot, state }));
  try {
    const response = await fetch(`${baseUrl}/api/jobs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        input,
        outDir,
        previewOnly: true,
        ffmpegPath: fakeFfmpeg,
        ffprobePath: fakeFfprobe,
        encoder: "x264"
      })
    });
    const payload = await response.json();
    assert.equal(response.status, 500);
    assert.equal(payload.ok, false);
    assert.equal(payload.error, "任务恢复记录暂时无法写入。请确认应用数据目录可写后重试。");
    assert.equal(payload.persistence.configured, true);
    assert.equal(payload.persistence.ok, false);
    assert.equal(payload.persistence.error, "任务恢复记录暂时无法写入。请确认应用数据目录可写后重试。");
    assert.doesNotMatch(payload.persistence.error, /not-a-directory|ENOTDIR|EEXIST|\/var\/|\/Users\//);
    assert.equal(state.jobs.size, 0);
    assert.equal(state.activeAbortControllers.size, 0);
    await new Promise((resolve) => setTimeout(resolve, 25));
    await assert.rejects(() => access(path.join(tempDir, "started.txt")), /ENOENT/);
  } finally {
    await close(server);
  }
});

test("UI job-store persistence cleans temporary files when final rename fails", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "apple-motion-ui-"));
  const jobStorePath = path.join(tempDir, "jobs.json");
  await mkdir(jobStorePath);
  const state = createUiState({ jobStorePath });
  state.jobs.set("large-job", createFakeLargeJob());

  await assert.rejects(() => flushUiState(state), /EISDIR|ENOTDIR|EEXIST|EPERM/);
  const leakedTemps = (await readdir(tempDir)).filter((name) => name.startsWith("jobs.json.") && name.endsWith(".tmp"));
  assert.deepEqual(leakedTemps, []);
});

test("UI job store persists recoverable summaries without bulky per-item reports", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "apple-motion-ui-"));
  const jobStorePath = path.join(tempDir, "jobs.json");
  const state = createUiState({ jobStorePath });
  const job = createFakeLargeJob();
  state.jobs.set(job.id, job);

  await flushUiState(state);
  const payload = JSON.parse(await readFile(jobStorePath, "utf8"));
  const storedResult = payload.jobs[0].items[0].result;

  assert.equal(payload.jobs[0].items.length, 60);
  assert.equal("stages" in payload.jobs[0].items[0], false);
  assert.equal("commands" in storedResult, false);
  assert.equal("report" in storedResult, false);
  assert.deepEqual(storedResult.assets, {
    preview: "/out/cover-0__apple-motion-3x4-preview.png",
    reportHtml: "/out/cover-0__apple-motion-qc.html"
  });
  assert.deepEqual(storedResult.issueSummary, {
    errorCount: 0,
    warningCount: 1,
    issues: [{ target: "3x4", severity: "warning", message: "minor warning" }]
  });
});

test("UI job store bounds very large job item and input-file snapshots", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "apple-motion-ui-"));
  const jobStorePath = path.join(tempDir, "jobs.json");
  const state = createUiState({ jobStorePath });
  const job = createFakeLargeJob({ itemCount: 10_000 });
  state.jobs.set(job.id, job);

  await flushUiState(state);
  const payload = JSON.parse(await readFile(jobStorePath, "utf8"));
  const storedJob = payload.jobs[0];

  assert.equal(storedJob.items.length, 200);
  assert.equal(storedJob.itemsOffset, 9800);
  assert.equal(storedJob.totalItems, 10_000);
  assert.equal(storedJob.items[0].inputPath, "/covers/cover-9800.mov");
  assert.equal(storedJob.inputFiles.length, 200);
  assert.equal(storedJob.inputFilesOffset, 9800);
  assert.equal(storedJob.totalInputFiles, 10_000);
});

test("UI job-store restore bounds in-memory item and input-file snapshots", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "apple-motion-ui-"));
  const jobStorePath = path.join(tempDir, "jobs.json");
  const job = createFakeLargeJob({ itemCount: 1000 });
  const now = new Date().toISOString();
  job.status = "succeeded";
  job.current = null;
  job.finishedAt = now;
  job.completed = 1000;
  job.passed = 1000;
  job.warnings = 0;
  job.currentStage = null;
  for (const item of job.items) {
    item.status = "passed";
    item.finishedAt = now;
    item.currentStage = null;
    item.result.status = "passed";
    item.result.issueSummary = { errorCount: 0, warningCount: 0, issues: [] };
  }
  await writeFile(jobStorePath, JSON.stringify({ version: 1, jobs: [job] }));

  const state = createUiState({ jobStorePath, storedItemsLimit: 5 });
  const restoredJob = state.jobs.get(job.id);

  assert.equal(restoredJob.items.length, 5);
  assert.equal(restoredJob.itemsOffset, 995);
  assert.equal(restoredJob.totalItems, 1000);
  assert.equal(restoredJob.items[0].inputPath, "/covers/cover-995.mov");
  assert.equal(restoredJob.inputFiles.length, 200);
  assert.equal(restoredJob.inputFilesOffset, 800);
  assert.equal(restoredJob.totalInputFiles, 1000);
  assert.equal(restoredJob.inputFiles[0], "/covers/cover-800.mov");
});

test("UI job store debounces stage churn but flushes on demand", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "apple-motion-ui-"));
  const input = path.join(tempDir, "cover.mov");
  const outDir = path.join(tempDir, "out");
  const jobStorePath = path.join(tempDir, "jobs.json");
  const fakeFfmpeg = await writeFakeLongRunningFfmpeg(tempDir);
  const fakeFfprobe = await writeFakeCompliantFfprobe(tempDir);
  const state = createUiState({ jobStorePath, persistDebounceMs: 10_000 });
  await writeFile(input, "");

  const { server, baseUrl } = await listen(createUiServer({ toolRoot, state }));
  try {
    const createResponse = await fetch(`${baseUrl}/api/jobs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        input,
        outDir,
        previewOnly: true,
        ffmpegPath: fakeFfmpeg,
        ffprobePath: fakeFfprobe
      })
    });
    const created = await createResponse.json();
    assert.equal(createResponse.status, 202);

    await waitForFile(path.join(tempDir, "started.txt"));
    await waitForPersistTimer(state);
    await flushUiState(state);
    assert.equal(state.persistTimer, null);

    const storedJob = await waitForStoredJob(jobStorePath, created.job.id, "running");
    assert.equal(storedJob.currentStage.name, "preview");

    await fetch(`${baseUrl}/api/jobs/${created.job.id}/cancel`, { method: "POST" });
    await waitForFile(path.join(tempDir, "terminated.txt"));
    await waitForJob(baseUrl, created.job.id);
  } finally {
    await close(server);
  }
});

test("static file server rejects encoded traversal into sibling directories", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "apple-motion-ui-"));
  const staticRoot = path.join(tempDir, "public");
  const siblingRoot = path.join(tempDir, "public-secret");
  await mkdir(staticRoot);
  await mkdir(siblingRoot);
  await writeFile(path.join(staticRoot, "index.html"), "OK");
  await writeFile(path.join(siblingRoot, "secret.txt"), "sensitive");

  const { server, baseUrl } = await listen(createUiServer({ toolRoot, staticRoot }));
  try {
    const response = await fetch(`${baseUrl}/..%2Fpublic-secret%2Fsecret.txt`);
    const body = await response.text();
    assert.equal(response.status, 403);
    assert.doesNotMatch(body, /sensitive/i);
  } finally {
    await close(server);
  }
});

test("UI shell is served with a restrictive Content Security Policy", async () => {
  const { server, baseUrl } = await listen(createUiServer({ toolRoot }));
  try {
    const response = await fetch(`${baseUrl}/`);
    const html = await response.text();
    const csp = response.headers.get("content-security-policy") ?? "";

    assert.equal(response.status, 200);
    assert.match(csp, /default-src 'self'/);
    assert.match(csp, /script-src 'self'/);
    assert.match(csp, /object-src 'none'/);
    assert.match(csp, /frame-ancestors 'none'/);
    assert.doesNotMatch(csp, /unsafe-eval|unsafe-inline/);
    assert.match(html, /http-equiv="Content-Security-Policy"/);
    assert.doesNotMatch(html, /unsafe-eval|unsafe-inline/);
  } finally {
    await close(server);
  }
});

test("UI server maps malformed static paths to a localized client error", async () => {
  const { server, baseUrl } = await listen(createUiServer({ toolRoot }));
  try {
    const response = await fetch(`${baseUrl}/%E0%A4%A`);
    const payload = await response.json();
    assert.equal(response.status, 400);
    assert.equal(payload.ok, false);
    assert.match(payload.error, /请求路径格式无效/);
    assert.doesNotMatch(payload.error, /URI malformed|decode|%E0%A4%A|\/var\/|\/Users\//);
  } finally {
    await close(server);
  }
});

test("UI rejects cross-site job creation before queueing work", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "apple-motion-ui-"));
  const input = path.join(tempDir, "cover.mov");
  const outDir = path.join(tempDir, "out");
  await writeFile(input, "");

  const { server, baseUrl } = await listen(createUiServer({ toolRoot }));
  try {
    const response = await fetch(`${baseUrl}/api/jobs`, {
      method: "POST",
      headers: {
        "Content-Type": "text/plain",
        "Origin": "https://evil.example",
        "Sec-Fetch-Site": "cross-site"
      },
      body: JSON.stringify({
        input,
        outDir,
        dryRun: true
      })
    });
    const payload = await response.json();
    assert.equal(response.status, 403);
    assert.equal(payload.ok, false);

    const jobsResponse = await fetch(`${baseUrl}/api/jobs`);
    const jobsPayload = await jobsResponse.json();
    assert.deepEqual(jobsPayload.jobs, []);
  } finally {
    await close(server);
  }
});

test("UI rejects cross-site history clearing before mutating jobs", async () => {
  const now = new Date().toISOString();
  const state = createUiState();
  state.jobs.set("finished-job", {
    id: "finished-job",
    status: "planned",
    createdAt: now,
    startedAt: now,
    finishedAt: now,
    total: 1,
    completed: 1,
    passed: 0,
    warnings: 0,
    failed: 0,
    planned: 1,
    current: null,
    logs: [],
    items: []
  });

  const { server, baseUrl } = await listen(createUiServer({ toolRoot, state }));
  try {
    const response = await fetch(`${baseUrl}/api/jobs/history`, {
      method: "DELETE",
      headers: {
        "Origin": "https://evil.example",
        "Sec-Fetch-Site": "cross-site"
      }
    });
    const payload = await response.json();
    assert.equal(response.status, 403);
    assert.equal(payload.ok, false);
    assert.equal(state.jobs.has("finished-job"), true);
  } finally {
    await close(server);
  }
});

test("UI rejects cross-site job reads before exposing local job paths", async () => {
  const state = createUiState();
  state.jobs.set("leaky-job", {
    id: "leaky-job",
    status: "failed",
    createdAt: new Date().toISOString(),
    startedAt: null,
    finishedAt: new Date().toISOString(),
    total: 1,
    completed: 0,
    passed: 0,
    warnings: 0,
    failed: 1,
    planned: 0,
    current: `${privateUserRoot}/private/cover.mov`,
    currentStage: null,
    error: "failed",
    logs: [],
    items: []
  });

  const { server, baseUrl } = await listen(createUiServer({ toolRoot, state }));
  try {
    const response = await fetch(`${baseUrl}/api/jobs`, {
      headers: {
        "Origin": "https://evil.example",
        "Sec-Fetch-Site": "cross-site"
      }
    });
    const raw = await response.text();
    assert.equal(response.status, 403);
    assert.doesNotMatch(raw, /private\/cover\.mov/);
  } finally {
    await close(server);
  }
});

test("UI rejects cross-site generated asset reads before exposing local files", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "apple-motion-ui-"));
  const generatedAsset = path.join(tempDir, "preview.png");
  await writeFile(generatedAsset, "sensitive preview");

  const state = createUiState();
  const assetId = await authorizeGeneratedAsset(state, generatedAsset);
  const { server, baseUrl } = await listen(createUiServer({ toolRoot, state }));
  try {
    const response = await fetch(assetUrl(baseUrl, assetId), {
      headers: {
        "Origin": "https://evil.example",
        "Sec-Fetch-Site": "cross-site"
      }
    });
    const raw = await response.text();
    assert.equal(response.status, 403);
    assert.doesNotMatch(raw, /sensitive preview/i);
  } finally {
    await close(server);
  }
});

test("UI rejects cross-site reveal requests before touching the host shell", async () => {
  const { server, baseUrl } = await listen(createUiServer({ toolRoot }));
  try {
    const response = await fetch(`${baseUrl}/api/reveal`, {
      method: "POST",
      headers: {
        "Content-Type": "text/plain",
        "Origin": "https://evil.example",
        "Sec-Fetch-Site": "cross-site"
      },
      body: JSON.stringify({
        path: "/tmp/should-not-open"
      })
    });
    const payload = await response.json();
    assert.equal(response.status, 403);
    assert.equal(payload.ok, false);
  } finally {
    await close(server);
  }
});

test("UI rejects rebinding-style local control requests before touching the host shell", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "apple-motion-ui-"));
  const generatedAsset = path.join(tempDir, "preview.png");
  await writeFile(generatedAsset, "preview");

  let revealCalled = false;
  const state = createUiState();
  const assetId = await authorizeGeneratedAsset(state, generatedAsset);
  const { server, baseUrl } = await listen(createUiServer({
    toolRoot,
    state,
    revealLauncher: async () => {
      revealCalled = true;
    }
  }));
  try {
    const url = new URL("/api/reveal", baseUrl);
    const body = JSON.stringify({ id: assetId });
    const response = await postRawJson(url, body, {
      "Host": `rebind.test:${url.port}`,
      "Origin": `http://rebind.test:${url.port}`,
      "Sec-Fetch-Site": "same-origin"
    });

    assert.equal(response.status, 403);
    assert.equal(response.payload.ok, false);
    assert.equal(revealCalled, false);
  } finally {
    await close(server);
  }
});

test("UI rejects rebinding-style read requests before exposing local job paths", async () => {
  const state = createUiState();
  state.jobs.set("leaky-job", {
    id: "leaky-job",
    status: "failed",
    createdAt: new Date().toISOString(),
    startedAt: null,
    finishedAt: new Date().toISOString(),
    total: 1,
    completed: 0,
    passed: 0,
    warnings: 0,
    failed: 1,
    planned: 0,
    current: `${privateUserRoot}/private/cover.mov`,
    currentStage: null,
    error: "failed",
    logs: [],
    items: []
  });

  const { server, baseUrl } = await listen(createUiServer({ toolRoot, state }));
  try {
    const url = new URL("/api/jobs", baseUrl);
    const response = await getRawJson(url, {
      "Host": `rebind.test:${url.port}`,
      "Origin": `http://rebind.test:${url.port}`,
      "Sec-Fetch-Site": "same-origin"
    });

    assert.equal(response.status, 403);
    assert.equal(response.payload.ok, false);
    assert.doesNotMatch(response.raw, /private\/cover\.mov/);
  } finally {
    await close(server);
  }
});

test("UI rejects reveal requests for files outside generated assets", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "apple-motion-ui-"));
  const untrustedPath = path.join(tempDir, "not-generated-preview.png");

  const { server, baseUrl } = await listen(createUiServer({ toolRoot }));
  try {
    const response = await fetch(`${baseUrl}/api/reveal`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: "not-generated-asset-id" })
    });
    const payload = await response.json();
    assert.equal(response.status, 403);
    assert.equal(payload.ok, false);
    assert.match(payload.error, /不是当前 UI 会话生成的资产/);
  } finally {
    await close(server);
  }
});

test("UI rejects generated asset paths that are replaced with symlinks outside the output", { skip: process.platform === "win32" }, async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "apple-motion-ui-"));
  const generatedAsset = path.join(tempDir, "preview.png");
  const secretFile = path.join(tempDir, "secret.txt");
  await writeFile(generatedAsset, "preview");
  await writeFile(secretFile, "sensitive token");
  await unlink(generatedAsset);
  await symlink(secretFile, generatedAsset);

  let revealCalled = false;
  const state = createUiState();
  const assetId = authorizeGeneratedAssetPathOnly(state, generatedAsset);
  const { server, baseUrl } = await listen(createUiServer({
    toolRoot,
    state,
    revealLauncher: async () => {
      revealCalled = true;
    }
  }));
  try {
    const assetResponse = await fetch(assetUrl(baseUrl, assetId));
    const assetRaw = await assetResponse.text();
    assert.equal(assetResponse.status, 403);
    const assetPayload = JSON.parse(assetRaw);
    assert.equal(assetPayload.ok, false);
    assert.doesNotMatch(assetRaw, /sensitive token|secret\.txt/i);

    const revealResponse = await fetch(`${baseUrl}/api/reveal`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: assetId })
    });
    const revealRaw = await revealResponse.text();
    assert.equal(revealResponse.status, 403);
    const revealPayload = JSON.parse(revealRaw);
    assert.equal(revealPayload.ok, false);
    assert.equal(revealCalled, false);
    assert.doesNotMatch(revealRaw, /sensitive token|secret\.txt/i);
  } finally {
    await close(server);
  }
});

test("UI rejects generated assets replaced after the authorization check", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "apple-motion-ui-"));
  const generatedAsset = path.join(tempDir, "preview.png");
  const replacementAsset = path.join(tempDir, "replacement.png");
  await writeFile(generatedAsset, "ORIGINAL PREVIEW");
  await writeFile(replacementAsset, "sensitive token");

  let hookCalled = false;
  const state = createUiState();
  const assetId = await authorizeGeneratedAsset(state, generatedAsset);
  const { server, baseUrl } = await listen(createUiServer({
    toolRoot,
    state,
    assetBeforeSendHook: async (requestedPath) => {
      hookCalled = true;
      assert.equal(requestedPath, path.resolve(generatedAsset));
      await rename(replacementAsset, generatedAsset);
    }
  }));
  try {
    const response = await fetch(assetUrl(baseUrl, assetId));
    const raw = await response.text();

    assert.equal(hookCalled, true);
    assert.equal(response.status, 403);
    assert.doesNotMatch(raw, /sensitive token|replacement\.png/i);
  } finally {
    await close(server);
  }
});

test("UI rejects generated assets replaced after the reveal authorization check", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "apple-motion-ui-"));
  const generatedAsset = path.join(tempDir, "preview.png");
  const replacementAsset = path.join(tempDir, "replacement.png");
  await writeFile(generatedAsset, "ORIGINAL PREVIEW");
  await writeFile(replacementAsset, "sensitive token");

  let hookCalled = false;
  let revealCalled = false;
  const state = createUiState();
  const assetId = await authorizeGeneratedAsset(state, generatedAsset);
  const { server, baseUrl } = await listen(createUiServer({
    toolRoot,
    state,
    revealBeforeLaunchHook: async (requestedPath) => {
      hookCalled = true;
      assert.equal(requestedPath, path.resolve(generatedAsset));
      await rename(replacementAsset, generatedAsset);
    },
    revealLauncher: async () => {
      revealCalled = true;
    }
  }));
  try {
    const response = await fetch(`${baseUrl}/api/reveal`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: assetId })
    });
    const raw = await response.text();

    assert.equal(hookCalled, true);
    assert.equal(revealCalled, false);
    assert.equal(response.status, 403);
    assert.doesNotMatch(raw, /sensitive token|replacement\.png/i);
  } finally {
    await close(server);
  }
});

test("UI rejects generated assets rewritten in place after authorization", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "apple-motion-ui-"));
  const generatedAsset = path.join(tempDir, "preview.png");
  await writeFile(generatedAsset, "ORIGINAL PREVIEW");

  let revealCalled = false;
  const state = createUiState();
  const assetId = await authorizeGeneratedAsset(state, generatedAsset);
  await writeFile(generatedAsset, "sensitive after auth");
  const { server, baseUrl } = await listen(createUiServer({
    toolRoot,
    state,
    revealLauncher: async () => {
      revealCalled = true;
    }
  }));
  try {
    const assetResponse = await fetch(assetUrl(baseUrl, assetId));
    const assetRaw = await assetResponse.text();
    assert.equal(assetResponse.status, 403);
    assert.doesNotMatch(assetRaw, /sensitive after auth|preview\.png/i);

    const revealResponse = await fetch(`${baseUrl}/api/reveal`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: assetId })
    });
    const revealRaw = await revealResponse.text();
    assert.equal(revealResponse.status, 403);
    assert.equal(revealCalled, false);
    assert.doesNotMatch(revealRaw, /sensitive after auth|preview\.png/i);
  } finally {
    await close(server);
  }
});

test("UI records item result assets before authorizing them for rebuild safety", async () => {
  const source = await readFile(path.join(toolRoot, "ui", "server.mjs"), "utf8");
  const processIndex = source.indexOf("const result = await processFile(inputPath");
  const summarizeIndex = source.indexOf("item.result = summarizeResult(result, { options: job.options });", processIndex);
  const registerIndex = source.indexOf("item.result.assetIds = await registerGeneratedAssets(state, item.result.assets);", summarizeIndex);
  const statusIndex = source.indexOf("item.status = item.result.status;", registerIndex);

  assert.notEqual(processIndex, -1);
  assert.notEqual(summarizeIndex, -1);
  assert.notEqual(registerIndex, -1);
  assert.notEqual(statusIndex, -1);
  assert.ok(processIndex < summarizeIndex);
  assert.ok(summarizeIndex < registerIndex);
  assert.ok(registerIndex < statusIndex);
});

test("UI reports a missing generated asset as not found when revealing it", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "apple-motion-ui-"));
  const missingGeneratedAsset = path.join(tempDir, "deleted-preview.png");
  const state = createUiState();
  const assetId = authorizeGeneratedAssetPathOnly(state, missingGeneratedAsset);

  const { server, baseUrl } = await listen(createUiServer({ toolRoot, state }));
  try {
    const response = await fetch(`${baseUrl}/api/reveal`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: assetId })
    });
    const payload = await response.json();
    assert.equal(response.status, 404);
    assert.equal(payload.ok, false);
    assert.match(payload.error, /文件不存在/);
  } finally {
    await close(server);
  }
});

test("UI maps inaccessible generated assets to localized reveal errors", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "apple-motion-ui-"));
  const blockedDir = path.join(tempDir, "blocked");
  const blockedAsset = path.join(blockedDir, "preview.png");
  await mkdir(blockedDir);
  await writeFile(blockedAsset, "preview");
  await chmod(blockedDir, 0o000);

  const state = createUiState();
  const assetId = authorizeGeneratedAssetPathOnly(state, blockedAsset);
  const { server, baseUrl } = await listen(createUiServer({ toolRoot, state }));
  try {
    const response = await fetch(`${baseUrl}/api/reveal`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: assetId })
    });
    const payload = await response.json();
    assert.equal(response.status, 500);
    assert.equal(payload.ok, false);
    assert.equal(payload.error, "无法访问要显示的文件。请确认它仍在输出目录且有读取权限。");
    assert.doesNotMatch(payload.error, /EACCES|EPERM|blocked|preview\.png|\/var\/|\/Users\//);
  } finally {
    await chmod(blockedDir, 0o700).catch(() => {});
    await close(server);
  }
});

test("UI reveal maps launcher startup failures to localized errors", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "apple-motion-ui-"));
  const generatedAsset = path.join(tempDir, "preview.png");
  await writeFile(generatedAsset, "preview");

  const state = createUiState();
  const assetId = await authorizeGeneratedAsset(state, generatedAsset);
  const { server, baseUrl } = await listen(createUiServer({
    toolRoot,
    state,
    revealLauncher: async () => {
      const error = new Error(`spawn ENOENT ${privateUserRoot}/private-fixture`);
      error.code = "ENOENT";
      throw error;
    }
  }));
  try {
    const response = await fetch(`${baseUrl}/api/reveal`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: assetId })
    });
    const payload = await response.json();
    assert.equal(response.status, 500);
    assert.equal(payload.ok, false);
    assert.equal(payload.error, "无法打开系统文件管理器。请在输出目录中手动查看文件。");
    assert.doesNotMatch(payload.error, /ENOENT|spawn|\/Users\//);
  } finally {
    await close(server);
  }
});

test("UI reveal launcher diagnostics redact raw local paths in server logs", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "apple-motion-ui-"));
  const generatedAsset = path.join(tempDir, "preview.png");
  await writeFile(generatedAsset, "preview");

  const state = createUiState();
  const assetId = await authorizeGeneratedAsset(state, generatedAsset);
  const { server, baseUrl } = await listen(createUiServer({
    toolRoot,
    state,
    revealLauncher: async () => {
      const error = new Error(`spawn ENOENT ${privateUserRoot}/.private-fixture/tool-bin`);
      error.code = "ENOENT";
      throw error;
    }
  }));
  try {
    const logs = await captureConsoleErrors(async () => {
      const response = await fetch(`${baseUrl}/api/reveal`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: assetId })
      });
      assert.equal(response.status, 500);
    });
    const joined = logs.join("\n");
    assert.match(joined, /无法打开系统文件管理器/);
    assert.doesNotMatch(joined, /\/Users\/will|\.private-fixture|tool-bin|spawn|ENOENT|node:|\.mjs:\d+|Error:/);
  } finally {
    await close(server);
  }
});

test("UI reveal reports file manager commands that exit unsuccessfully", { skip: process.platform === "win32" }, async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "apple-motion-ui-"));
  const generatedAsset = path.join(tempDir, "preview.png");
  await writeFile(generatedAsset, "preview");

  const launcherName = process.platform === "darwin" ? "open" : "xdg-open";
  const launcherPath = path.join(tempDir, launcherName);
  await writeFile(launcherPath, `#!/bin/sh
exit 42
`);
  await chmod(launcherPath, 0o755);

  const previousPath = process.env.PATH;
  process.env.PATH = `${tempDir}${path.delimiter}${previousPath ?? ""}`;
  const state = createUiState();
  const assetId = await authorizeGeneratedAsset(state, generatedAsset);
  const { server, baseUrl } = await listen(createUiServer({ toolRoot, state }));
  try {
    const response = await fetch(`${baseUrl}/api/reveal`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: assetId })
    });
    const payload = await response.json();
    assert.equal(response.status, 500);
    assert.equal(payload.ok, false);
    assert.equal(payload.error, "无法打开系统文件管理器。请在输出目录中手动查看文件。");
    assert.doesNotMatch(payload.error, /exit 42|open|xdg-open|\/var\/|\/Users\//);
  } finally {
    if (previousPath === undefined) delete process.env.PATH;
    else process.env.PATH = previousPath;
    await close(server);
  }
});

test("UI asset endpoint sanitizes inaccessible generated asset read errors", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "apple-motion-ui-"));
  const blockedDir = path.join(tempDir, "blocked-asset");
  const blockedAsset = path.join(blockedDir, "preview.png");
  await mkdir(blockedDir);
  await writeFile(blockedAsset, "preview");
  await chmod(blockedDir, 0o000);

  const state = createUiState();
  const assetId = authorizeGeneratedAssetPathOnly(state, blockedAsset);
  const { server, baseUrl } = await listen(createUiServer({ toolRoot, state }));
  try {
    const response = await fetch(assetUrl(baseUrl, assetId));
    const payload = await response.json();
    assert.equal(response.status, 500);
    assert.equal(payload.ok, false);
    assert.equal(payload.error, "无法读取文件。请确认文件仍在输出目录且有读取权限。");
    assert.doesNotMatch(payload.error, /EACCES|EPERM|blocked-asset|preview\.png|\/var\/|\/Users\//);
  } finally {
    await chmod(blockedDir, 0o700).catch(() => {});
    await close(server);
  }
});

test("UI asset endpoint uses opaque asset ids instead of local paths", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "apple-motion-ui-"));
  const generatedAsset = path.join(tempDir, ".private-fixture", "preview.png");
  await mkdir(path.dirname(generatedAsset), { recursive: true });
  await writeFile(generatedAsset, "PREVIEW");

  const state = createUiState();
  const assetId = await authorizeGeneratedAsset(state, generatedAsset);
  const { server, baseUrl } = await listen(createUiServer({ toolRoot, state }));
  try {
    assert.equal(typeof assetId, "string");
    assert.doesNotMatch(assetId, /\/|\\|\.private-fixture|preview\.png/);

    const idResponse = await fetch(`${baseUrl}/api/asset?id=${encodeURIComponent(assetId)}`);
    assert.equal(idResponse.status, 200);
    assert.equal(await idResponse.text(), "PREVIEW");

    const pathResponse = await fetch(`${baseUrl}/api/asset?path=${encodeURIComponent(generatedAsset)}`);
    const pathPayload = await pathResponse.json();
    assert.equal(pathResponse.status, 400);
    assert.equal(pathPayload.ok, false);
    assert.doesNotMatch(JSON.stringify(pathPayload), /\/Users|\.private-fixture|preview\.png/);
  } finally {
    await close(server);
  }
});

test("UI asset endpoint sandboxes generated HTML reports", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "apple-motion-ui-"));
  const reportHtml = path.join(tempDir, "cover__apple-motion-qc.html");
  await writeFile(reportHtml, "<!doctype html><script>fetch('/api/jobs')</script>");

  const state = createUiState();
  const assetId = await authorizeGeneratedAsset(state, reportHtml);
  const { server, baseUrl } = await listen(createUiServer({ toolRoot, state }));
  try {
    const response = await fetch(assetUrl(baseUrl, assetId));

    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type") ?? "", /text\/html/);
    assert.match(response.headers.get("content-security-policy") ?? "", /\bsandbox\b/);
    assert.match(response.headers.get("content-security-policy") ?? "", /default-src 'none'/);
    assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  } finally {
    await close(server);
  }
});

test("UI file streaming handles read errors instead of emitting unhandled stream errors", async () => {
  const source = await readFile(path.join(toolRoot, "ui", "server.mjs"), "utf8");
  const sendFileIndex = source.indexOf("async function sendFile(filePath, response");
  const streamIndex = source.indexOf("const stream = fileHandle", sendFileIndex);
  const fileHandleStreamIndex = source.indexOf("fileHandle.createReadStream", streamIndex);
  const pathStreamIndex = source.indexOf("createReadStream(filePath)", streamIndex);
  const cleanupIndex = source.indexOf("const cleanupStream = () => stream.destroy();", streamIndex);
  const responseCloseIndex = source.indexOf("response.once(\"close\", cleanupStream);", cleanupIndex);
  const responseErrorIndex = source.indexOf("response.once(\"error\", cleanupStream);", cleanupIndex);
  const errorHandlerIndex = source.indexOf("stream.on(\"error\"", streamIndex);
  const headersGuardIndex = source.indexOf("if (!response.headersSent)", errorHandlerIndex);
  const destroyIndex = source.indexOf("response.destroy(error);", errorHandlerIndex);
  const detachIndex = source.indexOf("stream.once(\"close\", detachResponseCleanup);", errorHandlerIndex);
  const startStreamingIndex = source.indexOf("const startStreaming = () => {", detachIndex);
  const fileHandleBranchIndex = source.indexOf("if (fileHandle) {", startStreamingIndex);
  const pathOpenIndex = source.indexOf("stream.on(\"open\", startStreaming);", fileHandleBranchIndex);

  assert.notEqual(sendFileIndex, -1);
  assert.notEqual(streamIndex, -1);
  assert.notEqual(fileHandleStreamIndex, -1);
  assert.notEqual(pathStreamIndex, -1);
  assert.notEqual(cleanupIndex, -1);
  assert.notEqual(responseCloseIndex, -1);
  assert.notEqual(responseErrorIndex, -1);
  assert.notEqual(errorHandlerIndex, -1);
  assert.notEqual(headersGuardIndex, -1);
  assert.notEqual(destroyIndex, -1);
  assert.notEqual(detachIndex, -1);
  assert.notEqual(startStreamingIndex, -1);
  assert.notEqual(fileHandleBranchIndex, -1);
  assert.notEqual(pathOpenIndex, -1);
  assert.ok(streamIndex < cleanupIndex);
  assert.ok(cleanupIndex < errorHandlerIndex);
  assert.ok(streamIndex < errorHandlerIndex);
  assert.ok(detachIndex < startStreamingIndex);
  assert.ok(startStreamingIndex < fileHandleBranchIndex);
  assert.ok(fileHandleBranchIndex < pathOpenIndex);
});

test("UI rejects a missing input path before queueing a job", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "apple-motion-ui-"));
  const missingInput = path.join(tempDir, "missing.mov");
  const outDir = path.join(tempDir, "out");

  const { server, baseUrl } = await listen(createUiServer({ toolRoot }));
  try {
    const response = await fetch(`${baseUrl}/api/jobs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        input: missingInput,
        outDir,
        dryRun: true
      })
    });
    const payload = await response.json();
    assert.equal(response.status, 400);
    assert.equal(payload.ok, false);
    assert.match(payload.error, /输入路径不可读取或不存在/);
    assert.match(payload.error, /missing\.mov/);
    assert.equal(payload.error.includes(tempDir), false);
    assert.doesNotMatch(payload.error, /\/private\/var\/|\/var\/|\/Users\//);

    const jobsResponse = await fetch(`${baseUrl}/api/jobs`);
    const jobsPayload = await jobsResponse.json();
    assert.deepEqual(jobsPayload.jobs, []);
  } finally {
    await close(server);
  }
});

test("UI rejects a folder with no video files before queueing a job", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "apple-motion-ui-"));
  const inputDir = path.join(tempDir, "covers");
  const outDir = path.join(tempDir, "out");
  await mkdir(inputDir);
  await writeFile(path.join(inputDir, "notes.txt"), "not a video");

  const { server, baseUrl } = await listen(createUiServer({ toolRoot }));
  try {
    const response = await fetch(`${baseUrl}/api/jobs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        input: inputDir,
        outDir,
        dryRun: true
      })
    });
    const payload = await response.json();
    assert.equal(response.status, 400);
    assert.equal(payload.ok, false);
    assert.match(payload.error, /没有找到 \.mov、\.mp4 或 \.m4v 文件/);
    assert.match(payload.error, /covers/);
    assert.equal(payload.error.includes(tempDir), false);
    assert.doesNotMatch(payload.error, /\/private\/var\/|\/var\/|\/Users\//);

    const jobsResponse = await fetch(`${baseUrl}/api/jobs`);
    const jobsPayload = await jobsResponse.json();
    assert.deepEqual(jobsPayload.jobs, []);
  } finally {
    await close(server);
  }
});

test("UI rejects existing outputs before queueing when overwrite is disabled", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "apple-motion-ui-"));
  const input = path.join(tempDir, "cover.mov");
  const outDir = path.join(tempDir, "out");
  const existingPreview = path.join(outDir, "cover__apple-motion-3x4-preview.png");
  await mkdir(outDir, { recursive: true });
  await writeFile(input, "");
  await writeFile(existingPreview, "KEEP");

  const { server, baseUrl } = await listen(createUiServer({ toolRoot }));
  try {
    const response = await fetch(`${baseUrl}/api/jobs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        input,
        outDir,
        previewOnly: true,
        overwrite: false
      })
    });
    const payload = await response.json();
    assert.equal(response.status, 409);
    assert.equal(payload.ok, false);
    assert.match(payload.error, /输出文件已存在/);
    assert.doesNotMatch(payload.error, /Output already exists|Use --overwrite/);
    assert.equal(payload.error.includes(existingPreview), false);
    assert.doesNotMatch(payload.error, /\/var\/|\/Users\//);
    assert.equal(await readFile(existingPreview, "utf8"), "KEEP");

    const jobsResponse = await fetch(`${baseUrl}/api/jobs`);
    const jobsPayload = await jobsResponse.json();
    assert.deepEqual(jobsPayload.jobs, []);
  } finally {
    await close(server);
  }
});

test("UI requires exact replacement confirmation before overwrite jobs", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "apple-motion-ui-"));
  const input = path.join(tempDir, "cover.mov");
  const outDir = path.join(tempDir, "out");
  const existingPreview = path.join(outDir, "cover__apple-motion-3x4-preview.png");
  const fakeFfmpeg = await writeFakeOutputFfmpeg(tempDir);
  const fakeFfprobe = await writeFakeCompliantFfprobe(tempDir);
  await mkdir(outDir, { recursive: true });
  await writeFile(input, "");
  await writeFile(existingPreview, "KEEP");

  const { server, baseUrl } = await listen(createUiServer({ toolRoot }));
  try {
    const firstResponse = await fetch(`${baseUrl}/api/jobs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        input,
        outDir,
        previewOnly: true,
        overwrite: true,
        ffmpegPath: fakeFfmpeg,
        ffprobePath: fakeFfprobe
      })
    });
    const firstPayload = await firstResponse.json();
    assert.equal(firstResponse.status, 409);
    assert.equal(firstPayload.ok, false);
    assert.match(firstPayload.error, /确认覆盖已有输出/);
    assert.equal(firstPayload.overwriteConfirmation.required, true);
    assert.equal(firstPayload.overwriteConfirmation.count, 1);
    assert.deepEqual(firstPayload.overwriteConfirmation.replacements, [path.basename(existingPreview)]);
    assert.equal(JSON.stringify(firstPayload.overwriteConfirmation).includes(existingPreview), false);
    assert.doesNotMatch(JSON.stringify(firstPayload.overwriteConfirmation), /\/var\/|\/Users\//);
    assert.match(firstPayload.overwriteConfirmation.token, /^[0-9a-f-]{36}$/i);
    assert.equal(await readFile(existingPreview, "utf8"), "KEEP");

    const jobsResponse = await fetch(`${baseUrl}/api/jobs`);
    const jobsPayload = await jobsResponse.json();
    assert.deepEqual(jobsPayload.jobs, []);

    const secondResponse = await fetch(`${baseUrl}/api/jobs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        input,
        outDir,
        previewOnly: true,
        overwrite: true,
        overwriteConfirmationToken: firstPayload.overwriteConfirmation.token,
        ffmpegPath: fakeFfmpeg,
        ffprobePath: fakeFfprobe
      })
    });
    const secondPayload = await secondResponse.json();
    assert.equal(secondResponse.status, 202);
    assert.equal(secondPayload.ok, true);
    const job = await waitForJob(baseUrl, secondPayload.job.id);
    assert.equal(job.status, "previewed");
  } finally {
    await close(server);
  }
});

test("UI caps pending overwrite confirmations while preserving the latest token", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "apple-motion-ui-"));
  const input = path.join(tempDir, "cover.mov");
  const outDir = path.join(tempDir, "out");
  const existingPreview = path.join(outDir, "cover__apple-motion-3x4-preview.png");
  const fakeFfmpeg = await writeFakeOutputFfmpeg(tempDir);
  const fakeFfprobe = await writeFakeCompliantFfprobe(tempDir);
  await mkdir(outDir, { recursive: true });
  await writeFile(input, "");
  await writeFile(existingPreview, "KEEP");

  const state = createUiState();
  const { server, baseUrl } = await listen(createUiServer({ toolRoot, state }));
  try {
    const tokens = [];
    for (let index = 0; index < 55; index += 1) {
      const response = await fetch(`${baseUrl}/api/jobs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          input,
          outDir,
          previewOnly: true,
          overwrite: true,
          ffmpegPath: fakeFfmpeg,
          ffprobePath: fakeFfprobe
        })
      });
      const payload = await response.json();
      assert.equal(response.status, 409);
      tokens.push(payload.overwriteConfirmation.token);
    }

    assert.equal(state.overwriteConfirmations.size, 50);

    const staleResponse = await fetch(`${baseUrl}/api/jobs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        input,
        outDir,
        previewOnly: true,
        overwrite: true,
        overwriteConfirmationToken: tokens[0],
        ffmpegPath: fakeFfmpeg,
        ffprobePath: fakeFfprobe
      })
    });
    const stalePayload = await staleResponse.json();
    assert.equal(staleResponse.status, 409);
    assert.equal(stalePayload.overwriteConfirmation.required, true);

    const createResponse = await fetch(`${baseUrl}/api/jobs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        input,
        outDir,
        previewOnly: true,
        overwrite: true,
        overwriteConfirmationToken: tokens.at(-1),
        ffmpegPath: fakeFfmpeg,
        ffprobePath: fakeFfprobe
      })
    });
    const createPayload = await createResponse.json();
    assert.equal(createResponse.status, 202);
    assert.equal(createPayload.ok, true);
    const job = await waitForJob(baseUrl, createPayload.job.id);
    assert.equal(job.status, "previewed");
  } finally {
    await close(server);
  }
});

test("UI rejects output path occupied by a directory before overwrite confirmation", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "apple-motion-ui-"));
  const input = path.join(tempDir, "cover.mov");
  const outDir = path.join(tempDir, "out");
  const blockedPreview = path.join(outDir, "cover__apple-motion-3x4-preview.png");
  const fakeFfmpeg = await writeFakeOutputFfmpeg(tempDir);
  const fakeFfprobe = await writeFakeCompliantFfprobe(tempDir);
  await mkdir(blockedPreview, { recursive: true });
  await writeFile(input, "");

  const { server, baseUrl } = await listen(createUiServer({ toolRoot }));
  try {
    const response = await fetch(`${baseUrl}/api/jobs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        input,
        outDir,
        previewOnly: true,
        overwrite: true,
        ffmpegPath: fakeFfmpeg,
        ffprobePath: fakeFfprobe
      })
    });
    const payload = await response.json();

    assert.equal(response.status, 409);
    assert.equal(payload.ok, false);
    assert.match(payload.error, /输出目标路径已被文件夹占用/);
    assert.match(payload.error, /cover__apple-motion-3x4-preview\.png/);
    assert.equal("overwriteConfirmation" in payload, false);
    assert.doesNotMatch(JSON.stringify(payload), /Output path is not a file|cannot be overwritten|apple-motion-ui-|\/var\/|\/Users\//i);

    const jobsResponse = await fetch(`${baseUrl}/api/jobs`);
    const jobsPayload = await jobsResponse.json();
    assert.deepEqual(jobsPayload.jobs, []);
  } finally {
    await close(server);
  }
});

test("UI rejects an output path that is an existing file before queueing", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "apple-motion-ui-"));
  const input = path.join(tempDir, "cover.mov");
  const outDir = path.join(tempDir, "not-a-directory");
  await writeFile(input, "");
  await writeFile(outDir, "not a folder");

  const { server, baseUrl } = await listen(createUiServer({ toolRoot }));
  try {
    const response = await fetch(`${baseUrl}/api/jobs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        input,
        outDir,
        dryRun: true
      })
    });
    const payload = await response.json();
    assert.equal(response.status, 400);
    assert.equal(payload.ok, false);
    assert.match(payload.error, /输出文件夹路径不是文件夹/);
    assert.match(payload.error, /not-a-directory/);
    assert.doesNotMatch(payload.error, /\/var\/|\/Users\//);

    const jobsResponse = await fetch(`${baseUrl}/api/jobs`);
    const jobsPayload = await jobsResponse.json();
    assert.deepEqual(jobsPayload.jobs, []);
  } finally {
    await close(server);
  }
});

test("UI rejects uncreatable missing output directories before queueing work", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "apple-motion-ui-"));
  const input = path.join(tempDir, "cover.mov");
  const blockedParent = path.join(tempDir, "locked-parent");
  const outDir = path.join(blockedParent, "out");
  await writeFile(input, "");
  await mkdir(blockedParent);
  await chmod(blockedParent, 0o500);

  const { server, baseUrl } = await listen(createUiServer({ toolRoot }));
  try {
    const response = await fetch(`${baseUrl}/api/jobs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        input,
        outDir,
        previewOnly: true,
        encoder: "x264"
      })
    });
    const payload = await response.json();
    assert.equal(response.status, 400);
    assert.equal(payload.ok, false);
    assert.match(payload.error, /输出文件夹无法创建/);
    assert.doesNotMatch(payload.error, /ENOTDIR|EEXIST|blocks mkdir|\/var\/|\/Users\//);

    const jobsResponse = await fetch(`${baseUrl}/api/jobs`);
    const jobsPayload = await jobsResponse.json();
    assert.deepEqual(jobsPayload.jobs, []);
  } finally {
    await chmod(blockedParent, 0o700).catch(() => {});
    await close(server);
  }
});

test("UI rejects inaccessible existing output directories before queueing work", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "apple-motion-ui-"));
  const input = path.join(tempDir, "cover.mov");
  const outDir = path.join(tempDir, "blocked-out");
  await writeFile(input, "");
  await mkdir(outDir);
  await chmod(outDir, 0o000);

  const { server, baseUrl } = await listen(createUiServer({ toolRoot }));
  try {
    const response = await fetch(`${baseUrl}/api/jobs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        input,
        outDir,
        previewOnly: true,
        encoder: "x264"
      })
    });
    const payload = await response.json();
    assert.equal(response.status, 400);
    assert.equal(payload.ok, false);
    assert.match(payload.error, /输出文件夹不可访问/);
    assert.doesNotMatch(payload.error, /EACCES|EPERM|scandir|blocked-out|\/var\/|\/Users\//);

    const jobsResponse = await fetch(`${baseUrl}/api/jobs`);
    const jobsPayload = await jobsResponse.json();
    assert.deepEqual(jobsPayload.jobs, []);
  } finally {
    await chmod(outDir, 0o700).catch(() => {});
    await close(server);
  }
});

test("UI rejects using the same folder for input and output before queueing", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "apple-motion-ui-"));
  const input = path.join(tempDir, "cover.mov");
  await writeFile(input, "");

  const { server, baseUrl } = await listen(createUiServer({ toolRoot }));
  try {
    const response = await fetch(`${baseUrl}/api/jobs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        input: tempDir,
        outDir: tempDir,
        dryRun: true
      })
    });
    const payload = await response.json();
    assert.equal(response.status, 400);
    assert.equal(payload.ok, false);
    assert.match(payload.error, /输出文件夹不能和输入文件夹相同/);
    assert.doesNotMatch(payload.error, /apple-motion-ui-|\/var\/|\/Users\//);

    const jobsResponse = await fetch(`${baseUrl}/api/jobs`);
    const jobsPayload = await jobsResponse.json();
    assert.deepEqual(jobsPayload.jobs, []);
  } finally {
    await close(server);
  }
});

test("UI rejects symlinked output directories that resolve to the input folder before queueing", { skip: process.platform === "win32" }, async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "apple-motion-ui-"));
  const inputDir = path.join(tempDir, "covers");
  const outLink = path.join(tempDir, "out-link");
  await mkdir(inputDir);
  await writeFile(path.join(inputDir, "cover.mov"), "");
  await symlink(inputDir, outLink, "dir");

  const { server, baseUrl } = await listen(createUiServer({ toolRoot }));
  try {
    const response = await fetch(`${baseUrl}/api/jobs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        input: inputDir,
        outDir: outLink,
        dryRun: true
      })
    });
    const payload = await response.json();
    assert.equal(response.status, 400);
    assert.equal(payload.ok, false);
    assert.match(payload.error, /输出文件夹不能和输入文件夹相同/);
    assert.doesNotMatch(payload.error, /apple-motion-ui-|out-link|\/var\/|\/Users\//);

    const jobsResponse = await fetch(`${baseUrl}/api/jobs`);
    const jobsPayload = await jobsResponse.json();
    assert.deepEqual(jobsPayload.jobs, []);
  } finally {
    await close(server);
  }
});

test("UI rejects output path collisions before queueing a folder job", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "apple-motion-ui-"));
  const inputA = path.join(tempDir, "album-a", "cover.mov");
  const inputB = path.join(tempDir, "album-b", "cover.mov");
  const outDir = path.join(tempDir, "out");
  await mkdir(path.dirname(inputA), { recursive: true });
  await mkdir(path.dirname(inputB), { recursive: true });
  await writeFile(inputA, "");
  await writeFile(inputB, "");

  const { server, baseUrl } = await listen(createUiServer({ toolRoot }));
  try {
    const response = await fetch(`${baseUrl}/api/jobs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        input: tempDir,
        outDir,
        dryRun: true,
        encoder: "x264"
      })
    });
    const payload = await response.json();
    assert.equal(response.status, 409);
    assert.equal(payload.ok, false);
    assert.match(payload.error, /输出路径冲突/);
    assert.doesNotMatch(payload.error, /Output path collision|Rename one input file/);
    assert.equal(payload.error.includes(tempDir), false);
    assert.doesNotMatch(payload.error, /\/var\/|\/Users\//);

    const jobsResponse = await fetch(`${baseUrl}/api/jobs`);
    const jobsPayload = await jobsResponse.json();
    assert.deepEqual(jobsPayload.jobs, []);
  } finally {
    await close(server);
  }
});

test("UI sanitizes corrupt output transaction recovery failures before queueing work", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "apple-motion-ui-"));
  const input = path.join(tempDir, "cover.mov");
  const outDir = path.join(tempDir, "out");
  const journal = path.join(outDir, ".openfad-motion-transaction.broken.json");
  await writeFile(input, "");
  await mkdir(outDir);
  await writeFile(journal, "{ not valid json");

  const { server, baseUrl } = await listen(createUiServer({ toolRoot }));
  try {
    const response = await fetch(`${baseUrl}/api/jobs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        input,
        outDir,
        previewOnly: true
      })
    });
    const payload = await response.json();
    assert.equal(response.status, 409);
    assert.equal(payload.ok, false);
    assert.match(payload.error, /无法恢复上次中断的输出写入记录/);
    assert.doesNotMatch(payload.error, /Could not read|output transaction|journal|broken|\.openfad-motion|not valid|JSON|\/var\/|\/Users\//i);

    const jobsResponse = await fetch(`${baseUrl}/api/jobs`);
    const jobsPayload = await jobsResponse.json();
    assert.deepEqual(jobsPayload.jobs, []);
  } finally {
    await close(server);
  }
});

test("UI sanitizes unsafe standalone rollback recovery failures before queueing work", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "apple-motion-ui-"));
  const input = path.join(tempDir, "cover.mov");
  const outDir = path.join(tempDir, "out");
  const final = path.join(outDir, "cover__apple-motion-3x4-preview.png");
  const token = "stale";
  const journal = path.join(outDir, `.openfad-motion-transaction.${token}.json`);
  const temp = path.join(outDir, `.${path.basename(final)}.${token}.tmp`);
  const backup = path.join(outDir, `.${path.basename(final)}.${token}.bak`);
  await writeFile(input, "");
  await mkdir(outDir);
  await writeFile(final, "new final without rollback backup");
  await writeFile(temp, "stale temp");
  await writeFile(journal, JSON.stringify({
    version: 1,
    owner: "openfad-motion-batch",
    token,
    updatedAt: "2000-01-01T00:00:00.000Z",
    final,
    temp,
    backup,
    hadExistingFinal: true,
    phase: "final-replaced",
    finalized: false
  }));

  const { server, baseUrl } = await listen(createUiServer({ toolRoot }));
  try {
    const response = await fetch(`${baseUrl}/api/jobs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        input,
        outDir,
        previewOnly: true
      })
    });
    const payload = await response.json();
    assert.equal(response.status, 409);
    assert.equal(payload.ok, false);
    assert.match(payload.error, /无法恢复上次中断的输出写入记录/);
    assert.doesNotMatch(payload.error, /Cannot safely|output transaction|journal|backup|cover__apple-motion|\.openfad-motion|\/var\/|\/Users\//i);
    assert.equal(await readFile(final, "utf8"), "new final without rollback backup");

    const jobsResponse = await fetch(`${baseUrl}/api/jobs`);
    const jobsPayload = await jobsResponse.json();
    assert.deepEqual(jobsPayload.jobs, []);
  } finally {
    await close(server);
  }
});

test("UI server runs a dry-run job without requiring FFmpeg", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "apple-motion-ui-"));
  const input = path.join(tempDir, "cover.mov");
  const outDir = path.join(tempDir, "out");
  await writeFile(input, "");

  const { server, baseUrl } = await listen(createUiServer({ toolRoot }));
  try {
    const createResponse = await fetch(`${baseUrl}/api/jobs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        input,
        outDir,
        dryRun: true,
        encoder: "x264",
        container: "mp4",
        mode: "scale-fill"
      })
    });
    const created = await createResponse.json();
    assert.equal(createResponse.status, 202);
    assert.equal(created.ok, true);

    const job = await waitForJob(baseUrl, created.job.id);
    assert.equal(job.status, "planned");
    assert.equal(job.total, 1);
    assert.equal(job.planned, 1);
    assert.equal(job.currentId, null);
    assert.equal(job.currentLabel, null);
    assert.equal(job.items[0].status, "planned");
    assert.equal(job.items[0].inputId, "item-0");
    assert.equal(job.items[0].inputLabel, "cover.mov");
    assert.deepEqual(job.items[0].result.assets, {});
    const logText = job.logs.map((entry) => entry.message).join("\n");
    assert.match(logText, /cover\.mov/);
    assert.doesNotMatch(logText, new RegExp(escapeRegExp(tempDir)));
    assert.doesNotMatch(logText, /\/var\/|\/Users\//);

    const fullJob = await getFullJob(baseUrl, created.job.id);
    assert.equal(fullJob.items[0].result.inputLabel, "cover.mov");
    assert.equal(fullJob.items[0].result.inputId, "item-0");
    assert.equal(fullJob.items[0].result.outputPlan.preview, "预览");
    assert.doesNotMatch(JSON.stringify(fullJob), new RegExp(escapeRegExp(tempDir)));
    assert.equal("commands" in fullJob.items[0].result, false);
    await assert.rejects(() => access(outDir), (error) => error.code === "ENOENT");
  } finally {
    await close(server);
  }
});

test("UI trims live job items while preserving item history offsets", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "apple-motion-ui-"));
  const inputDir = path.join(tempDir, "covers");
  const outDir = path.join(tempDir, "out");
  await mkdir(inputDir);
  for (let index = 0; index < 205; index += 1) {
    await writeFile(path.join(inputDir, `cover-${String(index).padStart(3, "0")}.mov`), "");
  }

  const state = createUiState();
  const { server, baseUrl } = await listen(createUiServer({ toolRoot, state }));
  try {
    const createResponse = await fetch(`${baseUrl}/api/jobs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        input: inputDir,
        outDir,
        dryRun: true,
        encoder: "x264",
        container: "mp4",
        mode: "scale-fill"
      })
    });
    const created = await createResponse.json();
    assert.equal(createResponse.status, 202);

    const job = await waitForJob(baseUrl, created.job.id);
    const retainedJob = state.jobs.get(created.job.id);
    assert.equal(job.status, "planned");
    assert.equal(job.total, 205);
    assert.equal(retainedJob.items.length, 200);
    assert.equal(retainedJob.itemsOffset, 5);
    assert.equal(retainedJob.totalItems, 205);
    assert.equal(retainedJob.items[0].inputPath.endsWith("cover-005.mov"), true);

    const fullJob = await getFullJob(baseUrl, created.job.id);
    assert.equal(fullJob.items.length, 200);
    assert.equal(fullJob.itemsOffset, 5);
    assert.equal(fullJob.totalItems, 205);
    assert.equal(fullJob.items[0].inputLabel, "cover-005.mov");
  } finally {
    await close(server);
  }
});

test("UI trims asset authorization maps with non-dry-run live job items", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "apple-motion-ui-"));
  const inputDir = path.join(tempDir, "covers");
  const outDir = path.join(tempDir, "out");
  const fakeFfmpeg = await writeFakeOutputFfmpeg(tempDir);
  const fakeFfprobe = await writeFakeCompliantFfprobe(tempDir);
  await mkdir(inputDir);
  for (let index = 0; index < 3; index += 1) {
    await writeFile(path.join(inputDir, `cover-${String(index).padStart(3, "0")}.mov`), "");
  }

  const state = createUiState({ storedItemsLimit: 2 });
  const { server, baseUrl } = await listen(createUiServer({ toolRoot, state }));
  try {
    const created = await createPreviewJob(baseUrl, {
      input: inputDir,
      outDir,
      ffmpegPath: fakeFfmpeg,
      ffprobePath: fakeFfprobe
    });
    const job = await waitForJob(baseUrl, created.job.id);
    assert.equal(job.status, "previewed");
    assert.equal(job.total, 3);

    const firstPreview = buildOutputPlan({
      inputPath: path.join(inputDir, "cover-000.mov"),
      outDir,
      container: "mp4"
    }).preview;
    assert.equal(state.allowedAssetIds.has(path.resolve(firstPreview)), false);
    assert.equal(state.allowedAssetFingerprints.has(path.resolve(firstPreview)), false);
    assert.equal(state.allowedAssetPaths.size, 2);

    const fullJob = await getFullJob(baseUrl, created.job.id);
    assert.equal(fullJob.items.length, 2);
    assert.equal(fullJob.itemsOffset, 1);
    assert.equal(fullJob.totalItems, 3);
    assert.equal(fullJob.items[0].inputLabel, "cover-001.mov");

    const retainedPreviewAssetId = fullJob.items[0].result.assetIds.preview;
    assert.equal(typeof retainedPreviewAssetId, "string");
    const retainedAssetResponse = await fetch(assetUrl(baseUrl, retainedPreviewAssetId));
    assert.equal(retainedAssetResponse.status, 200);
  } finally {
    await close(server);
  }
});

test("UI does not authorize assets for live job items trimmed to zero retention", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "apple-motion-ui-"));
  const input = path.join(tempDir, "cover.mov");
  const outDir = path.join(tempDir, "out");
  const fakeFfmpeg = await writeFakeOutputFfmpeg(tempDir);
  const fakeFfprobe = await writeFakeCompliantFfprobe(tempDir);
  await writeFile(input, "");

  const state = createUiState({ storedItemsLimit: 0 });
  const { server, baseUrl } = await listen(createUiServer({ toolRoot, state }));
  try {
    const created = await createPreviewJob(baseUrl, {
      input,
      outDir,
      ffmpegPath: fakeFfmpeg,
      ffprobePath: fakeFfprobe
    });
    const job = await waitForJob(baseUrl, created.job.id);
    assert.equal(job.status, "previewed");
    assert.equal(job.items.length, 0);

    const previewPath = buildOutputPlan({
      inputPath: input,
      outDir,
      container: "mp4"
    }).preview;
    const staleAssetId = state.allowedAssetIds.get(path.resolve(previewPath));
    assert.equal(staleAssetId, undefined);
    assert.equal(state.allowedAssetPaths.size, 0);
    assert.equal(state.allowedAssetFingerprints.size, 0);
  } finally {
    await close(server);
  }
});

test("UI poll and detail endpoints return bounded lightweight job snapshots by default", async () => {
  const state = createUiState();
  const job = createFakeLargeJob();
  state.jobs.set(job.id, job);

  const { server, baseUrl } = await listen(createUiServer({ toolRoot, state }));
  try {
    const pollResponse = await fetch(`${baseUrl}/api/jobs/${job.id}/poll`);
    const pollPayload = await pollResponse.json();
    assert.equal(pollResponse.status, 200);
    assert.equal(pollPayload.ok, true);
    assert.equal(pollPayload.job.itemsOffset, 10);
    assert.equal(pollPayload.job.totalItems, 60);
    assert.equal(pollPayload.job.itemsLimit, 50);
    assert.equal(pollPayload.job.items.length, 50);
    assert.equal(pollPayload.job.currentId, "item-59");
    assert.equal(pollPayload.job.currentLabel, "cover-59.mov");
    assert.equal(pollPayload.job.items[0].inputId, "item-10");
    assert.equal(pollPayload.job.items[0].inputLabel, "cover-10.mov");
    assert.equal(pollPayload.job.items.at(-1).inputId, "item-59");
    assert.equal(pollPayload.job.items.at(-1).inputLabel, "cover-59.mov");
    assert.equal("commands" in pollPayload.job.items[0].result, false);
    assert.equal("report" in pollPayload.job.items[0].result, false);
    assert.equal(pollPayload.job.items[0].result.inputId, "item-10");
    assert.equal(pollPayload.job.items[0].result.inputLabel, "cover-10.mov");
    assert.deepEqual(pollPayload.job.items[0].result.assets, {
      preview: "预览",
      reportHtml: "HTML 报告"
    });
    assert.doesNotMatch(JSON.stringify(pollPayload), /\/covers\/|\/out\//);
    assert.deepEqual(pollPayload.job.items[0].result.issueSummary, {
      errorCount: 0,
      warningCount: 1,
      issues: [{ target: "3x4", severity: "warning", message: "minor warning" }]
    });

    const detailResponse = await fetch(`${baseUrl}/api/jobs/${job.id}`);
    const detailPayload = await detailResponse.json();
    assert.equal(detailResponse.status, 200);
    assert.equal(detailPayload.job.itemsOffset, 10);
    assert.equal(detailPayload.job.totalItems, 60);
    assert.equal(detailPayload.job.itemsLimit, 50);
    assert.equal(detailPayload.job.items.length, 50);
    assert.equal(detailPayload.job.items[0].inputId, "item-10");
    assert.doesNotMatch(JSON.stringify(detailPayload), /\/covers\/|\/out\//);
    assert.equal("commands" in detailPayload.job.items[0].result, false);
    assert.equal("report" in detailPayload.job.items[0].result, false);

    const fullResponse = await fetch(`${baseUrl}/api/jobs/${job.id}?full=1`);
    const fullPayload = await fullResponse.json();
    assert.equal(fullResponse.status, 200);
    assert.equal(fullPayload.job.items.length, 60);
    assert.equal(fullPayload.job.itemsOffset, 0);
    assert.equal(fullPayload.job.totalItems, 60);
    assert.equal("commands" in fullPayload.job.items[0].result, false);
    assert.equal("report" in fullPayload.job.items[0].result, false);
    assert.equal("stages" in fullPayload.job.items[0], false);
    assert.doesNotMatch(JSON.stringify(fullPayload), /\/covers\/|\/out\//);
  } finally {
    await close(server);
  }
});

test("UI job APIs expose labels and ids instead of raw local paths", async () => {
  const state = createUiState();
  const job = createFakeLargeJob({ itemCount: 2 });
  state.jobs.set(job.id, job);

  const { server, baseUrl } = await listen(createUiServer({ toolRoot, state }));
  try {
    const endpoints = [
      "/api/jobs",
      `/api/jobs/${job.id}/poll`,
      `/api/jobs/${job.id}`,
      `/api/jobs/${job.id}?full=1`
    ];
    for (const endpoint of endpoints) {
      const response = await fetch(`${baseUrl}${endpoint}`);
      const payload = await response.json();
      assert.equal(response.status, 200);
      const serialized = JSON.stringify(payload);
      assert.doesNotMatch(serialized, /\/covers\/|\/out\//);
      assert.match(serialized, /cover-1\.mov|cover-0\.mov/);

      const summarizedJob = payload.jobs?.[0] ?? payload.job;
      assert.equal("current" in summarizedJob, false);
      assert.equal(summarizedJob.currentId, "item-1");
      for (const item of summarizedJob.items ?? []) {
        assert.equal("inputPath" in item, false);
        assert.equal(typeof item.inputId, "string");
        assert.match(item.inputLabel, /^cover-\d+\.mov$/);
        if (item.result) {
          assert.equal("inputPath" in item.result, false);
          assert.equal(item.result.inputId, item.inputId);
          assert.deepEqual(item.result.assets, {
            preview: "预览",
            reportHtml: "HTML 报告"
          });
        }
      }
    }
  } finally {
    await close(server);
  }
});

test("UI job APIs sanitize restored raw diagnostics before browser responses", async () => {
  const state = createUiState();
  const envFile = `.${"env"}`;
  const now = new Date().toISOString();
  const job = createFakeLargeJob({ itemCount: 2 });
  job.id = "raw-restored-diagnostics";
  job.status = "failed";
  job.error = `ffmpeg failed for ${privateUserRoot}/.private-fixture/demo-project/cover.mov\n    at ChildProcess.<anonymous> (${privateUserRoot}/private/render.js:42:7)`;
  job.currentStage = { name: "recover", target: `${privateUserRoot}/.private-fixture/demo-project/cover.mov`, state: "failed", at: now };
  job.logs = [{
    at: now,
    level: "error",
    message: `stderr token=${privateUserRoot}/${envFile} while reading ${privateUserRoot}/.private-fixture/demo-project/cover.mov`
  }];
  job.items[0].status = "failed";
  job.items[0].error = `EACCES: permission denied, open '${privateUserRoot}/.private-fixture/demo-project/cover.mov'`;
  job.items[0].currentStage = { name: "qc", target: `${privateUserRoot}/.private-fixture/demo-project/cover.mov`, state: "failed", at: now };
  job.items[0].result.issueSummary = {
    errorCount: 1,
    warningCount: 0,
    issues: [{
      target: `${privateUserRoot}/.private-fixture/demo-project/cover.mov`,
      severity: "error",
      message: `freezedetect warning stderr token=${privateUserRoot}/${envFile}`
    }]
  };
  state.jobs.set(job.id, job);

  const { server, baseUrl } = await listen(createUiServer({ toolRoot, state }));
  try {
    const endpoints = [
      "/api/jobs",
      `/api/jobs/${job.id}/poll`,
      `/api/jobs/${job.id}`,
      `/api/jobs/${job.id}?full=1`
    ];
    for (const endpoint of endpoints) {
      const response = await fetch(`${baseUrl}${endpoint}`);
      const payload = await response.json();
      assert.equal(response.status, 200);
      const serialized = JSON.stringify(payload);
      assert.doesNotMatch(serialized, new RegExp(`/Users|\\.private-fixture|\\.${"env"}|token|ChildProcess|render\\.js|stderr|EACCES`));
      assert.match(serialized, /技术诊断已隐藏|本地技术诊断/);

      const summarizedJob = payload.jobs?.[0] ?? payload.job;
      for (const log of summarizedJob.logs ?? []) {
        assert.doesNotMatch(log.message, /\/|\\|token|stderr|EACCES/);
      }
      for (const item of summarizedJob.items ?? []) {
        if (item.error) assert.doesNotMatch(item.error, /\/|\\|token|stderr|EACCES/);
        if (item.currentStage) assert.doesNotMatch(String(item.currentStage.target), /\/|\\/);
        for (const issue of item.result?.issueSummary?.issues ?? []) {
          assert.doesNotMatch(String(issue.target), /\/|\\/);
          assert.doesNotMatch(issue.message, /\/|\\|token|stderr|EACCES/);
        }
      }
    }
  } finally {
    await close(server);
  }
});

test("UI full job detail bounds very large item snapshots", async () => {
  const state = createUiState();
  const job = createFakeLargeJob({ itemCount: 10_000 });
  state.jobs.set(job.id, job);

  const { server, baseUrl } = await listen(createUiServer({ toolRoot, state }));
  try {
    const fullResponse = await fetch(`${baseUrl}/api/jobs/${job.id}?full=1`);
    const fullPayload = await fullResponse.json();
    assert.equal(fullResponse.status, 200);
    assert.equal(fullPayload.job.items.length, 200);
    assert.equal(fullPayload.job.itemsOffset, 9800);
    assert.equal(fullPayload.job.totalItems, 10_000);
    assert.equal(fullPayload.job.itemsLimit, 200);
    assert.equal(fullPayload.job.items[0].inputId, "item-9800");
    assert.equal(fullPayload.job.items[0].inputLabel, "cover-9800.mov");
    assert.doesNotMatch(JSON.stringify(fullPayload), /\/covers\/|\/out\//);
    assert.equal("commands" in fullPayload.job.items[0].result, false);
    assert.equal("report" in fullPayload.job.items[0].result, false);
    assert.equal("stages" in fullPayload.job.items[0], false);
  } finally {
    await close(server);
  }
});

test("UI poll and detail snapshots bound restored job logs by default", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "apple-motion-ui-"));
  const jobStorePath = path.join(tempDir, "jobs.json");
  const now = new Date().toISOString();
  await writeFile(jobStorePath, JSON.stringify({
    version: 1,
    jobs: [{
      id: "restored-log-cliff",
      status: "succeeded",
      options: {
        input: path.join(tempDir, "cover.mov"),
        outDir: path.join(tempDir, "out")
      },
      createdAt: now,
      startedAt: now,
      finishedAt: now,
      current: null,
      total: 1,
      completed: 1,
      passed: 1,
      warnings: 0,
      failed: 0,
      planned: 0,
      cancelRequested: false,
      error: null,
      currentStage: null,
      items: [],
      logs: Array.from({ length: 10 }, (_, index) => ({
        at: now,
        level: "info",
        message: `restored log ${index}`
      })),
      inputFiles: [path.join(tempDir, "cover.mov")]
    }]
  }));

  const state = createUiState({ jobStorePath, maxLogsPerJob: 3 });
  const restoredJob = state.jobs.get("restored-log-cliff");
  assert.equal(restoredJob.logs.length, 3);
  assert.equal(restoredJob.logsOffset, 7);
  assert.equal(restoredJob.totalLogs, 10);

  await flushUiState(state);
  const restoredStorePayload = JSON.parse(await readFile(jobStorePath, "utf8"));
  assert.equal(restoredStorePayload.jobs[0].logs.length, 3);
  assert.equal(restoredStorePayload.jobs[0].logsOffset, 7);
  assert.equal(restoredStorePayload.jobs[0].totalLogs, 10);

  const { server, baseUrl } = await listen(createUiServer({ toolRoot, state }));
  try {
    const pollResponse = await fetch(`${baseUrl}/api/jobs/restored-log-cliff/poll`);
    const pollPayload = await pollResponse.json();
    assert.equal(pollResponse.status, 200);
    assert.equal(pollPayload.job.logsOffset, 7);
    assert.equal(pollPayload.job.totalLogs, 10);
    assert.equal(pollPayload.job.logsLimit, 3);
    assert.deepEqual(pollPayload.job.logs.map((entry) => entry.message), [
      "restored log 7",
      "restored log 8",
      "restored log 9"
    ]);

    const detailResponse = await fetch(`${baseUrl}/api/jobs/restored-log-cliff`);
    const detailPayload = await detailResponse.json();
    assert.equal(detailResponse.status, 200);
    assert.equal(detailPayload.job.logs.length, 3);
    assert.equal(detailPayload.job.logsOffset, 7);

    const fullResponse = await fetch(`${baseUrl}/api/jobs/restored-log-cliff?full=1`);
    const fullPayload = await fullResponse.json();
    assert.equal(fullResponse.status, 200);
    assert.equal(fullPayload.job.logs.length, 3);
    assert.equal(fullPayload.job.logsOffset, 7);
  } finally {
    await close(server);
  }
});

test("UI prunes old finished jobs while keeping recent job details", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "apple-motion-ui-"));
  const outDir = path.join(tempDir, "out");
  const inputA = path.join(tempDir, "cover-a.mov");
  const inputB = path.join(tempDir, "cover-b.mov");
  const inputC = path.join(tempDir, "cover-c.mov");
  await writeFile(inputA, "");
  await writeFile(inputB, "");
  await writeFile(inputC, "");

  const state = createUiState({ maxJobs: 2 });
  const { server, baseUrl } = await listen(createUiServer({ toolRoot, state }));
  try {
    const first = await createDryRunJob(baseUrl, inputA, outDir);
    await waitForJob(baseUrl, first.job.id);
    const second = await createDryRunJob(baseUrl, inputB, outDir);
    await waitForJob(baseUrl, second.job.id);
    const third = await createDryRunJob(baseUrl, inputC, outDir);
    await waitForJob(baseUrl, third.job.id);

    const listResponse = await fetch(`${baseUrl}/api/jobs`);
    const listPayload = await listResponse.json();
    assert.deepEqual(listPayload.jobs.map((job) => job.id), [second.job.id, third.job.id]);

    const oldDetailResponse = await fetch(`${baseUrl}/api/jobs/${first.job.id}`);
    assert.equal(oldDetailResponse.status, 404);

    const recentDetailResponse = await fetch(`${baseUrl}/api/jobs/${third.job.id}`);
    const recentDetail = await recentDetailResponse.json();
    assert.equal(recentDetailResponse.status, 200);
    assert.equal(recentDetail.job.status, "planned");
    assert.equal(recentDetail.job.items.length, 1);
  } finally {
    await close(server);
  }
});

test("UI clears finished job history without deleting output files", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "apple-motion-ui-"));
  const outDir = path.join(tempDir, "out");
  const input = path.join(tempDir, "cover.mov");
  const fakeFfmpeg = await writeFakeOutputFfmpeg(tempDir);
  const fakeFfprobe = await writeFakeCompliantFfprobe(tempDir);
  await writeFile(input, "");

  const state = createUiState();
  const { server, baseUrl } = await listen(createUiServer({ toolRoot, state }));
  try {
    const created = await createPreviewJob(baseUrl, {
      input,
      outDir,
      ffmpegPath: fakeFfmpeg,
      ffprobePath: fakeFfprobe
    });
    const job = await waitForJob(baseUrl, created.job.id);
    const previewPath = buildOutputPlan({ inputPath: input, outDir, container: "mp4" }).preview;
    const previewAssetId = job.items[0].result.assetIds.preview;

    const initialAssetResponse = await fetch(assetUrl(baseUrl, previewAssetId));
    assert.equal(initialAssetResponse.status, 200);

    const unconfirmedClearResponse = await fetch(`${baseUrl}/api/jobs/history`, { method: "DELETE" });
    const unconfirmedClearPayload = await unconfirmedClearResponse.json();
    assert.equal(unconfirmedClearResponse.status, 400);
    assert.equal(unconfirmedClearPayload.ok, false);
    assert.match(unconfirmedClearPayload.error, /确认清除历史任务记录/);

    const clearResponse = await deleteFinishedHistory(baseUrl);
    const clearPayload = await clearResponse.json();
    assert.equal(clearResponse.status, 200);
    assert.equal(clearPayload.ok, true);
    assert.equal(clearPayload.cleared, 1);
    assert.deepEqual(clearPayload.jobs, []);

    const detailResponse = await fetch(`${baseUrl}/api/jobs/${created.job.id}`);
    assert.equal(detailResponse.status, 404);

    const staleAssetResponse = await fetch(assetUrl(baseUrl, previewAssetId));
    assert.equal(staleAssetResponse.status, 403);
    assert.equal(await readFile(previewPath, "utf8"), "fake media");
  } finally {
    await close(server);
  }
});

test("UI clear history rolls back jobs and assets when persistence fails", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "apple-motion-ui-"));
  const jobStorePath = path.join(tempDir, "jobs.json");
  const outDir = path.join(tempDir, "out");
  const input = path.join(tempDir, "cover.mov");
  const fakeFfmpeg = await writeFakeOutputFfmpeg(tempDir);
  const fakeFfprobe = await writeFakeCompliantFfprobe(tempDir);
  await writeFile(input, "");

  const state = createUiState({ jobStorePath });
  const { server, baseUrl } = await listen(createUiServer({ toolRoot, state }));
  try {
    const created = await createPreviewJob(baseUrl, {
      input,
      outDir,
      ffmpegPath: fakeFfmpeg,
      ffprobePath: fakeFfprobe
    });
    const job = await waitForJob(baseUrl, created.job.id);
    await flushUiState(state);

    const previewPath = buildOutputPlan({ inputPath: input, outDir, container: "mp4" }).preview;
    const previewAssetId = job.items[0].result.assetIds.preview;
    const resolvedPreviewPath = path.resolve(previewPath);
    const initialAssetResponse = await fetch(assetUrl(baseUrl, previewAssetId));
    assert.equal(initialAssetResponse.status, 200);
    const fingerprint = state.allowedAssetFingerprints.get(resolvedPreviewPath);
    const assetId = state.allowedAssetIds.get(resolvedPreviewPath);
    assert.ok(fingerprint);
    assert.equal(assetId, previewAssetId);

    state.jobStorePath = path.join(jobStorePath, "nested.json");
    const clearResponse = await deleteFinishedHistory(baseUrl);
    const clearPayload = await clearResponse.json();
    assert.equal(clearResponse.status, 500);
    assert.equal(clearPayload.ok, false);
    assert.equal(clearPayload.error, "任务恢复记录暂时无法写入。请确认应用数据目录可写后重试。");

    assert.equal(state.jobs.has(created.job.id), true);
    assert.equal(state.allowedAssets.has(resolvedPreviewPath), true);
    assert.deepEqual(state.allowedAssetFingerprints.get(resolvedPreviewPath), fingerprint);
    assert.equal(state.allowedAssetIds.get(resolvedPreviewPath), previewAssetId);
    assert.equal(state.allowedAssetPaths.get(previewAssetId), resolvedPreviewPath);

    const detailResponse = await fetch(`${baseUrl}/api/jobs/${created.job.id}`);
    assert.equal(detailResponse.status, 200);

    const restoredAssetResponse = await fetch(assetUrl(baseUrl, previewAssetId));
    assert.equal(restoredAssetResponse.status, 200);
    assert.equal(await readFile(previewPath, "utf8"), "fake media");
  } finally {
    await close(server);
  }
});

test("UI clear history preserves active jobs", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "apple-motion-ui-"));
  const outDir = path.join(tempDir, "out");
  const oldInput = path.join(tempDir, "old.mov");
  const activeInput = path.join(tempDir, "active.mov");
  const fakeFfmpeg = await writeFakeLongRunningFfmpeg(tempDir);
  const fakeFfprobe = await writeFakeCompliantFfprobe(tempDir);
  await writeFile(oldInput, "");
  await writeFile(activeInput, "");

  const state = createUiState();
  const { server, baseUrl } = await listen(createUiServer({ toolRoot, state }));
  try {
    const old = await createDryRunJob(baseUrl, oldInput, outDir);
    await waitForJob(baseUrl, old.job.id);

    const activeResponse = await fetch(`${baseUrl}/api/jobs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        input: activeInput,
        outDir,
        previewOnly: true,
        ffmpegPath: fakeFfmpeg,
        ffprobePath: fakeFfprobe
      })
    });
    const active = await activeResponse.json();
    assert.equal(activeResponse.status, 202);
    await waitForFile(path.join(tempDir, "started.txt"));

    const clearResponse = await deleteFinishedHistory(baseUrl);
    const clearPayload = await clearResponse.json();
    assert.equal(clearResponse.status, 200);
    assert.equal(clearPayload.cleared, 1);
    assert.deepEqual(clearPayload.jobs.map((job) => job.id), [active.job.id]);

    const oldDetailResponse = await fetch(`${baseUrl}/api/jobs/${old.job.id}`);
    assert.equal(oldDetailResponse.status, 404);

    const activeDetailResponse = await fetch(`${baseUrl}/api/jobs/${active.job.id}`);
    const activeDetail = await activeDetailResponse.json();
    assert.equal(activeDetailResponse.status, 200);
    assert.equal(activeDetail.job.status, "running");

    await fetch(`${baseUrl}/api/jobs/${active.job.id}/cancel`, { method: "POST" });
    await waitForFile(path.join(tempDir, "terminated.txt"));
  } finally {
    await close(server);
  }
});

test("UI keeps active jobs even when finished history exceeds retention", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "apple-motion-ui-"));
  const outDir = path.join(tempDir, "out");
  const oldInput = path.join(tempDir, "old.mov");
  const activeInput = path.join(tempDir, "active.mov");
  const fakeFfmpeg = await writeFakeLongRunningFfmpeg(tempDir);
  const fakeFfprobe = await writeFakeCompliantFfprobe(tempDir);
  await writeFile(oldInput, "");
  await writeFile(activeInput, "");

  const state = createUiState({ maxJobs: 0 });
  const { server, baseUrl } = await listen(createUiServer({ toolRoot, state }));
  try {
    const old = await createDryRunJob(baseUrl, oldInput, outDir);
    await waitForMissingJob(baseUrl, old.job.id);

    const activeResponse = await fetch(`${baseUrl}/api/jobs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        input: activeInput,
        outDir,
        previewOnly: true,
        ffmpegPath: fakeFfmpeg,
        ffprobePath: fakeFfprobe
      })
    });
    const active = await activeResponse.json();
    assert.equal(activeResponse.status, 202);
    await waitForFile(path.join(tempDir, "started.txt"));

    const listResponse = await fetch(`${baseUrl}/api/jobs`);
    const listPayload = await listResponse.json();
    assert.deepEqual(listPayload.jobs.map((job) => job.id), [active.job.id]);

    const activeDetailResponse = await fetch(`${baseUrl}/api/jobs/${active.job.id}`);
    const activeDetail = await activeDetailResponse.json();
    assert.equal(activeDetailResponse.status, 200);
    assert.equal(activeDetail.job.status, "running");

    await fetch(`${baseUrl}/api/jobs/${active.job.id}/cancel`, { method: "POST" });
    await waitForFile(path.join(tempDir, "terminated.txt"));
  } finally {
    await close(server);
  }
});

test("UI clips each job log to the configured recent entries", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "apple-motion-ui-"));
  const inputDir = path.join(tempDir, "covers");
  const outDir = path.join(tempDir, "out");
  await mkdir(inputDir);
  for (const name of ["a.mov", "b.mov", "c.mov"]) {
    await writeFile(path.join(inputDir, name), "");
  }

  const state = createUiState({ maxLogsPerJob: 3 });
  const { server, baseUrl } = await listen(createUiServer({ toolRoot, state }));
  try {
    const created = await createDryRunJob(baseUrl, inputDir, outDir);
    const job = await waitForJob(baseUrl, created.job.id);

    assert.equal(job.logs.length, 3);
    assert.equal(job.logs.at(-1).message, "任务已计划：3 个文件。");
    assert.equal(job.logs.some((entry) => entry.message === "模拟运行已开始。"), false);
  } finally {
    await close(server);
  }
});

test("UI keeps a job-level final summary in clipped logs", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "apple-motion-ui-"));
  const inputDir = path.join(tempDir, "covers");
  const outDir = path.join(tempDir, "out");
  await mkdir(inputDir);
  for (const name of ["a.mov", "b.mov", "c.mov"]) {
    await writeFile(path.join(inputDir, name), "");
  }

  const state = createUiState({ maxLogsPerJob: 1 });
  const { server, baseUrl } = await listen(createUiServer({ toolRoot, state }));
  try {
    const created = await createDryRunJob(baseUrl, inputDir, outDir);
    const job = await waitForJob(baseUrl, created.job.id);

    assert.equal(job.logs.length, 1);
    assert.equal(job.logs[0].message, "任务已计划：3 个文件。");
  } finally {
    await close(server);
  }
});

test("UI prunes asset access for discarded jobs without deleting output files", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "apple-motion-ui-"));
  const outDir = path.join(tempDir, "out");
  const inputA = path.join(tempDir, "cover-a.mov");
  const inputB = path.join(tempDir, "cover-b.mov");
  const fakeFfmpeg = await writeFakeOutputFfmpeg(tempDir);
  const fakeFfprobe = await writeFakeCompliantFfprobe(tempDir);
  await writeFile(inputA, "");
  await writeFile(inputB, "");

  const state = createUiState({ maxJobs: 1 });
  const { server, baseUrl } = await listen(createUiServer({ toolRoot, state }));
  try {
    const first = await createPreviewJob(baseUrl, {
      input: inputA,
      outDir,
      ffmpegPath: fakeFfmpeg,
      ffprobePath: fakeFfprobe
    });
    const firstJob = await waitForJob(baseUrl, first.job.id);
    const firstPreview = buildOutputPlan({ inputPath: inputA, outDir, container: "mp4" }).preview;
    const firstPreviewAssetId = firstJob.items[0].result.assetIds.preview;

    const firstAssetResponse = await fetch(assetUrl(baseUrl, firstPreviewAssetId));
    assert.equal(firstAssetResponse.status, 200);

    const second = await createPreviewJob(baseUrl, {
      input: inputB,
      outDir,
      ffmpegPath: fakeFfmpeg,
      ffprobePath: fakeFfprobe
    });
    const secondJob = await waitForJob(baseUrl, second.job.id);
    const secondPreviewAssetId = secondJob.items[0].result.assetIds.preview;

    const oldDetailResponse = await fetch(`${baseUrl}/api/jobs/${first.job.id}`);
    assert.equal(oldDetailResponse.status, 404);

    const oldAssetResponse = await fetch(assetUrl(baseUrl, firstPreviewAssetId));
    assert.equal(oldAssetResponse.status, 403);
    assert.equal(await readFile(firstPreview, "utf8"), "fake media");

    const recentAssetResponse = await fetch(assetUrl(baseUrl, secondPreviewAssetId));
    assert.equal(recentAssetResponse.status, 200);
  } finally {
    await close(server);
  }
});

test("UI keeps successful item assets revealable when a later folder item fails", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "apple-motion-ui-"));
  const inputDir = path.join(tempDir, "covers");
  const outDir = path.join(tempDir, "out");
  const inputA = path.join(inputDir, "cover-a.mov");
  const inputB = path.join(inputDir, "cover-b.mov");
  const fakeFfmpeg = await writeMixedSuccessFfmpeg(tempDir, "cover-b");
  const fakeFfprobe = await writeFakeCompliantFfprobe(tempDir);
  await mkdir(inputDir);
  await writeFile(inputA, "");
  await writeFile(inputB, "");

  const revealed = [];
  const { server, baseUrl } = await listen(createUiServer({
    toolRoot,
    revealLauncher: async (assetPath) => {
      revealed.push(assetPath);
    }
  }));
  try {
    const createResponse = await fetch(`${baseUrl}/api/jobs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        input: inputDir,
        outDir,
        ffmpegPath: fakeFfmpeg,
        ffprobePath: fakeFfprobe,
        encoder: "x264"
      })
    });
    const created = await createResponse.json();
    assert.equal(createResponse.status, 202);

    const job = await waitForJob(baseUrl, created.job.id);
    assert.equal(job.status, "failed");
    assert.equal(job.total, 2);
    assert.equal(job.completed, 2);
    assert.equal(job.passed, 1);
    assert.equal(job.failed, 1);
    assert.equal(job.items.length, 2);
    assert.equal(job.items[0].inputId, "item-0");
    assert.equal(job.items[0].inputLabel, "cover-a.mov");
    assert.equal(job.items[0].status, "passed");
    assert.equal(job.items[1].inputId, "item-1");
    assert.equal(job.items[1].inputLabel, "cover-b.mov");
    assert.equal(job.items[1].status, "failed");
    assert.equal(job.items[1].result, null);

    const successfulAssetEntries = Object.entries(job.items[0].result.assets);
    const expectedSuccessfulAssets = {
      oneByOne: buildOutputPlan({ inputPath: inputA, outDir, container: "mp4" }).oneByOne,
      threeByFour: buildOutputPlan({ inputPath: inputA, outDir, container: "mp4" }).threeByFour,
      preview: buildOutputPlan({ inputPath: inputA, outDir, container: "mp4" }).preview,
      reportJson: buildOutputPlan({ inputPath: inputA, outDir, container: "mp4" }).reportJson,
      reportHtml: buildOutputPlan({ inputPath: inputA, outDir, container: "mp4" }).reportHtml
    };
    for (const [kind, assetPath] of successfulAssetEntries) {
      const assetId = job.items[0].result.assetIds[kind];
      const assetResponse = await fetch(assetUrl(baseUrl, assetId));
      assert.equal(assetResponse.status, 200);
      const revealResponse = await fetch(`${baseUrl}/api/reveal`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: assetId })
      });
      assert.equal(revealResponse.status, 200);
    }
    const successfulAssets = successfulAssetEntries.map(([kind]) => expectedSuccessfulAssets[kind]);
    assert.deepEqual(revealed, successfulAssets.map((assetPath) => path.resolve(assetPath)));

    const failedPlan = buildOutputPlan({ inputPath: inputB, outDir, container: "mp4" });
    const failedPlannedAssets = [
      failedPlan.oneByOne,
      failedPlan.threeByFour,
      failedPlan.preview,
      failedPlan.reportJson,
      failedPlan.reportHtml
    ];
    for (const assetPath of failedPlannedAssets) {
      const assetResponse = await fetch(assetUrl(baseUrl, `failed-${path.basename(assetPath)}`));
      assert.equal(assetResponse.status, 403);
      const revealResponse = await fetch(`${baseUrl}/api/reveal`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: `failed-${path.basename(assetPath)}` })
      });
      assert.equal(revealResponse.status, 403);
    }
    assert.deepEqual(revealed, successfulAssets.map((assetPath) => path.resolve(assetPath)));
  } finally {
    await close(server);
  }
});

test("UI folder job resolves and smoke-tests the encoder only once", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "apple-motion-ui-"));
  const inputDir = path.join(tempDir, "covers");
  const inputA = path.join(inputDir, "cover-a.mov");
  const inputB = path.join(inputDir, "cover-b.mov");
  const outDir = path.join(tempDir, "out");
  const countPath = path.join(tempDir, "ffmpeg-counts.txt");
  const fakeFfmpeg = await writeCountingFfmpeg(tempDir, countPath);
  const fakeFfprobe = await writeFakeCompliantFfprobe(tempDir);
  await mkdir(inputDir);
  await writeFile(inputA, "");
  await writeFile(inputB, "");

  const { server, baseUrl } = await listen(createUiServer({ toolRoot }));
  try {
    const createResponse = await fetch(`${baseUrl}/api/jobs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        input: inputDir,
        outDir,
        encoder: "x264",
        ffmpegPath: fakeFfmpeg,
        ffprobePath: fakeFfprobe,
        container: "mp4",
        mode: "scale-fill",
        bitrate: "50M",
        fps: "30"
      })
    });
    const created = await createResponse.json();
    assert.equal(createResponse.status, 202);

    const job = await waitForJob(baseUrl, created.job.id);
    assert.equal(job.status, "succeeded");
    assert.equal(job.total, 2);
    assert.equal(await countMarker(countPath, "encoders"), 1);
    assert.equal(await countMarker(countPath, "smoke"), 1);
  } finally {
    await close(server);
  }
});

test("UI folder job ignores the configured output directory inside the input tree", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "apple-motion-ui-"));
  const input = path.join(tempDir, "cover.mov");
  const outDir = path.join(tempDir, "out");
  const previousOutput = path.join(outDir, "cover__apple-motion-1x1.mp4");
  await mkdir(outDir, { recursive: true });
  await writeFile(input, "");
  await writeFile(previousOutput, "old generated output");

  const state = createUiState();
  const { server, baseUrl } = await listen(createUiServer({ toolRoot, state }));
  try {
    const created = await createDryRunJob(baseUrl, tempDir, outDir);
    assert.equal(created.job.total, 1);

    const job = await waitForJob(baseUrl, created.job.id);
    assert.equal(job.total, 1);
    assert.deepEqual(job.items.map((item) => item.inputId), ["item-0"]);
    assert.deepEqual(job.items.map((item) => item.inputLabel), ["cover.mov"]);
    assert.equal(job.logs.some((entry) => entry.message === "任务已计划：1 个文件。"), true);
  } finally {
    await close(server);
  }
});

test("UI cancel terminates the current FFmpeg process", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "apple-motion-ui-"));
  const input = path.join(tempDir, "cover.mov");
  const outDir = path.join(tempDir, "out");
  const fakeFfmpeg = await writeFakeLongRunningFfmpeg(tempDir);
  const fakeFfprobe = await writeFakeCompliantFfprobe(tempDir);
  const terminatedPath = path.join(tempDir, "terminated.txt");
  await writeFile(input, "");

  const { server, baseUrl } = await listen(createUiServer({ toolRoot }));
  try {
    const createResponse = await fetch(`${baseUrl}/api/jobs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        input,
        outDir,
        previewOnly: true,
        ffmpegPath: fakeFfmpeg,
        ffprobePath: fakeFfprobe
      })
    });
    const created = await createResponse.json();
    assert.equal(createResponse.status, 202);

    await waitForFile(path.join(tempDir, "started.txt"));
    const cancelResponse = await fetch(`${baseUrl}/api/jobs/${created.job.id}/cancel`, { method: "POST" });
    assert.equal(cancelResponse.status, 200);
    const cancelling = await cancelResponse.json();
    assert.equal(cancelling.job.currentStage.name, "cancel");
    assert.equal(cancelling.job.currentStage.state, "active");

    await waitForFile(terminatedPath);
    const job = await waitForJob(baseUrl, created.job.id);
    assert.equal(job.status, "cancelled");
    assert.equal(job.currentStage.name, "cancel");
    assert.equal(job.currentStage.state, "cancelled");
  } finally {
    await close(server);
  }
});

test("UI cancel rejects finished jobs without mutating history", async () => {
  const state = createUiState();
  const job = createFakeLargeJob();
  job.status = "succeeded";
  job.finishedAt = new Date().toISOString();
  job.currentStage = { name: "report", target: "job", state: "done", at: job.finishedAt };
  job.cancelRequested = false;
  const originalStage = structuredClone(job.currentStage);
  const originalLogCount = job.logs.length;
  state.jobs.set(job.id, job);

  const { server, baseUrl } = await listen(createUiServer({ toolRoot, state }));
  try {
    const response = await fetch(`${baseUrl}/api/jobs/${job.id}/cancel`, { method: "POST" });
    const payload = await response.json();
    assert.equal(response.status, 409);
    assert.equal(payload.ok, false);
    assert.match(payload.error, /任务已经结束/);
    assert.equal(job.status, "succeeded");
    assert.equal(job.cancelRequested, false);
    assert.deepEqual(job.currentStage, originalStage);
    assert.equal(job.logs.length, originalLogCount);
  } finally {
    await close(server);
  }
});

test("UI shutdown terminates active FFmpeg work before the desktop bridge closes", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "apple-motion-ui-"));
  const input = path.join(tempDir, "cover.mov");
  const outDir = path.join(tempDir, "out");
  const fakeFfmpeg = await writeFakeLongRunningFfmpeg(tempDir);
  const fakeFfprobe = await writeFakeCompliantFfprobe(tempDir);
  const terminatedPath = path.join(tempDir, "terminated.txt");
  await writeFile(input, "");

  const state = createUiState();
  const { server, baseUrl } = await listen(createUiServer({ toolRoot, state }));
  let created;
  try {
    const createResponse = await fetch(`${baseUrl}/api/jobs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        input,
        outDir,
        previewOnly: true,
        ffmpegPath: fakeFfmpeg,
        ffprobePath: fakeFfprobe
      })
    });
    created = await createResponse.json();
    assert.equal(createResponse.status, 202);

    await waitForFile(path.join(tempDir, "started.txt"));
    await uiServer.shutdownUiState(state, { timeoutMs: 2000 });

    await waitForFile(terminatedPath);
    const job = await getFullJob(baseUrl, created.job.id);
    assert.equal(job.status, "cancelled");
    assert.equal(job.currentStage.name, "cancel");
    assert.equal(job.currentStage.state, "cancelled");
  } finally {
    if (created?.job?.id) {
      await fetch(`${baseUrl}/api/jobs/${created.job.id}/cancel`, { method: "POST" }).catch(() => {});
      await waitForFile(terminatedPath, 1000).catch(() => {});
    }
    await close(server);
  }
});

test("UI exposes current stage while a preview render is running", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "apple-motion-ui-"));
  const input = path.join(tempDir, "cover.mov");
  const outDir = path.join(tempDir, "out");
  const fakeFfmpeg = await writeFakeLongRunningFfmpeg(tempDir);
  const fakeFfprobe = await writeFakeCompliantFfprobe(tempDir);
  await writeFile(input, "");

  const { server, baseUrl } = await listen(createUiServer({ toolRoot }));
  try {
    const createResponse = await fetch(`${baseUrl}/api/jobs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        input,
        outDir,
        previewOnly: true,
        ffmpegPath: fakeFfmpeg,
        ffprobePath: fakeFfprobe
      })
    });
    const created = await createResponse.json();
    assert.equal(createResponse.status, 202);

    await waitForFile(path.join(tempDir, "started.txt"));
    const response = await fetch(`${baseUrl}/api/jobs/${created.job.id}`);
    const payload = await response.json();
    assert.equal(payload.job.currentStage.name, "preview");
    assert.equal(payload.job.currentStage.target, "preview");
    assert.equal(payload.job.currentStage.state, "active");
    assert.equal(payload.job.items[0].currentStage.name, "preview");

    const fullJob = await getFullJob(baseUrl, created.job.id);
    assert.equal(fullJob.items[0].currentStage.name, "preview");
    assert.equal("stages" in fullJob.items[0], false);

    await fetch(`${baseUrl}/api/jobs/${created.job.id}/cancel`, { method: "POST" });
    await waitForJob(baseUrl, created.job.id);
  } finally {
    await close(server);
  }
});

test("UI preview-only job finishes without claiming QC pass", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "apple-motion-ui-"));
  const input = path.join(tempDir, "cover.mov");
  const outDir = path.join(tempDir, "out");
  const fakeFfmpeg = await writeFakeOutputFfmpeg(tempDir);
  const fakeFfprobe = await writeFakeCompliantFfprobe(tempDir);
  await writeFile(input, "");

  const { server, baseUrl } = await listen(createUiServer({ toolRoot }));
  try {
    const createResponse = await fetch(`${baseUrl}/api/jobs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        input,
        outDir,
        previewOnly: true,
        ffmpegPath: fakeFfmpeg,
        ffprobePath: fakeFfprobe
      })
    });
    const created = await createResponse.json();
    assert.equal(createResponse.status, 202);

    const job = await waitForJob(baseUrl, created.job.id);
    assert.equal(job.status, "previewed");
    assert.equal(job.total, 1);
    assert.equal(job.passed, 0);
    assert.equal(job.items[0].status, "previewed");
    assert.equal(job.items[0].result.status, "previewed");

    const fullJob = await getFullJob(baseUrl, created.job.id);
    assert.equal("report" in fullJob.items[0].result, false);
    assert.equal(fullJob.items[0].result.issueSummary.errorCount, 0);
  } finally {
    await close(server);
  }
});

test("UI rejects missing custom FFprobe before queueing work", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "apple-motion-ui-"));
  const input = path.join(tempDir, "cover.mov");
  const outDir = path.join(tempDir, "out");
  const missingFfprobe = path.join(tempDir, "missing-ffprobe");
  await writeFile(input, "");

  const state = createUiState();
  const { server, baseUrl } = await listen(createUiServer({ toolRoot, state }));
  try {
    const createResponse = await fetch(`${baseUrl}/api/jobs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        input,
        outDir,
        previewOnly: true,
        ffprobePath: missingFfprobe
      })
    });
    const payload = await createResponse.json();
    assert.equal(createResponse.status, 400);
    assert.equal(payload.ok, false);
    assert.equal(payload.field, "ffprobePath");
    assert.match(payload.error, /无法访问自定义 FFprobe 路径/);
    assert.doesNotMatch(payload.error, /spawn|ENOENT|node:|apple-motion-ui-|missing-ffprobe/i);
    assert.equal(state.jobs.size, 0);
  } finally {
    await close(server);
  }
});

test("UI rejects missing custom FFmpeg before queueing work", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "apple-motion-ui-"));
  const input = path.join(tempDir, "cover.mov");
  const outDir = path.join(tempDir, "out");
  const missingFfmpeg = path.join(tempDir, "missing-ffmpeg");
  const fakeFfprobe = await writeFakeCompliantFfprobe(tempDir);
  await writeFile(input, "");

  const state = createUiState();
  const { server, baseUrl } = await listen(createUiServer({ toolRoot, state }));
  try {
    const createResponse = await fetch(`${baseUrl}/api/jobs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        input,
        outDir,
        previewOnly: true,
        ffmpegPath: missingFfmpeg,
        ffprobePath: fakeFfprobe
      })
    });
    const payload = await createResponse.json();
    assert.equal(createResponse.status, 400);
    assert.equal(payload.ok, false);
    assert.equal(payload.field, "ffmpegPath");
    assert.match(payload.error, /无法访问自定义 FFmpeg 路径/);
    assert.doesNotMatch(payload.error, /spawn|ENOENT|node:|apple-motion-ui-|missing-ffmpeg/i);
    assert.equal(state.jobs.size, 0);
  } finally {
    await close(server);
  }
});

test("UI maps FFprobe diagnostics to a localized item error", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "apple-motion-ui-"));
  const input = path.join(tempDir, "cover.mov");
  const outDir = path.join(tempDir, "out");
  const badFfprobe = await writeInvalidJsonFfprobe(tempDir);
  await writeFile(input, "");

  const { server, baseUrl } = await listen(createUiServer({ toolRoot }));
  try {
    const createResponse = await fetch(`${baseUrl}/api/jobs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        input,
        outDir,
        previewOnly: true,
        ffprobePath: badFfprobe
      })
    });
    const created = await createResponse.json();
    assert.equal(createResponse.status, 202);

    const job = await waitForJob(baseUrl, created.job.id);
    assert.equal(job.status, "failed");
    assert.equal(job.items[0].status, "failed");
    assert.match(job.items[0].error, /无法分析视频信息/);
    assert.doesNotMatch(job.items[0].error, /Could not parse|Parser error|ffprobe stdout|ffprobe stderr|node:|apple-motion-ui-|not-json/i);
    const errorLogText = job.logs.filter((entry) => entry.level === "error").map((entry) => entry.message).join("\n");
    assert.match(errorLogText, /无法分析视频信息/);
    assert.doesNotMatch(errorLogText, /Could not parse|Parser error|ffprobe stdout|ffprobe stderr|node:|apple-motion-ui-|not-json/i);
  } finally {
    await close(server);
  }
});

test("UI maps dataless input files to a localized item error", async (t) => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "apple-motion-ui-"));
  const input = path.join(tempDir, "cover.mov");
  const outDir = path.join(tempDir, "out");
  const fakeFfprobe = await writeFakeCompliantFfprobe(tempDir);
  await writeFile(input, "");
  await truncate(input, 1024 * 1024);
  const inputInfo = await stat(input);
  if (inputInfo.blocks !== 0) {
    t.skip(`test filesystem allocated ${inputInfo.blocks} blocks for sparse fixture`);
    return;
  }

  const { server, baseUrl } = await listen(createUiServer({ toolRoot }));
  try {
    const createResponse = await fetch(`${baseUrl}/api/jobs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        input,
        outDir,
        previewOnly: true,
        ffprobePath: fakeFfprobe
      })
    });
    const created = await createResponse.json();
    assert.equal(createResponse.status, 202);

    const job = await waitForJob(baseUrl, created.job.id);
    assert.equal(job.status, "failed");
    assert.equal(job.items[0].status, "failed");
    assert.match(job.items[0].error, /完整下载|Finder|播放/);
    assert.doesNotMatch(job.items[0].error, /dataless|ffprobe|cover\.mov|\/var\/|\/Users\//i);
    const errorLogText = job.logs.filter((entry) => entry.level === "error").map((entry) => entry.message).join("\n");
    assert.match(errorLogText, /完整下载|Finder|播放/);
    assert.doesNotMatch(errorLogText, /dataless|ffprobe|cover\.mov|\/var\/|\/Users\//i);
  } finally {
    await close(server);
  }
});

test("UI maps process timeouts to a localized item error", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "apple-motion-ui-"));
  const input = path.join(tempDir, "cover.mov");
  const outDir = path.join(tempDir, "out");
  const hangingFfprobe = await writeHangingFfprobe(tempDir);
  await writeFile(input, "materialized media placeholder");

  const { server, baseUrl } = await listen(createUiServer({ toolRoot }));
  try {
    const createResponse = await fetch(`${baseUrl}/api/jobs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        input,
        outDir,
        previewOnly: true,
        ffprobePath: hangingFfprobe,
        probeTimeoutMs: 75
      })
    });
    const created = await createResponse.json();
    assert.equal(createResponse.status, 202);

    const job = await waitForJob(baseUrl, created.job.id);
    assert.equal(job.status, "failed");
    assert.equal(job.items[0].status, "failed");
    assert.match(job.items[0].error, /超时|完整下载|播放/);
    assert.doesNotMatch(job.items[0].error, /PROCESS_TIMEOUT|timed out|75|stdout|stderr|hanging-ffprobe|cover\.mov|\/var\/|\/Users\//i);
    const errorLogText = job.logs.filter((entry) => entry.level === "error").map((entry) => entry.message).join("\n");
    assert.match(errorLogText, /超时|完整下载|播放/);
    assert.doesNotMatch(errorLogText, /PROCESS_TIMEOUT|timed out|75|stdout|stderr|hanging-ffprobe|cover\.mov|\/var\/|\/Users\//i);
  } finally {
    await close(server);
  }
});

test("UI maps ambiguous input stream failures to a localized item error", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "apple-motion-ui-"));
  const input = path.join(tempDir, "cover.mov");
  const outDir = path.join(tempDir, "out");
  const fakeFfmpeg = await writeFakeOutputFfmpeg(tempDir);
  const ambiguousFfprobe = await writeAmbiguousInputFfprobe(tempDir);
  await writeFile(input, "");

  const { server, baseUrl } = await listen(createUiServer({ toolRoot }));
  try {
    const createResponse = await fetch(`${baseUrl}/api/jobs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        input,
        outDir,
        previewOnly: true,
        ffmpegPath: fakeFfmpeg,
        ffprobePath: ambiguousFfprobe
      })
    });
    const created = await createResponse.json();
    assert.equal(createResponse.status, 202);

    const job = await waitForJob(baseUrl, created.job.id);
    assert.equal(job.status, "failed");
    assert.equal(job.items[0].status, "failed");
    assert.match(job.items[0].error, /视频流不明确/);
    assert.doesNotMatch(job.items[0].error, /Input is ambiguous|Exactly one|No video|audio|cover\.mov|apple-motion-ui-|\/var\/|\/Users\//i);
    const errorLogText = job.logs.filter((entry) => entry.level === "error").map((entry) => entry.message).join("\n");
    assert.match(errorLogText, /视频流不明确/);
    assert.doesNotMatch(errorLogText, /Input is ambiguous|Exactly one|No video|audio|cover\.mov|apple-motion-ui-|\/var\/|\/Users\//i);
  } finally {
    await close(server);
  }
});

test("UI rejects impossible source duration before encoder probe or render", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "apple-motion-ui-"));
  const input = path.join(tempDir, "cover.mov");
  const outDir = path.join(tempDir, "out");
  const countPath = path.join(tempDir, "ffmpeg-counts.txt");
  const fakeFfmpeg = await writeCountingFfmpeg(tempDir, countPath);
  const fakeFfprobe = await writeFakeLongDurationFfprobe(tempDir);
  await writeFile(input, "");

  const { server, baseUrl } = await listen(createUiServer({ toolRoot }));
  try {
    const createResponse = await fetch(`${baseUrl}/api/jobs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        input,
        outDir,
        ffmpegPath: fakeFfmpeg,
        ffprobePath: fakeFfprobe,
        encoder: "x264"
      })
    });
    const created = await createResponse.json();
    assert.equal(createResponse.status, 202);

    const job = await waitForJob(baseUrl, created.job.id);
    assert.equal(job.status, "failed");
    assert.equal(job.items[0].status, "failed");
    assert.match(job.items[0].error, /Apple Motion|8 到 35 秒|重新导出/);
    assert.doesNotMatch(job.items[0].error, /Duration must|3600|cover\.mov|ffmpeg|ffprobe|apple-motion-ui-|\/var\/|\/Users\//i);
    const errorLogText = job.logs.filter((entry) => entry.level === "error").map((entry) => entry.message).join("\n");
    assert.match(errorLogText, /Apple Motion|8 到 35 秒|重新导出/);
    assert.doesNotMatch(errorLogText, /Duration must|3600|cover\.mov|ffmpeg|ffprobe|apple-motion-ui-|\/var\/|\/Users\//i);
    assert.equal(await countMarker(countPath, "encoders"), 0);
    assert.equal(await countMarker(countPath, "smoke"), 0);
    assert.equal(await countMarker(countPath, "render"), 0);
    assert.equal(await countMarker(countPath, "qc"), 0);
  } finally {
    await close(server);
  }
});

test("UI rejects unsupported source color before encoder probe or render", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "apple-motion-ui-"));
  const input = path.join(tempDir, "cover.mov");
  const outDir = path.join(tempDir, "out");
  const countPath = path.join(tempDir, "ffmpeg-counts.txt");
  const fakeFfmpeg = await writeCountingFfmpeg(tempDir, countPath);
  const fakeFfprobe = await writeFakeUnsupportedColorFfprobe(tempDir);
  await writeFile(input, "");

  const { server, baseUrl } = await listen(createUiServer({ toolRoot }));
  try {
    const createResponse = await fetch(`${baseUrl}/api/jobs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        input,
        outDir,
        ffmpegPath: fakeFfmpeg,
        ffprobePath: fakeFfprobe,
        encoder: "x264"
      })
    });
    const created = await createResponse.json();
    assert.equal(createResponse.status, 202);

    const job = await waitForJob(baseUrl, created.job.id);
    assert.equal(job.status, "failed");
    assert.equal(job.items[0].status, "failed");
    assert.match(job.items[0].error, /色彩|Rec\.709|sRGB|HDR/);
    assert.doesNotMatch(job.items[0].error, /bt470|Color profile|cover\.mov|ffmpeg|ffprobe|apple-motion-ui-|\/var\/|\/Users\//i);
    const errorLogText = job.logs.filter((entry) => entry.level === "error").map((entry) => entry.message).join("\n");
    assert.match(errorLogText, /色彩|Rec\.709|sRGB|HDR/);
    assert.doesNotMatch(errorLogText, /bt470|Color profile|cover\.mov|ffmpeg|ffprobe|apple-motion-ui-|\/var\/|\/Users\//i);
    assert.equal(await countMarker(countPath, "encoders"), 0);
    assert.equal(await countMarker(countPath, "smoke"), 0);
    assert.equal(await countMarker(countPath, "render"), 0);
    assert.equal(await countMarker(countPath, "qc"), 0);
  } finally {
    await close(server);
  }
});

test("UI localizes encoder resolution failure on the current item without raw diagnostics", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "apple-motion-ui-"));
  const input = path.join(tempDir, "cover.mov");
  const outDir = path.join(tempDir, "out");
  const fakeFfmpeg = await writeNoEncoderFfmpeg(tempDir);
  const fakeFfprobe = await writeFakeCompliantFfprobe(tempDir);
  await writeFile(input, "");

  const { server, baseUrl } = await listen(createUiServer({ toolRoot }));
  try {
    const createResponse = await fetch(`${baseUrl}/api/jobs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        input,
        outDir,
        ffmpegPath: fakeFfmpeg,
        ffprobePath: fakeFfprobe,
        encoder: "auto"
      })
    });
    const created = await createResponse.json();
    assert.equal(createResponse.status, 202);

    const job = await waitForJob(baseUrl, created.job.id);
    assert.equal(job.status, "failed");
    assert.equal(job.items.length, 1);
    assert.equal(job.items[0].status, "failed");
    assert.equal(job.failed, 1);
    assert.match(job.items[0].error, /无法选择可用的视频编码器/);
    assert.doesNotMatch(job.items[0].error, /No supported|runtime smoke|FFmpeg build|libx264|h264_nvenc|h264_qsv/i);
    const errorLogText = job.logs.filter((entry) => entry.level === "error").map((entry) => entry.message).join("\n");
    assert.match(errorLogText, /无法选择可用的视频编码器/);
    assert.doesNotMatch(errorLogText, /No supported|runtime smoke|FFmpeg build|libx264|h264_nvenc|h264_qsv/i);
  } finally {
    await close(server);
  }
});

test("UI keeps FFmpeg render stderr out of item errors", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "apple-motion-ui-"));
  const input = path.join(tempDir, "cover.mov");
  const outDir = path.join(tempDir, "out");
  const fakeFfmpeg = await writeFailingRenderFfmpeg(tempDir);
  const fakeFfprobe = await writeFakeCompliantFfprobe(tempDir);
  await writeFile(input, "");

  const { server, baseUrl } = await listen(createUiServer({ toolRoot }));
  try {
    const createResponse = await fetch(`${baseUrl}/api/jobs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        input,
        outDir,
        previewOnly: true,
        ffmpegPath: fakeFfmpeg,
        ffprobePath: fakeFfprobe
      })
    });
    const created = await createResponse.json();
    assert.equal(createResponse.status, 202);

    const job = await waitForJob(baseUrl, created.job.id);
    assert.equal(job.status, "failed");
    assert.equal(job.items[0].status, "failed");
    assert.match(job.items[0].error, /无法生成视频输出/);
    assert.doesNotMatch(job.items[0].error, /ffmpeg failed|exit code|render stderr|node:|apple-motion-ui-/i);
  } finally {
    await close(server);
  }
});

test("UI maps runtime filesystem failures to a localized item error", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "apple-motion-ui-"));
  const input = path.join(tempDir, "cover.mov");
  const outDir = path.join(tempDir, "out");
  const fakeFfmpeg = await writeFakeFfmpegThatDeletesOutputDirectory(tempDir);
  const fakeFfprobe = await writeFakeCompliantFfprobe(tempDir);
  await writeFile(input, "");

  const { server, baseUrl } = await listen(createUiServer({ toolRoot }));
  try {
    const createResponse = await fetch(`${baseUrl}/api/jobs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        input,
        outDir,
        previewOnly: true,
        ffmpegPath: fakeFfmpeg,
        ffprobePath: fakeFfprobe
      })
    });
    const created = await createResponse.json();
    assert.equal(createResponse.status, 202);

    const job = await waitForJob(baseUrl, created.job.id);
    assert.equal(job.status, "failed");
    assert.equal(job.items[0].status, "failed");
    assert.match(job.items[0].error, /文件或文件夹不存在/);
    assert.doesNotMatch(job.items[0].error, /ENOENT|EACCES|EPERM|node:|apple-motion-ui-|\/var\/|\/Users|\.tmp|\.json/i);
    const errorLogText = job.logs.filter((entry) => entry.level === "error").map((entry) => entry.message).join("\n");
    assert.match(errorLogText, /文件或文件夹不存在/);
    assert.doesNotMatch(errorLogText, /ENOENT|EACCES|EPERM|node:|apple-motion-ui-|\/var\/|\/Users|\.tmp|\.json/i);
  } finally {
    await close(server);
  }
});

test("UI sanitizes late runtime output collisions after preflight", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "apple-motion-ui-"));
  const input = path.join(tempDir, "cover.mov");
  const outDir = path.join(tempDir, "out");
  const expectedPreview = path.join(outDir, "cover__apple-motion-3x4-preview.png");
  const fakeFfmpeg = await writeFakeFfmpegThatCreatesLateFinal(tempDir);
  const fakeFfprobe = await writeFakeCompliantFfprobe(tempDir);
  await writeFile(input, "");

  const { server, baseUrl } = await listen(createUiServer({ toolRoot }));
  try {
    const createResponse = await fetch(`${baseUrl}/api/jobs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        input,
        outDir,
        previewOnly: true,
        ffmpegPath: fakeFfmpeg,
        ffprobePath: fakeFfprobe
      })
    });
    const created = await createResponse.json();
    assert.equal(createResponse.status, 202);

    const job = await waitForJob(baseUrl, created.job.id);
    assert.equal(job.status, "failed");
    assert.equal(job.items[0].status, "failed");
    assert.equal(await readFile(expectedPreview, "utf8"), "late concurrent output");
    assert.match(job.items[0].error, /输出文件已存在/);
    assert.doesNotMatch(job.items[0].error, /Output already exists|Use --overwrite|cover__apple-motion|apple-motion-ui-|\/var\/|\/Users\//i);
    const errorLogText = job.logs.filter((entry) => entry.level === "error").map((entry) => entry.message).join("\n");
    assert.match(errorLogText, /输出文件已存在/);
    assert.doesNotMatch(errorLogText, /Output already exists|Use --overwrite|cover__apple-motion|apple-motion-ui-|\/var\/|\/Users\//i);
  } finally {
    await close(server);
  }
});

test("UI maps report write rollback failures to a localized item error", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "apple-motion-ui-"));
  const input = path.join(tempDir, "cover.mov");
  const outDir = path.join(tempDir, "out");
  const oldOutputs = {
    oneByOne: path.join(outDir, "cover__apple-motion-1x1.mp4"),
    threeByFour: path.join(outDir, "cover__apple-motion-3x4.mp4"),
    preview: path.join(outDir, "cover__apple-motion-3x4-preview.png"),
    reportJson: path.join(outDir, "cover__apple-motion-qc.json")
  };
  const blockedReportHtml = path.join(outDir, "cover__apple-motion-qc.html");
  const fakeFfmpeg = await writeCountingFfmpeg(tempDir, path.join(tempDir, "ffmpeg-counts.txt"), {
    createDirectoryAfterRender: blockedReportHtml
  });
  const fakeFfprobe = await writeFakeCompliantFfprobe(tempDir);
  await mkdir(outDir, { recursive: true });
  await writeFile(input, "");
  for (const [name, outputPath] of Object.entries(oldOutputs)) {
    await writeFile(outputPath, `old ${name}`);
  }

  const { server, baseUrl } = await listen(createUiServer({ toolRoot }));
  try {
    const confirmationResponse = await fetch(`${baseUrl}/api/jobs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        input,
        outDir,
        overwrite: true,
        ffmpegPath: fakeFfmpeg,
        ffprobePath: fakeFfprobe,
        encoder: "x264"
      })
    });
    const confirmationPayload = await confirmationResponse.json();
    assert.equal(confirmationResponse.status, 409);
    assert.equal(confirmationPayload.overwriteConfirmation.required, true);

    const createResponse = await fetch(`${baseUrl}/api/jobs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        input,
        outDir,
        overwrite: true,
        overwriteConfirmationToken: confirmationPayload.overwriteConfirmation.token,
        ffmpegPath: fakeFfmpeg,
        ffprobePath: fakeFfprobe,
        encoder: "x264"
      })
    });
    const created = await createResponse.json();
    assert.equal(createResponse.status, 202);

    const job = await waitForJob(baseUrl, created.job.id);
    assert.equal(job.status, "failed");
    assert.equal(job.items[0].status, "failed");
    assert.match(job.items[0].error, /无法写入质检报告/);
    const errorLogText = job.logs.filter((entry) => entry.level === "error").map((entry) => entry.message).join("\n");
    assert.match(errorLogText, /无法写入质检报告/);
    assert.doesNotMatch(`${job.items[0].error}\n${errorLogText}`, /Report path|already exists|EACCES|ENOTDIR|EEXIST|apple-motion-ui-|\/var\/|\/Users\//i);
    for (const [name, outputPath] of Object.entries(oldOutputs)) {
      assert.equal(await readFile(outputPath, "utf8"), `old ${name}`);
    }
  } finally {
    await close(server);
  }
});

test("UI keeps QC subprocess stderr out of issue summaries", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "apple-motion-ui-"));
  const input = path.join(tempDir, "cover.mov");
  const outDir = path.join(tempDir, "out");
  const fakeFfmpeg = await writeFailingQcFfmpeg(tempDir);
  const fakeFfprobe = await writeFakeCompliantFfprobe(tempDir);
  await writeFile(input, "");

  const { server, baseUrl } = await listen(createUiServer({ toolRoot }));
  try {
    const createResponse = await fetch(`${baseUrl}/api/jobs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        input,
        outDir,
        ffmpegPath: fakeFfmpeg,
        ffprobePath: fakeFfprobe,
        encoder: "x264"
      })
    });
    const created = await createResponse.json();
    assert.equal(createResponse.status, 202);

    const job = await waitForJob(baseUrl, created.job.id);
    assert.equal(job.status, "failed");
    const messages = job.items[0].result.issueSummary.issues.map((issue) => issue.message).join("\n");
    assert.match(messages, /质检命令失败/);
    assert.doesNotMatch(messages, /blackdetect failed|blackframe failed|freezedetect failed|exit code|qc stderr|node:|apple-motion-ui-/i);
  } finally {
    await close(server);
  }
});

test("UI localizes QC command startup failures in issue summaries", async () => {
  const source = await readFile(path.join(toolRoot, "ui", "server.mjs"), "utf8");
  const helperIndex = source.indexOf("function isQcSubprocessDiagnostic(message)");
  const helperSource = source.slice(helperIndex, source.indexOf("}", helperIndex));

  assert.notEqual(helperIndex, -1);
  assert.match(helperSource, /to run\\b/);
});

test("UI rejects a second job while one is queued or running", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "apple-motion-ui-"));
  const input = path.join(tempDir, "cover.mov");
  const outDir = path.join(tempDir, "out");
  const fakeFfmpeg = await writeFakeLongRunningFfmpeg(tempDir);
  const fakeFfprobe = await writeFakeCompliantFfprobe(tempDir);
  await writeFile(input, "");

  const { server, baseUrl } = await listen(createUiServer({ toolRoot }));
  try {
    const firstResponse = await fetch(`${baseUrl}/api/jobs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        input,
        outDir,
        previewOnly: true,
        ffmpegPath: fakeFfmpeg,
        ffprobePath: fakeFfprobe
      })
    });
    const first = await firstResponse.json();
    assert.equal(firstResponse.status, 202);
    await waitForFile(path.join(tempDir, "started.txt"));

    const secondResponse = await fetch(`${baseUrl}/api/jobs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        input,
        outDir,
        dryRun: true,
        encoder: "x264"
      })
    });
    const second = await secondResponse.json();
    assert.equal(secondResponse.status, 409);
    assert.equal(second.ok, false);

    await fetch(`${baseUrl}/api/jobs/${first.job.id}/cancel`, { method: "POST" });
    await waitForJob(baseUrl, first.job.id);
  } finally {
    await close(server);
  }
});

test("UI accepts only one concurrent job creation request", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "apple-motion-ui-"));
  const inputA = path.join(tempDir, "cover-a.mov");
  const inputB = path.join(tempDir, "cover-b.mov");
  const outDir = path.join(tempDir, "out");
  await writeFile(inputA, "");
  await writeFile(inputB, "");

  const { server, baseUrl } = await listen(createUiServer({ toolRoot }));
  try {
    const first = createSlowJobRequest(baseUrl, {
      input: inputA,
      outDir,
      dryRun: true,
      encoder: "x264"
    });
    const second = createSlowJobRequest(baseUrl, {
      input: inputB,
      outDir,
      dryRun: true,
      encoder: "x264"
    });

    await Promise.all([first.flushHeaders(), second.flushHeaders()]);
    const responses = await Promise.all([first.finish(), second.finish()]);
    const statuses = responses.map((response) => response.status).sort();
    assert.deepEqual(statuses, [202, 409]);

    const jobsResponse = await fetch(`${baseUrl}/api/jobs`);
    const jobsPayload = await jobsResponse.json();
    assert.equal(jobsPayload.jobs.length, 1);
  } finally {
    await close(server);
  }
});

async function createDryRunJob(baseUrl, input, outDir) {
  const response = await fetch(`${baseUrl}/api/jobs`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      input,
      outDir,
      dryRun: true,
      encoder: "x264",
      container: "mp4",
      mode: "scale-fill"
    })
  });
  const payload = await response.json();
  assert.equal(response.status, 202);
  return payload;
}

async function createPreviewJob(baseUrl, { input, outDir, ffmpegPath, ffprobePath }) {
  const response = await fetch(`${baseUrl}/api/jobs`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      input,
      outDir,
      previewOnly: true,
      ffmpegPath,
      ffprobePath
    })
  });
  const payload = await response.json();
  assert.equal(response.status, 202);
  return payload;
}

function deleteFinishedHistory(baseUrl) {
  return fetch(`${baseUrl}/api/jobs/history`, {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ confirm: "clear-finished-history" })
  });
}

function createFakeLargeJob({ itemCount = 60 } = {}) {
  const now = new Date().toISOString();
  return {
    id: "large-job",
    status: "running",
    options: {},
    createdAt: now,
    startedAt: now,
    finishedAt: null,
    current: `/covers/cover-${itemCount - 1}.mov`,
    total: itemCount,
    completed: itemCount - 1,
    passed: itemCount - 1,
    warnings: 1,
    failed: 0,
    planned: 0,
    cancelRequested: false,
    error: null,
    currentStage: { name: "render", target: "3x4", state: "active", at: now },
    logs: [{ at: now, level: "info", message: "large job running" }],
    inputFiles: Array.from({ length: itemCount }, (_, index) => `/covers/cover-${index}.mov`),
    items: Array.from({ length: itemCount }, (_, index) => {
      return {
        inputPath: `/covers/cover-${index}.mov`,
        status: index === itemCount - 1 ? "processing" : "warning",
        startedAt: now,
        finishedAt: index === itemCount - 1 ? null : now,
        error: null,
        currentStage: index === itemCount - 1 ? { name: "render", target: "3x4", state: "active", at: now } : null,
        stages: [],
        result: {
          inputPath: `/covers/cover-${index}.mov`,
          outputPlan: {
            oneByOne: `/out/cover-${index}__apple-motion-1x1.mp4`,
            threeByFour: `/out/cover-${index}__apple-motion-3x4.mp4`,
            preview: `/out/cover-${index}__apple-motion-3x4-preview.png`,
            reportHtml: `/out/cover-${index}__apple-motion-qc.html`
          },
          commands: [{ target: "3x4", command: "ffmpeg", args: ["..."] }],
          report: { ok: true, items: [] },
          colorConversion: { mode: "none" },
          outputFps: 30,
          assets: {
            preview: `/out/cover-${index}__apple-motion-3x4-preview.png`,
            reportHtml: `/out/cover-${index}__apple-motion-qc.html`
          },
          status: index === 59 ? "processing" : "warning",
          issueSummary: {
            errorCount: 0,
            warningCount: 1,
            issues: [{ target: "3x4", severity: "warning", message: "minor warning" }]
          }
        }
      };
    })
  };
}

function createSlowJobRequest(baseUrl, body) {
  const url = new URL("/api/jobs", baseUrl);
  const payload = JSON.stringify(body);
  let request;
  let responsePromise;

  return {
    flushHeaders() {
      return new Promise((resolve, reject) => {
        request = http.request(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Content-Length": Buffer.byteLength(payload)
          }
        }, (response) => {
          let raw = "";
          response.on("data", (chunk) => {
            raw += chunk.toString();
          });
          response.on("end", () => {
            responsePromise.resolve({
              status: response.statusCode,
              payload: JSON.parse(raw)
            });
          });
        });
        responsePromise = promiseWithResolvers();
        request.on("error", reject);
        request.write(payload.slice(0, 1), () => resolve());
      });
    },
    async finish() {
      request.end(payload.slice(1));
      return responsePromise.promise;
    }
  };
}

function postRawJson(url, payload, headers = {}) {
  return new Promise((resolve, reject) => {
    const request = http.request(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(payload),
        ...headers
      }
    }, (response) => {
      let raw = "";
      response.on("data", (chunk) => {
        raw += chunk.toString();
      });
      response.on("end", () => {
        resolve({
          status: response.statusCode,
          payload: JSON.parse(raw)
        });
      });
    });
    request.on("error", reject);
    request.end(payload);
  });
}

function getRawJson(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const request = http.request(url, {
      method: "GET",
      headers
    }, (response) => {
      let raw = "";
      response.on("data", (chunk) => {
        raw += chunk.toString();
      });
      response.on("end", () => {
        resolve({
          status: response.statusCode,
          raw,
          payload: JSON.parse(raw)
        });
      });
    });
    request.on("error", reject);
    request.end();
  });
}

async function authorizeGeneratedAsset(state, assetPath) {
  const resolved = path.resolve(assetPath);
  const assetId = authorizeGeneratedAssetPathOnly(state, assetPath);
  const [real, info] = await Promise.all([
    realpath(assetPath),
    stat(assetPath)
  ]);
  state.allowedAssetFingerprints.set(resolved, {
    realpath: real,
    dev: info.dev,
    ino: info.ino,
    size: info.size,
    mtimeMs: info.mtimeMs,
    ctimeMs: info.ctimeMs
  });
  return assetId;
}

function authorizeGeneratedAssetPathOnly(state, assetPath) {
  const resolved = path.resolve(assetPath);
  const existing = state.allowedAssetIds.get(resolved);
  if (existing) return existing;
  const assetId = `test-asset-${state.allowedAssetPaths.size + 1}`;
  state.allowedAssets.add(resolved);
  state.allowedAssetIds.set(resolved, assetId);
  state.allowedAssetPaths.set(assetId, resolved);
  return assetId;
}

function assetUrl(baseUrl, assetId) {
  return `${baseUrl}/api/asset?id=${encodeURIComponent(assetId)}`;
}

function promiseWithResolvers() {
  let resolve;
  let reject;
  const promise = new Promise((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, resolve, reject };
}

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      resolve({
        server,
        baseUrl: `http://127.0.0.1:${address.port}`
      });
    });
  });
}

function listenOnRandomPort(server) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      resolve({
        server,
        port: server.address().port
      });
    });
  });
}

async function getUnusedPort() {
  const server = http.createServer();
  const { port } = await listenOnRandomPort(server);
  await close(server);
  return port;
}

function close(server) {
  return new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
}

function startStandaloneUiServer(env = {}) {
  const child = spawn(process.execPath, ["./ui/server.mjs"], {
    cwd: toolRoot,
    env: Object.assign({}, process.env, env),
    stdio: ["ignore", "pipe", "pipe"]
  });
  const port = env.OPENFAD_MOTION_UI_PORT;
  const baseUrl = `http://127.0.0.1:${port}`;
  let stdout = "";
  let stderr = "";
  const exited = new Promise((resolve) => {
    child.on("close", (code, signal) => resolve({ code, signal, stdout, stderr }));
  });

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error(`Timed out waiting for standalone UI server to start. stdout=${stdout} stderr=${stderr}`));
    }, 5000);
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
      if (stdout.includes(`openFAD Motion UI ${baseUrl}`)) {
        clearTimeout(timeout);
        resolve({ child, baseUrl, exited });
      }
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.on("close", (code, signal) => {
      clearTimeout(timeout);
      if (!stdout.includes(`openFAD Motion UI ${baseUrl}`)) {
        reject(new Error(`Standalone UI server exited before start: code=${code} signal=${signal} stdout=${stdout} stderr=${stderr}`));
      }
    });
  });
}

function runStandaloneServer(env = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["./ui/server.mjs"], {
      cwd: toolRoot,
      env: Object.assign({}, process.env, env),
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    const timeout = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error("Timed out waiting for standalone UI server to exit."));
    }, 5000);
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timeout);
      resolve({ code, stdout, stderr });
    });
  });
}

async function writeFakeOutputFfmpeg(tempDir) {
  const scriptPath = path.join(tempDir, process.platform === "win32" ? "fake-output-ffmpeg.cmd" : "fake-output-ffmpeg.js");
  if (process.platform === "win32") {
    throw new Error("This test helper currently expects a POSIX-like test host.");
  }
  await writeFile(scriptPath, `#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const output = process.argv.at(-1);
if (output === "-") {
  process.exit(0);
}
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, "fake media");
process.exit(0);
`);
  await chmod(scriptPath, 0o755);
  return scriptPath;
}

async function writeFakeFfmpegThatCreatesLateFinal(tempDir) {
  const scriptPath = path.join(tempDir, "fake-ffmpeg-late-final.js");
  await writeFile(scriptPath, `#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const output = process.argv.at(-1);
if (output === "-") {
  process.exit(0);
}
const fileName = path.basename(output);
const match = fileName.match(/^\\.(.+)\\.\\d+\\.\\d+\\.[^.]+\\.tmp(\\.[^.]+)?$/);
const finalName = match
  ? (match[2] && !match[1].endsWith(match[2]) ? match[1] + match[2] : match[1])
  : fileName.replace(/^\\./, "");
const finalPath = path.join(path.dirname(output), finalName);
fs.mkdirSync(path.dirname(finalPath), { recursive: true });
fs.writeFileSync(output, "fake temp media");
fs.writeFileSync(finalPath, "late concurrent output");
process.exit(0);
`);
  await chmod(scriptPath, 0o755);
  return scriptPath;
}

async function writeFakeFfmpegThatDeletesOutputDirectory(tempDir) {
  const scriptPath = path.join(tempDir, "fake-ffmpeg-delete-output-dir.js");
  await writeFile(scriptPath, `#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const output = process.argv.at(-1);
if (output === "-") {
  process.exit(0);
}
const outputDir = path.dirname(output);
fs.mkdirSync(outputDir, { recursive: true });
fs.writeFileSync(output, "fake temp media");
fs.rmSync(outputDir, { recursive: true, force: true });
process.exit(0);
`);
  await chmod(scriptPath, 0o755);
  return scriptPath;
}

async function writeCountingFfmpeg(tempDir, countPath, { createDirectoryAfterRender = null } = {}) {
  const scriptPath = path.join(tempDir, "fake-counting-ffmpeg.js");
  await writeFile(scriptPath, `#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const countPath = ${JSON.stringify(countPath)};
const createDirectoryAfterRender = ${JSON.stringify(createDirectoryAfterRender)};
const args = process.argv.slice(2);
const joined = args.join(" ");
function mark(name) {
  fs.appendFileSync(countPath, name + "\\n");
}
if (args.includes("-encoders")) {
  mark("encoders");
  console.log(" V....D libx264 H.264 / AVC / MPEG-4 AVC / MPEG-4 part 10");
  process.exit(0);
}
if (joined.includes("color=c=black")) {
  mark("smoke");
  process.exit(0);
}
if (joined.includes("blackdetect=") || joined.includes("blackframe=") || joined.includes("freezedetect=")) {
  mark("qc");
  process.exit(0);
}
const output = args.at(-1);
if (output === "-") {
  process.exit(0);
}
mark("render");
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, "fake media");
if (createDirectoryAfterRender) {
  fs.mkdirSync(createDirectoryAfterRender, { recursive: true });
}
process.exit(0);
`);
  await chmod(scriptPath, 0o755);
  return scriptPath;
}

async function writeMixedSuccessFfmpeg(tempDir, failingBaseName) {
  const scriptPath = path.join(tempDir, "fake-mixed-success-ffmpeg.js");
  await writeFile(scriptPath, `#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const args = process.argv.slice(2);
const joined = args.join(" ");
const failingBaseName = ${JSON.stringify(failingBaseName)};
if (args.includes("-encoders")) {
  console.log(" V....D libx264 H.264 / AVC / MPEG-4 AVC / MPEG-4 part 10");
  process.exit(0);
}
if (joined.includes("color=c=black")) {
  process.exit(0);
}
if (joined.includes("blackdetect=") || joined.includes("blackframe=") || joined.includes("freezedetect=")) {
  process.exit(0);
}
if (joined.includes(failingBaseName + ".mov") || joined.includes(failingBaseName + "__apple-motion")) {
  console.error("render stderr with path " + args.at(-1));
  process.exit(13);
}
const output = args.at(-1);
if (output === "-") {
  process.exit(0);
}
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, "fake media");
process.exit(0);
`);
  await chmod(scriptPath, 0o755);
  return scriptPath;
}

async function writeFakeCompliantFfprobe(tempDir) {
  const scriptPath = path.join(tempDir, "fake-ffprobe.js");
  await writeFile(scriptPath, `#!/usr/bin/env node
const input = process.argv.at(-1);
const isOneByOne = input.includes("__apple-motion-1x1");
const width = isOneByOne ? 3840 : 2048;
const height = isOneByOne ? 3840 : 2732;
process.stdout.write(JSON.stringify({
  streams: [{
    codec_type: "video",
    codec_name: "h264",
    width,
    height,
    sample_aspect_ratio: "1:1",
    avg_frame_rate: "30/1",
    bit_rate: "50000000",
    color_space: "bt709",
    color_transfer: "bt709",
    color_primaries: "bt709",
    pix_fmt: "yuv420p",
    duration: "15.1"
  }],
  format: {
    duration: "15.1",
    bit_rate: "50000000"
  }
}));
`);
  await chmod(scriptPath, 0o755);
  return scriptPath;
}

async function writeHangingFfprobe(tempDir) {
  const scriptPath = path.join(tempDir, "hanging-ffprobe.js");
  await writeFile(scriptPath, `#!/usr/bin/env node
setInterval(() => {}, 1000);
`);
  await chmod(scriptPath, 0o755);
  return scriptPath;
}

async function writeInvalidJsonFfprobe(tempDir) {
  const scriptPath = path.join(tempDir, "bad-ffprobe.js");
  await writeFile(scriptPath, `#!/usr/bin/env node
console.log("not-json from fake ffprobe");
console.error("debug stderr with path " + process.argv.at(-1));
process.exit(0);
`);
  await chmod(scriptPath, 0o755);
  return scriptPath;
}

async function writeAmbiguousInputFfprobe(tempDir) {
  const scriptPath = path.join(tempDir, "ambiguous-input-ffprobe.js");
  await writeFile(scriptPath, `#!/usr/bin/env node
process.stdout.write(JSON.stringify({
  streams: [
    { codec_type: "video", codec_name: "h264", width: 2048, height: 2732, avg_frame_rate: "30/1", duration: "15.1" },
    { codec_type: "video", codec_name: "h264", width: 3840, height: 3840, avg_frame_rate: "30/1", duration: "15.1" },
    { codec_type: "audio", codec_name: "aac" }
  ],
  format: {
    duration: "15.1",
    bit_rate: "50000000"
  }
}));
`);
  await chmod(scriptPath, 0o755);
  return scriptPath;
}

async function writeFakeLongDurationFfprobe(tempDir) {
  const scriptPath = path.join(tempDir, "fake-long-duration-ffprobe.js");
  await writeFile(scriptPath, `#!/usr/bin/env node
process.stdout.write(JSON.stringify({
  streams: [{
    codec_type: "video",
    codec_name: "h264",
    width: 2048,
    height: 2732,
    sample_aspect_ratio: "1:1",
    avg_frame_rate: "30/1",
    bit_rate: "50000000",
    color_space: "bt709",
    color_transfer: "bt709",
    color_primaries: "bt709",
    pix_fmt: "yuv420p",
    duration: "3600"
  }],
  format: {
    duration: "3600",
    bit_rate: "50000000"
  }
}));
`);
  await chmod(scriptPath, 0o755);
  return scriptPath;
}

async function writeFakeUnsupportedColorFfprobe(tempDir) {
  const scriptPath = path.join(tempDir, "fake-unsupported-color-ffprobe.js");
  await writeFile(scriptPath, `#!/usr/bin/env node
process.stdout.write(JSON.stringify({
  streams: [{
    codec_type: "video",
    codec_name: "h264",
    width: 2048,
    height: 2732,
    sample_aspect_ratio: "1:1",
    avg_frame_rate: "30/1",
    bit_rate: "50000000",
    color_space: "bt470bg",
    color_transfer: "bt709",
    color_primaries: "bt470bg",
    pix_fmt: "yuv420p",
    duration: "15.1"
  }],
  format: {
    duration: "15.1",
    bit_rate: "50000000"
  }
}));
`);
  await chmod(scriptPath, 0o755);
  return scriptPath;
}

async function writeNoEncoderFfmpeg(tempDir) {
  const scriptPath = path.join(tempDir, "no-encoder-ffmpeg.js");
  await writeFile(scriptPath, `#!/usr/bin/env node
const args = process.argv.slice(2);
if (args.includes("-encoders")) {
  console.log(" V....D mpeg4 MPEG-4 part 2");
  process.exit(0);
}
process.exit(0);
`);
  await chmod(scriptPath, 0o755);
  return scriptPath;
}

async function writeFailingRenderFfmpeg(tempDir) {
  const scriptPath = path.join(tempDir, "failing-render-ffmpeg.js");
  await writeFile(scriptPath, `#!/usr/bin/env node
console.error("render stderr with path " + process.argv.at(-1));
process.exit(13);
`);
  await chmod(scriptPath, 0o755);
  return scriptPath;
}

async function writeFailingQcFfmpeg(tempDir) {
  const scriptPath = path.join(tempDir, "failing-qc-ffmpeg.js");
  await writeFile(scriptPath, `#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const args = process.argv.slice(2);
const joined = args.join(" ");
if (args.includes("-encoders")) {
  console.log(" V....D libx264 H.264 / AVC / MPEG-4 AVC / MPEG-4 part 10");
  process.exit(0);
}
if (joined.includes("color=c=black")) {
  process.exit(0);
}
if (joined.includes("blackdetect=") || joined.includes("blackframe=") || joined.includes("freezedetect=")) {
  console.error("qc stderr with path " + args.at(-1));
  process.exit(13);
}
const output = args.at(-1);
if (output === "-") {
  process.exit(0);
}
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, "fake media");
process.exit(0);
`);
  await chmod(scriptPath, 0o755);
  return scriptPath;
}

async function countMarker(filePath, marker) {
  try {
    const content = await readFile(filePath, "utf8");
    return content.split(/\r?\n/).filter((line) => line === marker).length;
  } catch (error) {
    if (error.code === "ENOENT") return 0;
    throw error;
  }
}

async function writeFakeLongRunningFfmpeg(tempDir) {
  const scriptPath = path.join(tempDir, process.platform === "win32" ? "fake-ffmpeg.cmd" : "fake-ffmpeg.js");
  if (process.platform === "win32") {
    throw new Error("This test helper currently expects a POSIX-like test host.");
  }
  await writeFile(scriptPath, `#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const dir = ${JSON.stringify(tempDir)};
fs.writeFileSync(path.join(dir, "pid.txt"), String(process.pid));
fs.writeFileSync(path.join(dir, "started.txt"), String(Date.now()));
process.on("SIGTERM", () => {
  fs.writeFileSync(path.join(dir, "terminated.txt"), String(Date.now()));
  process.exit(143);
});
setTimeout(() => {
  fs.writeFileSync(path.join(dir, "completed.txt"), String(Date.now()));
  process.exit(0);
}, 5000);
`);
  await chmod(scriptPath, 0o755);
  return scriptPath;
}

async function waitForFile(filePath, timeoutMs = 5000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      await access(filePath);
      return readFile(filePath, "utf8");
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }
  throw new Error(`Timed out waiting for ${filePath}`);
}

async function waitForCondition(predicate, timeoutMs = 1000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (predicate()) return;
    await delay(25);
  }
  throw new Error("Timed out waiting for condition.");
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function captureConsoleErrors(action) {
  const original = console.error;
  const messages = [];
  console.error = (...args) => {
    messages.push(args.map(String).join(" "));
  };
  try {
    await action();
    return messages;
  } finally {
    console.error = original;
  }
}

async function terminatePidFile(pidPath) {
  try {
    const rawPid = await readFile(pidPath, "utf8");
    const pid = Number(rawPid.trim());
    if (!Number.isFinite(pid)) return;
    try {
      process.kill(pid, "SIGTERM");
    } catch (error) {
      if (error.code !== "ESRCH") throw error;
    }
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
}

async function waitForStoredJob(jobStorePath, jobId, status, timeoutMs = 5000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const payload = JSON.parse(await readFile(jobStorePath, "utf8"));
      const job = payload.jobs?.find((candidate) => candidate.id === jobId);
      if (job?.status === status) return job;
    } catch (error) {
      if (error.code !== "ENOENT" && error.name !== "SyntaxError") throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`Timed out waiting for stored UI job ${jobId} to become ${status}.`);
}

async function waitForPersistTimer(state, timeoutMs = 5000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (state.persistTimer) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("Timed out waiting for debounced UI job store persist.");
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function waitForJob(baseUrl, jobId, timeoutMs = 15_000) {
  const terminalStatuses = new Set(["succeeded", "warning", "failed", "cancelled", "planned", "previewed"]);
  const started = Date.now();
  let lastJob = null;
  while (Date.now() - started < timeoutMs) {
    const response = await fetch(`${baseUrl}/api/jobs/${jobId}`);
    const payload = await response.json();
    lastJob = payload.job;
    if (terminalStatuses.has(payload.job.status)) {
      return payload.job;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  const stage = lastJob?.currentStage
    ? `${lastJob.currentStage.name}:${lastJob.currentStage.target ?? "job"}:${lastJob.currentStage.state}`
    : "none";
  const logTail = (lastJob?.logs ?? []).slice(-3).map((entry) => entry.message).join(" | ") || "none";
  throw new Error(`Timed out waiting for UI job ${jobId}; last status ${lastJob?.status ?? "unknown"}; stage ${stage}; logs ${logTail}.`);
}

async function getFullJob(baseUrl, jobId) {
  const response = await fetch(`${baseUrl}/api/jobs/${jobId}?full=1`);
  const payload = await response.json();
  assert.equal(response.status, 200);
  return payload.job;
}

async function waitForMissingJob(baseUrl, jobId) {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const response = await fetch(`${baseUrl}/api/jobs/${jobId}`);
    if (response.status === 404) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("Timed out waiting for UI job to be pruned.");
}
