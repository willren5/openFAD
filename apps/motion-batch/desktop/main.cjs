const path = require("node:path");
const { app, BrowserWindow, dialog, ipcMain, shell } = require("electron");
const {
  buildPathPickerDialogOptions,
  normalizePathPickerError,
  normalizePathPickerResult
} = require("./pathPicker.cjs");
const {
  closeHttpServer
} = require("./bridgeLifecycle.cjs");
const {
  buildBridgeCloseErrorDialog,
  buildStartupErrorDialog
} = require("./errorDialogs.cjs");
const {
  configureBundledFfmpeg
} = require("./videoTools.cjs");
const {
  applyUserDataDirOverride
} = require("./appPaths.cjs");
const {
  buildTrustedLocalAssetUrl,
  isSafeExternalUrl,
  isTrustedRendererUrl
} = require("./security.cjs");

let server;
let serverPort;
let serverStartPromise;
let mainWindow;
let uiState;
let flushUiState;
let shutdownUiState;
let quitAfterServerClose = false;

async function ensureServer() {
  if (server && serverPort) return serverPort;
  if (serverStartPromise) return serverStartPromise;
  serverStartPromise = startServer();
  try {
    return await serverStartPromise;
  } finally {
    serverStartPromise = null;
  }
}

async function startServer() {
  const ui = await import("../ui/server.mjs");
  const { createUiServer, createUiState, defaultJobStorePath } = ui;
  const toolRoot = app.getAppPath();
  const defaultOutDir = path.join(app.getPath("documents"), "openFAD Motion Output");
  const jobStorePath = defaultJobStorePath({ appDataDir: app.getPath("userData") });

  configureBundledFfmpeg({ toolRoot });

  const nextState = createUiState({ jobStorePath });
  const nextServer = createUiServer({
    toolRoot,
    defaultOutDir,
    state: nextState
  });

  try {
    await new Promise((resolve, reject) => {
      nextServer.once("error", reject);
      nextServer.listen(0, "127.0.0.1", resolve);
    });
  } catch (error) {
    await closeHttpServer(nextServer).catch(() => {});
    throw error;
  }

  server = nextServer;
  serverPort = nextServer.address().port;
  uiState = nextState;
  flushUiState = ui.flushUiState;
  shutdownUiState = ui.shutdownUiState;
  return serverPort;
}

async function createWindow() {
  const port = await ensureServer();
  const trustedOrigin = localUiOrigin(port);
  if (mainWindow && !mainWindow.isDestroyed()) {
    focusMainWindow();
    return;
  }

  mainWindow = new BrowserWindow({
    width: 1360,
    height: 900,
    minWidth: 980,
    minHeight: 720,
    title: "openFAD 动态封面批处理",
    backgroundColor: "#111313",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true
    }
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (isSafeExternalUrl(url, { trustedOrigin })) {
      shell.openExternal(url).catch(reportExternalOpenError);
    }
    return { action: "deny" };
  });
  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (isTrustedRendererUrl(url, { trustedOrigin })) return;
    event.preventDefault();
  });
  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  try {
    await mainWindow.loadURL(trustedOrigin);
  } catch (error) {
    mainWindow.destroy();
    mainWindow = null;
    throw error;
  }
}

function focusMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.focus();
}

async function showMainWindow() {
  if (BrowserWindow.getAllWindows().length === 0) {
    await createWindow();
    return;
  }
  focusMainWindow();
}

ipcMain.handle("paths:pick", async (event, request = {}) => {
  try {
    const senderUrl = senderUrlFromEvent(event);
    if (!isTrustedRendererUrl(senderUrl, { trustedOrigin: localUiOrigin(serverPort) })) {
      return normalizePathPickerError(new Error("Untrusted renderer origin."));
    }
    const options = buildPathPickerDialogOptions(String(request.kind ?? ""));
    const owner = BrowserWindow.fromWebContents(event.sender);
    const result = owner
      ? await dialog.showOpenDialog(owner, options)
      : await dialog.showOpenDialog(options);
    return normalizePathPickerResult(result);
  } catch (error) {
    return normalizePathPickerError(error);
  }
});

ipcMain.handle("assets:open", async (event, request = {}) => {
  try {
    const trustedOrigin = localUiOrigin(serverPort);
    const senderUrl = senderUrlFromEvent(event);
    if (!isTrustedRendererUrl(senderUrl, { trustedOrigin })) {
      return normalizeOpenAssetError(new Error("Untrusted renderer origin."));
    }
    const assetUrl = buildTrustedLocalAssetUrl(request?.id, { trustedOrigin });
    if (!assetUrl) return normalizeOpenAssetError(new Error("Invalid asset id."));
    await shell.openExternal(assetUrl);
    return { ok: true };
  } catch (error) {
    reportExternalOpenError(error);
    return normalizeOpenAssetError(error);
  }
});

function senderUrlFromEvent(event) {
  return event.senderFrame?.url ?? event.sender?.getURL?.() ?? "";
}

function normalizeOpenAssetError(_error) {
  return {
    ok: false,
    error: "无法打开报告文件。请使用右侧“显示报告文件”按钮或输出目录复核。"
  };
}

function localUiOrigin(port) {
  return `http://127.0.0.1:${port}`;
}

async function closeServer() {
  if (shutdownUiState && uiState) {
    await shutdownUiState(uiState);
  } else if (flushUiState && uiState) {
    await flushUiState(uiState);
  }
  if (!server) return;
  await closeHttpServer(server);
  server = null;
  serverPort = null;
  serverStartPromise = null;
  uiState = null;
  flushUiState = null;
  shutdownUiState = null;
}

function reportExternalOpenError(_error) {
  logDesktopDiagnostic("无法打开外部链接", _error);
}

function reportBridgeCloseError(error) {
  logDesktopDiagnostic("关闭本地桥接失败", error);
  const dialogCopy = buildBridgeCloseErrorDialog(error);
  dialog.showErrorBox(dialogCopy.title, dialogCopy.message);
}

function reportStartupError(error) {
  logDesktopDiagnostic("启动失败", error);
  const dialogCopy = buildStartupErrorDialog(error);
  dialog.showErrorBox(dialogCopy.title, dialogCopy.message);
}

function logDesktopDiagnostic(label, _error) {
  console.error(`${label}：技术诊断已隐藏。`);
}

async function quitAfterClosingBridge() {
  try {
    await closeServer();
    app.quit();
  } catch (error) {
    quitAfterServerClose = false;
    reportBridgeCloseError(error);
    showMainWindow().catch(reportStartupError);
  }
}

applyUserDataDirOverride({ app });
const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    showMainWindow().catch(reportStartupError);
  });

  app.whenReady().then(showMainWindow).catch((error) => {
    reportStartupError(error);
    app.quit();
  });

  app.on("window-all-closed", () => {
    mainWindow = null;
    if (process.platform === "darwin") return;
    quitAfterServerClose = true;
    quitAfterClosingBridge();
  });

  app.on("before-quit", (event) => {
    if (!server || quitAfterServerClose) return;
    event.preventDefault();
    quitAfterServerClose = true;
    quitAfterClosingBridge();
  });

  app.on("activate", () => {
    showMainWindow().catch(reportStartupError);
  });
}
