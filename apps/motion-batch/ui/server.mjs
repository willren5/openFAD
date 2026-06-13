#!/usr/bin/env node
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { constants as FS_CONSTANTS, createReadStream, readFileSync, realpathSync, statSync } from "node:fs";
import { access, lstat, mkdir, open, realpath, rename, stat, unlink, writeFile } from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { assertInputOutputDirectoriesAreSeparate, assertSafeOutputPaths, collectExistingOutputFiles, collectInputFiles, prepareBatchContext, processFile } from "../src/batch.mjs";
import { normalizeBitrate, normalizeFrameRate } from "../src/cli.mjs";
import { SAFE_AREA_3X4 } from "../src/ffmpegArgs.mjs";
import { isAbortError, ProcessAbortedError } from "../src/probe.mjs";
import { APPLE_TARGETS } from "../src/spec.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DEFAULT_TOOL_ROOT = path.resolve(__dirname, "..");
const DEFAULT_STATIC_ROOT = path.join(__dirname, "public");
const DEFAULT_HOST = process.env.OPENFAD_MOTION_UI_HOST ?? "127.0.0.1";
const DEFAULT_PORT = Number(process.env.OPENFAD_MOTION_UI_PORT ?? process.env.PORT ?? 4387);
const DEFAULT_OUT_DIR = path.join(os.homedir(), "Documents", "openFAD Motion Output");
const DEFAULT_MAX_JOBS = 20;
const DEFAULT_MAX_LOGS_PER_JOB = 500;
const DEFAULT_POLL_ITEMS_LIMIT = 50;
const DEFAULT_FULL_ITEMS_LIMIT = 200;
const DEFAULT_STORED_ITEMS_LIMIT = 200;
const DEFAULT_STORED_INPUT_FILES_LIMIT = 200;
const DEFAULT_PERSIST_DEBOUNCE_MS = 750;
const DEFAULT_SHUTDOWN_TIMEOUT_MS = 5000;
const DEFAULT_JOB_CREATION_BODY_TIMEOUT_MS = 10_000;
const DEFAULT_JOB_STORE_MAX_BYTES = 5 * 1024 * 1024;
const DEFAULT_MAX_OVERWRITE_CONFIRMATIONS = 50;
const HISTORY_CLEAR_CONFIRMATION = "clear-finished-history";
const RESTORE_RESET_CONFIRMATION = "reset-restore-failure";
const OVERWRITE_CONFIRMATION_TTL_MS = 5 * 60 * 1000;
const REVEAL_LAUNCH_SETTLE_MS = 1000;
const SHUTDOWN_POLL_MS = 25;
const USER_FACING_PERSISTENCE_ERROR = "任务恢复记录暂时无法写入。请确认应用数据目录可写后重试。";
const USER_FACING_RESTORE_ERROR = "无法读取本地任务恢复记录。请重新开始任务。";
const USER_FACING_RESTORE_JOB_BLOCKED = "无法恢复上次任务状态。请先重置本地任务恢复记录后再开始新任务。";
const USER_FACING_RESTORE_CLEAR_BLOCKED = "无法恢复上次任务状态。请先重置本地任务恢复记录后再清除历史任务记录。";
const USER_FACING_RESTORE_RESET_CONFIRMATION = "需要确认重置本地任务恢复记录。";
const USER_FACING_RESTORE_RESET_ERROR = "无法重置本地任务恢复记录。请检查应用数据目录权限后重试。";
const USER_FACING_CUSTOM_FFMPEG_PATH_ERROR = "无法访问自定义 FFmpeg 路径。请确认文件存在且可执行。";
const USER_FACING_CUSTOM_FFPROBE_PATH_ERROR = "无法访问自定义 FFprobe 路径。请确认文件存在且可执行。";
const USER_FACING_REVEAL_ACCESS_ERROR = "无法访问要显示的文件。请确认它仍在输出目录且有读取权限。";
const USER_FACING_REVEAL_LAUNCH_ERROR = "无法打开系统文件管理器。请在输出目录中手动查看文件。";
const USER_FACING_FILE_READ_ERROR = "无法读取文件。请确认文件仍在输出目录且有读取权限。";
const USER_FACING_UNEXPECTED_API_ERROR = "服务器处理请求失败。请重试或查看控制台日志。";
const USER_FACING_JOB_CREATION_CANCELLED = "已停止检查输入和输出路径。";
const USER_FACING_BROWSER_DIAGNOSTIC = "本地技术诊断已隐藏。请重试；如果持续出现，请重启应用。";
const APP_CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "base-uri 'none'",
  "object-src 'none'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data:",
  "media-src 'self'",
  "connect-src 'self'",
  "form-action 'none'",
  "frame-ancestors 'none'"
].join("; ");
const JOB_MAX_LOGS_PER_JOB = Symbol("jobMaxLogsPerJob");
const JOB_STATE = Symbol("jobState");
const JOB_RESTORE_FAILURE = Symbol("jobRestoreFailure");

const MIME_TYPES = new Map([
  [".html", "text/html; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".png", "image/png"],
  [".svg", "image/svg+xml; charset=utf-8"],
  [".mp4", "video/mp4"],
  [".mov", "video/quicktime"]
]);

const DEFAULT_JOB_OPTIONS = {
  mode: "scale-fill",
  fps: "auto",
  bitrate: "50M",
  container: "mp4",
  encoder: "auto",
  dryRun: false,
  qcOnly: false,
  previewOnly: false,
  overwrite: false
};

export function defaultJobStorePath({ appDataDir } = {}) {
  const explicitPath = process.env.OPENFAD_MOTION_UI_JOB_STORE;
  if (explicitPath) return path.resolve(explicitPath);

  const baseDir = appDataDir ? path.resolve(appDataDir) : defaultAppDataDir();
  return path.join(baseDir, "jobs.json");
}

export function createUiState({
  maxJobs = DEFAULT_MAX_JOBS,
  maxLogsPerJob = DEFAULT_MAX_LOGS_PER_JOB,
  storedItemsLimit = DEFAULT_STORED_ITEMS_LIMIT,
  persistDebounceMs = DEFAULT_PERSIST_DEBOUNCE_MS,
  jobStoreMaxBytes = DEFAULT_JOB_STORE_MAX_BYTES,
  jobStorePath
} = {}) {
  const state = {
    jobs: new Map(),
    allowedAssets: new Set(),
    allowedAssetFingerprints: new Map(),
    allowedAssetIds: new Map(),
    allowedAssetPaths: new Map(),
    activeAbortControllers: new Map(),
    overwriteConfirmations: new Map(),
    jobCreationPending: false,
    jobCreationAbortController: null,
    jobStorePath: jobStorePath ? path.resolve(jobStorePath) : null,
    persistPromise: Promise.resolve(),
    persistDirty: false,
    persistScheduled: false,
    persistTimer: null,
    persistDebounceMs: normalizeRetentionLimit(persistDebounceMs, "persistDebounceMs", { min: 0 }),
    jobStoreMaxBytes: normalizeRetentionLimit(jobStoreMaxBytes, "jobStoreMaxBytes", { min: 1 }),
    storedItemsLimit: normalizeRetentionLimit(storedItemsLimit, "storedItemsLimit", { min: 0 }),
    lastPersistErrorMessage: null,
    restoreFailed: false,
    restoreFailureMessage: null,
    maxJobs: normalizeRetentionLimit(maxJobs, "maxJobs", { min: 0 }),
    maxLogsPerJob: normalizeRetentionLimit(maxLogsPerJob, "maxLogsPerJob", { min: 0 })
  };
  restoreStateFromStore(state);
  return state;
}

export async function flushUiState(state) {
  if (!state?.jobStorePath) return;
  if (hasOnlyRestoreFailureJobs(state)) return;
  await persistStateSoon(state, { immediate: true });
  await state.persistPromise;
  if (state.persistError) throw state.persistError;
}

export async function shutdownUiState(state, {
  timeoutMs = DEFAULT_SHUTDOWN_TIMEOUT_MS,
  reason = "应用正在退出，已停止当前任务。"
} = {}) {
  if (!state) return;
  requestJobCreationCancellation(state);
  requestActiveJobCancellation(state, { reason });
  try {
    await waitForStateToBecomeIdle(state, { timeoutMs });
  } finally {
    await flushUiState(state);
  }
}

export function createUiServer({
  toolRoot = DEFAULT_TOOL_ROOT,
  staticRoot = DEFAULT_STATIC_ROOT,
  defaultOutDir = DEFAULT_OUT_DIR,
  state = null,
  jobStorePath = null,
  revealLauncher = openPathInSystemShell,
  assetBeforeSendHook = null,
  revealBeforeLaunchHook = null,
  jobCreationBodyTimeoutMs = DEFAULT_JOB_CREATION_BODY_TIMEOUT_MS
} = {}) {
  const normalizedJobCreationBodyTimeoutMs = normalizeTimeoutMs(jobCreationBodyTimeoutMs, "jobCreationBodyTimeoutMs");
  state ??= createUiState({ jobStorePath });
  return http.createServer(async (request, response) => {
    try {
      const requestUrl = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
      assertTrustedHost(request);
      if (requestUrl.pathname.startsWith("/api/")) {
        assertTrustedLocalApiRequest(request);
      }

      if (requestUrl.pathname === "/api/health" && request.method === "GET") {
        return sendApiJson(response, state, {
          ok: true,
          toolRootLabel: path.basename(toolRoot),
          platform: process.platform,
          arch: process.arch,
          node: process.version,
          videoTools: {
            ffmpeg: buildVideoToolHealth("ffmpeg", process.env.FFMPEG_PATH),
            ffprobe: buildVideoToolHealth("ffprobe", process.env.FFPROBE_PATH)
          }
        });
      }

      if (requestUrl.pathname === "/api/spec" && request.method === "GET") {
        return sendApiJson(response, state, {
          ok: true,
          targets: APPLE_TARGETS,
          safeArea3x4: SAFE_AREA_3X4,
          defaults: {
            ...DEFAULT_JOB_OPTIONS,
            outDir: defaultOutDir
          },
          encoders: ["auto", "x264", "nvenc", "qsv"],
          containers: ["mp4", "mov"],
          modes: ["scale-fill", "blur-extend"]
        });
      }

      if (requestUrl.pathname === "/api/jobs" && request.method === "GET") {
        return sendApiJson(response, state, {
          ok: true,
          jobs: [...state.jobs.values()].map(summarizeJob)
        });
      }

      if (requestUrl.pathname === "/api/jobs" && request.method === "POST") {
        assertTrustedStateChange(request);
        if (state.restoreFailed) {
          return sendApiJson(response, state, {
            ok: false,
            error: USER_FACING_RESTORE_JOB_BLOCKED
          }, 409);
        }
        if (hasActiveJob(state)) {
          return sendApiJson(response, state, {
            ok: false,
            error: "已有任务正在运行。请等待完成或先停止当前任务。"
          }, 409);
        }
        const creationAbortController = new AbortController();
        const creationSignal = creationAbortController.signal;
        const abortPendingCreation = () => {
          if (!response.writableEnded && !creationSignal.aborted) {
            creationAbortController.abort();
          }
        };
        state.jobCreationPending = true;
        state.jobCreationAbortController = creationAbortController;
        request.on("aborted", abortPendingCreation);
        response.on("close", abortPendingCreation);
        try {
          const body = await readJsonBody(request, {
            signal: creationSignal,
            timeoutMs: normalizedJobCreationBodyTimeoutMs
          });
          throwIfPreflightAborted(creationSignal);
          const options = normalizeJobOptions(body, { toolRoot, defaultOutDir });
          await preflightInputOutputDirectories(options, { signal: creationSignal });
          const inputFiles = await preflightInputFiles(options, { signal: creationSignal });
          await preflightOutputDirectory(options, { signal: creationSignal });
          await preflightOutputFiles(inputFiles, options, { signal: creationSignal });
          await preflightCustomToolPaths(options, { signal: creationSignal });
          const overwriteConfirmation = await resolveOverwriteConfirmation(inputFiles, options, body.overwriteConfirmationToken, state, { signal: creationSignal });
          if (overwriteConfirmation) {
            return sendApiJson(response, state, {
              ok: false,
              error: overwriteConfirmation.error,
              overwriteConfirmation
            }, 409);
          }
          throwIfPreflightAborted(creationSignal);
          const job = createJob(options, inputFiles, state);
          state.jobs.set(job.id, job);
          try {
            throwIfPreflightAborted(creationSignal);
            await persistStateSoon(state, { immediate: true });
            throwIfPreflightAborted(creationSignal);
            if (state.persistError) {
              await rollbackPendingJobCreation(state, job);
              throw httpError(USER_FACING_PERSISTENCE_ERROR, 500, { expose: true });
            }
          } catch (error) {
            if (isAbortError(error) || creationSignal.aborted) {
              await rollbackPendingJobCreation(state, job);
            }
            throw error;
          }
          queueMicrotask(() => {
            runJob(job, { state }).catch((error) => {
              const message = userFacingRuntimeError(error, job.options);
              job.status = "failed";
              job.error = message;
              job.failed = Math.max(job.failed ?? 0, 1);
              job.finishedAt = new Date().toISOString();
              appendLog(job, "error", message);
              trimJobItems(job);
              pruneState(state);
              persistStateSoon(state, { immediate: true });
            });
          });
          return sendApiJson(response, state, { ok: true, job: summarizeJob(job) }, 202);
        } catch (error) {
          if (isAbortError(error) || creationSignal.aborted) {
            if (!response.writableEnded && !response.destroyed) {
              return sendApiJson(response, state, {
                ok: false,
                error: USER_FACING_JOB_CREATION_CANCELLED
              }, 499);
            }
            return;
          }
          throw error;
        } finally {
          request.off("aborted", abortPendingCreation);
          response.off("close", abortPendingCreation);
          if (state.jobCreationAbortController === creationAbortController) {
            state.jobCreationAbortController = null;
            state.jobCreationPending = false;
          }
        }
      }

      if (requestUrl.pathname === "/api/jobs/recovery" && request.method === "DELETE") {
        assertTrustedStateChange(request);
        const body = await readJsonBody(request, { timeoutMs: normalizedJobCreationBodyTimeoutMs });
        requireRestoreResetConfirmation(body);
        const result = await resetRestoreFailure(state);
        return sendApiJson(response, state, {
          ok: true,
          ...result,
          jobs: [...state.jobs.values()].map(summarizeJob)
        });
      }

      if (requestUrl.pathname === "/api/jobs/history" && request.method === "DELETE") {
        assertTrustedStateChange(request);
        const body = await readJsonBody(request, { timeoutMs: normalizedJobCreationBodyTimeoutMs });
        requireHistoryClearConfirmation(body);
        const { cleared } = await clearFinishedJobHistory(state);
        return sendApiJson(response, state, {
          ok: true,
          cleared,
          jobs: [...state.jobs.values()].map(summarizeJob)
        });
      }

      const jobMatch = requestUrl.pathname.match(/^\/api\/jobs\/(?<id>[^/]+)$/);
      if (jobMatch && request.method === "GET") {
        const job = state.jobs.get(jobMatch.groups.id);
        if (!job) return sendApiJson(response, state, { ok: false, error: "找不到任务。" }, 404);
        const full = requestUrl.searchParams.get("full") === "1";
        return sendApiJson(response, state, { ok: true, job: full ? summarizeJobFull(job) : summarizeJobDetail(job) });
      }

      const pollMatch = requestUrl.pathname.match(/^\/api\/jobs\/(?<id>[^/]+)\/poll$/);
      if (pollMatch && request.method === "GET") {
        const job = state.jobs.get(pollMatch.groups.id);
        if (!job) return sendApiJson(response, state, { ok: false, error: "找不到任务。" }, 404);
        return sendApiJson(response, state, { ok: true, job: summarizeJobPoll(job) });
      }

      const cancelMatch = requestUrl.pathname.match(/^\/api\/jobs\/(?<id>[^/]+)\/cancel$/);
      if (cancelMatch && request.method === "POST") {
        assertTrustedStateChange(request);
        const job = state.jobs.get(cancelMatch.groups.id);
        if (!job) return sendApiJson(response, state, { ok: false, error: "找不到任务。" }, 404);
        if (!isActiveJob(job)) {
          return sendApiJson(response, state, { ok: false, error: "任务已经结束，不能停止。" }, 409);
        }
        job.cancelRequested = true;
        recordJobStage(job, { name: "cancel", target: "job", state: "active" });
        const controller = state.activeAbortControllers.get(job.id);
        if (controller && !controller.signal.aborted) controller.abort();
        appendLog(job, "warn", controller ? "已请求停止。正在停止当前处理。" : "已请求停止。任务会在开始前停止。");
        await persistStateSoon(state, { immediate: true });
        return sendApiJson(response, state, { ok: true, job: summarizeJob(job) });
      }

      if (requestUrl.pathname === "/api/asset" && request.method === "GET") {
        return await sendAsset(requestUrl, response, state, { beforeSendHook: assetBeforeSendHook });
      }

      if (requestUrl.pathname === "/api/reveal" && request.method === "POST") {
        assertTrustedStateChange(request);
        const body = await readJsonBody(request, { timeoutMs: normalizedJobCreationBodyTimeoutMs });
        const requestedPath = resolveRequestedAssetPath(state, requireString(body.id, "需要资产 ID。"));
        if (!await isAllowedAssetPath(state, requestedPath)) {
          throw forbiddenAssetAccess();
        }
        const expectedFingerprint = state.allowedAssetFingerprints.get(requestedPath) ?? null;
        if (revealBeforeLaunchHook) await revealBeforeLaunchHook(requestedPath);
        await revealPath(requestedPath, { revealLauncher, expectedFingerprint });
        return sendApiJson(response, state, { ok: true });
      }

      if (request.method === "GET") {
        return await sendStatic(requestUrl.pathname, response, { staticRoot });
      }

      return sendJson(response, { ok: false, error: "未找到。" }, 404);
    } catch (error) {
      if (isClientAbortedRequest(error, request)) return;
      const statusCode = error.statusCode ?? 500;
      if (error.closeRequestAfterResponse) {
        response.once("finish", () => request.destroy());
      }
      return sendApiJson(response, state, {
        ok: false,
        error: userFacingApiError(error),
        field: error.field
      }, statusCode);
    }
  });
}

export function normalizeJobOptions(body, {
  toolRoot = DEFAULT_TOOL_ROOT,
  defaultOutDir = DEFAULT_OUT_DIR
} = {}) {
  const input = requireString(body.input, "需要输入文件或文件夹路径。");
  const outDir = optionalString(body.outDir) || defaultOutDir;
  const mode = requireChoice(body.mode ?? DEFAULT_JOB_OPTIONS.mode, ["scale-fill", "blur-extend"], "mode");
  const fps = normalizeUiFrameRate(optionalString(body.fps) || DEFAULT_JOB_OPTIONS.fps);
  const bitrate = normalizeUiBitrate(optionalString(body.bitrate) || DEFAULT_JOB_OPTIONS.bitrate);
  const container = requireChoice(body.container ?? DEFAULT_JOB_OPTIONS.container, ["mp4", "mov"], "container");
  const encoder = requireChoice(body.encoder ?? DEFAULT_JOB_OPTIONS.encoder, ["x264", "nvenc", "qsv", "auto"], "encoder");
  const qcOnly = Boolean(body.qcOnly);
  const previewOnly = Boolean(body.previewOnly);
  const ffmpegPath = optionalString(body.ffmpegPath);
  const ffprobePath = optionalString(body.ffprobePath);
  const probeTimeoutMs = optionalPositiveInteger(body.probeTimeoutMs, "probeTimeoutMs", "probeTimeoutMs 必须是大于等于 1 的整数。");

  if (qcOnly && previewOnly) {
    const error = new Error("不能同时启用“只质检”和“只生成预览”。");
    error.statusCode = 400;
    throw error;
  }

  const options = {
    input,
    outDir,
    mode,
    fps,
    bitrate,
    container,
    encoder,
    dryRun: Boolean(body.dryRun),
    qcOnly,
    previewOnly,
    overwrite: Boolean(body.overwrite)
  };
  if (ffmpegPath) options.ffmpegPath = ffmpegPath;
  if (ffprobePath) options.ffprobePath = ffprobePath;
  if (probeTimeoutMs !== null) options.probeTimeoutMs = probeTimeoutMs;
  return options;
}

function createJob(options, inputFiles = [], state = createUiState()) {
  const now = new Date().toISOString();
  return {
    id: randomUUID(),
    status: "queued",
    options,
    createdAt: now,
    startedAt: null,
    finishedAt: null,
    current: null,
    total: inputFiles.length,
    completed: 0,
    passed: 0,
    warnings: 0,
    failed: 0,
    planned: 0,
    cancelRequested: false,
    error: null,
    currentStage: null,
    items: [],
    logs: [],
    inputFiles,
    [JOB_MAX_LOGS_PER_JOB]: state.maxLogsPerJob,
    [JOB_STATE]: state
  };
}

function restoreStateFromStore(state) {
  if (!state.jobStorePath) return;

  let payload;
  try {
    const info = statSync(state.jobStorePath);
    if (!info.isFile()) {
      throw new TypeError("Job store path must be a file.");
    }
    if (info.size > state.jobStoreMaxBytes) {
      const error = new Error("Job store file is too large.");
      error.code = "JOB_STORE_TOO_LARGE";
      throw error;
    }
    payload = JSON.parse(readFileSync(state.jobStorePath, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return;
    restoreStoreFailure(state, error);
    return;
  }

  try {
    if (!payload || typeof payload !== "object") {
      throw new TypeError("Job store payload must be an object.");
    }
    const rawJobs = payload.jobs ?? [];
    if (!Array.isArray(rawJobs)) {
      throw new TypeError("Job store jobs must be an array.");
    }
    const recoveredJobIds = new Set();
    for (const rawJob of rawJobs) {
      const job = normalizeRestoredJob(rawJob, state);
      if (markInterruptedIfActive(job)) recoveredJobIds.add(job.id);
      reauthorizeRestoredJobAssets(state, job);
      state.jobs.set(job.id, job);
    }
    pruneState(state, { keepJobIds: recoveredJobIds });
    persistStateSoon(state, { immediate: true });
  } catch (error) {
    restoreStoreFailure(state, error);
  }
}

function restoreStoreFailure(state, error) {
  logServerDiagnostic("无法读取本地任务记录", error);
  state.restoreFailed = true;
  state.restoreFailureMessage = USER_FACING_RESTORE_ERROR;
  state.jobs.clear();
  state.allowedAssets.clear();
  state.allowedAssetFingerprints.clear();
  state.allowedAssetIds.clear();
  state.allowedAssetPaths.clear();
  const job = createInterruptedStoreJob(error, state);
  state.jobs.set(job.id, job);
}

function createInterruptedStoreJob(error, state) {
  const now = new Date().toISOString();
  return {
    id: randomUUID(),
    status: "failed",
    options: {},
    createdAt: now,
    startedAt: null,
    finishedAt: now,
    current: null,
    total: 0,
    completed: 0,
    passed: 0,
    warnings: 0,
    failed: 1,
    planned: 0,
    cancelRequested: false,
    error: USER_FACING_RESTORE_ERROR,
    currentStage: null,
    items: [],
    logs: [{ at: now, level: "error", message: USER_FACING_RESTORE_ERROR }],
    inputFiles: [],
    [JOB_RESTORE_FAILURE]: true,
    [JOB_MAX_LOGS_PER_JOB]: state.maxLogsPerJob,
    [JOB_STATE]: state
  };
}

function normalizeRestoredJob(rawJob, state) {
  if (!isRecord(rawJob)) {
    throw new TypeError("Stored job entry must be an object.");
  }
  const restoredItems = normalizeRestoredItems(rawJob.items, state.storedItemsLimit, {
    itemsOffset: normalizeStoredOffset(rawJob.itemsOffset),
    totalItems: normalizeStoredOffset(rawJob.totalItems)
  });
  const restoredInputFiles = normalizeRestoredInputFiles(rawJob.inputFiles, {
    inputFilesOffset: normalizeStoredOffset(rawJob.inputFilesOffset),
    totalInputFiles: normalizeStoredOffset(rawJob.totalInputFiles)
  });
  const restoredLogs = normalizeRestoredLogs(rawJob.logs, state.maxLogsPerJob, {
    logsOffset: normalizeStoredOffset(rawJob.logsOffset),
    totalLogs: normalizeStoredOffset(rawJob.totalLogs)
  });
  return {
    id: String(rawJob.id ?? randomUUID()),
    status: String(rawJob.status ?? "failed"),
    options: rawJob.options && typeof rawJob.options === "object" ? rawJob.options : {},
    createdAt: rawJob.createdAt ?? new Date().toISOString(),
    startedAt: rawJob.startedAt ?? null,
    finishedAt: rawJob.finishedAt ?? null,
    current: rawJob.current ?? null,
    total: Number.isFinite(rawJob.total) ? rawJob.total : 0,
    completed: Number.isFinite(rawJob.completed) ? rawJob.completed : 0,
    passed: Number.isFinite(rawJob.passed) ? rawJob.passed : 0,
    warnings: Number.isFinite(rawJob.warnings) ? rawJob.warnings : 0,
    failed: Number.isFinite(rawJob.failed) ? rawJob.failed : 0,
    planned: Number.isFinite(rawJob.planned) ? rawJob.planned : 0,
    cancelRequested: Boolean(rawJob.cancelRequested),
    error: rawJob.error ?? null,
    currentStage: rawJob.currentStage ?? null,
    itemsOffset: restoredItems.offset,
    totalItems: restoredItems.total,
    items: restoredItems.values,
    logsOffset: restoredLogs.offset,
    totalLogs: restoredLogs.total,
    logs: restoredLogs.values,
    inputFilesOffset: restoredInputFiles.offset,
    totalInputFiles: restoredInputFiles.total,
    inputFiles: restoredInputFiles.values,
    [JOB_MAX_LOGS_PER_JOB]: state.maxLogsPerJob,
    [JOB_STATE]: state
  };
}

function normalizeRestoredItems(rawItems, maxItems, { itemsOffset = 0, totalItems = 0 } = {}) {
  const items = Array.isArray(rawItems) ? rawItems.map(normalizeRestoredItem) : [];
  const clipped = sliceForStorage(items, maxItems, itemsOffset);
  return {
    values: clipped.values,
    offset: clipped.offset,
    total: Math.max(totalItems, clipped.offset + clipped.values.length)
  };
}

function normalizeRestoredInputFiles(rawInputFiles, { inputFilesOffset = 0, totalInputFiles = 0 } = {}) {
  const inputFiles = Array.isArray(rawInputFiles) ? rawInputFiles : [];
  const clipped = sliceForStorage(inputFiles, DEFAULT_STORED_INPUT_FILES_LIMIT, inputFilesOffset);
  return {
    values: clipped.values,
    offset: clipped.offset,
    total: Math.max(totalInputFiles, clipped.offset + clipped.values.length)
  };
}

function normalizeRestoredLogs(rawLogs, maxLogsPerJob, { logsOffset = 0, totalLogs = 0 } = {}) {
  const logs = Array.isArray(rawLogs) ? rawLogs : [];
  const maxLogs = Number.isInteger(maxLogsPerJob) && maxLogsPerJob >= 0
    ? maxLogsPerJob
    : DEFAULT_MAX_LOGS_PER_JOB;
  const clipped = sliceForStorage(logs, maxLogs, logsOffset);
  const total = Math.max(totalLogs, clipped.offset + clipped.values.length);
  return {
    values: clipped.values,
    offset: clipped.offset,
    total
  };
}

function normalizeRestoredItem(rawItem) {
  if (!isRecord(rawItem)) {
    throw new TypeError("Stored job item must be an object.");
  }
  return {
    inputPath: rawItem.inputPath,
    status: rawItem.status,
    startedAt: rawItem.startedAt,
    finishedAt: rawItem.finishedAt,
    error: rawItem.error,
    currentStage: rawItem.currentStage,
    result: rawItem.result && isRecord(rawItem.result)
      ? { ...serializeResult(rawItem.result), assets: {}, assetIds: {} }
      : null
  };
}

function reauthorizeRestoredJobAssets(state, job) {
  if (job.options?.dryRun) return;
  const outDir = typeof job.options?.outDir === "string" ? path.resolve(job.options.outDir) : null;
  if (!outDir) return;
  const outDirReal = realpathIfExists(outDir);
  if (!outDirReal) return;

  for (const item of job.items ?? []) {
    const result = item.result;
    if (!isRecord(result?.outputPlan)) continue;

    const assets = {};
    const assetIds = {};
    for (const [kind, candidate] of Object.entries(collectRestorableOutputPlanAssets(result.outputPlan, job.options))) {
      if (typeof candidate !== "string" || !candidate) continue;
      const resolved = path.resolve(candidate);
      const fingerprint = restorableAssetFingerprint(resolved, { outDir, outDirReal });
      if (!fingerprint) continue;
      assets[kind] = resolved;
      assetIds[kind] = authorizeAssetPath(state, resolved, fingerprint);
    }
    result.assets = assets;
    result.assetIds = assetIds;
  }
}

function collectRestorableOutputPlanAssets(outputPlan, options = {}) {
  if (options.dryRun) return {};
  if (options.previewOnly) {
    return { preview: outputPlan.preview };
  }
  if (options.qcOnly) {
    return {
      reportJson: outputPlan.reportJson,
      reportHtml: outputPlan.reportHtml
    };
  }
  return {
    oneByOne: outputPlan.oneByOne,
    threeByFour: outputPlan.threeByFour,
    preview: outputPlan.preview,
    reportJson: outputPlan.reportJson,
    reportHtml: outputPlan.reportHtml
  };
}

function restorableAssetFingerprint(assetPath, { outDir, outDirReal }) {
  if (!isWithinDirectory(assetPath, outDir)) return null;
  let real;
  let info;
  try {
    real = realpathSync(assetPath);
    info = statSync(assetPath);
  } catch {
    return null;
  }
  if (!info.isFile()) return null;
  if (!isWithinDirectory(real, outDirReal)) return null;
  return {
    realpath: real,
    ...fileStatFingerprint(info)
  };
}

function realpathIfExists(targetPath) {
  try {
    return realpathSync(targetPath);
  } catch {
    return null;
  }
}

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function markInterruptedIfActive(job) {
  if (!isActiveJob(job)) return false;
  const now = new Date().toISOString();
  const wasCancelling = Boolean(job.cancelRequested);
  let interruptedItemCount = 0;
  const finalStage = interruptedFinalStage({ wasCancelling, target: "job", at: now });
  const message = wasCancelling
    ? "上次退出时任务正在停止，已标记为停止。请复核输出文件夹后重新运行。"
    : "上次本地桥接服务中断，任务状态无法继续。请复核输出文件夹后重新运行。";
  job.status = wasCancelling ? "cancelled" : "failed";
  job.error = wasCancelling ? null : message;
  job.finishedAt = job.finishedAt ?? now;
  job.current = null;
  job.currentStage = finalStage;
  for (const item of job.items ?? []) {
    if (["queued", "processing", "running"].includes(item.status)) {
      interruptedItemCount += 1;
      item.status = wasCancelling ? "cancelled" : "failed";
      item.error = wasCancelling ? null : message;
      item.finishedAt = item.finishedAt ?? now;
      item.currentStage = interruptedFinalStage({
        wasCancelling,
        target: item.currentStage?.target ?? item.inputPath ?? "item",
        at: now
      });
    }
  }
  if (interruptedItemCount > 0) {
    job.completed = normalizeJobCounter(job.completed) + interruptedItemCount;
    job.total = Math.max(normalizeJobCounter(job.total), job.completed);
    if (!wasCancelling) job.failed = normalizeJobCounter(job.failed) + interruptedItemCount;
  } else if (!wasCancelling) {
    job.failed = Math.max(normalizeJobCounter(job.failed), 1);
  }
  reconcileFinishedJobCounters(job);
  job.logs.push({ at: now, level: wasCancelling ? "warn" : "error", message });
  trimJobLogs(job);
  return true;
}

function interruptedFinalStage({ wasCancelling, target, at }) {
  return {
    name: wasCancelling ? "cancel" : "recover",
    target,
    state: wasCancelling ? "cancelled" : "failed",
    at
  };
}

function hasActiveJob(state) {
  if (state.jobCreationPending) return true;
  return [...state.jobs.values()].some((job) => ["queued", "running"].includes(job.status));
}

function requestActiveJobCancellation(state, { reason }) {
  for (const job of state.jobs.values()) {
    if (!isActiveJob(job)) continue;
    const alreadyCancelling = job.cancelRequested && job.currentStage?.name === "cancel";
    job.cancelRequested = true;
    if (!alreadyCancelling) {
      recordJobStage(job, { name: "cancel", target: "job", state: "active" });
      appendLog(job, "warn", reason);
    }
    const controller = state.activeAbortControllers.get(job.id);
    if (controller && !controller.signal.aborted) controller.abort();
  }
}

function requestJobCreationCancellation(state) {
  const controller = state.jobCreationAbortController;
  if (controller && !controller.signal.aborted) controller.abort();
}

async function rollbackPendingJobCreation(state, job) {
  if (!state.jobs.delete(job.id)) return;
  rebuildAllowedAssets(state);
  await persistStateSoon(state, { immediate: true });
}

async function waitForStateToBecomeIdle(state, { timeoutMs }) {
  const timeout = normalizeRetentionLimit(timeoutMs, "timeoutMs", { min: 0 });
  const started = Date.now();
  while (hasActiveJob(state) || state.activeAbortControllers.size > 0) {
    if (Date.now() - started >= timeout) {
      throw new Error("Timed out while stopping active openFAD Motion jobs.");
    }
    await new Promise((resolve) => setTimeout(resolve, SHUTDOWN_POLL_MS));
  }
}

function normalizeUiFrameRate(value) {
  try {
    return normalizeFrameRate(value, {
      message: "帧率必须是 auto、23.976、24、25、29.97、30、24000/1001 或 30000/1001。"
    });
  } catch (error) {
    throw asBadRequest(error);
  }
}

function normalizeUiBitrate(value) {
  try {
    return normalizeBitrate(value, {
      message: "码率必须在 45M 到 100M 之间，例如 50M。"
    });
  } catch (error) {
    throw asBadRequest(error);
  }
}

function asBadRequest(error) {
  error.statusCode = 400;
  return error;
}

function badRequest(message) {
  const error = new Error(message);
  error.statusCode = 400;
  return error;
}

function fieldBadRequest(message, field) {
  const error = badRequest(message);
  error.field = field;
  return error;
}

function conflict(message) {
  const error = new Error(message);
  error.statusCode = 409;
  return error;
}

async function runJob(job, { state }) {
  if (job.cancelRequested) {
    job.status = "cancelled";
    job.finishedAt = new Date().toISOString();
    recordJobStage(job, { name: "cancel", target: "job", state: "cancelled" });
    appendLog(job, "warn", "任务已停止。");
    pruneState(state);
    persistStateSoon(state, { immediate: true });
    return;
  }

  const abortController = new AbortController();
  state.activeAbortControllers.set(job.id, abortController);
  job.status = "running";
  job.startedAt = new Date().toISOString();
  appendLog(job, "info", job.options.dryRun ? "模拟运行已开始。" : "渲染任务已开始。");
  persistStateSoon(state, { immediate: true });

  try {
    const files = job.inputFiles ?? await collectInputFiles(job.options.input, {
      excludeDirs: [job.options.outDir],
      skipGeneratedOutputs: !job.options.qcOnly
    });
    job.total = files.length;
    if (files.length === 0) {
      throw new Error(`在 ${job.options.input} 中没有找到 .mov、.mp4 或 .m4v 文件。`);
    }

    let batchContext;
    try {
      batchContext = await prepareBatchContext({
        ...job.options,
        signal: abortController.signal,
        onStage: (stage) => recordJobStage(job, stage)
      });
    } catch (error) {
      if (job.cancelRequested && isAbortError(error)) {
        job.status = "cancelled";
        job.finishedAt = new Date().toISOString();
        recordJobStage(job, { name: "cancel", target: "job", state: "cancelled" });
        appendLog(job, "warn", "任务已停止。");
        return;
      }
      throw error;
    }

    for (const inputPath of files) {
      if (job.cancelRequested) break;

      job.current = inputPath;
      const item = {
        inputPath,
        status: "processing",
        startedAt: new Date().toISOString(),
        finishedAt: null,
        error: null,
        result: null,
        currentStage: null,
        stages: []
      };
      job.items.push(item);
      trimJobItems(job);
      appendLog(job, "info", `正在处理 ${displayPathLabel(inputPath)}`);

      try {
        const result = await processFile(inputPath, {
          ...job.options,
          batchContext,
          signal: abortController.signal,
          onStage: (stage) => recordItemStage(job, item, stage)
        });
        item.result = summarizeResult(result, { options: job.options });
        if (!job.options.dryRun && isRetainedJobItem(job, item)) {
          item.result.assetIds = await registerGeneratedAssets(state, item.result.assets);
        }
        item.status = item.result.status;
        item.finishedAt = new Date().toISOString();
        countItem(job, item);
        if (result.colorConversion?.mode === "hdr-to-rec709") {
          appendLog(job, "info", "已自动转换色彩：HDR / BT.2020 -> Rec.709 SDR。");
        }
        if (job.options.fps === "auto" && result.outputFps) {
          appendLog(job, "info", `已自动选择帧率：${result.outputFps} fps。`);
        }
        appendLog(job, "info", `${resultStatusLabel(item.status)} ${displayPathLabel(inputPath)}`);
      } catch (error) {
        item.finishedAt = new Date().toISOString();
        if (job.cancelRequested && isAbortError(error)) {
          item.status = "cancelled";
          appendLog(job, "warn", "当前处理已停止。");
          break;
        }
        item.status = "failed";
        item.error = userFacingRuntimeError(error, job.options);
        job.failed += 1;
        appendLog(job, "error", item.error);
        if (isEncoderDiagnostic(error)) break;
      } finally {
        job.completed += 1;
      }
    }

    job.current = null;
    job.finishedAt = new Date().toISOString();
    if (job.cancelRequested) {
      job.status = "cancelled";
      recordJobStage(job, { name: "cancel", target: "job", state: "cancelled" });
      appendLog(job, "warn", "任务已停止。");
    } else if (job.failed > 0) {
      job.status = "failed";
    } else if (job.options.dryRun) {
      job.status = "planned";
    } else if (job.warnings > 0) {
      job.status = "warning";
    } else if (job.options.previewOnly) {
      job.status = "previewed";
    } else {
      job.status = "succeeded";
    }
    appendLog(job, jobFinalLogLevel(job), jobFinalLogMessage(job));
  } finally {
    state.activeAbortControllers.delete(job.id);
    pruneState(state);
    persistStateSoon(state, { immediate: true });
  }
}

function recordItemStage(job, item, stage) {
  const normalized = normalizeStage(stage);
  job.currentStage = normalized;
  item.currentStage = normalized;
  item.stages.push(normalized);
  if (item.stages.length > 50) item.stages.shift();
  persistJobState(job);
}

function recordJobStage(job, stage) {
  job.currentStage = normalizeStage(stage);
  persistJobState(job);
}

function normalizeStage(stage) {
  return {
    name: stage.name,
    target: stage.target,
    state: stage.state,
    at: stage.at ?? new Date().toISOString()
  };
}

async function preflightInputFiles(options, { signal } = {}) {
  let files;
  try {
    throwIfPreflightAborted(signal);
    files = await collectInputFiles(options.input, {
      excludeDirs: [options.outDir],
      skipGeneratedOutputs: !options.qcOnly,
      signal
    });
    throwIfPreflightAborted(signal);
  } catch (error) {
    if (["ENOENT", "ENOTDIR", "EACCES", "EPERM"].includes(error.code)) {
      throw badRequest(`输入路径不可读取或不存在：${displayPathLabel(options.input)}。请确认文件或文件夹仍在本机并可访问。`);
    }
    throw error;
  }

  if (files.length === 0) {
    throw badRequest(`在 ${displayPathLabel(options.input)} 中没有找到 .mov、.mp4 或 .m4v 文件。`);
  }
  return files;
}

async function preflightInputOutputDirectories(options, { signal } = {}) {
  try {
    await assertInputOutputDirectoriesAreSeparate(options, {
      message: "输出文件夹不能和输入文件夹相同。请另选一个输出文件夹。",
      signal
    });
  } catch (error) {
    if (isAbortError(error)) throw error;
    if (["ENOENT", "ENOTDIR", "EACCES", "EPERM"].includes(error.code)) return;
    throw badRequest(error.message);
  }
}

async function preflightOutputDirectory(options, { signal } = {}) {
  try {
    throwIfPreflightAborted(signal);
    const info = await stat(options.outDir);
    throwIfPreflightAborted(signal);
    if (!info.isDirectory()) {
      throw badRequest(`输出文件夹路径不是文件夹：${displayPathLabel(options.outDir)}。`);
    }
    if (options.dryRun) return;
    await access(options.outDir, FS_CONSTANTS.R_OK | FS_CONSTANTS.W_OK | FS_CONSTANTS.X_OK);
    throwIfPreflightAborted(signal);
  } catch (error) {
    if (error.statusCode) throw error;
    if (error.code === "ENOENT") {
      if (options.dryRun) return;
      try {
        throwIfPreflightAborted(signal);
        await mkdir(options.outDir, { recursive: true });
        throwIfPreflightAborted(signal);
        return;
      } catch (mkdirError) {
        if (["ENOENT", "ENOTDIR", "EACCES", "EPERM", "EEXIST"].includes(mkdirError.code)) {
          throw badRequest("输出文件夹无法创建。请检查上级文件夹权限，或选择其他输出文件夹。");
        }
        throw mkdirError;
      }
    }
    if (["ENOTDIR", "EACCES", "EPERM"].includes(error.code)) {
      throw badRequest("输出文件夹不可访问。请检查文件夹权限，或选择其他输出文件夹。");
    }
    throw error;
  }
}

async function preflightOutputFiles(files, options, { signal } = {}) {
  try {
    await assertSafeOutputPaths(files, options, { signal });
    await assertOverwriteTargetsAreFiles(files, options, { signal });
  } catch (error) {
    if (isAbortError(error)) throw error;
    if (error.statusCode) throw error;
    throw conflict(userFacingOutputPreflightError(error));
  }
}

async function preflightCustomToolPaths(options, { signal } = {}) {
  await preflightCustomToolPath(options.ffmpegPath, {
    field: "ffmpegPath",
    message: USER_FACING_CUSTOM_FFMPEG_PATH_ERROR,
    signal
  });
  await preflightCustomToolPath(options.ffprobePath, {
    field: "ffprobePath",
    message: USER_FACING_CUSTOM_FFPROBE_PATH_ERROR,
    signal
  });
}

async function preflightCustomToolPath(toolPath, { field, message, signal }) {
  if (!toolPath) return;
  try {
    throwIfPreflightAborted(signal);
    const info = await stat(toolPath);
    throwIfPreflightAborted(signal);
    if (!info.isFile()) throw fieldBadRequest(message, field);
    await access(toolPath, FS_CONSTANTS.X_OK);
    throwIfPreflightAborted(signal);
  } catch (error) {
    if (error.statusCode) throw error;
    if (["ENOENT", "ENOTDIR", "EACCES", "EPERM"].includes(error.code)) {
      throw fieldBadRequest(message, field);
    }
    throw error;
  }
}

async function assertOverwriteTargetsAreFiles(files, options, { signal } = {}) {
  if (options.dryRun || !options.overwrite) return;
  const replacements = await collectExistingOutputFiles(files, options, { signal });
  for (const outputPath of replacements) {
    throwIfPreflightAborted(signal);
    let info;
    try {
      info = await stat(outputPath);
    } catch (error) {
      if (error.code === "ENOENT") continue;
      if (["ENOTDIR", "EACCES", "EPERM"].includes(error.code)) {
        throw conflict("输出目标路径不可检查。请检查输出文件夹权限，或选择新的输出文件夹。");
      }
      throw error;
    }
    throwIfPreflightAborted(signal);
    if (!info.isFile()) {
      throw conflict(`输出目标路径已被文件夹占用：${displayPathLabel(outputPath)}。请删除该文件夹，或选择新的输出文件夹。`);
    }
  }
}

async function resolveOverwriteConfirmation(files, options, token, state, { signal } = {}) {
  if (options.dryRun || !options.overwrite) return null;
  pruneOverwriteConfirmations(state);
  const replacements = await collectExistingOutputFiles(files, options, { signal });
  if (replacements.length === 0) return null;

  const fingerprint = overwriteConfirmationFingerprint(options, replacements);
  if (consumeOverwriteConfirmation(state, token, fingerprint)) return null;

  const confirmationToken = randomUUID();
  state.overwriteConfirmations.set(confirmationToken, {
    fingerprint,
    expiresAt: Date.now() + OVERWRITE_CONFIRMATION_TTL_MS
  });
  trimOverwriteConfirmations(state);
  return {
    required: true,
    token: confirmationToken,
    count: replacements.length,
    replacements: replacements.map(displayPathLabel),
    error: overwriteConfirmationMessage(replacements)
  };
}

function throwIfPreflightAborted(signal) {
  if (signal?.aborted) {
    throw new ProcessAbortedError("Job creation was cancelled before it started.");
  }
}

function consumeOverwriteConfirmation(state, token, fingerprint) {
  if (typeof token !== "string" || !token.trim()) return false;
  const confirmation = state.overwriteConfirmations.get(token);
  state.overwriteConfirmations.delete(token);
  if (!confirmation || confirmation.expiresAt < Date.now()) return false;
  return confirmation.fingerprint === fingerprint;
}

function pruneOverwriteConfirmations(state) {
  const now = Date.now();
  for (const [token, confirmation] of state.overwriteConfirmations) {
    if (confirmation.expiresAt < now) state.overwriteConfirmations.delete(token);
  }
}

function trimOverwriteConfirmations(state) {
  while (state.overwriteConfirmations.size > DEFAULT_MAX_OVERWRITE_CONFIRMATIONS) {
    const oldestToken = state.overwriteConfirmations.keys().next().value;
    if (!oldestToken) return;
    state.overwriteConfirmations.delete(oldestToken);
  }
}

function overwriteConfirmationFingerprint(options, replacements) {
  return JSON.stringify({
    input: path.resolve(options.input),
    outDir: path.resolve(options.outDir),
    container: options.container,
    qcOnly: Boolean(options.qcOnly),
    previewOnly: Boolean(options.previewOnly),
    replacements: replacements.map((replacement) => path.resolve(replacement)).sort()
  });
}

function overwriteConfirmationMessage(replacements) {
  const count = replacements.length;
  const suffix = count === 1 ? "1 个已有输出文件" : `${count} 个已有输出文件`;
  return `确认覆盖已有输出后会替换 ${suffix}。请复核替换清单后再继续。`;
}

function requireHistoryClearConfirmation(body) {
  if (body?.confirm === HISTORY_CLEAR_CONFIRMATION) return;
  throw badRequest("需要确认清除历史任务记录。");
}

function requireRestoreResetConfirmation(body) {
  if (body?.confirm === RESTORE_RESET_CONFIRMATION) return;
  throw badRequest(USER_FACING_RESTORE_RESET_CONFIRMATION);
}

function summarizeResult(result, { options }) {
  const issueSummary = summarizeIssues(result.report);
  const assets = collectGeneratedAssets(result, options);
  let status = "passed";
  if (options.dryRun) status = "planned";
  else if (options.previewOnly) status = "previewed";
  else if (result.report && !result.report.ok) status = "failed";
  else if (issueSummary.warningCount > 0) status = "warning";

  return {
    inputPath: result.inputPath,
    inputLabel: displayPathLabel(result.inputPath),
    outputPlan: result.outputPlan,
    commands: result.commands,
    report: result.report,
    colorConversion: result.colorConversion ?? { mode: "none" },
    outputFps: result.outputFps ?? null,
    assets,
    status,
    issueSummary
  };
}

function summarizeIssues(report) {
  if (!report) {
    return { errorCount: 0, warningCount: 0, issues: [] };
  }

  const issues = report.items.flatMap((item) => {
    const errors = item.errors.map((message) => ({
      target: item.target,
      severity: "error",
      message: userFacingIssueMessage(message)
    }));
    const warnings = item.warnings.map((message) => ({
      target: item.target,
      severity: "warning",
      message: userFacingIssueMessage(message)
    }));
    return [...errors, ...warnings];
  });

  return {
    errorCount: issues.filter((issue) => issue.severity === "error").length,
    warningCount: issues.filter((issue) => issue.severity === "warning").length,
    issues
  };
}

function userFacingIssueMessage(message) {
  if (isQcSubprocessDiagnostic(message)) {
    return "质检命令失败。请检查 FFmpeg 安装和输出文件是否可读取。";
  }
  return message;
}

function isQcSubprocessDiagnostic(message) {
  return /^(blackdetect|blackframe|freezedetect) failed (with exit code|to run\b)/.test(String(message ?? ""))
    || /^质检命令失败：(?:blackdetect|blackframe|freezedetect)\b/.test(String(message ?? ""))
    || /^(?:blackdetect|blackframe|freezedetect) (?:无法启动质检|运行超时)/.test(String(message ?? ""));
}

function countItem(job, item) {
  if (item.status === "planned") job.planned += 1;
  else if (item.status === "failed") job.failed += 1;
  else if (item.status === "warning") job.warnings += 1;
  else if (item.status === "passed") job.passed += 1;
}

function isRetainedJobItem(job, item) {
  return Array.isArray(job.items) && job.items.includes(item);
}

function userFacingRuntimeError(error, options = {}) {
  if (isDatalessInputDiagnostic(error)) {
    return "输入文件还没有完整下载到本机。请先在 Finder 中下载或打开一次，确认可以播放后再试。";
  }
  if (isEncoderDiagnostic(error)) {
    return "无法选择可用的视频编码器。请检查 FFmpeg 安装，或改用 x264 / 自动编码后重试。";
  }
  if (isProcessTimeoutDiagnostic(error)) {
    return "本地视频工具分析或处理超时。请确认输入文件已完整下载且可以播放，然后重试。";
  }
  if (isMissingSpawnExecutable(error)) {
    if (matchesConfiguredTool(error.path, options.ffprobePath ?? process.env.FFPROBE_PATH ?? "ffprobe", "ffprobe")) {
      return "无法启动 FFprobe。请检查 FFprobe 路径，或重新安装 FFprobe 后再试。";
    }
    if (matchesConfiguredTool(error.path, options.ffmpegPath ?? process.env.FFMPEG_PATH ?? "ffmpeg", "ffmpeg")) {
      return "无法启动 FFmpeg。请检查 FFmpeg 路径，或重新安装 FFmpeg 后再试。";
    }
    return "无法启动外部处理工具。请检查工具路径后再试。";
  }
  if (isFfprobeDiagnostic(error)) {
    return "无法分析视频信息。请确认输入文件可以正常播放，并检查 FFprobe 路径后再试。";
  }
  if (isAmbiguousInputStreamDiagnostic(error)) {
    return "输入文件的视频流不明确。请导出为只包含一个视频画面轨道的 .mov 或 .mp4 后重试。";
  }
  if (isUnsupportedInputColorDiagnostic(error)) {
    return "输入视频色彩信息不安全。请导出为 Rec.709/sRGB SDR，或明确标记的 HDR BT.2020 素材后再试。";
  }
  if (isInvalidInputSpecDiagnostic(error)) {
    return "输入视频不符合 Apple Motion 源要求。请确认素材时长在 8 到 35 秒之间，重新导出后再试。";
  }
  if (isReportWriteDiagnostic(error)) {
    return "无法写入质检报告。请检查输出文件夹权限和已有报告文件后重试。";
  }
  if (isRuntimeOutputCollisionDiagnostic(error)) {
    return "输出文件已存在。请确认没有其他任务正在写入同一输出文件夹；如需替换，请开启“覆盖已有文件”后重试。";
  }
  if (isFfmpegRenderDiagnostic(error)) {
    return "无法生成视频输出。请检查输入文件、输出文件夹权限和 FFmpeg 安装后再试。";
  }
  const filesystemError = userFacingFilesystemRuntimeError(error);
  if (filesystemError) return filesystemError;
  logServerDiagnostic("任务运行失败", error);
  return "处理任务时发生未识别的本地错误。请检查输入文件、输出文件夹权限和本地视频工具后重试。";
}

function userFacingFilesystemRuntimeError(error) {
  const code = String(error?.code ?? "");
  const syscall = String(error?.syscall ?? "");
  if (["ENOENT", "ENOTDIR"].includes(code)) {
    if (["stat", "lstat", "open"].includes(syscall)) {
      return "输入文件或文件夹不存在。请确认素材已下载、路径没有被移动后重试。";
    }
    return "需要的文件或文件夹不存在。请确认输入文件和输出文件夹没有被移动或删除后重试。";
  }
  if (["EACCES", "EPERM"].includes(code)) {
    return "没有权限访问输入文件或输出文件夹。请检查文件夹权限后重试。";
  }
  if (code === "EISDIR") {
    return "需要文件的位置是一个文件夹。请检查输入和输出路径后重试。";
  }
  if (code === "ENOSPC") {
    return "磁盘空间不足，无法写入输出文件。请清理空间或选择其他输出磁盘后重试。";
  }
  if (code === "EBUSY") {
    return "文件正在被其他应用占用。请关闭正在使用该文件的应用后重试。";
  }
  return null;
}

function userFacingOutputPreflightError(error) {
  const message = String(error?.message ?? error);
  if (isOutputTransactionRecoveryDiagnostic(message)) {
    return "无法恢复上次中断的输出写入记录。请检查输出文件夹中的临时输出文件，或选择新的输出文件夹后重试。";
  }

  const existingMatch = message.match(/^Output already exists: (?<outputPath>.+?)\. Use --overwrite only when replacing it is intentional\.$/);
  if (existingMatch?.groups?.outputPath) {
    return `输出文件已存在：${displayPathLabel(existingMatch.groups.outputPath)}。如需替换，请开启“覆盖已有文件”；否则请选择新的输出文件夹。`;
  }

  const collisionMatch = message.match(/^Output path collision: (?<outputPath>.+?) would be written by both (?<firstInput>.+?) and (?<secondInput>.+?)\. Rename one input file or use separate output folders\.$/);
  if (collisionMatch?.groups) {
    return `输出路径冲突：${displayPathLabel(collisionMatch.groups.outputPath)} 会被多个输入文件写入。请重命名输入文件，或选择不同的输出文件夹。`;
  }

  return message;
}

function displayPathLabel(value) {
  const text = String(value ?? "").trim();
  if (!text) return "";
  try {
    const url = new URL(text);
    if (url.protocol === "file:") {
      return path.basename(fileURLToPath(url)) || "输出文件";
    }
  } catch {
    // Not a URL; treat it as a local path-like value below.
  }
  const normalized = text.replaceAll("\\", "/");
  return path.basename(normalized) || "输出文件";
}

function sanitizeOptionalApiMessage(message) {
  if (message == null) return null;
  return sanitizeApiMessage(message);
}

function sanitizeApiMessage(message) {
  const text = String(message ?? "").trim();
  if (!text) return "";
  return looksLikeRawApiDiagnostic(text) ? USER_FACING_BROWSER_DIAGNOSTIC : text;
}

function looksLikeRawApiDiagnostic(text) {
  return /(?:^|\n)\s+at\s+\S+/.test(text)
    || /\b(?:Error|TypeError|SyntaxError|ReferenceError):/.test(text)
    || looksLikeAbsoluteLocalPathInText(text)
    || /\.(?:secrets?|env)\b/i.test(text)
    || /\b(?:token|secret|cookie|authorization)\b/i.test(text)
    || /\b(?:ChildProcess|spawn|ENOENT|EACCES|EPERM|stderr|stdout|node:)\b/.test(text);
}

function looksLikeAbsoluteLocalPathInText(text) {
  return /(?:^|[\s"'(=:])(?:\/(?:[^/\s'")]+\/)+[^\s'")]+|[A-Za-z]:\\|\\\\)/.test(text);
}

function buildVideoToolHealth(label, configuredPath) {
  return {
    configured: typeof configuredPath === "string" && configuredPath.trim().length > 0,
    label
  };
}

function isOutputTransactionRecoveryDiagnostic(message) {
  return /^(Could not read|Invalid|Unsafe) output (?:transaction|group) journal /.test(message)
    || message.startsWith("Cannot safely roll back output group ")
    || message.startsWith("Cannot safely roll back output transaction ");
}

function isMissingSpawnExecutable(error) {
  return error?.code === "ENOENT" && String(error?.syscall ?? "").startsWith("spawn");
}

function isFfprobeDiagnostic(error) {
  const message = String(error?.message ?? "");
  return message.startsWith("Could not parse ffprobe JSON for ") || message.startsWith("ffprobe failed for ");
}

function isDatalessInputDiagnostic(error) {
  return error?.fadAppleMotionErrorKind === "dataless-input-file";
}

function isProcessTimeoutDiagnostic(error) {
  return error?.code === "PROCESS_TIMEOUT";
}

function isAmbiguousInputStreamDiagnostic(error) {
  return error?.fadAppleMotionErrorKind === "ambiguous-input-stream";
}

function isInvalidInputSpecDiagnostic(error) {
  return error?.fadAppleMotionErrorKind === "invalid-input-spec";
}

function isUnsupportedInputColorDiagnostic(error) {
  return error?.fadAppleMotionErrorKind === "unsupported-input-color"
    || (error?.fadAppleMotionErrorKind === "invalid-input-spec" && Array.isArray(error.fadAppleMotionInputSpecErrors)
      && error.fadAppleMotionInputSpecErrors.some((message) => String(message).startsWith("Color profile must ")));
}

function isEncoderDiagnostic(error) {
  const message = String(error?.message ?? "");
  return error?.fadAppleMotionErrorKind === "encoder-resolution"
    || message.startsWith("No supported H.264 encoder")
    || message.includes("is not available in this FFmpeg build")
    || message.startsWith("Could not inspect FFmpeg encoders:")
    || message.includes("failed a runtime smoke test");
}

function isReportWriteDiagnostic(error) {
  return error?.fadAppleMotionErrorKind === "report-write";
}

function isRuntimeOutputCollisionDiagnostic(error) {
  const message = String(error?.message ?? "");
  return /^(Output|Report) already exists: .+\. (?:Use --overwrite|Enable overwrite) only when replacing it is intentional\.$/.test(message);
}

function isFfmpegRenderDiagnostic(error) {
  return String(error?.message ?? "").startsWith("ffmpeg failed for ");
}

function matchesConfiguredTool(errorPath, configuredPath, binaryName) {
  const actual = String(errorPath ?? "").toLowerCase();
  const configured = String(configuredPath ?? "").toLowerCase();
  const actualName = path.basename(actual);
  const configuredName = path.basename(configured);
  return actual === configured || actualName === configuredName || actualName.includes(binaryName);
}

function summarizeJob(job) {
  const currentItem = currentItemSummary(job);
  return {
    id: job.id,
    status: job.status,
    createdAt: job.createdAt,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
    total: job.total,
    completed: job.completed,
    passed: job.passed,
    warnings: job.warnings,
    failed: job.failed,
    planned: job.planned,
    currentId: currentItem?.inputId ?? null,
    currentLabel: job.current ? displayPathLabel(job.current) : null,
    currentStage: summarizeStage(job.currentStage),
    error: sanitizeOptionalApiMessage(job.error)
  };
}

function summarizeJobPoll(job) {
  return summarizeBoundedJob(job, DEFAULT_POLL_ITEMS_LIMIT);
}

function summarizeJobDetail(job) {
  return summarizeBoundedJob(job, DEFAULT_POLL_ITEMS_LIMIT);
}

function summarizeJobFull(job) {
  return summarizeBoundedJob(job, DEFAULT_FULL_ITEMS_LIMIT);
}

function summarizeBoundedJob(job, itemLimit) {
  const items = job.items ?? [];
  const visibleItems = itemLimit === 0 ? [] : items.slice(-itemLimit);
  const visibleItemStart = items.length - visibleItems.length;
  const itemHistoryOffset = normalizeStoredOffset(job.itemsOffset);
  const totalItems = Math.max(
    normalizeStoredOffset(job.totalItems),
    normalizeStoredOffset(job.total),
    itemHistoryOffset + items.length
  );
  const logs = job.logs ?? [];
  const logLimit = boundedJobLogLimit(job);
  const visibleLogs = logLimit === 0 ? [] : logs.slice(-logLimit);
  const logHistoryOffset = normalizeStoredOffset(job.logsOffset);
  const totalLogs = Math.max(
    normalizeStoredOffset(job.totalLogs),
    logHistoryOffset + logs.length
  );
  return {
    ...summarizeJob(job),
    logs: visibleLogs.map(summarizeLogEntry),
    logsOffset: logHistoryOffset + Math.max(0, logs.length - visibleLogs.length),
    totalLogs,
    logsLimit: logLimit,
    itemsOffset: itemHistoryOffset + Math.max(0, items.length - visibleItems.length),
    totalItems,
    itemsLimit: itemLimit,
    items: visibleItems.map((item, index) => {
      return summarizeItemPoll(item, {
        inputId: inputIdForItemIndex(itemHistoryOffset + visibleItemStart + index)
      });
    })
  };
}

function boundedJobLogLimit(job) {
  const maxLogs = job[JOB_MAX_LOGS_PER_JOB];
  return Number.isInteger(maxLogs) && maxLogs >= 0 ? maxLogs : DEFAULT_MAX_LOGS_PER_JOB;
}

function currentItemSummary(job) {
  if (!job.current || !Array.isArray(job.items)) return null;
  const index = job.items.findIndex((item) => item.inputPath === job.current);
  if (index === -1) return null;
  return {
    inputId: inputIdForItemIndex(normalizeStoredOffset(job.itemsOffset) + index),
    inputLabel: displayPathLabel(job.current)
  };
}

function inputIdForItemIndex(index) {
  return `item-${Math.max(0, normalizeStoredOffset(index))}`;
}

function summarizeItemPoll(item, { inputId }) {
  const inputLabel = displayPathLabel(item.inputPath);
  return {
    inputId,
    inputLabel,
    status: item.status,
    startedAt: item.startedAt,
    finishedAt: item.finishedAt,
    error: sanitizeOptionalApiMessage(item.error),
    currentStage: summarizeStage(item.currentStage),
    result: item.result ? summarizeResultPoll(item.result, { inputId, inputLabel }) : null
  };
}

function summarizeResultPoll(result, { inputId, inputLabel }) {
  return {
    inputId,
    inputLabel,
    outputPlan: labelOutputMap(result.outputPlan),
    colorConversion: result.colorConversion,
    outputFps: result.outputFps,
    assets: labelOutputMap(result.assets),
    assetIds: result.assetIds ?? {},
    status: result.status,
    issueSummary: summarizeIssueSummary(result.issueSummary)
  };
}

function summarizeLogEntry(entry) {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
    return { at: new Date().toISOString(), level: "info", message: sanitizeApiMessage(entry) };
  }
  return {
    at: entry.at,
    level: entry.level,
    message: sanitizeApiMessage(entry.message)
  };
}

function summarizeIssueSummary(issueSummary) {
  if (!issueSummary || typeof issueSummary !== "object" || Array.isArray(issueSummary)) {
    return { errorCount: 0, warningCount: 0, issues: [] };
  }
  const issues = Array.isArray(issueSummary.issues)
    ? issueSummary.issues.map(summarizeIssue).filter(Boolean)
    : [];
  return {
    errorCount: Number.isFinite(issueSummary.errorCount) ? issueSummary.errorCount : issues.filter((issue) => issue.severity === "error").length,
    warningCount: Number.isFinite(issueSummary.warningCount) ? issueSummary.warningCount : issues.filter((issue) => issue.severity === "warning").length,
    issues
  };
}

function summarizeIssue(issue) {
  if (!issue || typeof issue !== "object" || Array.isArray(issue)) return null;
  return {
    target: sanitizeApiTarget(issue.target),
    severity: issue.severity,
    message: sanitizeApiMessage(userFacingIssueMessage(issue.message))
  };
}

function sanitizeApiTarget(value) {
  const text = String(value ?? "").trim();
  if (!text) return "";
  if (looksLikeLocalPath(text) || looksLikeRawApiDiagnostic(text)) return displayPathLabel(text);
  return text;
}

function summarizeStage(stage) {
  if (!stage || typeof stage !== "object") return stage;
  const target = typeof stage.target === "string" && looksLikeLocalPath(stage.target)
    ? displayPathLabel(stage.target)
    : stage.target;
  return {
    ...stage,
    target
  };
}

function looksLikeLocalPath(value) {
  return value.includes("/") || /^[a-z]:\\/i.test(value) || value.startsWith("\\\\");
}

function labelOutputMap(outputs = {}) {
  const labels = {};
  for (const key of Object.keys(outputs ?? {})) {
    if (!outputs[key]) continue;
    labels[key] = outputKindLabel(key);
  }
  return labels;
}

function outputKindLabel(key) {
  return {
    oneByOne: "1x1",
    threeByFour: "3x4",
    preview: "预览",
    reportHtml: "HTML 报告",
    reportJson: "JSON 报告"
  }[key] ?? key;
}

async function registerGeneratedAssets(state, assets) {
  const fingerprints = [];
  for (const [kind, value] of Object.entries(assets ?? {})) {
    if (typeof value !== "string") continue;
    const resolved = path.resolve(value);
    const fingerprint = await assetFingerprint(resolved).catch(() => null);
    if (!fingerprint) continue;
    fingerprints.push([kind, resolved, fingerprint]);
  }
  const assetIds = {};
  for (const [kind, resolved, fingerprint] of fingerprints) {
    assetIds[kind] = authorizeAssetPath(state, resolved, fingerprint);
  }
  return assetIds;
}

function collectGeneratedAssets(result, options) {
  if (options.dryRun) return {};

  const { outputPlan } = result;
  if (options.previewOnly) {
    return { preview: outputPlan.preview };
  }
  if (options.qcOnly) {
    return result.report
      ? { reportJson: outputPlan.reportJson, reportHtml: outputPlan.reportHtml }
      : {};
  }

  return {
    oneByOne: outputPlan.oneByOne,
    threeByFour: outputPlan.threeByFour,
    preview: outputPlan.preview,
    ...(result.report ? {
      reportJson: outputPlan.reportJson,
      reportHtml: outputPlan.reportHtml
    } : {})
  };
}

function appendLog(job, level, message) {
  job.logs.push({
    at: new Date().toISOString(),
    level,
    message
  });
  const maxLogs = job[JOB_MAX_LOGS_PER_JOB];
  trimJobLogs(job, { maxLogs });
  job.totalLogs = Math.max(normalizeStoredOffset(job.totalLogs), normalizeStoredOffset(job.logsOffset) + job.logs.length);
  persistJobState(job);
}

function trimJobLogs(job, { maxLogs = job[JOB_MAX_LOGS_PER_JOB] } = {}) {
  if (!Number.isInteger(maxLogs) || maxLogs < 0 || job.logs.length <= maxLogs) return;
  const removed = job.logs.length - maxLogs;
  job.logs.splice(0, removed);
  job.logsOffset = normalizeStoredOffset(job.logsOffset) + removed;
  job.totalLogs = Math.max(normalizeStoredOffset(job.totalLogs), normalizeStoredOffset(job.logsOffset) + job.logs.length);
}

function trimJobItems(job, { maxItems = job[JOB_STATE]?.storedItemsLimit ?? DEFAULT_STORED_ITEMS_LIMIT } = {}) {
  if (!Number.isInteger(maxItems) || maxItems < 0 || !Array.isArray(job.items) || job.items.length <= maxItems) return;
  const removed = job.items.length - maxItems;
  job.items.splice(0, removed);
  job.itemsOffset = normalizeStoredOffset(job.itemsOffset) + removed;
  job.totalItems = Math.max(
    normalizeStoredOffset(job.totalItems),
    normalizeStoredOffset(job.total),
    normalizeStoredOffset(job.itemsOffset) + job.items.length
  );
  const state = job[JOB_STATE];
  if (state) rebuildAllowedAssets(state);
}

function serializeJob(job) {
  const storedItemsLimit = job[JOB_STATE]?.storedItemsLimit ?? DEFAULT_STORED_ITEMS_LIMIT;
  const storedItems = sliceForStorage(job.items ?? [], storedItemsLimit, normalizeStoredOffset(job.itemsOffset));
  const storedInputFiles = sliceForStorage(job.inputFiles ?? [], DEFAULT_STORED_INPUT_FILES_LIMIT, normalizeStoredOffset(job.inputFilesOffset));
  const storedLogs = sliceForStorage(job.logs ?? [], boundedJobLogLimit(job), normalizeStoredOffset(job.logsOffset));
  return {
    id: job.id,
    status: job.status,
    options: job.options,
    createdAt: job.createdAt,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
    current: job.current,
    total: job.total,
    completed: job.completed,
    passed: job.passed,
    warnings: job.warnings,
    failed: job.failed,
    planned: job.planned,
    cancelRequested: job.cancelRequested,
    error: job.error,
    currentStage: job.currentStage,
    itemsOffset: storedItems.offset,
    totalItems: Math.max(normalizeStoredOffset(job.totalItems), normalizeStoredOffset(job.total), storedItems.offset + storedItems.values.length),
    items: storedItems.values.map(serializeItem),
    logsOffset: storedLogs.offset,
    totalLogs: Math.max(normalizeStoredOffset(job.totalLogs), storedLogs.offset + storedLogs.values.length),
    logs: storedLogs.values,
    inputFilesOffset: storedInputFiles.offset,
    totalInputFiles: Math.max(normalizeStoredOffset(job.totalInputFiles), storedInputFiles.offset + storedInputFiles.values.length),
    inputFiles: storedInputFiles.values
  };
}

function sliceForStorage(values, limit, baseOffset = 0) {
  if (limit === 0) {
    return { values: [], offset: baseOffset + values.length };
  }
  if (values.length <= limit) {
    return { values, offset: baseOffset };
  }
  return {
    values: values.slice(-limit),
    offset: baseOffset + values.length - limit
  };
}

function serializeItem(item) {
  return {
    inputPath: item.inputPath,
    status: item.status,
    startedAt: item.startedAt,
    finishedAt: item.finishedAt,
    error: item.error,
    currentStage: item.currentStage,
    result: item.result ? serializeResult(item.result) : null
  };
}

function serializeResult(result) {
  return {
    inputPath: result.inputPath,
    outputPlan: result.outputPlan,
    colorConversion: result.colorConversion,
    outputFps: result.outputFps,
    assets: result.assets ?? {},
    assetIds: result.assetIds ?? {},
    status: result.status,
    issueSummary: result.issueSummary ?? { errorCount: 0, warningCount: 0, issues: [] }
  };
}

function persistStateSoon(state, { immediate = false } = {}) {
  if (!state.jobStorePath) return;
  state.persistDirty = true;
  if (!immediate && state.persistDebounceMs > 0) {
    if (!state.persistTimer) {
      state.persistTimer = setTimeout(() => {
        state.persistTimer = null;
        drainPersistState(state);
      }, state.persistDebounceMs);
      state.persistTimer.unref?.();
    }
    return state.persistPromise;
  }

  if (state.persistTimer) {
    clearTimeout(state.persistTimer);
    state.persistTimer = null;
  }
  return drainPersistState(state);
}

function drainPersistState(state) {
  if (state.persistScheduled) return state.persistPromise;

  state.persistScheduled = true;
  const previousPersist = state.persistPromise ?? Promise.resolve();
  state.persistPromise = previousPersist
    .catch(() => {})
    .then(async () => {
      while (state.persistDirty) {
        state.persistDirty = false;
        await persistState(state);
        state.persistError = null;
        state.lastPersistErrorMessage = null;
      }
    })
    .catch((error) => {
      state.persistError = error;
      if (state.lastPersistErrorMessage !== error.message) {
        state.lastPersistErrorMessage = error.message;
        logServerDiagnostic("Could not persist openFAD Motion job state", error);
      }
    })
    .finally(() => {
      state.persistScheduled = false;
      if (state.persistDirty) persistStateSoon(state);
    });
  return state.persistPromise;
}

async function persistState(state) {
  const jobs = [...state.jobs.values()].map(serializeJob);
  const payload = JSON.stringify({ version: 1, jobs }, null, 2);
  const directory = path.dirname(state.jobStorePath);
  await mkdir(directory, { recursive: true });
  const tempPath = `${state.jobStorePath}.${process.pid}.${Date.now()}.${randomUUID()}.tmp`;
  let committed = false;
  try {
    await writeFile(tempPath, payload);
    await rename(tempPath, state.jobStorePath);
    committed = true;
  } finally {
    if (!committed) await unlink(tempPath).catch(() => {});
  }
}

function persistJobState(job) {
  const state = job[JOB_STATE];
  if (state) persistStateSoon(state);
}

function jobFinalLogLevel(job) {
  return {
    failed: "error",
    warning: "warn",
    cancelled: "warn"
  }[job.status] ?? "info";
}

function jobFinalLogMessage(job) {
  const fileLabel = `${job.total} 个文件`;
  return {
    planned: `任务已计划：${fileLabel}。`,
    previewed: `预览任务完成：${fileLabel}。`,
    succeeded: `任务完成：${fileLabel}。`,
    warning: `任务完成但有警告：${fileLabel}，${job.warnings} 个警告。`,
    failed: `任务失败：${fileLabel}，${job.failed} 个失败。`,
    cancelled: `任务已停止：已处理 ${job.completed}/${job.total} 个文件。`
  }[job.status] ?? `任务结束：${fileLabel}。`;
}

function pruneState(state, { keepJobIds = new Set() } = {}) {
  const finishedJobs = [...state.jobs.values()].filter((job) => !isActiveJob(job));
  const overflow = finishedJobs.length - state.maxJobs;
  if (overflow <= 0) return;

  const removableJobs = finishedJobs.filter((job) => !keepJobIds.has(job.id));
  for (const job of removableJobs.slice(0, overflow)) {
    state.jobs.delete(job.id);
  }
  rebuildAllowedAssets(state);
}

async function clearFinishedJobHistory(state) {
  if (state.restoreFailed) {
    throw httpError(USER_FACING_RESTORE_CLEAR_BLOCKED, 409, { expose: true });
  }
  const removableJobs = [...state.jobs.values()].filter((job) => !isActiveJob(job));
  if (removableJobs.length === 0) return { cleared: 0 };

  const previousJobs = new Map(state.jobs);
  const previousAllowedAssets = new Set(state.allowedAssets);
  const previousAllowedAssetFingerprints = new Map(state.allowedAssetFingerprints);
  const previousAllowedAssetIds = new Map(state.allowedAssetIds);
  const previousAllowedAssetPaths = new Map(state.allowedAssetPaths);
  for (const job of removableJobs) {
    state.jobs.delete(job.id);
  }
  rebuildAllowedAssets(state);

  await persistStateSoon(state, { immediate: true });
  await state.persistPromise;
  if (state.persistError) {
    state.jobs = previousJobs;
    state.allowedAssets = previousAllowedAssets;
    state.allowedAssetFingerprints = previousAllowedAssetFingerprints;
    state.allowedAssetIds = previousAllowedAssetIds;
    state.allowedAssetPaths = previousAllowedAssetPaths;
    throw httpError(USER_FACING_PERSISTENCE_ERROR, 500, { expose: true });
  }
  return { cleared: removableJobs.length };
}

async function resetRestoreFailure(state) {
  if (!state.restoreFailed) return { reset: false, archived: false, archivedLabel: null };

  let archivedPath = null;
  try {
    if (state.jobStorePath) {
      archivedPath = await archiveCorruptJobStore(state.jobStorePath);
    }
    state.restoreFailed = false;
    state.restoreFailureMessage = null;
    state.jobs.clear();
    state.allowedAssets.clear();
    state.allowedAssetFingerprints.clear();
    state.allowedAssetIds.clear();
    state.allowedAssetPaths.clear();
    state.persistError = null;
    state.lastPersistErrorMessage = null;
    await persistStateSoon(state, { immediate: true });
    await state.persistPromise;
    if (state.persistError) throw state.persistError;
  } catch (error) {
    logServerDiagnostic("Could not reset openFAD Motion job recovery record", error);
    throw httpError(USER_FACING_RESTORE_RESET_ERROR, 500, { expose: true });
  }

  return {
    reset: true,
    archived: Boolean(archivedPath),
    archivedLabel: archivedPath ? path.basename(archivedPath) : null
  };
}

async function archiveCorruptJobStore(jobStorePath) {
  const info = await stat(jobStorePath).catch((error) => {
    if (error.code === "ENOENT") return null;
    throw error;
  });
  if (!info) return null;
  if (!info.isFile()) {
    throw new TypeError("Job store path must be a file.");
  }
  const directory = path.dirname(jobStorePath);
  const timestamp = new Date().toISOString().replace(/[-:.]/g, "");
  for (let index = 0; index < 100; index += 1) {
    const suffix = index === 0 ? "" : `-${index}`;
    const archivePath = path.join(directory, `jobs.corrupt-${timestamp}${suffix}.json`);
    const existing = await stat(archivePath).catch((error) => {
      if (error.code === "ENOENT") return null;
      throw error;
    });
    if (existing) continue;
    await rename(jobStorePath, archivePath);
    return archivePath;
  }
  throw new Error("Unable to allocate a corrupt job store archive path.");
}

function rebuildAllowedAssets(state) {
  const retainedAssets = new Set();
  const retainedFingerprints = new Map();
  const retainedAssetIds = new Map();
  const retainedAssetPaths = new Map();
  for (const job of state.jobs.values()) {
    for (const assetPath of collectJobAssetPaths(job)) {
      const fingerprint = state.allowedAssetFingerprints.get(assetPath);
      const assetId = state.allowedAssetIds.get(assetPath);
      if (!fingerprint) continue;
      if (!assetId) continue;
      retainedAssets.add(assetPath);
      retainedFingerprints.set(assetPath, fingerprint);
      retainedAssetIds.set(assetPath, assetId);
      retainedAssetPaths.set(assetId, assetPath);
    }
  }
  state.allowedAssets = retainedAssets;
  state.allowedAssetFingerprints = retainedFingerprints;
  state.allowedAssetIds = retainedAssetIds;
  state.allowedAssetPaths = retainedAssetPaths;
}

function collectJobAssetPaths(job) {
  const assets = [];
  for (const item of job.items ?? []) {
    const itemAssets = item.result?.assets;
    if (!itemAssets) continue;
    for (const value of Object.values(itemAssets)) {
      if (typeof value === "string") assets.push(path.resolve(value));
    }
  }
  return assets;
}

function isActiveJob(job) {
  return ["queued", "running"].includes(job.status);
}

function normalizeRetentionLimit(value, name, { min }) {
  if (!Number.isInteger(value) || value < min) {
    throw new TypeError(`${name} must be an integer greater than or equal to ${min}.`);
  }
  return value;
}

function normalizeStoredOffset(value) {
  return Number.isInteger(value) && value > 0 ? value : 0;
}

function normalizeJobCounter(value) {
  return Number.isInteger(value) && value > 0 ? value : 0;
}

function reconcileFinishedJobCounters(job) {
  const aggregateCompleted = normalizeJobCounter(job.passed)
    + normalizeJobCounter(job.warnings)
    + normalizeJobCounter(job.failed)
    + normalizeJobCounter(job.planned);
  job.completed = Math.max(normalizeJobCounter(job.completed), aggregateCompleted);
  job.total = Math.max(normalizeJobCounter(job.total), job.completed);
}

function hasOnlyRestoreFailureJobs(state) {
  if (!state?.restoreFailed) return false;
  const jobs = [...state.jobs.values()];
  return jobs.length > 0 && jobs.every((job) => job[JOB_RESTORE_FAILURE]);
}

function normalizeTimeoutMs(value, name) {
  if (value === null) return null;
  if (!Number.isInteger(value) || value < 1) {
    throw new TypeError(`${name} must be an integer greater than or equal to 1, or null.`);
  }
  return value;
}

function defaultAppDataDir() {
  const home = os.homedir();
  if (process.platform === "darwin") {
    return path.join(home, "Library", "Application Support", "openFAD Motion Batch");
  }
  if (process.platform === "win32") {
    return path.join(process.env.APPDATA ?? path.join(home, "AppData", "Roaming"), "openFAD Motion Batch");
  }
  return path.join(process.env.XDG_STATE_HOME ?? path.join(home, ".local", "state"), "openfad-motion-batch");
}

function resultStatusLabel(status) {
  return {
    planned: "已计划",
    previewed: "预览完成",
    passed: "已通过",
    warning: "有警告",
    failed: "失败"
  }[status] ?? status;
}

async function readJsonBody(request, { signal, timeoutMs = null } = {}) {
  const raw = await readRequestBody(request, { signal, timeoutMs });
  if (!raw.trim()) return {};
  const contentType = String(request.headers["content-type"] ?? "").toLowerCase();
  if (!contentType.includes("application/json")) {
    const error = new Error("请求内容必须使用 application/json。");
    error.statusCode = 415;
    throw error;
  }
  let payload;
  try {
    payload = JSON.parse(raw);
  } catch {
    const error = new Error("请求内容必须是有效 JSON。");
    error.statusCode = 400;
    throw error;
  }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    const error = new Error("请求内容必须是 JSON 对象。");
    error.statusCode = 400;
    throw error;
  }
  return payload;
}

function readRequestBody(request, { signal, timeoutMs = null } = {}) {
  let raw = "";
  return new Promise((resolve, reject) => {
    let settled = false;
    let timer = null;

    const cleanup = () => {
      if (timer) clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      request.off("data", onData);
      request.off("end", onEnd);
      request.off("error", onError);
      request.off("aborted", onAborted);
    };
    const settle = (callback, value, { destroy = false } = {}) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (destroy) request.destroy();
      callback(value);
    };
    const onAbort = () => {
      settle(reject, new ProcessAbortedError("Job creation request body read was cancelled."), { destroy: true });
    };
    const onData = (chunk) => {
      if (signal?.aborted) return onAbort();
      raw += chunk.toString();
      if (raw.length > 1_000_000) {
        const error = new Error("请求内容过大。");
        error.statusCode = 413;
        error.closeRequestAfterResponse = true;
        request.pause();
        settle(reject, error);
      }
    };
    const onEnd = () => settle(resolve, raw);
    const onError = (error) => settle(reject, error);
    const onAborted = () => settle(reject, new ProcessAbortedError("Job creation request body read was cancelled."));
    const onTimeout = () => {
      const error = httpError("请求内容读取超时。请重新提交任务。", 408, { expose: true });
      error.code = "JOB_CREATION_BODY_TIMEOUT";
      error.closeRequestAfterResponse = true;
      request.pause();
      settle(reject, error);
    };

    if (signal?.aborted) return onAbort();
    signal?.addEventListener("abort", onAbort, { once: true });
    request.on("data", onData);
    request.once("end", onEnd);
    request.once("error", onError);
    request.once("aborted", onAborted);
    if (timeoutMs !== null) {
      timer = setTimeout(onTimeout, timeoutMs);
      timer.unref?.();
    }
  });
}

function assertTrustedStateChange(request) {
  assertTrustedLocalApiRequest(request);
}

function assertTrustedLocalApiRequest(request) {
  assertTrustedHost(request);
  const fetchSite = String(request.headers["sec-fetch-site"] ?? "").toLowerCase();
  if (fetchSite && !["same-origin", "same-site", "none"].includes(fetchSite)) {
    throw forbiddenStateChange();
  }

  const origin = request.headers.origin;
  if (origin && !isAllowedOrigin(origin, request.socket.localPort)) {
    throw forbiddenStateChange();
  }
}

function assertTrustedHost(request) {
  if (!isTrustedLocalHostRequest({
    hostHeader: request.headers.host,
    localPort: request.socket.localPort,
    remoteAddress: request.socket.remoteAddress
  })) {
    throw forbiddenStateChange();
  }
}

function forbiddenStateChange() {
  const error = new Error("拒绝来自其他网站的本地控制请求。");
  error.statusCode = 403;
  return error;
}

function isAllowedOrigin(origin, localPort) {
  try {
    const originUrl = new URL(origin);
    return originUrl.protocol === "http:"
      && isLoopbackHostname(originUrl.hostname)
      && portMatchesLocalServer(originUrl.port, localPort);
  } catch {
    return false;
  }
}

export function isTrustedLocalHostRequest({ hostHeader, localPort, remoteAddress }) {
  return isAllowedLocalHost(hostHeader, localPort) && isLoopbackRemoteAddress(remoteAddress);
}

function isAllowedLocalHost(hostHeader, localPort) {
  try {
    const requestUrl = new URL(`http://${hostHeader ?? ""}`);
    return isLoopbackHostname(requestUrl.hostname)
      && portMatchesLocalServer(requestUrl.port, localPort);
  } catch {
    return false;
  }
}

function isLoopbackRemoteAddress(remoteAddress) {
  const normalized = String(remoteAddress ?? "").toLowerCase().replace(/^\[|\]$/g, "");
  if (normalized === "::1") return true;
  if (normalized.startsWith("::ffff:")) {
    return isLoopbackHostname(normalized.slice("::ffff:".length));
  }
  return isLoopbackHostname(normalized);
}

function isLoopbackHostname(hostname) {
  const normalized = String(hostname ?? "").toLowerCase().replace(/^\[|\]$/g, "");
  if (normalized === "localhost" || normalized === "::1") return true;
  const octets = normalized.split(".");
  return octets.length === 4
    && octets[0] === "127"
    && octets.every((part) => /^\d+$/.test(part) && Number(part) >= 0 && Number(part) <= 255);
}

function portMatchesLocalServer(port, localPort) {
  return Number(port || 80) === Number(localPort);
}

async function sendStatic(urlPath, response, { staticRoot }) {
  const requestedPath = decodeStaticPath(urlPath);
  const relativePath = requestedPath === "/" || requestedPath === ""
    ? "index.html"
    : requestedPath.replace(/^\/+/, "") === "favicon.ico"
      ? "favicon.svg"
      : requestedPath.replace(/^\/+/, "");
  const rootPath = path.resolve(staticRoot);
  const filePath = path.resolve(rootPath, relativePath);
  if (!isWithinDirectory(filePath, rootPath)) {
    return sendJson(response, { ok: false, error: "没有访问权限。" }, 403);
  }
  await sendFile(filePath, response, {
    headers: staticResponseHeaders(filePath)
  });
}

function staticResponseHeaders(filePath) {
  if (path.extname(filePath).toLowerCase() !== ".html") return {};
  return {
    "Content-Security-Policy": APP_CONTENT_SECURITY_POLICY,
    "X-Content-Type-Options": "nosniff"
  };
}

function decodeStaticPath(urlPath) {
  try {
    return decodeURIComponent(String(urlPath ?? ""));
  } catch (error) {
    if (error instanceof URIError) {
      throw badRequest("请求路径格式无效。请刷新页面后重试。");
    }
    throw error;
  }
}

function isWithinDirectory(filePath, directoryPath) {
  const relative = path.relative(directoryPath, filePath);
  return relative === "" || (relative && !relative.startsWith("..") && !path.isAbsolute(relative));
}

async function sendAsset(requestUrl, response, state, { beforeSendHook = null } = {}) {
  const requestedPath = resolveRequestedAssetPath(state, requestUrl.searchParams.get("id"));
  if (!await isAllowedAssetPath(state, requestedPath)) {
    const error = forbiddenAssetAccess();
    return sendJson(response, { ok: false, error: error.message }, error.statusCode);
  }
  const expectedFingerprint = state.allowedAssetFingerprints.get(requestedPath) ?? null;
  if (beforeSendHook) await beforeSendHook(requestedPath);
  await sendFile(requestedPath, response, {
    headers: assetResponseHeaders(requestedPath),
    expectedFingerprint
  });
}

function resolveRequestedAssetPath(state, assetId) {
  const id = optionalString(assetId);
  if (!id) throw badRequest("需要资产 ID。");
  const assetPath = state.allowedAssetPaths.get(id);
  if (!assetPath) throw forbiddenAssetAccess();
  return assetPath;
}

function authorizeAssetPath(state, assetPath, fingerprint) {
  const resolved = path.resolve(assetPath);
  let assetId = state.allowedAssetIds.get(resolved);
  if (!assetId) {
    assetId = randomUUID();
    state.allowedAssetIds.set(resolved, assetId);
    state.allowedAssetPaths.set(assetId, resolved);
  }
  state.allowedAssets.add(resolved);
  state.allowedAssetFingerprints.set(resolved, fingerprint);
  return assetId;
}

async function isAllowedAssetPath(state, requestedPath) {
  if (!state.allowedAssets.has(requestedPath)) return false;
  let linkInfo;
  try {
    linkInfo = await lstat(requestedPath);
  } catch {
    return true;
  }

  const registered = state.allowedAssetFingerprints.get(requestedPath);
  if (!registered) return !linkInfo.isSymbolicLink();

  const current = await assetFingerprint(requestedPath).catch(() => null);
  if (!current) return true;
  return current.realpath === registered.realpath
    && statMatchesFingerprint(current, registered);
}

async function assetFingerprint(assetPath) {
  const [real, info] = await Promise.all([
    realpath(assetPath),
    stat(assetPath)
  ]);
  return {
    realpath: real,
    ...fileStatFingerprint(info)
  };
}

function assetResponseHeaders(filePath) {
  if (path.extname(filePath).toLowerCase() !== ".html") return {};
  return {
    "Content-Security-Policy": "sandbox; default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'",
    "X-Content-Type-Options": "nosniff"
  };
}

function forbiddenAssetAccess() {
  const error = new Error("这个文件不是当前 UI 会话生成的资产。");
  error.statusCode = 403;
  return error;
}

async function sendFile(filePath, response, { headers = {}, expectedFingerprint = null } = {}) {
  let info;
  let fileHandle = null;
  try {
    if (expectedFingerprint) {
      fileHandle = await open(filePath, "r");
      info = await fileHandle.stat();
      if (!statMatchesFingerprint(info, expectedFingerprint)) {
        await closeFileHandle(fileHandle);
        fileHandle = null;
        const error = forbiddenAssetAccess();
        return sendJson(response, { ok: false, error: error.message }, error.statusCode);
      }
    } else {
      info = await stat(filePath);
    }
  } catch (error) {
    if (fileHandle) await closeFileHandle(fileHandle);
    if (error.code === "ENOENT") {
      return sendJson(response, { ok: false, error: "文件不存在。" }, 404);
    }
    logServerDiagnostic("无法读取文件", error);
    return sendJson(response, { ok: false, error: USER_FACING_FILE_READ_ERROR }, 500);
  }
  if (!info.isFile()) {
    if (fileHandle) await closeFileHandle(fileHandle);
    return sendJson(response, { ok: false, error: "目标不是文件。" }, 404);
  }
  const contentType = MIME_TYPES.get(path.extname(filePath).toLowerCase()) ?? "application/octet-stream";
  const stream = fileHandle
    ? fileHandle.createReadStream({ autoClose: true })
    : createReadStream(filePath);
  const cleanupStream = () => stream.destroy();
  const detachResponseCleanup = () => {
    response.off("close", cleanupStream);
    response.off("error", cleanupStream);
  };
  response.once("close", cleanupStream);
  response.once("error", cleanupStream);
  stream.on("error", (error) => {
    detachResponseCleanup();
    if (response.destroyed || response.writableEnded) return;
    if (!response.headersSent) {
      const statusCode = error.code === "ENOENT" ? 404 : 500;
      if (statusCode >= 500) logServerDiagnostic("无法读取文件流", error);
      return sendJson(response, {
        ok: false,
        error: statusCode === 404 ? "文件不存在。" : USER_FACING_FILE_READ_ERROR
      }, statusCode);
    }
    response.destroy(error);
  });
  stream.once("close", detachResponseCleanup);
  const startStreaming = () => {
    if (response.destroyed || response.writableEnded) {
      stream.destroy();
      return;
    }
    response.writeHead(200, {
      "Content-Type": contentType,
      "Content-Length": info.size,
      "Cache-Control": "no-store",
      ...headers
    });
    stream.pipe(response);
  };
  if (fileHandle) {
    startStreaming();
  } else {
    stream.on("open", startStreaming);
  }
}

function statMatchesFingerprint(info, fingerprint) {
  const current = fileStatFingerprint(info);
  return current.dev === fingerprint.dev
    && current.ino === fingerprint.ino
    && current.size === fingerprint.size
    && current.mtimeMs === fingerprint.mtimeMs
    && current.ctimeMs === fingerprint.ctimeMs;
}

function fileStatFingerprint(info) {
  return {
    dev: info.dev,
    ino: info.ino,
    size: info.size,
    mtimeMs: info.mtimeMs,
    ctimeMs: info.ctimeMs
  };
}

async function closeFileHandle(fileHandle) {
  await fileHandle.close().catch(() => {});
}

function sendJson(response, payload, statusCode = 200) {
  const body = `${JSON.stringify(payload, null, 2)}\n`;
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store"
  });
  response.end(body);
}

function sendApiJson(response, state, payload, statusCode = 200) {
  return sendJson(response, {
    ...payload,
    restore: restoreSummary(state),
    persistence: persistenceSummary(state)
  }, statusCode);
}

function userFacingApiError(error) {
  const statusCode = error.statusCode ?? 500;
  if (statusCode < 500 || error.expose) return error.message;
  logServerDiagnostic("UI request failed", error);
  return USER_FACING_UNEXPECTED_API_ERROR;
}

function logServerDiagnostic(label, _error) {
  console.error(`${label}：技术诊断已隐藏。`);
}

function isClientAbortedRequest(error, request) {
  const message = String(error?.message ?? "");
  return !request.complete && (isAbortError(error) || error?.code === "ECONNRESET" || message === "aborted");
}

function persistenceSummary(state) {
  return {
    configured: Boolean(state.jobStorePath),
    ok: !state.persistError,
    error: state.persistError ? USER_FACING_PERSISTENCE_ERROR : null
  };
}

function restoreSummary(state) {
  return {
    failed: Boolean(state.restoreFailed),
    error: state.restoreFailed ? (state.restoreFailureMessage ?? USER_FACING_RESTORE_ERROR) : null
  };
}

async function revealPath(targetPath, { revealLauncher = openPathInSystemShell, expectedFingerprint = null } = {}) {
  const normalized = requireString(targetPath, "需要路径。");
  let info;
  try {
    info = await stat(normalized);
  } catch (error) {
    if (error.code === "ENOENT") {
      const notFound = new Error("文件不存在。");
      notFound.statusCode = 404;
      throw notFound;
    }
    logServerDiagnostic("无法访问要显示的文件", error);
    throw httpError(USER_FACING_REVEAL_ACCESS_ERROR, 500, { expose: true });
  }
  if (!info.isFile() && !info.isDirectory()) {
    const error = new Error("目标不是文件或文件夹。");
    error.statusCode = 404;
    throw error;
  }
  if (expectedFingerprint && !statMatchesFingerprint(info, expectedFingerprint)) {
    throw forbiddenAssetAccess();
  }
  try {
    await revealLauncher(normalized, { isDirectory: info.isDirectory() });
  } catch (error) {
    logServerDiagnostic("无法打开系统文件管理器", error);
    throw httpError(USER_FACING_REVEAL_LAUNCH_ERROR, 500, { expose: true });
  }
}

async function openPathInSystemShell(normalized, { isDirectory }) {
  const target = isDirectory ? normalized : path.dirname(normalized);
  if (process.platform === "darwin") {
    await spawnDetached("open", isDirectory ? [target] : ["-R", normalized]);
  } else if (process.platform === "win32") {
    await spawnDetached("explorer.exe", isDirectory ? [normalized] : [`/select,${normalized}`]);
  } else {
    await spawnDetached("xdg-open", [target]);
  }
}

function spawnDetached(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      detached: true,
      stdio: "ignore",
      windowsHide: true
    });
    let settled = false;
    let timer;
    const settle = (callback, value) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      callback(value);
    };
    child.once("error", (error) => settle(reject, error));
    child.once("exit", (code, signal) => {
      if (code === 0) return settle(resolve);
      const detail = signal ? `signal ${signal}` : `exit ${code}`;
      settle(reject, new Error(`${command} closed with ${detail}.`));
    });
    timer = setTimeout(() => settle(resolve), REVEAL_LAUNCH_SETTLE_MS);
    timer.unref?.();
    child.unref();
  });
}

function httpError(message, statusCode, { expose = statusCode < 500 } = {}) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.expose = expose;
  return error;
}

function requireString(value, message) {
  const normalized = optionalString(value);
  if (!normalized) {
    const error = new Error(message);
    error.statusCode = 400;
    throw error;
  }
  return normalized;
}

function optionalString(value) {
  if (value === undefined || value === null) return "";
  return String(value).trim();
}

function optionalPositiveInteger(value, name, message) {
  if (value === undefined || value === null || value === "") return null;
  if (!Number.isInteger(value) || value < 1) {
    const error = new Error(message ?? `${name} must be an integer greater than or equal to 1.`);
    error.statusCode = 400;
    throw error;
  }
  return value;
}

function requireChoice(value, choices, name) {
  const normalized = String(value).trim();
  if (!choices.includes(normalized)) {
    const error = new Error(`${name} 必须是以下值之一：${choices.join(", ")}。`);
    error.statusCode = 400;
    throw error;
  }
  return normalized;
}

const thisFile = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === thisFile) {
  startStandaloneServer();
}

function startStandaloneServer() {
  const state = createUiState({ jobStorePath: defaultJobStorePath() });
  const server = createUiServer({
    state
  });
  let shuttingDown = false;
  server.once("error", (error) => {
    console.error(formatStandaloneServerError(error));
    process.exitCode = 1;
  });
  const shutdown = () => {
    if (shuttingDown) return;
    shuttingDown = true;
    shutdownStandaloneServer(server, state).catch((error) => {
      logServerDiagnostic("openFAD Motion UI 关闭失败", error);
      process.exitCode = 1;
    });
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
  server.listen(DEFAULT_PORT, DEFAULT_HOST, () => {
    const url = `http://${DEFAULT_HOST}:${DEFAULT_PORT}`;
    console.log(`openFAD Motion UI ${url}`);
    console.log(`Tool root: ${DEFAULT_TOOL_ROOT}`);
    console.log(`Platform: ${os.type()} ${os.release()} ${os.arch()}`);
  });
}

async function shutdownStandaloneServer(server, state) {
  await shutdownUiState(state);
  await closeStandaloneHttpServer(server);
}

function closeStandaloneHttpServer(server, timeoutMs = 1500) {
  return new Promise((resolve, reject) => {
    let settled = false;
    let forceTimer;
    let failTimer;

    const finish = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(forceTimer);
      clearTimeout(failTimer);
      if (error) reject(error);
      else resolve();
    };

    forceTimer = setTimeout(() => {
      try {
        server.closeIdleConnections?.();
        server.closeAllConnections?.();
      } catch (error) {
        finish(error);
      }
    }, timeoutMs);
    forceTimer.unref?.();

    failTimer = setTimeout(() => {
      finish(new Error("Timed out while closing the standalone UI HTTP server."));
    }, timeoutMs * 2);
    failTimer.unref?.();

    try {
      server.close((error) => finish(error));
    } catch (error) {
      finish(error);
    }
  });
}

function formatStandaloneServerError(error) {
  const address = `${DEFAULT_HOST}:${DEFAULT_PORT}`;
  if (error?.code === "EADDRINUSE") {
    return [
      `openFAD Motion UI 启动失败：端口已被占用 ${address}。`,
      "请关闭已有 UI 服务，或使用 OPENFAD_MOTION_UI_PORT=4390 npm run ui 指定其他端口。"
    ].join("\n");
  }
  return `openFAD Motion UI 启动失败 ${address}：${error?.message || String(error)}`;
}
