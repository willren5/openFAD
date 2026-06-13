import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { deflateSync } from 'node:zlib';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const htmlPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'index.html');
const htmlUrl = pathToFileURL(htmlPath).toString();

const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};

const assertLocalizedLabel = (actual, labels, percent, name) => {
  const expected = labels.map((label) => `${label} ${percent}%`);
  assert(expected.includes(actual), `Unexpected ${name} label: ${actual}`);
};

const crcTable = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
  return c >>> 0;
});

const crc32 = (buffer) => {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
};

const pngChunk = (type, data) => {
  const name = Buffer.from(type, 'ascii');
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([name, data])), 0);
  return Buffer.concat([length, name, data, crc]);
};

const createLargeValidPng = (payloadBytes = 14 * 1024 * 1024) => {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(1, 0);
  ihdr.writeUInt32BE(1, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const text = Buffer.concat([Buffer.from('Comment\0', 'latin1'), Buffer.alloc(payloadBytes, 65)]);
  const idat = deflateSync(Buffer.from([0, 128, 48, 48, 255]));
  return Buffer.concat([
    signature,
    pngChunk('IHDR', ihdr),
    pngChunk('tEXt', text),
    pngChunk('IDAT', idat),
    pngChunk('IEND', Buffer.alloc(0))
  ]);
};

const readComputedState = async (page) => page.evaluate(() => {
  const root = getComputedStyle(document.documentElement);
  const bg = document.getElementById('main-bg');
  const song = document.getElementById('songText');
  const artist = document.getElementById('artistText');
  const meta = document.getElementById('topMeta');
  const target = document.getElementById('selExportTarget');
  return {
    titleSize: getComputedStyle(song).fontSize,
    artistSize: getComputedStyle(artist).fontSize,
    metaSize: getComputedStyle(meta).fontSize,
    bgObjectPosition: getComputedStyle(bg).objectPosition,
    bgTransform: getComputedStyle(bg).transform,
    titleLabel: document.getElementById('titleSizeValue')?.textContent || '',
    artistLabel: document.getElementById('artistSizeValue')?.textContent || '',
    metaLabel: document.getElementById('metaSizeValue')?.textContent || '',
    exportValue: target?.value || '',
    validationText: document.getElementById('validationPanel')?.textContent || '',
    rootBgZoom: root.getPropertyValue('--bg-zoom').trim(),
    rootBgX: root.getPropertyValue('--bg-x').trim(),
    rootBgY: root.getPropertyValue('--bg-y').trim(),
    rootBgRot: root.getPropertyValue('--bg-rot').trim()
  };
});

const withPage = async (fn) => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    deviceScaleFactor: 1,
    acceptDownloads: true
  });
  const page = await context.newPage();
  const logs = [];
  page.on('console', (msg) => logs.push(`${msg.type()}: ${msg.text()}`));
  page.on('pageerror', (err) => logs.push(`pageerror: ${err.message}`));
  try {
    await page.goto(htmlUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForSelector('#artwork-canvas', { timeout: 10000 });
    await page.evaluate(() => localStorage.clear());
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForSelector('#artwork-canvas', { timeout: 10000 });
    await fn(page, logs);
  } finally {
    await context.close();
    await browser.close();
  }
};

const openProMode = async (page) => {
  await page.locator('#proMode').evaluate((el) => { el.open = true; });
};

const tests = [
  ['Phase 0 controls exist', async (page) => {
    const ids = [
      'btnResetProject',
      'btnOpenDemo',
      'selPreset',
      'btnSavePreset',
      'rngTitleSize',
      'rngArtistSize',
      'rngMetaSize',
      'rngBgZoom',
      'rngBgX',
      'rngBgY',
      'rngBgRot',
      'selExportTarget',
      'validationPanel',
      'exportStatus',
      'btnRetryExport',
      'btnDownloadProject',
      'proMode',
      'coverStartTitle',
      'fontPickerButton',
      'fontPickerMenu',
      'btnFontPrev',
      'btnFontNext'
    ];

    const missing = await page.evaluate((items) => items.filter((id) => !document.getElementById(id)), ids);
    assert(missing.length === 0, `Missing Phase 0 controls: ${missing.join(', ')}`);
  }],

  ['trusted release start mode is Chinese first with pro controls collapsed', async (page) => {
    const state = await page.evaluate(() => ({
      title: document.title,
      heading: document.getElementById('coverStartTitle')?.textContent?.trim(),
      proOpen: document.getElementById('proMode')?.open,
      demoText: document.getElementById('btnOpenDemo')?.textContent?.trim(),
      jpgText: document.getElementById('saveBtnJpg')?.textContent?.trim(),
      pngText: document.getElementById('saveBtnPng')?.textContent?.trim(),
      retryDisabled: document.getElementById('btnRetryExport')?.disabled,
      exportStatus: document.getElementById('exportStatus')?.textContent || '',
      telemetryText: document.getElementById('btnTelemetry')?.textContent?.trim(),
      telemetryPressed: document.getElementById('btnTelemetry')?.getAttribute('aria-pressed'),
      targetLabels: Array.from(document.getElementById('selExportTarget').options).map((opt) => opt.textContent),
      layerLabels: Array.from(document.getElementById('selLayerMode').options).map((opt) => opt.textContent)
    }));

    assert(/openFAD 封面制作器/.test(state.title), `Unexpected title: ${state.title}`);
    assert(state.heading === '制作一张发行封面', `Unexpected heading: ${state.heading}`);
    assert(state.proOpen === false, 'Pro mode should be collapsed by default');
    assert(state.demoText === '打开示例', `Unexpected demo text: ${state.demoText}`);
    assert(state.jpgText === '导出封面 JPG', `Unexpected JPG button: ${state.jpgText}`);
    assert(state.pngText === '导出透明图层', `Unexpected PNG button: ${state.pngText}`);
    assert(state.retryDisabled === true, 'Retry download should start disabled');
    assert(/还没有导出/.test(state.exportStatus), `Unexpected export status: ${state.exportStatus}`);
    assert(state.telemetryText === '分析: 关', `Telemetry should default off: ${state.telemetryText}`);
    assert(state.telemetryPressed === 'false', `Telemetry aria state should start false: ${state.telemetryPressed}`);
    assert(state.targetLabels.some((label) => /流媒体方形封面/.test(label)), `Missing Chinese target labels: ${state.targetLabels.join(', ')}`);
    assert(state.targetLabels.some((label) => /社媒竖图/.test(label)), `Missing social target labels: ${state.targetLabels.join(', ')}`);
    assert(state.layerLabels.includes('透明图层: 完整封面'), `Missing full layer label: ${state.layerLabels.join(', ')}`);
  }],

  ['open demo restores public safe example copy', async (page) => {
    await page.fill('#artistText', '测试艺人');
    await page.fill('#songText', '测试标题');
    await page.click('#btnOpenDemo');
    await page.waitForTimeout(180);

    const state = await page.evaluate(() => ({
      artist: document.getElementById('artistText').textContent,
      song: document.getElementById('songText').textContent,
      meta: Array.from(document.querySelectorAll('#topMeta .meta-item')).map((el) => el.textContent),
      bg: document.getElementById('main-bg').getAttribute('src'),
      bgWidth: document.getElementById('main-bg').naturalWidth,
      bgHeight: document.getElementById('main-bg').naturalHeight,
      logo: document.getElementById('logo-img').getAttribute('src'),
      status: document.getElementById('exportStatus').textContent,
      validation: document.getElementById('validationPanel').textContent,
      telemetrySession: localStorage.getItem('openfad-cover-telemetry-session-v1')
    }));

    assert(state.artist === '示例艺人', `Unexpected demo artist: ${state.artist}`);
    assert(state.song === '示例标题', `Unexpected demo title: ${state.song}`);
    assert(state.meta[0] === 'openFAD', `Unexpected demo meta: ${state.meta.join(' | ')}`);
    assert(state.bg.startsWith('data:image/svg+xml'), 'Demo background should be an embedded public safe SVG');
    assert(state.bgWidth >= 3000 && state.bgHeight >= 3000, `Demo background should be export-ready: ${state.bgWidth}x${state.bgHeight}`);
    assert(state.logo.startsWith('data:image/svg+xml'), 'Demo logo should be an embedded public safe SVG');
    assert(/示例已载入/.test(state.status), `Unexpected status: ${state.status}`);
    assert(/准备好了/.test(state.validation), `Demo project should pass validation: ${state.validation}`);
    assert(state.telemetrySession === null, 'Opening the demo should not create a telemetry session by default');
  }],

  ['independent title artist and meta size controls update only their targets', async (page) => {
    await openProMode(page);
    await page.locator('#rngTitleSize').evaluate((el) => {
      el.value = '140';
      el.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await page.locator('#rngArtistSize').evaluate((el) => {
      el.value = '70';
      el.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await page.locator('#rngMetaSize').evaluate((el) => {
      el.value = '125';
      el.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await page.waitForTimeout(120);

    const state = await readComputedState(page);
    assertLocalizedLabel(state.titleLabel, ['TITLE', '标题'], 140, 'title');
    assertLocalizedLabel(state.artistLabel, ['ARTIST', '艺人'], 70, 'artist');
    assertLocalizedLabel(state.metaLabel, ['META', '信息'], 125, 'meta');
    assert(Number.parseFloat(state.titleSize) > 82, `Title did not grow: ${state.titleSize}`);
    assert(Number.parseFloat(state.artistSize) < 32, `Artist did not shrink: ${state.artistSize}`);
    assert(Number.parseFloat(state.metaSize) > 14, `Meta did not grow: ${state.metaSize}`);
  }],

  ['background crop controls update CSS without replacing the image', async (page) => {
    await openProMode(page);
    await page.locator('#rngBgZoom').evaluate((el) => {
      el.value = '135';
      el.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await page.locator('#rngBgX').evaluate((el) => {
      el.value = '35';
      el.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await page.locator('#rngBgY').evaluate((el) => {
      el.value = '65';
      el.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await page.locator('#rngBgRot').evaluate((el) => {
      el.value = '8';
      el.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await page.waitForTimeout(120);

    const state = await readComputedState(page);
    assert(state.rootBgZoom === '1.35', `Unexpected bg zoom: ${state.rootBgZoom}`);
    assert(state.rootBgX === '35%', `Unexpected bg x: ${state.rootBgX}`);
    assert(state.rootBgY === '65%', `Unexpected bg y: ${state.rootBgY}`);
    assert(state.rootBgRot === '8deg', `Unexpected bg rotation: ${state.rootBgRot}`);
    assert(state.bgTransform !== 'none', 'Background transform was not applied');
  }],

  ['autosave restores editable text and controls after reload', async (page) => {
    await openProMode(page);
    await page.fill('#artistText', 'AUTOSAVE ARTIST');
    await page.fill('#songText', 'AUTOSAVE TITLE');
    await page.locator('#rngTitleSize').evaluate((el) => {
      el.value = '120';
      el.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await page.waitForTimeout(450);
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 30000 });
    await openProMode(page);
    await page.waitForSelector('#rngTitleSize', { state: 'attached', timeout: 10000 });
    await page.waitForTimeout(250);

    const restored = await page.evaluate(() => ({
      artist: document.getElementById('artistText').textContent,
      song: document.getElementById('songText').textContent,
      size: document.getElementById('rngTitleSize').value
    }));

    assert(restored.artist === 'AUTOSAVE ARTIST', `Artist was not restored: ${restored.artist}`);
    assert(restored.song === 'AUTOSAVE TITLE', `Title was not restored: ${restored.song}`);
    assert(restored.size === '120', `Title size was not restored: ${restored.size}`);
  }],

  ['preset save and load round-trips the current project state', async (page) => {
    await openProMode(page);
    await page.fill('#artistText', 'PRESET ARTIST');
    await page.fill('#songText', 'PRESET TITLE');
    await page.locator('#rngBgZoom').evaluate((el) => {
      el.value = '140';
      el.dispatchEvent(new Event('input', { bubbles: true }));
    });
    page.once('dialog', async (dialog) => {
      assert(dialog.type() === 'prompt', `Expected prompt, got ${dialog.type()}`);
      await dialog.accept('phase0-test-preset');
    });
    await page.click('#btnSavePreset');
    await page.waitForTimeout(250);

    await page.fill('#artistText', 'CHANGED ARTIST');
    await page.fill('#songText', 'CHANGED TITLE');
    await page.locator('#rngBgZoom').evaluate((el) => {
      el.value = '90';
      el.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await page.selectOption('#selPreset', 'custom:phase0-test-preset');
    await page.waitForTimeout(250);

    const restored = await page.evaluate(() => ({
      artist: document.getElementById('artistText').textContent,
      song: document.getElementById('songText').textContent,
      zoom: document.getElementById('rngBgZoom').value
    }));

    assert(restored.artist === 'PRESET ARTIST', `Preset artist mismatch: ${restored.artist}`);
    assert(restored.song === 'PRESET TITLE', `Preset title mismatch: ${restored.song}`);
    assert(restored.zoom === '140', `Preset zoom mismatch: ${restored.zoom}`);
  }],

  ['export target and validation panel expose platform readiness', async (page) => {
    await page.selectOption('#selExportTarget', 'dsp-3000');
    await page.waitForTimeout(120);
    const state = await readComputedState(page);
    assert(state.exportValue === 'dsp-3000', `Unexpected export target: ${state.exportValue}`);
    assert(/准备好了|需要确认/.test(state.validationText), `Validation panel not populated: ${state.validationText}`);
  }],

  ['background upload accepts valid source images larger than 13MB', async (page) => {
    const largePng = createLargeValidPng();
    assert(largePng.length > 13 * 1024 * 1024, `Test PNG is not large enough: ${largePng.length}`);

    await page.setInputFiles('#bgInput', {
      name: 'large-cover-source.png',
      mimeType: 'image/png',
      buffer: largePng
    });

    await page.waitForFunction(() => {
      const bg = document.getElementById('main-bg');
      return bg.complete && bg.naturalWidth === 1 && bg.src.startsWith('data:image/png');
    }, null, { timeout: 10000 });

    const state = await page.evaluate(() => ({
      srcPrefix: document.getElementById('main-bg').src.slice(0, 22),
      validationText: document.getElementById('validationPanel').textContent,
      toastText: document.getElementById('toast').textContent
    }));

    assert(state.srcPrefix === 'data:image/png;base64,', `Large image was not loaded as a data URL: ${state.srcPrefix}`);
    assert(!/too large|rejected/i.test(`${state.validationText} ${state.toastText}`), `Large image was rejected: ${JSON.stringify(state)}`);
  }],

  ['project JSON download includes openFAD verification metadata', async (page) => {
    await openProMode(page);
    const downloadPromise = page.waitForEvent('download');
    await page.click('#btnDownloadProject');
    const download = await downloadPromise;
    const suggested = download.suggestedFilename();
    assert(/^openfad-cover-project-.*\.json$/.test(suggested), `Unexpected project filename: ${suggested}`);

    const filePath = await download.path();
    assert(filePath, 'Download path was not available for project JSON');
    const payload = JSON.parse(readFileSync(filePath, 'utf8'));
    assert(payload.app?.project === 'openFAD', `Unexpected project metadata: ${JSON.stringify(payload.app)}`);
    assert(payload.app?.tool === 'cover-machine', `Unexpected tool metadata: ${JSON.stringify(payload.app)}`);
    assert(payload.app?.language === 'zh-CN', `Unexpected language metadata: ${JSON.stringify(payload.app)}`);
    assert(payload.exportPlan?.target?.id === 'dsp-3840', `Unexpected export target: ${JSON.stringify(payload.exportPlan)}`);
    assert(Array.isArray(payload.knownLimits) && payload.knownLimits.length >= 2, 'Expected known limits in project JSON');
  }],

  ['font picker expands fonts previews on hover and supports up down switching', async (page) => {
    await openProMode(page);
    const fontStats = await page.evaluate(() => ({
      count: document.getElementById('selSongFont').options.length,
      hasExo: Array.from(document.getElementById('selSongFont').options).some((opt) => opt.dataset.family === 'Exo 2'),
      hasWenkai: Array.from(document.getElementById('selSongFont').options).some((opt) => opt.dataset.family === 'LXGW WenKai')
    }));
    assert(fontStats.count >= 55, `Expected expanded font list, got ${fontStats.count}`);
    assert(fontStats.hasExo, 'Expected Exo 2 in expanded Latin fonts');
    assert(fontStats.hasWenkai, 'Expected LXGW WenKai in expanded CJK fonts');

    const initial = await page.evaluate(() => ({
      value: document.getElementById('selSongFont').value,
      button: document.getElementById('fontPickerButton').textContent,
      font: getComputedStyle(document.getElementById('songText')).fontFamily
    }));

    await page.click('#fontPickerButton');
    await page.locator('#fontPickerMenu .font-option[data-family="LXGW WenKai"]').hover();
    await page.waitForTimeout(250);

    const preview = await page.evaluate(() => ({
      selectedValue: document.getElementById('selSongFont').value,
      songFont: getComputedStyle(document.getElementById('songText')).fontFamily
    }));
    assert(preview.selectedValue === initial.value, 'Hover preview committed the select value');
    assert(/LXGW WenKai/.test(preview.songFont), `Hover preview did not apply LXGW WenKai: ${preview.songFont}`);

    await page.locator('#fontPickerMenu .font-option[data-family="LXGW WenKai"]').click();
    await page.waitForTimeout(250);
    const committed = await page.evaluate(() => ({
      selectedValue: document.getElementById('selSongFont').value,
      button: document.getElementById('fontPickerButton').textContent,
      songFont: getComputedStyle(document.getElementById('songText')).fontFamily
    }));
    assert(/LXGW WenKai/.test(committed.selectedValue), `Click did not commit LXGW WenKai: ${committed.selectedValue}`);
    assert(/LXGW WenKai|霞鹜文楷/.test(committed.button), `Button label did not update: ${committed.button}`);
    assert(/LXGW WenKai/.test(committed.songFont), `Committed font not applied: ${committed.songFont}`);

    await page.click('#btnFontPrev');
    await page.waitForTimeout(120);
    const afterPrev = await page.evaluate(() => document.getElementById('selSongFont').value);
    assert(afterPrev !== committed.selectedValue, 'Font previous button did not change selection');

    await page.click('#btnFontNext');
    await page.waitForTimeout(120);
    const afterNext = await page.evaluate(() => document.getElementById('selSongFont').value);
    assert(afterNext === committed.selectedValue, 'Font next button did not return to committed selection');
  }]
];

for (const [name, fn] of tests) {
  await withPage(async (page, logs) => {
    try {
      await fn(page);
      console.log(`PASS ${name}`);
    } catch (err) {
      if (logs.length) console.error(logs.join('\n'));
      throw new Error(`FAIL ${name}: ${err.message}`);
    }
  });
}
