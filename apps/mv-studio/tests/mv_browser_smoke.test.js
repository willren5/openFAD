const assert = require('node:assert/strict');
const childProcess = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { pathToFileURL } = require('node:url');

const htmlPath = path.join(__dirname, '..', 'index.html');

function loadPlaywright() {
  try {
    return require('playwright');
  } catch (err) {
    return null;
  }
}

const playwright = loadPlaywright();

const tinyPng = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAvxEc8QAAAABJRU5ErkJggg==',
  'base64'
);

const tinyRealFlac = Buffer.from(
  'ZkxhQwAAACICQAJAAAANAAANAfQBcAAAAFDOpn/65iDmQQ7QWQ3G7JuShAAADgYAAABmZm1wZWcAAAAA//hkDABPogAAAADWWA==',
  'base64'
);

function tinyWav({ sampleRate = 8000, durationSec = 0.25, frequency = 440 } = {}) {
  const samples = Math.max(1, Math.floor(sampleRate * durationSec));
  const dataBytes = samples * 2;
  const buffer = Buffer.alloc(44 + dataBytes);
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + dataBytes, 4);
  buffer.write('WAVE', 8);
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(dataBytes, 40);
  for (let i = 0; i < samples; i += 1) {
    const sample = Math.round(Math.sin((2 * Math.PI * frequency * i) / sampleRate) * 0.22 * 32767);
    buffer.writeInt16LE(sample, 44 + i * 2);
  }
  return buffer;
}

function wavHeaderOnly({ sampleRate = 48000, durationSec = 300, channels = 6, bitsPerSample = 16 } = {}) {
  const bytesPerSample = bitsPerSample / 8;
  const declaredSamples = Math.max(1, Math.floor(sampleRate * durationSec));
  const dataBytes = declaredSamples * channels * bytesPerSample;
  const buffer = Buffer.alloc(44);
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + dataBytes, 4);
  buffer.write('WAVE', 8);
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(channels, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * channels * bytesPerSample, 28);
  buffer.writeUInt16LE(channels * bytesPerSample, 32);
  buffer.writeUInt16LE(bitsPerSample, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(dataBytes, 40);
  return buffer;
}

function extensibleWavHeaderOnly({ sampleRate = 48000, durationSec = 300, channels = 6, bitsPerSample = 16, subFormat = 1 } = {}) {
  const bytesPerSample = bitsPerSample / 8;
  const declaredSamples = Math.max(1, Math.floor(sampleRate * durationSec));
  const dataBytes = declaredSamples * channels * bytesPerSample;
  const buffer = Buffer.alloc(68);
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(60 + dataBytes, 4);
  buffer.write('WAVE', 8);
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(40, 16);
  buffer.writeUInt16LE(0xfffe, 20);
  buffer.writeUInt16LE(channels, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * channels * bytesPerSample, 28);
  buffer.writeUInt16LE(channels * bytesPerSample, 32);
  buffer.writeUInt16LE(bitsPerSample, 34);
  buffer.writeUInt16LE(22, 36);
  buffer.writeUInt16LE(bitsPerSample, 38);
  buffer.writeUInt32LE(0, 40);
  buffer.writeUInt32LE(subFormat, 44);
  buffer.writeUInt16LE(0, 48);
  buffer.writeUInt16LE(0x0010, 50);
  buffer.writeUInt8(0x80, 52);
  buffer.writeUInt8(0x00, 53);
  buffer.writeUInt8(0x00, 54);
  buffer.writeUInt8(0xaa, 55);
  buffer.writeUInt8(0x00, 56);
  buffer.writeUInt8(0x38, 57);
  buffer.writeUInt8(0x9b, 58);
  buffer.writeUInt8(0x71, 59);
  buffer.write('data', 60);
  buffer.writeUInt32LE(dataBytes, 64);
  return buffer;
}

function filePayload(name, mimeType, buffer) {
  return { name, mimeType, buffer };
}

function appHref({ pro = true, testHooks = false } = {}) {
  const url = new URL(pathToFileURL(htmlPath).href);
  if (pro) url.searchParams.set('pro', '1');
  if (testHooks) url.searchParams.set('test', '1');
  return url.href;
}

async function gotoApp(page, options = {}) {
  await page.goto(appHref(options), { waitUntil: 'load' });
}

async function setBrowserFile(page, selector, { name, mimeType, buffer, lastModified }) {
  await page.evaluate(({ selector: inputSelector, name: fileName, mimeType: type, bytes, lastModified: mtime }) => {
    const input = document.querySelector(inputSelector);
    if (!input) throw new Error(`缺失 input ${inputSelector}`);
    const file = new File([new Uint8Array(bytes)], fileName, { type, lastModified: mtime });
    const transfer = new DataTransfer();
    transfer.items.add(file);
    input.files = transfer.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }, {
    selector,
    name,
    mimeType,
    bytes: Array.from(buffer),
    lastModified
  });
}

async function setProjectFields(page, fields = {}) {
  await page.evaluate((next) => {
    const textMap = {
      song: 'in-song',
      artist: 'in-artist',
      label: 'in-label'
    };
    Object.entries(textMap).forEach(([key, id]) => {
      if (!Object.prototype.hasOwnProperty.call(next, key)) return;
      const el = document.getElementById(id);
      if (!el) return;
      el.value = next[key] || '';
      el.dispatchEvent(new Event('input', { bubbles: true }));
    });
    if (Object.prototype.hasOwnProperty.call(next, 'fontName')) {
      const font = document.getElementById('in-font');
      if (font) {
        font.value = next.fontName || '';
        font.dispatchEvent(new Event('change', { bubbles: true }));
      }
    }
  }, fields);
}

async function saveSnapshotViaUi(page, expectedSong = '') {
  await page.click('#btn-save-snapshot');
  await page.waitForFunction((song) => {
    const status = document.querySelector('#status-text')?.textContent || '';
    const recent = Array.from(document.querySelector('#recent-projects')?.options || []).map((option) => option.textContent || '').join(' | ');
    const saving = !!window.AutoSave?.status?.saving;
    const hasExpectedRecent = !song || recent.includes(song);
    const statusConfirmed = /快照已保存|已自动保存/.test(status);
    return !saving && hasExpectedRecent && (statusConfirmed || !!song);
  }, expectedSong);
}

async function restoreLatestViaUi(page, expectedSong = '') {
  await page.click('#btn-restore-latest');
  await page.waitForFunction((song) => {
    const status = document.querySelector('#status-text')?.textContent || '';
    return /快照已恢复/.test(status) && (!song || window.Store?.snapshot?.meta?.song === song);
  }, expectedSong);
}

function crc32(buffer) {
  let crc = 0xFFFFFFFF;
  for (const byte of buffer) {
    crc ^= byte;
    for (let i = 0; i < 8; i += 1) {
      crc = (crc >>> 1) ^ ((crc & 1) ? 0xEDB88320 : 0);
    }
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

function zipStored(entries) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;
  const writeU16 = (buffer, at, value) => buffer.writeUInt16LE(value, at);
  const writeU32 = (buffer, at, value) => buffer.writeUInt32LE(value >>> 0, at);

  for (const entry of entries) {
    const nameBytes = Buffer.from(entry.path, 'utf8');
    const data = Buffer.from(entry.data);
    const local = Buffer.alloc(30 + nameBytes.length);
    const checksum = crc32(data);
    writeU32(local, 0, 0x04034B50);
    writeU16(local, 4, 20);
    writeU16(local, 6, 0x0800);
    writeU16(local, 8, 0);
    writeU16(local, 10, 0);
    writeU16(local, 12, 0);
    writeU32(local, 14, checksum);
    writeU32(local, 18, data.length);
    writeU32(local, 22, data.length);
    writeU16(local, 26, nameBytes.length);
    writeU16(local, 28, 0);
    nameBytes.copy(local, 30);
    localParts.push(local, data);

    const central = Buffer.alloc(46 + nameBytes.length);
    writeU32(central, 0, 0x02014B50);
    writeU16(central, 4, 20);
    writeU16(central, 6, 20);
    writeU16(central, 8, 0x0800);
    writeU16(central, 10, 0);
    writeU16(central, 12, 0);
    writeU16(central, 14, 0);
    writeU32(central, 16, checksum);
    writeU32(central, 20, data.length);
    writeU32(central, 24, data.length);
    writeU16(central, 28, nameBytes.length);
    writeU16(central, 30, 0);
    writeU16(central, 32, 0);
    writeU16(central, 34, 0);
    writeU16(central, 36, 0);
    writeU32(central, 38, 0);
    writeU32(central, 42, offset);
    nameBytes.copy(central, 46);
    centralParts.push(central);
    offset += local.length + data.length;
  }

  const centralSize = centralParts.reduce((sum, part) => sum + part.length, 0);
  const end = Buffer.alloc(22);
  writeU32(end, 0, 0x06054B50);
  writeU16(end, 4, 0);
  writeU16(end, 6, 0);
  writeU16(end, 8, entries.length);
  writeU16(end, 10, entries.length);
  writeU32(end, 12, centralSize);
  writeU32(end, 16, offset);
  writeU16(end, 20, 0);
  return Buffer.concat([...localParts, ...centralParts, end]);
}

function fadmvPackage(project, assets = {}) {
  const entries = [{ path: 'project.json', data: Buffer.from(JSON.stringify(project), 'utf8') }];
  for (const [assetPath, data] of Object.entries(assets)) entries.push({ path: assetPath, data });
  return zipStored(entries);
}

function tinyMp3Frame({ mono = false, frames = 1 } = {}) {
  const channelMode = mono ? 0xc0 : 0x40;
  const frameLength = 417;
  const frame = Buffer.alloc(frameLength);
  Buffer.from([0xff, 0xfb, 0x90, channelMode]).copy(frame, 0);
  return Buffer.concat(Array.from({ length: Math.max(1, frames) }, () => Buffer.from(frame)));
}

function id3v2Tag(payloadSize = 32) {
  const size = Math.max(0, payloadSize);
  return Buffer.concat([
    Buffer.from([
      0x49, 0x44, 0x33,
      0x04, 0x00, 0x00,
      (size >> 21) & 0x7f,
      (size >> 14) & 0x7f,
      (size >> 7) & 0x7f,
      size & 0x7f
    ]),
    Buffer.alloc(size)
  ]);
}

function flacStreamInfo({ sampleRate = 44100, channels = 2, bitsPerSample = 16, durationSec = 180, totalSamples = null } = {}) {
  const sampleCount = totalSamples == null ? Math.max(1, Math.floor(sampleRate * durationSec)) : Math.max(0, totalSamples);
  const buffer = Buffer.alloc(4 + 4 + 34);
  buffer.write('fLaC', 0);
  buffer[4] = 0x80;
  buffer[5] = 0x00;
  buffer[6] = 0x00;
  buffer[7] = 34;
  const info = 8;
  buffer.writeUInt16BE(4096, info);
  buffer.writeUInt16BE(4096, info + 2);
  buffer[info + 4] = 0;
  buffer[info + 5] = 0;
  buffer[info + 6] = 0;
  buffer[info + 7] = 0;
  buffer[info + 8] = 0;
  buffer[info + 9] = 0;
  buffer[info + 10] = (sampleRate >> 12) & 0xff;
  buffer[info + 11] = (sampleRate >> 4) & 0xff;
  buffer[info + 12] = ((sampleRate & 0x0f) << 4) | (((channels - 1) & 0x07) << 1) | (((bitsPerSample - 1) >> 4) & 0x01);
  buffer[info + 13] = (((bitsPerSample - 1) & 0x0f) << 4) | Math.floor(sampleCount / 0x100000000);
  buffer.writeUInt32BE(sampleCount >>> 0, info + 14);
  return buffer;
}

function realFlacBuffer(durationSec = 0.25) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fad-mv-flac-'));
  const out = path.join(dir, 'tone.flac');
  try {
    childProcess.execFileSync('ffmpeg', [
      '-hide_banner',
      '-loglevel', 'error',
      '-f', 'lavfi',
      '-i', `sine=frequency=440:duration=${durationSec}:sample_rate=44100`,
      '-ac', '2',
      '-c:a', 'flac',
      out
    ]);
    return fs.readFileSync(out);
  } catch (_) {
    return Buffer.from(tinyRealFlac);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function waitForDownloads(page, count, timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    const downloads = [];
    let timer = null;
    const cleanup = () => {
      clearTimeout(timer);
      page.off('download', onDownload);
    };
    const onDownload = (download) => {
      downloads.push(download);
      if (downloads.length >= count) {
        cleanup();
        resolve(downloads);
      }
    };
    timer = setTimeout(() => {
      cleanup();
      reject(new Error(`Timed out waiting for ${count} downloads; saw ${downloads.length}`));
    }, timeoutMs);
    page.on('download', onDownload);
  });
}

test('browser boot smoke loads index.html and exposes only safe public runtime facades', { skip: !playwright && 'Bundled Playwright unavailable' }, async (t) => {
  assert.ok(fs.existsSync(htmlPath), 'index.html should exist');
  const browser = await playwright.chromium.launch({ headless: true });
  t.after(() => browser.close());

  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const consoleErrors = [];
  const pageErrors = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('pageerror', (err) => pageErrors.push(err.message));

  await gotoApp(page);
  await page.waitForFunction(() => document.readyState === 'complete');

  const smoke = await page.evaluate(() => {
    const canvas = document.querySelector('#cvs');
    const text = (selector) => document.querySelector(selector)?.textContent?.trim().replace(/\s+/g, ' ') || '';
    const publicApi = {
      machine: {
        type: typeof window.Machine,
        status: window.Machine?.status,
        transition: typeof window.Machine?.transition,
        forceIdle: typeof window.Machine?.forceIdle
      },
      store: {
        type: typeof window.Store,
        frozen: Object.isFrozen(window.Store),
        flags: typeof window.Store?.flags,
        locks: typeof window.Store?.locks,
        snapshot: typeof window.Store?.snapshot
      },
      ui: {
        showWarning: typeof window.UI?.showWarning,
        warnings: typeof window.UI?.warnings,
        clearWarnings: typeof window.UI?.clearWarnings,
        dismissError: typeof window.UI?.dismissError
      },
      browserStorage: {
        type: typeof window.BrowserStorage
      },
      projectPresets: {
        type: typeof window.ProjectPresets,
        importState: typeof window.ProjectPresets?.importState,
        withLockedControlMutation: typeof window.ProjectPresets?.withLockedControlMutation,
        downloadProject: typeof window.ProjectPresets?.downloadProject
      },
      assetManager: {
        type: typeof window.AssetManager,
        loadFile: typeof window.AssetManager?.loadFile,
        status: typeof window.AssetManager?.status
      },
      packageApi: {
        currentPackageToken: typeof window.ProjectPackage?.currentPackageToken,
        finishPackageJob: typeof window.ProjectPackage?.finishPackageJob,
        downloadPackage: typeof window.ProjectPackage?.downloadPackage,
        importPackageFile: typeof window.ProjectPackage?.importPackageFile,
        retryPackageDownload: typeof window.ProjectPackage?.retryPackageDownload,
        cancel: typeof window.ProjectPackage?.cancel
      },
      autosave: {
        saveSnapshot: typeof window.AutoSave?.saveSnapshot,
        restoreLatest: typeof window.AutoSave?.restoreLatest,
        refreshRecent: typeof window.AutoSave?.refreshRecent
      },
      renderReport: {
        downloadReport: typeof window.RenderReport?.downloadReport,
        retryExportDownload: typeof window.RenderReport?.retryExportDownload,
        snapshot: typeof window.RenderReport?.snapshot
      },
      customPresets: {
        saveCurrent: typeof window.CustomPresets?.saveCurrent,
        applySelected: typeof window.CustomPresets?.applySelected,
        deleteSelected: typeof window.CustomPresets?.deleteSelected,
        selected: typeof window.CustomPresets?.selected
      },
      batch: {
        renderNext: typeof window.BatchQueue?.renderNext,
        start: typeof window.BatchQueue?.start,
        addFiles: typeof window.BatchQueue?.addFiles,
        requestCancel: typeof window.BatchQueue?.requestCancel,
        retryDownload: typeof window.BatchQueue?.retryDownload,
        clear: typeof window.BatchQueue?.clear,
        status: typeof window.BatchQueue?.status
      },
      brandPresets: {
        applyPreset: typeof window.BrandPresets?.applyPreset,
        names: typeof window.BrandPresets?.names
      },
      audioAnalysis: {
        analyzeCurrentFile: typeof window.AudioAnalysis?.analyzeCurrentFile,
        cancelAnalysis: typeof window.AudioAnalysis?.cancelAnalysis,
        status: typeof window.AudioAnalysis?.status
      },
      recorder: {
        cleanup: typeof window.Recorder?.cleanup,
        resolveSaveWaiters: typeof window.Recorder?.resolveSaveWaiters,
        saveWaiters: typeof window.Recorder?._saveWaiters,
        start: typeof window.Recorder?.start,
        finish: typeof window.Recorder?.finish,
        requestAbort: typeof window.Recorder?.requestAbort,
        togglePreview: typeof window.Recorder?.togglePreview,
        status: typeof window.Recorder?.status
      },
      engine: {
        resetRenderMetrics: typeof window.Engine?.resetRenderMetrics,
        resetTimelineBase: typeof window.Engine?.resetTimelineBase,
        checkReady: typeof window.Engine?.checkReady,
        triggerUpdate: typeof window.Engine?.triggerUpdate,
        startLoop: typeof window.Engine?.startLoop,
        diagnostics: typeof window.Engine?.diagnostics
      },
      audioEngine: {
        setRoute: typeof window.AudioEngine?.setRoute,
        status: typeof window.AudioEngine?.status
      }
    };
    return {
      readyState: document.readyState,
      title: document.title,
      fatalOpen: document.querySelector('#error-overlay')?.style.display === 'flex',
      canvas: canvas ? {
        width: canvas.width,
        height: canvas.height,
        clientWidth: Math.round(canvas.getBoundingClientRect().width),
        clientHeight: Math.round(canvas.getBoundingClientRect().height),
        ariaLabel: canvas.getAttribute('aria-label'),
        describedBy: canvas.getAttribute('aria-describedby'),
        summary: document.querySelector('#canvas-summary')?.textContent?.trim() || ''
      } : null,
      landmarks: {
        sidebar: !!document.querySelector('aside.sidebar[aria-labelledby="app-title"]'),
        preview: !!document.querySelector('main.viewport[aria-labelledby="preview-title"]')
      },
      summaries: {
        preflight: text('#preflight-summary'),
        custom: text('#custom-preset-summary'),
        package: text('#package-summary'),
        batch: text('#batch-summary')
      },
      controls: {
        preview: !!document.querySelector('#btn-preview'),
        record: !!document.querySelector('#btn-rec'),
        abort: !!document.querySelector('#btn-abort')
      },
      publicApi
    };
  });

  assert.deepEqual(pageErrors, []);
  assert.deepEqual(consoleErrors, []);
  assert.equal(smoke.readyState, 'complete');
  assert.equal(smoke.title, 'openFAD MV Studio — 制作一段音乐视觉');
  assert.equal(smoke.fatalOpen, false);
  assert.equal(smoke.canvas.width, 1080);
  assert.equal(smoke.canvas.height, 1920);
  assert.ok(smoke.canvas.clientWidth > 0);
  assert.ok(smoke.canvas.clientHeight > 0);
  assert.match(smoke.canvas.ariaLabel, /openFAD 视觉预览：未命名曲目 \/ 未知艺人/);
  assert.equal(smoke.canvas.describedBy, 'canvas-summary');
  assert.match(smoke.canvas.summary, /背景图缺失/);
  assert.match(smoke.canvas.summary, /状态：准备就绪/);
  assert.deepEqual(smoke.landmarks, { sidebar: true, preview: true });
  assert.match(smoke.summaries.preflight, /需要检查|素材齐了，可以导出/);
  assert.match(smoke.summaries.custom, /选择预设|自定义预设/);
  assert.match(smoke.summaries.package, /可导出|导出已阻止|项目文件/);
  assert.match(smoke.summaries.batch, /可以添加音频|添加音频暂不可用/);
  assert.deepEqual(smoke.controls, { preview: true, record: true, abort: true });

  assert.equal(smoke.publicApi.machine.type, 'object');
  assert.equal(smoke.publicApi.machine.transition, 'undefined');
  assert.equal(smoke.publicApi.machine.forceIdle, 'undefined');
  assert.equal(smoke.publicApi.store.frozen, true);
  assert.equal(smoke.publicApi.store.flags, 'undefined');
  assert.equal(smoke.publicApi.store.locks, 'object');
  assert.equal(smoke.publicApi.store.snapshot, 'object');
  assert.equal(smoke.publicApi.ui.showWarning, 'undefined');
  assert.equal(smoke.publicApi.ui.warnings, 'object');
  assert.equal(smoke.publicApi.ui.clearWarnings, 'undefined');
  assert.equal(smoke.publicApi.ui.dismissError, 'undefined');
  assert.equal(smoke.publicApi.browserStorage.type, 'undefined');
  assert.equal(smoke.publicApi.projectPresets.importState, 'undefined');
  assert.equal(smoke.publicApi.projectPresets.withLockedControlMutation, 'undefined');
  assert.equal(smoke.publicApi.projectPresets.downloadProject, 'undefined');
  assert.equal(smoke.publicApi.assetManager.loadFile, 'undefined');
  assert.equal(smoke.publicApi.assetManager.status, 'object');
  assert.equal(smoke.publicApi.packageApi.currentPackageToken, 'undefined');
  assert.equal(smoke.publicApi.packageApi.finishPackageJob, 'undefined');
  assert.equal(smoke.publicApi.packageApi.downloadPackage, 'undefined');
  assert.equal(smoke.publicApi.packageApi.importPackageFile, 'undefined');
  assert.equal(smoke.publicApi.packageApi.retryPackageDownload, 'undefined');
  assert.equal(smoke.publicApi.packageApi.cancel, 'undefined');
  assert.equal(smoke.publicApi.autosave.saveSnapshot, 'undefined');
  assert.equal(smoke.publicApi.autosave.restoreLatest, 'undefined');
  assert.equal(smoke.publicApi.autosave.refreshRecent, 'undefined');
  assert.equal(smoke.publicApi.renderReport.downloadReport, 'undefined');
  assert.equal(smoke.publicApi.renderReport.retryExportDownload, 'undefined');
  assert.equal(smoke.publicApi.renderReport.snapshot, 'object');
  assert.equal(smoke.publicApi.customPresets.saveCurrent, 'undefined');
  assert.equal(smoke.publicApi.customPresets.applySelected, 'undefined');
  assert.equal(smoke.publicApi.customPresets.deleteSelected, 'undefined');
  assert.equal(smoke.publicApi.customPresets.selected, 'object');
  assert.equal(smoke.publicApi.batch.renderNext, 'undefined');
  assert.equal(smoke.publicApi.batch.start, 'undefined');
  assert.equal(smoke.publicApi.batch.addFiles, 'undefined');
  assert.equal(smoke.publicApi.batch.requestCancel, 'undefined');
  assert.equal(smoke.publicApi.batch.retryDownload, 'undefined');
  assert.equal(smoke.publicApi.batch.clear, 'undefined');
  assert.equal(smoke.publicApi.batch.status, 'object');
  assert.equal(smoke.publicApi.brandPresets.applyPreset, 'undefined');
  assert.equal(smoke.publicApi.brandPresets.names, 'object');
  assert.equal(smoke.publicApi.audioAnalysis.analyzeCurrentFile, 'undefined');
  assert.equal(smoke.publicApi.audioAnalysis.cancelAnalysis, 'undefined');
  assert.equal(smoke.publicApi.audioAnalysis.status, 'object');
  assert.equal(smoke.publicApi.recorder.cleanup, 'undefined');
  assert.equal(smoke.publicApi.recorder.resolveSaveWaiters, 'undefined');
  assert.equal(smoke.publicApi.recorder.saveWaiters, 'undefined');
  assert.equal(smoke.publicApi.recorder.start, 'undefined');
  assert.equal(smoke.publicApi.recorder.finish, 'undefined');
  assert.equal(smoke.publicApi.recorder.requestAbort, 'undefined');
  assert.equal(smoke.publicApi.recorder.togglePreview, 'undefined');
  assert.equal(smoke.publicApi.recorder.status, 'object');
  assert.equal(smoke.publicApi.engine.resetRenderMetrics, 'undefined');
  assert.equal(smoke.publicApi.engine.resetTimelineBase, 'undefined');
  assert.equal(smoke.publicApi.engine.checkReady, 'undefined');
  assert.equal(smoke.publicApi.engine.triggerUpdate, 'undefined');
  assert.equal(smoke.publicApi.engine.startLoop, 'undefined');
  assert.equal(smoke.publicApi.engine.diagnostics, 'object');
  assert.equal(smoke.publicApi.audioEngine.setRoute, 'undefined');
  assert.equal(smoke.publicApi.audioEngine.status, 'object');
});

test('Start Mode demo loads a public-safe project and visual systems update the renderer', { skip: !playwright && 'Bundled Playwright unavailable' }, async (t) => {
  assert.ok(fs.existsSync(htmlPath), 'index.html should exist');
  const browser = await playwright.chromium.launch({ headless: true });
  t.after(() => browser.close());

  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const consoleErrors = [];
  const pageErrors = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('pageerror', (err) => pageErrors.push(err.message));

  await gotoApp(page, { pro: false });
  await page.waitForFunction(() => document.readyState === 'complete');

  const startMode = await page.evaluate(() => ({
    title: document.querySelector('#app-title')?.textContent?.replace(/\s+/g, ' ').trim() || '',
    subtitle: document.querySelector('#app-subtitle')?.textContent?.trim() || '',
    demoText: document.querySelector('#btn-load-demo')?.textContent?.trim() || '',
    uploadText: document.querySelector('#btn-upload-audio')?.textContent?.trim() || '',
    previewText: document.querySelector('#btn-preview')?.textContent?.trim() || '',
    exportText: document.querySelector('#btn-rec')?.textContent?.trim() || '',
	    visualButtons: Array.from(document.querySelectorAll('.visual-system-picker button')).map((button) => ({
	      id: button.id,
	      text: button.textContent.trim(),
	      pressed: button.getAttribute('aria-pressed')
	    })),
	    visualSummary: document.querySelector('#visual-system-summary')?.textContent?.trim() || '',
	    proExpanded: document.querySelector('#btn-toggle-pro')?.getAttribute('aria-expanded') || '',
	    advancedVisible: !!document.querySelector('#advanced-visual-section')?.offsetParent,
	    visualOrder: {
	      quickGuide: document.querySelector('.quick-guide')?.getBoundingClientRect().top ?? -1,
	      assetInputs: document.querySelector('#asset-input-summary')?.closest('.section')?.getBoundingClientRect().top ?? -1,
	      metadata: document.querySelector('#in-song')?.closest('.section')?.getBoundingClientRect().top ?? -1,
	      preflight: document.querySelector('#preflight-summary')?.closest('.section')?.getBoundingClientRect().top ?? -1,
	      proToggle: document.querySelector('#btn-toggle-pro')?.getBoundingClientRect().top ?? -1
	    }
	  }));

  await page.click('#btn-load-demo');
  await page.waitForFunction(() => {
    const status = window.AssetManager?.status || {};
    return ['cover', 'video', 'audio', 'logo'].every((type) => status[type]?.valid === true)
      && /素材齐了，可以导出/.test(document.querySelector('#preflight-summary')?.textContent || '');
  });

  const demoState = await page.evaluate(() => ({
    assets: window.AssetManager.status,
    snapshot: window.Store.snapshot,
    preflight: document.querySelector('#preflight-summary')?.textContent?.trim() || '',
    assetSummary: document.querySelector('#asset-input-summary')?.textContent?.trim() || '',
    previewDisabled: document.querySelector('#btn-preview')?.disabled,
    exportDisabled: document.querySelector('#btn-rec')?.disabled,
    statusText: document.querySelector('#status-text')?.textContent?.trim() || ''
  }));

  await page.click('#btn-visual-logo');
  const logoSystem = await page.evaluate(() => ({
    visualSummary: document.querySelector('#visual-system-summary')?.textContent?.trim() || '',
    coverPressed: document.querySelector('#btn-visual-cover')?.getAttribute('aria-pressed'),
    logoPressed: document.querySelector('#btn-visual-logo')?.getAttribute('aria-pressed'),
    logoActive: document.querySelector('#btn-visual-logo')?.classList.contains('active'),
    logoSize: document.querySelector('#out-logo-size')?.textContent?.trim() || '',
    sensitivity: document.querySelector('#out-sensitivity')?.textContent?.trim() || '',
    glitch: document.querySelector('#in-glitch')?.checked,
    snapshot: window.Store.snapshot
  }));

  assert.match(startMode.title, /制作一段音乐视觉/);
  assert.match(startMode.title, /openFAD MV Studio/);
  assert.match(startMode.subtitle, /纯浏览器处理的中文 MV 制作工具/);
  assert.match(startMode.demoText, /打开示例/);
  assert.match(startMode.uploadText, /上传音频/);
  assert.match(startMode.previewText, /预览/);
  assert.match(startMode.exportText, /导出视频/);
  assert.equal(startMode.proExpanded, 'false');
  assert.equal(startMode.advancedVisible, false);
  assert.ok(startMode.visualOrder.quickGuide > 0, 'quick guide should have a measured visual position');
  assert.ok(startMode.visualOrder.quickGuide < startMode.visualOrder.assetInputs, 'quick guide should precede asset inputs');
  assert.ok(startMode.visualOrder.assetInputs < startMode.visualOrder.metadata, 'asset inputs should precede metadata');
  assert.ok(startMode.visualOrder.metadata < startMode.visualOrder.preflight, 'metadata should precede preflight');
  assert.ok(startMode.visualOrder.preflight < startMode.visualOrder.proToggle, 'preflight should precede Pro Mode disclosure');
  assert.deepEqual(startMode.visualButtons.map((button) => button.text), ['唱片封面视觉', '频谱视觉', '极简 Logo 视觉']);
  assert.deepEqual(startMode.visualButtons.map((button) => button.pressed), ['true', 'false', 'false']);
  assert.match(startMode.visualSummary, /当前视觉系统：唱片封面视觉/);

  assert.equal(demoState.assets.cover.valid, true);
  assert.equal(demoState.assets.video.valid, true);
  assert.equal(demoState.assets.logo.valid, true);
  assert.equal(demoState.assets.audio.valid, true);
  assert.match(demoState.assets.cover.name, /openfad-demo-cover\.svg/);
  assert.match(demoState.assets.audio.name, /openfad-demo-audio\.wav/);
  assert.equal(demoState.snapshot.meta.song, 'OPENFAD DEMO LOOP');
  assert.equal(demoState.snapshot.meta.artist, 'openFAD');
  assert.match(demoState.preflight, /素材齐了，可以导出/);
  assert.match(demoState.assetSummary, /素材就绪/);
  assert.equal(demoState.previewDisabled, false);
  assert.equal(demoState.exportDisabled, false);
  assert.match(demoState.statusText, /示例已打开|Demo ready/);

  assert.match(logoSystem.visualSummary, /极简 Logo 视觉/);
  assert.equal(logoSystem.coverPressed, 'false');
  assert.equal(logoSystem.logoPressed, 'true');
  assert.equal(logoSystem.logoActive, true);
  assert.equal(logoSystem.logoSize, '260 px');
  assert.equal(logoSystem.sensitivity, '82%');
  assert.equal(logoSystem.glitch, false);
  assert.equal(logoSystem.snapshot.config.glitch, false);
  assert.equal(logoSystem.snapshot.config.visSensitivity, 0.82);
  assert.deepEqual(pageErrors, []);
  assert.deepEqual(consoleErrors, []);
});

test('fatal dialog traps keyboard focus and Escape dismisses it after boot failure', { skip: !playwright && 'Bundled Playwright unavailable' }, async (t) => {
  assert.ok(fs.existsSync(htmlPath), 'index.html should exist');
  const browser = await playwright.chromium.launch({ headless: true });
  t.after(() => browser.close());

  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const consoleErrors = [];
  const pageErrors = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('pageerror', (err) => pageErrors.push(err.message));
  await page.addInitScript(() => {
    const originalGetContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function getContext(type, ...args) {
      if (type === '2d') return null;
      return originalGetContext.call(this, type, ...args);
    };
  });

  await gotoApp(page);
  await page.waitForFunction(() => document.querySelector('#error-overlay')?.style.display === 'flex');

  const openState = await page.evaluate(() => ({
    fatalOpen: document.querySelector('#error-overlay')?.style.display === 'flex',
    message: document.querySelector('#err-msg')?.textContent || '',
    activeId: document.activeElement?.id || '',
    sidebarHidden: document.querySelector('.sidebar')?.getAttribute('aria-hidden'),
    viewportHidden: document.querySelector('.viewport')?.getAttribute('aria-hidden')
  }));

  await page.keyboard.press('Tab');
  const afterFirstTabActiveId = await page.evaluate(() => document.activeElement?.id || '');
  await page.keyboard.press('Tab');
  const afterSecondTabActiveId = await page.evaluate(() => document.activeElement?.id || '');
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => document.querySelector('#error-overlay')?.style.display === 'none');
  const closedState = await page.evaluate(() => ({
    fatalOpen: document.querySelector('#error-overlay')?.style.display === 'flex',
    sidebarHidden: document.querySelector('.sidebar')?.getAttribute('aria-hidden'),
    viewportHidden: document.querySelector('.viewport')?.getAttribute('aria-hidden')
  }));
  await page.setInputFiles('#in-cover', filePayload('cover.png', 'image/png', tinyPng));
  await page.waitForFunction(() => window.AssetManager?.status?.cover?.valid === true);
  await page.setInputFiles('#in-logo', filePayload('logo.png', 'image/png', tinyPng));
  await page.waitForFunction(() => window.AssetManager?.status?.logo?.valid === true);
  await page.setInputFiles('#in-video', filePayload('center.png', 'image/png', tinyPng));
  await page.waitForFunction(() => window.AssetManager?.status?.video?.valid === true);
  await page.setInputFiles('#in-audio', filePayload('tone.wav', 'audio/wav', tinyWav()));
  await page.waitForFunction(() => window.AssetManager?.status?.audio?.valid === true);
  const postDismissReadiness = await page.evaluate(() => ({
	    preflight: document.querySelector('#preflight-summary')?.textContent?.trim() || '',
	    statusLive: document.querySelector('#status-live')?.textContent?.trim() || '',
	    assetSummaryRole: document.querySelector('#asset-input-summary')?.getAttribute('role') || '',
	    preflightRole: document.querySelector('#preflight-summary')?.getAttribute('role') || '',
	    preflightLive: document.querySelector('#preflight-summary')?.getAttribute('aria-live') || '',
	    readiness: window.Preflight.getRenderReadiness(),
    recordDisabled: document.querySelector('#btn-rec')?.disabled,
    previewDisabled: document.querySelector('#btn-preview')?.disabled,
    recordReason: document.querySelector('#btn-rec')?.dataset.disabledReason || '',
    previewReason: document.querySelector('#btn-preview')?.dataset.disabledReason || '',
    statusText: document.querySelector('#status-text')?.textContent?.trim() || ''
  }));
  const canvasImportProject = {
    schemaVersion: 1,
    meta: { song: 'Broken Canvas Import', artist: 'Recovery Artist', label: 'Recovered Label' },
    config: { recordFps: 60, videoBps: 12_000_000, fontName: 'Orbitron' },
    layout: { gradientHeight: 0.42, logoWidth: 220 }
  };
  await page.setInputFiles('#in-project-file', filePayload('broken-canvas.fad-mv.json', 'application/json', Buffer.from(JSON.stringify(canvasImportProject))));
  await page.waitForFunction(() => window.Store?.snapshot?.meta?.song === 'BROKEN CANVAS IMPORT');
  const canvasFailureImport = await page.evaluate(() => {
    const snapshot = window.Store.snapshot;
    const readiness = window.Preflight.getRenderReadiness();
    return {
      threw: false,
      song: snapshot.meta.song,
      artist: snapshot.meta.artist,
      label: snapshot.meta.label,
      recordFps: snapshot.config.recordFps,
      logoWidth: snapshot.layout.logoWidth,
      gradientHeight: snapshot.layout.gradientHeight,
      recordReady: readiness.recordReady,
      recordReason: readiness.recordReason
    };
  });

  assert.deepEqual(pageErrors, []);
  assert.ok(consoleErrors.some((message) => message.includes('[openFAD][FATAL] Canvas 2D context unavailable')));
  assert.equal(openState.fatalOpen, true);
  assert.equal(openState.message, 'Canvas 2D context unavailable');
  assert.equal(openState.activeId, 'btn-err-reset');
  assert.equal(openState.sidebarHidden, 'true');
  assert.equal(openState.viewportHidden, 'true');
  assert.equal(afterFirstTabActiveId, 'err-msg');
  assert.equal(afterSecondTabActiveId, 'btn-err-reset');
  assert.equal(closedState.fatalOpen, false);
  assert.equal(closedState.sidebarHidden, 'false');
  assert.equal(closedState.viewportHidden, 'false');
  assert.match(postDismissReadiness.preflight, /需要检查/);
  assert.match(postDismissReadiness.preflight, /Canvas 2D context unavailable|Rendering engine unavailable/);
  assert.equal(postDismissReadiness.readiness.recordReady, false);
  assert.equal(postDismissReadiness.recordDisabled, true);
  assert.equal(postDismissReadiness.previewDisabled, true);
  assert.match(postDismissReadiness.recordReason, /Canvas 2D context unavailable|Rendering engine unavailable/);
  assert.match(postDismissReadiness.previewReason, /Canvas 2D context unavailable|Rendering engine unavailable/);
  assert.notEqual(postDismissReadiness.statusText, 'READY: VISUALIZER MODE');
  assert.equal(canvasFailureImport.threw, false);
  assert.equal(canvasFailureImport.song, 'BROKEN CANVAS IMPORT');
  assert.equal(canvasFailureImport.artist, 'Recovery Artist');
  assert.equal(canvasFailureImport.label, 'Recovered Label');
  assert.equal(canvasFailureImport.recordFps, 60);
  assert.equal(canvasFailureImport.logoWidth, 220);
  assert.equal(canvasFailureImport.gradientHeight, 0.42);
  assert.equal(canvasFailureImport.recordReady, false);
  assert.match(canvasFailureImport.recordReason, /Canvas 2D context unavailable|Rendering engine unavailable/);
});

test('fatal dialog keeps long mobile errors and reset action reachable', { skip: !playwright && 'Bundled Playwright unavailable' }, async (t) => {
  assert.ok(fs.existsSync(htmlPath), 'index.html should exist');
  const browser = await playwright.chromium.launch({ headless: true });
  t.after(() => browser.close());

  const page = await browser.newPage({ viewport: { width: 390, height: 520 }, isMobile: true });
  const consoleErrors = [];
  const pageErrors = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('pageerror', (err) => pageErrors.push(err.message));
  await page.addInitScript(() => {
    const longTail = Array.from({ length: 420 }, (_, index) => `diagnostic-${index}`).join(' ');
    const originalGetContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function getContext(type, ...args) {
      if (type === '2d') throw new Error(`Canvas bootstrap failed with long diagnostics ${longTail}`);
      return originalGetContext.call(this, type, ...args);
    };
  });

  await gotoApp(page);
  await page.waitForFunction(() => document.querySelector('#error-overlay')?.style.display === 'flex');

  const geometry = await page.evaluate(() => {
    const rect = (selector) => {
      const el = document.querySelector(selector);
      if (!el) return null;
      const box = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      return {
        top: box.top,
        bottom: box.bottom,
        height: box.height,
        width: box.width,
        overflowY: style.overflowY,
        clientHeight: el.clientHeight,
        scrollHeight: el.scrollHeight
      };
    };
    const reset = rect('#btn-err-reset');
    const box = rect('.err-box');
    const msg = rect('#err-msg');
    return {
      viewportHeight: window.innerHeight,
      overlay: rect('#error-overlay'),
      box,
      msg,
      reset,
      activeId: document.activeElement?.id || '',
      resetVisible: !!reset && reset.top >= 0 && reset.bottom <= window.innerHeight,
      boxFits: !!box && box.top >= 0 && box.bottom <= window.innerHeight
    };
  });

  assert.equal(geometry.activeId, 'btn-err-reset');
  assert.equal(geometry.resetVisible, true, `RESET button should be visible in mobile viewport: ${JSON.stringify(geometry)}`);
  assert.equal(geometry.boxFits, true, `Fatal dialog should fit in mobile viewport: ${JSON.stringify(geometry)}`);
  assert.ok(geometry.box.height <= geometry.viewportHeight, `Fatal dialog should not exceed viewport height: ${JSON.stringify(geometry)}`);
  assert.match(geometry.box.overflowY, /auto|scroll/);
  assert.match(geometry.msg.overflowY, /auto|scroll/);
  assert.deepEqual(pageErrors, []);
  assert.ok(consoleErrors.some((message) => message.includes('[openFAD][FATAL] 启动失败：Canvas bootstrap failed with long diagnostics')));
  await page.close();
});

test('fatal dialog long diagnostics are keyboard-scrollable', { skip: !playwright && 'Bundled Playwright unavailable' }, async (t) => {
  assert.ok(fs.existsSync(htmlPath), 'index.html should exist');
  const browser = await playwright.chromium.launch({ headless: true });
  t.after(() => browser.close());

  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const consoleErrors = [];
  const pageErrors = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('pageerror', (err) => pageErrors.push(err.message));
  await page.addInitScript(() => {
    const longTail = Array.from({ length: 520 }, (_, index) => `diagnostic-${index}`).join(' ');
    const originalGetContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function getContext(type, ...args) {
      if (type === '2d') throw new Error(`Canvas bootstrap failed with long diagnostics ${longTail}`);
      return originalGetContext.call(this, type, ...args);
    };
  });

  await gotoApp(page);
  await page.waitForFunction(() => document.querySelector('#error-overlay')?.style.display === 'flex');

  const before = await page.evaluate(() => ({
    activeId: document.activeElement?.id || '',
    msgTabIndex: document.querySelector('#err-msg')?.tabIndex,
    msgScrollTop: document.querySelector('#err-msg')?.scrollTop || 0,
    msgClientHeight: document.querySelector('#err-msg')?.clientHeight || 0,
    msgScrollHeight: document.querySelector('#err-msg')?.scrollHeight || 0
  }));
  await page.keyboard.press('Tab');
  const focusedId = await page.evaluate(() => document.activeElement?.id || '');
  await page.waitForFunction(() => document.activeElement?.id === 'err-msg');
  await page.keyboard.press('PageDown');
  await page.waitForFunction(() => (document.querySelector('#err-msg')?.scrollTop || 0) > 0);
  const after = await page.evaluate(() => ({
    msgScrollTop: document.querySelector('#err-msg')?.scrollTop || 0
  }));

  assert.equal(before.activeId, 'btn-err-reset');
  assert.equal(before.msgTabIndex, 0);
  assert.ok(before.msgScrollHeight > before.msgClientHeight, `Diagnostic text should overflow for keyboard scroll coverage: ${JSON.stringify(before)}`);
  assert.equal(focusedId, 'err-msg');
  assert.ok(after.msgScrollTop > before.msgScrollTop, `PageDown should scroll fatal diagnostics: before=${JSON.stringify(before)} after=${JSON.stringify(after)}`);
  assert.deepEqual(pageErrors, []);
  assert.ok(consoleErrors.some((message) => message.includes('[openFAD][FATAL] 启动失败：Canvas bootstrap failed with long diagnostics')));
  await page.close();
});

test('auxiliary render cache context failures block preview and render preflight', { skip: !playwright && 'Bundled Playwright unavailable' }, async (t) => {
  assert.ok(fs.existsSync(htmlPath), 'index.html should exist');
  const browser = await playwright.chromium.launch({ headless: true });
  t.after(() => browser.close());

  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const consoleErrors = [];
  const pageErrors = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('pageerror', (err) => pageErrors.push(err.message));
  await page.addInitScript(() => {
    localStorage.setItem('fad-mv-autosave', '0');
    const originalGetContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function getContext(type, ...args) {
      if (type === '2d' && this.id !== 'cvs') return null;
      return originalGetContext.call(this, type, ...args);
    };
  });

  await gotoApp(page);
  await page.waitForFunction(() => document.readyState === 'complete');
  await page.setInputFiles('#in-cover', filePayload('cover.png', 'image/png', tinyPng));
  await page.waitForFunction(() => window.AssetManager?.status?.cover?.valid === true);
  await page.setInputFiles('#in-logo', filePayload('logo.png', 'image/png', tinyPng));
  await page.waitForFunction(() => window.AssetManager?.status?.logo?.valid === true);
  await page.setInputFiles('#in-video', filePayload('center.png', 'image/png', tinyPng));
  await page.waitForFunction(() => window.AssetManager?.status?.video?.valid === true);
  await page.setInputFiles('#in-audio', filePayload('tone.wav', 'audio/wav', tinyWav()));
  await page.waitForFunction(() => window.AssetManager?.status?.audio?.valid === true);

  const state = await page.evaluate(() => ({
    readiness: window.Preflight.getRenderReadiness(),
    preflight: document.querySelector('#preflight-summary')?.textContent?.trim() || '',
    recordDisabled: document.querySelector('#btn-rec')?.disabled,
    previewDisabled: document.querySelector('#btn-preview')?.disabled,
    recordReason: document.querySelector('#btn-rec')?.dataset.disabledReason || '',
    previewReason: document.querySelector('#btn-preview')?.dataset.disabledReason || '',
    statusText: document.querySelector('#status-text')?.textContent?.trim() || ''
  }));

  assert.deepEqual(pageErrors, []);
  assert.deepEqual(consoleErrors, []);
  assert.equal(state.readiness.recordReady, false);
  assert.equal(state.readiness.previewReady, false);
  assert.equal(state.recordDisabled, true);
  assert.equal(state.previewDisabled, true);
  assert.match(state.readiness.recordReason, /Render cache unavailable/);
  assert.match(state.recordReason, /Render cache unavailable/);
  assert.match(state.previewReason, /Render cache unavailable/);
  assert.match(state.preflight, /需要检查/);
  assert.match(state.preflight, /Render cache unavailable/);
  assert.notEqual(state.statusText, 'READY: VISUALIZER MODE');
});

test('missing AudioContext blocks ready state before preview or render start', { skip: !playwright && 'Bundled Playwright unavailable' }, async (t) => {
  assert.ok(fs.existsSync(htmlPath), 'index.html should exist');
  const browser = await playwright.chromium.launch({ headless: true });
  t.after(() => browser.close());

  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const consoleErrors = [];
  const pageErrors = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('pageerror', (err) => pageErrors.push(err.message));
  await page.addInitScript(() => {
    Object.defineProperty(window, 'AudioContext', { configurable: true, writable: true, value: undefined });
    Object.defineProperty(window, 'webkitAudioContext', { configurable: true, writable: true, value: undefined });
  });

  await gotoApp(page);
  await page.waitForFunction(() => document.readyState === 'complete');
  await page.setInputFiles('#in-cover', filePayload('cover.png', 'image/png', tinyPng));
  await page.waitForFunction(() => window.AssetManager?.status?.cover?.valid === true);
  await page.setInputFiles('#in-logo', filePayload('logo.png', 'image/png', tinyPng));
  await page.waitForFunction(() => window.AssetManager?.status?.logo?.valid === true);
  await page.setInputFiles('#in-video', filePayload('center.png', 'image/png', tinyPng));
  await page.waitForFunction(() => window.AssetManager?.status?.video?.valid === true);
  await page.setInputFiles('#in-audio', filePayload('tone.wav', 'audio/wav', tinyWav()));
  await page.waitForFunction(() => window.AssetManager?.status?.audio?.valid === true);

  const blocked = await page.evaluate(() => ({
    preflight: document.querySelector('#preflight-summary')?.textContent?.trim() || '',
    readiness: window.Preflight.getRenderReadiness(),
    recordDisabled: document.querySelector('#btn-rec')?.disabled,
    previewDisabled: document.querySelector('#btn-preview')?.disabled,
    recordReason: document.querySelector('#btn-rec')?.dataset.disabledReason || '',
    previewReason: document.querySelector('#btn-preview')?.dataset.disabledReason || '',
    fatalOpen: document.querySelector('#error-overlay')?.style.display === 'flex',
    statusText: document.querySelector('#status-text')?.textContent?.trim() || ''
  }));

  assert.match(blocked.preflight, /需要检查/);
  assert.match(blocked.preflight, /当前浏览器无法处理音频|Audio engine unavailable/);
  assert.equal(blocked.readiness.recordReady, false);
  assert.equal(blocked.recordDisabled, true);
  assert.equal(blocked.previewDisabled, true);
  assert.match(blocked.recordReason, /当前浏览器无法处理音频|Audio engine unavailable/);
  assert.match(blocked.previewReason, /当前浏览器无法处理音频|Audio engine unavailable/);
  assert.equal(blocked.fatalOpen, false);
  assert.notEqual(blocked.statusText, 'READY: VISUALIZER MODE');
  assert.deepEqual(pageErrors, []);
  assert.deepEqual(consoleErrors, []);
});

test('pending asset loads announce loading state before decode completes', { skip: !playwright && 'Bundled Playwright unavailable' }, async (t) => {
  assert.ok(fs.existsSync(htmlPath), 'index.html should exist');
  const browser = await playwright.chromium.launch({ headless: true });
  t.after(() => browser.close());

  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const consoleErrors = [];
  const pageErrors = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('pageerror', (err) => pageErrors.push(err.message));
  await page.addInitScript(() => {
    const NativeImage = window.Image;
    const srcDescriptor = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'src');
    window.Image = function DelayedImage(width, height) {
      const img = new NativeImage(width, height);
      Object.defineProperty(img, 'src', {
        configurable: true,
        get() {
          return srcDescriptor.get.call(img);
        },
        set(value) {
          setTimeout(() => srcDescriptor.set.call(img, value), 800);
        }
      });
      return img;
    };
    window.Image.prototype = NativeImage.prototype;
  });

  await gotoApp(page);
  await page.waitForFunction(() => document.readyState === 'complete');

  await page.setInputFiles('#in-video', filePayload('slow-center.png', 'image/png', tinyPng));
  await page.waitForFunction(() => {
    const status = window.AssetManager?.status?.video;
    return status?.name === 'slow-center.png' && status.valid === false && status.error === '';
  });
  const pending = await page.evaluate(() => ({
    videoStatus: window.AssetManager.status.video,
    assetInputSummary: document.querySelector('#asset-input-summary')?.textContent?.trim() || '',
    preflight: document.querySelector('#preflight-summary')?.textContent?.trim() || '',
    statusLive: document.querySelector('#status-live')?.textContent?.trim() || ''
  }));

  assert.deepEqual(pending.videoStatus, { name: 'slow-center.png', valid: false, error: '' });
  assert.match(pending.assetInputSummary, /素材载入中：.*中心视觉\/Center/);
  assert.match(pending.preflight, /请先选择背景图/);
  assert.match(pending.statusLive, /正在载入中心视觉素材：slow-center\.png/);

  await page.waitForFunction(() => window.AssetManager?.status?.video?.valid === true);
  assert.deepEqual(pageErrors, []);
  assert.deepEqual(consoleErrors, []);
});

test('range controls update aria-valuetext as values change', { skip: !playwright && 'Bundled Playwright unavailable' }, async (t) => {
  assert.ok(fs.existsSync(htmlPath), 'index.html should exist');
  const browser = await playwright.chromium.launch({ headless: true });
  t.after(() => browser.close());

  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const consoleErrors = [];
  const pageErrors = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('pageerror', (err) => pageErrors.push(err.message));

  await gotoApp(page);
  await page.waitForFunction(() => document.readyState === 'complete');

  const state = await page.evaluate(() => {
    const setRange = (id, value) => {
      const input = document.querySelector(`#${id}`);
      input.value = String(value);
      input.dispatchEvent(new Event('input', { bubbles: true }));
      const output = document.querySelector(`#out-${id.replace(/^in-/, '')}`);
      return {
        aria: input.getAttribute('aria-valuetext') || '',
        visible: output?.textContent?.trim() || '',
        title: output?.title || ''
      };
    };
    return {
      logoSize: setRange('in-logo-size', 321),
      logoPos: setRange('in-logo-pos', 77),
      sensitivity: setRange('in-sensitivity', 137),
      fx: setRange('in-fx-intensity', 42),
      glow: setRange('in-glow-amount', 37),
      groups: Array.from(document.querySelectorAll('.sidebar > .section')).map((section) => ({
        role: section.getAttribute('role') || '',
        labelledBy: section.getAttribute('aria-labelledby') || '',
        label: section.querySelector(':scope > .label')?.textContent?.trim() || '',
        labelId: section.querySelector(':scope > .label')?.id || ''
      })),
      snapshot: window.Store.snapshot
    };
  });

  assert.deepEqual(state.logoSize, { aria: 'Logo 尺寸 321px', visible: '321 px', title: 'Logo 尺寸 321px' });
  assert.deepEqual(state.logoPos, { aria: 'Logo 底部距离 77px', visible: '77 px', title: 'Logo 底部距离 77px' });
  assert.deepEqual(state.sensitivity, { aria: '音频响应灵敏度 137%', visible: '137%', title: '音频响应灵敏度 137%' });
  assert.deepEqual(state.fx, { aria: '特效强度 42%', visible: '42%', title: '特效强度 42%' });
  assert.deepEqual(state.glow, { aria: '辉光强度 37%', visible: '37%', title: '辉光强度 37%' });
  assert.ok(state.groups.length >= 12);
  for (const group of state.groups) {
    assert.equal(group.role, 'group');
    assert.ok(group.labelId, `${group.label} should have generated label id`);
    assert.equal(group.labelledBy, group.labelId);
  }
  assert.ok(state.groups.some((group) => /版式控制\s*位置和尺寸/.test(group.label)));
  assert.ok(state.groups.some((group) => /高级视觉\s*反应、特效和辉光/.test(group.label)));
  const layoutAx = await page.locator('.sidebar > .section').filter({ hasText: '位置和尺寸' }).ariaSnapshot();
  const advancedAx = await page.locator('.sidebar > .section').filter({ hasText: '反应、特效和辉光' }).ariaSnapshot();
  assert.match(layoutAx, /group ".*位置和尺寸"/);
  assert.match(layoutAx, /slider ".*Logo 尺寸"/);
  assert.match(layoutAx, /321 px/);
  assert.match(advancedAx, /group ".*反应、特效和辉光"/);
  assert.match(advancedAx, /slider ".*音频响应灵敏度/);
  assert.match(advancedAx, /137%/);
  assert.equal(state.snapshot.layout.logoWidth, 321);
  assert.equal(state.snapshot.layout.logoBottomMargin, 77);
  assert.equal(state.snapshot.config.visSensitivity, 1.37);
  assert.equal(state.snapshot.config.visFxIntensity, 0.42);
  assert.equal(state.snapshot.config.visGlowAmount, 0.37);
  assert.deepEqual(pageErrors, []);
  assert.deepEqual(consoleErrors, []);
});

test('asset file selections update visible labels, readiness summaries, and disabled reasons', { skip: !playwright && 'Bundled Playwright unavailable' }, async (t) => {
  assert.ok(fs.existsSync(htmlPath), 'index.html should exist');
  const browser = await playwright.chromium.launch({ headless: true });
  t.after(() => browser.close());

  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const consoleErrors = [];
  const pageErrors = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('pageerror', (err) => pageErrors.push(err.message));

  await gotoApp(page);
  await page.waitForFunction(() => document.readyState === 'complete');

  async function coverInputAccessibility() {
    await page.focus('#in-cover');
    const dom = await page.evaluate(() => {
      const input = document.querySelector('#in-cover');
      const ids = (input?.getAttribute('aria-describedby') || '').trim().split(/\s+/).filter(Boolean);
      return {
        focused: document.activeElement?.id || '',
        describedBy: input?.getAttribute('aria-describedby') || '',
        describedText: ids.map((id) => document.getElementById(id)?.textContent?.trim() || '').join(' ')
      };
    });
    const session = await page.context().newCDPSession(page);
    const ax = await session.send('Accessibility.getFullAXTree');
    await session.detach();
    const node = ax.nodes.find((item) => item.role?.value === 'button' && item.name?.value === '1. BACKGROUND ART (Image)');
    return {
      ...dom,
      axDescription: node?.description?.value || '',
      axValue: node?.value?.value || ''
    };
  }

  await page.setInputFiles('#in-cover', filePayload('not-cover.txt', 'text/plain', Buffer.from('not an image')));
  await page.waitForFunction(() => window.AssetManager?.status?.cover?.error === '不支持的cover文件');
  const rejected = await page.evaluate(() => ({
    label: document.querySelector('#lbl-cover')?.textContent?.trim() || '',
    inputValue: document.querySelector('#in-cover')?.value || '',
    coverStatus: window.AssetManager.status.cover,
    assetInputSummary: document.querySelector('#asset-input-summary')?.textContent?.trim() || '',
    preflight: document.querySelector('#preflight-summary')?.textContent?.trim() || '',
    previewDisabled: document.querySelector('#btn-preview')?.disabled,
    recordDisabled: document.querySelector('#btn-rec')?.disabled,
    previewReason: document.querySelector('#btn-preview')?.dataset.disabledReason || '',
    recordReason: document.querySelector('#btn-rec')?.dataset.disabledReason || ''
  }));

  assert.equal(rejected.label, '选择背景图');
  assert.equal(rejected.inputValue, '');
  assert.deepEqual(rejected.coverStatus, { name: '', valid: false, error: '不支持的cover文件' });
  assert.match(rejected.assetInputSummary, /背景图\/Cover 不支持的cover文件/);
  assert.match(rejected.preflight, /背景图不可用：不支持的cover文件/);
  assert.equal(rejected.previewDisabled, true);
  assert.equal(rejected.recordDisabled, true);
  assert.match(rejected.previewReason, /背景图不可用：不支持的cover文件/);
  assert.match(rejected.recordReason, /背景图不可用：不支持的cover文件/);
  const rejectedA11y = await coverInputAccessibility();
  assert.equal(rejectedA11y.focused, 'in-cover');
  assert.match(rejectedA11y.describedBy, /lbl-cover asset-input-summary/);
  assert.match(rejectedA11y.describedText, /选择背景图/);
  assert.match(rejectedA11y.describedText, /Cover 不支持的cover文件/);
  if (rejectedA11y.axDescription) {
    assert.match(rejectedA11y.axDescription, /选择背景图/);
    assert.match(rejectedA11y.axDescription, /Cover 不支持的cover文件/);
  }

  await page.setInputFiles('#in-cover', filePayload('cover.png', 'image/png', tinyPng));
  await page.waitForFunction(() => window.AssetManager?.status?.cover?.valid === true);
  await page.setInputFiles('#in-logo', filePayload('logo.png', 'image/png', tinyPng));
  await page.waitForFunction(() => window.AssetManager?.status?.logo?.valid === true);
  await page.setInputFiles('#in-video', filePayload('center.png', 'image/png', tinyPng));
  await page.waitForFunction(() => window.AssetManager?.status?.video?.valid === true);
  await page.setInputFiles('#in-audio', filePayload('tone.wav', 'audio/wav', tinyWav()));
  await page.waitForFunction(() => window.AssetManager?.status?.audio?.valid === true);
  await page.waitForFunction(() => !document.querySelector('#btn-preview')?.disabled && !document.querySelector('#btn-rec')?.disabled);

  const ready = await page.evaluate(() => ({
    labels: {
      cover: document.querySelector('#lbl-cover')?.textContent?.trim() || '',
      logo: document.querySelector('#lbl-logo')?.textContent?.trim() || '',
      video: document.querySelector('#lbl-video')?.textContent?.trim() || '',
      audio: document.querySelector('#lbl-audio')?.textContent?.trim() || ''
    },
	    assets: window.AssetManager.status,
	    assetInputSummary: document.querySelector('#asset-input-summary')?.textContent?.trim() || '',
	    preflight: document.querySelector('#preflight-summary')?.textContent?.trim() || '',
	    statusLive: document.querySelector('#status-live')?.textContent?.trim() || '',
	    assetSummaryRole: document.querySelector('#asset-input-summary')?.getAttribute('role') || '',
	    preflightRole: document.querySelector('#preflight-summary')?.getAttribute('role') || '',
	    preflightLive: document.querySelector('#preflight-summary')?.getAttribute('aria-live') || '',
	    readiness: window.Preflight.getRenderReadiness(),
    primaryBlockerHidden: document.querySelector('#primary-action-blocker')?.hidden,
    primaryBlockerTabIndex: document.querySelector('#primary-action-blocker')?.tabIndex,
    primaryBlockerText: document.querySelector('#primary-action-blocker')?.textContent?.trim() || '',
    previewDisabled: document.querySelector('#btn-preview')?.disabled,
    recordDisabled: document.querySelector('#btn-rec')?.disabled,
    previewReason: document.querySelector('#btn-preview')?.dataset.disabledReason || '',
    recordReason: document.querySelector('#btn-rec')?.dataset.disabledReason || ''
  }));

  assert.deepEqual(ready.labels, {
    cover: 'cover.png',
    logo: 'logo.png',
    video: 'center.png',
    audio: 'tone.wav'
  });
  assert.equal(ready.assets.cover.valid, true);
  assert.equal(ready.assets.logo.valid, true);
  assert.equal(ready.assets.video.valid, true);
  assert.equal(ready.assets.audio.valid, true);
	  assert.match(ready.assetInputSummary, /素材就绪/);
	  assert.match(ready.preflight, /素材齐了，可以导出/);
	  assert.match(ready.statusLive, /素材齐了，可以导出/);
	  assert.equal(ready.assetSummaryRole, 'status');
	  assert.equal(ready.preflightRole, 'status');
	  assert.equal(ready.preflightLive, 'polite');
	  assert.equal(ready.readiness.previewReady, true);
  assert.equal(ready.readiness.recordReady, true);
  assert.equal(ready.primaryBlockerHidden, true);
  assert.equal(ready.primaryBlockerTabIndex, -1);
  assert.equal(ready.primaryBlockerText, '');
  assert.equal(ready.previewDisabled, false);
  assert.equal(ready.recordDisabled, false);
  assert.equal(ready.previewReason, '');
  assert.equal(ready.recordReason, '');
  const readyA11y = await coverInputAccessibility();
  assert.match(readyA11y.describedBy, /lbl-cover asset-input-summary/);
  assert.match(readyA11y.describedText, /cover\.png/);
  assert.match(readyA11y.describedText, /素材就绪/);
  if (readyA11y.axDescription) {
    assert.match(readyA11y.axDescription, /cover\.png/);
    assert.match(readyA11y.axDescription, /素材就绪/);
  }
  assert.deepEqual(pageErrors, []);
  assert.deepEqual(consoleErrors, []);
});

test('plain project JSON import preserves listed asset refs as reload guidance', { skip: !playwright && 'Bundled Playwright unavailable' }, async (t) => {
  assert.ok(fs.existsSync(htmlPath), 'index.html should exist');
  const browser = await playwright.chromium.launch({ headless: true });
  t.after(() => browser.close());

  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const consoleErrors = [];
  const pageErrors = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('pageerror', (err) => pageErrors.push(err.message));
  await page.addInitScript(() => localStorage.setItem('fad-mv-autosave', '0'));

  await gotoApp(page);
  await page.waitForFunction(() => document.readyState === 'complete');

  const projectWithAssets = {
    schemaVersion: 1,
    meta: { song: 'WITH ASSETS', artist: 'openFAD Fixture Artist' },
    config: {},
    layout: {},
    assets: {
      cover: 'cover-art.png',
      video: 'center-loop.mp4',
      audio: 'master.wav',
      logo: 'fad-logo.png'
    }
  };
  await page.setInputFiles('#in-project-file', filePayload('with-assets.fad-mv.json', 'application/json', Buffer.from(JSON.stringify(projectWithAssets))));
  await page.waitForFunction(() => document.querySelector('#status-text')?.textContent?.includes('重新选择其中列出的素材'));

  const listed = await page.evaluate(() => ({
    status: document.querySelector('#status-text')?.textContent?.trim() || '',
    assetSummary: document.querySelector('#asset-input-summary')?.textContent?.trim() || '',
    labels: {
      cover: document.querySelector('#lbl-cover')?.textContent?.trim() || '',
      video: document.querySelector('#lbl-video')?.textContent?.trim() || '',
      audio: document.querySelector('#lbl-audio')?.textContent?.trim() || '',
      logo: document.querySelector('#lbl-logo')?.textContent?.trim() || ''
    },
    assets: window.AssetManager.status,
    readiness: window.Preflight.getRenderReadiness()
  }));

  assert.equal(listed.status, '项目文件已载入，请重新选择其中列出的素材。');
  assert.match(listed.assetSummary, /需要重新选择素材/);
  assert.match(listed.assetSummary, /Cover cover-art\.png/);
  assert.match(listed.assetSummary, /Center center-loop\.mp4/);
  assert.match(listed.assetSummary, /Audio master\.wav/);
  assert.match(listed.assetSummary, /Logo fad-logo\.png/);
  assert.deepEqual(listed.labels, {
    cover: '重新选择 cover-art.png',
    video: '重新选择 center-loop.mp4',
    audio: '重新选择 master.wav',
    logo: '重新选择 fad-logo.png'
  });
  assert.equal(listed.assets.cover.name, 'cover-art.png');
  assert.equal(listed.assets.cover.valid, false);
  assert.equal(listed.assets.cover.error, '');
  assert.equal(listed.readiness.recordReady, false);

  const stateOnlyProject = {
    schemaVersion: 1,
    meta: { song: '仅保存设置', artist: 'openFAD Fixture Artist' },
    config: {},
    layout: {}
  };
  await page.setInputFiles('#in-project-file', filePayload('state-only.fad-mv.json', 'application/json', Buffer.from(JSON.stringify(stateOnlyProject))));
  await page.waitForFunction(() => document.querySelector('#status-text')?.textContent?.includes('项目设置已载入，请补齐素材。'));

  const stateOnly = await page.evaluate(() => ({
    status: document.querySelector('#status-text')?.textContent?.trim() || '',
    assetSummary: document.querySelector('#asset-input-summary')?.textContent?.trim() || '',
    labels: {
      cover: document.querySelector('#lbl-cover')?.textContent?.trim() || '',
      video: document.querySelector('#lbl-video')?.textContent?.trim() || '',
      audio: document.querySelector('#lbl-audio')?.textContent?.trim() || '',
      logo: document.querySelector('#lbl-logo')?.textContent?.trim() || ''
    },
    assets: window.AssetManager.status
  }));

  assert.equal(stateOnly.status, '项目设置已载入，请补齐素材。');
  assert.equal(stateOnly.assetSummary, '等待素材：请先选择背景图、中心视觉、主音频和透明 Logo');
	  assert.deepEqual(stateOnly.labels, {
	    cover: '选择背景图',
	    video: '选择视频或图片',
	    audio: '选择音频',
	    logo: '选择透明 Logo'
	  });
  assert.equal(stateOnly.assets.cover.name, '');
  assert.equal(stateOnly.assets.video.name, '');
  assert.equal(stateOnly.assets.audio.name, '');
  assert.equal(stateOnly.assets.logo.name, '');
  assert.deepEqual(pageErrors, []);
  assert.deepEqual(consoleErrors, []);
});

test('state-only autosave restore in a fresh session shows asset reload guidance', { skip: !playwright && 'Bundled Playwright unavailable' }, async (t) => {
  assert.ok(fs.existsSync(htmlPath), 'index.html should exist');
  const browser = await playwright.chromium.launch({ headless: true });
  t.after(() => browser.close());

  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const consoleErrors = [];
  const pageErrors = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('pageerror', (err) => pageErrors.push(err.message));
  await page.addInitScript(() => localStorage.setItem('fad-mv-autosave', '1'));

  await gotoApp(page);
  await page.waitForFunction(() => document.readyState === 'complete');
  await page.waitForFunction(() => window.AutoSave?.status?.available === true);

  const projectWithAssets = {
    schemaVersion: 1,
    meta: { song: 'FRESH 仅保存设置 RESTORE', artist: 'openFAD Fixture Artist' },
    config: {},
    layout: {},
    assets: {
      cover: 'fresh-cover.png',
      video: 'fresh-center.mp4',
      audio: 'fresh-master.wav',
      logo: 'fresh-logo.png'
    }
  };
  await page.setInputFiles('#in-project-file', filePayload('fresh-state-only.fad-mv.json', 'application/json', Buffer.from(JSON.stringify(projectWithAssets))));
  await page.waitForFunction(() => document.querySelector('#asset-input-summary')?.textContent?.includes('需要重新选择素材'));
  await page.waitForFunction(() => Array.from(document.querySelector('#recent-projects')?.options || []).some((option) => /FRESH 仅保存设置 RESTORE/.test(option.textContent || '')));

  await page.reload({ waitUntil: 'load' });
  await page.waitForFunction(() => document.readyState === 'complete');
  await page.waitForFunction(() => window.AutoSave?.status?.available === true);
  await page.waitForFunction(() => Array.from(document.querySelector('#recent-projects')?.options || []).some((option) => /FRESH 仅保存设置 RESTORE/.test(option.textContent || '')));
  await page.evaluate(() => {
    const select = document.querySelector('#recent-projects');
    const option = Array.from(select?.options || []).find((item) => /FRESH 仅保存设置 RESTORE/.test(item.textContent || ''));
    if (!select || !option) throw new Error('缺失 fresh state-only recent snapshot');
    select.value = option.value;
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await page.click('#btn-restore-selected');
  await page.waitForFunction(() => document.querySelector('#asset-input-summary')?.textContent?.includes('需要重新选择素材'));

  const restored = await page.evaluate(() => ({
    status: document.querySelector('#status-text')?.textContent?.trim() || '',
    assetSummary: document.querySelector('#asset-input-summary')?.textContent?.trim() || '',
    labels: {
      cover: document.querySelector('#lbl-cover')?.textContent?.trim() || '',
      video: document.querySelector('#lbl-video')?.textContent?.trim() || '',
      audio: document.querySelector('#lbl-audio')?.textContent?.trim() || '',
      logo: document.querySelector('#lbl-logo')?.textContent?.trim() || ''
    },
    assets: window.AssetManager.status,
    readiness: window.Preflight.getRenderReadiness()
  }));

  assert.doesNotMatch(restored.status, /恢复失败|自动保存失败/i);
  assert.match(restored.assetSummary, /需要重新选择素材/);
  assert.match(restored.assetSummary, /Cover fresh-cover\.png/);
  assert.match(restored.assetSummary, /Center fresh-center\.mp4/);
  assert.match(restored.assetSummary, /Audio fresh-master\.wav/);
  assert.match(restored.assetSummary, /Logo fresh-logo\.png/);
  assert.deepEqual(restored.labels, {
    cover: '重新选择 fresh-cover.png',
    video: '重新选择 fresh-center.mp4',
    audio: '重新选择 fresh-master.wav',
    logo: '重新选择 fresh-logo.png'
  });
  assert.equal(restored.assets.cover.name, 'fresh-cover.png');
  assert.equal(restored.assets.cover.valid, false);
  assert.equal(restored.assets.cover.error, '');
  assert.equal(restored.readiness.recordReady, false);
  assert.deepEqual(pageErrors, []);
  assert.deepEqual(consoleErrors, []);
});

test('plain project JSON import ignores stale file reads after a newer selection', { skip: !playwright && 'Bundled Playwright unavailable' }, async (t) => {
  assert.ok(fs.existsSync(htmlPath), 'index.html should exist');
  const browser = await playwright.chromium.launch({ headless: true });
  t.after(() => browser.close());

  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const consoleErrors = [];
  const pageErrors = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('pageerror', (err) => pageErrors.push(err.message));
  await page.addInitScript(() => {
    localStorage.setItem('fad-mv-autosave', '0');
    window.__jsonImportRace = { slowTextCalls: 0, slowResolved: 0, releaseSlow: null };
    const nativeText = File.prototype.text;
    File.prototype.text = function text() {
      if (this.name === 'slow-project.fad-mv.json') {
        window.__jsonImportRace.slowTextCalls += 1;
        return new Promise((resolve) => {
          window.__jsonImportRace.releaseSlow = () => {
            window.__jsonImportRace.slowResolved += 1;
            nativeText.call(this).then(resolve);
          };
        });
      }
      return nativeText.call(this);
    };
  });

  await gotoApp(page);
  await page.waitForFunction(() => document.readyState === 'complete');

  const slowProject = {
    schemaVersion: 1,
    meta: { song: 'SLOW STALE JSON', artist: 'Old' },
    config: {},
    layout: {}
  };
  const fastProject = {
    schemaVersion: 1,
    meta: { song: 'FAST LATEST JSON', artist: 'New' },
    config: {},
    layout: {}
  };

  await page.setInputFiles('#in-project-file', filePayload('slow-project.fad-mv.json', 'application/json', Buffer.from(JSON.stringify(slowProject))));
  await page.waitForFunction(() => window.__jsonImportRace?.slowTextCalls === 1);
  await page.setInputFiles('#in-project-file', filePayload('fast-project.fad-mv.json', 'application/json', Buffer.from(JSON.stringify(fastProject))));
  await page.waitForFunction(() => window.Store?.snapshot?.meta?.song === 'FAST LATEST JSON');
  await page.evaluate(() => window.__jsonImportRace.releaseSlow?.());
  await page.waitForFunction(() => window.__jsonImportRace?.slowResolved === 1);
  await page.waitForTimeout(150);

  const finalState = await page.evaluate(() => ({
    song: window.Store.snapshot.meta.song,
    artist: window.Store.snapshot.meta.artist,
    status: document.querySelector('#status-text')?.textContent?.trim() || '',
    race: window.__jsonImportRace
  }));

  assert.equal(finalState.race.slowTextCalls, 1);
  assert.equal(finalState.race.slowResolved, 1);
  assert.equal(finalState.song, 'FAST LATEST JSON');
  assert.equal(finalState.artist, 'New');
  assert.doesNotMatch(finalState.status, /SLOW STALE JSON/);
  assert.deepEqual(pageErrors, []);
  assert.deepEqual(consoleErrors, []);
});

test('plain JSON import with asset refs does not replace a full autosave latest snapshot', { skip: !playwright && 'Bundled Playwright unavailable' }, async (t) => {
  assert.ok(fs.existsSync(htmlPath), 'index.html should exist');
  const browser = await playwright.chromium.launch({ headless: true });
  t.after(() => browser.close());

  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const consoleErrors = [];
  const pageErrors = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('pageerror', (err) => pageErrors.push(err.message));
  await page.addInitScript(() => localStorage.setItem('fad-mv-autosave', '1'));

  await gotoApp(page);
  await page.waitForFunction(() => document.readyState === 'complete');
  await page.waitForFunction(() => window.AutoSave?.status?.available === true);
  await page.setInputFiles('#in-cover', filePayload('cover.png', 'image/png', tinyPng));
  await page.waitForFunction(() => window.AssetManager?.status?.cover?.valid === true);
  await page.setInputFiles('#in-logo', filePayload('logo.png', 'image/png', tinyPng));
  await page.waitForFunction(() => window.AssetManager?.status?.logo?.valid === true);
  await page.setInputFiles('#in-video', filePayload('center.png', 'image/png', tinyPng));
  await page.waitForFunction(() => window.AssetManager?.status?.video?.valid === true);
  await page.setInputFiles('#in-audio', filePayload('baseline.wav', 'audio/wav', tinyWav()));
  await page.waitForFunction(() => window.AssetManager?.status?.audio?.valid === true);
  await setProjectFields(page, { song: 'FULL AUTOSAVE PROJECT', artist: 'openFAD Fixture Artist' });
  await saveSnapshotViaUi(page, 'FULL AUTOSAVE PROJECT');

  const jsonImport = {
    schemaVersion: 1,
    meta: { song: 'JSON IMPORT NEEDS ASSETS', artist: 'openFAD Fixture Artist' },
    config: {},
    layout: {},
    assets: {
      cover: 'json-cover.png',
      video: 'json-center.mp4',
      audio: 'json-master.wav',
      logo: 'json-logo.png'
    }
  };
  await page.setInputFiles('#in-project-file', filePayload('needs-assets.fad-mv.json', 'application/json', Buffer.from(JSON.stringify(jsonImport))));
  await page.waitForFunction(() => document.querySelector('#asset-input-summary')?.textContent?.includes('需要重新选择素材'));
  await page.waitForFunction(() => Array.from(document.querySelector('#recent-projects')?.options || []).some((option) => /JSON IMPORT NEEDS ASSETS/.test(option.textContent || '')));

  await setProjectFields(page, { song: 'PLACEHOLDER BEFORE RESTORE', artist: 'openFAD Fixture Artist' });
  await restoreLatestViaUi(page, 'FULL AUTOSAVE PROJECT');

  const restored = await page.evaluate(() => ({
    song: window.Store.snapshot.meta.song,
    assets: window.AssetManager.status,
    recentText: Array.from(document.querySelector('#recent-projects')?.options || []).map((option) => option.textContent).join(' | ')
  }));

  assert.equal(restored.song, 'FULL AUTOSAVE PROJECT');
  assert.equal(restored.assets.cover.valid, true);
  assert.equal(restored.assets.video.valid, true);
  assert.equal(restored.assets.audio.valid, true);
  assert.equal(restored.assets.logo.valid, true);
  assert.match(restored.recentText, /JSON IMPORT NEEDS ASSETS/);
  assert.match(restored.recentText, /仅保存设置/);
  assert.deepEqual(pageErrors, []);
  assert.deepEqual(consoleErrors, []);
});

test('recent autosave selection does not restore until Restore Selected is clicked', { skip: !playwright && 'Bundled Playwright unavailable' }, async (t) => {
  assert.ok(fs.existsSync(htmlPath), 'index.html should exist');
  const browser = await playwright.chromium.launch({ headless: true });
  t.after(() => browser.close());

  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const consoleErrors = [];
  const pageErrors = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('pageerror', (err) => pageErrors.push(err.message));
  await page.addInitScript(() => localStorage.setItem('fad-mv-autosave', '0'));

  await gotoApp(page);
  await page.waitForFunction(() => document.readyState === 'complete');
  await page.waitForFunction(() => window.AutoSave?.status?.available === true);

  await setProjectFields(page, { song: 'RECENT SELECT A', artist: 'openFAD Fixture Artist' });
  await saveSnapshotViaUi(page, 'RECENT SELECT A');
  await setProjectFields(page, { song: 'RECENT SELECT B', artist: 'openFAD Fixture Artist' });
  await saveSnapshotViaUi(page, 'RECENT SELECT B');
  await setProjectFields(page, { song: 'CURRENT WORK SHOULD STAY', artist: 'openFAD Fixture Artist' });

  const targetRecentId = await page.evaluate(() => {
    const option = Array.from(document.querySelector('#recent-projects')?.options || [])
      .find((item) => /RECENT SELECT A/.test(item.textContent || ''));
    return option?.value || '';
  });
  assert.ok(targetRecentId, 'expected RECENT SELECT A to be available in recent snapshots');

  await page.selectOption('#recent-projects', targetRecentId);
  await page.waitForFunction(() => document.querySelector('#btn-restore-selected')?.disabled === false);
  const selectedOnly = await page.evaluate(() => ({
    song: window.Store.snapshot.meta.song,
    selectedText: document.querySelector('#recent-projects')?.selectedOptions?.[0]?.textContent || '',
    restoreSelectedDisabled: document.querySelector('#btn-restore-selected')?.disabled,
    restoreSelectedReason: document.querySelector('#btn-restore-selected')?.dataset.disabledReason || '',
    autosaveList: document.querySelector('#autosave-list')?.textContent?.replace(/\s+/g, ' ').trim() || ''
  }));

  assert.equal(selectedOnly.song, 'CURRENT WORK SHOULD STAY');
  assert.match(selectedOnly.selectedText, /RECENT SELECT A/);
  assert.equal(selectedOnly.restoreSelectedDisabled, false);
  assert.equal(selectedOnly.restoreSelectedReason, '');
  assert.match(selectedOnly.autosaveList, /已选择RECENT SELECT A|已选择 RECENT SELECT A/);

  await page.click('#btn-restore-selected');
  try {
    await page.waitForFunction(() => window.Store?.snapshot?.meta?.song === 'RECENT SELECT A', null, { timeout: 8000 });
  } catch (err) {
    const debug = await page.evaluate(() => ({
      song: window.Store?.snapshot?.meta?.song || '',
      status: document.querySelector('#status-text')?.textContent || '',
      selectedValue: document.querySelector('#recent-projects')?.value || '',
      selectedText: document.querySelector('#recent-projects')?.selectedOptions?.[0]?.textContent || '',
      buttonDisabled: document.querySelector('#btn-restore-selected')?.disabled,
      buttonReason: document.querySelector('#btn-restore-selected')?.dataset.disabledReason || '',
      warnings: window.UI?.warnings?.map((warning) => warning.text).join('\n') || '',
      locks: window.Store?.locks || null,
      autosaveList: document.querySelector('#autosave-list')?.textContent?.replace(/\s+/g, ' ').trim() || ''
    }));
    throw new Error(`${err.message}; recentRestore=${JSON.stringify(debug)}`);
  }
  const restored = await page.evaluate(() => ({
    song: window.Store.snapshot.meta.song,
    restoreSelectedDisabled: document.querySelector('#btn-restore-selected')?.disabled
  }));

  assert.equal(restored.song, 'RECENT SELECT A');
  assert.equal(restored.restoreSelectedDisabled, true);
  assert.deepEqual(pageErrors, []);
  assert.deepEqual(consoleErrors, []);
});

test('autosave save and restore are blocked while audio analysis is running', { skip: !playwright && 'Bundled Playwright unavailable' }, async (t) => {
  assert.ok(fs.existsSync(htmlPath), 'index.html should exist');
  const browser = await playwright.chromium.launch({ headless: true });
  t.after(() => browser.close());

  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const consoleErrors = [];
  const pageErrors = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('pageerror', (err) => pageErrors.push(err.message));
  await page.addInitScript(() => {
    localStorage.setItem('fad-mv-autosave', '1');
    window.__decodeProbe = { decodeCalls: 0, closes: 0 };
    class FakeAudioContext {
      decodeAudioData() {
        window.__decodeProbe.decodeCalls += 1;
        return new Promise(() => {});
      }

      close() {
        window.__decodeProbe.closes += 1;
        return Promise.resolve();
      }
    }
    window.AudioContext = FakeAudioContext;
    window.webkitAudioContext = FakeAudioContext;
  });

  await gotoApp(page);
  await page.waitForFunction(() => document.readyState === 'complete');
  await page.waitForFunction(() => window.AutoSave?.status?.available === true);
  await page.setInputFiles('#in-audio', filePayload('analysis-restore.wav', 'audio/wav', tinyWav()));
  await page.waitForFunction(() => window.AssetManager?.status?.audio?.valid === true);
  await setProjectFields(page, { song: 'RESTORE BASELINE', artist: 'openFAD Fixture Artist' });
  await saveSnapshotViaUi(page, 'RESTORE BASELINE');
  await setProjectFields(page, { song: 'ANALYSIS CURRENT', artist: 'openFAD Fixture Artist' });

  await page.click('#btn-analyze-audio');
  await page.waitForFunction(() => window.__decodeProbe.decodeCalls === 1 && window.Store?.locks?.audioAnalysis === 'analyzing');

  const blocked = await page.evaluate(async () => {
    return {
      song: window.Store.snapshot.meta.song,
      locks: window.Store.locks,
      warnings: window.UI.warnings.map((warning) => warning.text).join('\n'),
      autosaveSummary: document.querySelector('#autosave-summary')?.textContent?.trim() || '',
      safeToSave: window.AutoSave.status.safeToSave,
      saveDisabled: document.querySelector('#btn-save-snapshot')?.disabled,
      saveReason: document.querySelector('#btn-save-snapshot')?.dataset.disabledReason || '',
      restoreDisabled: document.querySelector('#btn-restore-latest')?.disabled,
      restoreReason: document.querySelector('#btn-restore-latest')?.dataset.disabledReason || ''
    };
  });

  assert.equal(blocked.song, 'ANALYSIS CURRENT');
  assert.equal(blocked.locks.restore, false);
  assert.equal(blocked.locks.audioAnalysis, 'analyzing');
  assert.equal(blocked.safeToSave, false);
  assert.equal(blocked.saveDisabled, true);
  assert.equal(blocked.restoreDisabled, true);
  assert.match(blocked.autosaveSummary, /自动保存暂时等待中/);
  assert.match(blocked.saveReason, /音频分析中/);
  assert.match(blocked.restoreReason, /音频分析中/);
  assert.deepEqual(pageErrors, []);
  assert.deepEqual(consoleErrors, []);
});

test('state-only autosave restore rehydrates matching analysis against kept current audio', { skip: !playwright && 'Bundled Playwright unavailable' }, async (t) => {
  assert.ok(fs.existsSync(htmlPath), 'index.html should exist');
  const browser = await playwright.chromium.launch({ headless: true });
  t.after(() => browser.close());

  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const consoleErrors = [];
  const pageErrors = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('pageerror', (err) => pageErrors.push(err.message));
  await page.addInitScript(() => {
    localStorage.setItem('fad-mv-autosave', '1');
    const storage = navigator.storage || {};
    Object.defineProperty(storage, 'estimate', {
      configurable: true,
      value: () => Promise.resolve({ quota: 64 * 1024 * 1024, usage: 60 * 1024 * 1024 })
    });
    if (!navigator.storage) {
      Object.defineProperty(navigator, 'storage', { configurable: true, value: storage });
    }
  });

  const audioBytes = tinyWav({ durationSec: 0.5, frequency: 440 });
  const largeCenter = Buffer.concat([tinyPng, Buffer.alloc(34 * 1024 * 1024)]);

  await gotoApp(page);
  await page.waitForFunction(() => document.readyState === 'complete');
  await page.waitForFunction(() => window.AutoSave?.status?.available === true);
  await page.setInputFiles('#in-cover', filePayload('cover.png', 'image/png', tinyPng));
  await page.waitForFunction(() => window.AssetManager?.status?.cover?.valid === true);
  await page.setInputFiles('#in-logo', filePayload('logo.png', 'image/png', tinyPng));
  await page.waitForFunction(() => window.AssetManager?.status?.logo?.valid === true);
  await page.setInputFiles('#in-video', filePayload('large-center.png', 'image/png', largeCenter));
  await page.waitForFunction(() => window.AssetManager?.status?.video?.valid === true);
  await page.setInputFiles('#in-audio', filePayload('analysis-state-only.wav', 'audio/wav', audioBytes));
  await page.waitForFunction(() => window.AssetManager?.status?.audio?.valid === true);
  await setProjectFields(page, { song: '仅保存设置 ANALYZED', artist: 'openFAD Fixture Artist' });

  await page.click('#btn-analyze-audio');
  await page.waitForFunction(() => window.AudioAnalysis?.status?.status === 'done');
  await saveSnapshotViaUi(page, '仅保存设置 ANALYZED');
  const saved = await page.evaluate(() => ({
    assetSaveSkippedReason: window.AutoSave.status.assetSaveSkippedReason,
    recentText: Array.from(document.querySelector('#recent-projects')?.options || []).map((option) => option.textContent || '').join(' | ')
  }));
  assert.match(saved.assetSaveSkippedReason, /浏览器空间不足|browser storage|autosave budget/i);
  assert.match(saved.recentText, /仅保存设置/);

  await page.evaluate(() => {
    document.querySelector('#in-autosave').checked = false;
  });
  await page.setInputFiles('#in-audio', filePayload('analysis-state-only.wav', 'audio/wav', audioBytes));
  await page.waitForFunction(() => window.AssetManager?.status?.audio?.valid === true && window.AudioAnalysis?.status?.status === 'idle');

  await restoreLatestViaUi(page, '仅保存设置 ANALYZED');
  const restored = await page.evaluate(async () => {
    const result = window.AudioAnalysis.status.result;
    return {
      status: window.AudioAnalysis.status.status,
      sourceName: result?.sourceName || '',
      durationSec: result?.durationSec || 0,
      song: window.Store.snapshot.meta.song,
      warnings: window.UI.warnings.map((warning) => warning.text).join('\n')
    };
  });

  assert.equal(restored.song, '仅保存设置 ANALYZED');
  assert.equal(restored.status, 'done');
  assert.equal(restored.sourceName, 'analysis-state-only.wav');
  assert.ok(Math.abs(restored.durationSec - 0.5) <= 0.2);
  assert.doesNotMatch(restored.warnings, /Skipped stale autosave audio analysis restore/);
  assert.deepEqual(pageErrors, []);
  assert.deepEqual(consoleErrors, []);
});

test('autosave reclaims old storage before using state-only fallback', { skip: !playwright && 'Bundled Playwright unavailable' }, async (t) => {
  assert.ok(fs.existsSync(htmlPath), 'index.html should exist');
  const browser = await playwright.chromium.launch({ headless: true });
  t.after(() => browser.close());

  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const consoleErrors = [];
  const pageErrors = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('pageerror', (err) => pageErrors.push(err.message));
  await page.addInitScript(() => {
    localStorage.setItem('fad-mv-autosave', '1');
    const storage = navigator.storage || {};
    window.__autosaveEstimateCalls = 0;
    Object.defineProperty(storage, 'estimate', {
      configurable: true,
      value: () => {
        window.__autosaveEstimateCalls += 1;
        return Promise.resolve(window.__autosaveEstimateCalls === 1
          ? { quota: 64 * 1024 * 1024, usage: 32 * 1024 * 1024 }
          : { quota: 128 * 1024 * 1024, usage: 0 });
      }
    });
    if (!navigator.storage) {
      Object.defineProperty(navigator, 'storage', { configurable: true, value: storage });
    }
  });

  const largeCenter = Buffer.concat([tinyPng, Buffer.alloc(34 * 1024 * 1024)]);
  await gotoApp(page);
  await page.waitForFunction(() => document.readyState === 'complete');
  await page.waitForFunction(() => window.AutoSave?.status?.available === true);
  await page.setInputFiles('#in-cover', filePayload('cover.png', 'image/png', tinyPng));
  await page.waitForFunction(() => window.AssetManager?.status?.cover?.valid === true);
  await page.setInputFiles('#in-logo', filePayload('logo.png', 'image/png', tinyPng));
  await page.waitForFunction(() => window.AssetManager?.status?.logo?.valid === true);
  await page.setInputFiles('#in-video', filePayload('autosave-reclaim-center.png', 'image/png', largeCenter));
  await page.waitForFunction(() => window.AssetManager?.status?.video?.valid === true);
  await page.setInputFiles('#in-audio', filePayload('tone.wav', 'audio/wav', tinyWav()));
  await page.waitForFunction(() => window.AssetManager?.status?.audio?.valid === true);
  await setProjectFields(page, { song: 'AUTOSAVE RECLAIM ASSETS', artist: 'openFAD Fixture Artist' });
  await saveSnapshotViaUi(page, 'AUTOSAVE RECLAIM ASSETS');

  const saved = await page.evaluate(async () => {
    const openDb = () => new Promise((resolve, reject) => {
      const req = indexedDB.open('fad-mv-projects');
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error || new Error('db open failed'));
    });
    const requestToPromise = (req) => new Promise((resolve, reject) => {
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error || new Error('idb request failed'));
    });
    const db = await openDb();
    const snapshots = await requestToPromise(db.transaction('snapshots', 'readonly').objectStore('snapshots').getAll());
    const recent = snapshots
      .filter((snap) => snap.id !== 'latest')
      .find((snap) => snap.state?.meta?.song === 'AUTOSAVE RECLAIM ASSETS');
    return {
      estimateCalls: window.__autosaveEstimateCalls,
      status: window.AutoSave.status,
      recentText: Array.from(document.querySelector('#recent-projects')?.options || []).map((option) => option.textContent || '').join(' | '),
      assetsStored: recent?.assetsStored,
      assetKeys: Object.keys(recent?.assets || {})
    };
  });

  assert.equal(saved.estimateCalls, 2);
  assert.equal(saved.status.assetSaveSkippedReason, '');
  assert.equal(saved.assetsStored, true);
  assert.deepEqual(saved.assetKeys.sort(), ['audio', 'cover', 'logo', 'video']);
  assert.doesNotMatch(saved.recentText, /仅保存设置/);
  assert.deepEqual(pageErrors, []);
  assert.deepEqual(consoleErrors, []);
});

test('autosave retries asset writes after quota failures before state-only fallback', { skip: !playwright && 'Bundled Playwright unavailable' }, async (t) => {
  assert.ok(fs.existsSync(htmlPath), 'index.html should exist');
  const browser = await playwright.chromium.launch({ headless: true });
  t.after(() => browser.close());

  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const consoleErrors = [];
  const pageErrors = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('pageerror', (err) => pageErrors.push(err.message));
  await page.addInitScript(() => {
    localStorage.setItem('fad-mv-autosave', '0');
    window.__autosaveQuotaPutProbe = { assetPutCalls: 0, assetPutFailures: 0 };
    const nativePut = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function put(...args) {
      if (this.name === 'assets') {
        window.__autosaveQuotaPutProbe.assetPutCalls += 1;
        if (window.__autosaveQuotaPutProbe.assetPutFailures === 0) {
          window.__autosaveQuotaPutProbe.assetPutFailures += 1;
          throw new DOMException('Simulated autosave quota failure', 'QuotaExceededError');
        }
      }
      return nativePut.apply(this, args);
    };
  });

  await gotoApp(page);
  await page.waitForFunction(() => document.readyState === 'complete');
  await page.waitForFunction(() => window.AutoSave?.status?.available === true);
  await page.setInputFiles('#in-cover', filePayload('cover.png', 'image/png', tinyPng));
  await page.waitForFunction(() => window.AssetManager?.status?.cover?.valid === true);
  await page.setInputFiles('#in-logo', filePayload('logo.png', 'image/png', tinyPng));
  await page.waitForFunction(() => window.AssetManager?.status?.logo?.valid === true);
  await page.setInputFiles('#in-video', filePayload('center.png', 'image/png', tinyPng));
  await page.waitForFunction(() => window.AssetManager?.status?.video?.valid === true);
  await page.setInputFiles('#in-audio', filePayload('tone.wav', 'audio/wav', tinyWav()));
  await page.waitForFunction(() => window.AssetManager?.status?.audio?.valid === true);
  await setProjectFields(page, { song: 'AUTOSAVE QUOTA RETRY', artist: 'openFAD Fixture Artist' });
  await saveSnapshotViaUi(page, 'AUTOSAVE QUOTA RETRY');

  const saved = await page.evaluate(async () => {
    const openDb = () => new Promise((resolve, reject) => {
      const req = indexedDB.open('fad-mv-projects');
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error || new Error('db open failed'));
    });
    const requestToPromise = (req) => new Promise((resolve, reject) => {
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error || new Error('idb request failed'));
    });
    const db = await openDb();
    const snapshots = await requestToPromise(db.transaction('snapshots', 'readonly').objectStore('snapshots').getAll());
    const recent = snapshots
      .filter((snap) => snap.id !== 'latest')
      .find((snap) => snap.state?.meta?.song === 'AUTOSAVE QUOTA RETRY');
    return {
      probe: window.__autosaveQuotaPutProbe,
      status: window.AutoSave.status,
      recentText: Array.from(document.querySelector('#recent-projects')?.options || []).map((option) => option.textContent || '').join(' | '),
      assetsStored: recent?.assetsStored,
      assetKeys: Object.keys(recent?.assets || {}),
      warnings: window.UI.warnings.map((warning) => warning.text).join('\n')
    };
  });

  assert.equal(saved.probe.assetPutFailures, 1);
  assert.ok(saved.probe.assetPutCalls >= 5, `first write should fail, then all assets should be retried: ${JSON.stringify(saved.probe)}`);
  assert.equal(saved.status.assetSaveSkippedReason, '');
  assert.equal(saved.assetsStored, true);
  assert.deepEqual(saved.assetKeys.sort(), ['audio', 'cover', 'logo', 'video']);
  assert.doesNotMatch(saved.recentText, /仅保存设置/);
  assert.doesNotMatch(saved.warnings, /ASSETS NOT INCLUDED/);
  assert.deepEqual(pageErrors, []);
  assert.deepEqual(consoleErrors, []);
});

test('plain JSON import rolls back partial mutations after late project import failure', { skip: !playwright && 'Bundled Playwright unavailable' }, async (t) => {
  assert.ok(fs.existsSync(htmlPath), 'index.html should exist');
  const browser = await playwright.chromium.launch({ headless: true });
  t.after(() => browser.close());

  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const consoleErrors = [];
  const pageErrors = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('pageerror', (err) => pageErrors.push(err.message));
  await page.addInitScript(() => {
    localStorage.setItem('fad-mv-autosave', '0');
    window.__failNextJsonFontDispatch = false;
    const nativeDispatch = EventTarget.prototype.dispatchEvent;
    EventTarget.prototype.dispatchEvent = function dispatchEvent(event) {
      if (window.__failNextJsonFontDispatch && this.id === 'in-font') {
        window.__failNextJsonFontDispatch = false;
        throw new Error('forced late JSON import failure');
      }
      return nativeDispatch.call(this, event);
    };
  });

  await gotoApp(page);
  await page.waitForFunction(() => document.readyState === 'complete');
  await page.setInputFiles('#in-cover', filePayload('cover.png', 'image/png', tinyPng));
  await page.waitForFunction(() => window.AssetManager?.status?.cover?.valid === true);
  await page.setInputFiles('#in-logo', filePayload('logo.png', 'image/png', tinyPng));
  await page.waitForFunction(() => window.AssetManager?.status?.logo?.valid === true);
  await page.setInputFiles('#in-video', filePayload('center.png', 'image/png', tinyPng));
  await page.waitForFunction(() => window.AssetManager?.status?.video?.valid === true);
  await page.setInputFiles('#in-audio', filePayload('baseline.wav', 'audio/wav', tinyWav()));
  await page.waitForFunction(() => window.AssetManager?.status?.audio?.valid === true);
  await setProjectFields(page, { song: 'ROLLBACK BASELINE', artist: 'openFAD Fixture Artist', fontName: 'Orbitron' });

  const failingProject = {
    schemaVersion: 1,
    meta: { song: 'BROKEN JSON IMPORT', artist: 'Failure Probe' },
    config: { fontName: 'Audiowide' },
    layout: {}
  };
  await page.evaluate(() => { window.__failNextJsonFontDispatch = true; });
  await page.setInputFiles('#in-project-file', filePayload('broken.fad-mv.json', 'application/json', Buffer.from(JSON.stringify(failingProject))));
  await page.waitForFunction(() => document.querySelector('#status-text')?.textContent?.includes('项目文件载入失败'));

  const restored = await page.evaluate(() => ({
    status: document.querySelector('#status-text')?.textContent?.trim() || '',
    song: window.Store.snapshot.meta.song,
    fontName: window.Store.snapshot.config.fontName,
    assets: window.AssetManager.status,
    readiness: window.Preflight.getRenderReadiness()
  }));

  assert.match(restored.status, /项目文件载入失败/);
  assert.equal(restored.song, 'ROLLBACK BASELINE');
  assert.equal(restored.fontName, 'Orbitron');
  assert.equal(restored.assets.cover.valid, true);
  assert.equal(restored.assets.video.valid, true);
  assert.equal(restored.assets.audio.valid, true);
  assert.equal(restored.assets.logo.valid, true);
  assert.equal(restored.readiness.recordReady, true);
  assert.deepEqual(pageErrors, []);
  assert.deepEqual(consoleErrors, []);
});

test('fadmv import rejects unbounded manifest asset names before mutating project state', { skip: !playwright && 'Bundled Playwright unavailable' }, async (t) => {
  assert.ok(fs.existsSync(htmlPath), 'index.html should exist');
  const browser = await playwright.chromium.launch({ headless: true });
  t.after(() => browser.close());

  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const consoleErrors = [];
  const pageErrors = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('pageerror', (err) => pageErrors.push(err.message));
  await page.addInitScript(() => localStorage.setItem('fad-mv-autosave', '0'));

  const longName = `${'a'.repeat(220)}.wav`;
  const project = {
    schemaVersion: 1,
    meta: { song: 'MUTATION SHOULD NOT HAPPEN', artist: 'Package Test' },
    config: {},
    layout: {},
    packageAssets: {
      audio: {
        path: 'assets/audio-safe.wav',
        name: longName,
        type: 'audio/wav',
        size: tinyWav().length,
        lastModified: Date.now()
      }
    }
  };
  const packageBytes = fadmvPackage(project, { 'assets/audio-safe.wav': tinyWav() });

  await gotoApp(page);
  await page.waitForFunction(() => document.readyState === 'complete');
  await setProjectFields(page, { song: 'BASELINE PROJECT', artist: 'openFAD Fixture Artist' });

  await page.setInputFiles('#in-package-file', filePayload('bad-name.fadmv', 'application/zip', packageBytes));
  await page.waitForFunction(() => window.UI?.warnings?.some((warning) => /Asset name too long|Invalid asset name|Unsafe asset name/.test(warning.text || '')));
  const result = await page.evaluate(() => ({
    message: window.UI.warnings.map((warning) => warning.text).join('\n'),
    song: window.Store.snapshot.meta.song
  }));

  assert.match(result.message, /Asset name too long|Invalid asset name|Unsafe asset name/);
  assert.equal(result.song, 'BASELINE PROJECT');
  assert.deepEqual(pageErrors, []);
  assert.deepEqual(consoleErrors, []);
});

test('fadmv import cancellation interrupts packaged asset preflight before applying stale package state', { skip: !playwright && 'Bundled Playwright unavailable' }, async (t) => {
  assert.ok(fs.existsSync(htmlPath), 'index.html should exist');
  const browser = await playwright.chromium.launch({ headless: true });
  t.after(() => browser.close());

  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const consoleErrors = [];
  const pageErrors = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('pageerror', (err) => pageErrors.push(err.message));
  await page.addInitScript(() => localStorage.setItem('fad-mv-autosave', '0'));

  const project = {
    schemaVersion: 1,
    meta: { song: 'STALE PACKAGE SHOULD NOT APPLY', artist: 'Package Test' },
    config: {},
    layout: {},
    packageAssets: {
      audio: {
        path: 'assets/audio-safe.wav',
        name: 'audio-safe.wav',
        type: 'audio/wav',
        size: tinyWav().length,
        lastModified: Date.now()
      }
    }
  };
  const packageBytes = fadmvPackage(project, { 'assets/audio-safe.wav': tinyWav() });

  await gotoApp(page);
  await page.waitForFunction(() => document.readyState === 'complete');
  await setProjectFields(page, { song: 'BASELINE PACKAGE PROJECT', artist: 'openFAD Fixture Artist' });
  await page.evaluate(() => {
    window.__packageAudioPreflightCreates = 0;
    window.__packageAudioPreflightLoadCalls = 0;
    const originalCreateElement = document.createElement.bind(document);
    document.createElement = (tagName, options) => {
      const el = originalCreateElement(tagName, options);
      if (String(tagName).toLowerCase() !== 'audio') return el;
      window.__packageAudioPreflightCreates += 1;
      let heldSrc = '';
      Object.defineProperty(el, 'src', {
        configurable: true,
        get() {
          return heldSrc;
        },
        set(value) {
          heldSrc = String(value || '');
        }
      });
      el.load = () => {
        window.__packageAudioPreflightLoadCalls += 1;
      };
      el.pause = () => {};
      const removeAttribute = el.removeAttribute.bind(el);
      el.removeAttribute = (name) => {
        if (String(name).toLowerCase() === 'src') {
          heldSrc = '';
          return;
        }
        removeAttribute(name);
      };
      return el;
    };
  });

  await page.setInputFiles('#in-package-file', filePayload('cancel-preflight.fadmv', 'application/zip', packageBytes));
  await page.waitForFunction(() => window.__packageAudioPreflightCreates > 0);
  await page.click('#btn-cancel-package');
  await page.waitForFunction(() => window.ProjectPackage?.status?.running === false, null, { timeout: 1500 });
  const result = await page.evaluate(() => ({
    audioPreflightCreates: window.__packageAudioPreflightCreates,
    audioPreflightLoadCalls: window.__packageAudioPreflightLoadCalls,
    song: window.Store.snapshot.meta.song,
    warnings: window.UI.warnings.map((warning) => warning.text).join('\n'),
    packageStatus: window.ProjectPackage.status
  }));

  assert.equal(result.audioPreflightCreates, 1);
  assert.ok(result.audioPreflightLoadCalls >= 1);
  assert.equal(result.song, 'BASELINE PACKAGE PROJECT');
  assert.equal(result.packageStatus.running, false);
  assert.match(result.warnings, /项目文件操作已取消/);
  assert.deepEqual(pageErrors, []);
  assert.deepEqual(consoleErrors, []);
});

test('fadmv import cancellation interrupts packaged asset load and rolls back applied package state', { skip: !playwright && 'Bundled Playwright unavailable' }, async (t) => {
  assert.ok(fs.existsSync(htmlPath), 'index.html should exist');
  const browser = await playwright.chromium.launch({ headless: true });
  t.after(() => browser.close());

  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const consoleErrors = [];
  const pageErrors = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('pageerror', (err) => pageErrors.push(err.message));
  await page.addInitScript(() => localStorage.setItem('fad-mv-autosave', '0'));

  const project = {
    schemaVersion: 1,
    meta: { song: 'PACKAGE LOAD SHOULD ROLLBACK', artist: 'Package Test' },
    config: {},
    layout: {},
    packageAssets: {
      audio: {
        path: 'assets/audio-stall.wav',
        name: 'audio-stall.wav',
        type: 'audio/wav',
        size: tinyWav().length,
        lastModified: Date.now()
      }
    }
  };
  const packageBytes = fadmvPackage(project, { 'assets/audio-stall.wav': tinyWav() });

  await gotoApp(page);
  await page.waitForFunction(() => document.readyState === 'complete');
  await setProjectFields(page, { song: 'BASELINE PACKAGE PROJECT', artist: 'openFAD Fixture Artist' });
  await page.evaluate(() => {
    window.__packageLoadProbe = { poolAudioLoads: 0, held: false, heldSrc: '' };
    const objectUrlNames = new Map();
    const nativeCreateObjectURL = URL.createObjectURL.bind(URL);
    URL.createObjectURL = function createObjectURL(blob) {
      const url = nativeCreateObjectURL(blob);
      if (blob && typeof blob.name === 'string') objectUrlNames.set(url, blob.name);
      return url;
    };
    const poolAudio = document.querySelector('#pool-audio');
    let heldSrc = '';
    Object.defineProperty(poolAudio, 'src', {
      configurable: true,
      get() {
        return heldSrc;
      },
      set(value) {
        heldSrc = String(value || '');
        window.__packageLoadProbe.heldSrc = heldSrc;
      }
    });
    Object.defineProperty(poolAudio, 'duration', {
      configurable: true,
      get() {
        return 0;
      }
    });
    Object.defineProperty(poolAudio, 'readyState', {
      configurable: true,
      get() {
        return 0;
      }
    });
    poolAudio.load = () => {
      const sourceName = objectUrlNames.get(heldSrc) || '';
      if (sourceName === 'audio-stall.wav') {
        window.__packageLoadProbe.poolAudioLoads += 1;
        window.__packageLoadProbe.held = true;
        return undefined;
      }
      return undefined;
    };
    const nativeRemoveAttribute = poolAudio.removeAttribute.bind(poolAudio);
    poolAudio.removeAttribute = (name) => {
      if (String(name).toLowerCase() === 'src') {
        heldSrc = '';
        window.__packageLoadProbe.heldSrc = '';
        return;
      }
      nativeRemoveAttribute(name);
    };
  });

  await page.setInputFiles('#in-package-file', filePayload('cancel-load.fadmv', 'application/zip', packageBytes));
  await page.waitForFunction(() => window.__packageLoadProbe?.held === true);
  const appliedBeforeCancel = await page.evaluate(() => window.Store.snapshot.meta.song);
  await page.click('#btn-cancel-package');
  await page.waitForFunction(() => window.ProjectPackage?.status?.running === false, null, { timeout: 1500 });
  const result = await page.evaluate((appliedSong) => ({
    probe: window.__packageLoadProbe,
    appliedBeforeCancel: appliedSong,
    song: window.Store.snapshot.meta.song,
    audio: window.AssetManager.status.audio,
    warnings: window.UI.warnings.map((warning) => warning.text).join('\n'),
    packageStatus: window.ProjectPackage.status
  }), appliedBeforeCancel);

  assert.equal(result.appliedBeforeCancel, 'PACKAGE LOAD SHOULD ROLLBACK');
  assert.equal(result.probe.poolAudioLoads, 1);
  assert.equal(result.song, 'BASELINE PACKAGE PROJECT');
  assert.equal(result.audio.valid, false);
  assert.equal(result.packageStatus.running, false);
  assert.match(result.warnings, /项目文件操作已取消/);
  assert.deepEqual(pageErrors, []);
  assert.deepEqual(consoleErrors, []);
});

test('large package import remains responsive and cancellable during CRC work', { skip: !playwright && 'Bundled Playwright unavailable' }, async (t) => {
  assert.ok(fs.existsSync(htmlPath), 'index.html should exist');
  const browser = await playwright.chromium.launch({ headless: true });
  t.after(() => browser.close());

  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const consoleErrors = [];
  const pageErrors = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('pageerror', (err) => pageErrors.push(err.message));
  await page.addInitScript(() => {
    localStorage.setItem('fad-mv-autosave', '0');
    const nativeArrayBuffer = Blob.prototype.arrayBuffer;
    Blob.prototype.arrayBuffer = function arrayBuffer(...args) {
      const probe = window.__packageImportResponsiveness;
      if (probe && this.size >= 2 * 1024 * 1024) probe.largeChunkReads += 1;
      return nativeArrayBuffer.apply(this, args);
    };
  });

  const largeCover = Buffer.concat([tinyPng, Buffer.alloc(24 * 1024 * 1024)]);
  const project = {
    schemaVersion: 1,
    meta: { song: 'LARGE PACKAGE SHOULD NOT APPLY', artist: 'Package Test' },
    config: {},
    layout: {},
    packageAssets: {
      cover: {
        path: 'assets/cover-large.png',
        name: 'cover-large.png',
        type: 'image/png',
        size: largeCover.length,
        lastModified: Date.now()
      }
    }
  };
  const packageBytes = fadmvPackage(project, { 'assets/cover-large.png': largeCover });

  await gotoApp(page);
  await page.waitForFunction(() => document.readyState === 'complete');
  await setProjectFields(page, { song: 'BASELINE IMPORT RESPONSIVE', artist: 'openFAD Fixture Artist' });
  await page.evaluate(() => {
    const startedAt = performance.now();
    window.__packageImportResponsiveness = {
      startedAt,
      lastTickAt: startedAt,
      monitoredLastTickAt: 0,
      monitoringAt: 0,
      tickCount: 0,
      rawMaxGapMs: 0,
      maxGapMs: 0,
      firstProgressAt: 0,
      largeChunkReads: 0,
      cancelRequestedAt: 0,
      cancellingSeenAt: 0,
      finishedAt: 0,
      finalStatusText: '',
      timer: 0
    };
    window.__packageImportResponsiveness.timer = setInterval(() => {
      const probe = window.__packageImportResponsiveness;
      const now = performance.now();
      probe.rawMaxGapMs = Math.max(probe.rawMaxGapMs, now - probe.lastTickAt);
      probe.lastTickAt = now;
      probe.tickCount += 1;
      const status = window.ProjectPackage?.status;
      const appImporting = status?.running && status.progress?.stage === '正在载入完整项目' && status.progress.total > 1;
      if (appImporting && !probe.monitoringAt) {
        probe.monitoringAt = now;
        probe.monitoredLastTickAt = now;
      } else if (appImporting) {
        probe.maxGapMs = Math.max(probe.maxGapMs, now - probe.monitoredLastTickAt);
        probe.monitoredLastTickAt = now;
      }
      if (status?.running && status.progress?.stage === '正在载入完整项目' && status.progress.loaded > 0 && !probe.firstProgressAt) {
        probe.firstProgressAt = now;
      }
      if (status?.running && probe.largeChunkReads > 0 && !status.cancelling && !probe.cancelRequestedAt) {
        probe.cancelRequestedAt = now;
        document.querySelector('#btn-cancel-package')?.click();
        const afterCancel = window.ProjectPackage?.status;
        if (afterCancel?.cancelling && !probe.cancellingSeenAt) probe.cancellingSeenAt = performance.now();
      }
      if (status?.cancelling && !probe.cancellingSeenAt) probe.cancellingSeenAt = now;
      if (probe.cancelRequestedAt && !status?.running && !probe.finishedAt) {
        probe.finishedAt = now;
        probe.finalStatusText = document.querySelector('#status-text')?.textContent?.trim() || '';
      }
    }, 5);
  });

  await page.setInputFiles('#in-package-file', filePayload('large-import-cancel.fadmv', 'application/zip', packageBytes));
  await page.waitForFunction(() => window.__packageImportResponsiveness?.finishedAt > 0, null, { timeout: 10000 });
  const result = await page.evaluate(() => {
    clearInterval(window.__packageImportResponsiveness.timer);
    const { timer, ...probe } = window.__packageImportResponsiveness;
    return {
      ...probe,
      status: window.ProjectPackage.status,
      song: window.Store.snapshot.meta.song,
      warnings: window.UI.warnings.map((warning) => warning.text).join('\n')
    };
  });

  assert.ok(result.largeChunkReads >= 1, `import should enter large payload CRC work: ${JSON.stringify(result)}`);
  assert.ok(result.tickCount > 4, `event loop should keep ticking during package import: ${JSON.stringify(result)}`);
  assert.ok(result.monitoringAt > 0, `package import responsiveness monitor should start after app-owned package reads begin: ${JSON.stringify(result)}`);
  assert.ok(result.maxGapMs < 180, `package import CRC should not monopolize the main thread, max app-owned gap ${result.maxGapMs}ms; raw file-selection gap ${result.rawMaxGapMs}ms`);
  assert.ok(result.firstProgressAt > 0, `package import progress should advance before cancellation: ${JSON.stringify(result)}`);
  assert.ok(result.cancelRequestedAt > 0, `cancel should be requested during package import CRC: ${JSON.stringify(result)}`);
  assert.ok(result.cancellingSeenAt >= result.cancelRequestedAt, `cancelling state should become observable: ${JSON.stringify(result)}`);
  assert.ok(result.cancellingSeenAt - result.cancelRequestedAt < 120, `cancel UI should react quickly, took ${result.cancellingSeenAt - result.cancelRequestedAt}ms`);
  assert.ok(result.finishedAt - result.cancelRequestedAt < 1200, `cancelled import should unlock promptly, took ${result.finishedAt - result.cancelRequestedAt}ms`);
  assert.equal(result.status.running, false);
  assert.equal(result.song, 'BASELINE IMPORT RESPONSIVE');
  assert.match(`${result.finalStatusText}\n${result.warnings}`, /项目文件操作已取消/i);
  assert.deepEqual(pageErrors, []);
  assert.deepEqual(consoleErrors, []);
});

test('fadmv import rejects project-declared assets missing from packageAssets before clearing current assets', { skip: !playwright && 'Bundled Playwright unavailable' }, async (t) => {
  assert.ok(fs.existsSync(htmlPath), 'index.html should exist');
  const browser = await playwright.chromium.launch({ headless: true });
  t.after(() => browser.close());

  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const consoleErrors = [];
  const pageErrors = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('pageerror', (err) => pageErrors.push(err.message));
  await page.addInitScript(() => localStorage.setItem('fad-mv-autosave', '0'));

  const project = {
    schemaVersion: 1,
    meta: { song: 'INCOMPLETE PACKAGE', artist: 'Package Test' },
    config: {},
    layout: {},
    assets: { audio: 'missing-master.wav' }
  };
  const packageBytes = fadmvPackage(project);

  await gotoApp(page);
  await page.waitForFunction(() => document.readyState === 'complete');
  await page.setInputFiles('#in-cover', filePayload('cover.png', 'image/png', tinyPng));
  await page.waitForFunction(() => window.AssetManager?.status?.cover?.valid === true);
  await page.setInputFiles('#in-logo', filePayload('logo.png', 'image/png', tinyPng));
  await page.waitForFunction(() => window.AssetManager?.status?.logo?.valid === true);
  await page.setInputFiles('#in-video', filePayload('center.png', 'image/png', tinyPng));
  await page.waitForFunction(() => window.AssetManager?.status?.video?.valid === true);
  await page.setInputFiles('#in-audio', filePayload('baseline.wav', 'audio/wav', tinyWav()));
  await page.waitForFunction(() => window.AssetManager?.status?.audio?.valid === true);
  await setProjectFields(page, { song: 'BASELINE PACKAGE PROJECT', artist: 'openFAD Fixture Artist' });

  await page.setInputFiles('#in-package-file', filePayload('incomplete.fadmv', 'application/zip', packageBytes));
  await page.waitForFunction(() => window.UI?.warnings?.some((warning) => /完整项目缺少声明的 audio 素材/.test(warning.text || '')));
  const result = await page.evaluate(() => ({
    message: window.UI.warnings.map((warning) => warning.text).join('\n'),
    song: window.Store.snapshot.meta.song,
    assets: window.AssetManager.status
  }));

  assert.match(result.message, /完整项目缺少声明的 audio 素材/);
  assert.equal(result.song, 'BASELINE PACKAGE PROJECT');
  assert.equal(result.assets.audio.valid, true);
  assert.equal(result.assets.audio.name, 'baseline.wav');
  assert.equal(result.assets.cover.valid, true);
  assert.equal(result.assets.video.valid, true);
  assert.equal(result.assets.logo.valid, true);
  assert.deepEqual(pageErrors, []);
  assert.deepEqual(consoleErrors, []);
});

test('center video asset load leaves secondary decoder idle until loop prewarm', { skip: !playwright && 'Bundled Playwright unavailable' }, async (t) => {
  assert.ok(fs.existsSync(htmlPath), 'index.html should exist');
  const browser = await playwright.chromium.launch({ headless: true });
  t.after(() => browser.close());

  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const consoleErrors = [];
  const pageErrors = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('pageerror', (err) => pageErrors.push(err.message));
  await page.addInitScript(() => {
    window.__videoLoadProbe = { primaryLoads: 0, secondaryLoads: 0 };
    Object.defineProperty(HTMLVideoElement.prototype, 'videoWidth', {
      configurable: true,
      get() { return this.id === 'pool-video' || this.id === 'pool-video-b' ? 1280 : 0; }
    });
    Object.defineProperty(HTMLVideoElement.prototype, 'videoHeight', {
      configurable: true,
      get() { return this.id === 'pool-video' || this.id === 'pool-video-b' ? 720 : 0; }
    });
    Object.defineProperty(HTMLMediaElement.prototype, 'duration', {
      configurable: true,
      get() { return this.id === 'pool-video' || this.id === 'pool-video-b' ? 12 : 0; }
    });
    Object.defineProperty(HTMLMediaElement.prototype, 'readyState', {
      configurable: true,
      get() { return this.id === 'pool-video' || this.id === 'pool-video-b' ? 4 : 0; }
    });
    HTMLMediaElement.prototype.load = function load() {
      if (this.id === 'pool-video' && this.src) window.__videoLoadProbe.primaryLoads += 1;
      if (this.id === 'pool-video-b' && this.src) window.__videoLoadProbe.secondaryLoads += 1;
      if (this.id === 'pool-video' || this.id === 'pool-video-b') {
        setTimeout(() => {
          this.onloadedmetadata?.();
          this.oncanplay?.();
        }, 0);
      }
      return undefined;
    };
  });

  await gotoApp(page);
  await page.waitForFunction(() => document.readyState === 'complete');
  await page.setInputFiles('#in-video', filePayload('center.mp4', 'video/mp4', Buffer.from([0, 0, 0, 0])));
  await page.waitForFunction(() => window.AssetManager?.status?.video?.valid === true);

  const loaded = await page.evaluate(() => ({
    probe: window.__videoLoadProbe,
    primaryHasSrc: !!document.querySelector('#pool-video')?.src,
    secondaryHasSrc: !!document.querySelector('#pool-video-b')?.src
  }));

  assert.equal(loaded.probe.primaryLoads, 1);
  assert.equal(loaded.probe.secondaryLoads, 0);
  assert.equal(loaded.primaryHasSrc, true);
  assert.equal(loaded.secondaryHasSrc, false);
  assert.deepEqual(pageErrors, []);
  assert.deepEqual(consoleErrors, []);
});

test('autosave writes already in flight block restore until save settles', { skip: !playwright && 'Bundled Playwright unavailable' }, async (t) => {
  assert.ok(fs.existsSync(htmlPath), 'index.html should exist');
  const browser = await playwright.chromium.launch({ headless: true });
  t.after(() => browser.close());

  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const consoleErrors = [];
  const pageErrors = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('pageerror', (err) => pageErrors.push(err.message));
  await page.addInitScript(() => {
    window.__autosaveGate = { enabled: false, calls: 0, release: null, saveResult: '' };
    const storage = navigator.storage || {};
    const nativeEstimate = typeof storage.estimate === 'function'
      ? storage.estimate.bind(storage)
      : () => Promise.resolve({ quota: 1024 * 1024 * 1024, usage: 0 });
    Object.defineProperty(storage, 'estimate', {
      configurable: true,
      value: () => {
        if (!window.__autosaveGate.enabled) return nativeEstimate();
        window.__autosaveGate.calls += 1;
        return new Promise((resolve) => {
          window.__autosaveGate.release = () => resolve({ quota: 1024 * 1024 * 1024, usage: 0 });
        });
      }
    });
    if (!navigator.storage) {
      Object.defineProperty(navigator, 'storage', { configurable: true, value: storage });
    }
  });
  await gotoApp(page);
  await page.waitForFunction(() => document.readyState === 'complete');
  await page.waitForFunction(() => window.AutoSave?.status?.available === true);
  await page.evaluate(() => { document.querySelector('#in-autosave').checked = false; });

  const setSong = async (song) => {
    await setProjectFields(page, { song, artist: 'Autosave Race' });
  };

  await setSong('RESTORE_B');
  await saveSnapshotViaUi(page, 'RESTORE_B');
  await setSong('STALE_A');
  await page.evaluate(() => {
    window.__autosaveGate.enabled = true;
    window.__autosaveGate.calls = 0;
  });
  await page.click('#btn-save-snapshot');
  await page.waitForFunction(() => window.__autosaveGate.calls >= 1);

  const blockedRestore = await page.evaluate(() => ({
    song: window.Store?.snapshot?.meta?.song || '',
    saving: window.AutoSave?.status?.saving,
    restoreDisabled: document.querySelector('#btn-restore-latest')?.disabled,
    restoreReason: document.querySelector('#btn-restore-latest')?.dataset.disabledReason || '',
    autosaveSummary: document.querySelector('#autosave-summary')?.textContent?.trim() || ''
  }));
  assert.equal(blockedRestore.song, 'STALE_A');
  assert.equal(blockedRestore.saving, true);
  assert.equal(blockedRestore.restoreDisabled, true);
  assert.match(blockedRestore.restoreReason, /正在保存快照|自动保存中/);
  assert.match(blockedRestore.autosaveSummary, /正在保存快照|自动保存暂时等待中/);

  await page.evaluate(() => {
    window.__autosaveGate.enabled = false;
    window.__autosaveGate.release?.();
  });
  await page.waitForFunction(() => window.AutoSave?.status?.saving === false);
  await page.waitForFunction(() => Array.from(document.querySelector('#recent-projects')?.options || []).some((option) => /STALE_A/.test(option.textContent || '')));
  await setSong('PLACEHOLDER');
  await page.click('#btn-restore-latest');
  await page.waitForFunction(() => window.Store?.snapshot?.meta?.song === 'STALE_A');
  const finalState = await page.evaluate(() => ({
    song: window.Store.snapshot.meta.song,
    recentText: Array.from(document.querySelector('#recent-projects')?.options || []).map((option) => option.textContent).join(' | ')
  }));

  assert.equal(finalState.song, 'STALE_A');
  assert.match(finalState.recentText, /STALE_A/);
  assert.deepEqual(pageErrors, []);
  assert.deepEqual(consoleErrors, []);
});

test('manual autosave already in flight blocks JSON import until save settles', { skip: !playwright && 'Bundled Playwright unavailable' }, async (t) => {
  assert.ok(fs.existsSync(htmlPath), 'index.html should exist');
  const browser = await playwright.chromium.launch({ headless: true });
  t.after(() => browser.close());

  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const consoleErrors = [];
  const pageErrors = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('pageerror', (err) => pageErrors.push(err.message));
  await page.addInitScript(() => {
    window.__autosaveGate = { enabled: false, calls: 0, release: null };
    const storage = navigator.storage || {};
    const nativeEstimate = typeof storage.estimate === 'function'
      ? storage.estimate.bind(storage)
      : () => Promise.resolve({ quota: 1024 * 1024 * 1024, usage: 0 });
    Object.defineProperty(storage, 'estimate', {
      configurable: true,
      value: () => {
        if (!window.__autosaveGate.enabled) return nativeEstimate();
        window.__autosaveGate.calls += 1;
        return new Promise((resolve) => {
          window.__autosaveGate.release = () => resolve({ quota: 1024 * 1024 * 1024, usage: 0 });
        });
      }
    });
    if (!navigator.storage) {
      Object.defineProperty(navigator, 'storage', { configurable: true, value: storage });
    }
  });

  await gotoApp(page);
  await page.waitForFunction(() => document.readyState === 'complete');
  await page.waitForFunction(() => window.AutoSave?.status?.available === true);
  await page.evaluate(() => { document.querySelector('#in-autosave').checked = false; });

  await setProjectFields(page, { song: 'JSON_IMPORT_BASE', artist: 'Autosave Race' });
  await saveSnapshotViaUi(page, 'JSON_IMPORT_BASE');
  await setProjectFields(page, { song: 'JSON_IMPORT_STALE', artist: 'Autosave Race' });
  await page.evaluate(() => {
    window.__autosaveGate.enabled = true;
    window.__autosaveGate.calls = 0;
  });
  await page.click('#btn-save-snapshot');
  await page.waitForFunction(() => window.__autosaveGate.calls >= 1);

  const blockedImport = await page.evaluate(() => ({
    song: window.Store?.snapshot?.meta?.song || '',
    saving: window.AutoSave?.status?.saving,
    inputDisabled: document.querySelector('#in-project-file')?.disabled,
    loadDisabled: document.querySelector('#btn-load-project')?.disabled,
    loadReason: document.querySelector('#btn-load-project')?.dataset.disabledReason || '',
    projectSummary: document.querySelector('#project-json-summary')?.textContent?.trim() || ''
  }));
  assert.equal(blockedImport.song, 'JSON_IMPORT_STALE');
  assert.equal(blockedImport.saving, true);
  assert.equal(blockedImport.inputDisabled, true);
  assert.equal(blockedImport.loadDisabled, true);
  assert.match(blockedImport.loadReason, /自动保存中|Locked while autosave is saving|正在保存快照/);

  await page.evaluate(() => {
    window.__autosaveGate.enabled = false;
    window.__autosaveGate.release?.();
  });
  await page.waitForFunction(() => window.AutoSave?.status?.saving === false);
  await page.waitForFunction(() => Array.from(document.querySelector('#recent-projects')?.options || []).some((option) => /JSON_IMPORT_STALE/.test(option.textContent || '')));

  const importedProject = {
    schemaVersion: 1,
    meta: { song: 'JSON_IMPORT_IMPORTED', artist: 'Autosave Race' },
    config: {},
    layout: {},
    assets: {}
  };
  await page.setInputFiles('#in-project-file', filePayload('imported.fad-mv.json', 'application/json', Buffer.from(JSON.stringify(importedProject))));
  await page.waitForFunction(() => window.Store?.snapshot?.meta?.song === 'JSON_IMPORT_IMPORTED');

  await setProjectFields(page, { song: 'JSON_IMPORT_PLACEHOLDER', artist: 'Autosave Race' });
  await page.click('#btn-restore-latest');
  await page.waitForFunction(() => window.Store?.snapshot?.meta?.song !== 'JSON_IMPORT_PLACEHOLDER');

  const finalState = await page.evaluate(() => ({
    song: window.Store.snapshot.meta.song,
    recentText: Array.from(document.querySelector('#recent-projects')?.options || []).map((option) => option.textContent).join(' | ')
  }));

  assert.equal(finalState.song, 'JSON_IMPORT_STALE');
  assert.match(finalState.recentText, /JSON_IMPORT_STALE/);
  assert.deepEqual(pageErrors, []);
  assert.deepEqual(consoleErrors, []);
});

test('manual autosave in flight blocks unload duplicate saves and package import', { skip: !playwright && 'Bundled Playwright unavailable' }, async (t) => {
  assert.ok(fs.existsSync(htmlPath), 'index.html should exist');
  const browser = await playwright.chromium.launch({ headless: true });
  t.after(() => browser.close());

  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const consoleErrors = [];
  const pageErrors = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('pageerror', (err) => pageErrors.push(err.message));
  await page.addInitScript(() => {
    window.__manualSaveGate = { enabled: false, calls: 0, release: null };
    const storage = navigator.storage || {};
    const nativeEstimate = typeof storage.estimate === 'function'
      ? storage.estimate.bind(storage)
      : () => Promise.resolve({ quota: 1024 * 1024 * 1024, usage: 0 });
    Object.defineProperty(storage, 'estimate', {
      configurable: true,
      value: () => {
        if (!window.__manualSaveGate.enabled) return nativeEstimate();
        window.__manualSaveGate.calls += 1;
        return new Promise((resolve) => {
          window.__manualSaveGate.release = () => resolve({ quota: 1024 * 1024 * 1024, usage: 0 });
        });
      }
    });
    if (!navigator.storage) {
      Object.defineProperty(navigator, 'storage', { configurable: true, value: storage });
    }
  });

  await gotoApp(page);
  await page.waitForFunction(() => document.readyState === 'complete');
  await page.waitForFunction(() => window.AutoSave?.status?.available === true);
  await setProjectFields(page, { song: 'MANUAL SAVE LOCK', artist: 'Autosave Race' });
  await page.evaluate(() => {
    window.__manualSaveGate.enabled = true;
    window.__manualSaveGate.calls = 0;
  });
  await page.click('#btn-save-snapshot');
  await page.waitForFunction(() => window.__manualSaveGate.calls >= 1);

  const locked = await page.evaluate(() => {
    const event = new Event('beforeunload', { cancelable: true });
    const dispatched = window.dispatchEvent(event);
    return {
      autosave: window.AutoSave.status,
      unloadPrevented: event.defaultPrevented || dispatched === false,
      saveDisabled: document.querySelector('#btn-save-snapshot')?.disabled,
      packageButtonDisabled: document.querySelector('#btn-load-package')?.disabled,
      packageFileDisabled: document.querySelector('#in-package-file')?.disabled,
      autosaveSummary: document.querySelector('#autosave-summary')?.textContent?.trim() || '',
      packageSummary: document.querySelector('#package-summary')?.textContent?.trim() || ''
    };
  });

  assert.equal(locked.autosave.saving, true);
  assert.equal(locked.unloadPrevented, true);
  assert.equal(locked.saveDisabled, true);
  assert.equal(locked.packageButtonDisabled, true);
  assert.equal(locked.packageFileDisabled, true);
  assert.match(locked.autosaveSummary, /正在自动保存|自动保存暂时等待中/);
  assert.match(locked.packageSummary, /正在保存快照|AUTOSAVE/i);

  await page.evaluate(() => {
    window.__manualSaveGate.enabled = false;
    window.__manualSaveGate.release?.();
  });
  await page.waitForFunction(() => window.AutoSave?.status?.saving === false);
  await page.waitForFunction(() => Array.from(document.querySelector('#recent-projects')?.options || []).some((option) => /MANUAL SAVE LOCK/.test(option.textContent || '')));
  assert.deepEqual(pageErrors, []);
  assert.deepEqual(consoleErrors, []);
});

test('autosave recent read failures disable autosave instead of rendering empty history', { skip: !playwright && 'Bundled Playwright unavailable' }, async (t) => {
  assert.ok(fs.existsSync(htmlPath), 'index.html should exist');
  const browser = await playwright.chromium.launch({ headless: true });
  t.after(() => browser.close());

  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const consoleErrors = [];
  const pageErrors = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('pageerror', (err) => pageErrors.push(err.message));
  await page.addInitScript(() => {
    localStorage.setItem('fad-mv-autosave', '1');
    const nativeGetAll = IDBObjectStore.prototype.getAll;
    IDBObjectStore.prototype.getAll = function getAll(...args) {
      if (this.name === 'snapshots') {
        const req = {};
        setTimeout(() => {
          Object.defineProperty(req, 'error', { configurable: true, value: new Error('forced recent read failure') });
          req.onerror?.();
        }, 0);
        return req;
      }
      return nativeGetAll.apply(this, args);
    };
  });

  await gotoApp(page);
  await page.waitForFunction(() => document.readyState === 'complete');
  await page.waitForFunction(() => document.querySelector('#recent-projects')?.options?.[0]?.textContent?.trim());

  const state = await page.evaluate(() => ({
    available: window.AutoSave.status.available,
    summary: document.querySelector('#autosave-summary')?.textContent?.trim() || '',
    list: document.querySelector('#autosave-list')?.textContent?.replace(/\s+/g, ' ').trim() || '',
    recentText: document.querySelector('#recent-projects')?.options?.[0]?.textContent?.trim() || '',
    saveDisabled: document.querySelector('#btn-save-snapshot')?.disabled,
    restoreDisabled: document.querySelector('#btn-restore-latest')?.disabled,
    recentDisabled: document.querySelector('#recent-projects')?.disabled
  }));

  assert.equal(state.available, false);
  assert.equal(state.summary, '当前浏览器无法自动保存');
  assert.match(state.list, /读取自动保存失败/);
  assert.match(state.recentText, /读取自动保存失败/);
  assert.equal(state.saveDisabled, true);
  assert.equal(state.restoreDisabled, true);
  assert.equal(state.recentDisabled, true);
  assert.doesNotMatch(state.recentText, /No recent snapshots/);
  assert.deepEqual(pageErrors, []);
  assert.deepEqual(consoleErrors, []);
});

test('autosave asset pruning uses key cursor fallback without reading stored asset blobs', { skip: !playwright && 'Bundled Playwright unavailable' }, async (t) => {
  assert.ok(fs.existsSync(htmlPath), 'index.html should exist');
  const browser = await playwright.chromium.launch({ headless: true });
  t.after(() => browser.close());

  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const consoleErrors = [];
  const pageErrors = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('pageerror', (err) => pageErrors.push(err.message));
  await page.addInitScript(() => {
    localStorage.setItem('fad-mv-autosave', '1');
    window.__assetKeyProbe = { getAllAssetCalls: 0, openKeyCursorCalls: 0, openCursorCalls: 0 };
    Object.defineProperty(IDBObjectStore.prototype, 'getAllKeys', {
      configurable: true,
      value: undefined
    });
    const nativeGetAll = IDBObjectStore.prototype.getAll;
    IDBObjectStore.prototype.getAll = function getAll(...args) {
      if (this.name === 'assets') {
        window.__assetKeyProbe.getAllAssetCalls += 1;
        const req = {};
        setTimeout(() => {
          Object.defineProperty(req, 'error', { configurable: true, value: new Error('asset getAll should not be used') });
          req.onerror?.();
        }, 0);
        return req;
      }
      return nativeGetAll.apply(this, args);
    };
    const nativeOpenKeyCursor = IDBObjectStore.prototype.openKeyCursor;
    IDBObjectStore.prototype.openKeyCursor = function openKeyCursor(...args) {
      if (this.name === 'assets') window.__assetKeyProbe.openKeyCursorCalls += 1;
      return nativeOpenKeyCursor.apply(this, args);
    };
    const nativeOpenCursor = IDBObjectStore.prototype.openCursor;
    IDBObjectStore.prototype.openCursor = function openCursor(...args) {
      if (this.name === 'assets') window.__assetKeyProbe.openCursorCalls += 1;
      return nativeOpenCursor.apply(this, args);
    };
  });

  await gotoApp(page);
  await page.waitForFunction(() => document.readyState === 'complete');
  await page.waitForFunction(() => window.AutoSave?.status?.available === true);
  await page.setInputFiles('#in-cover', filePayload('cover.png', 'image/png', tinyPng));
  await page.waitForFunction(() => window.AssetManager?.status?.cover?.valid === true);
  await page.setInputFiles('#in-logo', filePayload('logo.png', 'image/png', tinyPng));
  await page.waitForFunction(() => window.AssetManager?.status?.logo?.valid === true);
  await page.setInputFiles('#in-video', filePayload('center.png', 'image/png', tinyPng));
  await page.waitForFunction(() => window.AssetManager?.status?.video?.valid === true);
  await page.setInputFiles('#in-audio', filePayload('tone.wav', 'audio/wav', tinyWav()));
  await page.waitForFunction(() => window.AssetManager?.status?.audio?.valid === true);
  await setProjectFields(page, { song: 'KEY CURSOR AUTOSAVE', artist: 'openFAD Fixture Artist' });

  await saveSnapshotViaUi(page, 'KEY CURSOR AUTOSAVE');
  const result = await page.evaluate(async () => ({
    ok: true,
    message: '',
    probe: window.__assetKeyProbe,
    recentText: Array.from(document.querySelector('#recent-projects')?.options || []).map((option) => option.textContent).join(' | '),
    statusText: document.querySelector('#status-text')?.textContent || ''
  }));

  assert.equal(result.ok, true, result.message);
  assert.equal(result.probe.getAllAssetCalls, 0);
  assert.ok(result.probe.openKeyCursorCalls >= 1 || result.probe.openCursorCalls >= 1);
  assert.match(result.recentText, /KEY CURSOR AUTOSAVE/);
  assert.match(result.statusText, /快照已保存/);
  assert.deepEqual(pageErrors, []);
  assert.deepEqual(consoleErrors, []);
});

test('autosave snapshots keep same-metadata asset blobs isolated', { skip: !playwright && 'Bundled Playwright unavailable' }, async (t) => {
  assert.ok(fs.existsSync(htmlPath), 'index.html should exist');
  const browser = await playwright.chromium.launch({ headless: true });
  t.after(() => browser.close());

  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const consoleErrors = [];
  const pageErrors = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('pageerror', (err) => pageErrors.push(err.message));
  await page.addInitScript(() => localStorage.setItem('fad-mv-autosave', '1'));
  await gotoApp(page);
  await page.waitForFunction(() => document.readyState === 'complete');
  await page.waitForFunction(() => window.AutoSave?.status?.available === true);

  const lastModified = 1700000000000;
  const audioA = tinyWav({ frequency: 330 });
  const audioB = tinyWav({ frequency: 660 });
  assert.equal(audioA.length, audioB.length, 'fixture files must have identical sizes');

  await setProjectFields(page, { song: 'ASSET ALIAS A', artist: 'Autosave' });
  await setBrowserFile(page, '#in-audio', {
    name: 'same-meta.wav',
    mimeType: 'audio/wav',
    buffer: audioA,
    lastModified
  });
  await page.waitForFunction(() => window.AssetManager?.status?.audio?.valid === true && window.AutoSave?.status?.safeToSave === true);
  await saveSnapshotViaUi(page, 'ASSET ALIAS A');

  await setProjectFields(page, { song: 'ASSET ALIAS B', artist: 'Autosave' });
  await setBrowserFile(page, '#in-audio', {
    name: 'same-meta.wav',
    mimeType: 'audio/wav',
    buffer: audioB,
    lastModified
  });
  await page.waitForFunction(() => window.AssetManager?.status?.audio?.valid === true && window.AutoSave?.status?.safeToSave === true);
  await saveSnapshotViaUi(page, 'ASSET ALIAS B');

  const result = await page.evaluate(async () => {
    const openDb = () => new Promise((resolve, reject) => {
      const req = indexedDB.open('fad-mv-projects');
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error || new Error('db open failed'));
    });
    const requestToPromise = (req) => new Promise((resolve, reject) => {
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error || new Error('idb request failed'));
    });
    const db = await openDb();
    const snapshots = await requestToPromise(db.transaction('snapshots', 'readonly').objectStore('snapshots').getAll());
    const recent = snapshots.filter((snap) => snap.id !== 'latest');
    const bySong = Object.fromEntries(recent.map((snap) => [snap.state?.meta?.song || snap.name, snap]));
    const snapA = bySong['ASSET ALIAS A'];
    const snapB = bySong['ASSET ALIAS B'];
    const assetStore = db.transaction('assets', 'readonly').objectStore('assets');
    const recordA = snapA?.assets?.audio?.id ? await requestToPromise(assetStore.get(snapA.assets.audio.id)) : null;
    const recordB = snapB?.assets?.audio?.id ? await requestToPromise(assetStore.get(snapB.assets.audio.id)) : null;
    const digest = async (record) => {
      if (!record?.file) return '';
      const bytes = new Uint8Array(await record.file.arrayBuffer());
      return Array.from(bytes.slice(44, 72)).join(',');
    };
    return {
      recentSongs: recent.map((snap) => snap.state?.meta?.song || snap.name),
      idA: snapA?.assets?.audio?.id || '',
      idB: snapB?.assets?.audio?.id || '',
      refA: snapA?.assets?.audio || null,
      refB: snapB?.assets?.audio || null,
      digestA: await digest(recordA),
      digestB: await digest(recordB)
    };
  });

  assert.match(result.recentSongs.join(' | '), /ASSET ALIAS A/);
  assert.match(result.recentSongs.join(' | '), /ASSET ALIAS B/);
  assert.equal(result.refA.name, 'same-meta.wav');
  assert.equal(result.refB.name, 'same-meta.wav');
  assert.equal(result.refA.size, audioA.length);
  assert.equal(result.refB.size, audioB.length);
  assert.equal(result.refA.lastModified, lastModified);
  assert.equal(result.refB.lastModified, lastModified);
  assert.notEqual(result.idA, result.idB, 'same-metadata files from different snapshots must not share an asset id');
  assert.notEqual(result.digestA, result.digestB, 'asset records should preserve the distinct saved bytes');
  assert.deepEqual(pageErrors, []);
  assert.deepEqual(consoleErrors, []);
});

test('autosave removes asset blobs when snapshot record write aborts', { skip: !playwright && 'Bundled Playwright unavailable' }, async (t) => {
  assert.ok(fs.existsSync(htmlPath), 'index.html should exist');
  const browser = await playwright.chromium.launch({ headless: true });
  t.after(() => browser.close());

  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const consoleErrors = [];
  const pageErrors = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('pageerror', (err) => pageErrors.push(err.message));
  await page.addInitScript(() => {
    localStorage.setItem('fad-mv-autosave', '1');
    window.__snapshotAbortProbe = { enabled: true, putCalls: 0, aborts: 0, abortErrors: [] };
    const nativePut = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function put(...args) {
      const req = nativePut.apply(this, args);
      if (this.name === 'snapshots' && window.__snapshotAbortProbe.enabled) {
        window.__snapshotAbortProbe.putCalls += 1;
        const tx = this.transaction;
        if (!tx.__fadForcedAbortScheduled) {
          tx.__fadForcedAbortScheduled = true;
          Promise.resolve().then(() => {
            try {
              window.__snapshotAbortProbe.aborts += 1;
              tx.abort();
            } catch (err) {
              window.__snapshotAbortProbe.abortErrors.push(err?.message || String(err));
            }
          });
        }
      }
      return req;
    };
  });
  await gotoApp(page);
  await page.waitForFunction(() => document.readyState === 'complete');
  await page.waitForFunction(() => window.AutoSave?.status?.available === true);

  await setProjectFields(page, { song: 'ORPHAN SNAPSHOT FAIL', artist: 'Autosave' });
  await setBrowserFile(page, '#in-audio', {
    name: 'orphan.wav',
    mimeType: 'audio/wav',
    buffer: tinyWav({ frequency: 520 }),
    lastModified: 1700000001234
  });
  await page.waitForFunction(() => window.AssetManager?.status?.audio?.valid === true && window.AutoSave?.status?.safeToSave === true);
  await page.click('#btn-save-snapshot');
  await page.waitForFunction(() => {
    const status = document.querySelector('#status-text')?.textContent || '';
    return window.__snapshotAbortProbe?.putCalls > 0 && /保存快照失败|自动保存失败/.test(status);
  });

  const result = await page.evaluate(async () => {
    window.__snapshotAbortProbe.enabled = false;
    const openDb = () => new Promise((resolve, reject) => {
      const req = indexedDB.open('fad-mv-projects');
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error || new Error('db open failed'));
    });
    const requestToPromise = (req) => new Promise((resolve, reject) => {
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error || new Error('idb request failed'));
    });
    const db = await openDb();
    const snapshots = await requestToPromise(db.transaction('snapshots', 'readonly').objectStore('snapshots').getAll());
    const assetKeys = await requestToPromise(db.transaction('assets', 'readonly').objectStore('assets').getAllKeys());
    return {
      probe: window.__snapshotAbortProbe,
      snapshots: snapshots.map((snap) => snap.state?.meta?.song || snap.name || snap.id),
      assetKeys,
      statusText: document.querySelector('#status-text')?.textContent || ''
    };
  });

  assert.ok(result.probe.putCalls >= 1, 'snapshot write should have been forced to abort');
  assert.ok(result.probe.aborts >= 1, 'snapshot transaction should have aborted after assets were written');
  assert.deepEqual(result.probe.abortErrors, []);
  assert.doesNotMatch(result.snapshots.join(' | '), /ORPHAN SNAPSHOT FAIL/);
  assert.deepEqual(result.assetKeys, [], 'asset blobs written before an aborted snapshot save should be removed');
  assert.match(result.statusText, /保存快照失败|自动保存失败/);
  assert.deepEqual(pageErrors, []);
  assert.deepEqual(consoleErrors, []);
});

test('primary action deck and status remain visible on first paint across desktop and mobile', { skip: !playwright && 'Bundled Playwright unavailable' }, async (t) => {
  assert.ok(fs.existsSync(htmlPath), 'index.html should exist');
  const browser = await playwright.chromium.launch({ headless: true });
  t.after(() => browser.close());

  const viewports = [
    { name: 'desktop', width: 1440, height: 1000 },
    { name: 'tablet', width: 768, height: 900 },
    { name: 'mobile', width: 390, height: 844 },
    { name: 'mobile-keyboard', width: 390, height: 430 },
    { name: 'mobile-tiny-keyboard', width: 390, height: 360 }
  ];

  for (const viewport of viewports) {
    const page = await browser.newPage({ viewport: { width: viewport.width, height: viewport.height } });
    const consoleErrors = [];
    const pageErrors = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });
    page.on('pageerror', (err) => pageErrors.push(err.message));

    await gotoApp(page, { pro: false });
    await page.waitForFunction(() => document.readyState === 'complete');

    const layout = await page.evaluate(() => {
      const rect = (selector) => {
        const el = document.querySelector(selector);
        if (!el) return null;
        const box = el.getBoundingClientRect();
        return {
          top: box.top,
          bottom: box.bottom,
          height: box.height,
          width: box.width
        };
      };
      const sidebar = rect('.sidebar');
      const actions = rect('#start-controls');
      const status = rect('.status-bar');
	      const blocker = rect('#primary-action-blocker');
	      const canvasWrap = rect('.canvas-wrap');
	      const touchTargets = [
	        '#btn-preview',
	        '#btn-rec',
	        '#lbl-cover',
	        '#in-song'
	      ].map((selector) => {
	        const item = rect(selector);
	        return { selector, height: item?.height || 0, width: item?.width || 0 };
	      });
	      return {
	        sidebar,
	        actions,
	        status,
	        blocker,
	        canvasWrap,
	        touchTargets,
	        bodyScrollWidth: document.body.scrollWidth,
	        documentClientWidth: document.documentElement.clientWidth,
        previewDisabledReason: document.querySelector('#btn-preview')?.dataset.disabledReason || '',
        recordDisabledReason: document.querySelector('#btn-rec')?.dataset.disabledReason || ''
      };
    });

    assert.deepEqual(pageErrors, [], `${viewport.name} should not throw page errors`);
    assert.deepEqual(consoleErrors, [], `${viewport.name} should not log console errors`);
    assert.ok(layout.sidebar, `${viewport.name} sidebar should exist`);
    assert.ok(layout.actions, `${viewport.name} start controls should exist`);
    assert.ok(layout.status, `${viewport.name} status bar should exist`);
    assert.ok(layout.blocker, `${viewport.name} action blocker should exist`);
    assert.ok(layout.canvasWrap, `${viewport.name} preview canvas should exist`);
	    assert.ok(layout.bodyScrollWidth <= layout.documentClientWidth + 2, `${viewport.name} should not introduce horizontal page overflow: ${layout.bodyScrollWidth} > ${layout.documentClientWidth}`);
	    assert.ok(layout.canvasWrap.width <= layout.documentClientWidth + 2, `${viewport.name} preview canvas should fit inside the viewport`);
	    if (viewport.name === 'mobile-tiny-keyboard') {
	      assert.ok(layout.canvasWrap.height >= 220, `${viewport.name} preview canvas should remain inspectable, got ${layout.canvasWrap.height}`);
	      assert.ok(layout.canvasWrap.width >= 120, `${viewport.name} preview canvas should remain wide enough to inspect, got ${layout.canvasWrap.width}`);
	    }
	    if (viewport.name.startsWith('mobile')) {
	      for (const target of layout.touchTargets) {
	        assert.ok(target.height >= 44, `${viewport.name} ${target.selector} should keep a 44px touch target, got ${target.height}`);
	      }
	    }
	    assert.ok(layout.actions.height >= 40, `${viewport.name} action deck should keep a usable hit target`);
    assert.ok(layout.status.height >= 28, `${viewport.name} status bar should not collapse`);
    assert.ok(layout.actions.top >= layout.sidebar.top && layout.actions.bottom <= layout.sidebar.bottom, `${viewport.name} action deck should be visible in the initial sidebar viewport`);
    assert.ok(layout.blocker.top >= layout.sidebar.top && layout.blocker.bottom <= layout.sidebar.bottom, `${viewport.name} blocker should be visible in the initial sidebar viewport`);
    assert.ok(layout.status.top >= layout.sidebar.top && layout.status.bottom <= layout.sidebar.bottom, `${viewport.name} status bar should be visible in the initial sidebar viewport`);
    assert.match(layout.previewDisabledReason, /请先选择背景图/);
    assert.match(layout.recordDisabledReason, /请先选择背景图/);
    await page.close();
  }
});

test('mobile Pro Mode keeps disclosure before advanced sections', { skip: !playwright && 'Bundled Playwright unavailable' }, async (t) => {
  assert.ok(fs.existsSync(htmlPath), 'index.html should exist');
  const browser = await playwright.chromium.launch({ headless: true });
  t.after(() => browser.close());

  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true });
  const consoleErrors = [];
  const pageErrors = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('pageerror', (err) => pageErrors.push(err.message));

  await gotoApp(page, { pro: true });
  await page.waitForFunction(() => document.readyState === 'complete');

  const order = await page.evaluate(() => {
    const top = (selector) => document.querySelector(selector)?.getBoundingClientRect().top ?? -1;
    return {
      expanded: document.querySelector('#btn-toggle-pro')?.getAttribute('aria-expanded') || '',
      advancedVisible: !!document.querySelector('#layout-section')?.offsetParent,
      proToggle: top('#btn-toggle-pro'),
      proSummary: top('#pro-mode-summary'),
      layoutSection: top('#layout-section'),
      advancedVisual: top('#advanced-visual-section')
    };
  });

  assert.equal(order.expanded, 'true');
  assert.equal(order.advancedVisible, true);
  assert.ok(order.proToggle > 0, 'Pro disclosure should have a measured position');
  assert.ok(order.proToggle < order.layoutSection, 'Pro disclosure should precede layout controls on mobile');
  assert.ok(order.proSummary < order.layoutSection, 'Pro summary should precede layout controls on mobile');
  assert.ok(order.layoutSection < order.advancedVisual, 'advanced sections should preserve their internal order');
  assert.deepEqual(pageErrors, []);
  assert.deepEqual(consoleErrors, []);
});

test('mobile short-height authoring keeps blocker and status visible while editing deep controls', { skip: !playwright && 'Bundled Playwright unavailable' }, async (t) => {
  assert.ok(fs.existsSync(htmlPath), 'index.html should exist');
  const browser = await playwright.chromium.launch({ headless: true });
  t.after(() => browser.close());

  const page = await browser.newPage({ viewport: { width: 390, height: 430 }, isMobile: true });
  const consoleErrors = [];
  const pageErrors = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('pageerror', (err) => pageErrors.push(err.message));

  await gotoApp(page);
  await page.waitForFunction(() => document.readyState === 'complete');

  async function focusedLayout(selector) {
    await page.focus(selector);
    await page.waitForTimeout(100);
    return page.evaluate((focusedSelector) => {
      const rect = (selector) => {
        const el = document.querySelector(selector);
        if (!el) return null;
        const box = el.getBoundingClientRect();
        return { top: box.top, bottom: box.bottom, height: box.height, width: box.width };
      };
      const visibleIn = (item, container) => !!item && !!container && item.top >= container.top && item.bottom <= container.bottom;
      const sidebar = rect('.sidebar');
      const target = rect(focusedSelector);
      const blocker = rect('#primary-action-blocker');
      const status = rect('.status-bar');
      return {
        active: document.activeElement?.id || '',
        scrollTop: document.querySelector('.sidebar')?.scrollTop || 0,
        sidebar,
        target,
        blocker,
        status,
        targetVisible: visibleIn(target, sidebar),
        blockerVisible: visibleIn(blocker, sidebar),
        statusVisible: visibleIn(status, sidebar),
        bodyScrollWidth: document.body.scrollWidth,
        documentClientWidth: document.documentElement.clientWidth
      };
    }, selector);
  }

  for (const selector of ['#in-song', '#in-custom-preset-name']) {
    const layout = await focusedLayout(selector);
    assert.equal(layout.active, selector.slice(1), `${selector} should receive focus`);
    assert.ok(layout.bodyScrollWidth <= layout.documentClientWidth + 2, `${selector} focus should not create horizontal overflow`);
    assert.ok(layout.targetVisible, `${selector} should remain visible in the mobile authoring pane`);
    assert.ok(layout.blockerVisible, `${selector} focus should keep the primary blocker visible`);
    assert.ok(layout.statusVisible, `${selector} focus should keep status visible`);
  }

  assert.deepEqual(pageErrors, []);
  assert.deepEqual(consoleErrors, []);
});

test('desktop authoring keeps sticky action reasons and status visible while editing deep controls', { skip: !playwright && 'Bundled Playwright unavailable' }, async (t) => {
  assert.ok(fs.existsSync(htmlPath), 'index.html should exist');
  const browser = await playwright.chromium.launch({ headless: true });
  t.after(() => browser.close());

  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const consoleErrors = [];
  const pageErrors = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('pageerror', (err) => pageErrors.push(err.message));

  await gotoApp(page);
  await page.waitForFunction(() => document.readyState === 'complete');

  async function focusedLayout(selector) {
    await page.focus(selector);
    await page.waitForTimeout(100);
    return page.evaluate((focusedSelector) => {
      const rect = (selector) => {
        const el = document.querySelector(selector);
        if (!el) return null;
        const box = el.getBoundingClientRect();
        return { top: box.top, bottom: box.bottom, height: box.height, width: box.width };
      };
      const visibleIn = (item, container) => !!item && !!container && item.top >= container.top && item.bottom <= container.bottom;
      const sidebar = rect('.sidebar');
      const target = rect(focusedSelector);
      const actions = rect('#start-controls');
      const blocker = rect('#primary-action-blocker');
      const status = rect('.status-bar');
      return {
        active: document.activeElement?.id || '',
        scrollTop: document.querySelector('.sidebar')?.scrollTop || 0,
        sidebar,
        target,
        actions,
        blocker,
        status,
        targetVisible: visibleIn(target, sidebar),
        actionsVisible: visibleIn(actions, sidebar),
        blockerVisible: visibleIn(blocker, sidebar),
        statusVisible: visibleIn(status, sidebar),
        bodyScrollWidth: document.body.scrollWidth,
        documentClientWidth: document.documentElement.clientWidth
      };
    }, selector);
  }

  for (const selector of ['#in-song', '#in-custom-preset-name']) {
    const layout = await focusedLayout(selector);
    assert.equal(layout.active, selector.slice(1), `${selector} should receive focus`);
    assert.ok(layout.bodyScrollWidth <= layout.documentClientWidth + 2, `${selector} focus should not create horizontal overflow`);
    assert.ok(layout.targetVisible, `${selector} should remain visible in the desktop authoring pane`);
    assert.ok(layout.actionsVisible, `${selector} focus should keep the primary actions visible`);
    assert.ok(layout.blockerVisible, `${selector} focus should keep the primary blocker visible`);
    assert.ok(layout.statusVisible, `${selector} focus should keep status visible`);
  }

  assert.deepEqual(pageErrors, []);
  assert.deepEqual(consoleErrors, []);
});

test('keyboard focus reaches the visually top primary actions before asset inputs when ready', { skip: !playwright && 'Bundled Playwright unavailable' }, async (t) => {
  assert.ok(fs.existsSync(htmlPath), 'index.html should exist');
  const browser = await playwright.chromium.launch({ headless: true });
  t.after(() => browser.close());

  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const consoleErrors = [];
  const pageErrors = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('pageerror', (err) => pageErrors.push(err.message));

  await gotoApp(page);
  await page.waitForFunction(() => document.readyState === 'complete');
  await page.setInputFiles('#in-cover', filePayload('cover.png', 'image/png', tinyPng));
  await page.waitForFunction(() => window.AssetManager?.status?.cover?.valid === true);
  await page.setInputFiles('#in-logo', filePayload('logo.png', 'image/png', tinyPng));
  await page.waitForFunction(() => window.AssetManager?.status?.logo?.valid === true);
  await page.setInputFiles('#in-video', filePayload('center.png', 'image/png', tinyPng));
  await page.waitForFunction(() => window.AssetManager?.status?.video?.valid === true);
  await page.setInputFiles('#in-audio', filePayload('tone.wav', 'audio/wav', tinyWav({ durationSec: 0.5 })));
  await page.waitForFunction(() => !document.querySelector('#btn-preview')?.disabled && !document.querySelector('#btn-rec')?.disabled);

  await page.evaluate(() => {
    document.activeElement?.blur?.();
    window.scrollTo(0, 0);
  });
  const focusOrder = [];
  for (let i = 0; i < 8; i += 1) {
    await page.keyboard.press('Tab');
    focusOrder.push(await page.evaluate(() => document.activeElement?.id || document.activeElement?.tagName || ''));
  }

  const previewAt = focusOrder.indexOf('btn-preview');
  const recordAt = focusOrder.indexOf('btn-rec');
  const firstAssetAt = focusOrder.indexOf('in-cover');
  const blockerAt = focusOrder.indexOf('primary-action-blocker');
  assert.ok(previewAt >= 0, `Preview should be reachable in early tab order: ${focusOrder.join(' -> ')}`);
  assert.ok(recordAt >= 0, `Render should be reachable in early tab order: ${focusOrder.join(' -> ')}`);
  assert.ok(firstAssetAt >= 0, `Asset input should be reachable in early tab order: ${focusOrder.join(' -> ')}`);
  assert.equal(blockerAt, -1, `Ready state should not tab through a stale action blocker: ${focusOrder.join(' -> ')}`);
  assert.ok(previewAt < firstAssetAt, `Preview should follow visual order before asset inputs: ${focusOrder.join(' -> ')}`);
  assert.ok(recordAt < firstAssetAt, `Render should follow visual order before asset inputs: ${focusOrder.join(' -> ')}`);
  assert.deepEqual(pageErrors, []);
  assert.deepEqual(consoleErrors, []);
  await page.close();
});

test('retry resume recovery control follows stop controls visual and tab order', { skip: !playwright && 'Bundled Playwright unavailable' }, async (t) => {
  assert.ok(fs.existsSync(htmlPath), 'index.html should exist');
  const browser = await playwright.chromium.launch({ headless: true });
  t.after(() => browser.close());

  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const consoleErrors = [];
  const pageErrors = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('pageerror', (err) => pageErrors.push(err.message));

  await gotoApp(page);
  await page.waitForFunction(() => document.readyState === 'complete');
  await page.evaluate(() => {
    document.querySelector('#start-controls').style.display = 'none';
    document.querySelector('#stop-controls').style.display = 'grid';
    const retry = document.querySelector('#btn-retry-resume');
    retry.style.display = 'block';
    retry.disabled = false;
    retry.removeAttribute('aria-disabled');
    window.scrollTo(0, 0);
  });

  const layout = await page.evaluate(() => {
    const stop = document.querySelector('#stop-controls');
    const retry = document.querySelector('#btn-retry-resume');
    const stopRect = stop.getBoundingClientRect();
    const retryRect = retry.getBoundingClientRect();
    const stopStyle = getComputedStyle(stop);
    const retryStyle = getComputedStyle(retry);
    return {
      stopOrder: stopStyle.order,
      retryOrder: retryStyle.order,
      stopPosition: stopStyle.position,
      retryPosition: retryStyle.position,
      stopTop: stopRect.top,
      stopBottom: stopRect.bottom,
      retryTop: retryRect.top,
      retryBottom: retryRect.bottom
    };
  });

  await page.focus('#btn-finish');
  await page.keyboard.press('Tab');
  const secondFocus = await page.evaluate(() => document.activeElement?.id || '');
  await page.keyboard.press('Tab');
  const thirdFocus = await page.evaluate(() => document.activeElement?.id || '');

  assert.equal(layout.retryOrder, layout.stopOrder);
  assert.equal(layout.retryPosition, layout.stopPosition);
  assert.ok(layout.retryTop >= layout.stopBottom - 1, `Retry Resume should sit after stop controls, got stop ${layout.stopTop}-${layout.stopBottom}, retry ${layout.retryTop}-${layout.retryBottom}`);
  assert.equal(secondFocus, 'btn-abort');
  assert.equal(thirdFocus, 'btn-retry-resume');
  assert.deepEqual(pageErrors, []);
  assert.deepEqual(consoleErrors, []);
});

test('stopping preview returns keyboard focus to visible preview action', { skip: !playwright && 'Bundled Playwright unavailable' }, async (t) => {
  assert.ok(fs.existsSync(htmlPath), 'index.html should exist');
  const browser = await playwright.chromium.launch({ headless: true });
  t.after(() => browser.close());

  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const consoleErrors = [];
  const pageErrors = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('pageerror', (err) => pageErrors.push(err.message));
  await page.addInitScript(() => {
    window.localStorage?.setItem('fad-mv-autosave', '0');
    const nativePause = HTMLMediaElement.prototype.pause;
    HTMLMediaElement.prototype.play = function play() {
      return Promise.resolve();
    };
    HTMLMediaElement.prototype.pause = function pause() {
      try { return nativePause.call(this); } catch (_) { return undefined; }
    };
  });

  await gotoApp(page, { testHooks: true });
  await page.waitForFunction(() => document.readyState === 'complete');
  await page.setInputFiles('#in-cover', filePayload('cover.png', 'image/png', tinyPng));
  await page.waitForFunction(() => window.AssetManager?.status?.cover?.valid === true);
  await page.setInputFiles('#in-logo', filePayload('logo.png', 'image/png', tinyPng));
  await page.waitForFunction(() => window.AssetManager?.status?.logo?.valid === true);
  await page.setInputFiles('#in-video', filePayload('center.png', 'image/png', tinyPng));
  await page.waitForFunction(() => window.AssetManager?.status?.video?.valid === true);
  await page.setInputFiles('#in-audio', filePayload('tone.wav', 'audio/wav', tinyWav({ durationSec: 0.5 })));
  await page.waitForFunction(() => window.AssetManager?.status?.audio?.valid === true);
  await page.waitForFunction(() => !document.querySelector('#btn-preview')?.disabled);

  await page.focus('#btn-preview');
  await page.click('#btn-preview');
  await page.waitForFunction(() => window.Machine?.status === 'PREVIEWING');
  await page.evaluate(() => {
    const activeDescriptor = Object.getOwnPropertyDescriptor(Document.prototype, 'activeElement');
    const readActiveElement = activeDescriptor?.get ? activeDescriptor.get.bind(document) : () => null;
    let forcedActiveElement = null;
    const audio = document.querySelector('#pool-audio');
    const readyStateDescriptor = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'readyState');
    const readAudioReadyState = readyStateDescriptor?.get ? readyStateDescriptor.get.bind(audio) : () => audio?.readyState || 0;
    let forceAudioMetadataDrop = false;
    Object.defineProperty(document, 'activeElement', {
      configurable: true,
      get() {
        if (forcedActiveElement) {
          const element = forcedActiveElement;
          forcedActiveElement = null;
          return element;
        }
        return readActiveElement();
      }
    });
    if (audio) {
      Object.defineProperty(audio, 'readyState', {
        configurable: true,
        get() {
          return forceAudioMetadataDrop ? 0 : readAudioReadyState();
        }
      });
    }
    document.querySelector('#btn-stop-preview')?.addEventListener('click', () => {
      forcedActiveElement = document.querySelector('#in-audio');
      forceAudioMetadataDrop = true;
      try {
        const token = window.__openFADTestHooks.startAutoSaveJob('autosave');
        window.__testAutosaveStarted = true;
        window.setTimeout(() => window.__openFADTestHooks.finishAutoSaveJob(token), 160);
      } catch (err) {
        window.__testAutosaveError = err?.message || String(err);
      }
    }, { capture: true, once: true });
  });
  await page.click('#btn-stop-preview');
  await page.waitForFunction(() => window.Machine?.status === 'IDLE');
  await page.waitForFunction(() => window.__testAutosaveStarted === true || !!window.__testAutosaveError);
  assert.equal(await page.evaluate(() => window.__testAutosaveError || ''), '');
  await page.waitForFunction(() => window.AutoSave?.status?.saving === false);
  await page.waitForFunction(() => {
    const preview = document.querySelector('#btn-preview');
    const startControls = document.querySelector('#start-controls');
    const previewControls = document.querySelector('#preview-controls');
    return window.Machine?.status === 'IDLE' &&
      !!preview &&
      !preview.disabled &&
      document.activeElement === preview &&
      getComputedStyle(startControls).display === 'grid' &&
      getComputedStyle(previewControls).display === 'none';
  });

  const focusState = await page.evaluate(() => {
    const active = document.activeElement;
    const preview = document.querySelector('#btn-preview');
    const startControls = document.querySelector('#start-controls');
    const previewControls = document.querySelector('#preview-controls');
    const rect = active?.getBoundingClientRect?.();
    const style = active ? getComputedStyle(active) : null;
    return {
      activeId: active?.id || active?.tagName || '',
      activeVisible: !!active && style?.display !== 'none' && style?.visibility !== 'hidden' && !!(rect?.width || rect?.height || active.getClientRects().length),
      activeInsideStartControls: !!active && !!startControls?.contains(active),
      previewDisabled: !!preview?.disabled,
      previewReason: preview?.dataset.disabledReason || '',
      startDisplay: getComputedStyle(startControls).display,
      previewControlsDisplay: getComputedStyle(previewControls).display,
      readiness: window.Preflight.getRenderReadiness()
    };
  });

  const focusDiagnostic = () => JSON.stringify(focusState);
  assert.equal(focusState.startDisplay, 'grid');
  assert.equal(focusState.previewControlsDisplay, 'none');
  assert.equal(focusState.previewDisabled, false, focusDiagnostic());
  assert.equal(focusState.previewReason, '', focusDiagnostic());
  assert.equal(focusState.activeId, 'btn-preview', focusDiagnostic());
  assert.equal(focusState.activeVisible, true, focusDiagnostic());
  assert.equal(focusState.activeInsideStartControls, true, focusDiagnostic());
  assert.equal(focusState.readiness.previewReady, true, focusDiagnostic());
  assert.equal(focusState.readiness.aPreviewReady, true, focusDiagnostic());
  assert.deepEqual(pageErrors, []);
  assert.deepEqual(consoleErrors, []);
  await page.close();
});

test('blocked primary action reasons are keyboard reachable before asset inputs', { skip: !playwright && 'Bundled Playwright unavailable' }, async (t) => {
  assert.ok(fs.existsSync(htmlPath), 'index.html should exist');
  const browser = await playwright.chromium.launch({ headless: true });
  t.after(() => browser.close());

  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const consoleErrors = [];
  const pageErrors = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('pageerror', (err) => pageErrors.push(err.message));

  await gotoApp(page);
  await page.waitForFunction(() => document.readyState === 'complete');
  await page.evaluate(() => {
    document.activeElement?.blur?.();
    window.scrollTo(0, 0);
  });

  const focusOrder = [];
  for (let i = 0; i < 9; i += 1) {
    await page.keyboard.press('Tab');
    focusOrder.push(await page.evaluate(() => ({
      id: document.activeElement?.id || document.activeElement?.tagName || '',
      text: document.activeElement?.textContent?.trim().replace(/\s+/g, ' ') || '',
      describedBy: document.activeElement?.getAttribute?.('aria-describedby') || ''
    })));
  }

  const blockerAt = focusOrder.findIndex((item) => item.id === 'primary-action-blocker');
  const firstAssetAt = focusOrder.findIndex((item) => item.id === 'in-cover');
  const visualCoverAt = focusOrder.findIndex((item) => item.id === 'btn-visual-cover');
  assert.ok(blockerAt >= 0, `Blocked action reason should be reachable in early tab order: ${focusOrder.map((item) => item.id).join(' -> ')}`);
  assert.ok(firstAssetAt >= 0, `Asset input should remain reachable in early tab order: ${focusOrder.map((item) => item.id).join(' -> ')}`);
  assert.ok(visualCoverAt >= 0, `Visual system choice should stay keyboard reachable before asset inputs: ${focusOrder.map((item) => item.id).join(' -> ')}`);
  assert.ok(visualCoverAt < firstAssetAt, `Visual system choice should precede asset inputs: ${focusOrder.map((item) => item.id).join(' -> ')}`);
  assert.ok(blockerAt < firstAssetAt, `Blocked action reason should precede asset inputs: ${focusOrder.map((item) => item.id).join(' -> ')}`);
  assert.match(focusOrder[blockerAt].text, /请先选择背景图/);
  assert.equal(focusOrder[blockerAt].describedBy, 'preflight-summary');
  assert.deepEqual(pageErrors, []);
  assert.deepEqual(consoleErrors, []);
});

test('reduced-motion preference suppresses runtime canvas effects without mutating project settings', { skip: !playwright && 'Bundled Playwright unavailable' }, async (t) => {
  assert.ok(fs.existsSync(htmlPath), 'index.html should exist');
  const browser = await playwright.chromium.launch({ headless: true });
  t.after(() => browser.close());

  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const consoleErrors = [];
  const pageErrors = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('pageerror', (err) => pageErrors.push(err.message));
  await page.emulateMedia({ reducedMotion: 'reduce' });

  await gotoApp(page);
  await page.waitForFunction(() => document.readyState === 'complete');

  const initial = await page.evaluate(() => ({
    mediaMatches: window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    diagnostics: window.Engine?.diagnostics,
    config: window.Store?.snapshot?.config,
    motionText: document.querySelector('#motion-policy-summary')?.textContent || '',
    fxInput: document.querySelector('#in-fx-intensity')?.value,
    glowInput: document.querySelector('#in-glow-amount')?.value,
    glitchInput: document.querySelector('#in-glitch')?.checked
  }));

  assert.equal(initial.mediaMatches, true);
  assert.equal(initial.config.glitch, true);
  assert.equal(initial.config.visFxIntensity, 1);
  assert.equal(initial.config.visGlowAmount, 1);
  assert.equal(initial.fxInput, '100');
  assert.equal(initial.glowInput, '100');
  assert.equal(initial.glitchInput, true);
  assert.equal(initial.diagnostics.motionReduced, true);
  assert.equal(initial.diagnostics.effectiveVisualConfig.glitch, false);
  assert.equal(initial.diagnostics.effectiveVisualConfig.visFxIntensity, 0);
  assert.equal(initial.diagnostics.effectiveVisualConfig.visGlowAmount, 0);
  assert.match(initial.motionText, /Reduced motion/i);

  const afterExplicitControls = await page.evaluate(() => {
    const fx = document.querySelector('#in-fx-intensity');
    const glow = document.querySelector('#in-glow-amount');
    const glitch = document.querySelector('#in-glitch');
    fx.value = '200';
    glow.value = '200';
    glitch.checked = true;
    fx.dispatchEvent(new Event('input', { bubbles: true }));
    glow.dispatchEvent(new Event('input', { bubbles: true }));
    glitch.dispatchEvent(new Event('change', { bubbles: true }));
    return {
      diagnostics: window.Engine.diagnostics,
      config: window.Store.snapshot.config,
      fxInput: fx.value,
      glowInput: glow.value,
      glitchInput: glitch.checked
    };
  });

  assert.equal(afterExplicitControls.config.glitch, true);
  assert.equal(afterExplicitControls.config.visFxIntensity, 2);
  assert.equal(afterExplicitControls.config.visGlowAmount, 2);
  assert.equal(afterExplicitControls.fxInput, '200');
  assert.equal(afterExplicitControls.glowInput, '200');
  assert.equal(afterExplicitControls.glitchInput, true);
  assert.equal(afterExplicitControls.diagnostics.effectiveVisualConfig.glitch, false);
  assert.equal(afterExplicitControls.diagnostics.effectiveVisualConfig.visFxIntensity, 0);
  assert.equal(afterExplicitControls.diagnostics.effectiveVisualConfig.visGlowAmount, 0);
  assert.deepEqual(pageErrors, []);
  assert.deepEqual(consoleErrors, []);
  await page.close();
});

test('performance throttle reduces effective visual workload after long tasks', { skip: !playwright && 'Bundled Playwright unavailable' }, async (t) => {
  assert.ok(fs.existsSync(htmlPath), 'index.html should exist');
  const browser = await playwright.chromium.launch({ headless: true });
  t.after(() => browser.close());

  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const consoleErrors = [];
  const pageErrors = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('pageerror', (err) => pageErrors.push(err.message));
  await page.addInitScript(() => {
    function FakePerformanceObserver(callback) {
      window.__longTaskObserverCallback = callback;
      this.observe = () => {};
      this.disconnect = () => {};
    }
    FakePerformanceObserver.supportedEntryTypes = ['longtask'];
    window.PerformanceObserver = FakePerformanceObserver;
    window.__emitLongTask = (duration) => {
      window.__longTaskObserverCallback?.({
        getEntries: () => [{ duration }]
      });
    };

    const nativePause = HTMLMediaElement.prototype.pause;
    HTMLMediaElement.prototype.play = function play() {
      return Promise.resolve();
    };
    HTMLMediaElement.prototype.pause = function pause() {
      try { return nativePause.call(this); } catch (_) { return undefined; }
    };
  });

  await gotoApp(page);
  await page.waitForFunction(() => document.readyState === 'complete');
  await page.setInputFiles('#in-cover', filePayload('cover.png', 'image/png', tinyPng));
  await page.waitForFunction(() => window.AssetManager?.status?.cover?.valid === true);
  await page.setInputFiles('#in-logo', filePayload('logo.png', 'image/png', tinyPng));
  await page.waitForFunction(() => window.AssetManager?.status?.logo?.valid === true);
  await page.setInputFiles('#in-video', filePayload('center.png', 'image/png', tinyPng));
  await page.waitForFunction(() => window.AssetManager?.status?.video?.valid === true);
  await page.setInputFiles('#in-audio', filePayload('tone.wav', 'audio/wav', tinyWav({ durationSec: 0.5 })));
  await page.waitForFunction(() => window.AssetManager?.status?.audio?.valid === true);
  await page.waitForFunction(() => !document.querySelector('#btn-preview')?.disabled);

  const before = await page.evaluate(() => window.Engine.diagnostics.effectiveVisualConfig);
  await page.click('#btn-preview');
  await page.waitForFunction(() => window.Machine?.status === 'PREVIEWING');
  const throttled = await page.evaluate(() => {
    window.__emitLongTask(240);
    const diagnostics = window.Engine.diagnostics;
    return {
      diagnostics,
      status: document.querySelector('#status-text')?.textContent?.trim() || '',
      warning: document.querySelector('#warning-log')?.textContent?.replace(/\s+/g, ' ').trim() || ''
    };
  });

  assert.equal(before.performanceThrottled, false);
  assert.equal(before.glitch, true);
  assert.equal(before.visSensitivity, 1);
  assert.equal(before.visFxIntensity, 1);
  assert.equal(before.visGlowAmount, 1);
  assert.equal(throttled.diagnostics.performanceThrottle, true);
  assert.equal(throttled.diagnostics.longTaskCount, 1);
  assert.equal(throttled.diagnostics.effectiveVisualConfig.performanceThrottled, true);
  assert.equal(throttled.diagnostics.effectiveVisualConfig.glitch, false);
  assert.equal(throttled.diagnostics.effectiveVisualConfig.visSensitivity, 0.35);
  assert.equal(throttled.diagnostics.effectiveVisualConfig.visFxIntensity, 0.35);
  assert.equal(throttled.diagnostics.effectiveVisualConfig.visGlowAmount, 0.35);
  assert.match(`${throttled.status} ${throttled.warning}`, /当前设备性能吃紧|临时降低.*视觉效果|reducing visual effects/i);
  assert.deepEqual(pageErrors, []);
  assert.deepEqual(consoleErrors, []);
  await page.close();
});

test('performance throttle stops per-frame video fallback cache refresh after long tasks', { skip: !playwright && 'Bundled Playwright unavailable' }, async (t) => {
  assert.ok(fs.existsSync(htmlPath), 'index.html should exist');
  const browser = await playwright.chromium.launch({ headless: true });
  t.after(() => browser.close());

  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const consoleErrors = [];
  const pageErrors = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('pageerror', (err) => pageErrors.push(err.message));
  await page.addInitScript(() => {
    function FakePerformanceObserver(callback) {
      window.__longTaskObserverCallback = callback;
      this.observe = () => {};
      this.disconnect = () => {};
    }
    FakePerformanceObserver.supportedEntryTypes = ['longtask'];
    window.PerformanceObserver = FakePerformanceObserver;
    window.__emitLongTask = (duration) => {
      window.__longTaskObserverCallback?.({
        getEntries: () => [{ duration }]
      });
    };

    window.__videoCacheProbe = { cacheDraws: 0, events: [], offscreenContexts: 0 };
    const contextRoles = new WeakMap();
    const nativeGetContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function getContext(type, options) {
      const ctx = nativeGetContext.call(this, type, options);
      if (type === '2d' && ctx && !contextRoles.has(ctx)) {
        if (this.id === 'cvs') {
          contextRoles.set(ctx, 'main');
        } else {
          window.__videoCacheProbe.offscreenContexts += 1;
          contextRoles.set(ctx, window.__videoCacheProbe.offscreenContexts === 3 ? 'videoFrameCache' : 'offscreen');
        }
      }
      return ctx;
    };
    const nativeDrawImage = CanvasRenderingContext2D.prototype.drawImage;
    CanvasRenderingContext2D.prototype.drawImage = function drawImage(...args) {
      if (contextRoles.get(this) === 'videoFrameCache') {
        window.__videoCacheProbe.cacheDraws += 1;
        window.__videoCacheProbe.events.push({
          atMs: Math.round(performance.now()),
          throttled: !!window.Engine?.diagnostics?.performanceThrottle
        });
      }
      return nativeDrawImage.apply(this, args);
    };

    const nativePause = HTMLMediaElement.prototype.pause;
    HTMLMediaElement.prototype.play = function play() {
      if (!this.__testMediaClockInstalled) {
        this.__testMediaClockInstalled = true;
        this.__testMediaBase = Number(this.currentTime) || 0;
        this.__testMediaStartedAt = performance.now();
        this.__testMediaPlaying = false;
        Object.defineProperty(this, 'paused', {
          configurable: true,
          get() { return !this.__testMediaPlaying; }
        });
        Object.defineProperty(this, 'currentTime', {
          configurable: true,
          get() {
            const elapsed = this.__testMediaPlaying ? ((performance.now() - this.__testMediaStartedAt) / 1000) : 0;
            return this.__testMediaBase + elapsed;
          },
          set(value) {
            this.__testMediaBase = Math.max(0, Number(value) || 0);
            this.__testMediaStartedAt = performance.now();
          }
        });
      }
      this.__testMediaBase = Number(this.currentTime) || 0;
      this.__testMediaStartedAt = performance.now();
      this.__testMediaPlaying = true;
      return Promise.resolve();
    };
    HTMLMediaElement.prototype.pause = function pause() {
      if (this.__testMediaClockInstalled) {
        this.__testMediaBase = Number(this.currentTime) || 0;
        this.__testMediaStartedAt = performance.now();
        this.__testMediaPlaying = false;
      }
      try { return nativePause.call(this); } catch (_) { return undefined; }
    };
  });

  await gotoApp(page);
  await page.waitForFunction(() => document.readyState === 'complete');
  await page.setInputFiles('#in-cover', filePayload('cover.png', 'image/png', tinyPng));
  await page.waitForFunction(() => window.AssetManager?.status?.cover?.valid === true);
  await page.setInputFiles('#in-logo', filePayload('logo.png', 'image/png', tinyPng));
  await page.waitForFunction(() => window.AssetManager?.status?.logo?.valid === true);
  await page.setInputFiles('#in-video', filePayload('center.png', 'image/png', tinyPng));
  await page.waitForFunction(() => window.AssetManager?.status?.video?.valid === true);
  await page.setInputFiles('#in-audio', filePayload('tone.wav', 'audio/wav', tinyWav({ durationSec: 0.75 })));
  await page.waitForFunction(() => window.AssetManager?.status?.audio?.valid === true);
  await page.waitForFunction(() => !document.querySelector('#btn-preview')?.disabled);

  await page.click('#btn-preview');
  await page.waitForFunction(() => window.Machine?.status === 'PREVIEWING');
  await page.waitForFunction(() => window.__videoCacheProbe?.cacheDraws >= 2, null, { timeout: 8000 });

  const throttled = await page.evaluate(() => {
    window.__emitLongTask(240);
    return new Promise((resolve) => {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          window.__videoCacheProbe.cacheDraws = 0;
          window.__videoCacheProbe.events = [];
          resolve(window.Engine.diagnostics);
        });
      });
    });
  });

  await page.waitForTimeout(300);
  const result = await page.evaluate(() => ({
    cacheDraws: window.__videoCacheProbe.cacheDraws,
    events: window.__videoCacheProbe.events,
    diagnostics: window.Engine.diagnostics
  }));

  assert.equal(throttled.performanceThrottle, true);
  assert.equal(result.diagnostics.performanceThrottle, true);
  assert.equal(result.cacheDraws, 0, `throttled frames should reuse the existing fallback frame instead of refreshing cache every frame: ${JSON.stringify(result.events)}`);
  assert.deepEqual(pageErrors, []);
  assert.deepEqual(consoleErrors, []);
  await page.close();
});

test('long non-fatal warnings remain readable after later status updates', { skip: !playwright && 'Bundled Playwright unavailable' }, async (t) => {
  assert.ok(fs.existsSync(htmlPath), 'index.html should exist');
  const browser = await playwright.chromium.launch({ headless: true });
  t.after(() => browser.close());

  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const consoleErrors = [];
  const pageErrors = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('pageerror', (err) => pageErrors.push(err.message));
  await page.addInitScript(() => {
    window.__downloadFailureMessages = [];
    const nativeClick = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function click() {
      const message = window.__downloadFailureMessages?.shift?.();
      if (message) throw new Error(message);
      return nativeClick.call(this);
    };
  });

  await gotoApp(page);
  await page.waitForFunction(() => document.readyState === 'complete');

  const longMsg = 'Package save failed: streaming writer could not flush the final chunk. Recovery: retry export download after the current cleanup finishes, keep this tab foregrounded, and do not start another render until the retry button is enabled.';
  const followUpMsg = 'Audio analysis skipped for this file; render can continue.';
  await page.evaluate(({ longMsg, followUpMsg }) => {
    window.__downloadFailureMessages = [longMsg, followUpMsg];
  }, { longMsg, followUpMsg });
  await page.click('#btn-save-project');
  const before = await page.evaluate(() => {
    const status = document.querySelector('#status-text');
    return {
      statusText: status?.textContent || '',
      statusTitle: status?.title || '',
      statusClientWidth: status?.clientWidth || 0,
      statusScrollWidth: status?.scrollWidth || 0
    };
  });
  await page.click('#btn-save-project');
  const metrics = await page.evaluate((before) => {
    const status = document.querySelector('#status-text');
	    const panel = document.querySelector('#warning-panel');
	    const list = document.querySelector('#warning-list');
	    const live = document.querySelector('#warning-live');
	    const firstItem = document.querySelector('.warning-item');
	    return {
	      before,
	      panelHidden: panel?.hidden,
	      panelRole: panel?.getAttribute('role') || '',
	      panelLive: panel?.getAttribute('aria-live') || '',
	      panelText: list?.textContent || '',
	      listLiveRegionText: list?.textContent?.trim().replace(/\s+/g, ' ') || '',
	      liveRegionText: live?.textContent?.trim().replace(/\s+/g, ' ') || '',
	      clearButtonText: document.querySelector('#btn-clear-warnings')?.textContent?.trim() || '',
	      clearButtonLabel: document.querySelector('#btn-clear-warnings')?.getAttribute('aria-label') || '',
	      listRole: list?.getAttribute('role') || '',
	      listLive: list?.getAttribute('aria-live') || '',
	      liveRole: live?.getAttribute('role') || '',
	      liveLive: live?.getAttribute('aria-live') || '',
	      liveAtomic: live?.getAttribute('aria-atomic') || '',
	      warningCount: window.UI.warnings?.length,
	      statusText: status?.textContent || '',
	      statusTitle: status?.title || '',
      panelClientWidth: panel?.clientWidth || 0,
      panelScrollWidth: panel?.scrollWidth || 0,
      itemWhiteSpace: firstItem ? getComputedStyle(firstItem).whiteSpace : ''
    };
  }, before);

  assert.ok(metrics.before.statusScrollWidth > metrics.before.statusClientWidth, 'mobile status line should reproduce warning truncation pressure');
  assert.equal(metrics.before.statusTitle, `提醒：项目文件下载失败：${longMsg}`);
	  assert.equal(metrics.panelHidden, false);
	  assert.equal(metrics.panelRole, 'document');
	  assert.equal(metrics.panelLive, '');
	  assert.equal(metrics.listRole, '');
	  assert.equal(metrics.listLive, '');
	  assert.equal(metrics.liveRole, 'status');
	  assert.equal(metrics.liveLive, 'polite');
	  assert.equal(metrics.liveAtomic, 'true');
	  assert.equal(metrics.clearButtonLabel, '清空提醒历史');
	  assert.doesNotMatch(metrics.liveRegionText, /清空提醒历史|Clear warning history|×|&times;/);
	  assert.equal(metrics.liveRegionText, `提醒：项目文件下载失败：${followUpMsg}`);
	  assert.ok(metrics.listLiveRegionText.includes(longMsg), 'visible ledger should still contain the first warning');
	  assert.ok(metrics.panelText.includes(longMsg), 'warning ledger should retain the full long warning');
	  assert.ok(metrics.panelText.includes(followUpMsg), 'warning ledger should include later warnings too');
  assert.doesNotMatch(metrics.panelText, /\b(?:AM|PM)WARN:/, 'warning timestamp and label should not be concatenated for assistive text');
  assert.match(metrics.panelText, /continue\.\s+\d{2}:\d{2}:\d{2}/, 'warning entries should keep a text separator between adjacent rows');
  assert.doesNotMatch(metrics.panelText, /continue\.\d{2}:\d{2}:\d{2}/, 'warning entries should not concatenate adjacent rows');
  assert.equal(metrics.warningCount, 2);
  assert.match(metrics.statusText, /项目文件下载失败/);
  assert.match(metrics.statusText, /Audio analysis skipped/);
  assert.equal(metrics.statusTitle, `提醒：项目文件下载失败：${followUpMsg}`);
  assert.ok(metrics.panelScrollWidth <= metrics.panelClientWidth + 2, `warning panel should wrap instead of horizontal overflow: ${metrics.panelScrollWidth} > ${metrics.panelClientWidth}`);
  assert.equal(metrics.itemWhiteSpace, 'normal');
  assert.deepEqual(pageErrors, []);
  assert.deepEqual(consoleErrors, []);
  await page.close();
});

test('overflowing warning ledger is keyboard scrollable', { skip: !playwright && 'Bundled Playwright unavailable' }, async (t) => {
  assert.ok(fs.existsSync(htmlPath), 'index.html should exist');
  const browser = await playwright.chromium.launch({ headless: true });
  t.after(() => browser.close());

  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const consoleErrors = [];
  const pageErrors = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('pageerror', (err) => pageErrors.push(err.message));
  await page.addInitScript(() => {
    window.__downloadFailureMessages = [];
    const nativeClick = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function click() {
      const message = window.__downloadFailureMessages?.shift?.();
      if (message) throw new Error(message);
      return nativeClick.call(this);
    };
  });

  await gotoApp(page);
  await page.waitForFunction(() => document.readyState === 'complete');

  const warnings = Array.from({ length: 5 }, (_, index) => `Keyboard scroll warning ${index + 1}: ${'recovery detail '.repeat(18)}`);
  await page.evaluate((messages) => { window.__downloadFailureMessages = messages.slice(); }, warnings);
  for (let i = 0; i < warnings.length; i += 1) {
    await page.click('#btn-save-project');
  }
  await page.waitForFunction(() => window.UI?.warnings?.length === 5 && document.querySelector('#warning-panel')?.scrollHeight > document.querySelector('#warning-panel')?.clientHeight);

  const before = await page.evaluate(() => {
    const panel = document.querySelector('#warning-panel');
    panel?.focus();
    return {
      activeId: document.activeElement?.id || '',
      tabIndex: panel?.getAttribute('tabindex'),
      role: panel?.getAttribute('role') || '',
      scrollTop: panel?.scrollTop || 0,
      clientHeight: panel?.clientHeight || 0,
      scrollHeight: panel?.scrollHeight || 0
    };
  });

  assert.equal(before.activeId, 'warning-panel');
  assert.equal(before.tabIndex, '0');
  assert.equal(before.role, 'document');
  assert.ok(before.scrollHeight > before.clientHeight, 'warning panel should overflow in this reproduction');

  await page.keyboard.press('PageDown');
  await page.waitForFunction(() => (document.querySelector('#warning-panel')?.scrollTop || 0) > 0);
  const after = await page.evaluate(() => ({
    activeId: document.activeElement?.id || '',
    scrollTop: document.querySelector('#warning-panel')?.scrollTop || 0
  }));

  assert.equal(after.activeId, 'warning-panel');
  assert.ok(after.scrollTop > before.scrollTop);
  assert.deepEqual(pageErrors, []);
  assert.deepEqual(consoleErrors, []);
});

test('warning ledger can be cleared without refreshing the page', { skip: !playwright && 'Bundled Playwright unavailable' }, async (t) => {
  assert.ok(fs.existsSync(htmlPath), 'index.html should exist');
  const browser = await playwright.chromium.launch({ headless: true });
  t.after(() => browser.close());

  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const consoleErrors = [];
  const pageErrors = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('pageerror', (err) => pageErrors.push(err.message));
  await page.addInitScript(() => {
    window.__downloadFailureMessages = [];
    const nativeClick = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function click() {
      const message = window.__downloadFailureMessages?.shift?.();
      if (message) throw new Error(message);
      return nativeClick.call(this);
    };
  });

  await gotoApp(page);
  await page.waitForFunction(() => document.readyState === 'complete');

  await page.evaluate(() => {
    window.__downloadFailureMessages = [
      'Recovered corrupt preset storage; previous raw data was backed up before saving new presets',
      '预设已保存，但浏览器空间不足，未保存缩略图: browser storage is full'
    ];
  });
  await page.click('#btn-save-project');
  await page.click('#btn-save-project');
  const before = await page.evaluate(() => {
    const button = document.querySelector('#btn-clear-warnings');
	    return {
	      warningCount: window.UI.warnings?.length,
	      panelHidden: document.querySelector('#warning-panel')?.hidden,
	      liveRegionText: document.querySelector('#warning-live')?.textContent || '',
	      buttonExists: !!button,
	      buttonText: button?.textContent || '',
	      buttonTitle: button?.title || '',
      buttonAriaLabel: button?.getAttribute('aria-label') || ''
    };
  });

	  assert.equal(before.warningCount, 2);
	  assert.equal(before.panelHidden, false);
	  assert.match(before.liveRegionText, /提醒：项目文件下载失败：预设已保存，但浏览器空间不足，未保存缩略图/);
	  assert.equal(before.buttonExists, true);
	  assert.equal(before.buttonText.trim(), '×');
  assert.equal(before.buttonTitle, '清空提醒历史');
  assert.equal(before.buttonAriaLabel, '清空提醒历史');

  await page.click('#btn-clear-warnings');
  const after = await page.evaluate(() => ({
	    warningCount: window.UI.warnings?.length,
	    panelHidden: document.querySelector('#warning-panel')?.hidden,
	    panelText: document.querySelector('#warning-list')?.textContent || '',
	    liveRegionText: document.querySelector('#warning-live')?.textContent || '',
	    statusText: document.querySelector('#status-text')?.textContent || ''
	  }));

	  assert.equal(after.warningCount, 0);
	  assert.equal(after.panelHidden, true);
	  assert.equal(after.panelText, '');
	  assert.equal(after.liveRegionText, '提醒历史已清空。');
	  assert.match(after.statusText, /提醒：项目文件下载失败：预设已保存，但浏览器空间不足，未保存缩略图/);
  assert.deepEqual(pageErrors, []);
  assert.deepEqual(consoleErrors, []);
  await page.close();
});

test('legacy oversized custom preset storage is trimmed before rendering options', { skip: !playwright && 'Bundled Playwright unavailable' }, async (t) => {
  assert.ok(fs.existsSync(htmlPath), 'index.html should exist');
  const browser = await playwright.chromium.launch({ headless: true });
  t.after(() => browser.close());

  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const consoleErrors = [];
  const pageErrors = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('pageerror', (err) => pageErrors.push(err.message));

  const presets = Array.from({ length: 750 }, (_, index) => ({
    id: `legacy-${index}`,
    name: `Legacy ${index}`,
    createdAt: 1700000000000 + index,
    thumbnail: '',
    state: { meta: { label: `Legacy ${index}` } }
  }));
  await page.addInitScript((serializedPresets) => {
    localStorage.setItem('fad-mv-custom-presets', serializedPresets);
  }, JSON.stringify(presets));

  await gotoApp(page);
  await page.waitForFunction(() => document.readyState === 'complete');

  const metrics = await page.evaluate(() => {
    const options = Array.from(document.querySelectorAll('#custom-preset-list option')).map((option) => option.textContent || '');
    const stored = JSON.parse(localStorage.getItem('fad-mv-custom-presets') || '[]');
    return {
      optionCount: options.length,
      firstPreset: options[1] || '',
      lastPreset: options[options.length - 1] || '',
      storedCount: stored.length,
      warningText: document.querySelector('#warning-list')?.textContent || '',
      liveWarning: document.querySelector('#warning-live')?.textContent || ''
    };
  });

  assert.equal(metrics.optionCount, 41);
  assert.equal(metrics.storedCount, 40);
  assert.equal(metrics.firstPreset, 'Legacy 0');
  assert.equal(metrics.lastPreset, 'Legacy 39');
  assert.match(metrics.warningText, /自定义预设数量已裁剪到 40 个/);
  assert.match(metrics.liveWarning, /自定义预设数量已裁剪到 40 个/);
  assert.deepEqual(pageErrors, []);
  assert.deepEqual(consoleErrors, []);
  await page.close();
});

test('custom preset apply clamps oversized restored audio analysis arrays', { skip: !playwright && 'Bundled Playwright unavailable' }, async (t) => {
  assert.ok(fs.existsSync(htmlPath), 'index.html should exist');
  const browser = await playwright.chromium.launch({ headless: true });
  t.after(() => browser.close());

  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const consoleErrors = [];
  const pageErrors = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('pageerror', (err) => pageErrors.push(err.message));

  const preset = {
    id: 'oversized-analysis',
    name: 'Oversized Analysis',
    createdAt: 1700000000000,
    thumbnail: '',
    state: {
      meta: { label: 'Oversized Analysis' },
      audioAnalysis: {
        status: 'done',
        result: {
          durationSec: 240,
          sampleRate: 48000,
          channels: 2,
          peakDb: -1,
          truePeakDb: -0.8,
          loudnessDb: -12,
          integratedLufs: -12.7,
          dynamicRangeDb: 11,
          crestFactorDb: 11,
          stereoCorrelation: 0.4,
          bpm: 128,
          bpmConfidence: 0.9,
          onsetCount: 6000,
          silence: { introSec: 0, outroSec: 0, threshold: 0.001 },
          sections: Array.from({ length: 200 }, (_, index) => ({
            label: `drop-${index}-with-a-very-long-name-that-should-be-trimmed`,
            startSec: index,
            endSec: index + 1,
            energy: 2
          })),
          beatMarkers: Array.from({ length: 6000 }, (_, index) => index * 0.5)
        }
      }
    }
  };
  await page.addInitScript((serializedPreset) => {
    localStorage.setItem('fad-mv-custom-presets', serializedPreset);
  }, JSON.stringify([preset]));

  await gotoApp(page);
  await page.waitForFunction(() => document.readyState === 'complete');
  await page.evaluate(() => {
    const select = document.querySelector('#custom-preset-list');
    select.value = 'oversized-analysis';
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await page.waitForFunction(() => document.querySelector('#btn-apply-custom-preset')?.disabled === false);
  await page.click('#btn-apply-custom-preset');

  const metrics = await page.evaluate(() => {
    const result = window.AudioAnalysis.status.result;
    return {
      status: window.AudioAnalysis.status.status,
      beatCount: result?.beatMarkers?.length || 0,
      sectionCount: result?.sections?.length || 0,
      firstSectionLabel: result?.sections?.[0]?.label || '',
      firstSectionEnergy: result?.sections?.[0]?.energy,
      panelText: document.querySelector('#audio-analysis-list')?.textContent || '',
      statusText: document.querySelector('#status-text')?.textContent || ''
    };
  });

  assert.equal(metrics.status, 'done');
  assert.equal(metrics.beatCount, 4096);
  assert.equal(metrics.sectionCount, 64);
  assert.equal(metrics.firstSectionLabel.length, 24);
  assert.equal(metrics.firstSectionEnergy, 1);
  assert.match(metrics.panelText, /4096 个/);
  assert.match(metrics.panelText, /64 段/);
  assert.match(metrics.statusText, /已应用自定义预设：Oversized Analysis/);
  assert.deepEqual(pageErrors, []);
  assert.deepEqual(consoleErrors, []);
  await page.close();
});

test('runtime safeguards expose package focus, live progress, preset state, and long-render cap', { skip: !playwright && 'Bundled Playwright unavailable' }, async (t) => {
  assert.ok(fs.existsSync(htmlPath), 'index.html should exist');
  const browser = await playwright.chromium.launch({ headless: true });
  t.after(() => browser.close());

  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const consoleErrors = [];
  const pageErrors = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('pageerror', (err) => pageErrors.push(err.message));
  await page.addInitScript(() => {
    window.__queuedIdleCallbacks = [];
    window.requestIdleCallback = (cb) => {
      window.__queuedIdleCallbacks.push(cb);
      return window.__queuedIdleCallbacks.length;
    };
    window.cancelIdleCallback = () => {};
  });

  await gotoApp(page);
  await page.waitForFunction(() => document.readyState === 'complete');

  const largeCover = Buffer.concat([tinyPng, Buffer.alloc(9 * 1024 * 1024)]);
  await page.setInputFiles('#in-cover', filePayload('cover-large.png', 'image/png', largeCover));
  await page.waitForFunction(() => window.AssetManager?.status?.cover?.valid === true);
  await page.setInputFiles('#in-logo', filePayload('logo.png', 'image/png', tinyPng));
  await page.waitForFunction(() => window.AssetManager?.status?.logo?.valid === true);
  await page.setInputFiles('#in-video', filePayload('center.png', 'image/png', tinyPng));
  await page.waitForFunction(() => window.AssetManager?.status?.video?.valid === true);
  await page.setInputFiles('#in-audio', filePayload('tone.wav', 'audio/wav', tinyWav()));
  await page.waitForFunction(() => window.AssetManager?.status?.audio?.valid === true);
  await page.waitForFunction(() => !document.querySelector('#btn-save-package')?.disabled);

  const canvasA11y = await page.evaluate(() => ({
    label: document.querySelector('#cvs')?.getAttribute('aria-label') || '',
    summary: document.querySelector('#canvas-summary')?.textContent?.trim() || ''
  }));
  assert.match(canvasA11y.label, /openFAD 视觉预览：未命名曲目 \/ 未知艺人/);
  assert.match(canvasA11y.summary, /cover-large\.png/);
  assert.match(canvasA11y.summary, /center\.png/);
  assert.match(canvasA11y.summary, /logo\.png/);
  assert.match(canvasA11y.summary, /tone\.wav/);

  await page.click('#btn-preset-records');
  const presetState = await page.evaluate(() => ({
    recordsPressed: document.querySelector('#btn-preset-records')?.getAttribute('aria-pressed'),
    samplePressed: document.querySelector('#btn-preset-sample')?.getAttribute('aria-pressed'),
    recordsActive: document.querySelector('#btn-preset-records')?.classList.contains('active')
  }));
  assert.deepEqual(presetState, { recordsPressed: 'true', samplePressed: 'false', recordsActive: true });

  const longRender = await page.evaluate(() => {
    Object.defineProperty(document.querySelector('#pool-audio'), 'duration', {
      configurable: true,
      value: 45 * 60
    });
    const readiness = window.Preflight.getRenderReadiness();
    return {
      blockers: readiness.blockers,
      reasons: readiness.reasons
    };
  });
  assert.ok(longRender.blockers.some((item) => /导出上限/.test(item)));
  assert.ok(longRender.reasons.includes('render-duration'));

  const nonStreamLiveMemoryGate = await page.evaluate(() => {
    Object.defineProperty(document.querySelector('#pool-audio'), 'duration', {
      configurable: true,
      value: 430
    });
    document.querySelector('#in-bitrate')?.dispatchEvent(new Event('change', { bubbles: true }));
    const readiness = window.Preflight.getRenderReadiness();
    const recordButton = document.querySelector('#btn-rec');
    recordButton?.click();
    return {
      recordReady: readiness.recordReady,
      recordReason: readiness.recordReason,
      blockers: readiness.blockers,
      reasons: readiness.reasons,
      estimatedSizeBytes: readiness.estimatedSizeBytes,
      estimatedLiveMemoryBytes: readiness.estimatedLiveMemoryBytes,
      maxRecordingBytes: window.LIMITS.maxRecordingBytes,
      maxNonStreamLiveMemoryBytes: window.LIMITS.maxNonStreamLiveMemoryBytes,
      recordDisabled: recordButton?.disabled,
      machine: window.Machine.status
    };
  });
  assert.equal(nonStreamLiveMemoryGate.recordReady, false);
  assert.ok(nonStreamLiveMemoryGate.reasons.includes('output-size'));
  assert.ok(nonStreamLiveMemoryGate.estimatedSizeBytes < nonStreamLiveMemoryGate.maxRecordingBytes);
  assert.ok(nonStreamLiveMemoryGate.estimatedLiveMemoryBytes > nonStreamLiveMemoryGate.maxNonStreamLiveMemoryBytes);
  assert.match(nonStreamLiveMemoryGate.recordReason, /边生成边保存|实时内存/);
  assert.equal(nonStreamLiveMemoryGate.recordDisabled, true);
  assert.equal(nonStreamLiveMemoryGate.machine, 'IDLE');

  await page.focus('#btn-save-package');
  await page.click('#btn-save-package');
  await page.waitForFunction(() => document.querySelector('#btn-cancel-package')?.style.display === 'block');
  const packageState = await page.evaluate(() => ({
    activeId: document.activeElement?.id || '',
    cancelDisabled: document.querySelector('#btn-cancel-package')?.disabled,
    statusLive: document.querySelector('#status-live')?.textContent?.trim() || '',
    packageSummary: document.querySelector('#package-summary')?.textContent?.trim() || ''
  }));
  assert.equal(packageState.activeId, 'btn-cancel-package');
  assert.equal(packageState.cancelDisabled, false);
  assert.match(packageState.statusLive, /正在保存完整项目：\d+\.\d%/);
  assert.match(packageState.packageSummary, /项目包处理中/);

  const brandPresetWhilePackage = await page.evaluate(() => ({
    sampleDisabled: document.querySelector('#btn-preset-sample')?.disabled,
    sampleReason: document.querySelector('#btn-preset-sample')?.dataset.disabledReason || '',
    recordsPressed: document.querySelector('#btn-preset-records')?.getAttribute('aria-pressed'),
    samplePressed: document.querySelector('#btn-preset-sample')?.getAttribute('aria-pressed'),
    warningText: window.UI.warnings.map((warning) => warning.text).join('\n'),
    summary: document.querySelector('#brand-preset-summary')?.textContent?.trim() || ''
  }));
  assert.equal(brandPresetWhilePackage.sampleDisabled, true);
  assert.match(brandPresetWhilePackage.sampleReason, /项目文件操作进行中/);
  assert.equal(brandPresetWhilePackage.recordsPressed, 'true');
  assert.equal(brandPresetWhilePackage.samplePressed, 'false');
  assert.match(brandPresetWhilePackage.summary, /项目文件操作进行中，请完成后再应用品牌预设。/);

  await page.click('#btn-cancel-package');
  const cancellingPackage = await page.evaluate(() => ({
    statusText: document.querySelector('#status-text')?.textContent?.trim() || '',
    statusLive: document.querySelector('#status-live')?.textContent?.trim() || '',
    ariaValueText: document.querySelector('#progress-fill')?.getAttribute('aria-valuetext') || '',
    ariaNow: document.querySelector('#progress-fill')?.getAttribute('aria-valuenow') || '',
    packageStatus: window.ProjectPackage.status,
    cancelDisabled: document.querySelector('#btn-cancel-package')?.disabled,
    cancelText: document.querySelector('#btn-cancel-package')?.textContent?.trim() || ''
  }));
  assert.equal(cancellingPackage.packageStatus.cancelling, true);
  assert.equal(cancellingPackage.packageStatus.progress.stage, '正在取消项目文件操作');
  assert.equal(cancellingPackage.packageStatus.progress.loaded, 0);
  assert.equal(cancellingPackage.packageStatus.progress.total, 0);
  assert.equal(cancellingPackage.cancelDisabled, true);
  assert.match(cancellingPackage.cancelText, /正在取消项目文件操作/);
  assert.match(cancellingPackage.statusText, /正在取消项目文件操作：进度待定/);
  assert.match(cancellingPackage.statusLive, /正在取消项目文件操作：进度待定/);
  assert.match(cancellingPackage.ariaValueText, /进度待定 \/ 正在取消项目文件操作/);
  assert.notEqual(cancellingPackage.ariaNow, '100.0');
  assert.doesNotMatch(cancellingPackage.statusText, /100\.0%/);
  assert.doesNotMatch(cancellingPackage.statusLive, /100\.0%/);
  await page.evaluate(() => {
    const callbacks = window.__queuedIdleCallbacks.splice(0);
    callbacks.forEach((cb) => cb({ didTimeout: false, timeRemaining: () => 50 }));
  });
  assert.deepEqual(pageErrors, []);
  assert.deepEqual(consoleErrors, []);
});

test('brand preset active state clears after manual edits and ordinary project imports', { skip: !playwright && 'Bundled Playwright unavailable' }, async (t) => {
  assert.ok(fs.existsSync(htmlPath), 'index.html should exist');
  const browser = await playwright.chromium.launch({ headless: true });
  t.after(() => browser.close());

  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const consoleErrors = [];
  const pageErrors = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('pageerror', (err) => pageErrors.push(err.message));

  await gotoApp(page);
  await page.click('#btn-preset-sample');
  const applied = await page.evaluate(() => ({
    samplePressed: document.querySelector('#btn-preset-sample')?.getAttribute('aria-pressed'),
    sampleActive: document.querySelector('#btn-preset-sample')?.classList.contains('active'),
    fx: document.querySelector('#in-fx-intensity')?.value
  }));
  assert.deepEqual(applied, { samplePressed: 'true', sampleActive: true, fx: '55' });

  await page.$eval('#in-fx-intensity', (el) => {
    el.value = '200';
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  const afterManualEdit = await page.evaluate(() => ({
    recordsPressed: document.querySelector('#btn-preset-records')?.getAttribute('aria-pressed'),
    samplePressed: document.querySelector('#btn-preset-sample')?.getAttribute('aria-pressed'),
    promoPressed: document.querySelector('#btn-preset-promo')?.getAttribute('aria-pressed'),
    activeCount: document.querySelectorAll('[id^="btn-preset-"].active').length,
    fx: document.querySelector('#in-fx-intensity')?.value
  }));
  assert.deepEqual(afterManualEdit, {
    recordsPressed: 'false',
    samplePressed: 'false',
    promoPressed: 'false',
    activeCount: 0,
    fx: '200'
  });

  await page.click('#btn-preset-sample');
  const plainProject = {
    schemaVersion: 1,
    meta: { song: 'Plain Project', artist: 'openFAD Fixture Artist', label: 'Manual Label' },
    config: { fontName: 'Orbitron', glitch: true, visSensitivity: 1.1, visFxIntensity: 1.2, visGlowAmount: 1.3 },
    layout: { logoWidth: 205, logoBottomMargin: 185, videoBaseWidth: 900, videoY: 480, textShadowStrength: 10, gradientHeight: 0.6, labelSpacing: 10 }
  };
  await page.setInputFiles('#in-project-file', filePayload('plain-project.fad-mv.json', 'application/json', Buffer.from(JSON.stringify(plainProject))));
  await page.waitForFunction(() => document.querySelector('#in-label')?.value === 'Manual Label');
  const afterPlainImport = await page.evaluate(() => ({
    recordsPressed: document.querySelector('#btn-preset-records')?.getAttribute('aria-pressed'),
    samplePressed: document.querySelector('#btn-preset-sample')?.getAttribute('aria-pressed'),
    promoPressed: document.querySelector('#btn-preset-promo')?.getAttribute('aria-pressed'),
    activeCount: document.querySelectorAll('[id^="btn-preset-"].active').length,
    label: document.querySelector('#in-label')?.value
  }));
  assert.deepEqual(afterPlainImport, {
    recordsPressed: 'false',
    samplePressed: 'false',
    promoPressed: 'false',
    activeCount: 0,
    label: 'Manual Label'
  });
  assert.deepEqual(pageErrors, []);
  assert.deepEqual(consoleErrors, []);
});

test('package export download dispatch failure keeps a retryable package blob', { skip: !playwright && 'Bundled Playwright unavailable' }, async (t) => {
  assert.ok(fs.existsSync(htmlPath), 'index.html should exist');
  const browser = await playwright.chromium.launch({ headless: true });
  const context = await browser.newContext({ acceptDownloads: true, viewport: { width: 1280, height: 900 } });
  t.after(async () => {
    await context.close();
    await browser.close();
  });

  const page = await context.newPage();
  const consoleErrors = [];
  const pageErrors = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('pageerror', (err) => pageErrors.push(err.message));
  await page.addInitScript(() => {
    window.__packageDispatchFailure = { clicks: 0, failedClicks: 0 };
    const nativeAnchorClick = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function click(...args) {
      if (String(this.download || '').endsWith('.fadmv')) {
        window.__packageDispatchFailure.clicks += 1;
        if (!window.__packageDispatchFailure.failedClicks) {
          window.__packageDispatchFailure.failedClicks += 1;
          throw new Error('forced first package download click failure');
        }
      }
      return nativeAnchorClick.apply(this, args);
    };
  });

  await gotoApp(page);
  await page.waitForFunction(() => document.readyState === 'complete');
  await setProjectFields(page, { song: 'PACKAGE RETRY', artist: 'openFAD Fixture Artist' });
  await page.setInputFiles('#in-cover', filePayload('cover.png', 'image/png', tinyPng));
  await page.waitForFunction(() => window.AssetManager?.status?.cover?.valid === true);
  await page.setInputFiles('#in-logo', filePayload('logo.png', 'image/png', tinyPng));
  await page.waitForFunction(() => window.AssetManager?.status?.logo?.valid === true);
  await page.setInputFiles('#in-video', filePayload('center.png', 'image/png', tinyPng));
  await page.waitForFunction(() => window.AssetManager?.status?.video?.valid === true);
  await page.setInputFiles('#in-audio', filePayload('tone.wav', 'audio/wav', tinyWav()));
  await page.waitForFunction(() => window.AssetManager?.status?.audio?.valid === true);
  await page.waitForFunction(() => !document.querySelector('#btn-save-package')?.disabled);

  await page.click('#btn-save-package');
  await page.waitForFunction(() => !window.ProjectPackage?.status?.running && /下载失败/i.test(document.querySelector('#package-list')?.textContent || ''), null, { timeout: 8000 });
  const failed = await page.evaluate(() => ({
    probe: window.__packageDispatchFailure,
    packageSummary: document.querySelector('#package-summary')?.textContent?.trim() || '',
    packageList: document.querySelector('#package-list')?.textContent?.replace(/\s+/g, ' ').trim() || '',
    retryDisplay: document.querySelector('#btn-retry-package-download')?.style.display || '',
    retryDisabled: document.querySelector('#btn-retry-package-download')?.disabled
  }));

  assert.deepEqual(pageErrors, []);
  assert.deepEqual(consoleErrors, []);
  assert.equal(failed.probe.failedClicks, 1);
  assert.equal(failed.probe.clicks, 1);
  assert.match(failed.packageSummary, /可导出|EXPORT READY|PACKAGE READY/);
  assert.match(failed.packageList, /下载失败 .* forced first package download click failure/i);
  assert.equal(failed.retryDisplay, 'block');
  assert.equal(failed.retryDisabled, false);

  const retryDownload = waitForDownloads(page, 1, 8000);
  await page.click('#btn-retry-package-download');
  const downloads = await retryDownload;
  const recovered = await page.evaluate(() => ({
    probe: window.__packageDispatchFailure,
    packageList: document.querySelector('#package-list')?.textContent?.replace(/\s+/g, ' ').trim() || '',
    retryDisplay: document.querySelector('#btn-retry-package-download')?.style.display || ''
  }));

  assert.equal(downloads[0].suggestedFilename(), 'PACKAGE_RETRY.fadmv');
  assert.equal(recovered.probe.clicks, 2);
  assert.match(recovered.packageList, /已触发下载[，,.\s·-]*请?检查文件|download dispatched .* verify file/i);
  assert.equal(recovered.retryDisplay, 'block');
});

test('invalid asset replacement clears stale package retry state', { skip: !playwright && 'Bundled Playwright unavailable' }, async (t) => {
  assert.ok(fs.existsSync(htmlPath), 'index.html should exist');
  const browser = await playwright.chromium.launch({ headless: true });
  t.after(() => browser.close());

  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const consoleErrors = [];
  const pageErrors = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('pageerror', (err) => pageErrors.push(err.message));
  await page.addInitScript(() => {
    window.__packageDispatchFailure = { clicks: 0, failedClicks: 0 };
    const nativeAnchorClick = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function click(...args) {
      if (String(this.download || '').endsWith('.fadmv')) {
        window.__packageDispatchFailure.clicks += 1;
        if (!window.__packageDispatchFailure.failedClicks) {
          window.__packageDispatchFailure.failedClicks += 1;
          throw new Error('forced first package download click failure');
        }
      }
      return nativeAnchorClick.apply(this, args);
    };
  });

  await gotoApp(page);
  await page.waitForFunction(() => document.readyState === 'complete');
  await setProjectFields(page, { song: 'PACKAGE RETRY INVALIDATED', artist: 'openFAD Fixture Artist' });
  await page.setInputFiles('#in-cover', filePayload('cover.png', 'image/png', tinyPng));
  await page.waitForFunction(() => window.AssetManager?.status?.cover?.valid === true);
  await page.setInputFiles('#in-logo', filePayload('logo.png', 'image/png', tinyPng));
  await page.waitForFunction(() => window.AssetManager?.status?.logo?.valid === true);
  await page.setInputFiles('#in-video', filePayload('center.png', 'image/png', tinyPng));
  await page.waitForFunction(() => window.AssetManager?.status?.video?.valid === true);
  await page.setInputFiles('#in-audio', filePayload('tone.wav', 'audio/wav', tinyWav()));
  await page.waitForFunction(() => window.AssetManager?.status?.audio?.valid === true);
  await page.waitForFunction(() => !document.querySelector('#btn-save-package')?.disabled);

  await page.click('#btn-save-package');
  await page.waitForFunction(() => !window.ProjectPackage?.status?.running && document.querySelector('#btn-retry-package-download')?.style.display === 'block', null, { timeout: 8000 });

  await page.setInputFiles('#in-cover', filePayload('not-cover.txt', 'text/plain', Buffer.from('not an image')));
  await page.waitForFunction(() => window.AssetManager?.status?.cover?.valid === false && window.UI?.warnings?.some((warning) => /不支持的文件类型：COVER/.test(warning.text || '')));

  const afterInvalid = await page.evaluate(() => ({
    asset: window.AssetManager.status.cover,
    packageSummary: document.querySelector('#package-summary')?.textContent?.trim() || '',
    packageList: document.querySelector('#package-list')?.textContent?.replace(/\s+/g, ' ').trim() || '',
    retryDisplay: document.querySelector('#btn-retry-package-download')?.style.display || '',
    retryDisabled: document.querySelector('#btn-retry-package-download')?.disabled
  }));

  assert.equal(afterInvalid.asset.valid, false);
  assert.equal(afterInvalid.retryDisplay, 'none');
  assert.equal(afterInvalid.retryDisabled, true);
  assert.match(afterInvalid.packageSummary, /可导出|最近下载失败|EXPORT READY|PACKAGE READY|LAST DOWNLOAD ERROR/i);
  assert.doesNotMatch(afterInvalid.packageList, /可重试下载|retry available/i);
  assert.deepEqual(pageErrors, []);
  assert.deepEqual(consoleErrors, []);
});

test('large package export remains responsive and cancellable during CRC work', { skip: !playwright && 'Bundled Playwright unavailable' }, async (t) => {
  assert.ok(fs.existsSync(htmlPath), 'index.html should exist');
  const browser = await playwright.chromium.launch({ headless: true });
  t.after(() => browser.close());

  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const consoleErrors = [];
  const pageErrors = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('pageerror', (err) => pageErrors.push(err.message));

  await gotoApp(page);
  await page.waitForFunction(() => document.readyState === 'complete');

  const largeCover = Buffer.concat([tinyPng, Buffer.alloc(24 * 1024 * 1024)]);
  await page.setInputFiles('#in-cover', filePayload('cover-crc-large.png', 'image/png', largeCover));
  await page.waitForFunction(() => window.AssetManager?.status?.cover?.valid === true);
  await page.setInputFiles('#in-logo', filePayload('logo.png', 'image/png', tinyPng));
  await page.waitForFunction(() => window.AssetManager?.status?.logo?.valid === true);
  await page.setInputFiles('#in-video', filePayload('center.png', 'image/png', tinyPng));
  await page.waitForFunction(() => window.AssetManager?.status?.video?.valid === true);
  await page.setInputFiles('#in-audio', filePayload('tone.wav', 'audio/wav', tinyWav()));
  await page.waitForFunction(() => window.AssetManager?.status?.audio?.valid === true);
  await page.waitForFunction(() => !document.querySelector('#btn-save-package')?.disabled);

  await page.evaluate(() => {
    const startedAt = performance.now();
    window.__packageResponsiveness = {
      startedAt,
      lastTickAt: startedAt,
      tickCount: 0,
      maxGapMs: 0,
      firstProgressAt: 0,
      cancelRequestedAt: 0,
      cancellingSeenAt: 0,
      finishedAt: 0,
      finalStatusText: '',
      timer: 0
    };
    window.__packageResponsiveness.timer = setInterval(() => {
      const probe = window.__packageResponsiveness;
      const now = performance.now();
      probe.maxGapMs = Math.max(probe.maxGapMs, now - probe.lastTickAt);
      probe.lastTickAt = now;
      probe.tickCount += 1;
      const status = window.ProjectPackage?.status;
      if (status?.running && status.progress?.loaded > 0 && !probe.firstProgressAt) {
        probe.firstProgressAt = now;
      }
      if (status?.running && status.progress?.loaded > 0 && !status.cancelling && !probe.cancelRequestedAt) {
        probe.cancelRequestedAt = now;
        document.querySelector('#btn-cancel-package')?.click();
        const afterCancel = window.ProjectPackage?.status;
        if (afterCancel?.cancelling && !probe.cancellingSeenAt) probe.cancellingSeenAt = performance.now();
      }
      if (status?.cancelling && !probe.cancellingSeenAt) probe.cancellingSeenAt = now;
      if (probe.cancelRequestedAt && !status?.running && !probe.finishedAt) {
        probe.finishedAt = now;
        probe.finalStatusText = document.querySelector('#status-text')?.textContent?.trim() || '';
      }
    }, 5);
  });

  await page.click('#btn-save-package');
  await page.waitForFunction(() => window.__packageResponsiveness?.finishedAt > 0, null, { timeout: 10000 });
  const result = await page.evaluate(() => {
    clearInterval(window.__packageResponsiveness.timer);
    const { timer, ...probe } = window.__packageResponsiveness;
    return {
      ...probe,
      status: window.ProjectPackage.status,
      warnings: window.UI.warnings.map((warning) => warning.text).join('\n')
    };
  });

  const packageWorkWindowMs = Math.max(0, result.finishedAt - result.firstProgressAt);
  assert.ok(
    result.tickCount >= 3 || packageWorkWindowMs < 100,
    `event loop should keep ticking or complete the cancellable package work quickly: ${JSON.stringify(result)}`
  );
  assert.ok(result.maxGapMs < 180, `package CRC work should not monopolize the main thread, max gap ${result.maxGapMs}ms`);
  assert.ok(result.firstProgressAt > 0, `package progress should advance before cancellation: ${JSON.stringify(result)}`);
  assert.ok(result.cancelRequestedAt > 0, `cancel should be requested during package work: ${JSON.stringify(result)}`);
  assert.ok(result.cancellingSeenAt >= result.cancelRequestedAt, `cancelling state should become observable: ${JSON.stringify(result)}`);
  assert.ok(result.cancellingSeenAt - result.cancelRequestedAt < 120, `cancel UI should react quickly, took ${result.cancellingSeenAt - result.cancelRequestedAt}ms`);
  assert.ok(result.finishedAt - result.cancelRequestedAt < 1200, `cancelled package should unlock promptly, took ${result.finishedAt - result.cancelRequestedAt}ms`);
  assert.equal(result.status.running, false);
  assert.match(`${result.finalStatusText}\n${result.warnings}`, /项目文件操作已取消/i);
  assert.deepEqual(pageErrors, []);
  assert.deepEqual(consoleErrors, []);
});

test('audio analysis cancellation closes the active decode context', { skip: !playwright && 'Bundled Playwright unavailable' }, async (t) => {
  assert.ok(fs.existsSync(htmlPath), 'index.html should exist');
  const browser = await playwright.chromium.launch({ headless: true });
  t.after(() => browser.close());

  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const consoleErrors = [];
  const pageErrors = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('pageerror', (err) => pageErrors.push(err.message));
  await page.addInitScript(() => {
    window.__decodeProbe = { decodeCalls: 0, closes: 0 };
    class FakeAudioContext {
      decodeAudioData() {
        window.__decodeProbe.decodeCalls += 1;
        return new Promise(() => {});
      }

      close() {
        window.__decodeProbe.closes += 1;
        return Promise.resolve();
      }
    }
    window.AudioContext = FakeAudioContext;
    window.webkitAudioContext = FakeAudioContext;
  });

  await gotoApp(page);
  await page.waitForFunction(() => document.readyState === 'complete');
  await page.setInputFiles('#in-audio', filePayload('analysis.wav', 'audio/wav', tinyWav()));
  await page.waitForFunction(() => window.AssetManager?.status?.audio?.valid === true);

  await page.click('#btn-analyze-audio');
  await page.waitForFunction(() => window.__decodeProbe.decodeCalls === 1);
  await page.click('#btn-analyze-audio');
  const cancelled = await page.evaluate(() => ({
    probe: window.__decodeProbe,
    analysisLock: window.Store.locks.audioAnalysis,
    buttonText: document.querySelector('#btn-analyze-audio')?.textContent?.trim() || '',
    buttonMain: document.querySelector('#btn-analyze-audio .btn-main')?.textContent?.trim() || '',
    buttonSub: document.querySelector('#btn-analyze-audio .btn-sub')?.textContent?.trim() || '',
    summary: document.querySelector('#audio-analysis-summary')?.textContent?.trim() || ''
  }));

  assert.deepEqual(cancelled.probe, { decodeCalls: 1, closes: 1 });
  assert.equal(cancelled.analysisLock, 'cancelled');
  assert.match(cancelled.buttonText, /分析音轨\s*读取节奏/);
  assert.equal(cancelled.buttonMain, '分析音轨');
  assert.equal(cancelled.buttonSub, '读取节奏');
  assert.equal(cancelled.summary, '分析已取消');
  assert.deepEqual(pageErrors, []);
  assert.deepEqual(consoleErrors, []);
});

test('audio analysis skips header-declared unsafe PCM before decodeAudioData is called', { skip: !playwright && 'Bundled Playwright unavailable' }, async (t) => {
  assert.ok(fs.existsSync(htmlPath), 'index.html should exist');
  const browser = await playwright.chromium.launch({ headless: true });
  t.after(() => browser.close());

  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const consoleErrors = [];
  const pageErrors = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('pageerror', (err) => pageErrors.push(err.message));
  await page.addInitScript(() => {
    window.__decodeProbe = { decodeCalls: 0, closes: 0 };

    Object.defineProperty(HTMLMediaElement.prototype, 'duration', {
      configurable: true,
      get() {
        if (this.id === 'pool-audio') return 300;
        return Number.NaN;
      }
    });
    Object.defineProperty(HTMLMediaElement.prototype, 'readyState', {
      configurable: true,
      get() {
        if (this.id === 'pool-audio') return 4;
        return 0;
      }
    });
    HTMLMediaElement.prototype.load = function load() {
      if (this.id !== 'pool-audio') return undefined;
      setTimeout(() => {
        this.onloadedmetadata?.();
        this.oncanplay?.();
      }, 0);
      return undefined;
    };

    class FakeAudioContext {
      decodeAudioData(_arrayBuffer, success) {
        window.__decodeProbe.decodeCalls += 1;
        const buffer = {
          duration: 300,
          numberOfChannels: 6,
          sampleRate: 48000,
          length: 300 * 48000
        };
        setTimeout(() => success?.(buffer), 0);
        return Promise.resolve(buffer);
      }

      close() {
        window.__decodeProbe.closes += 1;
        return Promise.resolve();
      }
    }
    window.AudioContext = FakeAudioContext;
    window.webkitAudioContext = FakeAudioContext;
  });

  await gotoApp(page);
  await page.waitForFunction(() => document.readyState === 'complete');
  await page.setInputFiles('#in-audio', filePayload('six-channel-overdecoded.wav', 'audio/wav', wavHeaderOnly()));
  await page.waitForFunction(() => window.AssetManager?.status?.audio?.valid === true);

  await page.click('#btn-analyze-audio');
  await page.waitForFunction(() => window.Store?.locks?.audioAnalysis === 'skipped', null, { timeout: 5000 });
  const skipped = await page.evaluate(() => ({
    probe: window.__decodeProbe,
    lock: window.Store.locks.audioAnalysis,
    summary: document.querySelector('#audio-analysis-summary')?.textContent?.trim() || '',
    details: document.querySelector('#audio-analysis-list')?.textContent?.replace(/\s+/g, ' ').trim() || ''
  }));

  assert.deepEqual(skipped.probe, { decodeCalls: 0, closes: 0 });
  assert.equal(skipped.lock, 'skipped');
  assert.equal(skipped.summary, '已跳过分析');
  assert.match(skipped.details, /safe analysis window/i);
  assert.deepEqual(pageErrors, []);
  assert.deepEqual(consoleErrors, []);
});

test('audio analysis skips header-declared unsafe extensible WAV before decodeAudioData is called', { skip: !playwright && 'Bundled Playwright unavailable' }, async (t) => {
  assert.ok(fs.existsSync(htmlPath), 'index.html should exist');
  const browser = await playwright.chromium.launch({ headless: true });
  t.after(() => browser.close());

  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const consoleErrors = [];
  const pageErrors = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('pageerror', (err) => pageErrors.push(err.message));
  await page.addInitScript(() => {
    window.__decodeProbe = { decodeCalls: 0, closes: 0 };

    Object.defineProperty(HTMLMediaElement.prototype, 'duration', {
      configurable: true,
      get() {
        if (this.id === 'pool-audio') return 300;
        return Number.NaN;
      }
    });
    Object.defineProperty(HTMLMediaElement.prototype, 'readyState', {
      configurable: true,
      get() {
        if (this.id === 'pool-audio') return 4;
        return 0;
      }
    });
    HTMLMediaElement.prototype.load = function load() {
      if (this.id !== 'pool-audio') return undefined;
      setTimeout(() => {
        this.onloadedmetadata?.();
        this.oncanplay?.();
      }, 0);
      return undefined;
    };

    class FakeAudioContext {
      decodeAudioData(_arrayBuffer, success) {
        window.__decodeProbe.decodeCalls += 1;
        const buffer = {
          duration: 300,
          numberOfChannels: 6,
          sampleRate: 48000,
          length: 300 * 48000
        };
        setTimeout(() => success?.(buffer), 0);
        return Promise.resolve(buffer);
      }

      close() {
        window.__decodeProbe.closes += 1;
        return Promise.resolve();
      }
    }
    window.AudioContext = FakeAudioContext;
    window.webkitAudioContext = FakeAudioContext;
  });

  await gotoApp(page);
  await page.waitForFunction(() => document.readyState === 'complete');
  await page.setInputFiles('#in-audio', filePayload('six-channel-extensible.wav', 'audio/wav', extensibleWavHeaderOnly()));
  await page.waitForFunction(() => window.AssetManager?.status?.audio?.valid === true);

  await page.click('#btn-analyze-audio');
  await page.waitForFunction(() => window.Store?.locks?.audioAnalysis === 'skipped', null, { timeout: 5000 });
  const skipped = await page.evaluate(() => ({
    probe: window.__decodeProbe,
    lock: window.Store.locks.audioAnalysis,
    summary: document.querySelector('#audio-analysis-summary')?.textContent?.trim() || '',
    details: document.querySelector('#audio-analysis-list')?.textContent?.replace(/\s+/g, ' ').trim() || ''
  }));

  assert.deepEqual(skipped.probe, { decodeCalls: 0, closes: 0 });
  assert.equal(skipped.lock, 'skipped');
  assert.equal(skipped.summary, '已跳过分析');
  assert.match(skipped.details, /safe analysis window/i);
  assert.deepEqual(pageErrors, []);
  assert.deepEqual(consoleErrors, []);
});

test('audio analysis does not skip safe low-rate WAVs before metadata can override assumed decode size', { skip: !playwright && 'Bundled Playwright unavailable' }, async (t) => {
  assert.ok(fs.existsSync(htmlPath), 'index.html should exist');
  const browser = await playwright.chromium.launch({ headless: true });
  t.after(() => browser.close());

  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const consoleErrors = [];
  const pageErrors = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('pageerror', (err) => pageErrors.push(err.message));
  await page.addInitScript(() => {
    window.__decodeProbe = { decodeCalls: 0, closes: 0 };
    const safeChannel = new Float32Array(8000);

    Object.defineProperty(HTMLMediaElement.prototype, 'duration', {
      configurable: true,
      get() {
        if (this.id === 'pool-audio') return 600;
        return Number.NaN;
      }
    });
    Object.defineProperty(HTMLMediaElement.prototype, 'readyState', {
      configurable: true,
      get() {
        if (this.id === 'pool-audio') return 4;
        return 0;
      }
    });
    HTMLMediaElement.prototype.load = function load() {
      if (this.id !== 'pool-audio') return undefined;
      setTimeout(() => {
        this.onloadedmetadata?.();
        this.oncanplay?.();
      }, 0);
      return undefined;
    };

    class FakeAudioContext {
      decodeAudioData(_arrayBuffer, success) {
        window.__decodeProbe.decodeCalls += 1;
        const buffer = {
          duration: 600,
          numberOfChannels: 1,
          sampleRate: 8000,
          length: safeChannel.length,
          getChannelData: () => safeChannel
        };
        setTimeout(() => success?.(buffer), 0);
        return Promise.resolve(buffer);
      }

      close() {
        window.__decodeProbe.closes += 1;
        return Promise.resolve();
      }
    }
    window.AudioContext = FakeAudioContext;
    window.webkitAudioContext = FakeAudioContext;
  });

  await gotoApp(page);
  await page.waitForFunction(() => document.readyState === 'complete');
  await page.setInputFiles('#in-audio', filePayload('safe-low-rate.wav', 'audio/wav', wavHeaderOnly({ sampleRate: 8000, durationSec: 600, channels: 1 })));
  await page.waitForFunction(() => window.AssetManager?.status?.audio?.valid === true);

  await page.click('#btn-analyze-audio');
  await page.waitForFunction(() => {
    const status = window.Store?.locks?.audioAnalysis;
    return window.__decodeProbe.decodeCalls > 0 || ['skipped', 'done', 'error', 'timeout'].includes(status);
  }, null, { timeout: 5000 });
  const analyzed = await page.evaluate(() => ({
    probe: window.__decodeProbe,
    lock: window.Store.locks.audioAnalysis,
    summary: document.querySelector('#audio-analysis-summary')?.textContent?.trim() || '',
    details: document.querySelector('#audio-analysis-list')?.textContent?.replace(/\s+/g, ' ').trim() || ''
  }));

  assert.equal(analyzed.probe.decodeCalls, 1);
  assert.notEqual(analyzed.lock, 'skipped');
  assert.doesNotMatch(analyzed.summary, /SKIPPED/);
  assert.doesNotMatch(analyzed.details, /safe decoded analysis window/i);
  assert.deepEqual(pageErrors, []);
  assert.deepEqual(consoleErrors, []);
});

test('audio analysis skips compressed unknown-layout containers before decodeAudioData can allocate oversized PCM', { skip: !playwright && 'Bundled Playwright unavailable' }, async (t) => {
  assert.ok(fs.existsSync(htmlPath), 'index.html should exist');
  const browser = await playwright.chromium.launch({ headless: true });
  t.after(() => browser.close());

  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const consoleErrors = [];
  const pageErrors = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('pageerror', (err) => pageErrors.push(err.message));
  await page.addInitScript(() => {
    window.__decodeProbe = { decodeCalls: 0, closes: 0 };

    Object.defineProperty(HTMLMediaElement.prototype, 'duration', {
      configurable: true,
      get() {
        if (this.id === 'pool-audio') return 60;
        return Number.NaN;
      }
    });
    Object.defineProperty(HTMLMediaElement.prototype, 'readyState', {
      configurable: true,
      get() {
        if (this.id === 'pool-audio') return 4;
        return 0;
      }
    });
    HTMLMediaElement.prototype.load = function load() {
      if (this.id !== 'pool-audio') return undefined;
      setTimeout(() => {
        this.onloadedmetadata?.();
        this.oncanplay?.();
      }, 0);
      return undefined;
    };

    class FakeAudioContext {
      decodeAudioData(_arrayBuffer, success) {
        window.__decodeProbe.decodeCalls += 1;
        const hugeChannel = new Float32Array(60 * 96000);
        const buffer = {
          duration: 60,
          numberOfChannels: 6,
          sampleRate: 96000,
          length: hugeChannel.length,
          getChannelData: () => hugeChannel
        };
        setTimeout(() => success?.(buffer), 0);
        return Promise.resolve(buffer);
      }

      close() {
        window.__decodeProbe.closes += 1;
        return Promise.resolve();
      }
    }
    window.AudioContext = FakeAudioContext;
    window.webkitAudioContext = FakeAudioContext;
  });

  await gotoApp(page);
  await page.waitForFunction(() => document.readyState === 'complete');
  await page.setInputFiles('#in-audio', filePayload('surround-unknown.ogg', 'audio/ogg', Buffer.from('OggS unknown layout')));
  await page.waitForFunction(() => window.AssetManager?.status?.audio?.valid === true);

  await page.click('#btn-analyze-audio');
  await page.waitForFunction(() => {
    const status = window.Store?.locks?.audioAnalysis;
    return window.__decodeProbe.decodeCalls > 0 || ['skipped', 'done', 'error', 'timeout'].includes(status);
  }, null, { timeout: 5000 });
  const analyzed = await page.evaluate(() => ({
    probe: window.__decodeProbe,
    lock: window.Store.locks.audioAnalysis,
    summary: document.querySelector('#audio-analysis-summary')?.textContent?.trim() || '',
    details: document.querySelector('#audio-analysis-list')?.textContent?.replace(/\s+/g, ' ').trim() || ''
  }));

  assert.deepEqual(analyzed.probe, { decodeCalls: 0, closes: 0 });
  assert.equal(analyzed.lock, 'skipped');
  assert.equal(analyzed.summary, '已跳过分析');
  assert.match(analyzed.details, /unknown compressed audio layout/i);
  assert.deepEqual(pageErrors, []);
  assert.deepEqual(consoleErrors, []);
});

test('audio analysis uses MP3 frame metadata to analyze safe stereo tracks beyond the unknown compressed precheck', { skip: !playwright && 'Bundled Playwright unavailable' }, async (t) => {
  assert.ok(fs.existsSync(htmlPath), 'index.html should exist');
  const browser = await playwright.chromium.launch({ headless: true });
  t.after(() => browser.close());

  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const consoleErrors = [];
  const pageErrors = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('pageerror', (err) => pageErrors.push(err.message));
  await page.addInitScript(() => {
    window.__decodeProbe = { decodeCalls: 0, closes: 0 };
    const safeChannel = new Float32Array(44100);

    Object.defineProperty(HTMLMediaElement.prototype, 'duration', {
      configurable: true,
      get() {
        if (this.id === 'pool-audio') return 180;
        return Number.NaN;
      }
    });
    Object.defineProperty(HTMLMediaElement.prototype, 'readyState', {
      configurable: true,
      get() {
        if (this.id === 'pool-audio') return 4;
        return 0;
      }
    });
    HTMLMediaElement.prototype.load = function load() {
      if (this.id !== 'pool-audio') return undefined;
      setTimeout(() => {
        this.onloadedmetadata?.();
        this.oncanplay?.();
      }, 0);
      return undefined;
    };

    class FakeAudioContext {
      decodeAudioData(_arrayBuffer, success) {
        window.__decodeProbe.decodeCalls += 1;
        const buffer = {
          duration: 180,
          numberOfChannels: 2,
          sampleRate: 44100,
          length: safeChannel.length,
          getChannelData: () => safeChannel
        };
        setTimeout(() => success?.(buffer), 0);
        return Promise.resolve(buffer);
      }

      close() {
        window.__decodeProbe.closes += 1;
        return Promise.resolve();
      }
    }
    window.AudioContext = FakeAudioContext;
    window.webkitAudioContext = FakeAudioContext;
  });

  await gotoApp(page);
  await page.waitForFunction(() => document.readyState === 'complete');
  await page.setInputFiles('#in-audio', filePayload('safe-stereo.mp3', 'audio/mpeg', tinyMp3Frame({ frames: 2 })));
  await page.waitForFunction(() => window.AssetManager?.status?.audio?.valid === true);

  await page.click('#btn-analyze-audio');
  await page.waitForFunction(() => {
    const status = window.Store?.locks?.audioAnalysis;
    return window.__decodeProbe.decodeCalls > 0 || ['skipped', 'done', 'error', 'timeout'].includes(status);
  }, null, { timeout: 5000 });
  const analyzed = await page.evaluate(() => ({
    probe: window.__decodeProbe,
    lock: window.Store.locks.audioAnalysis,
    summary: document.querySelector('#audio-analysis-summary')?.textContent?.trim() || '',
    details: document.querySelector('#audio-analysis-list')?.textContent?.replace(/\s+/g, ' ').trim() || ''
  }));

  assert.equal(analyzed.probe.decodeCalls, 1);
  assert.notEqual(analyzed.lock, 'skipped');
  assert.doesNotMatch(analyzed.summary, /SKIPPED/);
  assert.doesNotMatch(analyzed.details, /unknown compressed audio layout/i);
  assert.deepEqual(pageErrors, []);
  assert.deepEqual(consoleErrors, []);
});

test('audio analysis finds MP3 frames after bounded ID3v2 metadata tags', { skip: !playwright && 'Bundled Playwright unavailable' }, async (t) => {
  assert.ok(fs.existsSync(htmlPath), 'index.html should exist');
  const browser = await playwright.chromium.launch({ headless: true });
  t.after(() => browser.close());

  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const consoleErrors = [];
  const pageErrors = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('pageerror', (err) => pageErrors.push(err.message));
  await page.addInitScript(() => {
    window.__decodeProbe = { decodeCalls: 0, closes: 0 };
    const safeChannel = new Float32Array(44100);

    Object.defineProperty(HTMLMediaElement.prototype, 'duration', {
      configurable: true,
      get() {
        if (this.id === 'pool-audio') return 180;
        return Number.NaN;
      }
    });
    Object.defineProperty(HTMLMediaElement.prototype, 'readyState', {
      configurable: true,
      get() {
        if (this.id === 'pool-audio') return 4;
        return 0;
      }
    });
    HTMLMediaElement.prototype.load = function load() {
      if (this.id !== 'pool-audio') return undefined;
      setTimeout(() => {
        this.onloadedmetadata?.();
        this.oncanplay?.();
      }, 0);
      return undefined;
    };

    class FakeAudioContext {
      decodeAudioData(_arrayBuffer, success) {
        window.__decodeProbe.decodeCalls += 1;
        const buffer = {
          duration: 180,
          numberOfChannels: 2,
          sampleRate: 44100,
          length: safeChannel.length,
          getChannelData: () => safeChannel
        };
        setTimeout(() => success?.(buffer), 0);
        return Promise.resolve(buffer);
      }

      close() {
        window.__decodeProbe.closes += 1;
        return Promise.resolve();
      }
    }
    window.AudioContext = FakeAudioContext;
    window.webkitAudioContext = FakeAudioContext;
  });

  await gotoApp(page);
  await page.waitForFunction(() => document.readyState === 'complete');
  await page.setInputFiles('#in-audio', filePayload('safe-id3-stereo.mp3', 'audio/mpeg', Buffer.concat([id3v2Tag(64), tinyMp3Frame({ frames: 2 })])));
  await page.waitForFunction(() => window.AssetManager?.status?.audio?.valid === true);

  await page.click('#btn-analyze-audio');
  await page.waitForFunction(() => {
    const status = window.Store?.locks?.audioAnalysis;
    return window.__decodeProbe.decodeCalls > 0 || ['skipped', 'done', 'error', 'timeout'].includes(status);
  }, null, { timeout: 5000 });
  const analyzed = await page.evaluate(() => ({
    probe: window.__decodeProbe,
    lock: window.Store.locks.audioAnalysis,
    summary: document.querySelector('#audio-analysis-summary')?.textContent?.trim() || '',
    details: document.querySelector('#audio-analysis-list')?.textContent?.replace(/\s+/g, ' ').trim() || ''
  }));

  assert.equal(analyzed.probe.decodeCalls, 1);
  assert.notEqual(analyzed.lock, 'skipped');
  assert.doesNotMatch(analyzed.summary, /SKIPPED/);
  assert.doesNotMatch(analyzed.details, /unknown compressed audio layout/i);
  assert.deepEqual(pageErrors, []);
  assert.deepEqual(consoleErrors, []);
});

test('audio analysis keeps invalid MP3 headers on the unknown compressed skip path', { skip: !playwright && 'Bundled Playwright unavailable' }, async (t) => {
  assert.ok(fs.existsSync(htmlPath), 'index.html should exist');
  const browser = await playwright.chromium.launch({ headless: true });
  t.after(() => browser.close());

  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const consoleErrors = [];
  const pageErrors = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('pageerror', (err) => pageErrors.push(err.message));
  await page.addInitScript(() => {
    window.__decodeProbe = { decodeCalls: 0, closes: 0 };

    Object.defineProperty(HTMLMediaElement.prototype, 'duration', {
      configurable: true,
      get() {
        if (this.id === 'pool-audio') return 180;
        return Number.NaN;
      }
    });
    Object.defineProperty(HTMLMediaElement.prototype, 'readyState', {
      configurable: true,
      get() {
        if (this.id === 'pool-audio') return 4;
        return 0;
      }
    });
    HTMLMediaElement.prototype.load = function load() {
      if (this.id !== 'pool-audio') return undefined;
      setTimeout(() => {
        this.onloadedmetadata?.();
        this.oncanplay?.();
      }, 0);
      return undefined;
    };

    class FakeAudioContext {
      decodeAudioData(_arrayBuffer, success) {
        window.__decodeProbe.decodeCalls += 1;
        const buffer = {
          duration: 180,
          numberOfChannels: 2,
          sampleRate: 44100,
          length: 44100,
          getChannelData: () => new Float32Array(44100)
        };
        setTimeout(() => success?.(buffer), 0);
        return Promise.resolve(buffer);
      }

      close() {
        window.__decodeProbe.closes += 1;
        return Promise.resolve();
      }
    }
    window.AudioContext = FakeAudioContext;
    window.webkitAudioContext = FakeAudioContext;
  });

  await gotoApp(page);
  await page.waitForFunction(() => document.readyState === 'complete');
  await page.setInputFiles('#in-audio', filePayload('reserved-header.mp3', 'audio/mpeg', Buffer.concat([
    Buffer.from([0xff, 0xfb, 0xf0, 0x40]),
    Buffer.alloc(512)
  ])));
  await page.waitForFunction(() => window.AssetManager?.status?.audio?.valid === true);

  await page.click('#btn-analyze-audio');
  await page.waitForFunction(() => {
    const status = window.Store?.locks?.audioAnalysis;
    return window.__decodeProbe.decodeCalls > 0 || ['skipped', 'done', 'error', 'timeout'].includes(status);
  }, null, { timeout: 5000 });
  const analyzed = await page.evaluate(() => ({
    probe: window.__decodeProbe,
    lock: window.Store.locks.audioAnalysis,
    summary: document.querySelector('#audio-analysis-summary')?.textContent?.trim() || '',
    details: document.querySelector('#audio-analysis-list')?.textContent?.replace(/\s+/g, ' ').trim() || ''
  }));

  assert.deepEqual(analyzed.probe, { decodeCalls: 0, closes: 0 });
  assert.equal(analyzed.lock, 'skipped');
  assert.equal(analyzed.summary, '已跳过分析');
  assert.match(analyzed.details, /unknown compressed audio layout/i);
  assert.deepEqual(pageErrors, []);
  assert.deepEqual(consoleErrors, []);
});

test('audio analysis rejects single false-positive MP3 frame syncs before decode', { skip: !playwright && 'Bundled Playwright unavailable' }, async (t) => {
  assert.ok(fs.existsSync(htmlPath), 'index.html should exist');
  const browser = await playwright.chromium.launch({ headless: true });
  t.after(() => browser.close());

  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const consoleErrors = [];
  const pageErrors = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('pageerror', (err) => pageErrors.push(err.message));
  await page.addInitScript(() => {
    window.__decodeProbe = { decodeCalls: 0, closes: 0 };

    Object.defineProperty(HTMLMediaElement.prototype, 'duration', {
      configurable: true,
      get() {
        if (this.id === 'pool-audio') return 180;
        return Number.NaN;
      }
    });
    Object.defineProperty(HTMLMediaElement.prototype, 'readyState', {
      configurable: true,
      get() {
        if (this.id === 'pool-audio') return 4;
        return 0;
      }
    });
    HTMLMediaElement.prototype.load = function load() {
      if (this.id !== 'pool-audio') return undefined;
      setTimeout(() => {
        this.onloadedmetadata?.();
        this.oncanplay?.();
      }, 0);
      return undefined;
    };

    class FakeAudioContext {
      decodeAudioData(_arrayBuffer, success) {
        window.__decodeProbe.decodeCalls += 1;
        const buffer = {
          duration: 180,
          numberOfChannels: 2,
          sampleRate: 44100,
          length: 44100,
          getChannelData: () => new Float32Array(44100)
        };
        setTimeout(() => success?.(buffer), 0);
        return Promise.resolve(buffer);
      }

      close() {
        window.__decodeProbe.closes += 1;
        return Promise.resolve();
      }
    }
    window.AudioContext = FakeAudioContext;
    window.webkitAudioContext = FakeAudioContext;
  });

  await gotoApp(page);
  await page.waitForFunction(() => document.readyState === 'complete');
  await page.setInputFiles('#in-audio', filePayload('one-false-sync.mp3', 'audio/mpeg', tinyMp3Frame({ frames: 1 })));
  await page.waitForFunction(() => window.AssetManager?.status?.audio?.valid === true);

  await page.click('#btn-analyze-audio');
  await page.waitForFunction(() => {
    const status = window.Store?.locks?.audioAnalysis;
    return window.__decodeProbe.decodeCalls > 0 || ['skipped', 'done', 'error', 'timeout'].includes(status);
  }, null, { timeout: 5000 });
  const analyzed = await page.evaluate(() => ({
    probe: window.__decodeProbe,
    lock: window.Store.locks.audioAnalysis,
    summary: document.querySelector('#audio-analysis-summary')?.textContent?.trim() || '',
    details: document.querySelector('#audio-analysis-list')?.textContent?.replace(/\s+/g, ' ').trim() || ''
  }));

  assert.deepEqual(analyzed.probe, { decodeCalls: 0, closes: 0 });
  assert.equal(analyzed.lock, 'skipped');
  assert.equal(analyzed.summary, '已跳过分析');
  assert.match(analyzed.details, /unknown compressed audio layout/i);
  assert.deepEqual(pageErrors, []);
  assert.deepEqual(consoleErrors, []);
});

test('audio analysis uses FLAC STREAMINFO metadata to analyze safe stereo tracks beyond the unknown compressed precheck', { skip: !playwright && 'Bundled Playwright unavailable' }, async (t) => {
  assert.ok(fs.existsSync(htmlPath), 'index.html should exist');
  const browser = await playwright.chromium.launch({ headless: true });
  t.after(() => browser.close());

  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const consoleErrors = [];
  const pageErrors = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('pageerror', (err) => pageErrors.push(err.message));
  await page.addInitScript(() => {
    window.__decodeProbe = { decodeCalls: 0, closes: 0 };
    const safeChannel = new Float32Array(44100);

    Object.defineProperty(HTMLMediaElement.prototype, 'duration', {
      configurable: true,
      get() {
        if (this.id === 'pool-audio') return 180;
        return Number.NaN;
      }
    });
    Object.defineProperty(HTMLMediaElement.prototype, 'readyState', {
      configurable: true,
      get() {
        if (this.id === 'pool-audio') return 4;
        return 0;
      }
    });
    HTMLMediaElement.prototype.load = function load() {
      if (this.id !== 'pool-audio') return undefined;
      setTimeout(() => {
        this.onloadedmetadata?.();
        this.oncanplay?.();
      }, 0);
      return undefined;
    };

    class FakeAudioContext {
      decodeAudioData(_arrayBuffer, success) {
        window.__decodeProbe.decodeCalls += 1;
        const buffer = {
          duration: 180,
          numberOfChannels: 2,
          sampleRate: 44100,
          length: safeChannel.length,
          getChannelData: () => safeChannel
        };
        setTimeout(() => success?.(buffer), 0);
        return Promise.resolve(buffer);
      }

      close() {
        window.__decodeProbe.closes += 1;
        return Promise.resolve();
      }
    }
    window.AudioContext = FakeAudioContext;
    window.webkitAudioContext = FakeAudioContext;
  });

  await gotoApp(page);
  await page.waitForFunction(() => document.readyState === 'complete');
  await page.setInputFiles('#in-audio', filePayload('safe-stereo.flac', 'audio/flac', flacStreamInfo()));
  await page.waitForFunction(() => window.AssetManager?.status?.audio?.valid === true);

  await page.click('#btn-analyze-audio');
  await page.waitForFunction(() => {
    const status = window.Store?.locks?.audioAnalysis;
    return window.__decodeProbe.decodeCalls > 0 || ['skipped', 'done', 'error', 'timeout'].includes(status);
  }, null, { timeout: 5000 });
  const analyzed = await page.evaluate(() => ({
    probe: window.__decodeProbe,
    lock: window.Store.locks.audioAnalysis,
    summary: document.querySelector('#audio-analysis-summary')?.textContent?.trim() || '',
    details: document.querySelector('#audio-analysis-list')?.textContent?.replace(/\s+/g, ' ').trim() || ''
  }));

  assert.equal(analyzed.probe.decodeCalls, 1);
  assert.notEqual(analyzed.lock, 'skipped');
  assert.doesNotMatch(analyzed.summary, /SKIPPED/);
  assert.doesNotMatch(analyzed.details, /unknown compressed audio layout/i);
  assert.deepEqual(pageErrors, []);
  assert.deepEqual(consoleErrors, []);
});

test('audio analysis skips FLAC STREAMINFO tracks whose decoded Float32 size is unsafe before decode', { skip: !playwright && 'Bundled Playwright unavailable' }, async (t) => {
  assert.ok(fs.existsSync(htmlPath), 'index.html should exist');
  const browser = await playwright.chromium.launch({ headless: true });
  t.after(() => browser.close());

  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const consoleErrors = [];
  const pageErrors = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('pageerror', (err) => pageErrors.push(err.message));
  await page.addInitScript(() => {
    window.__decodeProbe = { decodeCalls: 0, closes: 0 };

    Object.defineProperty(HTMLMediaElement.prototype, 'duration', {
      configurable: true,
      get() {
        if (this.id === 'pool-audio') return 30;
        return Number.NaN;
      }
    });
    Object.defineProperty(HTMLMediaElement.prototype, 'readyState', {
      configurable: true,
      get() {
        if (this.id === 'pool-audio') return 4;
        return 0;
      }
    });
    HTMLMediaElement.prototype.load = function load() {
      if (this.id !== 'pool-audio') return undefined;
      setTimeout(() => {
        this.onloadedmetadata?.();
        this.oncanplay?.();
      }, 0);
      return undefined;
    };

    class FakeAudioContext {
      decodeAudioData(_arrayBuffer, success) {
        window.__decodeProbe.decodeCalls += 1;
        const buffer = {
          duration: 30,
          numberOfChannels: 8,
          sampleRate: 192000,
          length: 44100,
          getChannelData: () => new Float32Array(44100)
        };
        setTimeout(() => success?.(buffer), 0);
        return Promise.resolve(buffer);
      }

      close() {
        window.__decodeProbe.closes += 1;
        return Promise.resolve();
      }
    }
    window.AudioContext = FakeAudioContext;
    window.webkitAudioContext = FakeAudioContext;
  });

  await gotoApp(page);
  await page.waitForFunction(() => document.readyState === 'complete');
  await page.setInputFiles('#in-audio', filePayload('surround-high-rate.flac', 'audio/flac', flacStreamInfo({ sampleRate: 192000, channels: 8, bitsPerSample: 24, durationSec: 30 })));
  await page.waitForFunction(() => window.AssetManager?.status?.audio?.valid === true);

  await page.click('#btn-analyze-audio');
  await page.waitForFunction(() => {
    const status = window.Store?.locks?.audioAnalysis;
    return window.__decodeProbe.decodeCalls > 0 || ['skipped', 'done', 'error', 'timeout'].includes(status);
  }, null, { timeout: 5000 });
  const analyzed = await page.evaluate(() => ({
    probe: window.__decodeProbe,
    lock: window.Store.locks.audioAnalysis,
    summary: document.querySelector('#audio-analysis-summary')?.textContent?.trim() || '',
    details: document.querySelector('#audio-analysis-list')?.textContent?.replace(/\s+/g, ' ').trim() || ''
  }));

  assert.deepEqual(analyzed.probe, { decodeCalls: 0, closes: 0 });
  assert.equal(analyzed.lock, 'skipped');
  assert.equal(analyzed.summary, '已跳过分析');
  assert.match(analyzed.details, /decoded audio exceeds safe analysis window/i);
  assert.deepEqual(pageErrors, []);
  assert.deepEqual(consoleErrors, []);
});

test('audio analysis skips combined compressed and decoded working sets before decode', { skip: !playwright && 'Bundled Playwright unavailable' }, async (t) => {
  assert.ok(fs.existsSync(htmlPath), 'index.html should exist');
  const browser = await playwright.chromium.launch({ headless: true });
  t.after(() => browser.close());

  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const consoleErrors = [];
  const pageErrors = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('pageerror', (err) => pageErrors.push(err.message));
  await page.addInitScript(() => {
    window.__decodeProbe = { decodeCalls: 0, closes: 0 };

    Object.defineProperty(HTMLMediaElement.prototype, 'duration', {
      configurable: true,
      get() {
        if (this.id === 'pool-audio') return 300;
        return Number.NaN;
      }
    });
    Object.defineProperty(HTMLMediaElement.prototype, 'readyState', {
      configurable: true,
      get() {
        if (this.id === 'pool-audio') return 4;
        return 0;
      }
    });
    HTMLMediaElement.prototype.load = function load() {
      if (this.id !== 'pool-audio') return undefined;
      setTimeout(() => {
        this.onloadedmetadata?.();
        this.oncanplay?.();
      }, 0);
      return undefined;
    };

    class FakeAudioContext {
      decodeAudioData(_arrayBuffer, success) {
        window.__decodeProbe.decodeCalls += 1;
        const buffer = {
          duration: 300,
          numberOfChannels: 2,
          sampleRate: 44100,
          length: 300 * 44100
        };
        setTimeout(() => success?.(buffer), 0);
        return Promise.resolve(buffer);
      }

      close() {
        window.__decodeProbe.closes += 1;
        return Promise.resolve();
      }
    }
    window.AudioContext = FakeAudioContext;
    window.webkitAudioContext = FakeAudioContext;
  });

  const workingSetFlac = Buffer.concat([
    flacStreamInfo({ sampleRate: 44100, channels: 2, durationSec: 300 }),
    Buffer.alloc(64 * 1024 * 1024)
  ]);
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fad-mv-working-set-'));
  const workingSetPath = path.join(tempDir, 'combined-working-set.flac');
  fs.writeFileSync(workingSetPath, workingSetFlac);
  t.after(() => fs.rmSync(tempDir, { recursive: true, force: true }));

  await gotoApp(page);
  await page.waitForFunction(() => document.readyState === 'complete');
  await page.setInputFiles('#in-audio', workingSetPath);
  await page.waitForFunction(() => window.AssetManager?.status?.audio?.valid === true);

  await page.click('#btn-analyze-audio');
  await page.waitForFunction(() => window.Store?.locks?.audioAnalysis === 'skipped', null, { timeout: 5000 });
  const skipped = await page.evaluate(() => ({
    probe: window.__decodeProbe,
    lock: window.Store.locks.audioAnalysis,
    summary: document.querySelector('#audio-analysis-summary')?.textContent?.trim() || '',
    details: document.querySelector('#audio-analysis-list')?.textContent?.replace(/\s+/g, ' ').trim() || ''
  }));

  assert.deepEqual(skipped.probe, { decodeCalls: 0, closes: 0 });
  assert.equal(skipped.lock, 'skipped');
  assert.equal(skipped.summary, '已跳过分析');
  assert.match(skipped.details, /音频分析需要的内存超过安全预算/);
  assert.deepEqual(pageErrors, []);
  assert.deepEqual(consoleErrors, []);
});

test('audio analysis keeps malformed FLAC metadata on the unknown compressed skip path', { skip: !playwright && 'Bundled Playwright unavailable' }, async (t) => {
  assert.ok(fs.existsSync(htmlPath), 'index.html should exist');
  const browser = await playwright.chromium.launch({ headless: true });
  t.after(() => browser.close());

  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const consoleErrors = [];
  const pageErrors = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('pageerror', (err) => pageErrors.push(err.message));
  await page.addInitScript(() => {
    window.__decodeProbe = { decodeCalls: 0, closes: 0 };

    Object.defineProperty(HTMLMediaElement.prototype, 'duration', {
      configurable: true,
      get() {
        if (this.id === 'pool-audio') return 180;
        return Number.NaN;
      }
    });
    Object.defineProperty(HTMLMediaElement.prototype, 'readyState', {
      configurable: true,
      get() {
        if (this.id === 'pool-audio') return 4;
        return 0;
      }
    });
    HTMLMediaElement.prototype.load = function load() {
      if (this.id !== 'pool-audio') return undefined;
      setTimeout(() => {
        this.onloadedmetadata?.();
        this.oncanplay?.();
      }, 0);
      return undefined;
    };

    class FakeAudioContext {
      decodeAudioData(_arrayBuffer, success) {
        window.__decodeProbe.decodeCalls += 1;
        const buffer = {
          duration: 180,
          numberOfChannels: 2,
          sampleRate: 44100,
          length: 44100,
          getChannelData: () => new Float32Array(44100)
        };
        setTimeout(() => success?.(buffer), 0);
        return Promise.resolve(buffer);
      }

      close() {
        window.__decodeProbe.closes += 1;
        return Promise.resolve();
      }
    }
    window.AudioContext = FakeAudioContext;
    window.webkitAudioContext = FakeAudioContext;
  });

  await gotoApp(page);
  await page.waitForFunction(() => document.readyState === 'complete');
  await page.setInputFiles('#in-audio', filePayload('bad-streaminfo.flac', 'audio/flac', Buffer.from([
    0x66, 0x4c, 0x61, 0x43,
    0x84, 0x00, 0x00, 0x04,
    0x56, 0x4f, 0x52, 0x42
  ])));
  await page.waitForFunction(() => window.AssetManager?.status?.audio?.valid === true);

  await page.click('#btn-analyze-audio');
  await page.waitForFunction(() => {
    const status = window.Store?.locks?.audioAnalysis;
    return window.__decodeProbe.decodeCalls > 0 || ['skipped', 'done', 'error', 'timeout'].includes(status);
  }, null, { timeout: 5000 });
  const analyzed = await page.evaluate(() => ({
    probe: window.__decodeProbe,
    lock: window.Store.locks.audioAnalysis,
    summary: document.querySelector('#audio-analysis-summary')?.textContent?.trim() || '',
    details: document.querySelector('#audio-analysis-list')?.textContent?.replace(/\s+/g, ' ').trim() || ''
  }));

  assert.deepEqual(analyzed.probe, { decodeCalls: 0, closes: 0 });
  assert.equal(analyzed.lock, 'skipped');
  assert.equal(analyzed.summary, '已跳过分析');
  assert.match(analyzed.details, /unknown compressed audio layout/i);
  assert.deepEqual(pageErrors, []);
  assert.deepEqual(consoleErrors, []);
});

test('audio asset load rejects FLAC when browser metadata never provides a usable duration', { skip: !playwright && 'Bundled Playwright unavailable' }, async (t) => {
  assert.ok(fs.existsSync(htmlPath), 'index.html should exist');
  const browser = await playwright.chromium.launch({ headless: true });
  t.after(() => browser.close());

  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const consoleErrors = [];
  const pageErrors = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('pageerror', (err) => pageErrors.push(err.message));
  await page.addInitScript(() => {
    window.__durationProbe = { value: Number.NaN, events: [] };
    Object.defineProperty(HTMLMediaElement.prototype, 'duration', {
      configurable: true,
      get() {
        if (this.id === 'pool-audio') return window.__durationProbe.value;
        return Number.NaN;
      }
    });
    Object.defineProperty(HTMLMediaElement.prototype, 'readyState', {
      configurable: true,
      get() {
        if (this.id === 'pool-audio') return 4;
        return 0;
      }
    });
    HTMLMediaElement.prototype.load = function load() {
      if (this.id !== 'pool-audio') return undefined;
      setTimeout(() => {
        window.__durationProbe.events.push('loadedmetadata');
        this.onloadedmetadata?.();
        this.oncanplay?.();
      }, 0);
      return undefined;
    };
  });

  await gotoApp(page);
  await page.waitForFunction(() => document.readyState === 'complete');
  await page.setInputFiles('#in-audio', filePayload('zero-total.flac', 'audio/flac', flacStreamInfo({ totalSamples: 0 })));
  await page.waitForTimeout(5500);
  const result = await page.evaluate(() => ({
    status: window.AssetManager.status.audio,
    label: document.querySelector('#lbl-audio')?.textContent?.trim() || '',
    assetInputSummary: document.querySelector('#asset-input-summary')?.textContent?.trim() || '',
    preflight: document.querySelector('#preflight-summary')?.textContent?.trim() || '',
    previewDisabled: document.querySelector('#btn-preview')?.disabled,
    recordDisabled: document.querySelector('#btn-rec')?.disabled,
    events: window.__durationProbe.events
  }));

  assert.deepEqual(result.status, { name: '', valid: false, error: '音频时长不可用' });
  assert.equal(result.label, '选择音频');
  assert.match(result.assetInputSummary, /Audio 音频时长不可用/);
  assert.equal(result.previewDisabled, true);
  assert.equal(result.recordDisabled, true);
  assert.deepEqual(pageErrors, []);
  assert.deepEqual(consoleErrors, []);
});

test('audio asset load waits for durationchange before marking transient-zero-duration FLAC valid', { skip: !playwright && 'Bundled Playwright unavailable' }, async (t) => {
  assert.ok(fs.existsSync(htmlPath), 'index.html should exist');
  const browser = await playwright.chromium.launch({ headless: true });
  t.after(() => browser.close());

  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const consoleErrors = [];
  const pageErrors = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('pageerror', (err) => pageErrors.push(err.message));
  await page.addInitScript(() => {
    window.__durationProbe = { value: 0, events: [] };
    Object.defineProperty(HTMLMediaElement.prototype, 'duration', {
      configurable: true,
      get() {
        if (this.id === 'pool-audio') return window.__durationProbe.value;
        return Number.NaN;
      }
    });
    Object.defineProperty(HTMLMediaElement.prototype, 'readyState', {
      configurable: true,
      get() {
        if (this.id === 'pool-audio') return 4;
        return 0;
      }
    });
    HTMLMediaElement.prototype.load = function load() {
      if (this.id !== 'pool-audio') return undefined;
      setTimeout(() => {
        window.__durationProbe.events.push('loadedmetadata');
        this.onloadedmetadata?.();
      }, 0);
      setTimeout(() => {
        window.__durationProbe.value = 0.25;
        window.__durationProbe.events.push('durationchange');
        this.ondurationchange?.();
        this.oncanplay?.();
      }, 500);
      return undefined;
    };
  });

  await gotoApp(page);
  await page.waitForFunction(() => document.readyState === 'complete');
  await page.setInputFiles('#in-audio', filePayload('late-duration.flac', 'audio/flac', flacStreamInfo({ totalSamples: 0 })));
  await page.waitForFunction(() => window.AssetManager?.status?.audio?.valid === true);
  const result = await page.evaluate(() => ({
    status: window.AssetManager.status.audio,
    preflight: document.querySelector('#preflight-list')?.textContent?.replace(/\s+/g, ' ').trim() || '',
    label: document.querySelector('#lbl-audio')?.textContent?.trim() || '',
    events: window.__durationProbe.events
  }));

  assert.deepEqual(result.status, { name: 'late-duration.flac', valid: true, error: '' });
  assert.match(result.preflight, /late-duration\.flac · 0:00/);
  assert.equal(result.label, 'late-duration.flac');
  assert.ok(result.events.includes('durationchange'), `durationchange should occur before valid audio status: ${result.events.join(', ')}`);
  assert.deepEqual(pageErrors, []);
  assert.deepEqual(consoleErrors, []);
});

test('audio analysis can load and analyze a real Chromium-decoded FLAC file', { skip: !playwright && 'Bundled Playwright unavailable' }, async (t) => {
  const flac = realFlacBuffer(0.25);
  assert.ok(fs.existsSync(htmlPath), 'index.html should exist');
  const browser = await playwright.chromium.launch({ headless: true });
  t.after(() => browser.close());

  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const consoleErrors = [];
  const pageErrors = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('pageerror', (err) => pageErrors.push(err.message));

  await gotoApp(page);
  await page.waitForFunction(() => document.readyState === 'complete');
  await page.setInputFiles('#in-audio', filePayload('real-tone.flac', 'audio/flac', flac));
  await page.waitForFunction(() => window.AssetManager?.status?.audio?.valid === true);

  await page.click('#btn-analyze-audio');
  await page.waitForFunction(() => ['done', 'skipped', 'error', 'timeout'].includes(window.Store?.locks?.audioAnalysis), null, { timeout: 8000 });
  const analyzed = await page.evaluate(() => ({
    status: window.Store.locks.audioAnalysis,
    summary: document.querySelector('#audio-analysis-summary')?.textContent?.trim() || '',
    details: document.querySelector('#audio-analysis-list')?.textContent?.replace(/\s+/g, ' ').trim() || ''
  }));

  assert.equal(analyzed.status, 'done');
  assert.doesNotMatch(analyzed.summary, /SKIPPED|FAILED|TIMED OUT/i);
  assert.doesNotMatch(analyzed.details, /unknown compressed audio layout|duration unavailable/i);
  assert.deepEqual(pageErrors, []);
  assert.deepEqual(consoleErrors, []);
});

test('preview draw-frame exceptions stop preview without page errors', { skip: !playwright && 'Bundled Playwright unavailable' }, async (t) => {
  assert.ok(fs.existsSync(htmlPath), 'index.html should exist');
  const browser = await playwright.chromium.launch({ headless: true });
  t.after(() => browser.close());

  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const consoleErrors = [];
  const pageErrors = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('pageerror', (err) => pageErrors.push(err.message));
  await page.addInitScript(() => {
    window.__frameFaultProbe = { armed: false, thrown: 0 };
    const nativeDrawImage = CanvasRenderingContext2D.prototype.drawImage;
    CanvasRenderingContext2D.prototype.drawImage = function drawImage(...args) {
      if (window.__frameFaultProbe.armed && window.Machine?.status === 'PREVIEWING' && window.__frameFaultProbe.thrown === 0) {
        window.__frameFaultProbe.thrown += 1;
        throw new Error('forced preview draw fault');
      }
      return nativeDrawImage.apply(this, args);
    };

    const nativePause = HTMLMediaElement.prototype.pause;
    HTMLMediaElement.prototype.play = function play() {
      return Promise.resolve();
    };
    HTMLMediaElement.prototype.pause = function pause() {
      try { return nativePause.call(this); } catch (_) { return undefined; }
    };
  });

  await gotoApp(page);
  await page.waitForFunction(() => document.readyState === 'complete');
  await page.setInputFiles('#in-cover', filePayload('cover.png', 'image/png', tinyPng));
  await page.waitForFunction(() => window.AssetManager?.status?.cover?.valid === true);
  await page.setInputFiles('#in-logo', filePayload('logo.png', 'image/png', tinyPng));
  await page.waitForFunction(() => window.AssetManager?.status?.logo?.valid === true);
  await page.setInputFiles('#in-video', filePayload('center.png', 'image/png', tinyPng));
  await page.waitForFunction(() => window.AssetManager?.status?.video?.valid === true);
  await page.setInputFiles('#in-audio', filePayload('tone.wav', 'audio/wav', tinyWav({ durationSec: 0.5 })));
  await page.waitForFunction(() => window.AssetManager?.status?.audio?.valid === true);
  await page.waitForFunction(() => !document.querySelector('#btn-preview')?.disabled);

  await page.evaluate(() => { window.__frameFaultProbe.armed = true; });
  await page.click('#btn-preview');
  await page.waitForFunction(() => window.__frameFaultProbe?.thrown === 1 && window.Machine?.status === 'IDLE', null, { timeout: 8000 });

  const state = await page.evaluate(() => ({
    probe: window.__frameFaultProbe,
    machine: window.Machine.status,
    overlayDisplay: document.querySelector('#error-overlay')?.style.display || '',
    status: document.querySelector('#status-text')?.textContent?.trim() || '',
    warning: document.querySelector('#warning-log')?.textContent?.replace(/\s+/g, ' ').trim() || ''
  }));

  assert.deepEqual(pageErrors, []);
  assert.deepEqual(consoleErrors, []);
  assert.equal(state.probe.thrown, 1);
  assert.equal(state.machine, 'IDLE');
  assert.notEqual(state.overlayDisplay, 'flex');
  assert.match(`${state.status} ${state.warning}`, /预览已停止：画面渲染失败：forced preview draw fault/);
});

test('aborting during WARMING playback resume does not continue stale media reset work', { skip: !playwright && 'Bundled Playwright unavailable' }, async (t) => {
  assert.ok(fs.existsSync(htmlPath), 'index.html should exist');
  const browser = await playwright.chromium.launch({ headless: true });
  t.after(() => browser.close());

  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const consoleErrors = [];
  const pageErrors = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('pageerror', (err) => pageErrors.push(err.message));
  await page.addInitScript(() => {
    window.__warmAbort = { playCalls: 0, playResolved: 0, abortIssued: false, postAbortSeeks: [] };
    window.__releaseWarmPlay = null;

    const currentTimeDescriptor = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'currentTime');
    Object.defineProperty(HTMLMediaElement.prototype, 'currentTime', {
      configurable: true,
      get() {
        return currentTimeDescriptor?.get?.call(this) ?? 0;
      },
      set(value) {
        if (window.__warmAbort?.abortIssued && (this.id === 'pool-audio' || this.id === 'pool-video')) {
          window.__warmAbort.postAbortSeeks.push({ id: this.id, value });
        }
        if (currentTimeDescriptor?.set) currentTimeDescriptor.set.call(this, value);
      }
    });

    const nativePause = HTMLMediaElement.prototype.pause;
    HTMLMediaElement.prototype.play = function play() {
      if (this.id !== 'pool-audio') return Promise.resolve();
      window.__warmAbort.playCalls += 1;
      return new Promise((resolve) => {
        window.__releaseWarmPlay = () => {
          window.__warmAbort.playResolved += 1;
          resolve();
        };
      });
    };
    HTMLMediaElement.prototype.pause = function pause() {
      try { return nativePause.call(this); } catch (_) { return undefined; }
    };

    class UnusedMediaRecorder {
      static isTypeSupported(type) {
        return /^video\/webm/.test(String(type || ''));
      }
    }
    window.MediaRecorder = UnusedMediaRecorder;
  });

  await gotoApp(page);
  await page.waitForFunction(() => document.readyState === 'complete');
  await page.setInputFiles('#in-cover', filePayload('cover.png', 'image/png', tinyPng));
  await page.waitForFunction(() => window.AssetManager?.status?.cover?.valid === true);
  await page.setInputFiles('#in-logo', filePayload('logo.png', 'image/png', tinyPng));
  await page.waitForFunction(() => window.AssetManager?.status?.logo?.valid === true);
  await page.setInputFiles('#in-video', filePayload('center.png', 'image/png', tinyPng));
  await page.waitForFunction(() => window.AssetManager?.status?.video?.valid === true);
  await page.setInputFiles('#in-audio', filePayload('tone.wav', 'audio/wav', tinyWav({ durationSec: 0.5 })));
  await page.waitForFunction(() => window.AssetManager?.status?.audio?.valid === true);
  await page.waitForFunction(() => !document.querySelector('#btn-rec')?.disabled);

  await page.click('#btn-rec');
  await page.waitForFunction(() => window.Machine?.status === 'WARMING' && window.__warmAbort?.playCalls > 0, null, { timeout: 8000 });
  await page.evaluate(() => {
    window.__warmAbort.abortIssued = true;
  });
  await page.click('#btn-abort');
  await page.click('#btn-abort');
  await page.evaluate(() => window.__releaseWarmPlay?.());
  await page.waitForFunction(() => window.Machine?.status === 'IDLE' && window.__warmAbort?.playResolved > 0, null, { timeout: 5000 });

  const state = await page.evaluate(() => ({
    probe: window.__warmAbort,
    machine: window.Machine.status,
    overlayDisplay: document.querySelector('#error-overlay')?.style.display || '',
    status: document.querySelector('#status-text')?.textContent?.trim() || '',
    report: window.RenderReport.snapshot
  }));

  assert.deepEqual(pageErrors, []);
  assert.deepEqual(consoleErrors, []);
  assert.equal(state.machine, 'IDLE');
  assert.notEqual(state.overlayDisplay, 'flex');
  assert.equal(state.probe.playCalls, 1);
  assert.equal(state.probe.playResolved, 1);
  assert.deepEqual(state.probe.postAbortSeeks, []);
  assert.match(state.status, /导出已取消|准备就绪/);
  assert.notEqual(state.report?.output?.failed, true);
});

test('streaming save slow writer trips the runtime backlog guard and resets render state', { skip: !playwright && 'Bundled Playwright unavailable' }, async (t) => {
  assert.ok(fs.existsSync(htmlPath), 'index.html should exist');
  const browser = await playwright.chromium.launch({ headless: true });
  t.after(() => browser.close());

  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const consoleErrors = [];
  const pageErrors = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('pageerror', (err) => pageErrors.push(err.message));
  await page.addInitScript(() => {
    window.__streamProbe = { pickerCalls: 0, writeCalls: 0, closeCalls: 0, abortCalls: 0 };
    window.__streamProbeReleaseWrite = null;
    window.showSaveFilePicker = async () => {
      window.__streamProbe.pickerCalls += 1;
      return {
        async createWritable() {
          return {
            write() {
              window.__streamProbe.writeCalls += 1;
              return new Promise((resolve) => {
                window.__streamProbeReleaseWrite = resolve;
              });
            },
            close() {
              window.__streamProbe.closeCalls += 1;
              return Promise.resolve();
            },
            abort() {
              window.__streamProbe.abortCalls += 1;
              return Promise.resolve();
            }
          };
        }
      };
    };

    Object.defineProperty(HTMLImageElement.prototype, 'readyState', {
      configurable: true,
      get() { return 4; }
    });

    const nativePause = HTMLMediaElement.prototype.pause;
    HTMLMediaElement.prototype.play = function play() {
      return Promise.resolve();
    };
    HTMLMediaElement.prototype.pause = function pause() {
      try { return nativePause.call(this); } catch (_) { return undefined; }
    };

    class FakeMediaRecorder {
      constructor(stream, options = {}) {
        this.stream = stream;
        this.options = options;
        this.state = 'inactive';
        this.ondataavailable = null;
        this.onerror = null;
        this.onstop = null;
      }

      static isTypeSupported(type) {
        return /^video\/webm/.test(String(type || ''));
      }

      start() {
        this.state = 'recording';
        const chunkBytes = 34 * 1024 * 1024;
        const emit = () => {
          if (this.state === 'inactive') return;
          this.ondataavailable?.({ data: new Blob([new Uint8Array(chunkBytes)], { type: 'video/webm' }) });
        };
        setTimeout(() => {
          emit();
          setTimeout(emit, 0);
        }, 25);
      }

      stop() {
        this.state = 'inactive';
        setTimeout(() => this.onstop?.(), 0);
      }

      pause() {
        if (this.state === 'recording') this.state = 'paused';
      }

      resume() {
        if (this.state === 'paused') this.state = 'recording';
      }

      requestData() {}
    }
    window.MediaRecorder = FakeMediaRecorder;
  });

  await gotoApp(page);
  await page.waitForFunction(() => document.readyState === 'complete');

  await page.setInputFiles('#in-cover', filePayload('cover.png', 'image/png', tinyPng));
  await page.waitForFunction(() => window.AssetManager?.status?.cover?.valid === true);
  await page.setInputFiles('#in-logo', filePayload('logo.png', 'image/png', tinyPng));
  await page.waitForFunction(() => window.AssetManager?.status?.logo?.valid === true);
  await page.setInputFiles('#in-video', filePayload('center.png', 'image/png', tinyPng));
  await page.waitForFunction(() => window.AssetManager?.status?.video?.valid === true);
  await page.setInputFiles('#in-audio', filePayload('tone.wav', 'audio/wav', tinyWav({ durationSec: 0.5 })));
  await page.waitForFunction(() => window.AssetManager?.status?.audio?.valid === true);
  await page.check('#in-stream-save');
  await page.waitForFunction(() => !document.querySelector('#btn-rec')?.disabled);

  await page.click('#btn-rec');
  await page.waitForFunction(() => document.querySelector('#error-overlay')?.style.display === 'flex', null, { timeout: 8000 });
  const failed = await page.evaluate(() => ({
    probe: window.__streamProbe,
    title: document.querySelector('#error-title')?.textContent || '',
    message: document.querySelector('#err-msg')?.textContent || '',
    machine: window.Machine.status,
    report: window.RenderReport.snapshot,
    progressWidth: document.querySelector('#progress-fill')?.style.width || ''
  }));

  assert.deepEqual(pageErrors, []);
  assert.ok(consoleErrors.some((message) => message.includes('边生成边保存的磁盘写入积压超过')));
  assert.equal(failed.probe.pickerCalls, 1);
  assert.equal(failed.probe.writeCalls, 1);
  assert.equal(failed.title, '视频生成失败');
  assert.match(failed.message, /边生成边保存的磁盘写入积压超过 64\.0 MB/);
  assert.equal(failed.machine, 'IDLE');
  assert.equal(failed.progressWidth, '0%');
  assert.equal(failed.report?.output?.failed, true);
  assert.match(failed.report?.output?.error || '', /边生成边保存的磁盘写入积压超过/);

  await page.evaluate(() => window.__streamProbeReleaseWrite?.());
  await page.waitForFunction(() => {
    return window.__streamProbe.abortCalls === 1 && window.Recorder?.status?.usingStreamSave === false;
  }, null, { timeout: 5000 });
  const cleaned = await page.evaluate(() => ({
    probe: window.__streamProbe,
    usingStreamSave: window.Recorder.status.usingStreamSave
  }));
  assert.equal(cleaned.probe.abortCalls, 1);
  assert.equal(cleaned.usingStreamSave, false);
});

test('manual export download dispatch failure keeps a retryable rendered blob', { skip: !playwright && 'Bundled Playwright unavailable' }, async (t) => {
  assert.ok(fs.existsSync(htmlPath), 'index.html should exist');
  const browser = await playwright.chromium.launch({ headless: true });
  const context = await browser.newContext({ acceptDownloads: true, viewport: { width: 1280, height: 900 } });
  t.after(async () => {
    await context.close();
    await browser.close();
  });

  const page = await context.newPage();
  const consoleErrors = [];
  const pageErrors = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('pageerror', (err) => pageErrors.push(err.message));
  await page.addInitScript(() => {
    window.__manualDispatchFailure = { clicks: 0, failedClicks: 0, recorderEvents: [] };

    Object.defineProperty(HTMLImageElement.prototype, 'readyState', {
      configurable: true,
      get() { return 4; }
    });

    const nativePause = HTMLMediaElement.prototype.pause;
    HTMLMediaElement.prototype.play = function play() {
      return Promise.resolve();
    };
    HTMLMediaElement.prototype.pause = function pause() {
      try { return nativePause.call(this); } catch (_) { return undefined; }
    };

    const nativeAnchorClick = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function click(...args) {
      if (String(this.download || '').endsWith('_openfad.webm')) {
        window.__manualDispatchFailure.clicks += 1;
        if (!window.__manualDispatchFailure.failedClicks) {
          window.__manualDispatchFailure.failedClicks += 1;
          throw new Error('forced first export download click failure');
        }
      }
      return nativeAnchorClick.apply(this, args);
    };

    class FastMediaRecorder {
      constructor(stream, options = {}) {
        this.stream = stream;
        this.options = options;
        this.state = 'inactive';
        this.ondataavailable = null;
        this.onerror = null;
        this.onstop = null;
      }

      static isTypeSupported(type) {
        return /^video\/webm/.test(String(type || ''));
      }

      start() {
        window.__manualDispatchFailure.recorderEvents.push('start');
        this.state = 'recording';
        setTimeout(() => {
          if (this.state === 'inactive') return;
          window.__manualDispatchFailure.recorderEvents.push('data');
          this.ondataavailable?.({ data: new Blob([new Uint8Array(2048)], { type: 'video/webm' }) });
          setTimeout(() => {
            window.__manualDispatchFailure.recorderEvents.push('finish');
            document.querySelector('#btn-finish')?.click();
          }, 15);
          setTimeout(() => this.stop(), 35);
        }, 20);
      }

      stop() {
        if (this.state === 'inactive') return;
        window.__manualDispatchFailure.recorderEvents.push('stop');
        this.state = 'inactive';
        setTimeout(() => this.onstop?.(), 0);
      }

      pause() {
        if (this.state === 'recording') this.state = 'paused';
      }

      resume() {
        if (this.state === 'paused') this.state = 'recording';
      }

      requestData() {}
    }
    window.MediaRecorder = FastMediaRecorder;
  });

  await gotoApp(page);
  await page.waitForFunction(() => document.readyState === 'complete');
  await setProjectFields(page, { song: 'DISPATCH FAIL', artist: 'openFAD Fixture Artist' });
  await page.setInputFiles('#in-cover', filePayload('cover.png', 'image/png', tinyPng));
  await page.waitForFunction(() => window.AssetManager?.status?.cover?.valid === true);
  await page.setInputFiles('#in-logo', filePayload('logo.png', 'image/png', tinyPng));
  await page.waitForFunction(() => window.AssetManager?.status?.logo?.valid === true);
  await page.setInputFiles('#in-video', filePayload('center.png', 'image/png', tinyPng));
  await page.waitForFunction(() => window.AssetManager?.status?.video?.valid === true);
  await page.setInputFiles('#in-audio', filePayload('tone.wav', 'audio/wav', tinyWav({ durationSec: 0.5 })));
  await page.waitForFunction(() => window.AssetManager?.status?.audio?.valid === true);
  await page.waitForFunction(() => !document.querySelector('#btn-rec')?.disabled);

  await page.click('#btn-rec');
  await page.waitForFunction(() => window.RenderReport.snapshot?.output?.failurePhase === 'download-dispatch' && window.Machine?.status === 'IDLE', null, { timeout: 10000 });
  const failed = await page.evaluate(() => ({
    probe: window.__manualDispatchFailure,
    title: document.querySelector('#error-title')?.textContent || '',
    message: document.querySelector('#err-msg')?.textContent || '',
    report: window.RenderReport.snapshot,
    retryDisplay: document.querySelector('#btn-retry-export-download')?.style.display || '',
    retryDisabled: document.querySelector('#btn-retry-export-download')?.disabled,
    summary: document.querySelector('#render-report-summary')?.textContent?.trim() || '',
    listText: document.querySelector('#render-report-list')?.textContent?.trim().replace(/\s+/g, ' ') || ''
  }));

  assert.deepEqual(pageErrors, []);
  assert.ok(consoleErrors.some((message) => message.includes('成片下载失败: forced first export download click failure')));
  assert.equal(failed.probe.failedClicks, 1);
  assert.equal(failed.probe.clicks, 1);
  assert.equal(failed.title, '保存失败');
  assert.match(failed.message, /成片下载失败: forced first export download click failure/);
  assert.equal(failed.report?.output?.failed, true);
  assert.equal(failed.report?.output?.failurePhase, 'download-dispatch');
  assert.equal(failed.report?.output?.fileName, 'DISPATCH_FAIL_openfad.webm');
  assert.equal(failed.report?.output?.downloadDispatched, false);
  assert.equal(failed.report?.output?.saveVerified, false);
  assert.equal(failed.report?.output?.retryAvailable, true);
  assert.match(failed.summary, /导出记录显示失败/);
  assert.match(failed.listText, /可重试下载：首次下载触发失败/);
  assert.equal(failed.retryDisplay, 'block');
  assert.equal(failed.retryDisabled, false);

  await page.click('#btn-err-reset');
  const retryDownload = waitForDownloads(page, 1, 8000);
  await page.click('#btn-retry-export-download');
  const downloads = await retryDownload;
  const recovered = await page.evaluate(() => ({
    probe: window.__manualDispatchFailure,
    report: window.RenderReport.snapshot,
    summary: document.querySelector('#render-report-summary')?.textContent?.trim() || ''
  }));

  assert.equal(downloads[0].suggestedFilename(), 'DISPATCH_FAIL_openfad.webm');
  assert.equal(recovered.probe.clicks, 2);
  assert.equal(recovered.report?.output?.failed, false);
  assert.equal(recovered.report?.output?.downloadDispatched, true);
  assert.equal(recovered.report?.output?.saveVerified, false);
  assert.equal(recovered.report?.output?.retryAvailable, true);
  assert.match(recovered.report?.output?.recoveredFrom || '', /forced first export download click failure/);
  assert.match(recovered.summary, /导出记录已生成/);
});

test('streaming save close failure propagates root cause into fatal report', { skip: !playwright && 'Bundled Playwright unavailable' }, async (t) => {
  assert.ok(fs.existsSync(htmlPath), 'index.html should exist');
  const browser = await playwright.chromium.launch({ headless: true });
  t.after(() => browser.close());

  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const consoleErrors = [];
  const pageErrors = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('pageerror', (err) => pageErrors.push(err.message));
  await page.addInitScript(() => {
    window.__streamCloseFailure = { pickerCalls: 0, writeCalls: 0, closeCalls: 0, abortCalls: 0, recorderEvents: [] };
    window.showSaveFilePicker = async () => {
      window.__streamCloseFailure.pickerCalls += 1;
      return {
        async createWritable() {
          return {
            write() {
              window.__streamCloseFailure.writeCalls += 1;
              return Promise.resolve();
            },
            close() {
              window.__streamCloseFailure.closeCalls += 1;
              return Promise.reject(new Error('forced stream close permission failure'));
            },
            abort() {
              window.__streamCloseFailure.abortCalls += 1;
              return Promise.resolve();
            }
          };
        }
      };
    };

    Object.defineProperty(HTMLImageElement.prototype, 'readyState', {
      configurable: true,
      get() { return 4; }
    });

    const nativePause = HTMLMediaElement.prototype.pause;
    HTMLMediaElement.prototype.play = function play() {
      return Promise.resolve();
    };
    HTMLMediaElement.prototype.pause = function pause() {
      try { return nativePause.call(this); } catch (_) { return undefined; }
    };

    class FastMediaRecorder {
      constructor(stream, options = {}) {
        this.stream = stream;
        this.options = options;
        this.state = 'inactive';
        this.ondataavailable = null;
        this.onerror = null;
        this.onstop = null;
      }

      static isTypeSupported(type) {
        return /^video\/webm/.test(String(type || ''));
      }

      start() {
        window.__streamCloseFailure.recorderEvents.push('start');
        this.state = 'recording';
        setTimeout(() => {
          if (this.state === 'inactive') return;
          window.__streamCloseFailure.recorderEvents.push('data');
          this.ondataavailable?.({ data: new Blob([new Uint8Array(2048)], { type: 'video/webm' }) });
          setTimeout(() => {
            window.__streamCloseFailure.recorderEvents.push('finish');
            document.querySelector('#btn-finish')?.click();
          }, 15);
          setTimeout(() => this.stop(), 35);
        }, 20);
      }

      stop() {
        if (this.state === 'inactive') return;
        window.__streamCloseFailure.recorderEvents.push('stop');
        this.state = 'inactive';
        setTimeout(() => this.onstop?.(), 0);
      }

      pause() {
        if (this.state === 'recording') this.state = 'paused';
      }

      resume() {
        if (this.state === 'paused') this.state = 'recording';
      }

      requestData() {}
    }
    window.MediaRecorder = FastMediaRecorder;
  });

  await gotoApp(page);
  await page.waitForFunction(() => document.readyState === 'complete');
  await setProjectFields(page, { song: 'STREAM CLOSE FAIL', artist: 'openFAD Fixture Artist' });
  await page.setInputFiles('#in-cover', filePayload('cover.png', 'image/png', tinyPng));
  await page.waitForFunction(() => window.AssetManager?.status?.cover?.valid === true);
  await page.setInputFiles('#in-logo', filePayload('logo.png', 'image/png', tinyPng));
  await page.waitForFunction(() => window.AssetManager?.status?.logo?.valid === true);
  await page.setInputFiles('#in-video', filePayload('center.png', 'image/png', tinyPng));
  await page.waitForFunction(() => window.AssetManager?.status?.video?.valid === true);
  await page.setInputFiles('#in-audio', filePayload('tone.wav', 'audio/wav', tinyWav({ durationSec: 0.5 })));
  await page.waitForFunction(() => window.AssetManager?.status?.audio?.valid === true);
  await page.check('#in-stream-save');
  await page.waitForFunction(() => !document.querySelector('#btn-rec')?.disabled);

  await page.click('#btn-rec');
  await page.waitForFunction(() => window.RenderReport.snapshot?.output?.failurePhase === 'stream-finalize' && window.Machine?.status === 'IDLE', null, { timeout: 10000 });
  const failed = await page.evaluate(() => ({
    probe: window.__streamCloseFailure,
    title: document.querySelector('#error-title')?.textContent || '',
    message: document.querySelector('#err-msg')?.textContent || '',
    statusText: document.querySelector('#status-text')?.textContent?.trim() || '',
    warnings: document.querySelector('#warning-log')?.textContent?.replace(/\s+/g, ' ').trim() || '',
    report: window.RenderReport.snapshot,
    retryDisplay: document.querySelector('#btn-retry-export-download')?.style.display || ''
  }));

  assert.deepEqual(pageErrors, []);
  assert.ok(consoleErrors.some((message) => message.includes('边生成边保存失败：forced stream close permission failure')));
  assert.equal(failed.probe.pickerCalls, 1);
  assert.equal(failed.probe.writeCalls, 1);
  assert.equal(failed.probe.closeCalls, 1);
  assert.equal(failed.probe.abortCalls, 1);
  assert.equal(failed.title, '保存失败');
  assert.match(failed.message, /边生成边保存失败：forced stream close permission failure/);
  assert.equal(failed.report?.output?.failed, true);
  assert.equal(failed.report?.output?.failurePhase, 'stream-finalize');
  assert.equal(failed.report?.output?.fileName, 'STREAM_CLOSE_FAIL_openfad.webm');
  assert.match(failed.report?.output?.error || '', /边生成边保存失败：forced stream close permission failure/);
  assert.equal(failed.report?.output?.retryAvailable, false);
  assert.equal(failed.retryDisplay, 'none');
});

test('batch render waits through delayed audio canplay instead of failing at metadata readiness', { skip: !playwright && 'Bundled Playwright unavailable' }, async (t) => {
  assert.ok(fs.existsSync(htmlPath), 'index.html should exist');
  const browser = await playwright.chromium.launch({ headless: true });
  const context = await browser.newContext({ acceptDownloads: true, viewport: { width: 1280, height: 900 } });
  t.after(async () => {
    await context.close();
    await browser.close();
  });

  const page = await context.newPage();
  const consoleErrors = [];
  const pageErrors = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('pageerror', (err) => pageErrors.push(err.message));
  await page.addInitScript(() => {
    window.__audioCanplayGate = { force: true, playable: false, listenerCount: 0, listeners: [] };

    Object.defineProperty(HTMLImageElement.prototype, 'readyState', {
      configurable: true,
      get() { return 4; }
    });

    const readyStateDescriptor = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'readyState');
    Object.defineProperty(HTMLMediaElement.prototype, 'readyState', {
      configurable: true,
      get() {
        if (window.__audioCanplayGate?.force && this.id === 'pool-audio') {
          return window.__audioCanplayGate.playable ? 2 : 1;
        }
        return readyStateDescriptor?.get ? readyStateDescriptor.get.call(this) : 4;
      }
    });

    const nativeAddEventListener = HTMLMediaElement.prototype.addEventListener;
    HTMLMediaElement.prototype.addEventListener = function addEventListener(type, listener, options) {
      if (this.id === 'pool-audio' && type === 'canplay' && window.__audioCanplayGate?.force) {
        window.__audioCanplayGate.listenerCount += 1;
        window.__audioCanplayGate.listeners.push(listener);
        return undefined;
      }
      return nativeAddEventListener.call(this, type, listener, options);
    };
    const nativeRemoveEventListener = HTMLMediaElement.prototype.removeEventListener;
    HTMLMediaElement.prototype.removeEventListener = function removeEventListener(type, listener, options) {
      if (this.id === 'pool-audio' && type === 'canplay' && window.__audioCanplayGate?.force) {
        window.__audioCanplayGate.listeners = window.__audioCanplayGate.listeners.filter((item) => item !== listener);
        return undefined;
      }
      return nativeRemoveEventListener.call(this, type, listener, options);
    };

    const nativePause = HTMLMediaElement.prototype.pause;
    HTMLMediaElement.prototype.play = function play() {
      return Promise.resolve();
    };
    HTMLMediaElement.prototype.pause = function pause() {
      try { return nativePause.call(this); } catch (_) { return undefined; }
    };

    class FastMediaRecorder {
      constructor(stream, options = {}) {
        this.stream = stream;
        this.options = options;
        this.state = 'inactive';
        this.ondataavailable = null;
        this.onerror = null;
        this.onstop = null;
      }

      static isTypeSupported(type) {
        return /^video\/webm/.test(String(type || ''));
      }

      start() {
        this.state = 'recording';
        setTimeout(() => {
          if (this.state === 'inactive') return;
          this.ondataavailable?.({ data: new Blob([new Uint8Array(1024)], { type: 'video/webm' }) });
          setTimeout(() => document.querySelector('#btn-finish')?.click(), 15);
          setTimeout(() => this.stop(), 35);
        }, 20);
      }

      stop() {
        if (this.state === 'inactive') return;
        this.state = 'inactive';
        setTimeout(() => this.onstop?.(), 0);
      }

      pause() {
        if (this.state === 'recording') this.state = 'paused';
      }

      resume() {
        if (this.state === 'paused') this.state = 'recording';
      }

      requestData() {}
    }
    window.MediaRecorder = FastMediaRecorder;
  });

  await gotoApp(page);
  await page.waitForFunction(() => document.readyState === 'complete');
  await page.setInputFiles('#in-cover', filePayload('cover.png', 'image/png', tinyPng));
  await page.waitForFunction(() => window.AssetManager?.status?.cover?.valid === true);
  await page.setInputFiles('#in-logo', filePayload('logo.png', 'image/png', tinyPng));
  await page.waitForFunction(() => window.AssetManager?.status?.logo?.valid === true);
  await page.setInputFiles('#in-video', filePayload('center.png', 'image/png', tinyPng));
  await page.waitForFunction(() => window.AssetManager?.status?.video?.valid === true);
  await page.setInputFiles('#in-batch-audio', filePayload('delayed-canplay.wav', 'audio/wav', tinyWav({ durationSec: 0.25 })));
  await page.waitForFunction(() => window.BatchQueue?.status?.count === 1);
  await page.waitForFunction(() => !document.querySelector('#btn-start-batch')?.disabled);

  const downloadPromise = waitForDownloads(page, 1, 12000);
  await page.click('#btn-start-batch');
  await page.waitForFunction(() => window.__audioCanplayGate.listenerCount >= 1);
  await page.waitForTimeout(150);
  const gatedState = await page.evaluate(() => ({
    item: window.BatchQueue.status.items[0],
    preflight: window.Preflight.getRenderReadiness()
  }));
  assert.equal(gatedState.item.status, 'loading', `expected batch item to wait for canplay, got ${JSON.stringify(gatedState)}`);

  await page.evaluate(() => {
    window.__audioCanplayGate.playable = true;
    const event = new Event('canplay');
    const listeners = window.__audioCanplayGate.listeners.slice();
    listeners.forEach((listener) => listener.call(document.querySelector('#pool-audio'), event));
  });
  const downloads = await downloadPromise;
  await page.waitForFunction(() => {
    const status = window.BatchQueue?.status;
    return status && !status.running && status.items[0]?.status === 'download-dispatched';
  }, null, { timeout: 12000 });

  const finalState = await page.evaluate(() => ({
    status: window.BatchQueue.status,
    summary: document.querySelector('#batch-summary')?.textContent?.trim() || '',
    listText: document.querySelector('#batch-list')?.textContent?.trim().replace(/\s+/g, ' ') || ''
  }));

  assert.deepEqual(pageErrors, []);
  assert.deepEqual(consoleErrors, []);
  assert.equal(downloads[0].suggestedFilename(), 'DELAYED_CANPLAY_openfad.webm');
  assert.equal(finalState.status.items[0].status, 'download-dispatched');
  assert.equal(finalState.status.items[0].retryAvailable, true);
  assert.equal(await page.locator('[data-batch-retry-id]').count(), 1);
  assert.match(finalState.summary, /1\/1 下载已触发，请检查文件/);
  assert.match(finalState.listText, /delayed-canplay\.wav/);
  assert.match(finalState.listText, /下载已触发 .* 请检查文件/);

  await page.click('#btn-clear-batch');
  const firstClear = await page.evaluate(() => ({
    status: window.BatchQueue.status,
    clearText: document.querySelector('#btn-clear-batch')?.textContent?.trim() || '',
    summary: document.querySelector('#batch-summary')?.textContent?.trim() || '',
    statusText: document.querySelector('#status-text')?.textContent?.trim() || ''
  }));
  assert.equal(firstClear.status.count, 1);
  assert.equal(firstClear.status.items[0].retryAvailable, true);
  assert.match(firstClear.clearText, /确认丢弃批量输出.*确认丢弃/);
  assert.match(firstClear.summary, /已等待确认丢弃/);
  assert.match(firstClear.statusText, /清空批量会丢弃尚未验证保存的下载和可重试输出/);

  const retryDownloads = waitForDownloads(page, 1, 12000);
  await page.click('[data-batch-retry-id]');
  const retried = await retryDownloads;
  await page.waitForFunction(() => window.BatchQueue?.status?.items?.[0]?.status === 'download-dispatched');
  const afterRetry = await page.evaluate(() => ({
    status: window.BatchQueue.status,
    retryButtons: document.querySelectorAll('[data-batch-retry-id]').length,
    listText: document.querySelector('#batch-list')?.textContent?.trim().replace(/\s+/g, ' ') || ''
  }));
  assert.equal(retried[0].suggestedFilename(), 'DELAYED_CANPLAY_openfad.webm');
  assert.equal(afterRetry.status.items[0].retryAvailable, true);
  assert.equal(afterRetry.retryButtons, 1);
  assert.match(afterRetry.listText, /可重试下载/);

  await page.click('#btn-clear-batch');
  await page.waitForFunction(() => window.BatchQueue?.status?.count === 0);
  const secondClear = await page.evaluate(() => ({
    status: window.BatchQueue.status,
    clearText: document.querySelector('#btn-clear-batch')?.textContent?.trim() || '',
    summary: document.querySelector('#batch-summary')?.textContent?.trim() || '',
    retryButtons: document.querySelectorAll('[data-batch-retry-id]').length
  }));
  assert.equal(secondClear.status.count, 0);
  assert.match(secondClear.clearText, /清空批量.*移除列表/);
  assert.equal(secondClear.retryButtons, 0);
});

test('batch cancel interrupts stalled batch audio load and restores idle controls', { skip: !playwright && 'Bundled Playwright unavailable' }, async (t) => {
  assert.ok(fs.existsSync(htmlPath), 'index.html should exist');
  const browser = await playwright.chromium.launch({ headless: true });
  t.after(() => browser.close());

  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const consoleErrors = [];
  const pageErrors = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('pageerror', (err) => pageErrors.push(err.message));
  await page.addInitScript(() => localStorage.setItem('fad-mv-autosave', '0'));

  await gotoApp(page);
  await page.waitForFunction(() => document.readyState === 'complete');
  await page.setInputFiles('#in-cover', filePayload('cover.png', 'image/png', tinyPng));
  await page.waitForFunction(() => window.AssetManager?.status?.cover?.valid === true);
  await page.setInputFiles('#in-logo', filePayload('logo.png', 'image/png', tinyPng));
  await page.waitForFunction(() => window.AssetManager?.status?.logo?.valid === true);
  await page.setInputFiles('#in-video', filePayload('center.png', 'image/png', tinyPng));
  await page.waitForFunction(() => window.AssetManager?.status?.video?.valid === true);
  await setProjectFields(page, { song: 'ORIGINAL BEFORE BATCH', artist: 'openFAD Fixture Artist', label: 'Original Label' });
  await page.setInputFiles('#in-batch-audio', filePayload('batch-stall.wav', 'audio/wav', tinyWav({ durationSec: 0.25, frequency: 330 })));
  await page.waitForFunction(() => window.BatchQueue?.status?.count === 1);
  await page.evaluate(() => {
    window.__batchLoadCancelProbe = { poolAudioLoads: 0, held: false, heldSrc: '' };
    const objectUrlNames = new Map();
    const nativeCreateObjectURL = URL.createObjectURL.bind(URL);
    URL.createObjectURL = function createObjectURL(blob) {
      const url = nativeCreateObjectURL(blob);
      if (blob && typeof blob.name === 'string') objectUrlNames.set(url, blob.name);
      return url;
    };
    const poolAudio = document.querySelector('#pool-audio');
    let heldSrc = '';
    Object.defineProperty(poolAudio, 'src', {
      configurable: true,
      get() {
        return heldSrc;
      },
      set(value) {
        heldSrc = String(value || '');
        window.__batchLoadCancelProbe.heldSrc = heldSrc;
      }
    });
    Object.defineProperty(poolAudio, 'duration', {
      configurable: true,
      get() {
        return 0;
      }
    });
    Object.defineProperty(poolAudio, 'readyState', {
      configurable: true,
      get() {
        return 0;
      }
    });
    poolAudio.load = () => {
      const sourceName = objectUrlNames.get(heldSrc) || '';
      if (sourceName === 'batch-stall.wav') {
        window.__batchLoadCancelProbe.poolAudioLoads += 1;
        window.__batchLoadCancelProbe.held = true;
      }
      return undefined;
    };
    const nativeRemoveAttribute = poolAudio.removeAttribute.bind(poolAudio);
    poolAudio.removeAttribute = (name) => {
      if (String(name).toLowerCase() === 'src') {
        heldSrc = '';
        window.__batchLoadCancelProbe.heldSrc = '';
        return;
      }
      nativeRemoveAttribute(name);
    };
  });
  await page.waitForFunction(() => !document.querySelector('#btn-start-batch')?.disabled);

  await page.click('#btn-start-batch');
  await page.waitForFunction(() => window.__batchLoadCancelProbe?.held === true);
  const loadingState = await page.evaluate(() => ({
    status: window.BatchQueue.status,
    clearText: document.querySelector('#btn-clear-batch')?.textContent?.trim() || '',
    clearDisabled: document.querySelector('#btn-clear-batch')?.disabled
  }));
  assert.equal(loadingState.status.running, true);
  assert.equal(loadingState.status.items[0].status, 'loading');
  assert.match(loadingState.clearText, /取消批量.*停止队列/);
  assert.equal(loadingState.clearDisabled, false);

  await page.click('#btn-clear-batch');
  await page.waitForFunction(() => window.BatchQueue?.status?.running === false, null, { timeout: 1500 });
  const cancelled = await page.evaluate(() => ({
    probe: window.__batchLoadCancelProbe,
    status: window.BatchQueue.status,
    audio: window.AssetManager.status.audio,
    meta: window.Store.snapshot.meta,
    summary: document.querySelector('#batch-summary')?.textContent?.trim() || '',
    listText: document.querySelector('#batch-list')?.textContent?.trim().replace(/\s+/g, ' ') || '',
    statusText: document.querySelector('#status-text')?.textContent?.trim() || '',
    warnings: document.querySelector('#warning-log')?.textContent?.trim().replace(/\s+/g, ' ') || '',
    clearText: document.querySelector('#btn-clear-batch')?.textContent?.trim() || '',
    clearDisabled: document.querySelector('#btn-clear-batch')?.disabled
  }));

  assert.equal(cancelled.probe.poolAudioLoads, 1);
  assert.equal(cancelled.status.running, false);
  assert.equal(cancelled.status.cancelRequested, false);
  assert.equal(cancelled.status.items[0].status, 'error');
  assert.match(cancelled.status.items[0].error, /用户已取消批量导出|批量导出已取消/);
  assert.equal(cancelled.audio.valid, false);
  assert.deepEqual(cancelled.meta, { song: 'ORIGINAL BEFORE BATCH', artist: 'openFAD Fixture Artist', label: 'Original Label' });
  assert.match(`${cancelled.statusText} ${cancelled.warnings}`, /用户已取消批量导出|批量导出已取消/);
  assert.match(cancelled.listText, /batch-stall\.wav/);
  assert.match(cancelled.listText, /用户已取消批量导出|批量导出已取消/);
  assert.match(cancelled.clearText, /清空批量.*移除列表/);
  assert.equal(cancelled.clearDisabled, false);
  assert.deepEqual(pageErrors, []);
  assert.deepEqual(consoleErrors, []);
});

test('batch render fires a browser download for each item while keeping save verification honest', { skip: !playwright && 'Bundled Playwright unavailable' }, async (t) => {
  assert.ok(fs.existsSync(htmlPath), 'index.html should exist');
  const browser = await playwright.chromium.launch({ headless: true });
  const context = await browser.newContext({ acceptDownloads: true, viewport: { width: 1280, height: 900 } });
  t.after(async () => {
    await context.close();
    await browser.close();
  });

  const page = await context.newPage();
  const consoleErrors = [];
  const pageErrors = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('pageerror', (err) => pageErrors.push(err.message));
  await page.addInitScript(() => {
    window.__batchRecorderEvents = [];
    Object.defineProperty(HTMLImageElement.prototype, 'readyState', {
      configurable: true,
      get() { return 4; }
    });

    const nativePause = HTMLMediaElement.prototype.pause;
    HTMLMediaElement.prototype.play = function play() {
      return Promise.resolve();
    };
    HTMLMediaElement.prototype.pause = function pause() {
      try { return nativePause.call(this); } catch (_) { return undefined; }
    };

    class FastMediaRecorder {
      constructor(stream, options = {}) {
        this.stream = stream;
        this.options = options;
        this.state = 'inactive';
        this.ondataavailable = null;
        this.onerror = null;
        this.onstop = null;
      }

      static isTypeSupported(type) {
        return /^video\/webm/.test(String(type || ''));
      }

      start() {
        window.__batchRecorderEvents.push('start');
        this.state = 'recording';
        setTimeout(() => {
          if (this.state === 'inactive') return;
          window.__batchRecorderEvents.push('data');
          this.ondataavailable?.({ data: new Blob([new Uint8Array(1024)], { type: 'video/webm' }) });
          setTimeout(() => {
            window.__batchRecorderEvents.push('finish');
            document.querySelector('#btn-finish')?.click();
          }, 15);
          setTimeout(() => this.stop(), 35);
        }, 20);
      }

      stop() {
        if (this.state === 'inactive') return;
        window.__batchRecorderEvents.push('stop');
        this.state = 'inactive';
        setTimeout(() => this.onstop?.(), 0);
      }

      pause() {
        if (this.state === 'recording') this.state = 'paused';
      }

      resume() {
        if (this.state === 'paused') this.state = 'recording';
      }

      requestData() {}
    }
    window.MediaRecorder = FastMediaRecorder;
  });

  await gotoApp(page);
  await page.waitForFunction(() => document.readyState === 'complete');
  await page.setInputFiles('#in-cover', filePayload('cover.png', 'image/png', tinyPng));
  await page.waitForFunction(() => window.AssetManager?.status?.cover?.valid === true);
  await page.setInputFiles('#in-logo', filePayload('logo.png', 'image/png', tinyPng));
  await page.waitForFunction(() => window.AssetManager?.status?.logo?.valid === true);
  await page.setInputFiles('#in-video', filePayload('center.png', 'image/png', tinyPng));
  await page.waitForFunction(() => window.AssetManager?.status?.video?.valid === true);
  await page.setInputFiles('#in-batch-audio', [
    filePayload('batch-one.wav', 'audio/wav', tinyWav({ durationSec: 0.25, frequency: 330 })),
    filePayload('batch-two.wav', 'audio/wav', tinyWav({ durationSec: 0.25, frequency: 550 }))
  ]);
  await page.waitForFunction(() => window.BatchQueue?.status?.count === 2);
  await page.waitForFunction(() => !document.querySelector('#btn-start-batch')?.disabled);

  const downloadsPromise = waitForDownloads(page, 2, 12000);
  await page.click('#btn-start-batch');
  let downloads;
  try {
    downloads = await downloadsPromise;
  } catch (err) {
    const debug = await page.evaluate(() => ({
      status: window.BatchQueue?.status,
      events: window.__batchRecorderEvents,
      summary: document.querySelector('#batch-summary')?.textContent?.trim() || '',
      listText: document.querySelector('#batch-list')?.textContent?.trim().replace(/\s+/g, ' ') || ''
    }));
    throw new Error(`${err.message}; batch=${JSON.stringify(debug)}`);
  }
  await page.waitForFunction(() => {
    const status = window.BatchQueue?.status;
    return status && !status.running && status.items.every((item) => item.status === 'download-dispatched');
  }, null, { timeout: 12000 });

  const batchState = await page.evaluate(() => ({
    status: window.BatchQueue.status,
    summary: document.querySelector('#batch-summary')?.textContent?.trim() || '',
    listText: document.querySelector('#batch-list')?.textContent?.trim().replace(/\s+/g, ' ') || '',
    renderReport: window.RenderReport.snapshot,
    renderReportSummary: document.querySelector('#render-report-summary')?.textContent?.trim() || '',
    globalRetryDisplay: document.querySelector('#btn-retry-export-download')?.style.display || ''
  }));
  const names = downloads.map((download) => download.suggestedFilename()).sort();

  assert.deepEqual(pageErrors, []);
  assert.deepEqual(consoleErrors, []);
  assert.deepEqual(names, ['BATCH_ONE_openfad.webm', 'BATCH_TWO_openfad.webm']);
  assert.equal(batchState.status.count, 2);
  assert.equal(batchState.status.running, false);
  assert.deepEqual(batchState.status.items.map((item) => item.status), ['download-dispatched', 'download-dispatched']);
  assert.deepEqual(batchState.status.items.map((item) => item.outputName).sort(), ['BATCH_ONE_openfad.webm', 'BATCH_TWO_openfad.webm']);
  assert.deepEqual(batchState.status.items.map((item) => item.retryAvailable), [true, true]);
  assert.match(batchState.summary, /2\/2 下载已触发，请检查文件/);
  assert.match(batchState.listText, /下载已触发 .* 请检查文件/);
  assert.equal(batchState.renderReport?.output?.stale, true);
  assert.match(batchState.renderReport?.output?.staleReason || '', /批量导出后已恢复原项目/);
  assert.match(batchState.renderReportSummary, /导出记录已过期/);
  assert.equal(batchState.globalRetryDisplay, 'none');
  assert.equal(await page.locator('[data-batch-retry-id]').count(), 2);

  const retryPromise = waitForDownloads(page, 1, 8000);
  await page.locator('[data-batch-retry-id]').first().click();
  const retried = await retryPromise;
  assert.equal(retried[0].suggestedFilename(), 'BATCH_ONE_openfad.webm');
});

test('batch render exposes durable restore failure when original project audio cannot be restored', { skip: !playwright && 'Bundled Playwright unavailable' }, async (t) => {
  assert.ok(fs.existsSync(htmlPath), 'index.html should exist');
  const browser = await playwright.chromium.launch({ headless: true });
  const context = await browser.newContext({ acceptDownloads: true, viewport: { width: 1280, height: 900 } });
  t.after(async () => {
    await context.close();
    await browser.close();
  });

  const page = await context.newPage();
  const consoleErrors = [];
  const pageErrors = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('pageerror', (err) => pageErrors.push(err.message));
  await page.addInitScript(() => {
    window.__batchRestoreProbe = { audioLoads: 0, originalProjectLoads: 0, restoreStallLoads: 0, recorderEvents: [] };
    const objectUrlNames = new Map();
    const stalledRestoreElements = new WeakSet();
    const nativeCreateObjectURL = URL.createObjectURL.bind(URL);
    URL.createObjectURL = function createObjectURL(blob) {
      const url = nativeCreateObjectURL(blob);
      if (blob && typeof blob.name === 'string') objectUrlNames.set(url, blob.name);
      return url;
    };
    const nativeDuration = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'duration');
    Object.defineProperty(HTMLMediaElement.prototype, 'duration', {
      configurable: true,
      get() {
        if (stalledRestoreElements.has(this)) return NaN;
        return nativeDuration?.get?.call(this) ?? NaN;
      }
    });
    const nativeReadyState = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'readyState');
    Object.defineProperty(HTMLMediaElement.prototype, 'readyState', {
      configurable: true,
      get() {
        if (stalledRestoreElements.has(this)) return 0;
        return nativeReadyState?.get?.call(this) ?? 0;
      }
    });
    Object.defineProperty(HTMLImageElement.prototype, 'readyState', {
      configurable: true,
      get() { return 4; }
    });

    const nativeLoad = HTMLMediaElement.prototype.load;
    HTMLMediaElement.prototype.load = function load(...args) {
      const sourceName = objectUrlNames.get(this.getAttribute('src')) || '';
      const hasAudioSource = this.id === 'pool-audio' && !!sourceName;
      if (hasAudioSource) {
        window.__batchRestoreProbe.audioLoads += 1;
        if (sourceName === 'original-project.wav') window.__batchRestoreProbe.originalProjectLoads += 1;
        if (sourceName === 'original-project.wav' && window.__batchRestoreProbe.originalProjectLoads >= 2) {
          window.__batchRestoreProbe.restoreStallLoads += 1;
          stalledRestoreElements.add(this);
          return undefined;
        }
      }
      stalledRestoreElements.delete(this);
      return nativeLoad.apply(this, args);
    };

    const nativePause = HTMLMediaElement.prototype.pause;
    HTMLMediaElement.prototype.play = function play() {
      return Promise.resolve();
    };
    HTMLMediaElement.prototype.pause = function pause() {
      try { return nativePause.call(this); } catch (_) { return undefined; }
    };

    class FastMediaRecorder {
      constructor(stream, options = {}) {
        this.stream = stream;
        this.options = options;
        this.state = 'inactive';
        this.ondataavailable = null;
        this.onerror = null;
        this.onstop = null;
      }

      static isTypeSupported(type) {
        return /^video\/webm/.test(String(type || ''));
      }

      start() {
        window.__batchRestoreProbe.recorderEvents.push('start');
        this.state = 'recording';
        setTimeout(() => {
          if (this.state === 'inactive') return;
          window.__batchRestoreProbe.recorderEvents.push('data');
          this.ondataavailable?.({ data: new Blob([new Uint8Array(1024)], { type: 'video/webm' }) });
          setTimeout(() => {
            window.__batchRestoreProbe.recorderEvents.push('finish');
            document.querySelector('#btn-finish')?.click();
          }, 15);
          setTimeout(() => this.stop(), 35);
        }, 20);
      }

      stop() {
        if (this.state === 'inactive') return;
        window.__batchRestoreProbe.recorderEvents.push('stop');
        this.state = 'inactive';
        setTimeout(() => this.onstop?.(), 0);
      }

      pause() {
        if (this.state === 'recording') this.state = 'paused';
      }

      resume() {
        if (this.state === 'paused') this.state = 'recording';
      }

      requestData() {}
    }
    window.MediaRecorder = FastMediaRecorder;
  });

  await gotoApp(page);
  await page.waitForFunction(() => document.readyState === 'complete');
  await page.setInputFiles('#in-cover', filePayload('cover.png', 'image/png', tinyPng));
  await page.waitForFunction(() => window.AssetManager?.status?.cover?.valid === true);
  await page.setInputFiles('#in-logo', filePayload('logo.png', 'image/png', tinyPng));
  await page.waitForFunction(() => window.AssetManager?.status?.logo?.valid === true);
  await page.setInputFiles('#in-video', filePayload('center.png', 'image/png', tinyPng));
  await page.waitForFunction(() => window.AssetManager?.status?.video?.valid === true);
  await page.setInputFiles('#in-audio', filePayload('original-project.wav', 'audio/wav', tinyWav({ durationSec: 0.25, frequency: 220 })));
  await page.waitForFunction(() => window.AssetManager?.status?.audio?.valid === true);
  await page.click('#btn-analyze-audio');
  await page.waitForFunction(() => ['done', 'skipped', 'error', 'timeout'].includes(window.AudioAnalysis?.status?.status), null, { timeout: 8000 });
  const originalAnalysis = await page.evaluate(() => ({
    status: window.AudioAnalysis.status.status,
    sourceName: window.AudioAnalysis.status.result?.sourceName || ''
  }));
  assert.equal(originalAnalysis.status, 'done');
  assert.equal(originalAnalysis.sourceName, 'original-project.wav');
  await page.fill('#in-song', 'Original Track');
  await page.fill('#in-artist', 'Original Artist');
  await page.fill('#in-label', 'Original Label');
  await page.setInputFiles('#in-batch-audio', filePayload('batch-render.wav', 'audio/wav', tinyWav({ durationSec: 0.25, frequency: 660 })));
  await page.waitForFunction(() => window.BatchQueue?.status?.count === 1);
  await page.waitForFunction(() => !document.querySelector('#btn-start-batch')?.disabled);

  const downloadPromise = waitForDownloads(page, 1, 12000);
  const restoringPromise = page.waitForFunction(() => {
    const status = window.BatchQueue?.status;
    return status && status.running && status.restoring;
  }, null, { timeout: 12000 });
  await page.click('#btn-start-batch');
  let downloads;
  try {
    await restoringPromise;
    downloads = await downloadPromise;
  } catch (err) {
    const debug = await page.evaluate(() => ({
      status: window.BatchQueue?.status,
      summary: document.querySelector('#batch-summary')?.textContent?.trim() || '',
      listText: document.querySelector('#batch-list')?.textContent?.trim().replace(/\s+/g, ' ') || '',
      probe: window.__batchRestoreProbe,
      audioStatus: window.AssetManager?.status?.audio,
      preflight: window.Preflight?.getRenderReadiness?.()
    }));
    throw new Error(`${err.message}; batch=${JSON.stringify(debug)}`);
  }
  const restoringState = await page.evaluate(() => ({
    status: window.BatchQueue.status,
    summary: document.querySelector('#batch-summary')?.textContent?.trim() || '',
    clearText: document.querySelector('#btn-clear-batch')?.textContent?.trim() || '',
    clearDisabled: !!document.querySelector('#btn-clear-batch')?.disabled,
    clearReason: document.querySelector('#btn-clear-batch')?.dataset?.disabledReason || '',
    probe: window.__batchRestoreProbe
  }));
  assert.equal(restoringState.status.running, true);
  assert.equal(restoringState.status.restoring, true);
  assert.equal(restoringState.status.cancelRequested, false);
  assert.equal(restoringState.probe.restoreStallLoads, 1);
  assert.match(restoringState.summary, /正在恢复原项目/);
  assert.match(restoringState.clearText, /正在恢复原项目.*请稍候/);
  assert.equal(restoringState.clearDisabled, true);
  assert.equal(restoringState.clearReason, '正在恢复原项目');
  await page.waitForFunction(() => {
    const status = window.BatchQueue?.status;
    return status && !status.running && status.items[0]?.status === 'download-dispatched';
  }, null, { timeout: 12000 });

  const batchState = await page.evaluate(() => ({
    status: window.BatchQueue.status,
    summary: document.querySelector('#batch-summary')?.textContent?.trim() || '',
    listText: document.querySelector('#batch-list')?.textContent?.trim().replace(/\s+/g, ' ') || '',
    renderReport: window.RenderReport.snapshot,
    renderReportSummary: document.querySelector('#render-report-summary')?.textContent?.trim() || '',
    probe: window.__batchRestoreProbe,
    audioStatus: window.AssetManager.status.audio,
    meta: window.Store.snapshot.meta,
    fields: {
      song: document.querySelector('#in-song')?.value || '',
      artist: document.querySelector('#in-artist')?.value || '',
      label: document.querySelector('#in-label')?.value || ''
    },
    analysisStatus: window.AudioAnalysis.status.status,
    analysisSourceName: window.AudioAnalysis.status.result?.sourceName || '',
    analysisSummary: document.querySelector('#audio-analysis-summary')?.textContent?.trim() || ''
  }));

  assert.deepEqual(pageErrors, []);
  assert.deepEqual(consoleErrors, []);
  assert.equal(downloads[0].suggestedFilename(), 'BATCH_RENDER_openfad.webm');
  assert.equal(batchState.probe.restoreStallLoads, 1);
  assert.equal(batchState.status.restoring, false);
  assert.equal(batchState.status.items[0].status, 'download-dispatched');
  assert.equal(batchState.status.items[0].retryAvailable, true);
  assert.equal(batchState.status.restoreFailed, true);
  assert.match(batchState.status.restoreError, /audio载入失败：音频时长不可用/);
  assert.match(batchState.summary, /原项目恢复失败/);
  assert.equal(batchState.renderReport?.output?.stale, true);
  assert.match(batchState.renderReport?.output?.staleReason || '', /批量导出后原项目恢复失败/);
  assert.doesNotMatch(batchState.renderReport?.output?.staleReason || '', /已恢复原项目/);
  assert.match(batchState.renderReportSummary, /导出记录已过期/);
  assert.match(batchState.listText, /下载已触发 .* 请检查文件/);
  assert.equal(batchState.audioStatus.valid, false);
  assert.deepEqual(batchState.meta, { song: 'ORIGINAL TRACK', artist: 'Original Artist', label: 'Original Label' });
  assert.deepEqual(batchState.fields, { song: 'ORIGINAL TRACK', artist: 'Original Artist', label: 'Original Label' });
  assert.equal(batchState.analysisStatus, 'idle');
  assert.equal(batchState.analysisSourceName, '');
  assert.doesNotMatch(batchState.analysisSummary, /DONE|original-project\.wav/i);
});
