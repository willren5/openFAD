import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import assert from "node:assert/strict";

import { createUiServer, createUiState, shutdownUiState } from "../ui/server.mjs";

const require = createRequire(import.meta.url);
const {
  closeHttpServer
} = require("../desktop/bridgeLifecycle.cjs");
const {
  buildPathPickerDialogOptions,
  normalizePathPickerError,
  normalizePathPickerResult
} = require("../desktop/pathPicker.cjs");
const {
  buildTrustedLocalAssetUrl,
  isSafeExternalUrl,
  isTrustedRendererUrl
} = require("../desktop/security.cjs");
const {
  configureBundledFfmpeg
} = require("../desktop/videoTools.cjs");
const {
  applyUserDataDirOverride,
  normalizeUserDataDir,
  USER_DATA_DIR_ENV
} = require("../desktop/appPaths.cjs");

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");
const privateUserRoot = `/${"Users"}/will`;

test("builds separate native picker options for input file, input folder, and output folder", () => {
  assert.deepEqual(buildPathPickerDialogOptions("inputFile"), {
    title: "选择输入视频",
    properties: ["openFile"],
    filters: [{ name: "Video files", extensions: ["mov", "mp4", "m4v"] }]
  });
  assert.deepEqual(buildPathPickerDialogOptions("inputFolder"), {
    title: "选择输入文件夹",
    properties: ["openDirectory"]
  });
  assert.deepEqual(buildPathPickerDialogOptions("outputFolder"), {
    title: "选择输出文件夹",
    properties: ["openDirectory", "createDirectory"]
  });
});

test("rejects unknown native picker kinds", () => {
  assert.throws(() => buildPathPickerDialogOptions("anything"), /Unknown path picker kind/);
});

test("normalizes native picker results for renderer consumption", () => {
  assert.deepEqual(normalizePathPickerResult({ canceled: true, filePaths: [] }), {
    canceled: true,
    path: ""
  });
  assert.deepEqual(normalizePathPickerResult({ canceled: false, filePaths: ["/tmp/cover.mov"] }), {
    canceled: false,
    path: "/tmp/cover.mov"
  });
});

test("normalizes native picker errors without exposing raw IPC failures", () => {
  assert.deepEqual(normalizePathPickerError(new Error(`bad picker ${privateUserRoot}/private-fixture`)), {
    canceled: true,
    path: "",
    error: "无法打开系统路径选择器。请手动复制路径后重试。"
  });
});

test("desktop fatal dialog builders return safe actionable copy for raw diagnostics", () => {
  const {
    buildBridgeCloseErrorDialog,
    buildStartupErrorDialog
  } = require("../desktop/errorDialogs.cjs");
  const envFile = `.${"env"}`;
  const rawError = new Error(`token ${privateUserRoot}/${envFile}`);
  rawError.stack = `Error: token ${privateUserRoot}/${envFile}\n    at boot (${privateUserRoot}/app/main.cjs:1:1)`;

  const bridgeDialog = buildBridgeCloseErrorDialog(rawError);
  const startupDialog = buildStartupErrorDialog(rawError);
  const userText = [
    bridgeDialog.title,
    bridgeDialog.message,
    startupDialog.title,
    startupDialog.message
  ].join("\n");

  assert.deepEqual(bridgeDialog, {
    title: "任务恢复记录保存失败",
    message: "当前任务已停止，但任务恢复记录可能没有完全保存。请重新打开应用确认任务状态；如果仍失败，请把控制台诊断发给 openFAD 社区 issue。"
  });
  assert.deepEqual(startupDialog, {
    title: "启动失败",
    message: "openFAD Motion Batch 启动失败。请确认应用完整安装，并重新打开应用；如果仍失败，请把控制台诊断发给 openFAD 社区 issue。"
  });
  assert.doesNotMatch(userText, new RegExp(`token|${privateUserRoot}|\\.${"env"}|main\\.cjs|at boot|Error:`));
});

test("desktop fatal console diagnostics do not serialize raw startup or bridge-close errors", async () => {
  const main = await readFile(path.join(projectRoot, "desktop", "main.cjs"), "utf8");

  assert.match(main, /function logDesktopDiagnostic\(label,\s*_error\)/);
  assert.match(main, /console\.error\(`\$\{label\}：技术诊断已隐藏。`\)/);
  assert.doesNotMatch(main, /error\?\.(stack|message)\s*\|\|/);
  assert.doesNotMatch(main, /String\(error\)/);
  assert.doesNotMatch(main, /console\.error\(`关闭本地桥接失败：\$\{message\}`\)/);
  assert.doesNotMatch(main, /console\.error\(`启动失败：\$\{message\}`\)/);
});

test("desktop bundled video tools override stale inherited environment paths", () => {
  const env = {
    FFMPEG_PATH: "C:\\missing\\ffmpeg.exe",
    FFPROBE_PATH: "C:\\missing\\ffprobe.exe",
    PATH: "C:\\Windows\\System32"
  };
  const resourcesPath = "C:\\openFAD Motion Batch\\resources";
  const binDir = path.join(resourcesPath, "bin");
  const bundledFfmpeg = path.join(binDir, "ffmpeg.exe");
  const bundledFfprobe = path.join(binDir, "ffprobe.exe");
  const existing = new Set([bundledFfmpeg, bundledFfprobe]);

  const resolved = configureBundledFfmpeg({
    toolRoot: "C:\\openFAD Motion Batch\\app",
    resourcesPath,
    execPath: "C:\\openFAD Motion Batch\\openFAD Motion Batch.exe",
    platform: "win32",
    arch: "x64",
    env,
    existsSync: (candidate) => existing.has(candidate)
  });

  assert.deepEqual(resolved, {
    binDir,
    ffmpegPath: bundledFfmpeg,
    ffprobePath: bundledFfprobe
  });
  assert.equal(env.FFMPEG_PATH, bundledFfmpeg);
  assert.equal(env.FFPROBE_PATH, bundledFfprobe);
  assert.equal(env.PATH.startsWith(`${binDir}${path.delimiter}`), true);
});

test("desktop smoke user data override is explicit and isolated", () => {
  const setPathCalls = [];
  const app = {
    setPath(name, value) {
      setPathCalls.push([name, value]);
    }
  };
  const userDataDir = path.join(projectRoot, "tmp", "desktop-smoke-user-data");

  assert.equal(applyUserDataDirOverride({ app, env: {} }), null);
  assert.deepEqual(setPathCalls, []);
  assert.equal(normalizeUserDataDir(""), null);

  const resolved = applyUserDataDirOverride({
    app,
    env: { [USER_DATA_DIR_ENV]: userDataDir }
  });

  assert.equal(resolved, userDataDir);
  assert.deepEqual(setPathCalls, [["userData", userDataDir]]);
});

test("desktop entrypoint wires a preload bridge instead of enabling Node in the renderer", async () => {
  const main = await readFile(path.join(projectRoot, "desktop", "main.cjs"), "utf8");
  const preload = await readFile(path.join(projectRoot, "desktop", "preload.cjs"), "utf8");

  assert.match(main, /createUiState/);
  assert.match(main, /defaultJobStorePath/);
  assert.match(main, /app\.getPath\("userData"\)/);
  assert.match(main, /jobStorePath/);
  assert.match(main, /preload:\s*path\.join\(__dirname,\s*"preload\.cjs"\)/);
  assert.match(main, /nodeIntegration:\s*false/);
  assert.match(main, /contextIsolation:\s*true/);
  assert.match(main, /sandbox:\s*true/);
  assert.match(preload, /contextBridge\.exposeInMainWorld\("fadNative"/);
  assert.match(preload, /ipcRenderer\.invoke\("paths:pick"/);
  assert.match(preload, /ipcRenderer\.invoke\("assets:open"/);
  assert.match(preload, /webUtils/);
  assert.match(preload, /getPathForFile\(file\)/);
  assert.doesNotMatch(preload, /ipcRenderer\s*:/);
  assert.doesNotMatch(preload, /invoke\s*:\s*ipcRenderer/);
  assert.doesNotMatch(preload, /send\s*:/);
});

test("desktop entrypoint enforces a single local bridge instance", async () => {
  const main = await readFile(path.join(projectRoot, "desktop", "main.cjs"), "utf8");

  assert.match(main, /app\.requestSingleInstanceLock\(\)/);
  assert.match(main, /if \(!gotSingleInstanceLock\)/);
  assert.match(main, /app\.quit\(\)/);
  assert.match(main, /app\.on\("second-instance"/);
  assert.match(main, /mainWindow\.restore\(\)/);
  assert.match(main, /mainWindow\.focus\(\)/);
  assert.match(main, /flushUiState\(uiState\)/);
});

test("desktop applies smoke user data override before taking the single-instance lock", async () => {
  const main = await readFile(path.join(projectRoot, "desktop", "main.cjs"), "utf8");
  const overrideIndex = main.indexOf("applyUserDataDirOverride({ app })");
  const lockIndex = main.indexOf("app.requestSingleInstanceLock()");

  assert.ok(overrideIndex > 0);
  assert.ok(lockIndex > overrideIndex);
});

test("desktop second launch recreates the window after all macOS windows were closed", async () => {
  const main = await readFile(path.join(projectRoot, "desktop", "main.cjs"), "utf8");

  const helperIndex = main.indexOf("async function showMainWindow()");
  const allWindowsIndex = main.indexOf("BrowserWindow.getAllWindows().length === 0", helperIndex);
  const createIndex = main.indexOf("await createWindow();", helperIndex);
  const focusIndex = main.indexOf("focusMainWindow();", helperIndex);
  const secondInstanceIndex = main.indexOf("app.on(\"second-instance\"");
  const secondShowIndex = main.indexOf("showMainWindow().catch(reportStartupError);", secondInstanceIndex);
  const activateIndex = main.indexOf("app.on(\"activate\"");
  const activateShowIndex = main.indexOf("showMainWindow().catch(reportStartupError);", activateIndex);

  assert.notEqual(helperIndex, -1);
  assert.notEqual(allWindowsIndex, -1);
  assert.notEqual(createIndex, -1);
  assert.notEqual(focusIndex, -1);
  assert.notEqual(secondInstanceIndex, -1);
  assert.notEqual(secondShowIndex, -1);
  assert.notEqual(activateIndex, -1);
  assert.notEqual(activateShowIndex, -1);
  assert.ok(allWindowsIndex < createIndex);
  assert.ok(createIndex < focusIndex);
});

test("desktop entrypoint reuses the local bridge when the window is reopened", async () => {
  const main = await readFile(path.join(projectRoot, "desktop", "main.cjs"), "utf8");

  assert.match(main, /async function ensureServer\(\)/);
  assert.match(main, /if \(server && serverPort\) return serverPort/);
  assert.match(main, /const port = await ensureServer\(\)/);
  assert.match(main, /mainWindow\.on\("closed", \(\) => \{/);
  assert.match(main, /if \(process\.platform === "darwin"\) return/);
  assert.match(main, /app\.on\("before-quit"/);
  assert.match(main, /event\.preventDefault\(\)/);
  assert.match(main, /closeServer\(\)/);
});

test("desktop entrypoint clears a stale window when initial UI load fails", async () => {
  const main = await readFile(path.join(projectRoot, "desktop", "main.cjs"), "utf8");

  const createIndex = main.indexOf("async function createWindow()");
  const loadIndex = main.indexOf("await mainWindow.loadURL(trustedOrigin);", createIndex);
  const catchIndex = main.indexOf("} catch (error) {", loadIndex);
  const destroyIndex = main.indexOf("mainWindow.destroy();", catchIndex);
  const clearIndex = main.indexOf("mainWindow = null;", destroyIndex);
  const throwIndex = main.indexOf("throw error;", clearIndex);

  assert.notEqual(createIndex, -1);
  assert.notEqual(loadIndex, -1);
  assert.notEqual(catchIndex, -1);
  assert.notEqual(destroyIndex, -1);
  assert.notEqual(clearIndex, -1);
  assert.notEqual(throwIndex, -1);
  assert.ok(loadIndex < catchIndex);
  assert.ok(catchIndex < destroyIndex);
  assert.ok(destroyIndex < clearIndex);
  assert.ok(clearIndex < throwIndex);
});

test("desktop entrypoint serializes concurrent local bridge startup", async () => {
  const main = await readFile(path.join(projectRoot, "desktop", "main.cjs"), "utf8");

  const stateIndex = main.indexOf("let serverStartPromise;");
  const ensureIndex = main.indexOf("async function ensureServer()");
  const reuseIndex = main.indexOf("if (serverStartPromise) return serverStartPromise;", ensureIndex);
  const assignIndex = main.indexOf("serverStartPromise = startServer();", ensureIndex);
  const finallyIndex = main.indexOf("serverStartPromise = null;", assignIndex);
  const startIndex = main.indexOf("async function startServer()");
  const listenIndex = main.indexOf("await new Promise", startIndex);
  const globalServerIndex = main.indexOf("server = nextServer;", startIndex);
  const cleanupIndex = main.indexOf("await closeHttpServer(nextServer)", startIndex);

  assert.notEqual(stateIndex, -1);
  assert.notEqual(ensureIndex, -1);
  assert.notEqual(reuseIndex, -1);
  assert.notEqual(assignIndex, -1);
  assert.notEqual(finallyIndex, -1);
  assert.notEqual(startIndex, -1);
  assert.notEqual(listenIndex, -1);
  assert.notEqual(globalServerIndex, -1);
  assert.notEqual(cleanupIndex, -1);
  assert.ok(reuseIndex < assignIndex);
  assert.ok(assignIndex < finallyIndex);
  assert.ok(listenIndex < globalServerIndex);
});

test("desktop bridge close error dialog does not expose raw stack traces", async () => {
  const main = await readFile(path.join(projectRoot, "desktop", "main.cjs"), "utf8");
  const dialogs = await readFile(path.join(projectRoot, "desktop", "errorDialogs.cjs"), "utf8");

  const helperIndex = main.indexOf("function reportBridgeCloseError(error)");
  const consoleIndex = main.indexOf("logDesktopDiagnostic(\"关闭本地桥接失败\", error);", helperIndex);
  const builderIndex = main.indexOf("buildBridgeCloseErrorDialog(error);", helperIndex);
  const dialogIndex = main.indexOf("dialog.showErrorBox(dialogCopy.title, dialogCopy.message);", builderIndex);
  const actionCopyIndex = dialogs.indexOf("当前任务已停止，但任务恢复记录可能没有完全保存。请重新打开应用确认任务状态；如果仍失败，请把控制台诊断发给 openFAD 社区 issue。");
  const rawDialogIndex = main.indexOf("dialog.showErrorBox(\"任务恢复记录保存失败\", message);", helperIndex);

  assert.notEqual(helperIndex, -1);
  assert.notEqual(consoleIndex, -1);
  assert.notEqual(builderIndex, -1);
  assert.notEqual(dialogIndex, -1);
  assert.notEqual(actionCopyIndex, -1);
  assert.equal(rawDialogIndex, -1);
  assert.match(main, /reportBridgeCloseError\(error\)/);
  assert.ok(consoleIndex < builderIndex);
  assert.ok(builderIndex < dialogIndex);
});

test("desktop entrypoint shuts down active UI jobs before closing the bridge", async () => {
  const main = await readFile(path.join(projectRoot, "desktop", "main.cjs"), "utf8");

  assert.match(main, /let shutdownUiState/);
  assert.match(main, /shutdownUiState = ui\.shutdownUiState/);
  assert.match(main, /await shutdownUiState\(uiState\)/);
  assert.match(main, /require\("\.\/bridgeLifecycle\.cjs"\)/);
  assert.match(main, /await closeHttpServer\(server\)/);
  assert.doesNotMatch(main, /server\.close\(\(\) => resolve\(\)\)/);
});

test("desktop bridge close destroys held HTTP connections instead of waiting forever", async () => {
  const server = http.createServer((_, response) => {
    response.writeHead(200, { "Content-Type": "text/plain" });
    response.write("still open");
  });
  await listenRaw(server);
  const request = http.get({
    host: "127.0.0.1",
    port: server.address().port,
    path: "/held"
  });
  request.on("error", () => {});
  const response = await new Promise((resolve) => request.once("response", resolve));
  response.resume();

  const started = Date.now();
  await closeHttpServer(server, { timeoutMs: 25 });

  assert.equal(server.listening, false);
  assert.ok(Date.now() - started < 1000);
});

test("desktop bridge close breaks held UI requests after shutdown state is flushed", { timeout: 1000 }, async () => {
  const state = createUiState();
  const server = createUiServer({ state });
  const originalConsoleError = console.error;
  let request;
  const errors = [];
  let loggedUnexpectedError;
  const unexpectedErrorLogged = new Promise((resolve) => {
    loggedUnexpectedError = resolve;
  });
  console.error = (...args) => {
    const message = args.join(" ");
    errors.push(message);
    if (message.includes("UI request failed")) {
      loggedUnexpectedError(message);
    }
  };
  try {
    await listenRaw(server);

    const requestSeen = new Promise((resolve) => server.once("request", resolve));
    request = http.request({
      host: "127.0.0.1",
      port: server.address().port,
      method: "POST",
      path: "/api/reveal",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": "100"
      }
    });
    const clientClosed = new Promise((resolve) => {
      request.once("error", resolve);
      request.once("close", () => resolve(null));
    });

    request.write("{");
    request.flushHeaders();
    await requestSeen;
    await shutdownUiState(state, { timeoutMs: 100 });

    const started = Date.now();
    await closeHttpServer(server, { timeoutMs: 25 });
    const clientResult = await clientClosed;

    assert.equal(server.listening, false);
    assert.ok(Date.now() - started < 500);
    if (clientResult) assert.equal(clientResult.code, "ECONNRESET");
    const logged = await Promise.race([
      unexpectedErrorLogged.then(() => true),
      delay(50).then(() => false)
    ]);
    assert.equal(logged, false, errors.join("\n"));
  } finally {
    console.error = originalConsoleError;
    request?.destroy();
    if (server.listening) await closeHttpServer(server, { timeoutMs: 25 }).catch(() => {});
  }
});

test("desktop entrypoint does not quit after bridge shutdown fails", async () => {
  const main = await readFile(path.join(projectRoot, "desktop", "main.cjs"), "utf8");

  const helperIndex = main.indexOf("async function quitAfterClosingBridge()");
  const closeIndex = main.indexOf("await closeServer();", helperIndex);
  const quitIndex = main.indexOf("app.quit();", closeIndex);
  const catchIndex = main.indexOf("} catch (error) {", closeIndex);
  const resetIndex = main.indexOf("quitAfterServerClose = false;", catchIndex);
  const reportIndex = main.indexOf("reportBridgeCloseError(error);", catchIndex);
  const showIndex = main.indexOf("showMainWindow().catch(reportStartupError);", catchIndex);
  const finallyQuitIndex = main.indexOf("finally(() => {\n      app.quit();", helperIndex);

  assert.notEqual(helperIndex, -1);
  assert.notEqual(closeIndex, -1);
  assert.notEqual(quitIndex, -1);
  assert.notEqual(catchIndex, -1);
  assert.notEqual(resetIndex, -1);
  assert.notEqual(reportIndex, -1);
  assert.notEqual(showIndex, -1);
  assert.equal(finallyQuitIndex, -1);
  assert.ok(closeIndex < quitIndex);
  assert.ok(quitIndex < catchIndex);
});

test("desktop startup error dialog does not expose raw stack traces", async () => {
  const main = await readFile(path.join(projectRoot, "desktop", "main.cjs"), "utf8");
  const dialogs = await readFile(path.join(projectRoot, "desktop", "errorDialogs.cjs"), "utf8");

  const helperIndex = main.indexOf("function reportStartupError(error)");
  const consoleIndex = main.indexOf("logDesktopDiagnostic(\"启动失败\", error);", helperIndex);
  const builderIndex = main.indexOf("buildStartupErrorDialog(error);", helperIndex);
  const dialogIndex = main.indexOf("dialog.showErrorBox(dialogCopy.title, dialogCopy.message);", builderIndex);
  const actionCopyIndex = dialogs.indexOf("openFAD Motion Batch 启动失败。请确认应用完整安装，并重新打开应用；如果仍失败，请把控制台诊断发给 openFAD 社区 issue。");
  const stackDialogIndex = main.indexOf("dialog.showErrorBox(\"启动失败\", error.stack || error.message);", helperIndex);

  assert.notEqual(helperIndex, -1);
  assert.notEqual(consoleIndex, -1);
  assert.notEqual(builderIndex, -1);
  assert.notEqual(dialogIndex, -1);
  assert.notEqual(actionCopyIndex, -1);
  assert.equal(stackDialogIndex, -1);
  assert.ok(consoleIndex < builderIndex);
  assert.ok(builderIndex < dialogIndex);
});

test("desktop URL guard denies unsafe external schemes while allowing trusted report URLs", () => {
  const trustedOrigin = "http://127.0.0.1:4387";
  const envFile = `.${"env"}`;
  assert.equal(isSafeExternalUrl("https://fadrecords.com/docs", { trustedOrigin }), true);
  assert.equal(isSafeExternalUrl("https://www.fadrecords.com/docs", { trustedOrigin }), true);
  assert.equal(isSafeExternalUrl("https://example.com/docs", { trustedOrigin }), false);
  assert.equal(isSafeExternalUrl("http://127.0.0.1:4387/api/asset?id=asset-report", { trustedOrigin }), true);
  assert.equal(isSafeExternalUrl(`http://127.0.0.1:4387/api/asset?id=${privateUserRoot}/${envFile}`, { trustedOrigin }), false);
  assert.equal(isSafeExternalUrl("http://127.0.0.1:4387/api/asset?id=asset%2Fsecret", { trustedOrigin }), false);
  assert.equal(isSafeExternalUrl("http://127.0.0.1:4387/api/asset?id=asset.report", { trustedOrigin }), false);
  assert.equal(isSafeExternalUrl("http://127.0.0.1:4387/api/asset?path=report", { trustedOrigin }), false);
  assert.equal(isSafeExternalUrl("http://127.0.0.1:4387/api/jobs", { trustedOrigin }), false);
  assert.equal(isSafeExternalUrl("http://localhost:4387/api/asset?id=asset-report", { trustedOrigin }), false);
  assert.equal(isSafeExternalUrl("http://[::1]:4387/api/asset?id=asset-report", { trustedOrigin }), false);
  assert.equal(isSafeExternalUrl("http://127.0.0.2:4387/api/asset?id=asset-report", { trustedOrigin }), false);
  assert.equal(isSafeExternalUrl("http://example.com", { trustedOrigin }), false);
  assert.equal(isSafeExternalUrl(`file://${privateUserRoot}/private-fixture`, { trustedOrigin }), false);
  assert.equal(isSafeExternalUrl("javascript:alert(1)", { trustedOrigin }), false);
  assert.equal(isSafeExternalUrl("fadcustom://open", { trustedOrigin }), false);
});

test("desktop report asset URLs are built only from opaque ids and the trusted local origin", () => {
  const trustedOrigin = "http://127.0.0.1:4387";
  const envFile = `.${"env"}`;
  const assetUrl = buildTrustedLocalAssetUrl("asset-report", { trustedOrigin });

  assert.equal(assetUrl, "http://127.0.0.1:4387/api/asset?id=asset-report");
  assert.equal(isSafeExternalUrl(assetUrl, { trustedOrigin }), true);
  assert.equal(buildTrustedLocalAssetUrl("", { trustedOrigin }), null);
  assert.equal(buildTrustedLocalAssetUrl(`asset-${privateUserRoot}/${envFile}`, { trustedOrigin }), null);
  assert.equal(buildTrustedLocalAssetUrl("asset.report", { trustedOrigin }), null);
  assert.equal(buildTrustedLocalAssetUrl("asset-report", { trustedOrigin: "not a url" }), null);
});

test("desktop native IPC guard trusts only the current local UI origin", () => {
  const trustedOrigin = "http://127.0.0.1:4387";
  assert.equal(isTrustedRendererUrl("http://127.0.0.1:4387/", { trustedOrigin }), true);
  assert.equal(isTrustedRendererUrl("http://localhost:4387/api/spec", { trustedOrigin }), false);
  assert.equal(isTrustedRendererUrl("http://[::1]:4387/api/spec", { trustedOrigin }), false);
  assert.equal(isTrustedRendererUrl("http://127.0.0.2:4387/api/spec", { trustedOrigin }), false);
  assert.equal(isTrustedRendererUrl("http://127.0.0.1:4388/", { trustedOrigin }), false);
  assert.equal(isTrustedRendererUrl("https://fadrecords.com", { trustedOrigin }), false);
  assert.equal(isTrustedRendererUrl("file:///tmp/renderer.html", { trustedOrigin }), false);
  assert.equal(isTrustedRendererUrl("javascript:alert(1)", { trustedOrigin }), false);
});

test("desktop entrypoint applies URL and IPC origin guards before host actions", async () => {
  const main = await readFile(path.join(projectRoot, "desktop", "main.cjs"), "utf8");

  const importIndex = main.indexOf("require(\"./security.cjs\")");
  const originIndex = main.indexOf("const trustedOrigin = localUiOrigin(port);");
  const openHandlerIndex = main.indexOf("setWindowOpenHandler");
  const safeUrlIndex = main.indexOf("isSafeExternalUrl(url, { trustedOrigin })", openHandlerIndex);
  const shellIndex = main.indexOf("shell.openExternal(url)", openHandlerIndex);
  const catchIndex = main.indexOf(".catch(reportExternalOpenError)", shellIndex);
  const safeLogIndex = main.indexOf("function reportExternalOpenError(_error)");
  const navigateGuardIndex = main.indexOf("mainWindow.webContents.on(\"will-navigate\"", openHandlerIndex);
  const trustNavigationIndex = main.indexOf("isTrustedRendererUrl(url, { trustedOrigin })", navigateGuardIndex);
  const preventIndex = main.indexOf("event.preventDefault();", trustNavigationIndex);
  const ipcIndex = main.indexOf("ipcMain.handle(\"paths:pick\"");
  const senderUrlIndex = main.indexOf("senderUrlFromEvent(event)", ipcIndex);
  const trustIndex = main.indexOf("isTrustedRendererUrl(senderUrl, { trustedOrigin: localUiOrigin(serverPort) })", senderUrlIndex);
  const dialogIndex = main.indexOf("dialog.showOpenDialog", ipcIndex);
  const assetIpcIndex = main.indexOf("ipcMain.handle(\"assets:open\"");
  const assetSenderUrlIndex = main.indexOf("senderUrlFromEvent(event)", assetIpcIndex);
  const assetTrustIndex = main.indexOf("isTrustedRendererUrl(senderUrl, { trustedOrigin })", assetSenderUrlIndex);
  const assetUrlIndex = main.indexOf("buildTrustedLocalAssetUrl(request?.id, { trustedOrigin })", assetTrustIndex);
  const assetShellIndex = main.indexOf("shell.openExternal(assetUrl)", assetUrlIndex);

  assert.notEqual(importIndex, -1);
  assert.notEqual(originIndex, -1);
  assert.notEqual(openHandlerIndex, -1);
  assert.notEqual(safeUrlIndex, -1);
  assert.notEqual(shellIndex, -1);
  assert.notEqual(catchIndex, -1);
  assert.notEqual(safeLogIndex, -1);
  assert.notEqual(navigateGuardIndex, -1);
  assert.notEqual(trustNavigationIndex, -1);
  assert.notEqual(preventIndex, -1);
  assert.notEqual(ipcIndex, -1);
  assert.notEqual(senderUrlIndex, -1);
  assert.notEqual(trustIndex, -1);
  assert.notEqual(dialogIndex, -1);
  assert.notEqual(assetIpcIndex, -1);
  assert.notEqual(assetSenderUrlIndex, -1);
  assert.notEqual(assetTrustIndex, -1);
  assert.notEqual(assetUrlIndex, -1);
  assert.notEqual(assetShellIndex, -1);
  assert.ok(originIndex < openHandlerIndex);
  assert.ok(safeUrlIndex < shellIndex);
  assert.ok(openHandlerIndex < navigateGuardIndex);
  assert.ok(navigateGuardIndex < ipcIndex);
  assert.ok(trustNavigationIndex < preventIndex);
  assert.ok(senderUrlIndex < dialogIndex);
  assert.ok(trustIndex < dialogIndex);
  assert.ok(assetSenderUrlIndex < assetShellIndex);
  assert.ok(assetTrustIndex < assetShellIndex);
  assert.ok(assetUrlIndex < assetShellIndex);
});

test("UI markup exposes picker buttons instead of fake focus-only buttons", async () => {
  const html = await readFile(path.join(projectRoot, "ui", "public", "index.html"), "utf8");
  const pickerButtons = [...html.matchAll(/<button[^>]*data-picker="[^"]+"[^>]*>/g)].map((match) => match[0]);

  assert.match(html, /data-picker="inputFile"/);
  assert.match(html, /data-picker="inputFolder"/);
  assert.match(html, /data-picker="outputFolder"/);
  assert.doesNotMatch(html, /data-focus=/);
  assert.equal(pickerButtons.length, 3);
  for (const button of pickerButtons) {
    assert.match(button, /type="button"/);
    assert.match(button, /data-target="/);
  }
});

test("renderer disables all picker buttons while a native dialog is pending", async () => {
  const app = await readFile(path.join(projectRoot, "ui", "public", "app.js"), "utf8");

  assert.match(app, /pathPickerPending:\s*false/);
  assert.match(app, /if \(state\.pathPickerPending\) return/);
  assert.match(app, /state\.pathPickerPending = true/);
  assert.match(app, /state\.pathPickerPending = false/);
  assert.match(app, /setPickerButtonsDisabled\(true\)/);
  assert.match(app, /setPickerButtonsDisabled\(false\)/);
  assert.match(app, /document\.querySelectorAll\("\[data-picker\]"\)/);
  assert.match(app, /result\?\.error/);
});

test("renderer keeps native picker failures visible beyond transient toast", async () => {
  const app = await readFile(path.join(projectRoot, "ui", "public", "app.js"), "utf8");

  const pickIndex = app.indexOf("async function pickPath(button)");
  const resultErrorIndex = app.indexOf("if (result?.error)", pickIndex);
  const resultHandlerIndex = app.indexOf("renderPickerError(result.error);", resultErrorIndex);
  const catchIndex = app.indexOf("} catch (error) {", pickIndex);
  const catchHandlerIndex = app.indexOf("renderPickerError(error.message);", catchIndex);
  const helperIndex = app.indexOf("function renderPickerError(message)");
  const logIndex = app.indexOf("renderLogLine(message, \"error\");", helperIndex);
  const persistentIndex = app.indexOf("showTransientError(message);", helperIndex);
  const toastIndex = app.indexOf("showToast(message);", helperIndex);

  assert.notEqual(pickIndex, -1);
  assert.notEqual(resultErrorIndex, -1);
  assert.notEqual(resultHandlerIndex, -1);
  assert.notEqual(catchIndex, -1);
  assert.notEqual(catchHandlerIndex, -1);
  assert.notEqual(helperIndex, -1);
  assert.notEqual(logIndex, -1);
  assert.notEqual(persistentIndex, -1);
  assert.notEqual(toastIndex, -1);
  assert.ok(resultErrorIndex < resultHandlerIndex);
  assert.ok(catchIndex < catchHandlerIndex);
  assert.ok(helperIndex < logIndex);
  assert.ok(helperIndex < persistentIndex);
  assert.ok(helperIndex < toastIndex);
});

test("renderer starts validation from Enter in text fields", async () => {
  const app = await readFile(path.join(projectRoot, "ui", "public", "app.js"), "utf8");

  const bindIndex = app.indexOf("function bindEvents()");
  const submitIndex = app.indexOf("elements.jobForm.addEventListener(\"submit\"", bindIndex);
  const submitPreventIndex = app.indexOf("event.preventDefault();", submitIndex);
  const submitStartIndex = app.indexOf("startJob(false);", submitIndex);
  const keydownIndex = app.indexOf("elements.jobForm.addEventListener(\"keydown\"", bindIndex);
  const enterGuardIndex = app.indexOf("if (event.key !== \"Enter\") return;", keydownIndex);
  const textGuardIndex = app.indexOf("isTextInput(event.target)", keydownIndex);
  const keyPreventIndex = app.indexOf("event.preventDefault();", keydownIndex);
  const keyStartIndex = app.indexOf("startJob(false);", keydownIndex);
  const helperIndex = app.indexOf("function isTextInput(target)");

  assert.notEqual(bindIndex, -1);
  assert.notEqual(submitIndex, -1);
  assert.notEqual(submitPreventIndex, -1);
  assert.notEqual(submitStartIndex, -1);
  assert.notEqual(keydownIndex, -1);
  assert.notEqual(enterGuardIndex, -1);
  assert.notEqual(textGuardIndex, -1);
  assert.notEqual(keyPreventIndex, -1);
  assert.notEqual(keyStartIndex, -1);
  assert.notEqual(helperIndex, -1);
  assert.ok(submitPreventIndex < submitStartIndex);
  assert.ok(enterGuardIndex < keyStartIndex);
  assert.ok(textGuardIndex < keyStartIndex);
});

test("renderer only logs queued jobs after the server accepts the job", async () => {
  const app = await readFile(path.join(projectRoot, "ui", "public", "app.js"), "utf8");

  const postIndex = app.indexOf("const response = await postJobWithOverwriteConfirmation(payload, { dryRun, signal: abortController.signal });");
  const logIndex = app.indexOf("renderLogLine(dryRun ? \"模拟运行已加入队列。\" : \"渲染任务已加入队列。\")");

  assert.notEqual(postIndex, -1);
  assert.notEqual(logIndex, -1);
  assert.ok(logIndex > postIndex);
});

test("UI server final status prioritizes failures over dry-run planned state", async () => {
  const serverSource = await readFile(path.join(projectRoot, "ui", "server.mjs"), "utf8");

  const runJobIndex = serverSource.indexOf("async function runJob(job, { state })");
  const finalStatusIndex = serverSource.indexOf("job.current = null;", runJobIndex);
  const cancelIndex = serverSource.indexOf("if (job.cancelRequested)", finalStatusIndex);
  const failedIndex = serverSource.indexOf("job.failed > 0", cancelIndex);
  const dryRunIndex = serverSource.indexOf("job.options.dryRun", cancelIndex);
  const plannedIndex = serverSource.indexOf("job.status = \"planned\"", dryRunIndex);

  assert.notEqual(runJobIndex, -1);
  assert.notEqual(finalStatusIndex, -1);
  assert.notEqual(cancelIndex, -1);
  assert.notEqual(failedIndex, -1);
  assert.notEqual(dryRunIndex, -1);
  assert.notEqual(plannedIndex, -1);
  assert.ok(failedIndex < dryRunIndex);
});

test("renderer exposes Stop while job creation preflight is still pending", async () => {
  const app = await readFile(path.join(projectRoot, "ui", "public", "app.js"), "utf8");

  const startIndex = app.indexOf("async function startJob(dryRun)");
  const abortControllerIndex = app.indexOf("const abortController = new AbortController();", startIndex);
  const abortStateIndex = app.indexOf("state.jobSubmitAbortController = abortController;", abortControllerIndex);
  const pendingStateIndex = app.indexOf("state.jobSubmitPending = true;", abortStateIndex);
  const submittingIndex = app.indexOf("setSubmitting(true);", pendingStateIndex);
  const preflightIndex = app.indexOf("renderPreflightState();", submittingIndex);
  const postIndex = app.indexOf("const response = await postJobWithOverwriteConfirmation(payload, { dryRun, signal: abortController.signal });", startIndex);
  const busyIndex = app.indexOf("setBusy(true);", postIndex);
  const helperIndex = app.indexOf("function renderPreflightState()");
  const processingIndex = app.indexOf("elements.jobBadge.className = \"status-chip processing\";", helperIndex);
  const checkingIndex = app.indexOf("elements.jobBadge.textContent = \"检查中\";", helperIndex);
  const actionControlsIndex = app.indexOf("function renderActionControls");

  assert.notEqual(abortControllerIndex, -1);
  assert.notEqual(abortStateIndex, -1);
  assert.notEqual(pendingStateIndex, -1);
  assert.notEqual(submittingIndex, -1);
  assert.notEqual(preflightIndex, -1);
  assert.notEqual(postIndex, -1);
  assert.notEqual(busyIndex, -1);
  assert.notEqual(helperIndex, -1);
  assert.notEqual(processingIndex, -1);
  assert.notEqual(checkingIndex, -1);
  assert.notEqual(actionControlsIndex, -1);
  assert.ok(abortControllerIndex < abortStateIndex);
  assert.ok(abortStateIndex < pendingStateIndex);
  assert.ok(pendingStateIndex < submittingIndex);
  assert.ok(submittingIndex < preflightIndex);
  assert.ok(preflightIndex < postIndex);
  assert.ok(busyIndex > postIndex);
  assert.match(app, /function setSubmitting\(isSubmitting\)/);
  assert.match(app, /const stopAvailable = state\.jobSubmitPending \|\| jobBusy;/);
  assert.match(app, /const cancelPending = Boolean\(state\.cancelPendingJobId\);/);
  assert.match(app, /const clearHistoryConfirmationPending = Boolean\(state\.pendingClearHistoryConfirmation\);/);
  assert.match(app, /const submitBlocked = state\.restorePending \|\| state\.restoreFailed \|\| stopAvailable \|\| state\.historyClearPending \|\| cancelPending \|\| clearHistoryConfirmationPending;/);
  assert.match(app, /const clearHistoryLabel = state\.restoreFailed \? "重置本地任务恢复记录" : "清除历史任务记录，不删除输出文件";/);
  assert.match(app, /elements\.stopButton\.disabled = !stopAvailable \|\| cancelPending;/);
  assert.match(app, /elements\.clearHistoryButton\.disabled = state\.restorePending \|\| state\.jobSubmitPending \|\| state\.historyClearPending \|\| cancelPending \|\| clearHistoryConfirmationPending;/);
  assert.match(app, /elements\.clearHistoryButton\.title = clearHistoryLabel;/);
  assert.match(app, /elements\.clearHistoryButton\.setAttribute\("aria-label", clearHistoryLabel\);/);
  assert.doesNotMatch(app, /const submitBlocked = [^;]*finalDetailPending/);
  assert.doesNotMatch(app, /elements\.clearHistoryButton\.disabled = [^;]*finalDetailPending/);
});

test("renderer confirms exact server overwrite replacements before retrying jobs", async () => {
  const app = await readFile(path.join(projectRoot, "ui", "public", "app.js"), "utf8");

  const startIndex = app.indexOf("async function startJob(dryRun)");
  const outDirGuardIndex = app.indexOf("if (!payload.outDir) {", startIndex);
  const outDirReturnIndex = app.indexOf("return;", outDirGuardIndex);
  const resetIndex = app.indexOf("resetReviewState();", startIndex);
  const postHelperCallIndex = app.indexOf("const response = await postJobWithOverwriteConfirmation(payload, { dryRun, signal: abortController.signal });", startIndex);
  const helperIndex = app.indexOf("async function postJobWithOverwriteConfirmation(payload, { dryRun, signal })");
  const firstPostIndex = app.indexOf("return await apiPost(\"/api/jobs\", payload, { signal });", helperIndex);
  const confirmationGuardIndex = app.indexOf("if (!isOverwriteConfirmationRequest(error)) throw error;", firstPostIndex);
  const confirmIndex = app.indexOf("if (!await confirmOverwrite(error.overwriteConfirmation, { dryRun, signal }))", confirmationGuardIndex);
  const retryIndex = app.indexOf("overwriteConfirmationToken: error.overwriteConfirmation.token", confirmIndex);
  const retrySignalIndex = app.indexOf("}, { signal });", retryIndex);
  const confirmHelperIndex = app.indexOf("async function confirmOverwrite(confirmation, { dryRun, signal })");
  const detailsHelperIndex = app.indexOf("function overwriteConfirmationDetails(confirmation)");
  const dialogHelperIndex = app.indexOf("function showOverwriteDialog(confirmation, { signal } = {})");
  const replacementsIndex = app.indexOf("confirmation.replacements", detailsHelperIndex);
  const confirmCallIndex = app.indexOf("return showOverwriteDialog(confirmation, { signal });", confirmHelperIndex);
  const nativeConfirmIndex = app.indexOf("window.confirm", confirmHelperIndex);
  const staleLocalConfirmIndex = app.indexOf("confirmOverwrite(payload, { dryRun })", outDirReturnIndex);

  assert.notEqual(startIndex, -1);
  assert.notEqual(outDirGuardIndex, -1);
  assert.notEqual(outDirReturnIndex, -1);
  assert.notEqual(resetIndex, -1);
  assert.notEqual(postHelperCallIndex, -1);
  assert.notEqual(helperIndex, -1);
  assert.notEqual(firstPostIndex, -1);
  assert.notEqual(confirmationGuardIndex, -1);
  assert.notEqual(confirmIndex, -1);
  assert.notEqual(retryIndex, -1);
  assert.notEqual(retrySignalIndex, -1);
  assert.notEqual(confirmHelperIndex, -1);
  assert.notEqual(detailsHelperIndex, -1);
  assert.notEqual(dialogHelperIndex, -1);
  assert.notEqual(replacementsIndex, -1);
  assert.notEqual(confirmCallIndex, -1);
  assert.equal(nativeConfirmIndex, -1);
  assert.equal(staleLocalConfirmIndex, -1);
  assert.ok(outDirReturnIndex < resetIndex);
  assert.ok(resetIndex < postHelperCallIndex);
  assert.ok(helperIndex < firstPostIndex);
  assert.ok(firstPostIndex < confirmationGuardIndex);
  assert.ok(confirmationGuardIndex < confirmIndex);
  assert.ok(confirmIndex < retryIndex);
  assert.ok(retryIndex < retrySignalIndex);
  assert.ok(detailsHelperIndex < replacementsIndex);
});

test("overwrite confirmation dialog describes the replacement list", async () => {
  const html = await readFile(path.join(projectRoot, "ui", "public", "index.html"), "utf8");

  assert.match(
    html,
    /id="overwriteDialog"[^>]+aria-describedby="overwriteDialogSummary overwriteDialogList overwriteDialogMore"/
  );
});

test("renderer refreshes job state when cancel races with a finished job", async () => {
  const app = await readFile(path.join(projectRoot, "ui", "public", "app.js"), "utf8");

  const stopIndex = app.indexOf("async function stopJob()");
  const catchIndex = app.indexOf("} catch (error) {", stopIndex);
  const conflictIndex = app.indexOf("if (error.status === 409)", catchIndex);
  const toastIndex = app.indexOf("showToast(\"任务已经结束，正在刷新状态。\");", conflictIndex);
  const pollIndex = app.indexOf("await pollJob();", conflictIndex);
  const returnIndex = app.indexOf("return;", pollIndex);
  const persistentIndex = app.indexOf("showTransientError(error.message);", catchIndex);

  assert.notEqual(stopIndex, -1);
  assert.notEqual(catchIndex, -1);
  assert.notEqual(conflictIndex, -1);
  assert.notEqual(toastIndex, -1);
  assert.notEqual(pollIndex, -1);
  assert.notEqual(returnIndex, -1);
  assert.notEqual(persistentIndex, -1);
  assert.ok(catchIndex < conflictIndex);
  assert.ok(conflictIndex < pollIndex);
  assert.ok(pollIndex < returnIndex);
  assert.ok(returnIndex < persistentIndex);
});

test("renderer selects the first failed or warning result for QC review", async () => {
  const app = await readFile(path.join(projectRoot, "ui", "public", "app.js"), "utf8");

  assert.match(app, /selectedInputPath:\s*null/);
  assert.match(app, /function selectReviewItem\(job\)/);
  assert.match(app, /issueSummary\?\.errorCount/);
  assert.match(app, /issueSummary\?\.warningCount/);
  assert.match(app, /function itemInputKey\(item\)/);
  assert.match(app, /state\.selectedInputPath = itemInputKey\(item\)/);
  assert.match(app, /data-input-key/);
  assert.doesNotMatch(app, /data-input-path="\$\{escapeHtml\(item\.inputPath\)\}"/);
  assert.match(app, /renderQc\(selectedItem,\s*job\)/);
});

test("renderer lets failed rows without generated results drive QC review", async () => {
  const app = await readFile(path.join(projectRoot, "ui", "public", "app.js"), "utf8");

  const renderJobIndex = app.indexOf("function renderJob(job)");
  const renderQcCallIndex = app.indexOf("renderQc(selectedItem, job);", renderJobIndex);
  const helperIndex = app.indexOf("function selectReviewItem(job)");
  const selectedIndex = app.indexOf("items.find((item) => itemInputKey(item) === state.selectedInputPath);", helperIndex);
  const failedIndex = app.indexOf("item.error", helperIndex);
  const qcIndex = app.indexOf("function renderQc(selectedItem, job = null)");
  const selectedResultIndex = app.indexOf("const selectedResult = selectedItem?.result ?? null;", qcIndex);
  const errorGuardIndex = app.indexOf("if (selectedItem?.error && !selectedResult)", qcIndex);
  const errorCardIndex = app.indexOf("class=\"issue-card error\"", errorGuardIndex);

  assert.notEqual(renderJobIndex, -1);
  assert.notEqual(renderQcCallIndex, -1);
  assert.notEqual(helperIndex, -1);
  assert.notEqual(selectedIndex, -1);
  assert.notEqual(failedIndex, -1);
  assert.notEqual(qcIndex, -1);
  assert.notEqual(selectedResultIndex, -1);
  assert.notEqual(errorGuardIndex, -1);
  assert.notEqual(errorCardIndex, -1);
  assert.ok(helperIndex < selectedIndex);
  assert.ok(helperIndex < failedIndex);
  assert.ok(qcIndex < selectedResultIndex);
  assert.ok(selectedResultIndex < errorGuardIndex);
});

test("renderer makes queue result rows selectable from a dedicated keyboard control", async () => {
  const app = await readFile(path.join(projectRoot, "ui", "public", "app.js"), "utf8");
  const css = await readFile(path.join(projectRoot, "ui", "public", "styles.css"), "utf8");

  const rowTemplateIndex = app.indexOf("data-input-key=\"${index}\"");
  const rowEndIndex = app.indexOf("</tr>`", rowTemplateIndex);
  const selectButtonIndex = app.indexOf("data-row-select=\"true\"", rowTemplateIndex);
  const selectButtonTypeIndex = app.indexOf("type=\"button\"", rowTemplateIndex);
  const labelIndex = app.indexOf("aria-label=\"${escapeHtml(rowSelectionLabel(source, { selected }))}\"", rowTemplateIndex);
  const currentIndex = app.indexOf("${currentAttribute}", rowTemplateIndex);
  const bindIndex = app.indexOf("elements.queueBody.querySelectorAll(\"[data-input-key]\").forEach((row) => {");
  const helperIndex = app.indexOf("function selectQueueRow(row)");
  const clickIndex = app.indexOf("row.addEventListener(\"click\", (event) => {", bindIndex);
  const rowButtonGuardIndex = app.indexOf("if (isQueueButtonEventTarget(event.target)) return;", clickIndex);
  const selectBindIndex = app.indexOf("elements.queueBody.querySelectorAll(\"[data-row-select]\").forEach((button) => {");
  const propagationIndex = app.indexOf("event.stopPropagation();", selectBindIndex);
  const selectByPathIndex = app.indexOf("selectQueueRowByInputPath(inputPath, { restoreFocus: true, focusKind: \"select\" });", propagationIndex);

  assert.notEqual(rowTemplateIndex, -1);
  assert.notEqual(rowEndIndex, -1);
  assert.notEqual(selectButtonIndex, -1);
  assert.notEqual(selectButtonTypeIndex, -1);
  assert.notEqual(labelIndex, -1);
  assert.notEqual(currentIndex, -1);
  assert.notEqual(bindIndex, -1);
  assert.notEqual(helperIndex, -1);
  assert.notEqual(selectBindIndex, -1);
  assert.notEqual(propagationIndex, -1);
  assert.notEqual(selectByPathIndex, -1);
  assert.notEqual(rowButtonGuardIndex, -1);
  assert.equal(app.slice(rowTemplateIndex, rowEndIndex).includes("role=\"button\""), false);
  assert.equal(app.slice(rowTemplateIndex, rowEndIndex).includes("tabindex=\"0\""), false);
  assert.equal(app.slice(rowTemplateIndex, rowEndIndex).includes("aria-selected"), false);
  assert.equal(app.slice(rowTemplateIndex, rowEndIndex).includes("aria-pressed"), false);
  assert.notEqual(clickIndex, -1);
  assert.ok(rowTemplateIndex < selectButtonIndex);
  assert.ok(rowTemplateIndex < selectButtonTypeIndex);
  assert.ok(rowTemplateIndex < labelIndex);
  assert.ok(rowTemplateIndex < currentIndex);
  assert.ok(clickIndex < rowButtonGuardIndex);
  assert.ok(propagationIndex < selectByPathIndex);
  assert.match(css, /\.row-select-button:focus-visible/);
  assert.match(css, /outline:\s*2px solid var\(--cyan\)/);
});

test("renderer exposes a persisted-history clear action backed by the local API", async () => {
  const html = await readFile(path.join(projectRoot, "ui", "public", "index.html"), "utf8");
  const app = await readFile(path.join(projectRoot, "ui", "public", "app.js"), "utf8");
  const server = await readFile(path.join(projectRoot, "ui", "server.mjs"), "utf8");

  assert.match(html, /id="clearHistoryButton"[^>]*title="清除历史任务记录，不删除输出文件"/);
  assert.match(html, /id="clearHistoryButton"[^>]*aria-label="清除历史任务记录，不删除输出文件"/);
  assert.match(html, /id="clearHistoryButton"[^>]*data-icon="trash-2"/);
  assert.match(html, /id="clearHistoryDialog"[^>]*role="dialog"[^>]*aria-modal="true"/);
  assert.match(html, /id="clearHistoryDialogSummary"[^>]*>只会从队列中移除已完成的历史任务，不会删除任何输出文件。正在运行的任务会保留。<\/p>/);
  assert.match(html, /id="clearHistoryCancelButton"[^>]*>取消<\/button>/);
  assert.match(html, /id="clearHistoryConfirmButton"[^>]*class="button danger"[^>]*>清除历史<\/button>/);
  assert.match(app, /clearHistoryButton: \$\("#clearHistoryButton"\)/);
  assert.match(app, /clearHistoryDialog: \$\("#clearHistoryDialog"\)/);
  assert.match(app, /elements\.clearHistoryButton\.addEventListener\("click", clearJobHistory\)/);
  assert.match(app, /elements\.clearHistoryConfirmButton\.addEventListener\("click", \(\) => resolveClearHistoryDialog\(true\)\)/);
  assert.match(app, /const confirmed = await showClearHistoryDialog\(\);/);
  assert.match(app, /apiDelete\("\/api\/jobs\/history", \{ confirm: "clear-finished-history" \}\)/);
  assert.match(server, /requestUrl\.pathname === "\/api\/jobs\/history" && request\.method === "DELETE"/);
  assert.match(server, /async function clearFinishedJobHistory\(state\)/);
  assert.match(server, /rebuildAllowedAssets\(state\)/);
  assert.match(server, /persistStateSoon\(state, \{ immediate: true \}\)/);
});

test("segmented radio controls expose visible keyboard focus", async () => {
  const css = await readFile(path.join(projectRoot, "ui", "public", "styles.css"), "utf8");

  assert.match(css, /\.segmented-field input:focus-visible \+ span/);
  assert.match(css, /outline:\s*2px solid var\(--violet\)/);
  assert.match(css, /outline-offset:\s*2px/);
});

test("renderer displays current processing stage in queue rows", async () => {
  const app = await readFile(path.join(projectRoot, "ui", "public", "app.js"), "utf8");

  assert.match(app, /stageLabel\(item\.currentStage\)/);
  assert.match(app, /class="stage-chip"/);
  assert.match(app, /检查编码器/);
  assert.match(app, /渲染 3x4/);
  assert.match(app, /写入报告/);
});

test("renderer keeps cleared log history hidden after polling refreshes", async () => {
  const app = await readFile(path.join(projectRoot, "ui", "public", "app.js"), "utf8");

  assert.match(app, /logClearedAt:\s*null/);
  assert.match(app, /state\.logClearedAt = new Date\(\)\.toISOString\(\)/);
  assert.match(app, /filterVisibleLogs\(logs\)/);
  assert.doesNotMatch(app, /renderLogs\(job\.logs \?\? \[\]\)/);
});

test("renderer clears stale preview state when a new job starts", async () => {
  const app = await readFile(path.join(projectRoot, "ui", "public", "app.js"), "utf8");

  const startIndex = app.indexOf("async function startJob(dryRun)");
  const postIndex = app.indexOf("const response = await postJobWithOverwriteConfirmation(payload, { dryRun, signal: abortController.signal });");
  const resetIndex = app.indexOf("resetPreview();", startIndex);

  assert.notEqual(startIndex, -1);
  assert.notEqual(postIndex, -1);
  assert.notEqual(resetIndex, -1);
  assert.ok(resetIndex < postIndex);
  assert.match(app, /function resetPreview\(\{ keepFailedPath = false \} = \{\}\)/);
  assert.match(app, /state\.previewPath = ""/);
  assert.match(app, /state\.previewFailedPath = ""/);
  assert.match(app, /elements\.previewImage\.classList\.remove\("visible"\)/);
  assert.notEqual(app.indexOf("renderRevealButtonStates();", resetIndex), -1);
});

test("renderer clears stale review surfaces while new job creation is pending", async () => {
  const app = await readFile(path.join(projectRoot, "ui", "public", "app.js"), "utf8");

  const startIndex = app.indexOf("async function startJob(dryRun)");
  const resetIndex = app.indexOf("resetReviewState();", startIndex);
  const preflightIndex = app.indexOf("renderPreflightState();", startIndex);
  const postIndex = app.indexOf("const response = await postJobWithOverwriteConfirmation(payload, { dryRun, signal: abortController.signal });", startIndex);
  const helperIndex = app.indexOf("function resetReviewState()");
  const clearJobIdIndex = app.indexOf("state.currentJobId = null;", helperIndex);
  const clearJobIndex = app.indexOf("state.currentJob = null;", helperIndex);
  const clearSelectionIndex = app.indexOf("state.selectedInputPath = null;", helperIndex);
  const clearReportIndex = app.indexOf("state.reportPath = \"\";", helperIndex);
  const disableReportIndex = app.indexOf("elements.revealReportButton.disabled = true;", helperIndex);
  const zeroMetricsIndex = app.indexOf("elements.metricTotal.textContent = \"0\";", helperIndex);
  const renderEmptyIndex = app.indexOf("renderEmpty();", helperIndex);

  assert.notEqual(startIndex, -1);
  assert.notEqual(resetIndex, -1);
  assert.notEqual(preflightIndex, -1);
  assert.notEqual(postIndex, -1);
  assert.notEqual(helperIndex, -1);
  assert.notEqual(clearJobIdIndex, -1);
  assert.notEqual(clearJobIndex, -1);
  assert.notEqual(clearSelectionIndex, -1);
  assert.notEqual(clearReportIndex, -1);
  assert.notEqual(disableReportIndex, -1);
  assert.notEqual(zeroMetricsIndex, -1);
  assert.notEqual(renderEmptyIndex, -1);
  assert.ok(resetIndex < preflightIndex);
  assert.ok(preflightIndex < postIndex);
});

test("renderer restores the prior review surface when job creation fails", async () => {
  const app = await readFile(path.join(projectRoot, "ui", "public", "app.js"), "utf8");

  const startIndex = app.indexOf("async function startJob(dryRun)");
  const snapshotIndex = app.indexOf("const previousReviewState = captureReviewState();", startIndex);
  const resetIndex = app.indexOf("resetReviewState();", startIndex);
  const postIndex = app.indexOf("const response = await postJobWithOverwriteConfirmation(payload, { dryRun, signal: abortController.signal });", startIndex);
  const catchIndex = app.indexOf("} catch (error) {", startIndex);
  const restoreIndex = app.indexOf("restoreReviewState(previousReviewState);", catchIndex);
  const logIndex = app.indexOf("renderLogLine(error.message, \"error\");", catchIndex);
  const captureIndex = app.indexOf("function captureReviewState()");
  const restoreHelperIndex = app.indexOf("function restoreReviewState(reviewState)");
  const renderPriorIndex = app.indexOf("renderJob(reviewState.currentJob);", restoreHelperIndex);
  const emptyIndex = app.indexOf("renderEmpty();", restoreHelperIndex);

  assert.notEqual(startIndex, -1);
  assert.notEqual(snapshotIndex, -1);
  assert.notEqual(resetIndex, -1);
  assert.notEqual(postIndex, -1);
  assert.notEqual(catchIndex, -1);
  assert.notEqual(restoreIndex, -1);
  assert.notEqual(logIndex, -1);
  assert.notEqual(captureIndex, -1);
  assert.notEqual(restoreHelperIndex, -1);
  assert.notEqual(renderPriorIndex, -1);
  assert.notEqual(emptyIndex, -1);
  assert.ok(snapshotIndex < resetIndex);
  assert.ok(resetIndex < postIndex);
  assert.ok(catchIndex < restoreIndex);
  assert.ok(restoreIndex < logIndex);
});

test("renderer restores prior progress announcement text when job creation fails", async () => {
  const app = await readFile(path.join(projectRoot, "ui", "public", "app.js"), "utf8");

  const captureIndex = app.indexOf("function captureReviewState()");
  const captureTextIndex = app.indexOf("progressAnnouncementText: elements.jobStatusAnnouncer.textContent", captureIndex);
  const restoreIndex = app.indexOf("function restoreReviewState(reviewState)");
  const restoreTextIndex = app.indexOf("elements.jobStatusAnnouncer.textContent = reviewState.progressAnnouncementText;", restoreIndex);
  const renderPriorIndex = app.indexOf("renderJob(reviewState.currentJob);", restoreIndex);

  assert.notEqual(captureIndex, -1);
  assert.notEqual(captureTextIndex, -1);
  assert.notEqual(restoreIndex, -1);
  assert.notEqual(restoreTextIndex, -1);
  assert.notEqual(renderPriorIndex, -1);
  assert.ok(captureIndex < captureTextIndex);
  assert.ok(restoreTextIndex < renderPriorIndex);
});

test("renderer waits for preview assets to load while keeping reveal available after load failures", async () => {
  const app = await readFile(path.join(projectRoot, "ui", "public", "app.js"), "utf8");

  const setPreviewIndex = app.indexOf("function setPreview(previewPath, previewLabel)");
  const removeVisibleIndex = app.indexOf("elements.previewImage.classList.remove(\"visible\");", setPreviewIndex);
  const emptyVisibleIndex = app.indexOf("elements.previewEmpty.style.display = \"grid\";", setPreviewIndex);
  const revealDisabledIndex = app.indexOf("renderRevealButtonStates();", setPreviewIndex);
  const altIndex = app.indexOf("elements.previewImage.alt = previewLabel;", setPreviewIndex);
  const loadIndex = app.indexOf("elements.previewImage.onload = () => {", setPreviewIndex);
  const loadVisibleIndex = app.indexOf("elements.previewImage.classList.add(\"visible\");", loadIndex);
  const loadEmptyHiddenIndex = app.indexOf("elements.previewEmpty.style.display = \"none\";", loadIndex);
  const loadRevealIndex = app.indexOf("renderRevealButtonStates();", loadIndex);
  const errorIndex = app.indexOf("elements.previewImage.onerror = () => {", setPreviewIndex);
  const errorHandlerIndex = app.indexOf("handlePreviewLoadError(previewPath);", errorIndex);
  const srcIndex = app.indexOf("elements.previewImage.src = assetUrl(previewPath);", setPreviewIndex);
  const helperIndex = app.indexOf("function handlePreviewLoadError(previewPath)");
  const helperFailedPathIndex = app.indexOf("state.previewFailedPath = previewPath;", helperIndex);
  const helperFailedPreviewIndex = app.indexOf("renderFailedPreview(previewPath);", helperIndex);
  const helperLogIndex = app.indexOf("renderLogLine(message, \"error\");", helperIndex);
  const helperPersistentIndex = app.indexOf("showTransientError(message);", helperIndex);
  const helperToastIndex = app.indexOf("showToast(message);", helperIndex);
  const failedPreviewIndex = app.indexOf("function renderFailedPreview(previewPath)");
  const failedPreviewPathIndex = app.indexOf("state.previewPath = previewPath;", failedPreviewIndex);
  const failedTextIndex = app.indexOf("elements.previewEmpty.textContent = \"预览加载失败\";", failedPreviewIndex);
  const failedRevealIndex = app.indexOf("renderRevealButtonStates();", failedPreviewIndex);
  const revealStateIndex = app.indexOf("function renderRevealButtonStates()");
  const revealPendingIndex = app.indexOf("const revealPending = Boolean(state.revealPendingAssetId);", revealStateIndex);
  const revealPreviewIndex = app.indexOf("elements.revealPreviewButton.disabled = revealPending || !canRevealCurrentPreview();", revealStateIndex);
  const revealReportIndex = app.indexOf("elements.revealReportButton.disabled = revealPending || !state.reportPath;", revealStateIndex);
  const canRevealIndex = app.indexOf("function canRevealCurrentPreview()");

  assert.notEqual(setPreviewIndex, -1);
  assert.notEqual(removeVisibleIndex, -1);
  assert.notEqual(emptyVisibleIndex, -1);
  assert.notEqual(revealDisabledIndex, -1);
  assert.notEqual(altIndex, -1);
  assert.notEqual(loadIndex, -1);
  assert.notEqual(loadVisibleIndex, -1);
  assert.notEqual(loadEmptyHiddenIndex, -1);
  assert.notEqual(loadRevealIndex, -1);
  assert.notEqual(errorIndex, -1);
  assert.notEqual(errorHandlerIndex, -1);
  assert.notEqual(srcIndex, -1);
  assert.notEqual(helperIndex, -1);
  assert.notEqual(helperFailedPathIndex, -1);
  assert.notEqual(helperFailedPreviewIndex, -1);
  assert.notEqual(helperLogIndex, -1);
  assert.notEqual(helperPersistentIndex, -1);
  assert.notEqual(helperToastIndex, -1);
  assert.notEqual(failedPreviewIndex, -1);
  assert.notEqual(failedPreviewPathIndex, -1);
  assert.notEqual(failedTextIndex, -1);
  assert.notEqual(failedRevealIndex, -1);
  assert.notEqual(revealStateIndex, -1);
  assert.notEqual(revealPendingIndex, -1);
  assert.notEqual(revealPreviewIndex, -1);
  assert.notEqual(revealReportIndex, -1);
  assert.notEqual(canRevealIndex, -1);
  assert.ok(removeVisibleIndex < srcIndex);
  assert.ok(revealDisabledIndex < srcIndex);
  assert.ok(altIndex < srcIndex);
  assert.ok(loadVisibleIndex < loadRevealIndex);
  assert.ok(helperFailedPathIndex < helperFailedPreviewIndex);
  assert.ok(helperFailedPreviewIndex < helperLogIndex);
  assert.ok(failedPreviewPathIndex < failedRevealIndex);
});

test("renderer restores an active server job when the UI reloads", async () => {
  const app = await readFile(path.join(projectRoot, "ui", "public", "app.js"), "utf8");

  const bootIndex = app.indexOf("async function boot()");
  const restoreCallIndex = app.indexOf("const restored = await restoreActiveJob();", bootIndex);
  const renderEmptyIndex = app.indexOf("if (!restored) renderEmpty();", bootIndex);

  assert.notEqual(bootIndex, -1);
  assert.notEqual(restoreCallIndex, -1);
  assert.notEqual(renderEmptyIndex, -1);
  assert.ok(restoreCallIndex < renderEmptyIndex);
  assert.match(app, /async function restoreActiveJob\(\)/);
  assert.match(app, /apiGet\("\/api\/jobs"\)/);
  assert.match(app, /\["queued", "running"\]\.includes\(job\.status\)/);
  assert.match(app, /state\.currentJobId = activeJob\.id/);
  assert.match(app, /setBusy\(true\)/);
  assert.match(app, /startPolling\(\)/);
});

test("renderer restores the latest finished server job after reload", async () => {
  const app = await readFile(path.join(projectRoot, "ui", "public", "app.js"), "utf8");

  const restoreIndex = app.indexOf("async function restoreJobList(jobs)");
  const latestIndex = app.indexOf("const latestJob = jobs.at(-1);", restoreIndex);
  const renderIndex = app.indexOf("renderJob(latestJob);", restoreIndex);
  const detailIndex = app.indexOf("await loadFinalJobDetail(latestJob);", restoreIndex);
  const busyIndex = app.indexOf("setBusy(false);", restoreIndex);

  assert.notEqual(restoreIndex, -1);
  assert.notEqual(latestIndex, -1);
  assert.notEqual(detailIndex, -1);
  assert.notEqual(renderIndex, -1);
  assert.notEqual(busyIndex, -1);
  assert.ok(latestIndex < renderIndex);
  assert.ok(renderIndex < detailIndex);
});

test("renderer keeps the latest finished job visible while full reload detail retries", async () => {
  const app = await readFile(path.join(projectRoot, "ui", "public", "app.js"), "utf8");

  const restoreIndex = app.indexOf("async function restoreJobList(jobs)");
  const latestIndex = app.indexOf("const latestJob = jobs.at(-1);", restoreIndex);
  const currentJobIndex = app.indexOf("state.currentJob = latestJob;", latestIndex);
  const renderSnapshotIndex = app.indexOf("renderJob(latestJob);", latestIndex);
  const loadIndex = app.indexOf("await loadFinalJobDetail(latestJob);", latestIndex);
  const returnIndex = app.indexOf("return true;", loadIndex);
  const activeJobIndex = app.indexOf("state.currentJob = activeJob;", returnIndex);

  assert.notEqual(restoreIndex, -1);
  assert.notEqual(latestIndex, -1);
  assert.notEqual(currentJobIndex, -1);
  assert.notEqual(renderSnapshotIndex, -1);
  assert.notEqual(loadIndex, -1);
  assert.notEqual(returnIndex, -1);
  assert.notEqual(activeJobIndex, -1);
  assert.ok(latestIndex < currentJobIndex);
  assert.ok(currentJobIndex < renderSnapshotIndex);
  assert.ok(renderSnapshotIndex < loadIndex);
  assert.ok(loadIndex < returnIndex);
  assert.ok(returnIndex < activeJobIndex);
});

test("renderer does not keep polling when restored active job already finished", async () => {
  const app = await readFile(path.join(projectRoot, "ui", "public", "app.js"), "utf8");

  const restoreIndex = app.indexOf("async function restoreActiveJob()");
  const pollIndex = app.indexOf("const job = await pollJob();", restoreIndex);
  const finalGuardIndex = app.indexOf("if (!job || isFinal(job.status) || state.pollFailureCount > 0) return true;", restoreIndex);
  const startPollingIndex = app.indexOf("startPolling();", restoreIndex);
  const pollReturnIndex = app.indexOf("return response.job;", app.indexOf("async function pollJob()"));

  assert.notEqual(restoreIndex, -1);
  assert.notEqual(pollIndex, -1);
  assert.notEqual(finalGuardIndex, -1);
  assert.notEqual(startPollingIndex, -1);
  assert.notEqual(pollReturnIndex, -1);
  assert.ok(pollIndex < finalGuardIndex);
  assert.ok(finalGuardIndex < startPollingIndex);
});

test("renderer does not display queued jobs as idle", async () => {
  const app = await readFile(path.join(projectRoot, "ui", "public", "app.js"), "utf8");
  const css = await readFile(path.join(projectRoot, "ui", "public", "styles.css"), "utf8");
  const html = await readFile(path.join(projectRoot, "ui", "public", "index.html"), "utf8");

  assert.doesNotMatch(app, /if \(status === "queued"\) return "idle"/);
  assert.match(app, /if \(status === "queued"\) return "queued"/);
  assert.match(app, /queued:\s*"排队中"/);
  assert.match(css, /\.status-chip\.queued/);
  assert.match(html, /class="status-chip queued">排队中/);
});

test("UI muted helper text keeps AA contrast on raised surfaces", async () => {
  const css = await readFile(path.join(projectRoot, "ui", "public", "styles.css"), "utf8");

  const muted = cssVariable(css, "muted");
  const raised = cssVariable(css, "raised");
  const panel = cssVariable(css, "panel");

  assert.ok(contrastRatio(muted, raised) >= 4.5, `${muted} on ${raised} must meet 4.5:1`);
  assert.ok(contrastRatio(muted, panel) >= 4.5, `${muted} on ${panel} must meet 4.5:1`);
});

test("UI hard-wraps long failure text in logs, errors, toasts, and issue cards", async () => {
  const css = await readFile(path.join(projectRoot, "ui", "public", "styles.css"), "utf8");

  for (const selector of ["#jobLog", ".issue-card", ".error-panel", ".toast"]) {
    const block = cssBlock(css, selector);
    assert.match(block, /overflow-wrap:\s*anywhere/);
  }
});

test("mobile queue rows stack without requiring horizontal table scrolling", async () => {
  const app = await readFile(path.join(projectRoot, "ui", "public", "app.js"), "utf8");
  const css = await readFile(path.join(projectRoot, "ui", "public", "styles.css"), "utf8");
  const mobileIndex = css.indexOf("@media (max-width: 760px)");
  assert.notEqual(mobileIndex, -1);
  const mobileCss = css.slice(mobileIndex);

  assert.match(mobileCss, /table\s*\{[^}]*min-width:\s*0/s);
  assert.match(mobileCss, /thead\s*\{[^}]*display:\s*none/s);
  assert.match(mobileCss, /tbody tr\[data-input-key\]\s*\{[^}]*display:\s*grid/s);
  assert.match(mobileCss, /td::before\s*\{[^}]*content:\s*attr\(data-label\)/s);
  assert.match(mobileCss, /td:nth-child\(1\)::before\s*\{[^}]*content:\s*"状态"/s);
  assert.match(mobileCss, /td:nth-child\(2\)::before\s*\{[^}]*content:\s*"来源"/s);
  assert.match(mobileCss, /td:nth-child\(3\)::before\s*\{[^}]*content:\s*"问题"/s);
  assert.match(mobileCss, /td:nth-child\(4\)::before\s*\{[^}]*content:\s*"输出"/s);
  assert.match(mobileCss, /td:nth-child\(5\)::before\s*\{[^}]*content:\s*"操作"/s);
  assert.match(mobileCss, /td:nth-child\(2\) \.path-sub\s*\{[^}]*display:\s*none/s);
  assert.match(app, /function cellAriaLabel\(label, value\)/);
  assert.match(app, /data-label="状态" aria-label="\$\{escapeHtml\(cellAriaLabel\("状态", statusText\)\)\}"/);
  assert.match(app, /data-label="来源" aria-label="\$\{escapeHtml\(cellAriaLabel\("来源", sourceText\)\)\}"/);
  assert.match(app, /data-label="问题" aria-label="\$\{escapeHtml\(cellAriaLabel\("问题", issueText\)\)\}"/);
  assert.match(app, /const outputAriaText = outputAriaSummaryForItem\(item, outputText\);/);
  assert.match(app, /data-label="输出" aria-label="\$\{escapeHtml\(cellAriaLabel\("输出", outputAriaText\)\)\}"/);
  assert.match(app, /data-label="操作" aria-label="\$\{escapeHtml\(cellAriaLabel\("操作", actionSource\)\)\}"/);
  assert.doesNotMatch(app, /<td[^>]*data-label="来源"[^>]*aria-label="来源"/);
});

test("UI exposes clipped log retention metadata next to the log panel", async () => {
  const app = await readFile(path.join(projectRoot, "ui", "public", "app.js"), "utf8");
  const html = await readFile(path.join(projectRoot, "ui", "public", "index.html"), "utf8");
  const css = await readFile(path.join(projectRoot, "ui", "public", "styles.css"), "utf8");

  assert.match(html, /id="logRetentionNotice"/);
  assert.match(app, /logRetentionNotice:\s*\$\(("#logRetentionNotice"|'#logRetentionNotice')\)/);
  assert.match(app, /function renderLogRetentionNotice\(job, retainedLogCount\)/);
  assert.match(app, /仅显示最近 \$\{retainedLogCount\}\/\$\{totalLogs\} 条日志。/);
  assert.match(cssBlock(css, ".log-retention-notice"), /overflow-wrap:\s*anywhere/);
  assert.match(cssBlock(css, ".log-retention-notice[hidden]"), /display:\s*none/);
});

test("UI exposes the log panel as a keyboard-reachable labelled scroll region", async () => {
  const html = await readFile(path.join(projectRoot, "ui", "public", "index.html"), "utf8");

  const logIndex = html.indexOf("id=\"jobLog\"");
  const logTag = html.slice(logIndex, html.indexOf(">", logIndex));

  assert.notEqual(logIndex, -1);
  assert.match(logTag, /role="region"/);
  assert.match(logTag, /tabindex="0"/);
  assert.match(logTag, /aria-labelledby="logTitle"/);
});

test("renderer shows job-level failures before any item rows exist", async () => {
  const app = await readFile(path.join(projectRoot, "ui", "public", "app.js"), "utf8");

  const renderQueueIndex = app.indexOf("function renderQueue(job, selectedItem = null)");
  const emptyGuardIndex = app.indexOf("if (!items.length)", renderQueueIndex);
  const helperIndex = app.indexOf("renderEmptyJobRow(job);", emptyGuardIndex);
  const helperFunctionIndex = app.indexOf("function renderEmptyJobRow(job)");
  const errorIndex = app.indexOf("job.error", helperFunctionIndex);
  const statusIndex = app.indexOf("normalizeStatus(job.status)", helperFunctionIndex);
  const queuedCopyIndex = app.indexOf("\"已加入队列\"", helperFunctionIndex);
  const failedCopyIndex = app.indexOf("statusLabel(status)", helperFunctionIndex);

  assert.notEqual(renderQueueIndex, -1);
  assert.notEqual(emptyGuardIndex, -1);
  assert.notEqual(helperIndex, -1);
  assert.notEqual(helperFunctionIndex, -1);
  assert.notEqual(errorIndex, -1);
  assert.notEqual(statusIndex, -1);
  assert.notEqual(queuedCopyIndex, -1);
  assert.notEqual(failedCopyIndex, -1);
  assert.ok(emptyGuardIndex < helperIndex);
});

test("renderer polls lightweight job snapshots and fetches full detail only at final state", async () => {
  const app = await readFile(path.join(projectRoot, "ui", "public", "app.js"), "utf8");

  const pollIndex = app.indexOf("async function pollJob()");
  const pollEndpointIndex = app.indexOf("apiGet(`/api/jobs/${jobId}/poll`)", pollIndex);
  const finalIndex = app.indexOf("if (isFinal(response.job.status))", pollIndex);
  const finalDetailIndex = app.indexOf("return loadFinalJobDetail(response.job);", finalIndex);
  const detailFunctionIndex = app.indexOf("async function loadFinalJobDetail(snapshot)");
  const detailIndex = app.indexOf("const detail = await apiGet(`/api/jobs/${jobId}?full=1`);", detailFunctionIndex);
  const renderDetailIndex = app.indexOf("renderJob(detail.job);", detailFunctionIndex);

  assert.notEqual(pollIndex, -1);
  assert.notEqual(pollEndpointIndex, -1);
  assert.notEqual(finalIndex, -1);
  assert.notEqual(finalDetailIndex, -1);
  assert.notEqual(detailFunctionIndex, -1);
  assert.notEqual(detailIndex, -1);
  assert.notEqual(renderDetailIndex, -1);
  assert.ok(pollEndpointIndex < finalIndex);
  assert.ok(finalIndex < finalDetailIndex);
  assert.ok(detailIndex < renderDetailIndex);
});

test("renderer renders slim poll issue summaries before full reports arrive", async () => {
  const app = await readFile(path.join(projectRoot, "ui", "public", "app.js"), "utf8");

  const renderQcIndex = app.indexOf("function renderQc(selectedItem, job = null)");
  const selectedResultIndex = app.indexOf("const selectedResult = selectedItem?.result ?? null;", renderQcIndex);
  const summaryIndex = app.indexOf("const summary = selectedResult?.issueSummary;", renderQcIndex);
  const reportGuardIndex = app.indexOf("const hasReportAction = Boolean(selectedResult?.assets?.reportHtml);", renderQcIndex);
  const reportPathIndex = app.indexOf("const hasReportPath = Boolean(", renderQcIndex);
  const issuesIndex = app.indexOf("summary.issues.map", renderQcIndex);

  assert.notEqual(renderQcIndex, -1);
  assert.notEqual(selectedResultIndex, -1);
  assert.notEqual(summaryIndex, -1);
  assert.notEqual(reportGuardIndex, -1);
  assert.notEqual(reportPathIndex, -1);
  assert.notEqual(issuesIndex, -1);
  assert.ok(selectedResultIndex < summaryIndex);
  assert.ok(summaryIndex < reportGuardIndex);
  assert.ok(reportGuardIndex < reportPathIndex);
  assert.ok(summaryIndex < issuesIndex);
});

test("renderer explains bounded poll queue snapshots", async () => {
  const app = await readFile(path.join(projectRoot, "ui", "public", "app.js"), "utf8");

  assert.match(app, /job\.itemsOffset > 0/);
  assert.match(app, /仅显示最近/);
  assert.match(app, /完整交付文件和报告请在输出目录复核/);
  assert.doesNotMatch(app, /完整结果会在任务结束后载入/);
});

test("renderer keeps submission errors visible in the log", async () => {
  const app = await readFile(path.join(projectRoot, "ui", "public", "app.js"), "utf8");

  const startIndex = app.indexOf("async function startJob(dryRun)");
  const catchIndex = app.indexOf("} catch (error) {", startIndex);
  const logIndex = app.indexOf("renderLogLine(error.message, \"error\");", catchIndex);

  assert.notEqual(startIndex, -1);
  assert.notEqual(catchIndex, -1);
  assert.notEqual(logIndex, -1);
});

test("renderer keeps local validation errors visible beyond transient toast", async () => {
  const app = await readFile(path.join(projectRoot, "ui", "public", "app.js"), "utf8");

  const inputConstantIndex = app.indexOf("const MISSING_INPUT_MESSAGE = \"需要输入文件或文件夹路径。\";");
  const outDirConstantIndex = app.indexOf("const MISSING_OUTPUT_MESSAGE = \"需要输出文件夹路径。\";");
  const bindIndex = app.indexOf("function bindEvents()");
  const inputListenerIndex = app.indexOf("elements.inputPath.addEventListener(\"input\"", bindIndex);
  const inputClearIndex = app.indexOf("clearValidationErrorIfCurrent(MISSING_INPUT_MESSAGE", inputListenerIndex);
  const outDirListenerIndex = app.indexOf("elements.outDir.addEventListener(\"input\"", bindIndex);
  const outDirClearIndex = app.indexOf("clearValidationErrorIfCurrent(MISSING_OUTPUT_MESSAGE", outDirListenerIndex);
  const startIndex = app.indexOf("async function startJob(dryRun)");
  const inputGuardIndex = app.indexOf("if (!payload.input) {", startIndex);
  const inputReturnIndex = app.indexOf("return;", inputGuardIndex);
  const inputMessageIndex = app.indexOf("const message = MISSING_INPUT_MESSAGE;", inputGuardIndex);
  const inputBlock = app.slice(inputGuardIndex, inputReturnIndex);
  const inputPersistentIndex = inputBlock.indexOf("showPersistentError(message);");
  const inputInvalidIndex = inputBlock.indexOf("markFieldInvalid(elements.inputPath);");
  const focusIndex = app.indexOf("elements.inputPath.focus();", inputGuardIndex);
  const outDirMessageIndex = app.indexOf("const message = MISSING_OUTPUT_MESSAGE;", startIndex);
  const outDirReturnIndex = app.indexOf("return;", outDirMessageIndex);
  const outDirBlock = app.slice(outDirMessageIndex, outDirReturnIndex);
  const outDirPersistentIndex = outDirBlock.indexOf("showPersistentError(message);");
  const outDirInvalidIndex = outDirBlock.indexOf("markFieldInvalid(elements.outDir);");
  const clearHelperIndex = app.indexOf("function clearValidationErrorIfCurrent(message, corrected, field = null)");
  const clearFieldIndex = app.indexOf("clearFieldValidationError(field);", clearHelperIndex);

  assert.notEqual(inputConstantIndex, -1);
  assert.notEqual(outDirConstantIndex, -1);
  assert.notEqual(bindIndex, -1);
  assert.notEqual(inputListenerIndex, -1);
  assert.notEqual(inputClearIndex, -1);
  assert.notEqual(outDirListenerIndex, -1);
  assert.notEqual(outDirClearIndex, -1);
  assert.notEqual(startIndex, -1);
  assert.notEqual(inputGuardIndex, -1);
  assert.notEqual(inputReturnIndex, -1);
  assert.notEqual(inputMessageIndex, -1);
  assert.notEqual(inputPersistentIndex, -1);
  assert.notEqual(inputInvalidIndex, -1);
  assert.notEqual(focusIndex, -1);
  assert.notEqual(outDirMessageIndex, -1);
  assert.notEqual(outDirReturnIndex, -1);
  assert.notEqual(outDirPersistentIndex, -1);
  assert.notEqual(outDirInvalidIndex, -1);
  assert.notEqual(clearHelperIndex, -1);
  assert.notEqual(clearFieldIndex, -1);
  assert.ok(inputListenerIndex < startIndex);
  assert.ok(outDirListenerIndex < startIndex);
  assert.ok(clearHelperIndex > startIndex);
});

test("renderer exposes persistent actionable errors separately from transient toast", async () => {
  const html = await readFile(path.join(projectRoot, "ui", "public", "index.html"), "utf8");
  const app = await readFile(path.join(projectRoot, "ui", "public", "app.js"), "utf8");
  const css = await readFile(path.join(projectRoot, "ui", "public", "styles.css"), "utf8");

  assert.match(html, /id="errorPanel"/);
  assert.match(html, /role="alert"/);
  assert.match(html, /aria-live="assertive"/);
  assert.match(app, /errorPanel: \$\("#errorPanel"\)/);
  assert.match(app, /function showPersistentError\(message\)/);
  assert.match(app, /function clearPersistentError\(\)/);
  assert.match(css, /\.error-panel/);
});

test("UI exposes a dedicated polite live region for job progress", async () => {
  const html = await readFile(path.join(projectRoot, "ui", "public", "index.html"), "utf8");
  const css = await readFile(path.join(projectRoot, "ui", "public", "styles.css"), "utf8");

  const announcerIndex = html.indexOf("id=\"jobStatusAnnouncer\"");
  const toastIndex = html.indexOf("id=\"toast\"");
  const announcerTag = html.slice(announcerIndex, html.indexOf(">", announcerIndex));
  const srOnlyIndex = css.indexOf(".sr-only");
  const srOnlyBlock = cssBlock(css, ".sr-only");

  assert.notEqual(announcerIndex, -1);
  assert.notEqual(toastIndex, -1);
  assert.ok(announcerIndex < toastIndex);
  assert.match(announcerTag, /class="sr-only"/);
  assert.match(announcerTag, /role="status"/);
  assert.match(announcerTag, /aria-live="polite"/);
  assert.match(announcerTag, /aria-atomic="true"/);
  assert.notEqual(srOnlyIndex, -1);
  assert.match(srOnlyBlock, /position:\s*absolute/);
  assert.match(srOnlyBlock, /clip:\s*rect\(0 0 0 0\)/);
  assert.doesNotMatch(srOnlyBlock, /display:\s*none/);
});

test("toast remains visual-only so errors are not announced twice", async () => {
  const html = await readFile(path.join(projectRoot, "ui", "public", "index.html"), "utf8");

  const toastIndex = html.indexOf("id=\"toast\"");
  const toastTag = html.slice(toastIndex, html.indexOf(">", toastIndex));

  assert.notEqual(toastIndex, -1);
  assert.doesNotMatch(toastTag, /role=/);
  assert.doesNotMatch(toastTag, /aria-live=/);
});

test("renderer announces deduped job progress summaries", async () => {
  const app = await readFile(path.join(projectRoot, "ui", "public", "app.js"), "utf8");

  const stateIndex = app.indexOf("lastProgressAnnouncementKey");
  const elementIndex = app.indexOf("jobStatusAnnouncer: $(\"#jobStatusAnnouncer\")");
  const renderJobIndex = app.indexOf("function renderJob(job)");
  const announceCallIndex = app.indexOf("announceJobProgress(job);", renderJobIndex);
  const helperIndex = app.indexOf("function announceJobProgress(job)");
  const keyIndex = app.indexOf("const key = jobProgressAnnouncementKey(job);", helperIndex);
  const dedupeIndex = app.indexOf("if (key === state.lastProgressAnnouncementKey) return;", helperIndex);
  const updateKeyIndex = app.indexOf("state.lastProgressAnnouncementKey = key;", dedupeIndex);
  const textIndex = app.indexOf("elements.jobStatusAnnouncer.textContent", updateKeyIndex);
  const summaryIndex = app.indexOf("function jobProgressAnnouncement(job)");
  const stageIndex = app.indexOf("stageLabel(job.currentStage)", summaryIndex);
  const countIndex = app.indexOf("job.completed ?? 0", summaryIndex);
  const finalIndex = app.indexOf("job.passed ?? 0", summaryIndex);

  assert.notEqual(stateIndex, -1);
  assert.notEqual(elementIndex, -1);
  assert.notEqual(renderJobIndex, -1);
  assert.notEqual(announceCallIndex, -1);
  assert.notEqual(helperIndex, -1);
  assert.notEqual(keyIndex, -1);
  assert.notEqual(dedupeIndex, -1);
  assert.notEqual(updateKeyIndex, -1);
  assert.notEqual(textIndex, -1);
  assert.notEqual(summaryIndex, -1);
  assert.notEqual(stageIndex, -1);
  assert.notEqual(countIndex, -1);
  assert.notEqual(finalIndex, -1);
  assert.ok(renderJobIndex < announceCallIndex);
  assert.ok(keyIndex < dedupeIndex);
  assert.ok(dedupeIndex < updateKeyIndex);
  assert.ok(updateKeyIndex < textIndex);
});

test("renderer progress announcement keys do not re-announce omitted stage state", async () => {
  const app = await readFile(path.join(projectRoot, "ui", "public", "app.js"), "utf8");

  const keyIndex = app.indexOf("function jobProgressAnnouncementKey(job)");
  const summaryIndex = app.indexOf("function jobProgressAnnouncement(job)", keyIndex);
  const keyBody = app.slice(keyIndex, summaryIndex);

  assert.notEqual(keyIndex, -1);
  assert.notEqual(summaryIndex, -1);
  assert.doesNotMatch(keyBody, /stage\.state/);
});

test("renderer keeps reveal failures visible beyond transient toast", async () => {
  const app = await readFile(path.join(projectRoot, "ui", "public", "app.js"), "utf8");

  const revealIndex = app.indexOf("async function revealPath(assetId)");
  const catchIndex = app.indexOf("} catch (error) {", revealIndex);
  const persistentIndex = app.indexOf("showTransientError(error.message);", catchIndex);
  const logIndex = app.indexOf("renderLogLine(error.message, \"error\");", catchIndex);
  const toastIndex = app.indexOf("showToast(error.message);", catchIndex);

  assert.notEqual(revealIndex, -1);
  assert.notEqual(catchIndex, -1);
  assert.notEqual(persistentIndex, -1);
  assert.notEqual(logIndex, -1);
  assert.notEqual(toastIndex, -1);
  assert.ok(catchIndex < persistentIndex);
  assert.ok(catchIndex < logIndex);
  assert.ok(catchIndex < toastIndex);
});

test("renderer keeps job store persistence failures visible across successful responses", async () => {
  const app = await readFile(path.join(projectRoot, "ui", "public", "app.js"), "utf8");

  assert.match(app, /persistenceError:\s*""/);
  assert.match(app, /function handlePersistence\(persistence\)/);
  assert.match(app, /任务恢复记录无法写入/);
  assert.match(app, /showPersistentError\(state\.persistenceError\)/);
  assert.match(app, /function clearTransientError\(\)/);
  assert.match(app, /function showTransientError\(message\)/);
  assert.match(app, /if \(state\.persistenceError\)/);
  assert.match(app, /`\$\{state\.persistenceError\}\\n\$\{message\}`/);
  assert.match(app, /handlePersistence\(payload\.persistence\)/);
  assert.doesNotMatch(app, /state\.pollFailureCount = 0;\n\s*clearPersistentError\(\);/);
  assert.doesNotMatch(app, /catch \(error\) \{\n\s*showPersistentError\(error\.message\);/);
});

test("renderer maps malformed API responses to a localized bridge error", async () => {
  const app = await readFile(path.join(projectRoot, "ui", "public", "app.js"), "utf8");

  const parseIndex = app.indexOf("async function parseResponse(response)");
  const textIndex = app.indexOf("const raw = await response.text();", parseIndex);
  const tryIndex = app.indexOf("try {", textIndex);
  const jsonIndex = app.indexOf("JSON.parse(raw)", tryIndex);
  const catchIndex = app.indexOf("} catch (error) {", tryIndex);
  const consoleIndex = app.indexOf("console.error", catchIndex);
  const messageIndex = app.indexOf("本地桥接返回了无法识别的响应。请重试或重启应用。", catchIndex);
  const rawJsonIndex = app.indexOf("await response.json()", parseIndex);

  assert.notEqual(parseIndex, -1);
  assert.notEqual(textIndex, -1);
  assert.notEqual(tryIndex, -1);
  assert.notEqual(jsonIndex, -1);
  assert.notEqual(catchIndex, -1);
  assert.notEqual(consoleIndex, -1);
  assert.notEqual(messageIndex, -1);
  assert.equal(rawJsonIndex, -1);
  assert.ok(parseIndex < textIndex);
  assert.ok(textIndex < tryIndex);
  assert.ok(tryIndex < jsonIndex);
  assert.ok(jsonIndex < catchIndex);
  assert.ok(catchIndex < messageIndex);
});

test("renderer keeps HTTP status on API errors for recoverable UI races", async () => {
  const app = await readFile(path.join(projectRoot, "ui", "public", "app.js"), "utf8");

  const parseIndex = app.indexOf("async function parseResponse(response)");
  const errorBranchIndex = app.indexOf("if (!response.ok || payload.ok === false)", parseIndex);
  const errorIndex = app.indexOf(
    "const apiError = new Error(sanitizeDisplayMessage(payload.error || `HTTP ${response.status}`));",
    errorBranchIndex,
  );
  const statusIndex = app.indexOf("apiError.status = response.status;", errorIndex);
  const throwIndex = app.indexOf("throw apiError;", statusIndex);
  const rawThrowIndex = app.indexOf("throw new Error(payload.error || `HTTP ${response.status}`);", errorBranchIndex);

  assert.notEqual(parseIndex, -1);
  assert.notEqual(errorBranchIndex, -1);
  assert.notEqual(errorIndex, -1);
  assert.notEqual(statusIndex, -1);
  assert.notEqual(throwIndex, -1);
  assert.equal(rawThrowIndex, -1);
  assert.ok(errorBranchIndex < errorIndex);
  assert.ok(errorIndex < statusIndex);
  assert.ok(statusIndex < throwIndex);
});

test("renderer retries poll failures without unlocking an active job", async () => {
  const app = await readFile(path.join(projectRoot, "ui", "public", "app.js"), "utf8");

  const pollIndex = app.indexOf("async function pollJob()");
  const catchIndex = app.indexOf("} catch (error) {", pollIndex);
  const retryGuardIndex = app.indexOf("if (shouldRetryPoll())", catchIndex);
  const retryIndex = app.indexOf("schedulePollRetry(error);", catchIndex);
  const retryFunctionIndex = app.indexOf("function schedulePollRetry(error)");
  const shouldRetryIndex = app.indexOf("function shouldRetryPoll()");
  const busyIndex = app.indexOf("setBusy(true);", retryFunctionIndex);
  const persistentIndex = app.indexOf("showPersistentError", retryFunctionIndex);
  const timeoutIndex = app.indexOf("state.pollTimer = setTimeout(() => {", retryFunctionIndex);
  const timeoutPollIndex = app.indexOf("pollJob();", timeoutIndex);

  assert.notEqual(pollIndex, -1);
  assert.notEqual(catchIndex, -1);
  assert.notEqual(retryGuardIndex, -1);
  assert.notEqual(retryIndex, -1);
  assert.notEqual(retryFunctionIndex, -1);
  assert.notEqual(shouldRetryIndex, -1);
  assert.notEqual(busyIndex, -1);
  assert.notEqual(persistentIndex, -1);
  assert.notEqual(timeoutIndex, -1);
  assert.notEqual(timeoutPollIndex, -1);
  assert.ok(retryGuardIndex < retryIndex);
});

test("renderer resumes interval polling after a retry succeeds with an active job", async () => {
  const app = await readFile(path.join(projectRoot, "ui", "public", "app.js"), "utf8");

  const pollIndex = app.indexOf("async function pollJob()");
  const successIndex = app.indexOf("const response = await apiGet(`/api/jobs/${jobId}/poll`);", pollIndex);
  const resumeIndex = app.indexOf("resumePollingAfterRetry(response.job);", successIndex);
  const finalIndex = app.indexOf("if (isFinal(response.job.status))", successIndex);
  const resumeFunctionIndex = app.indexOf("function resumePollingAfterRetry(job)");
  const activeGuardIndex = app.indexOf("if (isFinal(job.status) || state.pollFailureCount === 0) return;", resumeFunctionIndex);
  const startIndex = app.indexOf("startPolling();", resumeFunctionIndex);
  const startFunctionIndex = app.indexOf("function startPolling()");
  const clearTimerIndex = app.indexOf("clearPollTimer();", startFunctionIndex);
  const intervalIndex = app.indexOf("state.pollTimer = setInterval(pollJob, 1000);", clearTimerIndex);
  const timeoutWrapperIndex = app.indexOf("state.pollTimer = setTimeout(() => {", app.indexOf("function schedulePollRetry(error)"));
  const clearBeforePollIndex = app.indexOf("state.pollTimer = null;", timeoutWrapperIndex);
  const retryPollIndex = app.indexOf("pollJob();", clearBeforePollIndex);

  assert.notEqual(pollIndex, -1);
  assert.notEqual(successIndex, -1);
  assert.notEqual(resumeIndex, -1);
  assert.notEqual(finalIndex, -1);
  assert.notEqual(resumeFunctionIndex, -1);
  assert.notEqual(activeGuardIndex, -1);
  assert.notEqual(startIndex, -1);
  assert.notEqual(startFunctionIndex, -1);
  assert.notEqual(clearTimerIndex, -1);
  assert.notEqual(intervalIndex, -1);
  assert.notEqual(timeoutWrapperIndex, -1);
  assert.notEqual(clearBeforePollIndex, -1);
  assert.notEqual(retryPollIndex, -1);
  assert.ok(successIndex < resumeIndex);
  assert.ok(resumeIndex < finalIndex);
  assert.ok(activeGuardIndex < startIndex);
  assert.ok(clearTimerIndex < intervalIndex);
  assert.ok(clearBeforePollIndex < retryPollIndex);
});

test("renderer retries final detail fetch failures after a final poll snapshot", async () => {
  const app = await readFile(path.join(projectRoot, "ui", "public", "app.js"), "utf8");

  const pollIndex = app.indexOf("async function pollJob()");
  const finalIndex = app.indexOf("if (isFinal(response.job.status))", pollIndex);
  const finalDetailIndex = app.indexOf("return loadFinalJobDetail(response.job);", finalIndex);
  const detailFunctionIndex = app.indexOf("async function loadFinalJobDetail(snapshot)");
  const detailGetIndex = app.indexOf("const detail = await apiGet(`/api/jobs/${jobId}?full=1`);", detailFunctionIndex);
  const detailRetryIndex = app.indexOf("scheduleFinalDetailRetry(error, snapshot, jobId);", detailFunctionIndex);
  const retryFunctionIndex = app.indexOf("function scheduleFinalDetailRetry(error, snapshot, jobId)");
  const retryMessageIndex = app.indexOf("完整报告暂时无法加载", retryFunctionIndex);
  const timeoutIndex = app.indexOf("state.pollTimer = setTimeout(() => {", retryFunctionIndex);
  const guardIndex = app.indexOf("if (state.currentJobId === jobId)", timeoutIndex);
  const reloadIndex = app.indexOf("loadFinalJobDetail(snapshot);", guardIndex);

  assert.notEqual(pollIndex, -1);
  assert.notEqual(finalIndex, -1);
  assert.notEqual(finalDetailIndex, -1);
  assert.notEqual(detailFunctionIndex, -1);
  assert.notEqual(detailGetIndex, -1);
  assert.notEqual(detailRetryIndex, -1);
  assert.notEqual(retryFunctionIndex, -1);
  assert.notEqual(retryMessageIndex, -1);
  assert.notEqual(timeoutIndex, -1);
  assert.notEqual(guardIndex, -1);
  assert.notEqual(reloadIndex, -1);
  assert.ok(finalIndex < finalDetailIndex);
  assert.ok(detailGetIndex < detailRetryIndex);
  assert.ok(guardIndex < reloadIndex);
});

test("renderer serializes polling so slow responses cannot overlap", async () => {
  const app = await readFile(path.join(projectRoot, "ui", "public", "app.js"), "utf8");

  const pollIndex = app.indexOf("async function pollJob()");
  const guardIndex = app.indexOf("if (state.pollInFlightJobId === jobId) return state.currentJob ?? null;", pollIndex);
  const setIndex = app.indexOf("state.pollInFlightJobId = jobId;", pollIndex);
  const finallyIndex = app.indexOf("} finally {", pollIndex);
  const clearGuardIndex = app.indexOf("if (state.pollInFlightJobId === jobId)", finallyIndex);
  const clearIndex = app.indexOf("state.pollInFlightJobId = null;", clearGuardIndex);
  const stateIndex = app.indexOf("pollInFlightJobId: null");

  assert.notEqual(stateIndex, -1);
  assert.notEqual(pollIndex, -1);
  assert.notEqual(guardIndex, -1);
  assert.notEqual(setIndex, -1);
  assert.notEqual(finallyIndex, -1);
  assert.notEqual(clearGuardIndex, -1);
  assert.notEqual(clearIndex, -1);
  assert.ok(guardIndex < setIndex);
  assert.ok(setIndex < finallyIndex);
  assert.ok(clearGuardIndex < clearIndex);
});

test("renderer ignores poll responses for jobs that are no longer selected", async () => {
  const app = await readFile(path.join(projectRoot, "ui", "public", "app.js"), "utf8");

  const pollIndex = app.indexOf("async function pollJob()");
  const jobIdIndex = app.indexOf("const jobId = state.currentJobId;", pollIndex);
  const fetchIndex = app.indexOf("apiGet(`/api/jobs/${jobId}/poll`)", jobIdIndex);
  const staleGuardIndex = app.indexOf("if (state.currentJobId !== jobId || response.job?.id !== jobId) return state.currentJob ?? null;", fetchIndex);
  const renderIndex = app.indexOf("renderJob(response.job);", staleGuardIndex);
  const catchIndex = app.indexOf("} catch (error) {", renderIndex);
  const catchGuardIndex = app.indexOf("if (state.currentJobId !== jobId) return state.currentJob ?? null;", catchIndex);
  const retryIndex = app.indexOf("schedulePollRetry(error);", catchGuardIndex);

  assert.notEqual(pollIndex, -1);
  assert.notEqual(jobIdIndex, -1);
  assert.notEqual(fetchIndex, -1);
  assert.notEqual(staleGuardIndex, -1);
  assert.notEqual(renderIndex, -1);
  assert.notEqual(catchIndex, -1);
  assert.notEqual(catchGuardIndex, -1);
  assert.notEqual(retryIndex, -1);
  assert.ok(jobIdIndex < fetchIndex);
  assert.ok(fetchIndex < staleGuardIndex);
  assert.ok(staleGuardIndex < renderIndex);
  assert.ok(catchIndex < catchGuardIndex);
  assert.ok(catchGuardIndex < retryIndex);
});

test("drop zone keyboard interaction is not a fake focus target", async () => {
  const html = await readFile(path.join(projectRoot, "ui", "public", "index.html"), "utf8");
  const app = await readFile(path.join(projectRoot, "ui", "public", "app.js"), "utf8");

  assert.match(html, /id="dropZone"[^>]*role="button"/);
  assert.match(html, /id="dropZone"[^>]*aria-label="选择或拖入输入视频"/);
  assert.match(app, /elements\.dropZone\.addEventListener\("keydown"/);
  assert.match(app, /pickPrimaryInputPath\(\)/);
  assert.match(app, /event\.key === "Enter" \|\| event\.key === " "/);
});

test("drop zone explains unsupported drops without a readable local path", async () => {
  const app = await readFile(path.join(projectRoot, "ui", "public", "app.js"), "utf8");

  const dropIndex = app.indexOf("elements.dropZone.addEventListener(\"drop\"");
  const helperCallIndex = app.indexOf("handleDroppedInput(file);", dropIndex);
  const helperIndex = app.indexOf("function handleDroppedInput(file)");
  const pathIndex = app.indexOf("if (file?.path)", helperIndex);
  const dispatchIndex = app.indexOf("elements.inputPath.dispatchEvent(new Event(\"input\", { bubbles: true }));", pathIndex);
  const messageIndex = app.indexOf("const message = file?.name", helperIndex);
  const persistentIndex = app.indexOf("showTransientError(message);", messageIndex);
  const logIndex = app.indexOf("renderLogLine(message, \"error\");", messageIndex);
  const toastIndex = app.indexOf("showToast(message);", messageIndex);

  assert.notEqual(dropIndex, -1);
  assert.notEqual(helperCallIndex, -1);
  assert.notEqual(helperIndex, -1);
  assert.notEqual(pathIndex, -1);
  assert.notEqual(dispatchIndex, -1);
  assert.notEqual(messageIndex, -1);
  assert.notEqual(persistentIndex, -1);
  assert.notEqual(logIndex, -1);
  assert.notEqual(toastIndex, -1);
  assert.ok(dropIndex < helperCallIndex);
  assert.ok(helperIndex < pathIndex);
  assert.ok(pathIndex < dispatchIndex);
  assert.ok(messageIndex < persistentIndex);
  assert.ok(messageIndex < logIndex);
  assert.ok(messageIndex < toastIndex);
});

test("processing motion respects reduced motion preferences", async () => {
  const css = await readFile(path.join(projectRoot, "ui", "public", "styles.css"), "utf8");

  const mediaIndex = css.indexOf("@media (prefers-reduced-motion: reduce)");
  const chipIndex = css.indexOf(".status-chip.processing", mediaIndex);
  const animationIndex = css.indexOf("animation: none;", chipIndex);

  assert.notEqual(mediaIndex, -1);
  assert.notEqual(chipIndex, -1);
  assert.notEqual(animationIndex, -1);
  assert.ok(mediaIndex < chipIndex);
  assert.ok(chipIndex < animationIndex);
});

function cssVariable(css, name) {
  const match = css.match(new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})`));
  assert.ok(match, `Missing CSS variable --${name}`);
  return match[1];
}

function cssBlock(css, selector) {
  const escapedSelector = selector.replaceAll(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = css.match(new RegExp(`${escapedSelector}\\s*\\{([^}]*)\\}`));
  assert.ok(match, `Missing CSS block ${selector}`);
  return match[1];
}

function contrastRatio(foreground, background) {
  const [lighter, darker] = [relativeLuminance(foreground), relativeLuminance(background)].sort((a, b) => b - a);
  return (lighter + 0.05) / (darker + 0.05);
}

function relativeLuminance(hex) {
  const [r, g, b] = hex.match(/[0-9a-fA-F]{2}/g).map((pair) => {
    const value = Number.parseInt(pair, 16) / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function listenRaw(server) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve(server));
  });
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
