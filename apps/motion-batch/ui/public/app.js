const state = {
  currentJobId: null,
  currentJob: null,
  pollTimer: null,
  previewPath: "",
  previewFailedPath: "",
  reportPath: "",
  revealPendingAssetId: "",
  serverDefaults: null,
  outDirTouched: false,
  pathPickerPending: false,
  selectedInputPath: null,
  pollFailureCount: 0,
  pollInFlightJobId: null,
  jobSubmitPending: false,
  jobSubmitAbortController: null,
  cancelPendingJobId: null,
  historyClearPending: false,
  restorePending: true,
  restoreFailed: false,
  restoreFailureMessage: "",
  finalDetailPendingJobId: "",
  logClearedAt: null,
  lastProgressAnnouncementKey: "",
  persistenceError: "",
  pendingOverwriteConfirmation: null,
  pendingClearHistoryConfirmation: null,
  pendingFocusRestore: null,
  apiFieldValidationError: null
};

const CANCEL_REQUEST_TIMEOUT_MS = 10_000;
const CANCEL_TIMEOUT_MESSAGE = "停止请求没有响应。任务可能仍在停止，请稍后重试。";
const MISSING_INPUT_MESSAGE = "需要输入文件或文件夹路径。";
const MISSING_OUTPUT_MESSAGE = "需要输出文件夹路径。";
const INVALID_FPS_MESSAGE = "帧率必须是 auto、23.976、24、25、29.97、30、24000/1001 或 30000/1001。";
const INVALID_BITRATE_MESSAGE = "码率必须在 45M 到 100M 之间，例如 50M。";
const INVALID_FFMPEG_PATH_MESSAGE = "无法访问自定义 FFmpeg 路径。请确认文件存在且可执行。";
const INVALID_FFPROBE_PATH_MESSAGE = "无法访问自定义 FFprobe 路径。请确认文件存在且可执行。";
const RESTORE_PENDING_START_MESSAGE = "正在恢复上次任务状态。请稍后再开始新任务。";
const RESTORE_PENDING_CLEAR_MESSAGE = "正在恢复上次任务状态。请稍后再清除历史任务记录。";
const RESTORE_FAILED_START_MESSAGE = "无法恢复上次任务状态。请先重置本地任务恢复记录后再开始新任务。";
const ALLOWED_FRAME_RATES = new Set(["auto", "23.976", "24", "25", "29.97", "30", "24000/1001", "30000/1001"]);
const LOG_AUTOSCROLL_THRESHOLD_PX = 24;
const LOCAL_API_REQUEST_TIMEOUT_MS = 15_000;
const LOCAL_API_TIMEOUT_MESSAGE = "本地桥接请求没有响应。请重试；如果持续出现，请重启应用。";

const $ = (selector) => document.querySelector(selector);

const elements = {
  serverState: $("#serverState"),
  metricTotal: $("#metricTotal"),
  metricPass: $("#metricPass"),
  metricWarn: $("#metricWarn"),
  metricFail: $("#metricFail"),
  jobBadge: $("#jobBadge"),
  startButton: $("#startButton"),
  stopButton: $("#stopButton"),
  dryRunButton: $("#dryRunButton"),
  clearHistoryButton: $("#clearHistoryButton"),
  clearLogButton: $("#clearLogButton"),
  jobForm: $("#jobForm"),
  dropZone: $("#dropZone"),
  inputPath: $("#inputPath"),
  outDir: $("#outDir"),
  fps: $("#fps"),
  bitrate: $("#bitrate"),
  ffmpegPath: $("#ffmpegPath"),
  ffprobePath: $("#ffprobePath"),
  qcOnly: $("#qcOnly"),
  previewOnly: $("#previewOnly"),
  overwrite: $("#overwrite"),
  queueBody: $("#queueBody"),
  jobLog: $("#jobLog"),
  logRetentionNotice: $("#logRetentionNotice"),
  previewImage: $("#previewImage"),
  previewEmpty: $("#previewEmpty"),
  revealPreviewButton: $("#revealPreviewButton"),
  revealReportButton: $("#revealReportButton"),
  qcSummary: $("#qcSummary"),
  qcIssues: $("#qcIssues"),
  jobStatusAnnouncer: $("#jobStatusAnnouncer"),
  errorPanel: $("#errorPanel"),
  toast: $("#toast"),
  overwriteDialog: $("#overwriteDialog"),
  overwriteDialogSummary: $("#overwriteDialogSummary"),
  overwriteDialogList: $("#overwriteDialogList"),
  overwriteDialogMore: $("#overwriteDialogMore"),
  overwriteCancelButton: $("#overwriteCancelButton"),
  overwriteConfirmButton: $("#overwriteConfirmButton"),
  clearHistoryDialog: $("#clearHistoryDialog"),
  clearHistoryDialogSummary: $("#clearHistoryDialogSummary"),
  clearHistoryCancelButton: $("#clearHistoryCancelButton"),
  clearHistoryConfirmButton: $("#clearHistoryConfirmButton")
};

const ICONS = {
  play: "<polygon points=\"5 3 19 12 5 21 5 3\"></polygon>",
  square: "<rect x=\"6\" y=\"6\" width=\"12\" height=\"12\" rx=\"1\"></rect>",
  terminal: "<polyline points=\"4 17 10 11 4 5\"></polyline><line x1=\"12\" y1=\"19\" x2=\"20\" y2=\"19\"></line>",
  "file-video": "<path d=\"M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z\"></path><path d=\"M14 2v6h6\"></path><path d=\"m10 11 5 3-5 3v-6z\"></path>",
  folder: "<path d=\"M3 7a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v1H3z\"></path><path d=\"M3 10h18l-2 9H5z\"></path>",
  "folder-open": "<path d=\"M6 17h12l3-8H9l-3 8z\"></path><path d=\"M3 17V6a2 2 0 0 1 2-2h5l2 2h5a2 2 0 0 1 2 2v1\"></path>",
  "external-link": "<path d=\"M15 3h6v6\"></path><path d=\"M10 14 21 3\"></path><path d=\"M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6\"></path>",
  "file-text": "<path d=\"M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z\"></path><path d=\"M14 2v6h6\"></path><line x1=\"8\" y1=\"13\" x2=\"16\" y2=\"13\"></line><line x1=\"8\" y1=\"17\" x2=\"16\" y2=\"17\"></line>",
  eye: "<path d=\"M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z\"></path><circle cx=\"12\" cy=\"12\" r=\"3\"></circle>",
  "trash-2": "<path d=\"M3 6h18\"></path><path d=\"M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2\"></path><path d=\"M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6\"></path><line x1=\"10\" y1=\"11\" x2=\"10\" y2=\"17\"></line><line x1=\"14\" y1=\"11\" x2=\"14\" y2=\"17\"></line>",
  x: "<line x1=\"18\" y1=\"6\" x2=\"6\" y2=\"18\"></line><line x1=\"6\" y1=\"6\" x2=\"18\" y2=\"18\"></line>"
};

boot();

async function boot() {
  renderIcons();
  bindEvents();
  renderRestorePendingState();
  renderActionControls();
  await loadServerState();
  try {
    const restored = await restoreActiveJob();
    if (!restored) renderEmpty();
  } finally {
    state.restorePending = false;
    renderActionControls();
  }
}

function renderIcons() {
  document.querySelectorAll("[data-icon]").forEach((node) => {
    const name = node.dataset.icon;
    const icon = ICONS[name];
    if (!icon) return;
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("class", "icon");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("aria-hidden", "true");
    svg.innerHTML = icon;
    if (node.classList.contains("drop-icon")) {
      node.append(svg);
    } else {
      node.prepend(svg);
    }
  });
}

function bindEvents() {
  elements.startButton.addEventListener("click", () => startJob(false));
  elements.dryRunButton.addEventListener("click", () => startJob(true));
  elements.stopButton.addEventListener("click", stopJob);
  elements.clearHistoryButton.addEventListener("click", clearJobHistory);
  elements.jobForm.addEventListener("submit", (event) => {
    event.preventDefault();
    startJob(false);
  });
  elements.jobForm.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    if (!isTextInput(event.target)) return;
    if (isImeCompositionEvent(event)) return;
    event.preventDefault();
    startJob(false);
  });
  elements.inputPath.addEventListener("input", () => {
    clearValidationErrorIfCurrent(MISSING_INPUT_MESSAGE, Boolean(elements.inputPath.value.trim()), elements.inputPath);
  });
  elements.inputPath.addEventListener("change", () => {
    clearValidationErrorIfCurrent(MISSING_INPUT_MESSAGE, Boolean(elements.inputPath.value.trim()), elements.inputPath);
  });
  elements.outDir.addEventListener("input", () => {
    state.outDirTouched = true;
    clearValidationErrorIfCurrent(MISSING_OUTPUT_MESSAGE, Boolean(elements.outDir.value.trim()), elements.outDir);
  });
  elements.outDir.addEventListener("change", () => {
    state.outDirTouched = true;
    clearValidationErrorIfCurrent(MISSING_OUTPUT_MESSAGE, Boolean(elements.outDir.value.trim()), elements.outDir);
  });
  elements.fps.addEventListener("input", () => {
    clearValidationErrorIfCurrent(INVALID_FPS_MESSAGE, isValidLocalFrameRate(elements.fps.value), elements.fps);
  });
  elements.fps.addEventListener("change", () => {
    clearValidationErrorIfCurrent(INVALID_FPS_MESSAGE, isValidLocalFrameRate(elements.fps.value), elements.fps);
  });
  elements.bitrate.addEventListener("input", () => {
    clearValidationErrorIfCurrent(INVALID_BITRATE_MESSAGE, isValidLocalBitrate(elements.bitrate.value), elements.bitrate);
  });
  elements.bitrate.addEventListener("change", () => {
    clearValidationErrorIfCurrent(INVALID_BITRATE_MESSAGE, isValidLocalBitrate(elements.bitrate.value), elements.bitrate);
  });
  elements.ffmpegPath.addEventListener("input", () => {
    clearApiFieldValidationError("ffmpegPath");
  });
  elements.ffmpegPath.addEventListener("change", () => {
    clearApiFieldValidationError("ffmpegPath");
  });
  elements.ffprobePath.addEventListener("input", () => {
    clearApiFieldValidationError("ffprobePath");
  });
  elements.ffprobePath.addEventListener("change", () => {
    clearApiFieldValidationError("ffprobePath");
  });
  elements.clearLogButton.addEventListener("click", () => {
    state.logClearedAt = new Date().toISOString();
    elements.jobLog.textContent = "";
    hideLogRetentionNotice();
  });
  elements.revealPreviewButton.addEventListener("click", () => revealPath(state.previewPath));
  elements.revealReportButton.addEventListener("click", () => revealPath(state.reportPath));
  elements.overwriteCancelButton.addEventListener("click", () => resolveOverwriteDialog(false));
  elements.overwriteConfirmButton.addEventListener("click", () => resolveOverwriteDialog(true));
  elements.clearHistoryCancelButton.addEventListener("click", () => resolveClearHistoryDialog(false));
  elements.clearHistoryConfirmButton.addEventListener("click", () => resolveClearHistoryDialog(true));
  elements.overwriteDialog.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      resolveOverwriteDialog(false);
      return;
    }
    trapOverwriteDialogFocus(event);
  });
  elements.clearHistoryDialog.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      resolveClearHistoryDialog(false);
      return;
    }
    trapClearHistoryDialogFocus(event);
  });
  document.addEventListener("focusin", keepModalFocusInside, true);

  document.querySelectorAll("[data-picker]").forEach((button) => {
    button.addEventListener("click", () => pickPath(button));
  });

  elements.dropZone.addEventListener("click", pickPrimaryInputPath);
  elements.dropZone.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      pickPrimaryInputPath();
    }
  });

  elements.qcOnly.addEventListener("change", () => {
    if (elements.qcOnly.checked) elements.previewOnly.checked = false;
  });
  elements.previewOnly.addEventListener("change", () => {
    if (elements.previewOnly.checked) elements.qcOnly.checked = false;
  });

  elements.dropZone.addEventListener("dragover", (event) => {
    event.preventDefault();
    elements.dropZone.classList.add("dragging");
  });
  elements.dropZone.addEventListener("dragleave", () => {
    elements.dropZone.classList.remove("dragging");
  });
  elements.dropZone.addEventListener("drop", (event) => {
    event.preventDefault();
    elements.dropZone.classList.remove("dragging");
    const files = Array.from(event.dataTransfer?.files ?? []);
    if (files.length > 1) {
      renderDropError("一次只能拖入一个文件或文件夹。请拖入单个文件，或使用选择文件夹来批处理多个视频。");
      return;
    }
    const file = files[0];
    handleDroppedInput(file);
  });
}

function isTextInput(target) {
  if (!(target instanceof HTMLInputElement)) return false;
  return ["text", "search", "url", "tel", "email", "number", "password"].includes(target.type);
}

function pickPrimaryInputPath() {
  const filePicker = document.querySelector("[data-picker=\"inputFile\"]");
  if (filePicker) {
    pickPath(filePicker);
    return;
  }
  elements.inputPath.focus();
  elements.inputPath.select();
}

async function pickPath(button) {
  const input = document.getElementById(button.dataset.target);
  const kind = button.dataset.picker;
  if (!input || !kind) return;
  if (state.pathPickerPending) return;

  if (!window.fadNative?.pickPath) {
    input.focus();
    input.select();
    showStatusToast("桌面版可直接选择路径；浏览器模式请粘贴路径。");
    return;
  }

  state.pathPickerPending = true;
  setPickerButtonsDisabled(true);
  try {
    const result = await window.fadNative.pickPath({ kind });
    if (result?.error) {
      renderPickerError(result.error);
      return;
    }
    if (!result?.canceled && result?.path) {
      input.value = result.path;
      input.dispatchEvent(new Event("input", { bubbles: true }));
      clearTransientError();
    }
  } catch (error) {
    renderPickerError(error.message);
  } finally {
    state.pathPickerPending = false;
    setPickerButtonsDisabled(false);
  }
}

function renderPickerError(message) {
  const safeMessage = sanitizeDisplayMessage(message) || "系统路径选择器不可用。";
  renderLogLine(safeMessage, "error");
  showTransientError(safeMessage);
  showToast(safeMessage);
}

async function handleDroppedInput(file) {
  if (file?.path) {
    setDroppedInputPath(file.path);
    return;
  }

  if (file && window.fadNative?.getPathForFile) {
    try {
      const nativePath = await window.fadNative.getPathForFile(file);
      if (nativePath) {
        setDroppedInputPath(nativePath);
        return;
      }
    } catch {
      // Fall through to the persistent unsupported-drop message below.
    }
  }

  const message = file?.name
    ? `无法读取 ${file.name} 的本地路径。请使用选择按钮或粘贴完整路径。`
    : "没有读取到可用的本地路径。请使用选择按钮或粘贴完整路径。";
  renderDropError(message);
}

function renderDropError(message) {
  renderLogLine(message, "error");
  showTransientError(message);
  showToast(message);
}

function setDroppedInputPath(inputPath) {
  elements.inputPath.value = inputPath;
  elements.inputPath.dispatchEvent(new Event("input", { bubbles: true }));
  clearTransientError();
}

function setPickerButtonsDisabled(disabled) {
  document.querySelectorAll("[data-picker]").forEach((pickerButton) => {
    pickerButton.disabled = disabled;
  });
}

async function loadServerState() {
  try {
    const [health, spec] = await Promise.all([
      apiGet("/api/health"),
      apiGet("/api/spec")
    ]);
    state.serverDefaults = spec.defaults;
    elements.serverState.textContent = `${health.platform} ${health.arch} · ${health.node}`;
    if (!state.outDirTouched && !elements.outDir.value.trim()) {
      elements.outDir.value = spec.defaults.outDir;
    }
    clearTransientError();
  } catch (error) {
    elements.serverState.textContent = "本地桥接不可用";
    showTransientError(error.message);
    showToast(error.message);
  }
}

async function restoreActiveJob() {
  try {
    const response = await apiGet("/api/jobs");
    if (response.restore?.failed) {
      const message = restoreFailureMessage(response.restore.error);
      renderRestoreFailure(message);
      showTransientError(message);
      showToast(message);
      return true;
    }
    return await restoreJobList(response.jobs ?? []);
  } catch (error) {
    const message = restoreFailureMessage(error.message);
    renderRestoreFailure(message);
    showTransientError(message);
    showToast(message);
    return true;
  }
}

function restoreFailureMessage(message) {
  const detail = sanitizeDisplayMessage(message) || "未知错误";
  return `无法恢复上次任务状态：${detail}`;
}

function renderRestoreFailure(message) {
  state.restoreFailed = true;
  state.restoreFailureMessage = message;
  resetPreview();
  resetReviewState();
  clearPollTimer();
  setBusy(false);
  const job = {
    id: "restore-failure",
    status: "failed",
    total: 0,
    completed: 0,
    passed: 0,
    warnings: 0,
    failed: 0,
    emptyMessage: "任务恢复失败",
    error: message,
    logs: [{
      at: new Date().toISOString(),
      level: "error",
      message
    }],
    items: []
  };
  renderJob(job);
  elements.jobStatusAnnouncer.textContent = "上次任务状态恢复失败。请重置本地任务恢复记录。";
  renderActionControls();
}

function renderRestorePendingState() {
  elements.jobBadge.className = "status-chip processing";
  elements.jobBadge.textContent = "恢复中";
  elements.jobStatusAnnouncer.textContent = "正在恢复上次任务状态。";
}

async function restoreJobList(jobs) {
  state.restoreFailed = false;
  state.restoreFailureMessage = "";
  const activeJob = jobs.find((job) => ["queued", "running"].includes(job.status));
  if (!activeJob) {
    const latestJob = jobs.at(-1);
    if (!latestJob) {
      resetPreview();
      resetReviewState();
      setBusy(false);
      clearPollTimer();
      return false;
    }

    state.currentJobId = latestJob.id;
    state.logClearedAt = null;
    state.selectedInputPath = currentInputKey(latestJob);
    setBusy(false);
    state.currentJob = latestJob;
    renderJob(latestJob);
    await loadFinalJobDetail(latestJob);
    return true;
  }

  state.currentJobId = activeJob.id;
  state.logClearedAt = null;
  state.selectedInputPath = currentInputKey(activeJob);
  state.currentJob = activeJob;
  setBusy(true);
  renderJob(activeJob);
  const job = await pollJob();
  if (!job || isFinal(job.status) || state.pollFailureCount > 0) return true;
  startPolling();
  return true;
}

async function clearJobHistory() {
  if (state.restorePending) {
    showTransientError(RESTORE_PENDING_CLEAR_MESSAGE);
    showToast(RESTORE_PENDING_CLEAR_MESSAGE);
    return;
  }
  if (state.restoreFailed) {
    await resetJobRecovery();
    return;
  }
  if (state.jobSubmitPending || state.historyClearPending || state.cancelPendingJobId || state.pendingClearHistoryConfirmation) return;

  const confirmed = await showClearHistoryDialog();
  if (!confirmed) return;
  if (state.restorePending || state.restoreFailed || state.jobSubmitPending || state.historyClearPending || state.cancelPendingJobId) return;

  state.historyClearPending = true;
  renderActionControls();
  try {
    const response = await apiDelete("/api/jobs/history", { confirm: "clear-finished-history" });
    await restoreJobList(response.jobs ?? []);
    const count = Number.isInteger(response.cleared) ? response.cleared : 0;
    showStatusToast(count > 0 ? `已清除 ${count} 条历史任务记录，输出文件不会被删除。` : "没有可清除的历史任务记录，输出文件不会被删除。");
    clearTransientError();
  } catch (error) {
    showTransientError(error.message);
    renderLogLine(error.message, "error");
    showToast(error.message);
  } finally {
    state.historyClearPending = false;
    renderActionControls();
  }
}

async function resetJobRecovery() {
  if (state.historyClearPending || state.jobSubmitPending || state.cancelPendingJobId || state.pendingClearHistoryConfirmation) return;
  state.historyClearPending = true;
  renderActionControls();
  try {
    const response = await apiDelete("/api/jobs/recovery", { confirm: "reset-restore-failure" });
    const restored = await restoreJobList(response.jobs ?? []);
    if (!restored) renderEmpty();
    clearTransientError();
    showStatusToast("已重置本地任务恢复记录，可以重新开始任务。");
  } catch (error) {
    showTransientError(error.message);
    renderLogLine(error.message, "error");
    showToast(error.message);
  } finally {
    state.historyClearPending = false;
    renderActionControls();
  }
}

async function startJob(dryRun) {
  if (
    state.jobSubmitPending
    || state.historyClearPending
    || state.cancelPendingJobId
    || state.pendingClearHistoryConfirmation
    || hasActiveRendererJob()
  ) return;
  if (state.restorePending) {
    showTransientError(RESTORE_PENDING_START_MESSAGE);
    showToast(RESTORE_PENDING_START_MESSAGE);
    return;
  }
  if (state.restoreFailed) {
    showTransientError(RESTORE_FAILED_START_MESSAGE);
    showToast(RESTORE_FAILED_START_MESSAGE);
    return;
  }

  const payload = readForm();
  payload.dryRun = dryRun;
  if (!payload.input) {
    const message = MISSING_INPUT_MESSAGE;
    renderLogLine(message, "error");
    showPersistentError(message);
    showToast(message);
    markFieldInvalid(elements.inputPath);
    elements.inputPath.focus();
    return;
  }
  clearFieldValidationError(elements.inputPath);
  if (!payload.outDir) {
    payload.outDir = state.serverDefaults?.outDir ?? "";
  }
  if (!payload.outDir) {
    const message = MISSING_OUTPUT_MESSAGE;
    renderLogLine(message, "error");
    showPersistentError(message);
    showToast(message);
    markFieldInvalid(elements.outDir);
    elements.outDir.focus();
    return;
  }
  clearFieldValidationError(elements.outDir);
  const encodingValidation = validateLocalEncodingOptions(payload);
  if (encodingValidation) {
    renderLocalValidationError(encodingValidation.message, encodingValidation.field);
    return;
  }
  clearFieldValidationError(elements.fps);
  clearFieldValidationError(elements.bitrate);
  clearApiFieldValidationError("ffmpegPath");
  clearApiFieldValidationError("ffprobePath");
  const previousReviewState = captureReviewState();
  resetPreview();
  resetReviewState();
  clearTransientError();
  const abortController = new AbortController();
  state.jobSubmitAbortController = abortController;
  state.jobSubmitPending = true;
  setSubmitting(true);
  renderPreflightState();
  renderLogLine("正在检查输入和输出路径。");
  try {
    const response = await postJobWithOverwriteConfirmation(payload, { dryRun, signal: abortController.signal });
    renderLogLine(dryRun ? "模拟运行已加入队列。" : "渲染任务已加入队列。");
    state.currentJobId = response.job.id;
    state.selectedInputPath = currentInputKey(response.job);
    state.currentJob = response.job;
    setBusy(true);
    renderJob(response.job);
    const job = await pollJob();
    if (!job || isFinal(job.status) || state.pollFailureCount > 0) return;
    startPolling();
  } catch (error) {
    setBusy(false);
    restoreReviewState(previousReviewState);
    if (isAbortError(error)) {
      showStatusToast("已停止检查输入和输出路径。");
      return;
    }
    if (error.cancelledOverwriteConfirmation) {
      showToast(error.message);
      return;
    }
    renderLogLine(error.message, "error");
    showTransientError(error.message);
    showToast(error.message);
    markApiFieldValidationError(error.field, error.message);
  } finally {
    if (state.jobSubmitAbortController === abortController) {
      state.jobSubmitAbortController = null;
    }
    state.jobSubmitPending = false;
    renderActionControls();
  }
}

function hasActiveRendererJob() {
  return Boolean(state.currentJobId && (!state.currentJob || !isFinal(state.currentJob.status)));
}

async function stopJob() {
  if (state.cancelPendingJobId) return;
  if (state.jobSubmitPending && !state.currentJobId) {
    state.jobSubmitAbortController?.abort();
    showStatusToast("已停止检查输入和输出路径。");
    return;
  }
  if (!state.currentJobId) return;
  const jobId = state.currentJobId;
  state.cancelPendingJobId = jobId;
  showToast("正在停止当前处理。");
  elements.jobStatusAnnouncer.textContent = "正在停止当前处理。";
  renderActionControls();
  const abortController = new AbortController();
  const timeoutId = setTimeout(() => abortController.abort(), CANCEL_REQUEST_TIMEOUT_MS);
  try {
    await apiPost(`/api/jobs/${jobId}/cancel`, {}, { signal: abortController.signal, timeoutMs: null });
    await pollJob();
  } catch (error) {
    if (isAbortError(error)) {
      renderLogLine(CANCEL_TIMEOUT_MESSAGE, "error");
      showTransientError(CANCEL_TIMEOUT_MESSAGE);
      showToast(CANCEL_TIMEOUT_MESSAGE);
      return;
    }
    if (error.status === 409) {
      showToast("任务已经结束，正在刷新状态。");
      await pollJob();
      return;
    }
    renderLogLine(error.message, "error");
    showTransientError(error.message);
    showToast(error.message);
  } finally {
    if (state.cancelPendingJobId === jobId) {
      state.cancelPendingJobId = null;
    }
    clearTimeout(timeoutId);
    renderActionControls();
  }
}

function startPolling() {
  clearPollTimer();
  state.pollFailureCount = 0;
  state.pollTimer = setInterval(pollJob, 1000);
}

async function pollJob() {
  const jobId = state.currentJobId;
  if (!jobId) return;
  if (state.pollInFlightJobId === jobId) return state.currentJob ?? null;
  state.pollInFlightJobId = jobId;
  try {
    const response = await apiGet(`/api/jobs/${jobId}/poll`);
    if (state.currentJobId !== jobId || response.job?.id !== jobId) return state.currentJob ?? null;
    resumePollingAfterRetry(response.job);
    state.pollFailureCount = 0;
    clearTransientError();
    state.currentJob = response.job;
    renderJob(response.job);
    if (isFinal(response.job.status)) {
      clearPollTimer();
      setFinalDetailPending(response.job.id);
      return loadFinalJobDetail(response.job);
    }
    return response.job;
  } catch (error) {
    if (state.currentJobId !== jobId) return state.currentJob ?? null;
    if (shouldRetryPoll()) {
      schedulePollRetry(error);
      return state.currentJob ?? null;
    }
    clearPollTimer();
    setBusy(false);
    showTransientError(error.message);
    showToast(error.message);
    return state.currentJob ?? null;
  } finally {
    if (state.pollInFlightJobId === jobId) {
      state.pollInFlightJobId = null;
    }
  }
}

async function loadFinalJobDetail(snapshot) {
  const jobId = state.currentJobId;
  setFinalDetailPending(jobId);
  try {
    const detail = await apiGet(`/api/jobs/${jobId}?full=1`);
    if (state.currentJobId !== jobId) {
      clearFinalDetailPending(jobId);
      return state.currentJob ?? snapshot;
    }
    state.pollFailureCount = 0;
    clearFinalDetailPending(jobId);
    clearTransientError();
    state.currentJob = detail.job;
    renderJob(detail.job);
    return detail.job;
  } catch (error) {
    if (state.currentJobId !== jobId) {
      clearFinalDetailPending(jobId);
      return state.currentJob ?? snapshot;
    }
    state.currentJob = snapshot;
    renderJob(snapshot);
    scheduleFinalDetailRetry(error, snapshot, jobId);
    return snapshot;
  }
}

function shouldRetryPoll() {
  if (!state.currentJobId) return false;
  return !state.currentJob || !isFinal(state.currentJob.status);
}

function resumePollingAfterRetry(job) {
  if (isFinal(job.status) || state.pollFailureCount === 0) return;
  startPolling();
}

function clearPollTimer() {
  clearInterval(state.pollTimer);
  clearTimeout(state.pollTimer);
  state.pollTimer = null;
}

function schedulePollRetry(error) {
  clearPollTimer();
  state.pollFailureCount += 1;
  const retryMs = Math.min(30_000, 1000 * (2 ** Math.min(state.pollFailureCount - 1, 5)));
  const seconds = Math.ceil(retryMs / 1000);
  setBusy(true);
  showPersistentError(`连接中断，${seconds} 秒后重连。${error.message}`);
  showToast("连接中断，正在重连。");
  state.pollTimer = setTimeout(() => {
    state.pollTimer = null;
    pollJob();
  }, retryMs);
}

function scheduleFinalDetailRetry(error, snapshot, jobId) {
  clearPollTimer();
  setFinalDetailPending(jobId);
  state.pollFailureCount += 1;
  const retryMs = Math.min(30_000, 1000 * (2 ** Math.min(state.pollFailureCount - 1, 5)));
  const seconds = Math.ceil(retryMs / 1000);
  showPersistentError(`任务已结束，完整报告暂时无法加载，${seconds} 秒后重试。${error.message}`);
  showToast("任务已结束，正在重新加载完整报告。");
  state.pollTimer = setTimeout(() => {
    state.pollTimer = null;
    if (state.currentJobId === jobId) loadFinalJobDetail(snapshot);
  }, retryMs);
}

function readForm() {
  const data = new FormData(elements.jobForm);
  return {
    input: String(data.get("input") ?? "").trim(),
    outDir: String(data.get("outDir") ?? "").trim(),
    mode: String(data.get("mode") ?? "scale-fill"),
    encoder: String(data.get("encoder") ?? "auto"),
    container: String(data.get("container") ?? "mp4"),
    fps: String(data.get("fps") ?? "auto").trim(),
    bitrate: String(data.get("bitrate") ?? "50M").trim(),
    qcOnly: data.get("qcOnly") === "on",
    previewOnly: data.get("previewOnly") === "on",
    overwrite: data.get("overwrite") === "on",
    ffmpegPath: String(data.get("ffmpegPath") ?? "").trim(),
    ffprobePath: String(data.get("ffprobePath") ?? "").trim()
  };
}

function validateLocalEncodingOptions(payload) {
  if (!isValidLocalFrameRate(payload.fps)) {
    return { field: elements.fps, message: INVALID_FPS_MESSAGE };
  }
  if (!isValidLocalBitrate(payload.bitrate)) {
    return { field: elements.bitrate, message: INVALID_BITRATE_MESSAGE };
  }
  return null;
}

function isValidLocalFrameRate(value) {
  const normalized = String(value ?? "").trim();
  if (!normalized) return true;
  return ALLOWED_FRAME_RATES.has(normalized.toLowerCase()) || ALLOWED_FRAME_RATES.has(normalized);
}

function isValidLocalBitrate(value) {
  const normalized = String(value ?? "").trim();
  if (!normalized) return true;
  const match = normalized.match(/^(\d+(?:\.\d+)?)m$/i);
  if (!match) return false;
  const mbps = Number(match[1]);
  return Number.isFinite(mbps) && mbps >= 45 && mbps <= 100;
}

function renderLocalValidationError(message, field) {
  renderLogLine(message, "error");
  showPersistentError(message);
  showToast(message);
  markFieldInvalid(field);
  field?.focus();
}

async function postJobWithOverwriteConfirmation(payload, { dryRun, signal }) {
  try {
    return await apiPost("/api/jobs", payload, { signal });
  } catch (error) {
    if (!isOverwriteConfirmationRequest(error)) throw error;
    if (!await confirmOverwrite(error.overwriteConfirmation, { dryRun, signal })) {
      const cancelled = new Error("已取消覆盖确认。");
      cancelled.cancelledOverwriteConfirmation = true;
      throw cancelled;
    }
    return apiPost("/api/jobs", {
      ...payload,
      overwriteConfirmationToken: error.overwriteConfirmation.token
    }, { signal });
  }
}

function isOverwriteConfirmationRequest(error) {
  return error.status === 409
    && error.overwriteConfirmation?.required === true
    && typeof error.overwriteConfirmation.token === "string";
}

async function confirmOverwrite(confirmation, { dryRun, signal }) {
  if (dryRun) return true;
  return showOverwriteDialog(confirmation, { signal });
}

function overwriteConfirmationDetails(confirmation) {
  const replacements = Array.isArray(confirmation.replacements) ? confirmation.replacements : [];
  const count = Number.isInteger(confirmation.count) ? confirmation.count : replacements.length;
  const visible = replacements.slice(0, 8);
  const hidden = Math.max(0, count - visible.length);
  return { count, visible, hidden };
}

function showOverwriteDialog(confirmation, { signal } = {}) {
  if (signal?.aborted) throw createAbortError("Overwrite confirmation was cancelled.");
  closeOverwriteDialog();
  const previousFocus = document.activeElement;
  const { count, visible, hidden } = overwriteConfirmationDetails(confirmation);
  elements.overwriteDialogSummary.textContent = `确认覆盖后会替换 ${count} 个已有输出文件。`;
  elements.overwriteDialogList.innerHTML = visible.length
    ? visible.map((replacement) => `<li>${escapeHtml(replacement)}</li>`).join("")
    : "<li>服务器未返回可显示的替换路径。</li>";
  elements.overwriteDialogMore.textContent = hidden > 0
    ? `另有 ${hidden} 个文件将被替换。`
    : "";
  elements.overwriteDialog.hidden = false;
  elements.overwriteCancelButton.focus();

  return new Promise((resolve, reject) => {
    const onAbort = () => rejectOverwriteDialog(createAbortError("Overwrite confirmation was cancelled."));
    state.pendingOverwriteConfirmation = {
      resolve,
      reject,
      signal,
      onAbort,
      previousFocus
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function resolveOverwriteDialog(confirmed) {
  const pending = state.pendingOverwriteConfirmation;
  if (!pending) return;
  closeOverwriteDialog();
  pending.resolve(confirmed);
}

function rejectOverwriteDialog(error) {
  const pending = state.pendingOverwriteConfirmation;
  if (!pending) return;
  closeOverwriteDialog();
  pending.reject(error);
}

function closeOverwriteDialog() {
  const pending = state.pendingOverwriteConfirmation;
  state.pendingOverwriteConfirmation = null;
  pending?.signal?.removeEventListener("abort", pending.onAbort);
  elements.overwriteDialog.hidden = true;
  elements.overwriteDialogList.innerHTML = "";
  elements.overwriteDialogSummary.textContent = "";
  elements.overwriteDialogMore.textContent = "";
  restoreFocusWhenAvailable(pending?.previousFocus);
}

function trapOverwriteDialogFocus(event) {
  if (event.key !== "Tab") return;
  const focusable = [
    elements.overwriteCancelButton,
    elements.overwriteConfirmButton
  ].filter((element) => !element.disabled);
  if (!focusable.length) return;

  const first = focusable[0];
  const last = focusable.at(-1);
  const active = document.activeElement;
  if (event.shiftKey && active === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && active === last) {
    event.preventDefault();
    first.focus();
  } else if (!focusable.includes(active)) {
    event.preventDefault();
    first.focus();
  }
}

function keepModalFocusInside(event) {
  if (state.pendingOverwriteConfirmation && !elements.overwriteDialog.hidden) {
    refocusOutsideModal(event.target, elements.overwriteDialog, [
      elements.overwriteCancelButton,
      elements.overwriteConfirmButton
    ]);
    return;
  }
  if (state.pendingClearHistoryConfirmation && !elements.clearHistoryDialog.hidden) {
    refocusOutsideModal(event.target, elements.clearHistoryDialog, [
      elements.clearHistoryCancelButton,
      elements.clearHistoryConfirmButton
    ]);
  }
}

function refocusOutsideModal(target, dialog, focusable) {
  if (isElementInside(target, dialog)) return;
  focusable.find((element) => !element.disabled)?.focus();
}

function isElementInside(target, parent) {
  let node = target;
  while (node) {
    if (node === parent) return true;
    node = node.parentElement;
  }
  return false;
}

function showClearHistoryDialog() {
  if (state.pendingClearHistoryConfirmation) return Promise.resolve(false);
  const previousFocus = document.activeElement;
  elements.clearHistoryDialog.hidden = false;
  elements.clearHistoryCancelButton.focus();

  return new Promise((resolve) => {
    state.pendingClearHistoryConfirmation = {
      resolve,
      previousFocus
    };
    renderActionControls();
  });
}

function resolveClearHistoryDialog(confirmed) {
  const pending = state.pendingClearHistoryConfirmation;
  if (!pending) return;
  closeClearHistoryDialog({ restoreFocus: !confirmed, renderControls: !confirmed });
  if (confirmed && pending.previousFocus?.focus) queueFocusRestore(pending.previousFocus);
  pending.resolve(confirmed);
}

function closeClearHistoryDialog({ restoreFocus = true, renderControls = true } = {}) {
  const pending = state.pendingClearHistoryConfirmation;
  state.pendingClearHistoryConfirmation = null;
  elements.clearHistoryDialog.hidden = true;
  if (restoreFocus) restoreFocusWhenAvailable(pending?.previousFocus);
  if (renderControls) renderActionControls();
}

function trapClearHistoryDialogFocus(event) {
  if (event.key !== "Tab") return;
  const focusable = [
    elements.clearHistoryCancelButton,
    elements.clearHistoryConfirmButton
  ].filter((element) => !element.disabled);
  if (!focusable.length) return;

  const first = focusable[0];
  const last = focusable.at(-1);
  const active = document.activeElement;
  if (event.shiftKey && active === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && active === last) {
    event.preventDefault();
    first.focus();
  } else if (!focusable.includes(active)) {
    event.preventDefault();
    first.focus();
  }
}

function createAbortError(message) {
  const error = new Error(message);
  error.name = "AbortError";
  error.code = "ABORT_ERR";
  return error;
}

function renderJob(job) {
  const status = normalizeStatus(job.status);
  elements.jobBadge.className = `status-chip ${status}`;
  elements.jobBadge.textContent = statusLabel(status);
  elements.metricTotal.textContent = String(job.total ?? 0);
  elements.metricPass.textContent = String(job.passed ?? 0);
  elements.metricWarn.textContent = String(job.warnings ?? 0);
  elements.metricFail.textContent = String(job.failed ?? 0);

  const logs = job.logs ?? [];
  const selectedItem = selectReviewItem(job);
  const selectedResult = selectedItem?.result ?? null;
  const visibleLogs = filterVisibleLogs(logs);
  renderQueue(job, selectedItem);
  renderLogs(visibleLogs);
  renderLogRetentionNotice(job, logs.length);
  renderPreview(selectedResult, selectedItem);
  renderQc(selectedItem, job);
  announceJobProgress(job);
}

function renderEmpty() {
  elements.queueBody.innerHTML = "<tr class=\"empty-row\"><td colspan=\"5\">暂无批处理任务</td></tr>";
  elements.jobLog.textContent = "";
  hideLogRetentionNotice();
  elements.qcSummary.innerHTML = "<span class=\"status-chip idle\">空闲</span>";
  elements.qcIssues.innerHTML = "";
  elements.jobStatusAnnouncer.textContent = "";
  elements.jobBadge.className = "status-chip idle";
  elements.jobBadge.textContent = "空闲";
}

function resetReviewState() {
  state.currentJobId = null;
  state.currentJob = null;
  state.selectedInputPath = null;
  state.finalDetailPendingJobId = "";
  state.logClearedAt = null;
  state.lastProgressAnnouncementKey = "";
  state.reportPath = "";
  elements.revealReportButton.disabled = true;
  elements.metricTotal.textContent = "0";
  elements.metricPass.textContent = "0";
  elements.metricWarn.textContent = "0";
  elements.metricFail.textContent = "0";
  renderEmpty();
}

function captureReviewState() {
  return {
    currentJobId: state.currentJobId,
    currentJob: state.currentJob,
    selectedInputPath: state.selectedInputPath,
    logClearedAt: state.logClearedAt,
    lastProgressAnnouncementKey: state.lastProgressAnnouncementKey,
    progressAnnouncementText: elements.jobStatusAnnouncer.textContent
  };
}

function restoreReviewState(reviewState) {
  state.currentJobId = reviewState.currentJobId;
  state.currentJob = reviewState.currentJob;
  state.selectedInputPath = reviewState.selectedInputPath;
  state.logClearedAt = reviewState.logClearedAt;
  state.lastProgressAnnouncementKey = reviewState.lastProgressAnnouncementKey;
  resetPreview();
  elements.jobStatusAnnouncer.textContent = reviewState.progressAnnouncementText;
  if (reviewState.currentJob) {
    renderJob(reviewState.currentJob);
    return;
  }
  renderEmpty();
  elements.jobBadge.className = "status-chip idle";
  elements.jobBadge.textContent = "空闲";
}

function renderQueue(job, selectedItem = null) {
  const previousFocus = captureQueueFocus();
  const items = job.items ?? [];
  if (!items.length) {
    elements.queueBody.innerHTML = renderEmptyJobRow(job);
    restoreEmptyQueueFocus(previousFocus);
    return;
  }

  const noticeRows = job.itemsOffset > 0
    ? [`<tr class="notice-row"><td colspan="5">仅显示最近 ${items.length}/${job.totalItems ?? job.total ?? items.length} 个结果，完整交付文件和报告请在输出目录复核。</td></tr>`]
    : [];
  const itemRows = items.map((item, index) => {
    const result = item.result;
    const status = normalizeStatus(item.status);
    const assets = result?.assets ?? {};
    const issues = result?.issueSummary;
    const issueClass = issues?.errorCount ? "fail" : issues?.warningCount ? "warn" : "";
    const issueText = issues ? `${issues.errorCount + issues.warningCount}` : item.error ? "1" : "0";
    const stageText = stageLabel(item.currentStage);
    const selected = itemInputKey(item) === itemInputKey(selectedItem);
    const outputText = outputSummaryTextForItem(item);
    const source = item.inputLabel || shortPath(item.inputPath);
    const actionSource = source || "当前文件";
    const sub = item.error ? sanitizeDisplayMessage(item.error) : source;
    const statusText = [statusLabel(status), stageText].filter(Boolean).join("，");
    const sourceText = sub && sub !== source ? `${source}，${sub}` : source;
    const outputAriaText = outputAriaSummaryForItem(item, outputText);
    const currentAttribute = selected ? " aria-current=\"true\"" : "";

    return `<tr class="${selected ? "selected" : ""}" data-input-key="${index}">
      <td data-label="状态" aria-label="${escapeHtml(cellAriaLabel("状态", statusText))}"><button class="row-select-button" type="button" data-row-select="true" aria-label="${escapeHtml(rowSelectionLabel(source, { selected }))}"${currentAttribute}><span class="status-chip ${status}">${escapeHtml(statusLabel(status))}</span>${stageText ? `<span class="stage-chip">${escapeHtml(stageText)}</span>` : ""}</button></td>
      <td class="path-cell" data-label="来源" aria-label="${escapeHtml(cellAriaLabel("来源", sourceText))}"><span class="path-name">${escapeHtml(source)}</span><span class="path-sub">${escapeHtml(sub)}</span></td>
      <td data-label="问题" aria-label="${escapeHtml(cellAriaLabel("问题", issueText))}"><span class="issue-count ${issueClass}">${escapeHtml(issueText)}</span></td>
      <td class="path-cell" data-label="输出" aria-label="${escapeHtml(cellAriaLabel("输出", outputAriaText))}"><span class="path-sub">${escapeHtml(outputText)}</span></td>
      <td data-label="操作" aria-label="${escapeHtml(cellAriaLabel("操作", actionSource))}"><div class="row-actions">
        ${assetButton("eye", assets.preview, assetIdFor(result, "preview"), `preview-${index}`, `预览 ${actionSource}`)}
        ${assetButton("file-text", assets.reportHtml, assetIdFor(result, "reportHtml"), `report-${index}`, `报告 ${actionSource}`)}
      </div></td>
    </tr>`;
  });
  elements.queueBody.innerHTML = [...noticeRows, ...itemRows].join("");

  elements.queueBody.querySelectorAll("[data-input-key]").forEach((row) => {
    row.addEventListener("click", (event) => {
      if (isQueueButtonEventTarget(event.target)) return;
      selectQueueRow(row);
    });
  });

  elements.queueBody.querySelectorAll("[data-row-select]").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      const row = button.closest("[data-input-key]");
      const inputPath = itemInputKey(itemForQueueRow(row));
      if (inputPath) selectQueueRowByInputPath(inputPath, { restoreFocus: true, focusKind: "select" });
    });
  });

  elements.queueBody.querySelectorAll("[data-asset]").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      const row = button.closest("[data-input-key]");
      const item = itemForQueueRow(row);
      const inputPath = itemInputKey(item);
      const assetId = button.dataset.asset;
      const kind = button.dataset.kind;
      if (inputPath) selectQueueRowByInputPath(inputPath);
      if (kind === "preview") {
        if (state.previewPath !== assetId || state.previewFailedPath === assetId) setPreview(assetId, previewAltText(item));
      } else {
        openReportAsset(assetId);
      }
      if (inputPath) {
        focusQueueRowAction(inputPath, kind);
      } else {
        button.focus();
      }
    });
  });
  restoreQueueFocus(previousFocus);
}

function isQueueButtonEventTarget(target) {
  let node = target;
  while (node && node !== elements.queueBody) {
    if (node.dataset?.asset || node.dataset?.rowSelect) return true;
    node = node.parentElement;
  }
  return false;
}

function outputSummaryTextForItem(item) {
  if (item?.result) return outputSummaryText(item.result);
  const status = normalizeStatus(item?.status);
  if (status === "failed") return "未生成输出";
  if (status === "cancelled") return "已停止，未生成输出";
  if (isFinal(item?.status) || ["passed", "warning"].includes(status)) return "未生成输出";
  return "等待中";
}

function outputAriaSummaryForItem(item, outputText) {
  const assetLabels = orderedAssetLabels(item?.result?.assets);
  if (assetLabels.length > 0) return `已生成 ${assetLabels.join("、")}`;
  const plannedLabels = orderedAssetLabels(item?.result?.outputPlan);
  if (plannedLabels.length > 0) {
    const status = normalizeStatus(item?.status ?? item?.result?.status);
    return status === "planned"
      ? `计划生成 ${plannedLabels.join("、")}`
      : `输出路径：${plannedLabels.join("、")}`;
  }
  const text = String(outputText ?? "").trim();
  if (!text.includes(" / ")) return text;
  const count = text.split(" / ").filter(Boolean).length;
  const status = normalizeStatus(item?.status ?? item?.result?.status);
  return status === "planned" ? `计划生成 ${count} 个输出项` : `输出路径：${count} 个输出项`;
}

function outputSummaryText(result) {
  if (!result) return "等待中";

  const assetPaths = orderedAssetPaths(result.assets);
  if (assetPaths.length) return assetPaths.map(shortPath).join(" / ");

  if (Array.isArray(result.commands)) {
    const commandOutputs = result.commands
      .map((command) => command?.args?.at(-1))
      .filter(Boolean);
    return commandOutputs.length ? commandOutputs.map(shortPath).join(" / ") : "无需生成媒体输出";
  }

  const outputPlan = result.outputPlan;
  if (outputPlan) {
    const plannedOutputs = [
      outputPlan.oneByOne,
      outputPlan.threeByFour,
      outputPlan.preview,
      outputPlan.reportHtml,
      outputPlan.reportJson
    ].filter(Boolean);
    if (plannedOutputs.length) return plannedOutputs.map(shortPath).join(" / ");
  }
  return "等待中";
}

function orderedAssetPaths(assets = {}) {
  const paths = [
    assets.oneByOne,
    assets.threeByFour,
    assets.preview,
    assets.reportHtml,
    assets.reportJson
  ].filter(Boolean);
  return [...new Set(paths)];
}

function orderedAssetLabels(assets = {}) {
  const hasHtmlReport = Boolean(assets.reportHtml);
  const hasJsonReport = Boolean(assets.reportJson);
  const labels = [
    ["oneByOne", "1x1"],
    ["threeByFour", "3x4"],
    ["preview", "预览"],
    ["reportHtml", hasJsonReport ? "HTML 报告" : "报告"],
    ["reportJson", hasHtmlReport ? "JSON 报告" : "报告"]
  ];
  return labels
    .filter(([key]) => Boolean(assets[key]))
    .map(([, label]) => label);
}

function selectQueueRow(row) {
  const inputPath = itemInputKey(itemForQueueRow(row));
  if (!inputPath) return;
  const shouldRestoreFocus = document.activeElement === row || document.activeElement?.dataset?.rowSelect;
  selectQueueRowByInputPath(inputPath, {
    restoreFocus: shouldRestoreFocus,
    focusKind: document.activeElement?.dataset?.rowSelect ? "select" : null
  });
}

function selectQueueRowByInputPath(inputPath, { restoreFocus = false, focusKind = null } = {}) {
  state.selectedInputPath = inputPath;
  if (state.currentJob) renderJob(state.currentJob);
  if (restoreFocus) {
    if (focusKind === "select" && focusQueueRowSelect(inputPath)) return;
    focusQueueRow(inputPath);
  }
}

function focusQueueRow(inputPath) {
  if (focusQueueRowSelect(inputPath)) return true;
  const selectedRow = findQueueRow(inputPath);
  selectedRow?.focus();
  return Boolean(selectedRow);
}

function focusQueueRowSelect(inputPath) {
  const selectedRow = findQueueRow(inputPath);
  const selectButton = selectedRow?.querySelector("[data-row-select]");
  selectButton?.focus();
  return Boolean(selectButton);
}

function focusQueueRowAction(inputPath, kind) {
  const selectedRow = findQueueRow(inputPath);
  const actionButton = Array.from(selectedRow?.querySelectorAll("[data-asset]") ?? [])
    .find((button) => button.dataset.kind === kind && !button.disabled);
  actionButton?.focus();
  return Boolean(actionButton);
}

function findQueueRow(inputPath) {
  return Array.from(elements.queueBody.querySelectorAll("[data-input-key]"))
    .find((row) => itemInputKey(itemForQueueRow(row)) === inputPath);
}

function captureQueueFocus() {
  if (!isFocusInsideQueue()) return null;
  const activeElement = document.activeElement;
  const row = activeElement?.closest?.("[data-input-key]");
  const item = itemForQueueRow(row);
  const inputPath = itemInputKey(item) || state.selectedInputPath || currentInputKey(state.currentJob) || "";
  if (!inputPath) return null;
  return {
    inputPath,
    kind: activeElement?.dataset?.asset
      ? activeElement.dataset.kind
      : activeElement?.dataset?.rowSelect
        ? "select"
        : null
  };
}

function restoreQueueFocus(focusTarget) {
  if (!focusTarget?.inputPath) return;
  if (focusTarget.kind === "select" && focusQueueRowSelect(focusTarget.inputPath)) return;
  if (focusTarget.kind && focusQueueRowAction(focusTarget.inputPath, focusTarget.kind)) return;
  focusQueueRow(focusTarget.inputPath);
}

function restoreEmptyQueueFocus(focusTarget) {
  if (!focusTarget?.inputPath) return;
  if (!elements.clearHistoryButton.disabled) {
    elements.clearHistoryButton.focus();
    return;
  }
  elements.jobLog.focus();
}

function itemForQueueRow(row) {
  const index = Number(row?.dataset?.inputKey);
  if (!Number.isInteger(index) || index < 0) return null;
  return state.currentJob?.items?.[index] ?? null;
}

function itemInputKey(item) {
  return item?.inputId || item?.inputPath || "";
}

function currentInputKey(job) {
  return job?.currentId || job?.current || null;
}

function isFocusInsideQueue() {
  let node = document.activeElement;
  while (node) {
    if (node === elements.queueBody) return true;
    node = node.parentElement;
  }
  return false;
}

function rowSelectionLabel(source, { selected = false } = {}) {
  return `${selected ? "当前查看" : "查看"} ${source} 的预览与质检详情`;
}

function renderEmptyJobRow(job) {
  const status = normalizeStatus(job.status);
  const message = job.emptyMessage || (status === "queued" ? "已加入队列" : statusLabel(status));
  const detail = sanitizeDisplayMessage(job.error) || "等待任务生成处理明细。";
  return `<tr class="empty-row">
    <td><span class="status-chip ${escapeHtml(status)}">${escapeHtml(statusLabel(status))}</span></td>
    <td colspan="4" class="path-cell"><span class="path-name">${escapeHtml(message)}</span><span class="path-sub">${escapeHtml(detail)}</span></td>
  </tr>`;
}

function assetButton(icon, assetPath, assetId, id, label) {
  const disabled = assetPath && assetId ? "" : " disabled";
  const value = assetPath && assetId ? ` data-asset="${escapeHtml(assetId)}"` : "";
  const kind = icon === "eye" ? "preview" : "report";
  const escapedLabel = escapeHtml(label);
  return `<button id="${id}" class="icon-button" type="button" title="${escapedLabel}" aria-label="${escapedLabel}" data-kind="${kind}"${value}${disabled}>${svgIcon(icon)}</button>`;
}

function renderLogs(logs) {
  const shouldStickToBottom = shouldAutoScrollLog(elements.jobLog);
  const previousScrollTop = elements.jobLog.scrollTop;
  elements.jobLog.textContent = logs.map((entry) => {
    const time = new Date(entry.at).toLocaleTimeString();
    return `[${time}] ${logLevelLabel(entry.level)} ${sanitizeDisplayMessage(entry.message)}`;
  }).join("\n");
  elements.jobLog.scrollTop = shouldStickToBottom ? elements.jobLog.scrollHeight : previousScrollTop;
}

function shouldAutoScrollLog(logElement) {
  const scrollHeight = Number(logElement.scrollHeight);
  const clientHeight = Number(logElement.clientHeight);
  const scrollTop = Number(logElement.scrollTop);
  if (!Number.isFinite(scrollHeight) || !Number.isFinite(clientHeight) || clientHeight <= 0) return true;
  if (scrollHeight <= clientHeight) return true;
  return scrollHeight - clientHeight - scrollTop <= LOG_AUTOSCROLL_THRESHOLD_PX;
}

function renderLogRetentionNotice(job, retainedLogCount) {
  const totalLogs = Number(job.totalLogs);
  const logsOffset = Number(job.logsOffset);
  if (state.logClearedAt || !Number.isFinite(totalLogs) || totalLogs <= retainedLogCount || logsOffset <= 0) {
    hideLogRetentionNotice();
    return;
  }
  const message = `仅显示最近 ${retainedLogCount}/${totalLogs} 条日志。`;
  if (elements.logRetentionNotice.textContent !== message) {
    elements.logRetentionNotice.textContent = message;
  }
  if (elements.logRetentionNotice.hidden) {
    elements.logRetentionNotice.hidden = false;
  }
}

function hideLogRetentionNotice() {
  if (elements.logRetentionNotice.textContent) {
    elements.logRetentionNotice.textContent = "";
  }
  if (!elements.logRetentionNotice.hidden) {
    elements.logRetentionNotice.hidden = true;
  }
}

function filterVisibleLogs(logs) {
  if (!state.logClearedAt) return logs;
  const cutoff = Date.parse(state.logClearedAt);
  if (!Number.isFinite(cutoff)) return logs;
  return logs.filter((entry) => {
    const at = Date.parse(entry.at);
    return !Number.isFinite(at) || at > cutoff;
  });
}

function renderLogLine(message, level = "info") {
  const time = new Date().toLocaleTimeString();
  elements.jobLog.textContent += `${elements.jobLog.textContent ? "\n" : ""}[${time}] ${logLevelLabel(level)} ${sanitizeDisplayMessage(message)}`;
  elements.jobLog.scrollTop = elements.jobLog.scrollHeight;
}

function renderPreview(selectedResult, selectedItem = null) {
  const previewPath = selectedResult?.assets?.preview ?? "";
  const previewAssetId = assetIdFor(selectedResult, "preview");
  const canShow = Boolean(previewPath && previewAssetId);
  const previewLabel = previewAltText(selectedItem);
  if (canShow && previewAssetId === state.previewFailedPath) {
    renderFailedPreview(previewAssetId);
  } else if (canShow && previewAssetId !== state.previewPath) {
    setPreview(previewAssetId, previewLabel);
  } else if (!canShow) {
    resetPreview();
  } else {
    elements.previewImage.alt = previewLabel;
  }
}

function resetPreview({ keepFailedPath = false } = {}) {
  state.previewPath = "";
  if (!keepFailedPath) state.previewFailedPath = "";
  elements.previewImage.onload = null;
  elements.previewImage.onerror = null;
  elements.previewImage.alt = "";
  elements.previewImage.removeAttribute("src");
  elements.previewImage.classList.remove("visible");
  elements.previewEmpty.style.display = "grid";
  elements.previewEmpty.textContent = "2048 x 2732";
  renderRevealButtonStates();
}

function setPreview(previewPath, previewLabel) {
  state.previewPath = previewPath;
  state.previewFailedPath = "";
  elements.previewImage.classList.remove("visible");
  elements.previewEmpty.style.display = "grid";
  elements.previewEmpty.textContent = "2048 x 2732";
  renderRevealButtonStates();
  elements.previewImage.alt = previewLabel;
  elements.previewImage.onload = () => {
    if (state.previewPath !== previewPath) return;
    elements.previewImage.classList.add("visible");
    elements.previewEmpty.style.display = "none";
    renderRevealButtonStates();
  };
  elements.previewImage.onerror = () => {
    if (state.previewPath !== previewPath) return;
    handlePreviewLoadError(previewPath);
  };
  elements.previewImage.src = assetUrl(previewPath);
}

function handlePreviewLoadError(previewPath) {
  state.previewFailedPath = previewPath;
  renderFailedPreview(previewPath);
  const message = "预览文件无法加载。请在输出目录中复核文件，或重新运行预览。";
  renderLogLine(message, "error");
  showTransientError(message);
  showToast(message);
}

function renderFailedPreview(previewPath) {
  state.previewPath = previewPath;
  elements.previewImage.onload = null;
  elements.previewImage.onerror = null;
  elements.previewImage.alt = "";
  elements.previewImage.removeAttribute("src");
  elements.previewImage.classList.remove("visible");
  elements.previewEmpty.style.display = "grid";
  elements.previewEmpty.textContent = "预览加载失败";
  renderRevealButtonStates();
}

function previewAltText(item) {
  const label = item?.inputLabel || shortPath(item?.inputPath) || "当前文件";
  return `${label} 的 3x4 预览`;
}

function renderQc(selectedItem, job = null) {
  const selectedResult = selectedItem?.result ?? null;
  state.reportPath = assetIdFor(selectedResult, "reportHtml");
  renderRevealButtonStates();

  if (selectedItem?.error && !selectedResult) {
    const status = normalizeStatus(selectedItem.status);
    elements.qcSummary.innerHTML = `<span class="status-chip ${status}">${escapeHtml(statusLabel(status))}</span>`;
    elements.qcIssues.innerHTML = `<div class="issue-card error"><strong>${escapeHtml(selectedItem.inputLabel || shortPath(selectedItem.inputPath) || "任务失败")}</strong><p>${escapeHtml(sanitizeDisplayMessage(selectedItem.error))}</p></div>`;
    return;
  }

  if (!selectedItem && job?.error) {
    const status = normalizeStatus(job.status);
    elements.qcSummary.innerHTML = `<span class="status-chip ${status}">${escapeHtml(statusLabel(status))}</span>`;
    elements.qcIssues.innerHTML = `<div class="issue-card error"><strong>任务失败</strong><p>${escapeHtml(sanitizeDisplayMessage(job.error))}</p></div>`;
    return;
  }

  const summary = selectedResult?.issueSummary;
  if (!selectedResult || !summary) {
    const status = selectedResult?.status ? normalizeStatus(selectedResult.status) : "idle";
    elements.qcSummary.innerHTML = `<span class="status-chip ${status}">${escapeHtml(statusLabel(status))}</span>`;
    elements.qcIssues.innerHTML = "";
    return;
  }

  if (!selectedResult.report && ["planned", "previewed"].includes(selectedResult.status)) {
    const status = normalizeStatus(selectedResult.status);
    const message = selectedResult.status === "previewed"
      ? "只生成预览，未运行质检。"
      : "模拟运行只生成执行计划，未写入质检报告。";
    elements.qcSummary.innerHTML = `<span class="status-chip ${status}">${escapeHtml(statusLabel(status))}</span>`;
    elements.qcIssues.innerHTML = `<div class="issue-card"><strong>未运行质检</strong><p>${escapeHtml(message)}</p></div>`;
    return;
  }

  const status = normalizeStatus(selectedResult.status);
  elements.qcSummary.innerHTML = [
    `<span class="status-chip ${status}">${escapeHtml(statusLabel(status))}</span>`,
    `<span class="status-chip failed">${summary.errorCount} 错误</span>`,
    `<span class="status-chip warning">${summary.warningCount} 警告</span>`
  ].join("");

  if (!summary.issues.length) {
    const hasReportAction = Boolean(selectedResult?.assets?.reportHtml);
    const hasReportPath = Boolean(
      selectedResult?.outputPlan?.reportHtml
      || selectedResult?.outputPlan?.reportJson
      || selectedResult?.assets?.reportJson
    );
    const message = hasReportAction
      ? "质检报告已可用于复核。"
      : hasReportPath
        ? "质检报告文件请在输出目录中复核。"
        : "完整报告会在任务结束后可用。";
    elements.qcIssues.innerHTML = `<div class="issue-card"><strong>未发现问题</strong><p>${escapeHtml(message)}</p></div>`;
    return;
  }

  elements.qcIssues.innerHTML = summary.issues.map((issue) => {
    return `<article class="issue-card ${escapeHtml(issue.severity)}">
      <strong>${escapeHtml(issue.target)} · ${escapeHtml(severityLabel(issue.severity))}</strong>
      <p>${escapeHtml(sanitizeDisplayMessage(issue.message))}</p>
    </article>`;
  }).join("");
}

function selectReviewItem(job) {
  const items = job.items ?? [];
  const selected = items.find((item) => itemInputKey(item) === state.selectedInputPath);
  if (selected) return selected;

  const failed = items.find((item) => item.error || item.status === "failed" || item.result?.issueSummary?.errorCount > 0);
  const warning = items.find((item) => item.result && (item.status === "warning" || item.result.issueSummary?.warningCount > 0));
  const currentKey = currentInputKey(job);
  const current = items.find((item) => itemInputKey(item) === currentKey);
  const latest = [...items].reverse().find((item) => item.result || item.error);
  const item = failed ?? warning ?? current ?? latest ?? null;
  if (item) state.selectedInputPath = itemInputKey(item);
  return item;
}

function setBusy(isBusy) {
  renderActionControls({ jobBusy: isBusy });
}

function setSubmitting(isSubmitting) {
  renderActionControls({ jobBusy: isSubmitting || hasActiveRendererJob() });
}

function renderActionControls({ jobBusy = hasActiveRendererJob() } = {}) {
  const stopAvailable = state.jobSubmitPending || jobBusy;
  const cancelPending = Boolean(state.cancelPendingJobId);
  const clearHistoryConfirmationPending = Boolean(state.pendingClearHistoryConfirmation);
  const submitBlocked = state.restorePending || state.restoreFailed || stopAvailable || state.historyClearPending || cancelPending || clearHistoryConfirmationPending;
  const clearHistoryLabel = state.restoreFailed ? "重置本地任务恢复记录" : "清除历史任务记录，不删除输出文件";
  elements.startButton.disabled = submitBlocked;
  elements.dryRunButton.disabled = submitBlocked;
  elements.stopButton.disabled = !stopAvailable || cancelPending;
  elements.clearHistoryButton.disabled = state.restorePending || state.jobSubmitPending || state.historyClearPending || cancelPending || clearHistoryConfirmationPending;
  elements.clearHistoryButton.title = clearHistoryLabel;
  elements.clearHistoryButton.setAttribute("aria-label", clearHistoryLabel);
  restorePendingFocus();
}

function setFinalDetailPending(jobId) {
  if (!jobId) return;
  state.finalDetailPendingJobId = jobId;
  renderActionControls();
}

function clearFinalDetailPending(jobId) {
  if (state.finalDetailPendingJobId && state.finalDetailPendingJobId === jobId) {
    state.finalDetailPendingJobId = "";
    renderActionControls();
  }
}

function restoreFocusWhenAvailable(target) {
  if (!target?.focus) return;
  if (target.disabled) {
    queueFocusRestore(target);
    return;
  }
  if (pendingFocusTarget() === target) state.pendingFocusRestore = null;
  target.focus();
}

function queueFocusRestore(target) {
  state.pendingFocusRestore = {
    target,
    activeAtQueue: document.activeElement ?? null
  };
}

function pendingFocusTarget() {
  return state.pendingFocusRestore?.target ?? null;
}

function restorePendingFocus() {
  const pending = state.pendingFocusRestore;
  const target = pending?.target ?? null;
  if (!target || target.disabled) return;
  if (pending.activeAtQueue && document.activeElement && document.activeElement !== pending.activeAtQueue && document.activeElement !== target) {
    state.pendingFocusRestore = null;
    return;
  }
  state.pendingFocusRestore = null;
  target.focus();
}

function isAbortError(error) {
  return error?.name === "AbortError" || error?.code === "ABORT_ERR";
}

function renderPreflightState() {
  elements.jobBadge.className = "status-chip processing";
  elements.jobBadge.textContent = "检查中";
  state.lastProgressAnnouncementKey = "preflight";
  elements.jobStatusAnnouncer.textContent = "正在检查输入和输出路径。";
}

function isFinal(status) {
  return ["succeeded", "warning", "failed", "cancelled", "planned", "previewed"].includes(status);
}

function normalizeStatus(status) {
  if (status === "running") return "processing";
  if (status === "queued") return "queued";
  if (status === "succeeded") return "passed";
  return status || "idle";
}

function statusLabel(status) {
  const labels = {
    idle: "空闲",
    queued: "排队中",
    processing: "处理中",
    passed: "通过",
    succeeded: "通过",
    warning: "警告",
    failed: "失败",
    planned: "计划",
    previewed: "预览完成",
    cancelled: "已停止"
  };
  return labels[status] ?? status;
}

function stageLabel(stage) {
  if (!stage) return "";
  const specificLabels = {
    "probe:1x1": "分析视频 1x1",
    "probe:3x4": "分析视频 3x4",
    "render:1x1": "渲染 1x1",
    "render:3x4": "渲染 3x4",
    "qc:1x1": "质检 1x1",
    "qc:3x4": "质检 3x4"
  };
  const stageKey = `${stage.name}:${stage.target}`;
  if (specificLabels[stageKey]) return specificLabels[stageKey];

  const labels = {
    encoder: "检查编码器",
    probe: "分析视频",
    render: "渲染",
    preview: "生成预览",
    qc: "质检",
    report: "写入报告",
    cancel: "正在停止"
  };
  return labels[stage.name] ?? stage.name;
}

function announceJobProgress(job) {
  const key = jobProgressAnnouncementKey(job);
  if (key === state.lastProgressAnnouncementKey) return;
  state.lastProgressAnnouncementKey = key;
  elements.jobStatusAnnouncer.textContent = jobProgressAnnouncement(job);
}

function jobProgressAnnouncementKey(job) {
  const stage = job.currentStage ?? {};
  return [
    job.id,
    job.status,
    currentInputKey(job),
    stage.name,
    stage.target,
    job.completed,
    job.total,
    job.passed,
    job.warnings,
    job.failed,
    job.error
  ].map((part) => part ?? "").join("|");
}

function jobProgressAnnouncement(job) {
  const status = normalizeStatus(job.status);
  const completed = job.completed ?? 0;
  const total = job.total ?? 0;
  const parts = [`任务${statusLabel(status)}`];
  if (currentInputKey(job)) parts.push(`当前 ${job.currentLabel || shortPath(job.current)}`);
  const stage = stageLabel(job.currentStage);
  if (stage) parts.push(stage);
  parts.push(`进度 ${completed}/${total}`);
  if (isFinal(job.status)) {
    parts.push(`通过 ${job.passed ?? 0}，警告 ${job.warnings ?? 0}，失败 ${job.failed ?? 0}`);
  }
  if (job.error) parts.push(sanitizeDisplayMessage(job.error));
  return parts.join("，");
}

function severityLabel(severity) {
  return {
    error: "错误",
    warning: "警告"
  }[severity] ?? severity;
}

function logLevelLabel(level) {
  return {
    info: "信息",
    warn: "警告",
    error: "错误"
  }[level] ?? level;
}

async function revealPath(assetId) {
  if (!assetId || state.revealPendingAssetId) return;
  const previousFocus = document.activeElement;
  state.revealPendingAssetId = assetId;
  renderRevealButtonStates();
  try {
    await apiPost("/api/reveal", { id: assetId });
    clearTransientError();
  } catch (error) {
    showTransientError(error.message);
    renderLogLine(error.message, "error");
    showToast(error.message);
  } finally {
    if (state.revealPendingAssetId === assetId) {
      state.revealPendingAssetId = "";
      renderRevealButtonStates();
      restoreFocusWhenAvailable(previousFocus);
    }
  }
}

function renderRevealButtonStates() {
  const revealPending = Boolean(state.revealPendingAssetId);
  const reviewLabel = currentReviewLabel();
  setButtonAccessibleLabel(
    elements.revealPreviewButton,
    reviewLabel ? `显示 ${reviewLabel} 的预览文件` : "显示预览文件"
  );
  setButtonAccessibleLabel(
    elements.revealReportButton,
    reviewLabel ? `显示 ${reviewLabel} 的报告文件` : "显示报告文件"
  );
  elements.revealPreviewButton.disabled = revealPending || !canRevealCurrentPreview();
  elements.revealReportButton.disabled = revealPending || !state.reportPath;
}

function currentReviewLabel() {
  const item = (state.currentJob?.items ?? []).find((candidate) => itemInputKey(candidate) === state.selectedInputPath);
  return item?.inputLabel || shortPath(item?.inputPath) || "";
}

function setButtonAccessibleLabel(button, label) {
  button.setAttribute("aria-label", label);
  button.title = label;
}

function canRevealCurrentPreview() {
  return Boolean(
    state.previewPath &&
    (elements.previewImage.classList.contains("visible") || state.previewFailedPath === state.previewPath)
  );
}

function isImeCompositionEvent(event) {
  return Boolean(event.isComposing || event.keyCode === 229);
}

function cellAriaLabel(label, value) {
  const text = String(value ?? "").trim();
  return text ? `${label}：${text}` : label;
}

async function openReportAsset(assetId) {
  if (!assetId) return;
  const message = "报告无法在新窗口打开。请使用右侧“显示报告文件”按钮或输出目录复核。";
  try {
    if (window.fadNative?.openAsset) {
      const result = await window.fadNative.openAsset(assetId);
      if (result?.ok === false || result?.error) throw new Error(result?.error || message);
      clearTransientError();
      return;
    }
    const opened = window.open(assetUrl(assetId), "_blank", "noopener");
    if (!opened) throw new Error("Report window was blocked.");
    clearTransientError();
  } catch {
    renderLogLine(message, "error");
    showTransientError(message);
    showToast(message);
  }
}

async function apiGet(path) {
  let response;
  try {
    response = await fetchWithTimeout(path);
  } catch (error) {
    throw apiTransportError(error);
  }
  return parseResponse(response);
}

async function apiPost(path, body, { signal, timeoutMs } = {}) {
  let response;
  try {
    response = await fetchWithTimeout(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal,
      timeoutMs,
      body: JSON.stringify(body)
    });
  } catch (error) {
    throw apiTransportError(error);
  }
  return parseResponse(response);
}

async function apiDelete(path, body = {}) {
  let response;
  try {
    response = await fetchWithTimeout(path, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
  } catch (error) {
    throw apiTransportError(error);
  }
  return parseResponse(response);
}

async function fetchWithTimeout(path, options = {}) {
  const { timeoutMs = LOCAL_API_REQUEST_TIMEOUT_MS, signal: callerSignal, ...fetchOptions } = options;
  const timeoutController = new AbortController();
  let timedOut = false;
  let timeoutId = null;
  if (Number.isFinite(timeoutMs) && timeoutMs > 0) {
    timeoutId = setTimeout(() => {
      timedOut = true;
      timeoutController.abort(createApiTimeoutError());
    }, timeoutMs);
  }

  const onCallerAbort = () => timeoutController.abort(callerSignal.reason);
  if (callerSignal?.aborted) {
    timeoutController.abort(callerSignal.reason);
  } else {
    callerSignal?.addEventListener("abort", onCallerAbort, { once: true });
  }

  try {
    return await fetch(path, {
      ...fetchOptions,
      signal: timeoutController.signal
    });
  } catch (error) {
    if (timedOut && isAbortError(error)) throw createApiTimeoutError();
    throw error;
  } finally {
    clearTimeout(timeoutId);
    callerSignal?.removeEventListener("abort", onCallerAbort);
  }
}

function createApiTimeoutError() {
  const error = createAbortError(LOCAL_API_TIMEOUT_MESSAGE);
  error.apiTimeout = true;
  return error;
}

function apiTransportError(error) {
  if (error?.apiTimeout) return new Error(LOCAL_API_TIMEOUT_MESSAGE);
  if (isAbortError(error)) return error;
  console.error("本地桥接连接失败。技术诊断已隐藏。");
  return new Error("本地桥接连接失败。请确认应用仍在运行，或重启应用后重试。");
}

async function parseResponse(response) {
  const raw = await response.text();
  let payload;
  try {
    payload = JSON.parse(raw);
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      throw new Error("API response payload must be an object.");
    }
  } catch (error) {
    console.error("无法解析本地桥接响应。技术诊断已隐藏。");
    const message = "本地桥接返回了无法识别的响应。请重试或重启应用。";
    throw new Error(message);
  }
  handlePersistence(payload.persistence);
  if (!response.ok || payload.ok === false) {
    const apiError = new Error(sanitizeDisplayMessage(payload.error || `HTTP ${response.status}`));
    apiError.status = response.status;
    if (typeof payload.field === "string") apiError.field = payload.field;
    if (payload.overwriteConfirmation) apiError.overwriteConfirmation = payload.overwriteConfirmation;
    throw apiError;
  }
  return payload;
}

function sanitizeDisplayMessage(message) {
  const text = String(message ?? "").trim();
  if (!text) return "";
  if (!looksLikeRawDiagnostic(text)) return text;
  return "本地桥接返回了未脱敏的技术错误。请重试；如果持续出现，请重启应用并保留控制台日志。";
}

function looksLikeRawDiagnostic(text) {
  return /(?:^|\n)\s+at\s+\S+/.test(text)
    || /\b(?:Error|TypeError|SyntaxError|ReferenceError):/.test(text)
    || /(?:^|\s)(?:\/Users\/|\/Volumes\/|\/private\/var\/|\/var\/|\/tmp\/|\/home\/|[A-Za-z]:\\)/.test(text)
    || /\.(?:secrets?|env)\b/i.test(text)
    || /\b(?:token|secret|cookie|authorization)\b/i.test(text)
    || /\b(?:ChildProcess|spawn|ENOENT|EACCES|EPERM|stderr|stdout|node:)\b/.test(text);
}

function handlePersistence(persistence) {
  if (!persistence?.configured) return;
  if (persistence.ok === false) {
    state.persistenceError = `任务恢复记录无法写入：${sanitizeDisplayMessage(persistence.error) || "未知错误"}`;
    showPersistentError(state.persistenceError);
    return;
  }
  state.persistenceError = "";
}

function clearTransientError() {
  if (state.restoreFailed) {
    showPersistentError(state.restoreFailureMessage || RESTORE_FAILED_START_MESSAGE);
    return;
  }
  if (state.persistenceError) {
    showPersistentError(state.persistenceError);
    return;
  }
  clearPersistentError();
}

function showTransientError(message) {
  if (state.restoreFailed) {
    const restoreMessage = state.restoreFailureMessage || RESTORE_FAILED_START_MESSAGE;
    if (!message || restoreMessage.includes(message) || String(message).includes(restoreMessage)) {
      showPersistentError(restoreMessage);
      return;
    }
    showPersistentError(`${restoreMessage}\n${message}`);
    return;
  }
  if (state.persistenceError) {
    if (!message || state.persistenceError.includes(message) || String(message).includes(state.persistenceError)) {
      showPersistentError(state.persistenceError);
      return;
    }
    showPersistentError(`${state.persistenceError}\n${message}`);
    return;
  }
  showPersistentError(message);
}

function assetUrl(assetId) {
  return `/api/asset?id=${encodeURIComponent(assetId)}`;
}

function assetIdFor(result, key) {
  const id = result?.assetIds?.[key];
  return typeof id === "string" ? id : "";
}

function shortPath(value) {
  if (!value) return "";
  const normalized = String(value).replaceAll("\\", "/");
  const parts = normalized.split("/");
  return parts.slice(-2).join("/");
}

function svgIcon(name) {
  return `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true">${ICONS[name] ?? ""}</svg>`;
}

function showToast(message) {
  elements.toast.textContent = message;
  elements.toast.classList.add("visible");
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => {
    elements.toast.classList.remove("visible");
  }, 3600);
}

function showStatusToast(message) {
  showToast(message);
  elements.jobStatusAnnouncer.textContent = message;
}

function showPersistentError(message) {
  elements.errorPanel.textContent = message;
  elements.errorPanel.hidden = false;
}

function clearValidationErrorIfCurrent(message, corrected, field = null) {
  if (!corrected) return;
  clearFieldValidationError(field);
  if (elements.errorPanel.hidden) return;
  if (elements.errorPanel.textContent !== message) return;
  if (state.restoreFailed) {
    showPersistentError(state.restoreFailureMessage || RESTORE_FAILED_START_MESSAGE);
    return;
  }
  if (state.persistenceError) {
    showPersistentError(state.persistenceError);
    return;
  }
  clearPersistentError();
}

function markApiFieldValidationError(fieldName, message) {
  const field = apiValidationField(fieldName);
  if (!field) return;
  if (state.apiFieldValidationError) {
    clearApiFieldValidationError(state.apiFieldValidationError.fieldName, { preservePanel: true });
  }
  state.apiFieldValidationError = {
    fieldName,
    message: message || defaultApiFieldValidationMessage(fieldName)
  };
  markFieldInvalid(field);
  field.focus();
}

function clearApiFieldValidationError(fieldName, { preservePanel = false } = {}) {
  if (state.apiFieldValidationError?.fieldName !== fieldName) return;
  const field = apiValidationField(fieldName);
  clearFieldValidationError(field);
  if (!preservePanel) {
    clearValidationErrorIfCurrent(state.apiFieldValidationError.message, true, field);
  }
  state.apiFieldValidationError = null;
}

function apiValidationField(fieldName) {
  if (fieldName === "ffmpegPath") return elements.ffmpegPath;
  if (fieldName === "ffprobePath") return elements.ffprobePath;
  return null;
}

function defaultApiFieldValidationMessage(fieldName) {
  if (fieldName === "ffmpegPath") return INVALID_FFMPEG_PATH_MESSAGE;
  if (fieldName === "ffprobePath") return INVALID_FFPROBE_PATH_MESSAGE;
  return "";
}

function markFieldInvalid(field) {
  field?.setAttribute("aria-invalid", "true");
  field?.setAttribute("aria-describedby", "errorPanel");
}

function clearFieldValidationError(field) {
  field?.removeAttribute("aria-invalid");
  field?.removeAttribute("aria-describedby");
}

function clearPersistentError() {
  elements.errorPanel.textContent = "";
  elements.errorPanel.hidden = true;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;");
}
