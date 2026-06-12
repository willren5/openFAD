const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const htmlPath = path.join(__dirname, '..', 'index.html');
const html = fs.readFileSync(htmlPath, 'utf8');
const script = (html.match(/<script>([\s\S]*)<\/script>/) || [])[1] || '';

test('embedded application script parses as a browser classic script before static contract checks', () => {
  assert.ok(script.trim().length > 0, 'embedded script should be extracted');
  assert.doesNotThrow(() => new vm.Script(script));
});

function domMapIds() {
  const block = script.match(/const ids = \[([\s\S]*?)\];\n  const map/);
  assert.ok(block, 'Dom id registry should be present');
  return new Set([...block[1].matchAll(/'([^']+)'/g)].map((match) => match[1]));
}

function autoSaveApplySnapshotBody() {
  const body = script.match(/async applySnapshot\(snap(?:,[^{]*)?\) \{([\s\S]*?)\n  \},\n\n  async restoreSelectedRecent/)?.[1] || '';
  assert.ok(body, 'applySnapshot body should be present');
  return body;
}

function restoreRuntimeBody() {
  const body = script.match(/async restoreRuntime\(snapshot(?:,[^{]*)?\) \{([\s\S]*?)\n  \},\n\n  exportState/)?.[1] || '';
  assert.ok(body, 'ProjectPresets.restoreRuntime body should be present');
  return body;
}

test('status bar span is valid HTML and does not swallow the viewport', () => {
  assert.match(html, /<span id="status-text"[^>]*>[^<]*<\/span>/);
  assert.match(html, /<span id="status-live"[^>]*role="status"[^>]*aria-live="polite"[^>]*aria-atomic="true"/);
  assert.doesNotMatch(html, /<span id="status-text"[^>]*aria-live=/);
  assert.doesNotMatch(html, /<span id="status-text"[^>]*role="status"/);
  assert.doesNotMatch(html, /<span id="status-text">[^<]*span>/);
});

test('meta CSP only contains directives browsers can enforce from meta tags', () => {
  const csp = html.match(/http-equiv="Content-Security-Policy" content="([^"]+)"/)?.[1] || '';
  assert.ok(csp, 'Content-Security-Policy meta tag should be present');
  assert.doesNotMatch(csp, /frame-ancestors/);
});

test('single-file tool does not request external resources at boot', () => {
  assert.doesNotMatch(html, /https?:\/\//);
  const csp = html.match(/http-equiv="Content-Security-Policy" content="([^"]+)"/)?.[1] || '';
  assert.doesNotMatch(csp, /fonts\.googleapis|fonts\.gstatic/);
  assert.match(html, /--font-display:/);
  assert.match(script, /fontStack:/);
  assert.match(script, /Utils\.fontStack\(Store\.config\.fontName\)/);
});

test('asset file inputs are bound during boot without waiting for font readiness', () => {
  assert.match(html, /<label class="sub-label" for="in-audio">3\. 主音频<\/label>/);

  const assetBody = script.match(/const AssetManager = \{([\s\S]*?)\n\};\n\nconst ProjectPresets/)?.[1] || '';
  assert.ok(assetBody, 'AssetManager body should be present');
  assert.match(assetBody, /_bound: false/);
  assert.match(assetBody, /init\(\) \{[\s\S]*?if \(this\._bound\) return;[\s\S]*?this\._bound = true;[\s\S]*?this\.bindAll\(\)/);

  const bootBody = script.match(/window\.addEventListener\('load', \(\) => \{([\s\S]*?)\n\}, \{ once: true \}\)/)?.[1] || '';
  assert.ok(bootBody, 'load boot body should be present');
  assert.match(bootBody, /AssetManager\.init\(\)/);
  assert.ok(bootBody.indexOf('AssetManager.init()') < bootBody.indexOf('Engine.init()'), 'asset inputs should bind before Engine waits on fonts');

  const engineInitBody = script.match(/init\(\) \{([\s\S]*?)\n  \},\n\n  rebuildGradient/)?.[1] || '';
  assert.ok(engineInitBody, 'Engine.init body should be present');
  const fontsReadyAt = engineInitBody.indexOf('document.fonts.ready');
  assert.ok(fontsReadyAt >= 0, 'Engine.init should still react to font readiness');
  const fontsReadyTail = engineInitBody.slice(fontsReadyAt);
  assert.doesNotMatch(fontsReadyTail, /AssetManager\.init\(\)/);
});

test('all interactive controls are registered in the Dom lookup map', () => {
  const ids = domMapIds();
  for (const id of [
    'in-sensitivity', 'in-fx-intensity', 'in-glow-amount',
    'btn-save-project', 'btn-load-project', 'in-project-file',
    'preflight-summary', 'preflight-list',
    'btn-preset-records', 'btn-preset-sample', 'btn-preset-promo'
  ]) {
    assert.ok(ids.has(id), `${id} should be in Dom lookup map`);
  }
});

test('custom checkboxes keep their usable fixed hit target', () => {
  assert.doesNotMatch(html, /type="checkbox"[^>]*style="width:auto"/);
  assert.match(html, /input\[type="checkbox"\][\s\S]*?width: 32px; height: 32px; min-width: 32px/);
  assert.match(html, /input\[type="range"\][\s\S]*?min-height: 32px; height: 32px/);
  assert.match(html, /input\[type="range"\]::-webkit-slider-thumb[\s\S]*?width: 32px; height: 32px/);
  assert.match(html, /@media \(max-width: 720px\)[\s\S]*?input\[type="checkbox"\][\s\S]*?width: 44px;[\s\S]*?height: 44px;[\s\S]*?min-width: 44px/);
  assert.match(html, /@media \(max-width: 720px\)[\s\S]*?input\[type="range"\][\s\S]*?min-height: 44px;[\s\S]*?height: 44px/);
  assert.match(html, /@media \(max-width: 720px\)[\s\S]*?\.warning-clear[\s\S]*?width: 44px;[\s\S]*?height: 44px;[\s\S]*?min-height: 44px/);
  assert.match(html, /@media \(forced-colors: active\)/);
});

test('streaming save disabled state exposes browser support reason', () => {
  const ids = domMapIds();
  assert.ok(ids.has('stream-save-reason'), 'Streaming Save reason should be registered');
  assert.match(html, /id="in-stream-save"[^>]*aria-describedby="stream-save-reason"/);
  assert.match(html, /id="stream-save-reason" class="control-hint"/);
  assert.match(html, /\.control-hint:empty \{ display: none; \}/);
  assert.match(script, /updateStreamSaveControl\(/);
  assert.match(script, /Streaming Save requires Chrome or Edge File System Access support/);
  assert.match(script, /this\.setControlReason\(el, unsupported \|\| hardLock, reason, 'stream-save-reason'\)/);
  assert.match(script, /UI\.updateStreamSaveControl\(\{ state: Machine\.status \}\)/);
  assert.doesNotMatch(script, /Dom\['in-stream-save'\]\.disabled = true/);
});

test('duration display rounds total seconds instead of producing impossible 0:60 labels', () => {
  const formatBody = script.match(/formatSeconds: \(sec\) => \{([\s\S]*?)\n  \},\n  formatUiTime/)?.[1] || '';
  assert.ok(formatBody, 'Utils.formatSeconds body should be present');
  assert.match(formatBody, /const total = Math\.round\(sec\)/);
  assert.match(formatBody, /const m = Math\.floor\(total \/ 60\)/);
  assert.match(formatBody, /const s = total % 60/);
  assert.doesNotMatch(formatBody, /Math\.round\(sec % 60\)/);
});

test('preview canvas exposes an accessible name and fallback text', () => {
  assert.ok(domMapIds().has('canvas-summary'), 'canvas summary should be in Dom lookup map');
  assert.match(html, /<main class="viewport" aria-labelledby="preview-title">/);
  assert.match(html, /<canvas id="cvs"[^>]*role="img"[^>]*aria-label="[^"]*openFAD 视觉预览画布[^"]*openFAD visual preview canvas[^"]*"[^>]*aria-describedby="canvas-summary"[^>]*>当前浏览器无法显示画布预览 \/ Canvas preview is unavailable in this browser\.<\/canvas>/);
  assert.match(html, /id="canvas-summary" class="sr-only"/);
  assert.match(script, /updateCanvasSummary\(\)/);
  assert.match(script, /canvas\.setAttribute\('aria-label', `openFAD 视觉预览：\$\{title\} \/ \$\{artist\}`\)/);
});

test('first-run guide is Chinese-first and explains the render workflow', () => {
  assert.match(html, /<h1 id="app-title">制作一段音乐视觉/);
  assert.match(html, /openFAD MV Studio/);
  assert.match(html, /id="app-subtitle"[^>]*>本地优先的中文 MV Studio/);
  assert.match(html, /id="start-mode-actions"[^>]*aria-label="开始"/);
  assert.match(html, /id="btn-load-demo"[^>]*>[\s\S]*打开示例[\s\S]*Demo Project/);
  assert.match(html, /id="btn-upload-audio"[^>]*>[\s\S]*上传音频[\s\S]*Upload Audio/);
  assert.match(html, /id="btn-visual-cover"[^>]*>唱片封面视觉/);
  assert.match(html, /id="btn-visual-spectrum"[^>]*>频谱视觉/);
  assert.match(html, /id="btn-visual-logo"[^>]*>极简 Logo 视觉/);
  assert.match(html, /当前视觉系统：唱片封面视觉/);
  assert.match(html, /高级控制/);
  assert.match(html, /日常导出不需要打开/);
  assert.match(script, /const ProMode = \{/);
  assert.match(script, /new URLSearchParams\(window\.location\.search\)\.get\('pro'\) === '1'/);
  assert.match(script, /document\.body\.classList\.toggle\('pro-mode-open', this\.open\)/);
  assert.match(html, /<title>openFAD MV Studio — 制作一段音乐视觉<\/title>/);
  assert.match(html, /\.quick-guide/);
  assert.match(html, /id="quick-guide-title"[^>]*>快速开始[\s\S]*Quick Start/);
  assert.match(html, /最快路径是打开示例/);
  assert.match(html, /按预检补齐素材/);
  assert.match(html, /预检会告诉你还缺背景图、中心视频\/图片或透明 Logo/);
  assert.match(html, /预览/);
  assert.match(html, /导出视频/);
  assert.match(html, /完成并保存/);
  assert.match(html, /高级时间线、工程包、批量渲染和报告恢复/);
  assert.match(script, /const DemoProject = \{/);
  assert.match(script, /const VisualSystems = \{/);
  assert.match(script, /visualSystem: 'cover'/);
  assert.match(script, /profiles: \{\s*cover:[\s\S]*spectrum:[\s\S]*logo:/);
  assert.match(script, /openfad-demo-audio\.wav/);
  assert.match(script, /AssetManager\.loadFile\('cover', this\.coverFile\(\), \{ noAutosave: true \}\)/);
  assert.match(script, /AssetManager\.loadFile\('audio', this\.audioFile\(\), \{ noAutosave: true \}\)/);
  assert.match(script, /Dom\['btn-upload-audio'\]\?\.addEventListener\('click', \(\) => \{/);
  assert.match(script, /Dom\[`btn-visual-\$\{name\}`\]\?\.addEventListener\('click', \(\) => this\.apply\(name\)\)/);
});

test('diagnostic and report text remains selectable despite fixed chrome UI', () => {
  assert.match(html, /body \{[\s\S]*?user-select: none/);
  const selectableBlock = html.match(/\.preflight-panel,[\s\S]*?\.pro-mode-summary \{[\s\S]*?\}/)?.[0] || '';
  assert.ok(selectableBlock, 'selectable diagnostic CSS block should be present');
  for (const selector of ['.preflight-panel', '#err-msg', '#debug-panel', '#status-text', '.control-hint', '.pro-mode-summary']) {
    assert.match(selectableBlock, new RegExp(selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
  assert.match(selectableBlock, /user-select: text/);
  assert.match(selectableBlock, /-webkit-user-select: text/);
  assert.match(html, /\.debug-panel\.show \{[^}]*pointer-events: auto/);
  assert.doesNotMatch(selectableBlock, /\.file-upload-btn/);
});

test('state machine has a real RECORDING state that can export or abort', () => {
  assert.match(script, /RECORDING:\s*\[\s*'EXPORTING'\s*,\s*'IDLE'\s*\]/);
  assert.doesNotMatch(script, /\u5bfc\u51fa\u4e0e\u5f55\u5236:\s*\[/);
});

test('preview mode is part of the animation loop', () => {
  assert.match(script, /activeLoopStates/);
  assert.match(script, /activeLoopStates[\s\S]*PREVIEWING/);
  assert.match(script, /activeLoopStates[\s\S]*RECORDING/);
});

test('image center loops do not require HTMLMediaElement playback APIs', () => {
  assert.match(script, /isStaticVideoAsset/);
  assert.match(script, /typeof vid\.play === 'function'/);
});

test('timeline lock advances visual time and records dropped catch-up frames', () => {
  assert.match(script, /advanceTimeline/);
  assert.match(script, /targetVisualTimeSec\s*=/);
  assert.match(script, /visualTimeSec\s*\+=/);
  assert.match(script, /droppedSinceStart\s*\+=/);
});

test('project presets can export and import renderer state as JSON', () => {
  assert.match(script, /const ProjectPresets =/);
  assert.match(script, /schemaVersion:\s*1/);
  assert.match(script, /exportState\(\)/);
  assert.match(script, /importState\(/);
  assert.match(script, /downloadProject\(/);
});

test('project JSON export direct command honors busy locks before capturing state', () => {
  const presetsBody = script.match(/const ProjectPresets = \{([\s\S]*?)\n\};\n\nconst ProjectPackage/)?.[1] || '';
  assert.ok(presetsBody, 'ProjectPresets body should be present');

  const lockBody = presetsBody.match(/projectExportLockReason\(\) \{([\s\S]*?)\n  \},\n\n  downloadProject/)?.[1] || '';
  assert.ok(lockBody, 'ProjectPresets.projectExportLockReason body should be present');
  assert.match(lockBody, /if \(Store\.packageJob\.running\) return 'Package operation in progress\. Wait for it to finish before saving JSON\.'/);
  assert.match(lockBody, /if \(Store\.restoreJob\.running\) return 'Project restore in progress\. Wait for it to finish before saving JSON\.'/);
  assert.match(lockBody, /if \(Store\.autosaveJob\.running\) return 'Autosave in progress\. Wait for it to finish before saving JSON\.'/);
  assert.match(lockBody, /if \(Store\.batch\.running\) return 'Batch render in progress\. Wait or cancel it before saving JSON\.'/);
  assert.match(lockBody, /if \(Machine\.status !== 'IDLE'\) return `Wait for \$\{Machine\.status\.toLowerCase\(\)\} to finish before saving JSON\.`/);

  const downloadBody = presetsBody.match(/downloadProject\(\) \{([\s\S]*?)\n  \},\n\n  async loadProjectFile/)?.[1] || '';
  assert.ok(downloadBody, 'ProjectPresets.downloadProject body should be present');
  const lockAt = downloadBody.indexOf('const lockReason = this.projectExportLockReason()');
  const exportAt = downloadBody.indexOf('const state = this.exportState()');
  assert.ok(lockAt >= 0, 'downloadProject should check JSON export lock');
  assert.ok(lockAt < exportAt, 'downloadProject should lock before capturing project state');
  assert.match(downloadBody, /if \(lockReason\) \{[\s\S]*?UI\.showError\(lockReason, 'WARN'\);[\s\S]*?return false/);
});

test('preflight panel reports readiness before export', () => {
  assert.match(html, /id="preflight-summary"/);
  assert.match(html, /id="preflight-list"/);
  assert.match(script, /const Preflight =/);
  assert.match(script, /updatePreflight/);
  assert.match(script, /recordReady/);
  assert.match(script, /estimatedSizeBytes/);
  assert.match(script, /const summaryText = status\.recordReady \? '预检通过 \/ READY TO RENDER' : `需要检查：\$\{status\.blockers\[0\] \|\| '等待素材 \/ Waiting'\}`/);
  assert.match(script, /Dom\['preflight-summary'\]\.textContent = summaryText/);
});

test('brand visual presets expose one-click openFAD style controls', () => {
  assert.match(html, /data-preset="records"/);
  assert.match(html, /data-preset="sample"/);
  assert.match(html, /data-preset="promo"/);
  assert.match(script, /const BrandPresets =/);
  assert.match(script, /applyPreset\(/);
  assert.match(script, /presetMatchesCurrentState\(name\)/);
  assert.match(script, /syncActivePreset\(reason = 'Project changed'\)/);
  assert.match(script, /openFAD Public Release/);
  assert.match(script, /button\.classList\.toggle\('active', active\)/);
  assert.match(script, /button\.setAttribute\('aria-pressed', active \? 'true' : 'false'\)/);
});

test('brand partial presets do not erase existing song and artist metadata', () => {
  assert.match(script, /hasProjectField/);
  assert.match(script, /hasProjectField\(data\.meta,\s*'song'\)/);
  assert.match(script, /hasProjectField\(data\.meta,\s*'artist'\)/);
  assert.match(script, /hasProjectField\(data\.meta,\s*'label'\)/);
  const importBody = script.match(/importState\(raw, opts = \{\}\) \{([\s\S]*?)\n  \},\n\n  projectExportLockReason/)?.[1] || '';
  assert.ok(importBody, 'ProjectPresets.importState body should be present');
  assert.match(importBody, /Store\.flags\.activePreset = data\.presetName \|\| ''/);
  assert.match(importBody, /BrandPresets\.updateControls\(\)/);
});

test('audio analysis panel exposes commercial pre-render metrics', () => {
  const ids = domMapIds();
  for (const id of [
    'btn-analyze-audio', 'audio-analysis-summary', 'audio-analysis-list'
  ]) {
    assert.ok(ids.has(id), `${id} should be in Dom lookup map`);
  }
  assert.match(html, /id="btn-analyze-audio"/);
  assert.match(html, /id="audio-analysis-summary"/);
  assert.match(html, /id="audio-analysis-list"/);
});

test('debug panel shows active audio analysis status before stale bpm metrics', () => {
  const uiBody = script.match(/const UI = \{([\s\S]*?)\n\};\n\nconst Machine/)?.[1] || '';
  assert.ok(uiBody, 'UI body should be present');
  const updateDebugBody = uiBody.match(/updateDebug\(nowMs = performance\.now\(\)\) \{([\s\S]*?)\n  \}/)?.[1] || '';
  assert.ok(updateDebugBody, 'UI.updateDebug body should be present');
  assert.match(updateDebugBody, /AudioAnalysis\.debugBpmLabel\(\)/);
  assert.doesNotMatch(updateDebugBody, /Store\.audioAnalysis\.result\?\.\s*bpm/);

  const audioBody = script.match(/const AudioAnalysis = \{([\s\S]*?)\n\};\n\nconst Preflight/)?.[1] || '';
  assert.ok(audioBody, 'AudioAnalysis body should be present');
  const labelBody = audioBody.match(/debugBpmLabel\(\) \{([\s\S]*?)\n  \},\n\n  refreshReadiness/)?.[1] || '';
  assert.ok(labelBody, 'AudioAnalysis.debugBpmLabel body should be present');
  const resultAt = labelBody.indexOf('Store.audioAnalysis.result');
  assert.ok(resultAt > 0, 'debug bpm label should still show completed analysis bpm');
  for (const status of ['analyzing', 'skipped', 'error', 'timeout', 'cancelled']) {
    const statusAt = labelBody.indexOf(`status === '${status}'`);
    assert.ok(statusAt >= 0, `debug bpm label should disclose ${status} analysis state`);
    assert.ok(statusAt < resultAt, `debug bpm label should show ${status} before stale result metrics`);
  }
});

test('offline audio analysis estimates loudness peak bpm and beat markers', () => {
  assert.match(script, /const AudioAnalysis =/);
  assert.match(script, /estimateBpm/);
  assert.match(script, /beatMarkers/);
  assert.match(script, /peakDb/);
  assert.match(script, /loudnessDb/);
  assert.match(script, /dynamicRangeDb/);
  assert.match(script, /AudioAnalysis\.updatePanel/);
  assert.match(script, /analyzeCurrentFile/);
  assert.match(script, /Audio Analysis/);
});

test('audio analysis exposes mastering metrics and arrangement sections', () => {
  assert.match(script, /integratedLufs/);
  assert.match(script, /truePeakDb/);
  assert.match(script, /crestFactorDb/);
  assert.match(script, /stereoCorrelation/);
  assert.match(script, /detectSilenceEdges/);
  assert.match(script, /detectSections/);
  assert.match(script, /getSectionAt/);
  assert.match(script, /sectionIntensity/);
  assert.match(script, /LUFS/);
  assert.match(script, /True Peak/);
  assert.match(script, /Sections/);
});

test('audio analysis normalizes legacy saved analysis before rendering panels', () => {
  assert.match(script, /normalizeResult/);
  assert.match(script, /normalizeStoredAnalysis/);
  assert.match(script, /crestFactorDb:\s*Number\.isFinite/);
  assert.match(script, /integratedLufs:\s*Number\.isFinite/);
  assert.match(script, /maxSections: 64/);
  assert.match(script, /raw\.sections\.slice\(0, this\.maxSections\)/);
  assert.match(script, /Utils\.clampText\(String\(section\?\.label \|\| 'groove'\), 24\)/);
  assert.match(script, /raw\.beatMarkers\.slice\(0, this\.maxBeatMarkers\)/);
  assert.match(script, /\.filter\(Number\.isFinite\)/);
});

test('audio analysis token-gates stale async results and errors', () => {
  assert.match(script, /audioAnalysisJob:\s*\{ token: 0 \}/);
  const resetBody = script.match(/reset\(summary = ''\) \{([\s\S]*?)\n  \},\n\n  init/)?.[1] || '';
  assert.ok(resetBody, 'AudioAnalysis.reset body should be present');
  assert.match(resetBody, /Store\.audioAnalysisJob\.token \+= 1/);

  const analyzeBody = script.match(/async analyzeCurrentFile\(\) \{([\s\S]*?)\n  \},\n\n  getBeatPulse/)?.[1] || '';
  assert.ok(analyzeBody, 'AudioAnalysis.analyzeCurrentFile body should be present');
  assert.match(analyzeBody, /const token = Store\.audioAnalysisJob\.token \+ 1/);
  assert.match(analyzeBody, /Store\.audioAnalysisJob\.token = token/);
  assert.match(analyzeBody, /const isStale = \(\) => Store\.audioAnalysisJob\.token !== token \|\| Store\.rawFiles\.audio !== file/);
  assert.match(analyzeBody, /if \(isStale\(\)\) return null/);
  assert.ok(analyzeBody.indexOf('if (isStale()) return null;') < analyzeBody.indexOf("Store.audioAnalysis.status = 'done'"));
  const catchBody = analyzeBody.match(/\} catch \(err\) \{([\s\S]*?)\n    \}/)?.[1] || '';
  assert.ok(catchBody, 'AudioAnalysis.analyzeCurrentFile catch body should be present');
  assert.ok(catchBody.indexOf('if (isStale()) return null;') < catchBody.indexOf('Store.audioAnalysis.status = /timeout/i.test(message)'));
});

test('audio analysis direct command honors UI busy locks before mutation', () => {
  const audioBody = script.match(/const AudioAnalysis = \{([\s\S]*?)\n\};\n\nconst Preflight/)?.[1] || '';
  assert.ok(audioBody, 'AudioAnalysis body should be present');
  const lockBody = audioBody.match(/audioAnalysisLockReason\(\) \{([\s\S]*?)\n  \},\n\n  async analyzeCurrentFile/)?.[1] || '';
  assert.ok(lockBody, 'AudioAnalysis.audioAnalysisLockReason body should be present');
  assert.match(lockBody, /Store\.packageJob\.running/);
  assert.match(lockBody, /Store\.restoreJob\.running/);
  assert.match(lockBody, /Store\.batch\.running/);
  assert.match(lockBody, /Machine\.status !== 'IDLE'/);

  const analyzeBody = script.match(/async analyzeCurrentFile\(\) \{([\s\S]*?)\n  \},\n\n  getBeatPulse/)?.[1] || '';
  assert.ok(analyzeBody, 'AudioAnalysis.analyzeCurrentFile body should be present');
  assert.match(analyzeBody, /const lockReason = this\.audioAnalysisLockReason\(\)/);
  assert.ok(analyzeBody.indexOf('const lockReason = this.audioAnalysisLockReason()') < analyzeBody.indexOf('Store.audioAnalysisJob.token = token'));
  assert.ok(analyzeBody.indexOf('const lockReason = this.audioAnalysisLockReason()') < analyzeBody.indexOf("Store.audioAnalysis.status = 'skipped'"));
  assert.match(analyzeBody, /if \(lockReason\) \{[\s\S]*?UI\.showError\(lockReason, 'WARN'\)[\s\S]*?return false/);

  const panelBody = audioBody.match(/updatePanel\(\) \{([\s\S]*?)\n  \}/)?.[1] || '';
  assert.ok(panelBody, 'AudioAnalysis.updatePanel body should be present');
  assert.match(panelBody, /const lockReason = this\.audioAnalysisLockReason\(\)/);
  assert.match(panelBody, /button\.disabled = !hasAudio \|\| \(!isBusy && !!lockReason\)/);
});

test('audio decode avoids avoidable full-buffer copies before decode', () => {
  const decodeBody = script.match(/async decodeAudioFile\(file(?:,[^{]*)?\) \{([\s\S]*?)\n  \},\n\n  normalizeResult/)?.[1] || '';
  assert.ok(decodeBody, 'AudioAnalysis.decodeAudioFile body should be present');
  assert.doesNotMatch(decodeBody, /arrayBuffer\.slice\(0\)/);
  assert.match(decodeBody, /const arrayBuffer = await this\.readAudioFileForDecode\(file, token, analysisFile, deadlineMs\)/);
  assert.equal((decodeBody.match(/file\.arrayBuffer\(\)/g) || []).length, 0, 'decode should use cancellable chunked reads instead of one-shot file.arrayBuffer');
  assert.equal((decodeBody.match(/ctx\.decodeAudioData\(/g) || []).length, 1, 'decode should probe the browser decoder once');
  assert.match(decodeBody, /ctx\.decodeAudioData\(arrayBuffer, finish\(resolve\), finish\(reject\)\)/);

  const readBody = script.match(/async readAudioFileForDecode\(file, token, analysisFile, deadlineMs\) \{([\s\S]*?)\n  \},\n\n  async decodeAudioFile/)?.[1] || '';
  assert.ok(readBody, 'AudioAnalysis.readAudioFileForDecode body should be present');
  assert.match(readBody, /file\.stream\(\)\.getReader\(\)/);
  assert.match(readBody, /await this\.withAnalysisTimeout\(reader\.read\(\), token, analysisFile, deadlineMs, 'Audio read timeout'/);
  assert.match(readBody, /this\.throwIfAnalysisStale\(token, analysisFile, deadlineMs\)/);
  assert.match(readBody, /await reader\.cancel\(\)/);
  assert.match(readBody, /const expectedSize = file\.size/);
  assert.match(readBody, /const bytes = new Uint8Array\(expectedSize\)/);
  assert.match(readBody, /bytes\.set\(value, offset\)/);
  assert.doesNotMatch(readBody, /const chunks = \[\]/);
  assert.doesNotMatch(readBody, /chunks\.push/);
  assert.doesNotMatch(readBody, /new Uint8Array\(total\)/);
});

test('audio analysis yields during long offline scans and checks cancellation', () => {
  assert.match(script, /audioAnalysisYieldHops:\s*512/);
  assert.match(script, /audioAnalysisYieldBlocks:\s*128/);
  assert.match(script, /audioAnalysisYieldSamples:\s*250_000/);
  assert.match(script, /audioAnalysisTimeoutMs:\s*60000/);
  assert.match(script, /async yieldToBrowser\(\)/);
  assert.match(script, /throwIfAnalysisStale\(token, file, deadlineMs\)/);

  const analyzeBody = script.match(/async analyzeBuffer\(buffer, sourceName = '', token = Store\.audioAnalysisJob\.token, file = Store\.rawFiles\.audio, deadlineMs = 0\) \{([\s\S]*?)\n  \},\n\n  async detectOnsets/)?.[1] || '';
  assert.ok(analyzeBody, 'async AudioAnalysis.analyzeBuffer body should be present');
  assert.match(analyzeBody, /if \(hop > 0 && hop % LIMITS\.audioAnalysisYieldHops === 0\)/);
  assert.match(analyzeBody, /await this\.yieldToBrowser\(\)/);
  assert.match(analyzeBody, /this\.throwIfAnalysisStale\(token, file, deadlineMs\)/);
  assert.match(analyzeBody, /const mastering = await this\.estimateMasteringMetrics[\s\S]*deadlineMs/);
  assert.match(analyzeBody, /const onsetData = await this\.detectOnsets[\s\S]*deadlineMs/);

  const masteringBody = script.match(/async estimateMasteringMetrics\(channels, length, channelCount, sampleRate, totalSq, totalCount, peak, token, file, deadlineMs = 0\) \{([\s\S]*?)\n  \},\n\n  async estimateGatedMeanSquare/)?.[1] || '';
  assert.ok(masteringBody, 'async estimateMasteringMetrics body should be present');
  assert.match(masteringBody, /if \(scanned > 0 && scanned % LIMITS\.audioAnalysisYieldSamples === 0\)/);
  assert.match(masteringBody, /await this\.yieldToBrowser\(\)/);
  assert.match(masteringBody, /this\.throwIfAnalysisStale\(token, file, deadlineMs\)/);

  const currentBody = script.match(/async analyzeCurrentFile\(\) \{([\s\S]*?)\n  \},\n\n  getBeatPulse/)?.[1] || '';
  assert.ok(currentBody, 'AudioAnalysis.analyzeCurrentFile body should be present');
  assert.match(currentBody, /const deadlineMs = Date\.now\(\) \+ LIMITS\.audioAnalysisTimeoutMs/);
  assert.match(currentBody, /const result = await this\.analyzeBuffer\(buffer, file\.name \|\| Store\.assetNames\.audio \|\| '', token, file, deadlineMs\)/);
});

test('fadmv project packages include JSON and portable asset controls', () => {
  const ids = domMapIds();
  for (const id of ['btn-save-package', 'btn-load-package', 'btn-cancel-package', 'btn-retry-package-download', 'in-package-file', 'package-summary', 'package-list']) {
    assert.ok(ids.has(id), `${id} should be in Dom lookup map`);
  }
  assert.match(html, /保存 \.fadmv[\s\S]*Save Package/);
  assert.match(html, /取消包任务[\s\S]*Cancel Package/);
  assert.match(html, /重试项目包下载[\s\S]*Retry Package Download/);
  assert.match(html, /id="btn-save-package"[^>]*aria-describedby="package-summary"/);
  assert.match(html, /id="btn-retry-package-download"[^>]*aria-describedby="package-summary"/);
  assert.match(html, /id="package-summary"/);
  assert.match(script, /const ProjectPackage =/);
  assert.match(script, /createZip/);
  assert.match(script, /parseZip/);
  assert.match(script, /project\.json/);
  assert.match(script, /assets\//);
});

test('fadmv package MIME fallback preserves FLAC audio type', () => {
  const packageBody = script.match(/const ProjectPackage = \{([\s\S]*?)\n\};\n\nconst AutoSave/)?.[1] || '';
  assert.ok(packageBody, 'ProjectPackage body should be present');
  const mimeBody = packageBody.match(/mimeForAsset\(type, name\) \{([\s\S]*?)\n  \},\n\n  async importPackageFile/)?.[1] || '';
  assert.ok(mimeBody, 'ProjectPackage.mimeForAsset body should be present');
  assert.match(mimeBody, /flac:\s*'audio\/flac'/);
  assert.match(mimeBody, /wav:\s*'audio\/wav'/);
  assert.match(mimeBody, /mp3:\s*'audio\/mpeg'/);
});

test('fadmv package import validates portable zip integrity and paths', () => {
  assert.match(script, /isSafePackagePath/);
  assert.match(script, /typeof name !== 'string'/);
  assert.match(script, /validatePackageAssets/);
  assert.match(script, /CRC mismatch/);
  assert.match(script, /Unsafe package path/);
  assert.match(script, /Duplicate package entry/);
  assert.match(script, /maxPackageBytes/);
  assert.match(script, /maxPackageExportBytes/);
  assert.match(script, /maxProjectJsonBytes/);
  assert.match(script, /AssetManager\.clearAsset\(type\)/);
});

test('fadmv import validates asset manifest before mutating project state', () => {
  const importBody = script.match(/async importPackageFile\(file\) \{([\s\S]*?)\n  \},\n\n  init\(\)/)?.[1] || '';
  assert.ok(importBody, 'importPackageFile body should be present');
  const validateAt = importBody.indexOf('this.validatePackageAssets(project.packageAssets, entries)');
  const mutateAt = importBody.indexOf('ProjectPresets.importState(project, { silent: true, noAutosave: true, skipAudioAnalysis: true, allowLockedMutation: true })');
  assert.ok(validateAt >= 0, 'package asset manifest should be validated during import');
  assert.ok(mutateAt >= 0, 'project state import should still happen');
  assert.ok(validateAt < mutateAt, 'package validation should happen before project state mutation');
  assert.match(script, /Package missing asset/);
  assert.match(script, /Invalid package asset manifest/);
});

test('fadmv asset manifest names are bounded before File construction', () => {
  assert.match(script, /maxPackageAssetNameLen:\s*160/);
  assert.match(script, /safeManifestAssetName\(type, meta/);

  const validateBody = script.match(/validatePackageAssets\(assets, entries\) \{([\s\S]*?)\n  \},\n\n  async parseZip/)?.[1] || '';
  assert.ok(validateBody, 'validatePackageAssets body should be present');
  assert.match(validateBody, /const safeName = this\.safeManifestAssetName\(type, meta\)/);
  assert.match(validateBody, /valid\[type\] = \{ \.\.\.meta, name: safeName \}/);

  const exportBody = script.match(/async exportPackageBlob\(\) \{([\s\S]*?)\n  \},\n\n  async downloadPackage/)?.[1] || '';
  assert.ok(exportBody, 'exportPackageBlob body should be present');
  assert.match(exportBody, /name: this\.safeManifestAssetName\(item\.type, \{ name: item\.file\.name \|\| item\.type \}, \{ forExport: true \}\)/);

  const importBody = script.match(/async importPackageFile\(file\) \{([\s\S]*?)\n  \},\n\n  init\(\)/)?.[1] || '';
  assert.ok(importBody, 'importPackageFile body should be present');
  assert.match(importBody, /new File\(\[blob\], meta\.name, \{ type: blob\.type, lastModified: meta\.lastModified \|\| Date\.now\(\) \}\)/);
  assert.doesNotMatch(importBody, /new File\(\[blob\], meta\.name \|\| `\$\{type\}\.asset`/);
});

test('fadmv package imports reject project-declared assets missing from packageAssets', () => {
  assert.match(script, /validatePackageCompleteness\(project, assets\)/);
  const completenessBody = script.match(/validatePackageCompleteness\(project, assets\) \{([\s\S]*?)\n  \},\n\n  async parseZip/)?.[1] || '';
  assert.ok(completenessBody, 'validatePackageCompleteness body should be present');
  assert.match(completenessBody, /ProjectPresets\.listedAssetRefs\(project\)/);
  assert.match(completenessBody, /if \(!assets\[type\]\?\.path\) throw new Error\(`Package missing declared \$\{type\} asset: \$\{name\}`\)/);

  const importBody = script.match(/async importPackageFile\(file\) \{([\s\S]*?)\n  \},\n\n  init\(\)/)?.[1] || '';
  assert.ok(importBody, 'importPackageFile body should be present');
  const validateAt = importBody.indexOf('const assets = this.validatePackageAssets(project.packageAssets, entries)');
  const completenessAt = importBody.indexOf('this.validatePackageCompleteness(project, assets)');
  const mutateAt = importBody.indexOf('ProjectPresets.importState(project, { silent: true, noAutosave: true, skipAudioAnalysis: true, allowLockedMutation: true })');
  assert.ok(validateAt >= 0, 'asset manifest validation should remain present');
  assert.ok(completenessAt > validateAt, 'completeness check should run after manifest validation');
  assert.ok(completenessAt < mutateAt, 'package completeness should be checked before project mutation');
});

test('autosave and recent projects persist snapshots in IndexedDB', () => {
  const ids = domMapIds();
  for (const id of ['in-autosave', 'btn-save-snapshot', 'btn-restore-latest', 'recent-projects', 'btn-restore-selected', 'autosave-summary', 'autosave-list']) {
    assert.ok(ids.has(id), `${id} should be in Dom lookup map`);
  }
  assert.match(script, /const AutoSave =/);
  assert.match(script, /indexedDB/);
  assert.match(script, /assetStoreName:\s*'assets'/);
  assert.match(script, /storeCurrentAssets/);
  assert.match(script, /storedAssetKeys/);
  assert.match(script, /resolveAssetFile/);
  assert.match(script, /saveSnapshot/);
  assert.match(script, /restoreLatest/);
});

test('autosave controls expose visible disabled reasons', () => {
  for (const id of ['in-autosave', 'btn-save-snapshot', 'btn-restore-latest', 'recent-projects', 'btn-restore-selected']) {
    assert.match(html, new RegExp(`id="${id}"[^>]*aria-describedby="autosave-summary"`), `${id} should describe autosave state`);
  }
  assert.match(html, /id="autosave-summary" class="preflight-summary"/);
  assert.match(html, /id="autosave-list" class="preflight-list compact-list"/);
  const autoSaveBody = script.match(/const AutoSave = \{([\s\S]*?)\n\};\n\nconst CustomPresets/)?.[1] || '';
  assert.ok(autoSaveBody, 'AutoSave body should be present');
  const controlsBody = autoSaveBody.match(/setControlsAvailable\(available, summary = ''\) \{([\s\S]*?)\n  \},\n\n  updateControls/)?.[1] || '';
  assert.ok(controlsBody, 'AutoSave.setControlsAvailable body should be present');
  const lockReasonBody = autoSaveBody.match(/autosaveLockReason\(action = 'using autosave'\) \{([\s\S]*?)\n  \},\n\n  isSafeToSave/)?.[1] || '';
  assert.ok(lockReasonBody, 'AutoSave.autosaveLockReason body should be present');
  assert.match(lockReasonBody, /Store\.packageJob\.running/);
  assert.match(lockReasonBody, /Store\.restoreJob\.running/);
  assert.match(lockReasonBody, /Store\.batch\.running/);
  assert.match(lockReasonBody, /Store\.audioAnalysis\.status === 'analyzing'/);
  assert.match(lockReasonBody, /Machine\.status !== 'IDLE'/);
  assert.match(controlsBody, /const lockReason = this\.autosaveLockReason\('using autosave'\)/);
  assert.match(controlsBody, /const unavailableReason = available \? '' : \(summary \|\| 'Autosave unavailable'\)/);
  assert.match(controlsBody, /UI\.setControlReason\(Dom\['in-autosave'\], !available, unavailableReason, 'autosave-summary'\)/);
  assert.match(controlsBody, /UI\.setControlReason\(Dom\['btn-save-snapshot'\], !available \|\| !!lockReason, snapshotReason, 'autosave-summary'\)/);
  assert.match(controlsBody, /UI\.setControlReason\(Dom\['btn-restore-latest'\], !available \|\| !!lockReason, snapshotReason, 'autosave-summary'\)/);
  assert.match(controlsBody, /UI\.setControlReason\(Dom\['recent-projects'\], !available \|\| !!lockReason, snapshotReason, 'autosave-summary'\)/);
  assert.match(controlsBody, /const selectedRecentId = Dom\['recent-projects'\]\?\.value \|\| ''/);
  assert.match(controlsBody, /UI\.setControlReason\(Dom\['btn-restore-selected'\], !available \|\| !!lockReason \|\| !selectedRecentId, selectedRestoreReason, 'autosave-summary'\)/);
  assert.match(controlsBody, /Choose a recent snapshot first/);
  assert.match(controlsBody, /AUTOSAVE UNAVAILABLE/);
  assert.match(controlsBody, /AUTOSAVE LOCKED/);
  assert.match(controlsBody, /AUTOSAVE READY/);
  assert.match(controlsBody, /UI\.renderKeyValueList\(Dom\['autosave-list'\]/);

  const audioRefreshBody = script.match(/refreshReadiness\(\) \{([\s\S]*?)\n  \},\n\n  reset/)?.[1] || '';
  assert.ok(audioRefreshBody, 'AudioAnalysis.refreshReadiness body should be present');
  assert.match(audioRefreshBody, /AutoSave\.updateControls\(\)/);
  assert.match(audioRefreshBody, /BatchQueue\.render\(\)/);
});

test('autosave recent snapshot restore requires an explicit selected restore action', () => {
  assert.match(html, /id="btn-restore-selected"[\s\S]*?>[\s\S]*恢复所选[\s\S]*Restore Selected/);
  const autoSaveBody = script.match(/const AutoSave = \{([\s\S]*?)\n\};\n\nconst RenderReport/)?.[1] || '';
  assert.ok(autoSaveBody, 'AutoSave body should be present');
  const initBody = autoSaveBody.match(/init\(\) \{([\s\S]*?)\n  \},\n\n  openDb/)?.[1] || '';
  assert.ok(initBody, 'AutoSave.init body should be present');
  assert.match(initBody, /Dom\['recent-projects'\]\?\.addEventListener\('change', \(\) => this\.updateControls\(\)\)/);
  assert.doesNotMatch(initBody, /restoreSnapshot\(e\.target\.value\)/);
  assert.match(initBody, /Dom\['btn-restore-selected'\]\?\.addEventListener\('click', \(\) => this\.restoreSelectedRecent\(\)/);
  const restoreSelectedBody = autoSaveBody.match(/async restoreSelectedRecent\(\) \{([\s\S]*?)\n  \},\n\n  async refreshRecent/)?.[1] || '';
  assert.ok(restoreSelectedBody, 'AutoSave.restoreSelectedRecent body should be present');
  assert.match(restoreSelectedBody, /const id = Dom\['recent-projects'\]\?\.value \|\| ''/);
  assert.match(restoreSelectedBody, /UI\.showError\('Choose a recent snapshot to restore', 'WARN'\)/);
  assert.match(restoreSelectedBody, /await this\.restoreSnapshot\(id\)/);
});

test('autosave recent-list read failures are reported as unavailable instead of empty history', () => {
  const refreshBody = script.match(/async refreshRecent\(\) \{([\s\S]*?)\n  \},\n\n  schedule/)?.[1] || '';
  assert.ok(refreshBody, 'AutoSave.refreshRecent body should be present');
  assert.doesNotMatch(refreshBody, /this\.getAll\(\)\.catch\(\(\) => \[\]\)/);
  assert.match(refreshBody, /catch \(err\) \{/);
  assert.match(refreshBody, /const readReason = `Autosave read failed: \$\{Utils\.safeErrMsg\(err\)\}`/);
  assert.match(refreshBody, /this\.markDbUnavailable\(err, readReason\)/);
  assert.match(refreshBody, /return;/);
});

test('render reports are generated after export with technical metadata', () => {
  const ids = domMapIds();
  for (const id of ['btn-download-report', 'btn-retry-export-download', 'render-report-summary', 'render-report-list']) {
    assert.ok(ids.has(id), `${id} should be in Dom lookup map`);
  }
  assert.match(script, /const RenderReport =/);
  assert.match(script, /createReport/);
  assert.match(script, /browserCaps/);
  assert.match(script, /assetManifest/);
  assert.match(script, /actualBitrateBps/);
  assert.match(script, /droppedFrames/);
  assert.match(script, /RenderReport\.recordExport/);
});

test('custom preset manager saves thumbnails and user presets', () => {
  const ids = domMapIds();
  for (const id of ['in-custom-preset-name', 'custom-preset-list', 'custom-preset-summary', 'btn-save-custom-preset', 'btn-apply-custom-preset', 'btn-delete-custom-preset', 'custom-preset-thumb']) {
    assert.ok(ids.has(id), `${id} should be in Dom lookup map`);
  }
  for (const id of ['btn-save-custom-preset', 'btn-apply-custom-preset', 'custom-preset-list', 'btn-delete-custom-preset']) {
    assert.match(html, new RegExp(`id="${id}"[^>]*aria-describedby="custom-preset-summary"`), `${id} should describe custom preset state`);
  }
  assert.match(script, /const CustomPresets =/);
  assert.match(script, /thumbnail/);
  assert.match(script, /makeThumbnail/);
  assert.match(script, /thumb\.width = 180/);
  assert.match(script, /toDataURL/);
  assert.match(script, /empty\.textContent = items\.length \? '选择预设\.\.\. \/ Choose preset\.\.\.' : '暂无自定义预设 \/ No custom presets'/);
  assert.match(script, /thumb\.alt = item\?\.thumbnail \? `预设缩略图：\$\{item\.name \|\| '未命名预设 \/ Untitled preset'\} \/ \$\{item\.name \|\| 'Untitled preset'\} thumbnail preview` : ''/);
  assert.match(script, /BrowserStorage\.getLocal/);
  assert.match(script, /BrowserStorage\.setLocal/);
  assert.match(script, /customPresetLockReason\(action = 'changing custom presets'\)/);
  assert.match(script, /updateControls\(\) \{[\s\S]*?const lockReason = this\.customPresetLockReason\(\)[\s\S]*?UI\.setControlReason\(Dom\['btn-apply-custom-preset'\], !item \|\| !!lockReason/);
});

test('custom preset quota fallback strips historical thumbnails before failing save', () => {
  const customBody = script.match(/const CustomPresets = \{([\s\S]*?)\n\};\n\nconst BatchQueue/)?.[1] || '';
  assert.ok(customBody, 'CustomPresets body should be present');
  assert.match(customBody, /stripPresetThumbnails\(items\) \{/);
  const stripBody = customBody.match(/stripPresetThumbnails\(items\) \{([\s\S]*?)\n  \},\n\n  saveCurrent/)?.[1] || '';
  assert.ok(stripBody, 'CustomPresets.stripPresetThumbnails body should be present');
  assert.match(stripBody, /thumbnail: ''/);

  const saveCurrentBody = script.match(/saveCurrent\(\) \{([\s\S]*?)\n  \},\n\n  selected/)?.[1] || '';
  assert.ok(saveCurrentBody, 'CustomPresets.saveCurrent body should be present');
  assert.match(saveCurrentBody, /preset\.thumbnail = ''/);
  assert.match(saveCurrentBody, /const thumbnaillessItems = this\.stripPresetThumbnails\(items\)/);
  assert.ok(
    saveCurrentBody.indexOf("preset.thumbnail = '';") < saveCurrentBody.indexOf('const thumbnaillessItems = this.stripPresetThumbnails(items)'),
    'saveCurrent should clear the new thumbnail before stripping historical thumbnails'
  );
  assert.match(saveCurrentBody, /this\.saveAll\(thumbnaillessItems\)/);
  assert.match(saveCurrentBody, /Preset saved without stored thumbnails: browser storage is full/);
});

test('custom preset load clamps legacy oversized storage before rendering options', () => {
  const customBody = script.match(/const CustomPresets = \{([\s\S]*?)\n\};\n\nconst BatchQueue/)?.[1] || '';
  assert.ok(customBody, 'CustomPresets body should be present');
  assert.match(customBody, /maxItems: 40/);
  const loadBody = customBody.match(/load\(\) \{([\s\S]*?)\n  \},\n\n  saveAll/)?.[1] || '';
  assert.ok(loadBody, 'CustomPresets.load body should be present');
  assert.match(loadBody, /const items = parsed\.slice\(0, this\.maxItems\)/);
  assert.match(loadBody, /if \(parsed\.length > this\.maxItems\)/);
  assert.match(loadBody, /BrowserStorage\.setLocal\(this\.key, JSON\.stringify\(items\)\)/);
  assert.match(loadBody, /Custom preset storage trimmed to \$\{this\.maxItems\} items/);
  const saveAllBody = customBody.match(/saveAll\(items\) \{([\s\S]*?)\n  \},\n\n  makeThumbnail/)?.[1] || '';
  assert.ok(saveAllBody, 'CustomPresets.saveAll body should be present');
  assert.match(saveAllBody, /items\.slice\(0, this\.maxItems\)/);
  assert.doesNotMatch(saveAllBody, /slice\(0, 40\)/);
});

test('batch render queue accepts multiple songs and renders them sequentially', () => {
  const ids = domMapIds();
  for (const id of ['btn-add-batch-audio', 'in-batch-audio', 'btn-start-batch', 'btn-clear-batch', 'batch-summary', 'batch-list']) {
    assert.ok(ids.has(id), `${id} should be in Dom lookup map`);
  }
  assert.match(script, /const BatchQueue =/);
  assert.match(script, /renderNext/);
  assert.match(script, /Batch audio not render-ready/);
  assert.match(script, /baseReady/);
  assert.match(script, /Store\.batch/);
  assert.match(script, /multiple/);
});

test('manual render readiness requires logo consistently with batch render', () => {
  const checkReadyBody = script.match(/checkReady\(\) \{([\s\S]*?)\n  \},\n\n  triggerUpdate/)?.[1] || '';
  assert.ok(checkReadyBody, 'Engine.checkReady body should be present');
  assert.match(checkReadyBody, /const readiness = Preflight\.getRenderReadiness\(\)/);
  assert.match(checkReadyBody, /const \{ reasons, previewReason, recordReason \} = readiness/);

  const preflightBody = script.match(/const Preflight = \{([\s\S]*?)\n\};\n\nconst Engine/)?.[1] || '';
  assert.ok(preflightBody, 'Preflight body should be present');
  const renderBlockersBody = preflightBody.match(/renderBlockers\(durationSec = this\.getAudioDuration\(\)\) \{([\s\S]*?)\n  \},\n\n  getStatus/)?.[1] || '';
  assert.ok(renderBlockersBody, 'Preflight.renderBlockers body should be present');
  assert.match(renderBlockersBody, /return this\.getRenderReadiness\(durationSec\)\.blockers/);
  assert.match(preflightBody, /getRenderReadiness\(durationSec = this\.getAudioDuration\(\), opts = \{\}\) \{/);
  assert.match(preflightBody, /assetReason\(type, error = ''\)/);
  assert.match(preflightBody, /if \(!valid\.logo \|\| !lReady\) pushPreview\(this\.assetReason\('logo', Store\.assetErrors\.logo\), 'logo'\)/);
  assert.match(preflightBody, /else if \(!vRecordReady\) \{[\s\S]*?blockers\.push\('Center visual not ready to play'\)[\s\S]*?reasons\.push\('video-canplay'\)/);
  assert.match(preflightBody, /else if \(!aRecordPlayable\) pushRender\('Audio not ready to play', 'audio-canplay'\)/);
  assert.match(preflightBody, /if \(analysisBusy\) pushRender\('Audio analysis in progress', 'audio-analysis'\)/);

  const batchRenderBody = script.match(/render\(\) \{([\s\S]*?)\n  \},\n\n  init\(\)/)?.[1] || '';
  assert.ok(batchRenderBody, 'BatchQueue.render body should be present');
  assert.match(batchRenderBody, /Store\.flags\.assetValid\.logo/);
  assert.match(batchRenderBody, /if \(!Store\.flags\.assetValid\.logo\) missing\.push\('logo'\)/);
});

test('batch render globally locks project mutation and manual render starts', () => {
  const updateStateBody = script.match(/updateState\(state, opts = \{\}\) \{([\s\S]*?)\n  \},\n  moveFocusForState/)?.[1] || '';
  assert.ok(updateStateBody, 'UI.updateState body should be present');
  assert.match(updateStateBody, /const batchLock = Store\.batch\.running/);
  assert.match(updateStateBody, /const autosaveLock = Store\.autosaveJob\.running/);
  assert.match(updateStateBody, /const hardLock = packageLock \|\| restoreLock \|\| autosaveLock \|\| batchLock \|\| state === 'WARMING' \|\| state === 'RECORDING' \|\| state === 'EXPORTING'/);
  assert.match(updateStateBody, /const previewFileLock = packageLock \|\| restoreLock \|\| autosaveLock \|\| batchLock \|\| state === 'PREVIEWING'/);
  assert.match(updateStateBody, /Dom\[id\]\.disabled = packageLock \|\| restoreLock \|\| autosaveLock \|\| batchLock \|\| state !== 'IDLE'/);

  const mutationLockBody = script.match(/mutationLockReason\(opts = \{\}\) \{([\s\S]*?)\n  \},\n  assetInputSummary/)?.[1] || '';
  assert.ok(mutationLockBody, 'AssetManager.mutationLockReason body should be present');
  assert.match(mutationLockBody, /if \(Store\.batch\.running\) return 'Batch render in progress\. Wait or cancel it before changing assets\.'/);

  const checkReadyBody = script.match(/checkReady\(\) \{([\s\S]*?)\n  \},\n\n  triggerUpdate/)?.[1] || '';
  assert.ok(checkReadyBody, 'Engine.checkReady body should be present');
  assert.match(checkReadyBody, /const readiness = Preflight\.getRenderReadiness\(\)/);
  assert.match(checkReadyBody, /Dom\['btn-rec'\]\.disabled = !readiness\.recordReady/);

  const preflightBody = script.match(/const Preflight = \{([\s\S]*?)\n\};\n\nconst Engine/)?.[1] || '';
  assert.ok(preflightBody, 'Preflight body should be present');
  assert.match(preflightBody, /const batchLock = !opts\.ignoreBatchLock && Store\.batch\.running/);
  assert.match(preflightBody, /const autosaveLock = Store\.autosaveJob\.running/);
  assert.match(preflightBody, /const mutationLock = packageLock \|\| restoreLock \|\| autosaveLock \|\| batchLock \|\| machineLock/);
  assert.ok(preflightBody.indexOf('if (!canvasReady) pushPreview') < preflightBody.indexOf('if (autosaveLock) pushPreview'), 'hard runtime failures should outrank transient autosave locks');
  assert.match(preflightBody, /if \(autosaveLock\) pushPreview\(Store\.autosaveJob\.label \|\| 'Autosave in progress', 'autosave'\)/);
  assert.match(preflightBody, /if \(batchLock\) pushPreview\('Batch render running', 'batch'\)/);

  const packageControlsBody = script.match(/updateControls\(\) \{([\s\S]*?)\n  \},\n\n  async exportPackageBlob/)?.[1] || '';
  assert.ok(packageControlsBody, 'ProjectPackage.updateControls body should be present');
  assert.match(packageControlsBody, /const batchRunning = Store\.batch\.running/);
  assert.match(packageControlsBody, /const autosaveRunning = Store\.autosaveJob\.running/);
  assert.match(packageControlsBody, /Batch render running/);
  assert.match(packageControlsBody, /btn\.disabled = running \|\| restoreRunning \|\| autosaveRunning \|\| batchRunning/);
  assert.match(packageControlsBody, /loadBtn\.disabled = running \|\| restoreRunning \|\| autosaveRunning \|\| batchRunning/);
  assert.match(packageControlsBody, /Dom\['in-package-file'\]\.disabled = running \|\| restoreRunning \|\| autosaveRunning \|\| batchRunning/);

  const customBody = script.match(/const CustomPresets = \{([\s\S]*?)\n\};\n\nconst BatchQueue/)?.[1] || '';
  assert.ok(customBody, 'CustomPresets body should be present');
  const customControlsBody = customBody.match(/updateControls\(\) \{([\s\S]*?)\n  \},\n\n  renderList/)?.[1] || '';
  assert.ok(customControlsBody, 'CustomPresets.updateControls body should be present');
  assert.match(customControlsBody, /const lockReason = this\.customPresetLockReason\(\)/);
  assert.match(customBody, /if \(Store\.autosaveJob\.running\) return `Autosave in progress\. Wait for it to finish before \$\{action\}\.`/);
  assert.match(customBody, /if \(Store\.batch\.running\) return `Batch render in progress\. Wait or cancel it before \$\{action\}\.`/);

  const audioBody = script.match(/const AudioAnalysis = \{([\s\S]*?)\n\};\n\nconst Preflight/)?.[1] || '';
  const audioPanelBody = audioBody.match(/updatePanel\(\) \{([\s\S]*?)\n  \}/)?.[1] || '';
  assert.ok(audioPanelBody, 'AudioAnalysis.updatePanel body should be present');
  assert.match(audioPanelBody, /const lockReason = this\.audioAnalysisLockReason\(\)/);
  assert.match(audioBody, /if \(Store\.batch\.running\) return 'Batch render running'/);

  const beforeUnloadBody = script.match(/window\.addEventListener\('beforeunload', \(e\) => \{([\s\S]*?)\n    \}, \{ capture: true \}\)/)?.[1] || '';
  assert.ok(beforeUnloadBody, 'beforeunload handler should be present');
  assert.match(beforeUnloadBody, /Machine\.status !== 'IDLE' \|\| Store\.packageJob\.running \|\| Store\.restoreJob\.running \|\| Store\.autosaveJob\.running \|\| Store\.batch\.running/);
  assert.match(beforeUnloadBody, /Store\.audioAnalysis\.status === 'analyzing'/);
  assert.match(beforeUnloadBody, /Recorder\.hasPendingStreamFinalize\(\)/);

  const batchStartBody = script.match(/async start\(\) \{([\s\S]*?)\n  \},\n\n  render\(\)/)?.[1] || '';
  assert.ok(batchStartBody, 'BatchQueue.start body should be present');
  assert.match(batchStartBody, /Store\.batch\.running = true;[\s\S]*?UI\.updateState\(Machine\.status, \{ silent: true \}\);[\s\S]*?Engine\.checkReady\(\)/);
  assert.match(batchStartBody, /Store\.batch\.running = false;[\s\S]*?UI\.updateState\(Machine\.status, \{ silent: true \}\);[\s\S]*?Engine\.checkReady\(\)/);
});

test('batch render is blocked before interactive Streaming Save prompts', () => {
  const batchBody = script.match(/const BatchQueue = \{([\s\S]*?)\n\};\n\nconst AudioAnalysis/)?.[1] || '';
  assert.ok(batchBody, 'BatchQueue body should be present');
  const batchRenderBody = batchBody.match(/render\(\) \{([\s\S]*?)\n  \},\n\n  init\(\)/)?.[1] || '';
  assert.ok(batchRenderBody, 'BatchQueue.render body should be present');
  assert.match(batchRenderBody, /const streamSaveBatchBlock = Store\.config\.streamSave/);
  assert.match(batchRenderBody, /streamSaveBatchBlock\s*\?\s*'批量渲染前请关闭 Streaming Save \/ Disable Streaming Save before batch render'/);
  assert.match(batchRenderBody, /const batchStartBlocked = Store\.packageJob\.running \|\| Store\.restoreJob\.running \|\| Store\.autosaveJob\.running \|\| analysisBusy \|\| streamSaveBatchBlock \|\| !runnablePending/);

  const batchStartBody = batchBody.match(/async start\(\) \{([\s\S]*?)\n  \},\n\n  render\(\)/)?.[1] || '';
  assert.ok(batchStartBody, 'BatchQueue.start body should be present');
  assert.match(batchStartBody, /if \(Store\.config\.streamSave\) \{[\s\S]*?UI\.showError\('开始批量渲染前请关闭 Streaming Save；批量渲染不能使用每首歌单独弹出的保存位置选择器。\/ Disable Streaming Save before starting batch render\. Batch renders cannot use the per-render file picker\.', 'WARN'\);[\s\S]*?return;/);

  const renderNextBody = batchBody.match(/async renderNext\(index\) \{([\s\S]*?)\n  \},\n\n  async start/)?.[1] || '';
  assert.ok(renderNextBody, 'BatchQueue.renderNext body should be present');
  assert.match(renderNextBody, /const started = await Recorder\.start\(\{ ignoreBatchLock: true \}\)/);

  const recorderBody = script.match(/const Recorder = \{([\s\S]*?)\n\};\n\nwindow\.LIMITS/)?.[1] || '';
  assert.ok(recorderBody, 'Recorder body should be present');
  const armBody = recorderBody.match(/async armStreamSave\(([\s\S]*?)\) \{([\s\S]*?)\n  \},\n\n  isUserCancel/)?.[2] || '';
  assert.ok(armBody, 'Recorder.armStreamSave body should be present');
  assert.match(armBody, /window\.showSaveFilePicker/);
});

test('manual autosave saving state locks unload and package operations until settled', () => {
  assert.match(script, /autosaveJob: \{ running: false, label: '', token: 0, source: '' \}/);

  const beforeUnloadBody = script.match(/window\.addEventListener\('beforeunload', \(e\) => \{([\s\S]*?)\n    \}, \{ capture: true \}\)/)?.[1] || '';
  assert.ok(beforeUnloadBody, 'beforeunload handler should be present');
  assert.match(beforeUnloadBody, /Store\.autosaveJob\.running/);

  const packageBody = script.match(/const ProjectPackage = \{([\s\S]*?)\n\};\n\nconst AutoSave/)?.[1] || '';
  assert.ok(packageBody, 'ProjectPackage body should be present');
  const packageBlockerBody = packageBody.match(/packageJobBlocker\(\) \{([\s\S]*?)\n  \},\n\n  assertPackageJobReady/)?.[1] || '';
  assert.ok(packageBlockerBody, 'ProjectPackage.packageJobBlocker body should be present');
  assert.match(packageBlockerBody, /Store\.autosaveJob\.running/);
  const packageControlsBody = packageBody.match(/updateControls\(\) \{([\s\S]*?)\n  \},\n\n  async exportPackageBlob/)?.[1] || '';
  assert.ok(packageControlsBody, 'ProjectPackage.updateControls body should be present');
  assert.match(packageControlsBody, /const autosaveRunning = Store\.autosaveJob\.running/);
  assert.match(packageControlsBody, /autosaveRunning[\s\S]*?\? autosaveReason/);
  assert.match(packageControlsBody, /loadBtn\.disabled = running \|\| restoreRunning \|\| autosaveRunning/);
  assert.match(packageControlsBody, /Dom\['in-package-file'\]\.disabled = running \|\| restoreRunning \|\| autosaveRunning/);

  const autoSaveBody = script.match(/const AutoSave = \{([\s\S]*?)\n\};\n\nconst RenderReport/)?.[1] || '';
  assert.ok(autoSaveBody, 'AutoSave body should be present');
  assert.match(autoSaveBody, /startSaveJob\(source = 'autosave'\)/);
  assert.match(autoSaveBody, /finishSaveJob\(token\)/);
  const saveBody = autoSaveBody.match(/async saveSnapshot\(source = 'autosave', opts = \{\}\) \{([\s\S]*?)\n  \},\n\n  async trimRecent/)?.[1] || '';
  assert.ok(saveBody, 'AutoSave.saveSnapshot body should be present');
  const startAt = saveBody.indexOf('const saveToken = this.startSaveJob(source)');
  const planAt = saveBody.indexOf('await this.buildAssetStoragePlan(records)');
  const finishAt = saveBody.indexOf('this.finishSaveJob(saveToken)');
  assert.ok(startAt >= 0, 'saveSnapshot should enter a saving job');
  assert.ok(planAt > startAt, 'saving job should start before long storage work');
  assert.ok(finishAt > planAt, 'saving job should finish in the method tail');
  assert.match(saveBody, /finally \{\s*this\.finishSaveJob\(saveToken\);\s*\}/);
  assert.match(saveBody, /UI\.holdReadinessWarnings\(3000\);\s*UI\.log\(plan\.assetsStored/);

  const publicBlock = script.slice(script.indexOf('window.LIMITS ='), script.indexOf("window.addEventListener('load'"));
  assert.match(publicBlock, /saving: Store\.autosaveJob\.running/);
  assert.match(publicBlock, /label: Store\.autosaveJob\.label/);
});

test('streaming save cancellation returns to idle without fatal overlay', () => {
  assert.match(script, /isUserCancel\(err\)/);
  assert.match(script, /err\.name = 'AbortError'/);
  assert.match(script, /UI\.showError\('Stream save cancelled', 'WARN'\)/);
  assert.doesNotMatch(script, /new Error\('Stream save cancelled'\);\n\s*throw err;\n\s*}\n\s*UI\.showError\(Utils\.safeErrMsg\(err, 'Start failed'\), 'FATAL'\)/);
  assert.match(script, /if \(this\.mr && this\.mr\.state !== 'inactive'\)/);
});

test('non-fatal UI warnings do not pollute browser error logs', () => {
  assert.match(script, /holdReadinessWarnings\(ms = 3000\) \{/);
  const showErrorBody = script.match(/showError\(msg, level = 'FATAL'(?:, opts = \{\})?\) \{([\s\S]*?)\n  \},\n  dismissError/)?.[1] || '';
  assert.ok(showErrorBody, 'UI.showError body should be present');
  assert.match(showErrorBody, /if \(level === 'FATAL'\) \{\s*Logger\.error/);
  assert.match(showErrorBody, /else \{\s*Logger\.warn\(msg\)/);
  assert.match(showErrorBody, /this\.holdReadinessWarnings\(\)/);
});

test('non-fatal warnings retain full recovery text outside the truncated status line', () => {
  assert.doesNotMatch(html, /id="warning-panel"[^>]*role="status"/);
  assert.doesNotMatch(html, /id="warning-panel"[^>]*aria-live="polite"/);
  assert.match(html, /id="warning-panel"[^>]*tabindex="0"[^>]*role="document"[^>]*aria-label="警告历史 \/ Warning history"/);
  assert.match(html, /id="btn-clear-warnings"[^>]*aria-label="清空警告历史 \/ Clear warning history"/);
  assert.doesNotMatch(html, /id="warning-list"[^>]*role="status"/);
  assert.doesNotMatch(html, /id="warning-list"[^>]*aria-live="polite"/);
  assert.match(html, /id="warning-live"[^>]*class="sr-only"[^>]*role="status"[^>]*aria-live="polite"[^>]*aria-atomic="true"/);
  assert.match(html, /\.warning-panel \{[^}]*overflow-wrap: anywhere/);
  assert.match(html, /\.warning-panel:focus-visible \{[^}]*outline: 2px solid var\(--accent\)/);
  assert.match(html, /\.warning-clear/);
  assert.match(html, /\.warning-item \{[^}]*white-space: normal/);
  assert.match(script, /recordWarning\(msg\) \{/);
  assert.match(script, /clearWarnings\(\) \{/);
  const showErrorBody = script.match(/showError\(msg, level = 'FATAL'(?:, opts = \{\})?\) \{([\s\S]*?)\n  \},\n  dismissError/)?.[1] || '';
  assert.ok(showErrorBody, 'UI.showError body should be present');
  assert.match(showErrorBody, /this\.recordWarning\(msg\)/);
  assert.match(showErrorBody, /this\.log\(`WARN: \$\{msg\}`, 'warn', \{ live: false \}\)/);
  assert.match(script, /get warnings\(\) \{/);
  const publicUiBody = script.match(/window\.UI = Object\.freeze\(\{([\s\S]*?)\n\}\);/)?.[1] || '';
  assert.ok(publicUiBody, 'public UI facade should be present');
  assert.match(publicUiBody, /get errorOpen\(\)/);
  assert.match(publicUiBody, /get warnings\(\)/);
  assert.doesNotMatch(publicUiBody, /clearWarnings\(/);
  assert.doesNotMatch(publicUiBody, /dismissError\(/);
  assert.match(script, /Dom\['btn-clear-warnings'\]\.addEventListener\('click', \(\) => UI\.clearWarnings\(\)\)/);
  assert.match(script, /Dom\['warning-live'\]\.textContent = `警告 \/ Warning: \$\{text\}`/);
  assert.match(script, /Dom\['warning-live'\]\.textContent = '警告历史已清空 \/ Warning history cleared\.'/);
  assert.match(script, /time\.textContent = `\$\{warning\.stamp\} `/);
  assert.match(script, /row\.append\(time, text, document\.createTextNode\('\\n'\)\)/);
  const logBody = script.match(/log\(msg, type = 'norm', opts = \{\}\) \{([\s\S]*?)\n  \},\n  localizeBusyReason/)?.[1] || '';
  assert.ok(logBody, 'UI.log body should support live-region suppression');
  assert.match(logBody, /opts\.live !== false/);
});

test('package and autosave restores update or clear the actual loaded asset slots', () => {
  assert.match(script, /labelForType/);
  assert.match(script, /resetLabel/);
  assert.match(script, /clearAsset\(type/);
  assert.match(script, /this\.labelForType\(type\)/);
});

test('failed asset loads reset visible file labels instead of leaving stale selections', () => {
  const loadFileBody = script.match(/loadFile\(type, file, opts = \{\}\) \{([\s\S]*?)\n  \},\n  bindFile/)?.[1] || '';
  assert.ok(loadFileBody, 'AssetManager.loadFile body should be present');
  assert.match(loadFileBody, /if \(!this\.isAllowedFileType\(type, file\)\) \{[\s\S]*?this\.resetLabel\(type\)/);
  assert.match(loadFileBody, /if \(file\.size > LIMITS\.maxFileBytes\[type\]\) \{[\s\S]*?this\.resetLabel\(type\)/);
  assert.match(loadFileBody, /const fail = \(why\) => \{[\s\S]*?Store\.assetNames\[type\] = '';[\s\S]*?this\.resetLabel\(type\)/);
});

test('early rejected asset selections invalidate stale previously loaded assets', () => {
  const loadFileBody = script.match(/loadFile\(type, file, opts = \{\}\) \{([\s\S]*?)\n  \},\n  bindFile/)?.[1] || '';
  assert.ok(loadFileBody, 'AssetManager.loadFile body should be present');
  assert.match(loadFileBody, /const rejectEarly = \(message, warning\) => \{/);
  assert.match(loadFileBody, /Store\.flags\.assetValid\[type\] = false/);
  assert.match(loadFileBody, /this\.resetAssetElement\(type, el\)/);
  assert.match(loadFileBody, /if \(!this\.isAllowedFileType\(type, file\)\) \{[\s\S]*?rejectEarly\(`Unsupported \$\{type\} file`/);
  assert.match(loadFileBody, /if \(file\.size > LIMITS\.maxFileBytes\[type\]\) \{[\s\S]*?rejectEarly\(`\$\{type\} file too large`/);
});

test('browser storage is guarded for commercial online contexts', () => {
  assert.match(script, /const BrowserStorage =/);
  assert.match(script, /getLocal\(key, fallback = ''\)/);
  assert.match(script, /setLocal\(key, value\)/);
  assert.match(script, /BrowserStorage\.getLocal\('fad-mv-autosave'/);
  assert.match(script, /BrowserStorage\.setLocal\('fad-mv-autosave'/);
  const directLocalStorage = [...script.matchAll(/localStorage/g)].length;
  assert.equal(directLocalStorage, 1, 'localStorage should only be touched inside BrowserStorage.local');
  assert.match(script, /hasIndexedDb\(\) \{\s*try \{/);
});

test('browser downloads are reported as dispatched unless save is verified', () => {
  assert.match(script, /const DownloadManager =/);
  assert.match(script, /dispatchBlob\(blob, fileName\)/);
  assert.match(script, /downloadDispatched:\s*true/);
  assert.match(script, /saveVerified:\s*false/);
  assert.match(script, /PROJECT JSON DOWNLOAD DISPATCHED/);
  assert.match(script, /项目包下载已触发/);
  assert.match(script, /REPORT DOWNLOAD DISPATCHED/);
  assert.match(script, /EXPORT DOWNLOAD DISPATCHED/);
  assert.doesNotMatch(script, /PROJECT JSON SAVED/);
  assert.doesNotMatch(script, /PROJECT PACKAGE SAVED/);
});

test('public output filenames use openFAD source marker instead of private brand suffix', () => {
  assert.match(script, /_openfad\.\$\{this\.extensionForMime\(mime\)\}/);
  assert.match(script, /_openfad\.webm/);
  assert.doesNotMatch(script, new RegExp(`_${'FAD'}`));
  assert.doesNotMatch(script, new RegExp(`Untitled ${'FAD'} MV`));
});

test('download dispatch failures surface as in-app warnings', () => {
  const downloadProjectBody = script.match(/downloadProject\(\) \{([\s\S]*?)\n  \},\n\n  async loadProjectFile/)?.[1] || '';
  assert.ok(downloadProjectBody, 'ProjectPresets.downloadProject body should be present');
  assert.match(downloadProjectBody, /try \{[\s\S]*?DownloadManager\.dispatchBlob\(blob, fileName\)[\s\S]*?PROJECT JSON DOWNLOAD DISPATCHED[\s\S]*?\} catch \(err\) \{[\s\S]*?UI\.showError\(`Project JSON download failed: \$\{Utils\.safeErrMsg\(err\)\}`, 'WARN'\)/);

  const renderReportBody = script.match(/const RenderReport = \{([\s\S]*?)\n\};\n\nconst CustomPresets/)?.[1] || '';
  assert.ok(renderReportBody, 'RenderReport body should be present');
  const retryBody = renderReportBody.match(/retryExportDownload\(\) \{([\s\S]*?)\n  \},\n\n  downloadReport/)?.[1] || '';
  assert.ok(retryBody, 'RenderReport.retryExportDownload body should be present');
  assert.match(retryBody, /try \{[\s\S]*?result = DownloadManager\.dispatchBlob\(saved\.blob, saved\.fileName\)[\s\S]*?\} catch \(err\) \{[\s\S]*?UI\.showError\(`重试导出下载失败：\$\{Utils\.safeErrMsg\(err\)\}。请保持页面打开，稍后再点“重试导出下载”。`, 'WARN'\)[\s\S]*?this\.updatePanel\(\)[\s\S]*?return/);
  const reportBody = renderReportBody.match(/downloadReport\(\) \{([\s\S]*?)\n  \},\n\n  updatePanel/)?.[1] || '';
  assert.ok(reportBody, 'RenderReport.downloadReport body should be present');
  assert.match(reportBody, /try \{[\s\S]*?DownloadManager\.dispatchBlob\(blob, fileName\)[\s\S]*?REPORT DOWNLOAD DISPATCHED[\s\S]*?\} catch \(err\) \{[\s\S]*?UI\.showError\(`Render report download failed: \$\{Utils\.safeErrMsg\(err\)\}`, 'WARN'\)/);
});

test('retry export download command enforces busy locks before dispatching or mutating reports', () => {
  const renderReportBody = script.match(/const RenderReport = \{([\s\S]*?)\n\};\n\nconst CustomPresets/)?.[1] || '';
  assert.ok(renderReportBody, 'RenderReport body should be present');
  assert.match(renderReportBody, /retryExportLockReason\(\) \{/);
  const lockBody = renderReportBody.match(/retryExportLockReason\(\) \{([\s\S]*?)\n  \},\n\n  retryExportDownload/)?.[1] || '';
  assert.ok(lockBody, 'RenderReport.retryExportLockReason body should be present');
  assert.match(lockBody, /if \(Store\.packageJob\.running\) return Store\.packageJob\.label \|\| 'Package operation running'/);
  assert.match(lockBody, /if \(Store\.restoreJob\.running\) return Store\.restoreJob\.label \|\| 'Project restore running'/);
  assert.match(lockBody, /if \(Store\.batch\.running\) return 'Batch render running'/);
  assert.match(lockBody, /if \(Machine\.status !== 'IDLE'\) return `Wait for \$\{Machine\.status\.toLowerCase\(\)\} to finish before retrying export download`/);

  const retryBody = renderReportBody.match(/retryExportDownload\(\) \{([\s\S]*?)\n  \},\n\n  downloadReport/)?.[1] || '';
  assert.ok(retryBody, 'RenderReport.retryExportDownload body should be present');
  assert.ok(retryBody.indexOf('const lockReason = this.retryExportLockReason()') < retryBody.indexOf('DownloadManager.dispatchBlob(saved.blob, saved.fileName)'));
  assert.ok(retryBody.indexOf('const lockReason = this.retryExportLockReason()') < retryBody.indexOf('output.downloadDispatched'));
  assert.match(retryBody, /if \(lockReason\) \{[\s\S]*?UI\.showError\(lockReason, 'WARN'\);[\s\S]*?this\.updatePanel\(\);[\s\S]*?return/);

  const updatePanelBody = renderReportBody.match(/updatePanel\(\) \{([\s\S]*?)\n  \},\n\n  init/)?.[1] || '';
  assert.ok(updatePanelBody, 'RenderReport.updatePanel body should be present');
  assert.match(updatePanelBody, /const retryLockReason = this\.retryExportLockReason\(\)/);
  assert.match(updatePanelBody, /UI\.setControlReason\(Dom\['btn-retry-export-download'\], !retryAvailable \|\| !!retryLockReason, retryReason, 'render-report-summary'\)/);
  assert.match(updatePanelBody, /if \(report\.output\.retryNote\) rows\.push\(\['恢复建议', report\.output\.retryNote\]\)/);
});

test('unverified non-stream exports retain a retryable blob until the next render', () => {
  assert.match(script, /lastDownloadableExport:\s*null/);
  assert.match(script, /maxExportRetryBytes:\s*256 \* 1024 \* 1024/);
  assert.match(html, /id="btn-download-report"[^>]*aria-describedby="render-report-summary"/);
  assert.match(html, /id="btn-retry-export-download"[^>]*aria-describedby="render-report-summary"/);

  const renderReportBody = script.match(/const RenderReport = \{([\s\S]*?)\n\};\n\nconst CustomPresets/)?.[1] || '';
  assert.ok(renderReportBody, 'RenderReport body should be present');
  assert.match(renderReportBody, /canRetryExportDownload\(report = Store\.lastRenderReport\)/);
  assert.match(renderReportBody, /const retryableFailedDispatch = !!output\?\.failed && output\.failurePhase === 'download-dispatch' && !!output\.retryAvailable/);
  assert.match(renderReportBody, /retryExportDownload\(\)/);
  assert.match(renderReportBody, /Store\.lastDownloadableExport/);
  assert.match(renderReportBody, /retryExportLockReason\(\)/);
  assert.match(renderReportBody, /UI\.setControlReason\(Dom\['btn-download-report'\], !report \|\| reportStale, downloadReason, 'render-report-summary'\)/);
  assert.match(renderReportBody, /UI\.setControlReason\(Dom\['btn-retry-export-download'\], !retryAvailable \|\| !!retryLockReason, retryReason, 'render-report-summary'\)/);
  assert.match(renderReportBody, /Dom\['btn-retry-export-download'\]\?\.addEventListener\('click', \(\) => this\.retryExportDownload\(\)\)/);

  const recorderBody = script.match(/const Recorder = \{([\s\S]*?)\n\};\n\nwindow\.LIMITS/)?.[1] || '';
  assert.ok(recorderBody, 'Recorder body should be present');
  assert.match(recorderBody, /clearDownloadableExport\(\)/);
  assert.match(recorderBody, /retainDownloadableExport\(blob, fileName, mime\)/);
  assert.match(recorderBody, /this\.clearDownloadableExport\(\);[\s\S]*?const sid = \+\+this\._sessionId/);
  const retainBody = recorderBody.match(/retainDownloadableExport\(blob, fileName, mime\) \{([\s\S]*?)\n  \},\n\n  enqueueWrite/)?.[1] || '';
  assert.ok(retainBody, 'Recorder.retainDownloadableExport body should be present');
  assert.match(retainBody, /blob\.size > LIMITS\.maxExportRetryBytes/);
  assert.match(retainBody, /Store\.lastDownloadableExport = null/);
  assert.match(retainBody, /retryAvailable: false/);
  assert.match(retainBody, /retryNote: `输出超过 \$\{Utils\.formatBytes\(LIMITS\.maxExportRetryBytes\)\}，未保留重试文件`/);
  assert.match(retainBody, /retryAvailable: true/);

  const saveBody = recorderBody.match(/async save\(mime, sid = this\._sessionId\) \{([\s\S]*?)\n  \}/)?.[1] || '';
  assert.ok(saveBody, 'Recorder.save body should be present');
  assert.match(saveBody, /let retryRetention = \{ retryAvailable: false, retryNote: '' \}/);
  assert.ok(
    saveBody.indexOf('retryRetention = this.retainDownloadableExport(blob, outputFileName, mime)') < saveBody.indexOf('downloadResult = DownloadManager.dispatchBlob(blob, outputFileName)'),
    'manual export retry blob should be retained before the first browser download dispatch'
  );
  assert.match(saveBody, /downloadResult = DownloadManager\.dispatchBlob\(blob, outputFileName\)/);
  assert.match(saveBody, /retryRetention = this\.retainDownloadableExport\(blob, outputFileName, mime\)/);
  assert.match(saveBody, /this\.failExport\(message, 'FATAL', \{[\s\S]*?failurePhase: 'download-dispatch'/);
  assert.match(saveBody, /retryAvailable: !wasStreamSave && !!downloadResult\.downloadDispatched && !downloadResult\.saveVerified && !!retryRetention\.retryAvailable/);
  assert.match(saveBody, /retryNote: !wasStreamSave && !!downloadResult\.downloadDispatched && !downloadResult\.saveVerified \? retryRetention\.retryNote : ''/);
  assert.doesNotMatch(saveBody, /^\s*DownloadManager\.dispatchBlob\(blob, outputFileName\);\s*successLog/m);
});

test('starting a new render marks previous render reports stale before download', () => {
  const renderReportBody = script.match(/const RenderReport = \{([\s\S]*?)\n\};\n\nconst CustomPresets/)?.[1] || '';
  assert.ok(renderReportBody, 'RenderReport body should be present');
  assert.match(renderReportBody, /markReportStale\(reason = 'New render started'\)/);
  const staleBody = renderReportBody.match(/markReportStale\(reason = 'New render started'\) \{([\s\S]*?)\n  \},\n\n  invalidateProjectOutput/)?.[1] || '';
  assert.ok(staleBody, 'RenderReport.markReportStale body should be present');
  assert.match(staleBody, /Store\.lastDownloadableExport = null/);
  assert.match(staleBody, /Store\.lastRenderReport\.output\.stale = true/);
  assert.match(staleBody, /Store\.lastRenderReport\.output\.staleReason = reason/);

  const downloadReportBody = renderReportBody.match(/downloadReport\(\) \{([\s\S]*?)\n  \},\n\n  updatePanel/)?.[1] || '';
  assert.ok(downloadReportBody, 'RenderReport.downloadReport body should be present');
  assert.match(downloadReportBody, /if \(Store\.lastRenderReport\?\.output\?\.stale\) \{[\s\S]*?UI\.showError\('Render report is from a previous render and is no longer downloadable', 'WARN'\);[\s\S]*?return/);

  const updatePanelBody = renderReportBody.match(/updatePanel\(\) \{([\s\S]*?)\n  \},\n\n  init/)?.[1] || '';
  assert.ok(updatePanelBody, 'RenderReport.updatePanel body should be present');
  assert.match(updatePanelBody, /const reportStale = !!report\?\.output\?\.stale/);
  assert.match(updatePanelBody, /UI\.setControlReason\(Dom\['btn-download-report'\], !report \|\| reportStale, downloadReason, 'render-report-summary'\)/);
  assert.match(updatePanelBody, /REPORT STALE: \$\{report\.output\.staleReason \|\| 'Previous render'\}/);

  const recorderBody = script.match(/const Recorder = \{([\s\S]*?)\n\};\n\nwindow\.LIMITS/)?.[1] || '';
  assert.ok(recorderBody, 'Recorder body should be present');
  const startBody = recorderBody.match(/async start\(opts = \{\}\) \{([\s\S]*?)\n  \},\n\n  finish\(\)/)?.[1] || '';
  assert.ok(startBody, 'Recorder.start body should be present');
  const warmingAt = startBody.indexOf("if (!Machine.transition('WARMING')) return false");
  const staleAt = startBody.indexOf("RenderReport.markReportStale('New render started')");
  const sidAt = startBody.indexOf('const sid = ++this._sessionId');
  assert.ok(warmingAt >= 0 && staleAt > warmingAt, 'previous report should be marked stale only after WARMING starts');
  assert.ok(sidAt > staleAt, 'previous report should be stale before the new render session can fail');
});

test('project mutations invalidate stale render retry and report state', () => {
  const renderReportBody = script.match(/const RenderReport = \{([\s\S]*?)\n\};\n\nconst CustomPresets/)?.[1] || '';
  assert.ok(renderReportBody, 'RenderReport body should be present');
  assert.match(renderReportBody, /invalidateProjectOutput\(reason = 'Project changed'\)/);
  assert.match(renderReportBody, /Store\.lastDownloadableExport = null/);
  assert.match(renderReportBody, /Store\.lastRenderReport = null/);
  assert.match(renderReportBody, /Render report invalidated/);

  const loadProjectBody = script.match(/async loadProjectFile\(file\) \{([\s\S]*?)\n  \},\n\n  clearLiveAssetsAfterJsonImport/)?.[1] || '';
  assert.ok(loadProjectBody, 'ProjectPresets.loadProjectFile body should be present');
  assert.match(loadProjectBody, /RenderReport\.invalidateProjectOutput\('Project JSON loaded'\)/);

  const importPackageBody = script.match(/async importPackageFile\(file\) \{([\s\S]*?)\n  \},\n\n  init\(\)/)?.[1] || '';
  assert.ok(importPackageBody, 'ProjectPackage.importPackageFile body should be present');
  assert.ok(importPackageBody.lastIndexOf("RenderReport.invalidateProjectOutput('Project package loaded')") > importPackageBody.lastIndexOf('this.finishPackageJob(token);'));

  const snapshotBody = autoSaveApplySnapshotBody();
  assert.match(snapshotBody, /RenderReport\.invalidateProjectOutput\('Autosave snapshot restored'\)/);
});

test('plain JSON imports invalidate stale output before first project mutation', () => {
  const loadProjectBody = script.match(/async loadProjectFile\(file\) \{([\s\S]*?)\n  \},\n\n  clearLiveAssetsAfterJsonImport/)?.[1] || '';
  assert.ok(loadProjectBody, 'ProjectPresets.loadProjectFile body should be present');
  const invalidateAt = loadProjectBody.indexOf("RenderReport.invalidateProjectOutput('Project JSON import started')");
  const importAt = loadProjectBody.indexOf('this.importState(data, { silent: true, noAutosave: true, skipAudioAnalysis: true })');
  const clearAt = loadProjectBody.indexOf('this.clearLiveAssetsAfterJsonImport(data)');
  assert.ok(invalidateAt >= 0, 'plain JSON import should invalidate stale output before applying state');
  assert.ok(importAt > invalidateAt, 'plain JSON import should invalidate stale output before importState can mutate controls');
  assert.ok(clearAt > invalidateAt, 'plain JSON import should invalidate stale output before clearing live assets');
});

test('plain JSON imports bump project revision before import autosave snapshots', () => {
  const loadProjectBody = script.match(/async loadProjectFile\(file\) \{([\s\S]*?)\n  \},\n\n  clearLiveAssetsAfterJsonImport/)?.[1] || '';
  assert.ok(loadProjectBody, 'ProjectPresets.loadProjectFile body should be present');
  const clearAt = loadProjectBody.indexOf('this.clearLiveAssetsAfterJsonImport(data)');
  const noteAt = loadProjectBody.indexOf("AssetManager.noteProjectEdited('Project JSON loaded')");
  const saveAt = loadProjectBody.indexOf("AutoSave.saveSnapshot('project-json-import'");
  assert.ok(clearAt >= 0, 'plain JSON import should clear live assets after applying project state');
  assert.ok(noteAt > clearAt, 'plain JSON import should mark the project changed after the imported state is applied');
  assert.ok(saveAt > noteAt, 'plain JSON import revision bump must happen before any import autosave snapshot is queued');
});

test('user edits and asset loads invalidate stale render outputs before autosave', () => {
  const assetBody = script.match(/const AssetManager = \{([\s\S]*?)\n\};\n\nconst ProjectPresets/)?.[1] || '';
  assert.ok(assetBody, 'AssetManager body should be present');

  const noteEditBody = assetBody.match(/noteProjectEdited\(reason = 'Project changed'\) \{([\s\S]*?)\n  \},\n  bindAll/)?.[1] || '';
  assert.ok(noteEditBody, 'AssetManager.noteProjectEdited body should be present');
  assert.match(noteEditBody, /if \(Store\.flags\.suppressAutosave\) return/);
  assert.match(noteEditBody, /BrandPresets\.syncActivePreset\(reason\)/);
  assert.match(noteEditBody, /RenderReport\.invalidateProjectOutput\(reason\)/);

  const bindAllBody = assetBody.match(/bindAll\(\) \{([\s\S]*?)\n  \},\n  loadFile/)?.[1] || '';
  assert.ok(bindAllBody, 'AssetManager.bindAll body should be present');
  for (const [reason, schedule] of [
    ['Metadata changed', "AutoSave.schedule('meta')"],
    ['Font changed', "AutoSave.schedule('font')"],
    ['Visual settings changed', "AutoSave.schedule('visual')"],
    ['Recording settings changed', "AutoSave.schedule('recording')"]
  ]) {
    const reasonAt = bindAllBody.indexOf(`this.noteProjectEdited('${reason}')`);
    const scheduleAt = bindAllBody.indexOf(schedule);
    assert.ok(reasonAt >= 0, `${reason} should invalidate stale outputs`);
    assert.ok(scheduleAt >= 0, `${schedule} should still be present`);
    assert.ok(reasonAt < scheduleAt, `${reason} should invalidate stale outputs before autosave`);
  }

  const loadFileBody = assetBody.match(/loadFile\(type, file, opts = \{\}\) \{([\s\S]*?)\n  \},\n  mutationLockReason/)?.[1] || '';
  assert.ok(loadFileBody, 'AssetManager.loadFile body should be present');
  const assetInvalidateAt = loadFileBody.indexOf("this.noteProjectEdited('Asset changed')");
  const assetAutosaveAt = loadFileBody.indexOf("AutoSave.schedule('asset')");
  assert.ok(assetInvalidateAt >= 0, 'asset load success should invalidate stale outputs');
  assert.ok(assetAutosaveAt >= 0, 'asset load autosave should still be present');
  assert.ok(assetInvalidateAt < assetAutosaveAt, 'asset output invalidation should happen before autosave');
});

test('failed user asset replacements invalidate stale package and render outputs', () => {
  const assetBody = script.match(/const AssetManager = \{([\s\S]*?)\n\};\n\nconst ProjectPresets/)?.[1] || '';
  assert.ok(assetBody, 'AssetManager body should be present');
  const loadFileBody = assetBody.match(/loadFile\(type, file, opts = \{\}\) \{([\s\S]*?)\n  \},\n  mutationLockReason/)?.[1] || '';
  assert.ok(loadFileBody, 'AssetManager.loadFile body should be present');
  assert.match(loadFileBody, /const hadProjectAsset = !!Store\.flags\.assetValid\[type\] \|\| !!Store\.rawFiles\[type\] \|\| !!Store\.assetNames\[type\] \|\| !!Store\.assetRefsMissing\[type\]/);
  assert.match(loadFileBody, /const markFailedAssetReplacement = \(\) => \{[\s\S]*?if \(opts\.noAutosave \|\| !hadProjectAsset\) return;[\s\S]*?this\.noteProjectEdited\('Asset changed'\);[\s\S]*?AutoSave\.schedule\('asset'\);[\s\S]*?\}/);

  const rejectEarlyBody = loadFileBody.match(/const rejectEarly = \(message, warning\) => \{([\s\S]*?)\n      \};/)?.[1] || '';
  assert.ok(rejectEarlyBody, 'AssetManager.loadFile rejectEarly body should be present');
  assert.ok(rejectEarlyBody.indexOf('this.resetLabel(type)') < rejectEarlyBody.indexOf('markFailedAssetReplacement()'));
  assert.ok(rejectEarlyBody.indexOf('markFailedAssetReplacement()') < rejectEarlyBody.indexOf('Engine.checkReady()'));

  const failBody = loadFileBody.match(/const fail = \(why\) => \{([\s\S]*?)\n      \};\n      const loadTimeoutReason/)?.[1] || '';
  assert.ok(failBody, 'AssetManager.loadFile fail body should be present');
  assert.ok(failBody.indexOf('this.resetLabel(type)') < failBody.indexOf('markFailedAssetReplacement()'));
  assert.ok(failBody.indexOf('markFailedAssetReplacement()') < failBody.indexOf('Engine.checkReady()'));
});

test('audio analysis result changes invalidate stale render outputs and persist success', () => {
  const analyzeBody = script.match(/async analyzeCurrentFile\(\) \{([\s\S]*?)\n  \},\n\n  getBeatPulse/)?.[1] || '';
  assert.ok(analyzeBody, 'AudioAnalysis.analyzeCurrentFile body should be present');

  const skipBody = analyzeBody.match(/const skipAnalysis = \(reason\) => \{([\s\S]*?)\n    \};/)?.[1] || '';
  assert.ok(skipBody, 'AudioAnalysis skipAnalysis body should be present');
  assert.ok(skipBody.indexOf("RenderReport.invalidateProjectOutput('Audio analysis skipped')") < skipBody.indexOf("Store.audioAnalysis.status = 'skipped'"));

  const successInvalidateAt = analyzeBody.indexOf("RenderReport.invalidateProjectOutput('Audio analysis updated')");
  const successStatusAt = analyzeBody.indexOf("Store.audioAnalysis.status = 'done'");
  const successAutosaveAt = analyzeBody.indexOf("AutoSave.schedule('audio-analysis')");
  assert.ok(successInvalidateAt >= 0, 'successful analysis should invalidate stale render outputs');
  assert.ok(successInvalidateAt < successStatusAt, 'successful analysis invalidation should happen before state mutation');
  assert.ok(successAutosaveAt > successStatusAt, 'successful analysis autosave should happen after the new analysis state is stored');

  const catchBody = analyzeBody.match(/\} catch \(err\) \{([\s\S]*?)\n    \}/)?.[1] || '';
  assert.ok(catchBody, 'AudioAnalysis.analyzeCurrentFile catch body should be present');
  assert.ok(catchBody.indexOf("RenderReport.invalidateProjectOutput('Audio analysis failed')") < catchBody.indexOf('Store.audioAnalysis.status = /timeout/i.test(message)'));
});

test('imports and autosave restores preflight assets before mutating project state', () => {
  const packageBody = script.match(/async importPackageFile\(file\) \{([\s\S]*?)\n  \},\n\n  init\(\)/)?.[1] || '';
  assert.ok(packageBody, 'importPackageFile body should be present');
  assert.ok(packageBody.indexOf('AssetManager.preflightFile(type, assetFile,') < packageBody.indexOf('ProjectPresets.importState(project, { silent: true, noAutosave: true, skipAudioAnalysis: true, allowLockedMutation: true })'));
  assert.match(packageBody, /const previous = ProjectPresets\.captureRuntime\(\)/);
  assert.match(packageBody, /ProjectPresets\.restoreRuntime\(previous\)/);

  const snapshotBody = autoSaveApplySnapshotBody();
  assert.ok(snapshotBody.indexOf('AssetManager.preflightFile(type, file)') < snapshotBody.indexOf('ProjectPresets.importState(snap.state, { silent: true, noAutosave: true, skipAudioAnalysis: true, allowLockedMutation: true })'));
  assert.match(snapshotBody, /Snapshot missing \$\{type\} asset/);
  assert.match(snapshotBody, /ProjectPresets\.restoreRuntime\(previous\)/);
});

test('rollback restore attempts every asset slot and reports incomplete rollback', () => {
  const restoreBody = restoreRuntimeBody();
  assert.match(restoreBody, /const failures = \[\]/);
  assert.match(restoreBody, /recordFailure\(type, err\)/);
  assert.match(restoreBody, /const restored = await AssetManager\.loadFile\(type, file, \{ noAutosave: true, allowLockedMutation: true \}\)/);
  assert.match(restoreBody, /if \(restored == null\) throw new Error\(`\$\{type\} restore was superseded`\)/);
  assert.match(restoreBody, /return \{ ok: failures\.length === 0, failures \}/);
  assert.ok(
    restoreBody.indexOf("for (const type of ['cover', 'video', 'audio', 'logo'])") < restoreBody.indexOf('recordFailure(type, err)'),
    'restoreRuntime should continue through all asset slots'
  );

  const packageBody = script.match(/async importPackageFile\(file\) \{([\s\S]*?)\n  \},\n\n  init\(\)/)?.[1] || '';
  assert.match(packageBody, /const rollback = await ProjectPresets\.restoreRuntime\(previous\)/);
  assert.match(packageBody, /Package import failed and rollback was incomplete/);
  const packageRollbackInvalidateAt = packageBody.indexOf("RenderReport.invalidateProjectOutput('Project package import failed with incomplete rollback')");
  const packageRollbackThrowAt = packageBody.indexOf('Package import failed and rollback was incomplete');
  assert.ok(
    packageRollbackInvalidateAt >= 0 && packageRollbackInvalidateAt < packageRollbackThrowAt,
    'incomplete package rollback should clear stale render report before surfacing the failure'
  );

  const snapshotBody = autoSaveApplySnapshotBody();
  assert.match(snapshotBody, /const rollback = await ProjectPresets\.restoreRuntime\(previous\)/);
  assert.match(snapshotBody, /Snapshot restore failed and rollback was incomplete/);
  const snapshotRollbackInvalidateAt = snapshotBody.indexOf("RenderReport.invalidateProjectOutput('Autosave restore failed with incomplete rollback')");
  const snapshotRollbackThrowAt = snapshotBody.indexOf('Snapshot restore failed and rollback was incomplete');
  assert.ok(
    snapshotRollbackInvalidateAt >= 0 && snapshotRollbackInvalidateAt < snapshotRollbackThrowAt,
    'incomplete autosave rollback should clear stale render report before surfacing the failure'
  );
});

test('stale successful asset callbacks settle instead of hanging restores', () => {
  const loadFileBody = script.match(/loadFile\(type, file, opts = \{\}\) \{([\s\S]*?)\n  \},\n  bindFile/)?.[1] || '';
  assert.ok(loadFileBody, 'AssetManager.loadFile body should be present');
  const succeedBody = loadFileBody.match(/const succeed = \(\) => \{([\s\S]*?)\n      \};/)?.[1] || '';
  assert.ok(succeedBody, 'AssetManager.loadFile succeed body should be present');
  assert.match(succeedBody, /if \(!this\.isCurrentLoad\(type, token\)\) \{\s*settled = true;\s*clearTimeout\(timeoutId\);\s*clearInterval\(cancelId\);\s*resolve\(null\);\s*return;\s*\}/);
});

test('noAutosave imports suppress event-triggered autosave until transaction finishes', () => {
  assert.match(script, /suppressAutosave:\s*false/);
  const importBody = script.match(/importState\(raw, opts = \{\}\) \{([\s\S]*?)\n  \},\n\n  downloadProject/)?.[1] || '';
  assert.ok(importBody, 'ProjectPresets.importState body should be present');
  assert.match(importBody, /const previousSuppress = Store\.flags\.suppressAutosave/);
  assert.match(importBody, /if \(opts\.noAutosave\) Store\.flags\.suppressAutosave = true/);
  assert.match(importBody, /finally \{\s*Store\.flags\.suppressAutosave = previousSuppress;\s*\}/);
  const scheduleBody = script.match(/schedule\(reason = 'change'\) \{([\s\S]*?)\n  \}/)?.[1] || '';
  assert.ok(scheduleBody, 'AutoSave.schedule body should be present');
  assert.match(scheduleBody, /Store\.flags\.suppressAutosave/);
});

test('plain project JSON imports are bounded before reading into memory', () => {
  const loadProjectBody = script.match(/async loadProjectFile\(file\) \{([\s\S]*?)\n  \},\n\n  init\(\)/)?.[1] || '';
  assert.ok(loadProjectBody, 'ProjectPresets.loadProjectFile body should be present');
  assert.match(loadProjectBody, /file\.size > LIMITS\.maxProjectJsonBytes/);
  assert.match(loadProjectBody, /Project JSON too large/);
});

test('plain project JSON imports are token-gated so stale file reads cannot overwrite newer selections', () => {
  const presetsBody = script.match(/const ProjectPresets = \{([\s\S]*?)\n\};\n\nconst ProjectPackage/)?.[1] || '';
  assert.ok(presetsBody, 'ProjectPresets body should be present');
  assert.match(presetsBody, /projectLoadGeneration:\s*0/);
  assert.match(presetsBody, /nextProjectLoadToken\(\) \{[\s\S]*?this\.projectLoadGeneration \+= 1[\s\S]*?return this\.projectLoadGeneration/);
  assert.match(presetsBody, /isCurrentProjectLoad\(token\) \{[\s\S]*?return token === this\.projectLoadGeneration/);
  assert.match(presetsBody, /skipStaleProjectLoad\(token\) \{[\s\S]*?Skipped stale project JSON import after a newer file selection/);

  const loadProjectBody = presetsBody.match(/async loadProjectFile\(file\) \{([\s\S]*?)\n  \},\n\n  listedAssetRefs/)?.[1] || '';
  assert.ok(loadProjectBody, 'ProjectPresets.loadProjectFile body should be present');
  assert.match(loadProjectBody, /const loadToken = this\.nextProjectLoadToken\(\)/);
  assert.ok(loadProjectBody.indexOf('const loadToken = this.nextProjectLoadToken()') < loadProjectBody.indexOf('if (file.size > LIMITS.maxProjectJsonBytes)'));
  assert.ok(loadProjectBody.indexOf('if (this.skipStaleProjectLoad(loadToken)) return false') > loadProjectBody.indexOf('await file.text()'));
  assert.ok(loadProjectBody.indexOf('if (this.skipStaleProjectLoad(loadToken)) return false', loadProjectBody.indexOf('const data = JSON.parse(text)')) > loadProjectBody.indexOf('const data = JSON.parse(text)'));
  assert.ok(loadProjectBody.lastIndexOf('if (this.skipStaleProjectLoad(loadToken)) return false') < loadProjectBody.indexOf('AutoSave.saveSnapshot'));
  assert.match(loadProjectBody, /return true/);
});

test('layout import clamps dangerous numeric values before canvas use', () => {
  assert.match(script, /layoutBounds:/);
  assert.match(script, /boundedLayoutValue\(key, value\)/);
  assert.match(script, /Utils\.clampNumber/);
  assert.match(script, /videoBaseWidth:\s*\[240,\s*1080\]/);
  assert.match(script, /gradientHeight:\s*\[0,\s*1\]/);
  assert.match(script, /labelSpacing:\s*\[0,\s*40\]/);
  assert.doesNotMatch(script, /LayoutConfig\[key\] = data\.layout\[key\]/);
});

test('project imports tolerate unavailable render cache contexts after canvas boot failure', () => {
  const rebuildBody = script.match(/rebuildGradient\(\) \{([\s\S]*?)\n  \},\n\n  setFps/)?.[1] || '';
  assert.ok(rebuildBody, 'Engine.rebuildGradient body should be present');
  assert.match(rebuildBody, /const bgCtx = Store\.cache\.bgCtx/);
  assert.match(rebuildBody, /if \(!bgCtx \|\| typeof bgCtx\.createLinearGradient !== 'function'\) \{/);
  assert.match(rebuildBody, /Store\.flags\.bgDirty = true;\s*return false;/);
  assert.match(rebuildBody, /const grad = bgCtx\.createLinearGradient/);
  assert.match(rebuildBody, /return true/);
});

test('auxiliary render cache context failures are surfaced to preflight readiness', () => {
  const initBody = script.match(/const Engine = \{[\s\S]*?init\(\) \{([\s\S]*?)\n  \},\n\n  rebuildGradient/)?.[1] || '';
  assert.ok(initBody, 'Engine.init body should be present');
  assert.match(script, /validateRenderCacheContexts\(\)/);
  assert.match(script, /Render cache unavailable/);
  assert.match(initBody, /const cacheError = this\.validateRenderCacheContexts\(\)/);
  assert.match(initBody, /Store\.caps\.canCanvas2D = false/);
  assert.match(initBody, /Store\.caps\.runtimeError = cacheError/);
});

test('autosave debounce cannot write during recording or batch and prunes orphan assets', () => {
  assert.match(script, /isSafeToSave\(\)/);
  assert.match(script, /isEnabled\(\)/);
  const safeBody = script.match(/isSafeToSave\(\) \{([\s\S]*?)\n  \},\n\n  isEnabled/)?.[1] || '';
  assert.ok(safeBody, 'AutoSave.isSafeToSave body should be present');
  assert.match(safeBody, /this\.hasIndexedDb\(\) && !this\.autosaveLockReason\('saving autosave'\)/);
  assert.match(script, /Store\.audioAnalysis\.status === 'analyzing'/);
  assert.match(script, /cancelPending\(\)/);
  assert.match(script, /AutoSave\.cancelPending\(\)/);
  assert.match(script, /async trimAssets\(\)/);
  assert.match(script, /referencedAssetIds/);
  assert.match(script, /storedAssetKeys\.delete/);
  assert.match(script, /if \(Store\.flags\.suppressAutosave \|\| !this\.isEnabled\(\) \|\| !this\.isSafeToSave\(\)\) return/);
});

test('autosave asset pruning enumerates asset keys without materializing stored file records', () => {
  const keyBody = script.match(/async getAllAssetKeys\(\) \{([\s\S]*?)\n  \},\n\n  async trimAssets/)?.[1] || '';
  assert.ok(keyBody, 'AutoSave.getAllAssetKeys body should be present');
  assert.match(keyBody, /store\.getAllKeys\(\)/);
  assert.match(keyBody, /store\.openKeyCursor\(\)/);
  assert.match(keyBody, /store\.openCursor\(\)/);
  assert.match(keyBody, /keys\.push\(cursor\.key\)/);
  assert.doesNotMatch(keyBody, /store\.getAll\(\)/);
});

test('render config changes recompute readiness immediately', () => {
  assert.match(script, /Dom\['in-bitrate'\]\?\.addEventListener\('change'[\s\S]*?Engine\.checkReady\(\);[\s\S]*?AutoSave\.schedule\('recording'\)/);
  assert.match(script, /Dom\['in-stream-save'\]\?\.addEventListener\('change'[\s\S]*?Engine\.checkReady\(\);[\s\S]*?AutoSave\.schedule\('recording'\)/);
});

test('abort and fatal dialog have commercial-grade keyboard safety basics', () => {
  assert.match(html, /id="btn-abort"[^>]*aria-label="中止当前渲染 \/ Abort current render"[^>]*aria-pressed="false"/);
  assert.match(html, /id="error-overlay"[^>]*aria-describedby="err-msg err-recovery"/);
  assert.match(html, /id="err-recovery"[^>]*>渲染已停止，未保存文件。回到编辑器检查预检后再重试。\/ Rendering stopped; no file was saved; return to the editor and check Preflight before trying again\./);
  assert.match(html, /#error-overlay \{[^}]*height: 100dvh;[^}]*padding: 24px;[^}]*box-sizing: border-box;[^}]*overflow-y: auto/);
  assert.match(html, /\.err-box \{[^}]*max-height: calc\(100dvh - 48px\);[^}]*overflow-y: auto;[^}]*display: flex;[^}]*flex-direction: column/);
  assert.match(html, /#err-msg \{[^}]*max-height: min\(36dvh, 260px\);[^}]*overflow-y: auto;[^}]*overflow-wrap: anywhere/);
  assert.match(script, /requestAbort\(\)/);
  assert.match(script, /setAbortArmed\(armed\)/);
  assert.match(script, /if \(Machine\.status === 'EXPORTING'\) \{[\s\S]*?导出正在封装。请等待保存或下载结果出现后，再开始新的渲染。/);
  assert.match(script, /Finalizing cannot be cancelled safely/);
  assert.match(script, /btn\.setAttribute\('aria-pressed', armed \? 'true' : 'false'\)/);
  assert.match(script, /clearAbortConfirm\(\)/);
  assert.match(script, /this\._abortConfirmTimer = setTimeout/);
  assert.match(script, /Click abort again within 2\.5s to stop this render/);
  assert.match(script, /handleModalKeydown\(e\)/);
  assert.match(script, /e\.key === 'Escape'/);
  assert.match(script, /\.inert = !!open/);
  assert.match(script, /!Dom\['error-overlay'\]\.contains\(document\.activeElement\)/);
  assert.match(script, /!Dom\['error-overlay'\]\.contains\(document\.activeElement\)[\s\S]*?e\.preventDefault\(\);[\s\S]*?first\.focus\(\);[\s\S]*?return/);
  assert.match(script, /_lastFocusedBeforeError/);
});

test('continuous renders refresh audio capture destination and require live audio tracks', () => {
  assert.match(script, /ensureStreamDestination\(fresh = false\)/);
  assert.match(script, /this\.streamDest\.stream\?\.getTracks\?\.\(\)\.forEach/);
  assert.match(script, /AudioEngine\.ensureStreamDestination\(true\)/);
  assert.match(script, /audioTrack\.readyState !== 'live'/);
});

test('audio engine initialization is all-or-nothing after graph setup failures', () => {
  const ensureBody = script.match(/ensure\(\) \{([\s\S]*?)\n  \},\n\n  ensureStreamDestination/)?.[1] || '';
  assert.ok(ensureBody, 'AudioEngine.ensure body should be present');
  assert.doesNotMatch(ensureBody, /if \(this\.ctx\) return/);
  assert.match(ensureBody, /this\.ctx && this\.analyser && this\.source && this\.streamDest/);
  assert.match(ensureBody, /try \{/);
  assert.match(ensureBody, /catch \(err\)/);
  assert.match(ensureBody, /this\.ctx = null/);
  assert.match(ensureBody, /this\.analyser = null/);
  assert.match(ensureBody, /this\.source = null/);
  assert.match(ensureBody, /this\.streamDest = null/);
  assert.match(ensureBody, /throw err/);
});

test('audio engine creates stream destination before binding the media element source', () => {
  const ensureBody = script.match(/ensure\(\) \{([\s\S]*?)\n  \},\n\n  ensureStreamDestination/)?.[1] || '';
  assert.ok(ensureBody, 'AudioEngine.ensure body should be present');
  const streamDestinationIndex = ensureBody.indexOf('this.ensureStreamDestination();');
  const mediaSourceIndex = ensureBody.indexOf('this.source = this.ctx.createMediaElementSource(Store.assets.audio);');
  assert.notEqual(streamDestinationIndex, -1, 'AudioEngine.ensure should create a stream destination');
  assert.notEqual(mediaSourceIndex, -1, 'AudioEngine.ensure should bind the media element source');
  assert.ok(
    streamDestinationIndex < mediaSourceIndex,
    'AudioEngine.ensure should finish throwable destination setup before createMediaElementSource binds the audio element'
  );
});

test('static image center visuals are bounded like video assets', () => {
  assert.match(script, /video image dimension invalid/);
  assert.match(script, /pixels > LIMITS\.maxImagePixels \|\| maxDim > LIMITS\.maxVideoDim/);
  assert.match(script, /VIDEO-IMAGE DIMENSION INVALID/);
});

test('package export refuses memory-dangerous projects before reading assets', () => {
  assert.match(script, /maxPackageBytes:\s*500 \* 1024 \* 1024/);
  assert.match(script, /maxPackageExportBytes:\s*450 \* 1024 \* 1024/);
  assert.match(script, /estimatedExportBytes/);
  assert.match(script, /estimatedBytes > LIMITS\.maxPackageExportBytes/);
  assert.match(script, /Reduce asset sizes before saving \.fadmv/);
  assert.match(script, /if \(AutoSave\.isEnabled\(\)\) AutoSave\.saveSnapshot\('package-import'\)/);
});

test('package commands reject cheap command failures before starting package jobs', () => {
  const startJobBody = script.match(/startPackageJob\(label\) \{([\s\S]*?)\n  \},\n\n  finishPackageJob/)?.[1] || '';
  assert.ok(startJobBody, 'startPackageJob body should be present');
  assert.match(startJobBody, /this\.assertPackageJobReady\(\)/);
  assert.doesNotMatch(startJobBody, /invalidRawAssetTypes/);
  assert.doesNotMatch(startJobBody, /Asset still loading or invalid/);

  const exportPreflightBody = script.match(/assertPackageExportPreflight\(\) \{([\s\S]*?)\n  \},\n\n  assertPackageImportFilePreflight/)?.[1] || '';
  assert.ok(exportPreflightBody, 'assertPackageExportPreflight body should be present');
  assert.match(exportPreflightBody, /this\.assertPackageJobReady\(\)/);
  assert.match(exportPreflightBody, /const invalidAssets = this\.invalidRawAssetTypes\(\)/);
  assert.match(exportPreflightBody, /if \(invalidAssets\.length\) throw new Error\(`Asset still loading or invalid: \$\{invalidAssets\.join\(', '\)\}`\)/);
  assert.match(exportPreflightBody, /const estimatedBytes = this\.estimatedExportBytes\(assets\)/);
  assert.match(exportPreflightBody, /if \(estimatedBytes > LIMITS\.maxPackageExportBytes\)/);
  assert.match(exportPreflightBody, /Reduce asset sizes before saving \.fadmv/);

  const downloadBody = script.match(/async downloadPackage\(\) \{([\s\S]*?)\n  \},\n\n  mimeForAsset/)?.[1] || '';
  assert.ok(downloadBody, 'downloadPackage body should be present');
  assert.ok(
    downloadBody.indexOf('this.assertPackageExportPreflight();') < downloadBody.indexOf("this.startPackageJob('PACKAGE EXPORTING')"),
    'export command preflight should run before package job state starts'
  );

  const importPreflightBody = script.match(/assertPackageImportFilePreflight\(file\) \{([\s\S]*?)\n  \},\n\n  updateControls/)?.[1] || '';
  assert.ok(importPreflightBody, 'assertPackageImportFilePreflight body should be present');
  assert.match(importPreflightBody, /this\.assertPackageJobReady\(\)/);
  assert.match(importPreflightBody, /if \(!file\) throw new Error\('No package selected'\)/);
  assert.match(importPreflightBody, /if \(file\.size > LIMITS\.maxPackageBytes\) throw new Error\('Package too large'\)/);
  assert.doesNotMatch(importPreflightBody, /invalidRawAssetTypes/);

  const importBody = script.match(/async importPackageFile\(file\) \{([\s\S]*?)\n  \},\n\n  init\(\)/)?.[1] || '';
  assert.ok(importBody, 'importPackageFile body should be present');
  assert.ok(
    importBody.indexOf('this.assertPackageImportFilePreflight(file);') < importBody.indexOf("this.startPackageJob('PACKAGE IMPORTING')"),
    'import command file preflight should run before package job state starts'
  );
});

test('fadmv package work yields during large CRC and zip loops', () => {
  assert.match(script, /packageYieldBytes:\s*2 \* 1024 \* 1024/);
  assert.match(script, /packageCrcYieldBytes:\s*64 \* 1024/);
  assert.match(script, /yieldToBrowser\(\)/);
  assert.match(script, /async crc32UpdateAsync\(crc, bytes, token = this\.currentPackageToken\(\), onProgress = null\)/);
  assert.match(script, /LIMITS\.packageCrcYieldBytes \|\| LIMITS\.packageYieldBytes/);
  assert.match(script, /if \(onProgress\) onProgress\(end\)/);
  assert.match(script, /async crc32Async\(bytes, token = this\.currentPackageToken\(\)\)/);
  assert.match(script, /async crc32Blob\(blob, token/);
  assert.match(script, /await this\.yieldToBrowser\(\)/);
  assert.match(script, /crc = await this\.crc32UpdateAsync\(crc, bytes\.subarray\(offset, end\), token\)/);
  assert.match(script, /crc = await this\.crc32UpdateAsync\(crc, bytes, token, progress/);
  assert.match(script, /await this\.crc32Blob\(blob, token/);
  assert.match(script, /entries\[0\]\.crc = await this\.crc32Async\(entries\[0\]\.bytes, token\)/);
  assert.match(script, /if \(size > LIMITS\.packageYieldBytes\) await this\.yieldToBrowser\(\)/);
  assert.match(script, /updatePackageProgressPending\(stage\)/);
  assert.match(script, /UI\.progressPending\(stage\)/);
  assert.match(script, /this\.updatePackageProgressPending\('PACKAGE FINALIZING'\)/);
  assert.doesNotMatch(script, /this\.updatePackageProgress\('PACKAGE FINALIZING', totalWork, totalWork\)/);
});

test('fadmv import avoids copying every entry payload before validation', () => {
  const parseBody = script.match(/async parseZip\(file\) \{([\s\S]*?)\n  \},\n\n  getRawAssetEntries/)?.[1] || '';
  assert.ok(parseBody, 'parseZip body should be present');
  assert.doesNotMatch(parseBody, /file\.arrayBuffer\(\)/);
  assert.match(parseBody, /const data = file\.slice\(dataStart, dataStart \+ compressedSize\)/);
  assert.match(parseBody, /await this\.crc32Blob\(data, token/);
  assert.doesNotMatch(parseBody, /bytes\.slice\(dataStart, dataStart \+ compressedSize\)/);
  assert.doesNotMatch(parseBody, /bytes\.subarray\(dataStart, dataStart \+ compressedSize\)/);
});

test('fadmv package export avoids whole-asset arrayBuffer reads', () => {
  const fileToEntryBody = script.match(/async fileToEntry\(path, blob, token[\s\S]*?\) \{([\s\S]*?)\n  \},\n\n  async createZip/)?.[1] || '';
  assert.ok(fileToEntryBody, 'fileToEntry body should be present');
  assert.doesNotMatch(fileToEntryBody, /blob\.arrayBuffer\(\)/);
  assert.match(fileToEntryBody, /await this\.crc32Blob\(blob, token/);
  assert.match(fileToEntryBody, /data: blob/);
});

test('fadmv package jobs have busy state and timeout guards', () => {
  assert.match(script, /maxPackageJobMs/);
  assert.match(script, /packageJob:\s*\{ running: false, cancelling: false, token: 0, cancelledToken: 0, startedAt: 0, label: '', returnFocusId: '' \}/);
  assert.match(script, /startPackageJob\(label\)/);
  assert.match(script, /finishPackageJob\(token\)/);
  assert.match(script, /throwIfPackageJobStopped\(token\)/);
  assert.match(script, /Package operation already running/);
  assert.match(script, /Package operation timeout/);
});

test('fadmv package controls are locked during package jobs', () => {
  const controlsBody = script.match(/updateControls\(\) \{([\s\S]*?)\n  \},\n\n  async exportPackageBlob/)?.[1] || '';
  assert.ok(controlsBody, 'ProjectPackage.updateControls body should be present');
  assert.match(controlsBody, /const running = Store\.packageJob\.running/);
  assert.match(controlsBody, /const restoreRunning = Store\.restoreJob\.running/);
  assert.match(controlsBody, /const analysisBusy = this\.isAudioAnalysisBusy\(\)/);
  assert.match(controlsBody, /Dom\['btn-save-package'\]/);
  assert.match(controlsBody, /Dom\['btn-load-package'\]/);
  assert.match(controlsBody, /Dom\['btn-cancel-package'\]/);
  assert.match(controlsBody, /const invalidAssets = this\.invalidRawAssetTypes\(\)/);
  assert.match(controlsBody, /const batchRunning = Store\.batch\.running/);
  assert.match(controlsBody, /const autosaveRunning = Store\.autosaveJob\.running/);
  assert.match(controlsBody, /btn\.disabled = running \|\| restoreRunning \|\| autosaveRunning \|\| batchRunning \|\| analysisBusy \|\| invalidAssets\.length > 0 \|\| Machine\.status !== 'IDLE' \|\| tooLarge/);
  assert.match(controlsBody, /loadBtn\.disabled = running \|\| restoreRunning \|\| autosaveRunning \|\| batchRunning \|\| analysisBusy \|\| Machine\.status !== 'IDLE'/);
});

test('fadmv package jobs report stage progress through the live progressbar', () => {
  assert.match(script, /packageProgress:\s*\{ stage: '', loaded: 0, total: 0 \}/);
  assert.match(script, /_lastProgressLabel: ''/);
  assert.match(script, /_lastProgressLiveLabel: ''/);
  assert.match(script, /progress\(curr, total, label = 'REC'\)/);
  assert.match(script, /const labelChanged = label !== this\._lastProgressLabel/);
  assert.match(script, /if \(Math\.abs\(pct - this\._lastProgressPct\) < 0\.05 && !labelChanged\) return/);
  assert.match(script, /const progressLabel = this\.progressAriaLabel\(label\)/);
  assert.match(script, /Dom\['progress-fill'\]\.setAttribute\('aria-label', `进度 \/ \$\{label\} progress`\)/);
  assert.match(script, /Dom\['progress-fill'\]\.setAttribute\('aria-valuetext', `进度 \$\{pct\.toFixed\(1\)\}% \/ \$\{progressLabel\} \$\{pct\.toFixed\(1\)\}%`\)/);
  assert.match(script, /const statusMsg = `\$\{label\}: \$\{pct\.toFixed\(1\)\}%`/);
  assert.match(script, /Dom\['status-text'\]\.textContent = statusMsg/);
  assert.match(script, /Dom\['status-text'\]\.title = statusMsg/);
  const progressBody = script.match(/progress\(curr, total, label = 'REC'\) \{([\s\S]*?)\n  \},\n  log/)?.[1] || '';
  assert.match(progressBody, /const liveBucket = Math\.floor\(pct \/ 5\)/);
  assert.match(progressBody, /Dom\['status-live'\]\.textContent = `\$\{label\}: \$\{pct\.toFixed\(1\)\}%`/);
  assert.match(script, /progressPending\(label = 'WORKING'\)/);
  assert.match(script, /const statusMsg = `\$\{label\}: pending`/);
  assert.match(script, /progressAriaLabel\(label = 'REC'\)/);
  assert.match(script, /Dom\['progress-fill'\]\.setAttribute\('aria-valuetext', `进度待定 \/ \$\{progressLabel\} pending`\)/);
  assert.match(script, /Dom\['status-live'\]\.textContent = msg/);
  assert.match(script, /updatePackageProgress\(stage, loaded, total\)/);
  assert.match(script, /UI\.progress\(loaded, total, stage\)/);
  assert.match(script, /Store\.packageProgress = \{ stage: '', loaded: 0, total: 0 \}/);
});

test('fadmv package load failures avoid unverifiable restore promises', () => {
  assert.match(script, /Package load failed:/);
  assert.doesNotMatch(script, /Current project was left unchanged or restored/);
});

test('fadmv package jobs globally lock project mutation and render starts', () => {
  assert.match(script, /actions:\s*\[[\s\S]*?'btn-analyze-audio'/);
  const updateStateBody = script.match(/updateState\(state, opts = \{\}\) \{([\s\S]*?)\n  \},\n  moveFocusForState/)?.[1] || '';
  assert.ok(updateStateBody, 'UI.updateState body should be present');
  assert.match(updateStateBody, /const packageLock = Store\.packageJob\.running/);
  assert.match(updateStateBody, /const restoreLock = Store\.restoreJob\.running/);
  assert.match(updateStateBody, /const autosaveLock = Store\.autosaveJob\.running/);
  assert.match(updateStateBody, /const batchLock = Store\.batch\.running/);
  assert.match(updateStateBody, /const hardLock = packageLock \|\| restoreLock \|\| autosaveLock \|\| batchLock \|\| state === 'WARMING' \|\| state === 'RECORDING' \|\| state === 'EXPORTING'/);
  assert.match(updateStateBody, /const previewFileLock = packageLock \|\| restoreLock \|\| autosaveLock \|\| batchLock \|\| state === 'PREVIEWING'/);
  assert.match(updateStateBody, /Dom\[id\]\.disabled = packageLock \|\| restoreLock \|\| autosaveLock \|\| batchLock \|\| state !== 'IDLE'/);

  const checkReadyBody = script.match(/checkReady\(\) \{([\s\S]*?)\n  \},\n\n  triggerUpdate/)?.[1] || '';
  assert.ok(checkReadyBody, 'Engine.checkReady body should be present');
  assert.match(checkReadyBody, /const readiness = Preflight\.getRenderReadiness\(\)/);
  assert.match(checkReadyBody, /Dom\['btn-preview'\]\.disabled = !readiness\.previewReady/);
  assert.match(checkReadyBody, /Dom\['btn-rec'\]\.disabled = !readiness\.recordReady/);

  const preflightBody = script.match(/const Preflight = \{([\s\S]*?)\n\};\n\nconst Engine/)?.[1] || '';
  assert.ok(preflightBody, 'Preflight body should be present');
  assert.match(preflightBody, /const packageLock = Store\.packageJob\.running/);
  assert.match(preflightBody, /const restoreLock = Store\.restoreJob\.running/);
  assert.match(preflightBody, /const autosaveLock = Store\.autosaveJob\.running/);
  assert.match(preflightBody, /const mutationLock = packageLock \|\| restoreLock \|\| autosaveLock \|\| batchLock \|\| machineLock/);

  const audioBody = script.match(/const AudioAnalysis = \{([\s\S]*?)\n\};\n\nconst Preflight/)?.[1] || '';
  const panelBody = audioBody.match(/updatePanel\(\) \{([\s\S]*?)\n  \}/)?.[1] || '';
  assert.ok(panelBody, 'AudioAnalysis.updatePanel body should be present');
  assert.match(panelBody, /const lockReason = this\.audioAnalysisLockReason\(\)/);
  assert.match(panelBody, /button\.innerHTML = isBusy/);
  assert.match(panelBody, /<span class="btn-main">取消分析<\/span><span class="btn-sub">Cancel Analysis<\/span>/);
  assert.match(panelBody, /<span class="btn-main">分析音轨<\/span><span class="btn-sub">Analyze Track<\/span>/);
  assert.match(panelBody, /button\.disabled = !hasAudio \|\| \(!isBusy && !!lockReason\)/);

  const startJobBody = script.match(/startPackageJob\(label\) \{([\s\S]*?)\n  \},\n\n  finishPackageJob/)?.[1] || '';
  assert.ok(startJobBody, 'startPackageJob body should be present');
  assert.match(startJobBody, /UI\.updateState\(Machine\.status\)/);
  assert.match(startJobBody, /Engine\.checkReady\(\)/);
  assert.match(startJobBody, /returnFocusId/);
  assert.match(startJobBody, /this\.focusPackageCancel\(\)/);

  const finishJobBody = script.match(/finishPackageJob\(token\) \{([\s\S]*?)\n  \},\n\n  cancelPackageJob/)?.[1] || '';
  assert.ok(finishJobBody, 'finishPackageJob body should be present');
  assert.match(finishJobBody, /UI\.updateState\(Machine\.status\)/);
  assert.match(finishJobBody, /Engine\.checkReady\(\)/);
  assert.match(finishJobBody, /this\.restorePackageFocus\(returnFocusId\)/);
});

test('fadmv package jobs block late file callbacks and unload loss', () => {
  const beforeUnloadBody = script.match(/window\.addEventListener\('beforeunload', \(e\) => \{([\s\S]*?)\n    \}, \{ capture: true \}\)/)?.[1] || '';
  assert.ok(beforeUnloadBody, 'beforeunload handler should be present');
  assert.match(beforeUnloadBody, /Machine\.status !== 'IDLE' \|\| Store\.packageJob\.running \|\| Store\.restoreJob\.running \|\| Store\.autosaveJob\.running \|\| Store\.batch\.running/);
  assert.match(beforeUnloadBody, /Store\.audioAnalysis\.status === 'analyzing'/);

  const bindFileBody = script.match(/bindFile\(inputId, type\) \{([\s\S]*?)\n  \}\n\};\n\nconst ProjectPresets/)?.[1] || '';
  assert.ok(bindFileBody, 'AssetManager.bindFile body should be present');
  assert.match(bindFileBody, /e\.preventDefault\(\)/);
  assert.match(script, /Package operation in progress\. Wait for it to finish before changing assets\./);
  assert.match(bindFileBody, /const lockReason = this\.mutationLockReason\(\)/);
  assert.match(bindFileBody, /if \(lockReason\) \{[\s\S]*?return;[\s\S]*?\}/);

  const loadProjectBody = script.match(/async loadProjectFile\(file\) \{([\s\S]*?)\n  \},\n\n  clearLiveAssetsAfterJsonImport/)?.[1] || '';
  assert.ok(loadProjectBody, 'ProjectPresets.loadProjectFile body should be present');
  assert.match(loadProjectBody, /const packageGuard = ProjectPackage\.captureMutationGuard\(\)/);
  assert.match(loadProjectBody, /const restoreGuard = AutoSave\.captureRestoreGuard\('Project restore in progress\. Wait for it to finish before loading JSON\.'\)/);
  assert.match(loadProjectBody, /await file\.text\(\)/);
  assert.match(loadProjectBody, /ProjectPackage\.assertMutationGuard\(packageGuard\)/);
  assert.match(loadProjectBody, /AutoSave\.assertRestoreGuard\(restoreGuard, 'Project restore in progress\. Wait for it to finish before loading JSON\.'\)/);
  assert.ok(loadProjectBody.indexOf('ProjectPackage.assertMutationGuard(packageGuard);') > loadProjectBody.indexOf('await file.text()'));
  assert.ok(loadProjectBody.indexOf('AutoSave.assertRestoreGuard(restoreGuard') > loadProjectBody.indexOf('await file.text()'));

  const recorderBody = script.match(/const Recorder = \{([\s\S]*?)\n\};\n\nwindow\.LIMITS/)?.[1] || '';
  assert.ok(recorderBody, 'Recorder body should be present');
  const blockerBody = recorderBody.match(/renderStartBlocker\(opts = \{\}\) \{([\s\S]*?)\n  \},\n\n  async start/)?.[1] || '';
  assert.ok(blockerBody, 'Recorder.renderStartBlocker body should be present');
  assert.match(blockerBody, /if \(Store\.packageJob\.running\) \{[\s\S]*?return 'Package operation in progress\. Wait for it to finish before starting render\.'/);
  assert.match(blockerBody, /if \(Store\.restoreJob\.running\) \{[\s\S]*?return 'Project restore in progress\. Wait for it to finish before starting render\.'/);
  assert.doesNotMatch(blockerBody, /throw new Error\('Package operation in progress'\)/);
  assert.doesNotMatch(blockerBody, /throw new Error\('Project restore in progress'\)/);
});

test('autosave and custom presets block late package mutations', () => {
  assert.match(script, /captureMutationGuard\(message = 'Package operation in progress', opts = \{\}\)/);
  assert.match(script, /assertMutationGuard\(token, message = 'Package operation in progress', opts = \{\}\)/);

  const restoreLatestBody = script.match(/async restoreLatest\(\) \{([\s\S]*?)\n  \},\n\n  async restoreSnapshot/)?.[1] || '';
  assert.ok(restoreLatestBody, 'AutoSave.restoreLatest body should be present');
  assert.match(restoreLatestBody, /const packageGuard = ProjectPackage\.captureMutationGuard/);
  assert.match(restoreLatestBody, /await this\.getAll\(\)/);
  assert.match(restoreLatestBody, /ProjectPackage\.assertMutationGuard\(packageGuard/);
  assert.match(restoreLatestBody, /await this\.applySnapshot\(latest, packageGuard, restoreGuard\)/);

  const restoreSnapshotBody = script.match(/async restoreSnapshot\(id\) \{([\s\S]*?)\n  \},\n\n  async resolveAssetFile/)?.[1] || '';
  assert.ok(restoreSnapshotBody, 'AutoSave.restoreSnapshot body should be present');
  assert.match(restoreSnapshotBody, /const packageGuard = ProjectPackage\.captureMutationGuard/);
  assert.match(restoreSnapshotBody, /ProjectPackage\.assertMutationGuard\(packageGuard/);
  assert.match(restoreSnapshotBody, /await this\.applySnapshot\(snap, packageGuard, restoreGuard\)/);

  const applySnapshotBody = script.match(/async applySnapshot\(snap, packageGuard = ProjectPackage\.captureMutationGuard[\s\S]*?\) \{([\s\S]*?)\n  \},\n\n  async restoreSelectedRecent/)?.[1] || '';
  assert.ok(applySnapshotBody, 'AutoSave.applySnapshot body should be package guarded');
  assert.match(applySnapshotBody, /ProjectPackage\.assertMutationGuard\(packageGuard/);
  assert.ok(applySnapshotBody.indexOf('ProjectPackage.assertMutationGuard(packageGuard') < applySnapshotBody.indexOf('ProjectPresets.importState'));
  assert.ok(applySnapshotBody.indexOf('ProjectPackage.assertMutationGuard(packageGuard') < applySnapshotBody.indexOf('AssetManager.loadFile'));

  const customBody = script.match(/applySelected\(\) \{([\s\S]*?)\n  \},\n\n  deleteSelected/)?.[1] || '';
  assert.ok(customBody, 'CustomPresets.applySelected body should be present');
  assert.match(customBody, /ProjectPackage\.assertMutationGuard\(ProjectPackage\.captureMutationGuard/);

  const saveSnapshotBody = script.match(/async saveSnapshot\(source = 'autosave', opts = \{\}\) \{([\s\S]*?)\n  \},\n\n  async trimRecent/)?.[1] || '';
  assert.ok(saveSnapshotBody, 'AutoSave.saveSnapshot body should be present');
  assert.match(saveSnapshotBody, /const packageGuard = ProjectPackage\.captureMutationGuard/);
  assert.match(saveSnapshotBody, /const state = ProjectPresets\.exportState\(\)/);
  assert.match(saveSnapshotBody, /const assetScope = this\.snapshotAssetScope\(capturedAt, generation\)/);
  assert.match(saveSnapshotBody, /const records = this\.currentAssetRecords\(assetScope\)/);
  assert.ok(saveSnapshotBody.indexOf('const state = ProjectPresets.exportState()') < saveSnapshotBody.indexOf('await this.buildAssetStoragePlan(records)'));
  assert.match(saveSnapshotBody, /this\.snapshot\(this\.latestKey, source, assetRefs, recordsLength, plan\.reason, state, capturedAt, plan\.assetsStored\)/);
  assert.match(saveSnapshotBody, /ProjectPackage\.assertMutationGuard\(packageGuard/);

  const snapshotBody = script.match(/snapshot\(id, source, assetRefs = \{\}, recordsLength = this\.currentAssetRecords\(\)\.length, assetSaveSkippedReason = '', state = ProjectPresets\.exportState\(\), capturedAt = Date\.now\(\), assetsStored = Object\.keys\(assetRefs \|\| \{\}\)\.length === recordsLength\) \{([\s\S]*?)\n  \},\n\n  putSnapshotRecords/)?.[1] || '';
  assert.ok(snapshotBody, 'AutoSave.snapshot body should accept captured state');
  assert.match(snapshotBody, /state,/);
});

test('direct autosave snapshot apply cannot bypass an active restore lock', () => {
  assert.match(script, /const INTERNAL_RESTORE_APPLY_TOKEN = Symbol\('internal restore apply'\)/);

  const autoSaveBody = script.match(/const AutoSave = \{([\s\S]*?)\n\};\n\nconst CustomPresets/)?.[1] || '';
  assert.ok(autoSaveBody, 'AutoSave body should be present');
  const assertBody = autoSaveBody.match(/assertSnapshotRestoreGuard\(restoreGuard, message = 'Project restore in progress'\) \{([\s\S]*?)\n  \},\n\n  async withRestoreLock/)?.[1] || '';
  assert.ok(assertBody, 'AutoSave.assertSnapshotRestoreGuard body should be present');
  assert.match(assertBody, /restoreGuard\?\.internal === INTERNAL_RESTORE_APPLY_TOKEN/);
  assert.match(assertBody, /Store\.restoreJob\.token !== restoreGuard\.token/);
  assert.match(assertBody, /this\.assertRestoreGuard\(restoreGuard, message\)/);

  const restoreLatestBody = autoSaveBody.match(/async restoreLatest\(\) \{([\s\S]*?)\n  \},\n\n  async restoreSnapshot/)?.[1] || '';
  assert.ok(restoreLatestBody, 'AutoSave.restoreLatest body should be present');
  assert.match(restoreLatestBody, /const restoreGuard = \{ token: Store\.restoreJob\.token, internal: INTERNAL_RESTORE_APPLY_TOKEN \}/);
  assert.match(restoreLatestBody, /await this\.applySnapshot\(latest, packageGuard, restoreGuard\)/);

  const restoreSnapshotBody = autoSaveBody.match(/async restoreSnapshot\(id\) \{([\s\S]*?)\n  \},\n\n  async resolveAssetFile/)?.[1] || '';
  assert.ok(restoreSnapshotBody, 'AutoSave.restoreSnapshot body should be present');
  assert.match(restoreSnapshotBody, /const restoreGuard = \{ token: Store\.restoreJob\.token, internal: INTERNAL_RESTORE_APPLY_TOKEN \}/);
  assert.match(restoreSnapshotBody, /await this\.applySnapshot\(snap, packageGuard, restoreGuard\)/);

  const snapshotBody = autoSaveApplySnapshotBody();
  assert.match(snapshotBody, /const restoreMessage = 'Project restore in progress\. Wait for it to finish before restoring autosave\.'/);
  assert.match(snapshotBody, /restoreGuard = this\.captureRestoreGuard\(restoreMessage\)/);
  assert.match(snapshotBody, /this\.assertSnapshotRestoreGuard\(restoreGuard, restoreMessage\)/);
  assert.ok(snapshotBody.indexOf('this.assertSnapshotRestoreGuard(restoreGuard') < snapshotBody.indexOf('ProjectPresets.importState(snap.state'));
  assert.ok(snapshotBody.indexOf('this.assertSnapshotRestoreGuard(restoreGuard') < snapshotBody.indexOf('AssetManager.loadFile(type, prepared[type]'));
});

test('project package and batch commands enforce machine-level mutation locks', () => {
  const captureBody = script.match(/captureMutationGuard\(message = 'Package operation in progress', opts = \{\}\) \{([\s\S]*?)\n  \},\n\n  assertMutationGuard/)?.[1] || '';
  assert.ok(captureBody, 'ProjectPackage.captureMutationGuard body should be present');
  assert.match(captureBody, /Store\.autosaveJob\.running && !opts\.allowAutosaveJob/);
  assert.match(captureBody, /Machine\.status !== 'IDLE'/);
  assert.match(captureBody, /Wait for \$\{Machine\.status\.toLowerCase\(\)\} to finish before changing the project/);

  const assertBody = script.match(/assertMutationGuard\(token, message = 'Package operation in progress', opts = \{\}\) \{([\s\S]*?)\n  \},\n\n  currentPackageToken/)?.[1] || '';
  assert.ok(assertBody, 'ProjectPackage.assertMutationGuard body should be present');
  assert.match(assertBody, /Store\.autosaveJob\.running && !opts\.allowAutosaveJob/);
  assert.match(assertBody, /Machine\.status !== 'IDLE'/);

  const startJobBody = script.match(/startPackageJob\(label\) \{([\s\S]*?)\n  \},\n\n  finishPackageJob/)?.[1] || '';
  assert.ok(startJobBody, 'ProjectPackage.startPackageJob body should be present');
  assert.match(startJobBody, /this\.assertPackageJobReady\(\)/);

  const packageJobBlockerBody = script.match(/packageJobBlocker\(\) \{([\s\S]*?)\n  \},\n\n  assertPackageJobReady/)?.[1] || '';
  assert.ok(packageJobBlockerBody, 'ProjectPackage.packageJobBlocker body should be present');
  assert.match(packageJobBlockerBody, /if \(Store\.restoreJob\.running\) return 'Project restore in progress'/);
  assert.match(packageJobBlockerBody, /if \(Store\.autosaveJob\.running\) return Store\.autosaveJob\.label \|\| 'Autosave in progress'/);
  assert.match(packageJobBlockerBody, /if \(Store\.batch\.running\) return 'Batch render in progress'/);
  assert.match(packageJobBlockerBody, /if \(Machine\.status !== 'IDLE'\) return `Wait for \$\{Machine\.status\.toLowerCase\(\)\} to finish`/);

  const batchBody = script.match(/const BatchQueue = \{([\s\S]*?)\n\};\n\nconst AudioAnalysis/)?.[1] || '';
  assert.ok(batchBody, 'BatchQueue body should be present');
  const batchRenderLockBody = batchBody.match(/batchRenderLockReason\(\) \{([\s\S]*?)\n  \},\n\n  async renderNext/)?.[1] || '';
  assert.ok(batchRenderLockBody, 'BatchQueue.batchRenderLockReason body should be present');
  assert.match(batchRenderLockBody, /if \(Machine\.status !== 'IDLE'\) return `Wait for \$\{Machine\.status\.toLowerCase\(\)\} to finish before loading batch audio\.`/);
  const batchStartBody = batchBody.match(/async start\(\) \{([\s\S]*?)\n  \},\n\n  render\(\)/)?.[1] || '';
  assert.ok(batchStartBody, 'BatchQueue.start body should be present');
  assert.match(batchStartBody, /if \(Machine\.status !== 'IDLE'\) \{[\s\S]*?UI\.showError\(`Wait for \$\{Machine\.status\.toLowerCase\(\)\} to finish before starting batch render\.`/);
  const renderNextBody = batchBody.match(/async renderNext\(index\) \{([\s\S]*?)\n  \},\n\n  async start/)?.[1] || '';
  assert.ok(renderNextBody, 'BatchQueue.renderNext body should be present');
  assert.ok(renderNextBody.indexOf('const lockReason = this.batchRenderLockReason()') < renderNextBody.indexOf("await AssetManager.loadFile('audio', item.file"));
});

test('project state import commands enforce direct mutation locks with internal overrides', () => {
  const importBody = script.match(/importState\(raw, opts = \{\}\) \{([\s\S]*?)\n  \},\n\n  downloadProject/)?.[1] || '';
  assert.ok(importBody, 'ProjectPresets.importState body should be present');
  assert.match(importBody, /const lockReason = this\.projectMutationLockReason\(opts\)/);
  assert.match(importBody, /if \(lockReason\) throw new Error\(lockReason\)/);
  assert.ok(importBody.indexOf('const lockReason = this.projectMutationLockReason(opts)') < importBody.indexOf('if (data.meta)'));

  const projectLockBody = script.match(/projectMutationLockReason\(opts = \{\}\) \{([\s\S]*?)\n  \},\n\n  importState/)?.[1] || '';
  assert.ok(projectLockBody, 'ProjectPresets.projectMutationLockReason body should be present');
  assert.match(projectLockBody, /if \(opts\.allowLockedMutation\) return ''/);
  assert.match(projectLockBody, /if \(Store\.packageJob\.running\) return 'Package operation in progress\. Wait for it to finish before changing the project\.'/);
  assert.match(projectLockBody, /if \(Store\.restoreJob\.running\) return 'Project restore in progress\. Wait for it to finish before changing the project\.'/);
  assert.match(projectLockBody, /if \(Store\.autosaveJob\.running\) return 'Autosave in progress\. Wait for it to finish before changing the project\.'/);
  assert.match(projectLockBody, /if \(Store\.batch\.running\) return 'Batch render in progress\. Wait or cancel it before changing the project\.'/);
  assert.match(projectLockBody, /if \(\['WARMING', 'RECORDING', 'EXPORTING'\]\.includes\(Machine\.status\)\)/);
  assert.doesNotMatch(projectLockBody, /Machine\.status !== 'IDLE'/);

  for (const [name, mutationNeedle, setterBody] of [
    ['setText', 'Dom[id].value = safe', script.match(/setText\(id, value, maxLen, opts = \{\}\) \{([\s\S]*?)\n  \},\n\n  setSelect/)?.[1] || ''],
    ['setSelect', 'el.value = String(value)', script.match(/setSelect\(id, value, opts = \{\}\) \{([\s\S]*?)\n  \},\n\n  setRange/)?.[1] || ''],
    ['setRange', 'el.value = String(Math.round(percentValue))', script.match(/setRange\(id, percentValue, opts = \{\}\) \{([\s\S]*?)\n  \},\n\n  setCheckbox/)?.[1] || ''],
    ['setCheckbox', 'el.checked = !!checked', script.match(/setCheckbox\(id, checked, opts = \{\}\) \{([\s\S]*?)\n  \},\n\n  projectMutationLockReason/)?.[1] || '']
  ]) {
    assert.ok(setterBody, `ProjectPresets.${name} body should be present`);
    assert.ok(setterBody.indexOf('const lockReason = this.projectMutationLockReason(opts)') < setterBody.indexOf(mutationNeedle), `${name} should check project lock before mutating DOM`);
    assert.match(setterBody, /if \(lockReason\) \{[\s\S]*?UI\.showError\(lockReason, 'WARN'\);[\s\S]*?return false/);
  }

  for (const call of [
    "this.setText('in-song', data.meta.song, LIMITS.maxSongLen, opts)",
    "this.setText('in-artist', data.meta.artist, LIMITS.maxArtistLen, opts)",
    "this.setText('in-label', data.meta.label, LIMITS.maxLabelLen, opts)",
    "this.setSelect('in-font', data.config.fontName || Store.config.fontName, opts)",
    "this.setCheckbox('in-glitch', data.config.glitch, opts)",
    "this.setRange('in-logo-size', this.boundedLayoutValue('logoWidth', data.layout.logoWidth), opts)"
  ]) {
    assert.ok(importBody.includes(call), `importState should pass opts through ${call}`);
  }

  const brandBody = script.match(/applyPreset\(name\) \{([\s\S]*?)\n  \},\n\n  init/)?.[1] || '';
  assert.ok(brandBody, 'BrandPresets.applyPreset body should be present');
  assert.match(brandBody, /try \{[\s\S]*?ProjectPresets\.importState\(preset, \{ silent: true \}\)[\s\S]*?return true/);
  assert.match(brandBody, /\} catch \(err\) \{[\s\S]*?UI\.showError\(`Brand preset apply failed: \$\{Utils\.safeErrMsg\(err\)\}`, 'WARN'\);[\s\S]*?return false/);

  const restoreRuntime = restoreRuntimeBody();
  assert.match(restoreRuntime, /this\.importState\(snapshot\.state, \{ silent: true, noAutosave: true, allowLockedMutation: true \}\)/);

  const packageBody = script.match(/async importPackageFile\(file\) \{([\s\S]*?)\n  \},\n\n  init\(\)/)?.[1] || '';
  assert.ok(packageBody, 'ProjectPackage.importPackageFile body should be present');
  assert.match(packageBody, /ProjectPresets\.importState\(project, \{ silent: true, noAutosave: true, skipAudioAnalysis: true, allowLockedMutation: true \}\)/);

  const snapshotBody = autoSaveApplySnapshotBody();
  assert.match(snapshotBody, /ProjectPresets\.importState\(snap\.state, \{ silent: true, noAutosave: true, skipAudioAnalysis: true, allowLockedMutation: true \}\)/);
});

test('project setting DOM events and direct fps API cannot bypass project mutation locks', () => {
  assert.match(script, /controlMutationOverrideDepth: 0/);

  const projectBody = script.match(/const ProjectPresets = \{([\s\S]*?)\n\};\n\nconst ProjectPackage/)?.[1] || '';
  assert.ok(projectBody, 'ProjectPresets body should be present');
  assert.match(projectBody, /canMutateProjectFromControl\(reason = 'Project setting change'\) \{/);
  const controlGuardBody = projectBody.match(/canMutateProjectFromControl\(reason = 'Project setting change'\) \{([\s\S]*?)\n  \},\n\n  withLockedControlMutation/)?.[1] || '';
  assert.ok(controlGuardBody, 'ProjectPresets.canMutateProjectFromControl body should be present');
  assert.match(controlGuardBody, /this\.projectMutationLockReason\(\{ allowLockedMutation: Store\.flags\.controlMutationOverrideDepth > 0 \}\)/);
  assert.match(controlGuardBody, /UI\.showError\(lockReason, 'WARN'\)/);
  assert.match(controlGuardBody, /return false/);

  const overrideBody = projectBody.match(/withLockedControlMutation\(opts, fn\) \{([\s\S]*?)\n  \},\n\n  importState/)?.[1] || '';
  assert.ok(overrideBody, 'ProjectPresets.withLockedControlMutation body should be present');
  assert.match(overrideBody, /Store\.flags\.controlMutationOverrideDepth \+= 1/);
  assert.match(overrideBody, /finally \{[\s\S]*?Store\.flags\.controlMutationOverrideDepth = Math\.max\(0, Store\.flags\.controlMutationOverrideDepth - 1\)/);

  for (const [name, setterBody] of [
    ['setText', script.match(/setText\(id, value, maxLen, opts = \{\}\) \{([\s\S]*?)\n  \},\n\n  setSelect/)?.[1] || ''],
    ['setSelect', script.match(/setSelect\(id, value, opts = \{\}\) \{([\s\S]*?)\n  \},\n\n  setRange/)?.[1] || ''],
    ['setRange', script.match(/setRange\(id, percentValue, opts = \{\}\) \{([\s\S]*?)\n  \},\n\n  setCheckbox/)?.[1] || ''],
    ['setCheckbox', script.match(/setCheckbox\(id, checked, opts = \{\}\) \{([\s\S]*?)\n  \},\n\n  projectMutationLockReason/)?.[1] || '']
  ]) {
    assert.ok(setterBody, `ProjectPresets.${name} body should be present`);
    assert.match(setterBody, /return this\.withLockedControlMutation\(opts, \(\) => \{/);
    assert.match(setterBody, /dispatchEvent\(new Event\('(input|change)', \{ bubbles: true \}\)\)/);
  }

  const bindBody = script.match(/bindAll\(\) \{([\s\S]*?)\n  \},\n  loadFile/)?.[1] || '';
  assert.ok(bindBody, 'AssetManager.bindAll body should be present');
  const assetBody = script.match(/const AssetManager = \{([\s\S]*?)\n\};\n\nconst ProjectPresets/)?.[1] || '';
  assert.ok(assetBody, 'AssetManager body should be present');
  assert.match(assetBody, /canMutateProjectFromControl\(reason = 'Project setting change'\)/);
  assert.match(assetBody, /ProjectPresets\.canMutateProjectFromControl\(reason\)/);
  const metadataGuardAt = bindBody.indexOf('if (!this.canMutateProjectFromControl()) return;');
  assert.ok(metadataGuardAt >= 0 && metadataGuardAt < bindBody.indexOf('const safeVal = Utils.clampText'), 'metadata input listener should guard before mutating metadata');
  for (const [id, mutation] of [
    ['in-font', 'Store.config.fontName = e.target.value'],
    ['in-glitch', 'Store.config.glitch = !!e.target.checked'],
    ['in-logo-size', 'LayoutConfig.logoWidth = Utils.toInt'],
    ['in-logo-pos', 'LayoutConfig.logoBottomMargin = Utils.toInt'],
    ['in-sensitivity', 'Store.config.visSensitivity = Number(e.target.value) / 100'],
    ['in-fx-intensity', 'Store.config.visFxIntensity = Number(e.target.value) / 100'],
    ['in-glow-amount', 'Store.config.visGlowAmount = Number(e.target.value) / 100'],
    ['in-fps', 'Engine.setFps(Utils.toInt(e.target.value, 30))'],
    ['in-bitrate', 'const bps = Utils.toInt(e.target.value, Store.config.videoBps)'],
    ['in-stream-save', 'Store.config.streamSave = !!e.target.checked'],
    ['in-bg-pause', 'Store.config.pauseOnBackground = !!e.target.checked']
  ]) {
    const listenerAt = bindBody.indexOf(`Dom['${id}']?.addEventListener`);
    const mutationAt = bindBody.indexOf(mutation, listenerAt);
    const guardAt = bindBody.indexOf('if (!this.canMutateProjectFromControl()) return;', listenerAt);
    assert.ok(listenerAt >= 0, `${id} listener should be present`);
    assert.ok(mutationAt > listenerAt, `${id} mutation should be present`);
    assert.ok(guardAt > listenerAt && guardAt < mutationAt, `${id} listener should guard before project mutation`);
  }

  for (const [id, mutation] of [
    ['in-logo-size', 'LayoutConfig.logoWidth = Utils.toInt'],
    ['in-logo-pos', 'LayoutConfig.logoBottomMargin = Utils.toInt'],
    ['in-sensitivity', 'Store.config.visSensitivity = Number(e.target.value) / 100'],
    ['in-fx-intensity', 'Store.config.visFxIntensity = Number(e.target.value) / 100'],
    ['in-glow-amount', 'Store.config.visGlowAmount = Number(e.target.value) / 100']
  ]) {
    const listenerAt = bindBody.indexOf(`Dom['${id}']?.addEventListener`);
    const mutationAt = bindBody.indexOf(mutation, listenerAt);
    const syncAt = bindBody.indexOf(`UI.syncRangeValueText('${id}')`, listenerAt);
    assert.ok(syncAt > listenerAt && syncAt < mutationAt, `${id} listener should sync aria-valuetext before state mutation`);
  }

  const fpsBody = script.match(/setFps\(fps, opts = \{\}\) \{([\s\S]*?)\n  \},\n\n  resetTimelineBase/)?.[1] || '';
  assert.ok(fpsBody, 'Engine.setFps body should be present');
  assert.ok(fpsBody.indexOf('const lockReason = ProjectPresets.projectMutationLockReason') < fpsBody.indexOf('Store.config.recordFps ='), 'Engine.setFps should guard before changing recordFps');
  assert.match(fpsBody, /allowLockedMutation: opts\.allowLockedMutation \|\| Store\.flags\.controlMutationOverrideDepth > 0/);
  assert.match(fpsBody, /if \(lockReason\) \{[\s\S]*?UI\.showError\(lockReason, 'WARN'\);[\s\S]*?return false/);
  assert.match(fpsBody, /return true/);
  assert.match(script, /const projectSettingsReason = packageLock[\s\S]*?: hardLock[\s\S]*?Locked while renderer is \$\{state\.toLowerCase\(\)\}/);
  assert.match(script, /const hardLock = packageLock \|\| restoreLock \|\| autosaveLock \|\| batchLock \|\| state === 'WARMING' \|\| state === 'RECORDING' \|\| state === 'EXPORTING'/);
  assert.doesNotMatch(script, /state === 'PREVIEWING' \|\| state === 'WARMING' \|\| state === 'RECORDING' \|\| state === 'EXPORTING'/);
});

test('direct brand preset failures do not leave a partial active preset mutation', () => {
  const brandBody = script.match(/applyPreset\(name\) \{([\s\S]*?)\n  \},\n\n  init/)?.[1] || '';
  assert.ok(brandBody, 'BrandPresets.applyPreset body should be present');
  const lockAt = brandBody.indexOf('const lockReason = this.brandPresetLockReason()');
  const importAt = brandBody.indexOf('ProjectPresets.importState(preset, { silent: true })');
  assert.ok(lockAt >= 0, 'brand preset direct command should use the same lock reason as disabled UI');
  assert.ok(importAt >= 0, 'brand preset should apply through the guarded project import');
  assert.ok(lockAt < importAt, 'brand preset lock reason should be checked before project import');
  assert.match(brandBody, /if \(lockReason\) \{[\s\S]*?UI\.showError\(lockReason, 'WARN'\);[\s\S]*?return false/);
  assert.equal(
    brandBody.slice(0, importAt).includes('Store.flags.activePreset = name'),
    false,
    'activePreset should not change before guarded import can throw'
  );
});

test('batch clear direct command honors the same busy locks as batch add', () => {
  const batchBody = script.match(/const BatchQueue = \{([\s\S]*?)\n\};\n\nconst AudioAnalysis/)?.[1] || '';
  assert.ok(batchBody, 'BatchQueue body should be present');
  const clearBody = batchBody.match(/clear\(\) \{([\s\S]*?)\n  \},\n\n  requestCancel/)?.[1] || '';
  assert.ok(clearBody, 'BatchQueue.clear body should be present');
  assert.ok(clearBody.indexOf('const lockReason = this.batchMutationLockReason()') < clearBody.indexOf('Store.batch.items = []'));
  assert.match(clearBody, /if \(lockReason\) \{[\s\S]*?UI\.showError\(lockReason, 'WARN'\);[\s\S]*?return/);
});

test('batch renderNext direct path honors package and restore locks before mutation', () => {
  const batchBody = script.match(/const BatchQueue = \{([\s\S]*?)\n\};\n\nconst AudioAnalysis/)?.[1] || '';
  assert.ok(batchBody, 'BatchQueue body should be present');
  const renderLockBody = batchBody.match(/batchRenderLockReason\(\) \{([\s\S]*?)\n  \},\n\n  async renderNext/)?.[1] || '';
  assert.ok(renderLockBody, 'BatchQueue.batchRenderLockReason body should be present');
  assert.match(renderLockBody, /if \(Store\.packageJob\.running\) return 'Package operation in progress\. Wait for it to finish before rendering batch item\.'/);
  assert.match(renderLockBody, /if \(Store\.restoreJob\.running\) return 'Project restore in progress\. Wait for it to finish before rendering batch item\.'/);
  assert.match(renderLockBody, /if \(Store\.autosaveJob\.running\) return 'Autosave in progress\. Wait for it to finish before rendering batch item\.'/);
  assert.match(renderLockBody, /if \(Machine\.status !== 'IDLE'\) return `Wait for \$\{Machine\.status\.toLowerCase\(\)\} to finish before loading batch audio\.`/);
  assert.doesNotMatch(renderLockBody, /Store\.batch\.running/, 'renderNext must allow the expected batch-running internal state');

  const renderNextBody = batchBody.match(/async renderNext\(index\) \{([\s\S]*?)\n  \},\n\n  async start/)?.[1] || '';
  assert.ok(renderNextBody, 'BatchQueue.renderNext body should be present');
  const lockAt = renderNextBody.indexOf('const lockReason = this.batchRenderLockReason()');
  const activeIndexAt = renderNextBody.indexOf('Store.batch.activeIndex = index');
  const loadingAt = renderNextBody.indexOf("item.status = 'loading'");
  const loadAt = renderNextBody.indexOf("await AssetManager.loadFile('audio', item.file");
  assert.ok(lockAt >= 0, 'renderNext should check the render lock');
  assert.ok(lockAt < activeIndexAt, 'renderNext lock should happen before activeIndex mutation');
  assert.ok(lockAt < loadingAt, 'renderNext lock should happen before item status mutation');
  assert.ok(lockAt < loadAt, 'renderNext lock should happen before locked asset load override');
  assert.match(renderNextBody, /if \(lockReason\) \{[\s\S]*?UI\.showError\(lockReason, 'WARN'\);[\s\S]*?throw new Error\(lockReason\)/);
});

test('batch audio add commands expose reasons and cannot mutate while locked', () => {
  assert.match(html, /id="btn-add-batch-audio"[^>]*aria-describedby="batch-summary"/);

  const batchBody = script.match(/const BatchQueue = \{([\s\S]*?)\n\};\n\nconst AudioAnalysis/)?.[1] || '';
  assert.ok(batchBody, 'BatchQueue body should be present');

  const lockReasonBody = batchBody.match(/batchMutationLockReason\(\) \{([\s\S]*?)\n  \},\n\n  addFiles/)?.[1] || '';
  assert.ok(lockReasonBody, 'BatchQueue.batchMutationLockReason body should be present');
  assert.match(lockReasonBody, /if \(Store\.autosaveJob\.running\) return 'Autosave in progress\. Wait for it to finish before changing the batch queue\.'/);
  assert.match(lockReasonBody, /if \(Store\.batch\.running\) return 'Batch render in progress\. Wait or cancel it before changing the batch queue\.'/);
  assert.match(lockReasonBody, /if \(Machine\.status !== 'IDLE'\) return `Wait for \$\{Machine\.status\.toLowerCase\(\)\} to finish before changing the batch queue\.`/);

  const addFilesBody = batchBody.match(/addFiles\(fileList\) \{([\s\S]*?)\n  \},\n\n  clear/)?.[1] || '';
  assert.ok(addFilesBody, 'BatchQueue.addFiles body should be present');
  assert.ok(addFilesBody.indexOf('const lockReason = this.batchMutationLockReason()') < addFilesBody.indexOf('Store.batch.items.push'), 'batch add lock should happen before queue mutation');
  assert.match(addFilesBody, /if \(lockReason\) \{[\s\S]*?UI\.showError\(lockReason, 'WARN'\);[\s\S]*?return/);

  const renderBody = batchBody.match(/render\(\) \{([\s\S]*?)\n  \},\n\n  init/)?.[1] || '';
  assert.ok(renderBody, 'BatchQueue.render body should be present');
  assert.match(renderBody, /const addReason = this\.batchMutationLockReason\(\)/);
  assert.match(renderBody, /UI\.setControlReason\(Dom\['btn-add-batch-audio'\], Dom\['btn-add-batch-audio'\]\.disabled, addReason, 'batch-summary'\)/);
  assert.match(renderBody, /Dom\['in-batch-audio'\]\.disabled = !!addReason/);

  const initBody = batchBody.match(/init\(\) \{([\s\S]*?)\n  \}/)?.[1] || '';
  assert.ok(initBody, 'BatchQueue.init body should be present');
  const lockChecks = [...initBody.matchAll(/const lockReason = this\.batchMutationLockReason\(\)/g)];
  assert.ok(lockChecks.length >= 2, 'batch add click and file-change paths should both re-check the mutation lock');
});

test('custom preset apply failures are surfaced as warnings instead of uncaught click errors', () => {
  const customBody = script.match(/applySelected\(\) \{([\s\S]*?)\n  \},\n\n  deleteSelected/)?.[1] || '';
  assert.ok(customBody, 'CustomPresets.applySelected body should be present');
  assert.doesNotMatch(customBody, /if \(Store\.restoreJob\.running\) throw/);
  assert.match(customBody, /const lockReason = this\.customPresetLockReason\('applying a custom preset'\)/);
  assert.match(customBody, /if \(lockReason\) \{[\s\S]*?UI\.showError\(lockReason, 'WARN'\);[\s\S]*?return false/);
  assert.match(customBody, /try \{[\s\S]*?ProjectPackage\.assertMutationGuard\(ProjectPackage\.captureMutationGuard\(\)\)[\s\S]*?ProjectPresets\.importState\(item\.state\)[\s\S]*?return true/);
  assert.match(customBody, /\} catch \(err\) \{[\s\S]*?UI\.showError\(`Custom preset apply failed: \$\{Utils\.safeErrMsg\(err\)\}`, 'WARN'\);[\s\S]*?return false/);

  const initBody = script.match(/const CustomPresets = \{[\s\S]*?init\(\) \{([\s\S]*?)\n  \}\n\};\n\nconst BatchQueue/)?.[1] || '';
  assert.ok(initBody, 'CustomPresets.init body should be present');
  assert.match(initBody, /Dom\['btn-apply-custom-preset'\]\?\.addEventListener\('click', \(\) => this\.applySelected\(\)\)/);
});

test('custom preset delete storage failures are surfaced as warnings instead of uncaught click errors', () => {
  const deleteBody = script.match(/deleteSelected\(\) \{([\s\S]*?)\n  \},\n\n  updateControls/)?.[1] || '';
  assert.ok(deleteBody, 'CustomPresets.deleteSelected body should be present');
  assert.match(deleteBody, /try \{[\s\S]*?this\.saveAll\(this\.load\(\)\.filter\(\(item\) => item\.id !== id\)\)[\s\S]*?this\.renderList\(\)[\s\S]*?return true/);
  assert.match(deleteBody, /\} catch \(err\) \{[\s\S]*?UI\.showError\(`Custom preset delete failed: \$\{Utils\.safeErrMsg\(err\)\}`, 'WARN'\);[\s\S]*?return false/);

  const initBody = script.match(/const CustomPresets = \{[\s\S]*?init\(\) \{([\s\S]*?)\n  \}\n\};\n\nconst BatchQueue/)?.[1] || '';
  assert.ok(initBody, 'CustomPresets.init body should be present');
  assert.match(initBody, /Dom\['btn-delete-custom-preset'\]\?\.addEventListener\('click', \(\) => this\.deleteSelected\(\)\)/);
});

test('custom preset commands share busy guards and visible disabled reasons', () => {
  const customBody = script.match(/const CustomPresets = \{([\s\S]*?)\n\};\n\nconst BatchQueue/)?.[1] || '';
  assert.ok(customBody, 'CustomPresets body should be present');

  const lockBody = customBody.match(/customPresetLockReason\(action = 'changing custom presets'\) \{([\s\S]*?)\n  \},\n\n  saveCurrent/)?.[1] || '';
  assert.ok(lockBody, 'CustomPresets.customPresetLockReason body should be present');
  assert.match(lockBody, /if \(Store\.packageJob\.running\) return `Package operation in progress\. Wait for it to finish before \$\{action\}\.`/);
  assert.match(lockBody, /if \(Store\.restoreJob\.running\) return `Project restore in progress\. Wait for it to finish before \$\{action\}\.`/);
  assert.match(lockBody, /if \(Store\.autosaveJob\.running\) return `Autosave in progress\. Wait for it to finish before \$\{action\}\.`/);
  assert.match(lockBody, /if \(Store\.batch\.running\) return `Batch render in progress\. Wait or cancel it before \$\{action\}\.`/);
  assert.match(lockBody, /if \(Machine\.status !== 'IDLE'\) return `Wait for \$\{Machine\.status\.toLowerCase\(\)\} to finish before \$\{action\}\.`/);

  const saveBody = customBody.match(/saveCurrent\(\) \{([\s\S]*?)\n  \},\n\n  selected/)?.[1] || '';
  assert.ok(saveBody, 'CustomPresets.saveCurrent body should be present');
  assert.ok(saveBody.indexOf("const lockReason = this.customPresetLockReason('saving a custom preset')") < saveBody.indexOf('const name ='));
  assert.match(saveBody, /if \(lockReason\) \{[\s\S]*?UI\.showError\(lockReason, 'WARN'\);[\s\S]*?return false/);

  const applyBody = customBody.match(/applySelected\(\) \{([\s\S]*?)\n  \},\n\n  deleteSelected/)?.[1] || '';
  assert.ok(applyBody, 'CustomPresets.applySelected body should be present');
  assert.ok(applyBody.indexOf("const lockReason = this.customPresetLockReason('applying a custom preset')") < applyBody.indexOf('ProjectPackage.assertMutationGuard'));
  assert.match(applyBody, /if \(lockReason\) \{[\s\S]*?UI\.showError\(lockReason, 'WARN'\);[\s\S]*?return false/);

  const deleteBody = customBody.match(/deleteSelected\(\) \{([\s\S]*?)\n  \},\n\n  updateControls/)?.[1] || '';
  assert.ok(deleteBody, 'CustomPresets.deleteSelected body should be present');
  assert.ok(deleteBody.indexOf("const lockReason = this.customPresetLockReason('deleting a custom preset')") < deleteBody.indexOf("const id = Dom['custom-preset-list']?.value"));
  assert.match(deleteBody, /if \(lockReason\) \{[\s\S]*?UI\.showError\(lockReason, 'WARN'\);[\s\S]*?return false/);

  const controlsBody = customBody.match(/updateControls\(\) \{([\s\S]*?)\n  \},\n\n  renderList/)?.[1] || '';
  assert.ok(controlsBody, 'CustomPresets.updateControls body should be present');
  assert.match(controlsBody, /const lockReason = this\.customPresetLockReason\(\)/);
  assert.match(controlsBody, /UI\.setControlReason\(Dom\['btn-save-custom-preset'\], !!lockReason, lockReason, 'custom-preset-summary'\)/);
  assert.match(controlsBody, /UI\.setControlReason\(Dom\['btn-apply-custom-preset'\], !item \|\| !!lockReason, applyReason, 'custom-preset-summary'\)/);
  assert.match(controlsBody, /UI\.setControlReason\(Dom\['custom-preset-list'\], !!lockReason, lockReason, 'custom-preset-summary'\)/);
  assert.match(controlsBody, /UI\.setControlReason\(Dom\['btn-delete-custom-preset'\], !item \|\| !!lockReason, deleteReason, 'custom-preset-summary'\)/);
});

test('autosave restores expose a project restore lock across UI and file inputs', () => {
  assert.match(script, /restoreJob:\s*\{ running: false, label: '', token: 0 \}/);

  const updateStateBody = script.match(/updateState\(state, opts = \{\}\) \{([\s\S]*?)\n  \},\n  moveFocusForState/)?.[1] || '';
  assert.ok(updateStateBody, 'UI.updateState body should be present');
  assert.match(updateStateBody, /const restoreLock = Store\.restoreJob\.running/);
  assert.match(updateStateBody, /const autosaveLock = Store\.autosaveJob\.running/);
  assert.match(updateStateBody, /const hardLock = packageLock \|\| restoreLock \|\| autosaveLock \|\| batchLock/);
  assert.match(updateStateBody, /Dom\[id\]\.disabled = packageLock \|\| restoreLock \|\| autosaveLock \|\| batchLock \|\| state !== 'IDLE'/);
  assert.match(updateStateBody, /if \(!opts\.silent && msgs\[state\]\) this\.log/);

  const bindFileBody = script.match(/bindFile\(inputId, type\) \{([\s\S]*?)\n  \}\n\};\n\nconst ProjectPresets/)?.[1] || '';
  assert.ok(bindFileBody, 'AssetManager.bindFile body should be present');
  assert.match(bindFileBody, /this\.mutationLockReason\(\)/);
  assert.match(script, /Project restore in progress\. Wait for it to finish before changing assets\./);

  const autoSaveBody = script.match(/const AutoSave = \{([\s\S]*?)\n\};\n\nconst CustomPresets/)?.[1] || '';
  assert.ok(autoSaveBody, 'AutoSave body should be present');
  assert.match(autoSaveBody, /autosaveLockReason\(action = 'using autosave'\)/);
  const lockReasonBody = autoSaveBody.match(/autosaveLockReason\(action = 'using autosave'\) \{([\s\S]*?)\n  \},\n\n  isSafeToSave/)?.[1] || '';
  assert.ok(lockReasonBody, 'AutoSave.autosaveLockReason body should be present');
  assert.match(lockReasonBody, /if \(Store\.audioAnalysis\.status === 'analyzing'\) return `Audio analysis in progress\. Wait or cancel it before \$\{action\}\.`/);
  assert.match(autoSaveBody, /captureRestoreGuard\(message = 'Project restore in progress'\)/);
  assert.match(autoSaveBody, /assertRestoreGuard\(token, message = 'Project restore in progress'\)/);
  assert.match(autoSaveBody, /withRestoreLock\(label, task\)/);
  assert.match(autoSaveBody, /const token = Store\.restoreJob\.token \+ 1/);
  assert.match(autoSaveBody, /Store\.restoreJob = \{ running: true, label: label \|\| 'SNAPSHOT RESTORING', token \}/);
  assert.match(autoSaveBody, /UI\.updateState\(Machine\.status, \{ silent: true \}\)/);
  assert.match(autoSaveBody, /Store\.restoreJob = \{ running: false, label: '', token \}/);
  const restoreLatestBody = autoSaveBody.match(/async restoreLatest\(\) \{([\s\S]*?)\n  \},\n\n  async restoreSnapshot/)?.[1] || '';
  assert.ok(restoreLatestBody, 'AutoSave.restoreLatest body should be present');
  const lockAt = restoreLatestBody.indexOf("const lockReason = this.autosaveLockReason('restoring autosave')");
  const restoreAt = restoreLatestBody.indexOf("return this.withRestoreLock('SNAPSHOT RESTORING'");
  assert.ok(lockAt >= 0 && restoreAt > lockAt, 'restoreLatest should reject autosave lock reasons before starting restore lock');
  assert.match(restoreLatestBody, /if \(lockReason\) \{[\s\S]*?UI\.showError\(lockReason, 'WARN'\);[\s\S]*?this\.updateControls\(\);[\s\S]*?return false/);
  const restoreSnapshotBody = autoSaveBody.match(/async restoreSnapshot\(id\) \{([\s\S]*?)\n  \},\n\n  async resolveAssetFile/)?.[1] || '';
  assert.ok(restoreSnapshotBody, 'AutoSave.restoreSnapshot body should be present');
  const snapshotLockAt = restoreSnapshotBody.indexOf("const lockReason = this.autosaveLockReason('restoring autosave')");
  const snapshotRestoreAt = restoreSnapshotBody.indexOf("return this.withRestoreLock('SNAPSHOT RESTORING'");
  assert.ok(snapshotLockAt >= 0 && snapshotRestoreAt > snapshotLockAt, 'restoreSnapshot should reject autosave lock reasons before starting restore lock');

  const applySnapshotBody = autoSaveApplySnapshotBody();
  assert.match(applySnapshotBody, /const restored = await AssetManager\.loadFile\(type, prepared\[type\], \{ noAutosave: true, allowLockedMutation: true \}\)/);
  assert.match(applySnapshotBody, /if \(restored == null\) throw new Error\(`\$\{type\} restore was interrupted by a new asset selection`\)/);
});

test('asset file input guard matches preview and render machine locks', () => {
  const updateStateBody = script.match(/updateState\(state, opts = \{\}\) \{([\s\S]*?)\n  \},\n  moveFocusForState/)?.[1] || '';
  assert.ok(updateStateBody, 'UI.updateState body should be present');
  assert.match(updateStateBody, /const hardLock = packageLock \|\| restoreLock \|\| autosaveLock \|\| batchLock \|\| state === 'WARMING' \|\| state === 'RECORDING' \|\| state === 'EXPORTING'/);
  assert.match(updateStateBody, /const previewFileLock = packageLock \|\| restoreLock \|\| autosaveLock \|\| batchLock \|\| state === 'PREVIEWING'/);
  assert.match(updateStateBody, /Dom\[id\]\.disabled = hardLock \|\| previewFileLock/);

  const assetBody = script.match(/const AssetManager = \{([\s\S]*?)\n\};\n\nconst ProjectPresets/)?.[1] || '';
  assert.ok(assetBody, 'AssetManager body should be present');
  const lockReasonBody = assetBody.match(/mutationLockReason\(opts = \{\}\) \{([\s\S]*?)\n  \},\n  assetInputSummary/)?.[1] || '';
  assert.ok(lockReasonBody, 'AssetManager.mutationLockReason body should be present');
  assert.match(lockReasonBody, /if \(Machine\.status !== 'IDLE'\) return `Wait for \$\{Machine\.status\.toLowerCase\(\)\} to finish before changing assets\.`/);

  const bindFileBody = assetBody.match(/bindFile\(inputId, type\) \{([\s\S]*?)\n  \}/)?.[1] || '';
  assert.ok(bindFileBody, 'AssetManager.bindFile body should be present');
  assert.ok(bindFileBody.indexOf('const lockReason = this.mutationLockReason()') < bindFileBody.indexOf('this.loadFile(type, e.target.files?.[0], { input })'));
});

test('file picker controls expose stable disabled reasons on visible and hidden targets', () => {
  assert.match(html, /id="asset-input-summary"/);
  for (const type of ['cover', 'video', 'audio', 'logo']) {
    assert.match(html, new RegExp(`id="lbl-${type}"[^>]*aria-describedby="asset-input-summary"`), `lbl-${type} should expose the shared asset reason`);
    assert.match(html, new RegExp(`id="in-${type}"[^>]*aria-describedby="lbl-${type} asset-input-summary"`), `in-${type} should expose its visible file state and the shared asset reason`);
  }
  assert.match(html, /id="in-package-file"[^>]*aria-describedby="package-summary"/);
  assert.match(html, /id="in-batch-audio"[^>]*aria-describedby="batch-summary"/);

  const ids = domMapIds();
  for (const id of ['lbl-cover', 'lbl-video', 'lbl-audio', 'lbl-logo', 'asset-input-summary']) {
    assert.ok(ids.has(id), `${id} should be in Dom lookup map`);
  }

  const updateStateBody = script.match(/updateState\(state, opts = \{\}\) \{([\s\S]*?)\n  \},\n  moveFocusForState/)?.[1] || '';
  assert.ok(updateStateBody, 'UI.updateState body should be present');
  assert.match(updateStateBody, /AssetManager\.updateControls\(\)/);

  const assetBody = script.match(/const AssetManager = \{([\s\S]*?)\n\};\n\nconst ProjectPresets/)?.[1] || '';
  assert.ok(assetBody, 'AssetManager body should be present');
  const summaryBody = assetBody.match(/assetInputSummary\(\) \{([\s\S]*?)\n  \},\n  updateControls/)?.[1] || '';
  assert.ok(summaryBody, 'AssetManager.assetInputSummary body should be present');
  assert.match(summaryBody, /Store\.assetErrors\[type\]/);
  assert.match(summaryBody, /ASSET ISSUE:/);
  assert.match(summaryBody, /ASSETS LOADING:/);
  assert.match(summaryBody, /ASSETS READY:/);
  assert.match(summaryBody, /素材未齐：已载入/);
  assert.match(summaryBody, /等待素材：请先选择背景图、中心视觉、主音频和透明 Logo \/ ASSETS WAITING/);

  const controlsBody = assetBody.match(/updateControls\(\) \{([\s\S]*?)\n  \},\n  bindFile/)?.[1] || '';
  assert.ok(controlsBody, 'AssetManager.updateControls body should be present');
  assert.match(controlsBody, /const reason = this\.mutationLockReason\(\)/);
  assert.match(controlsBody, /Dom\['asset-input-summary'\]\.textContent = reason \|\| this\.assetInputSummary\(\)/);
  assert.ok(controlsBody.includes("UI.setControlReason(Dom[`in-${type}`], !!reason, reason, this.assetDescriptionIds(type))"));
  assert.ok(controlsBody.includes("UI.setControlReason(Dom[`lbl-${type}`], !!reason, reason, 'asset-input-summary')"));

  const loadFileBody = assetBody.match(/loadFile\(type, file, opts = \{\}\) \{([\s\S]*?)\n  \},\n  mutationLockReason/)?.[1] || '';
  assert.ok(loadFileBody, 'AssetManager.loadFile body should be present');
  const pendingStateIndex = loadFileBody.indexOf('Store.rawFiles[type] = file;');
  const pendingReadyIndex = loadFileBody.indexOf('Engine.checkReady();', pendingStateIndex);
  assert.ok(
    pendingStateIndex < pendingReadyIndex,
    'pending asset state should be written before readiness is refreshed'
  );
  assert.ok(
    pendingReadyIndex < loadFileBody.indexOf('let settled = false;'),
    'pending asset loads should refresh readiness before waiting for decode callbacks'
  );
  assert.match(loadFileBody, /const loadingLabel = \{ cover: 'cover', video: 'center visual', audio: 'audio', logo: 'logo' \}\[type\] \|\| type/);
  assert.match(loadFileBody, /UI\.log\(`Loading \$\{loadingLabel\}: \$\{\(file\.name \|\| type\)\.substring\(0, 48\)\}\.\.\.`, 'warn'\)/);

  const checkReadyBody = script.match(/checkReady\(\) \{([\s\S]*?)\n  \},\n\n  setupPerformanceObserver/)?.[1] || '';
  assert.ok(checkReadyBody, 'Engine.checkReady body should be present');
  assert.ok(
    checkReadyBody.indexOf('Preflight.updatePreflight()') < checkReadyBody.indexOf('AssetManager.updateControls()'),
    'Engine.checkReady should refresh asset input summary after preflight state changes'
  );

  const packageControlsBody = script.match(/updateControls\(\) \{([\s\S]*?)\n  \},\n\n  async exportPackageBlob/)?.[1] || '';
  assert.ok(packageControlsBody, 'ProjectPackage.updateControls body should be present');
  assert.match(packageControlsBody, /UI\.setControlReason\(Dom\['in-package-file'\], Dom\['in-package-file'\]\.disabled, loadReason, 'package-summary'\)/);

  const batchBody = script.match(/const BatchQueue = \{([\s\S]*?)\n\};\n\nconst AudioAnalysis/)?.[1] || '';
  assert.ok(batchBody, 'BatchQueue body should be present');
  const batchRenderBody = batchBody.match(/render\(\) \{([\s\S]*?)\n  \},\n\n  init/)?.[1] || '';
  assert.ok(batchRenderBody, 'BatchQueue.render body should be present');
  assert.match(batchRenderBody, /UI\.setControlReason\(Dom\['in-batch-audio'\], Dom\['in-batch-audio'\]\.disabled, addReason, 'batch-summary'\)/);
});

test('asset mutators enforce direct busy locks with explicit internal overrides', () => {
  const assetBody = script.match(/const AssetManager = \{([\s\S]*?)\n\};\n\nconst ProjectPresets/)?.[1] || '';
  assert.ok(assetBody, 'AssetManager body should be present');
  const lockReasonBody = assetBody.match(/mutationLockReason\(opts = \{\}\) \{([\s\S]*?)\n  \},\n  assetInputSummary/)?.[1] || '';
  assert.ok(lockReasonBody, 'AssetManager.mutationLockReason body should be present');
  assert.match(lockReasonBody, /if \(opts\.allowLockedMutation\) return ''/);

  const clearBody = assetBody.match(/clearAsset\(type, opts = \{\}\) \{([\s\S]*?)\n  \},\n  noteProjectEdited/)?.[1] || '';
  assert.ok(clearBody, 'AssetManager.clearAsset body should be present');
  assert.ok(clearBody.indexOf('const lockReason = this.mutationLockReason(opts)') < clearBody.indexOf('this.nextLoadToken(type)'));
  assert.match(clearBody, /if \(lockReason\) \{[\s\S]*?UI\.showError\(lockReason, 'WARN'\);[\s\S]*?return false/);

  const loadFileBody = assetBody.match(/loadFile\(type, file, opts = \{\}\) \{([\s\S]*?)\n  \},\n  mutationLockReason/)?.[1] || '';
  assert.ok(loadFileBody, 'AssetManager.loadFile body should be present');
  assert.ok(loadFileBody.indexOf('const lockReason = this.mutationLockReason(opts)') < loadFileBody.indexOf('return new Promise'));
  assert.match(loadFileBody, /if \(lockReason\) \{[\s\S]*?UI\.showError\(lockReason, 'WARN'\);[\s\S]*?return Promise\.resolve\(null\)/);

  const restoreRuntime = restoreRuntimeBody();
  assert.match(restoreRuntime, /AssetManager\.loadFile\(type, file, \{ noAutosave: true, allowLockedMutation: true \}\)/);
  assert.match(restoreRuntime, /AssetManager\.clearAsset\(type, \{ allowLockedMutation: true \}\)/);

  const packageBody = script.match(/async importPackageFile\(file\) \{([\s\S]*?)\n  \},\n\n  init\(\)/)?.[1] || '';
  assert.ok(packageBody, 'ProjectPackage.importPackageFile body should be present');
  assert.match(packageBody, /allowLockedMutation: true,[\s\S]*?cancelCheck: \(\) => this\.throwIfPackageJobStopped\(token\)/);
  assert.match(packageBody, /AssetManager\.clearAsset\(type, \{ allowLockedMutation: true \}\)/);

  const snapshotBody = autoSaveApplySnapshotBody();
  assert.match(snapshotBody, /AssetManager\.loadFile\(type, prepared\[type\], \{ noAutosave: true, allowLockedMutation: true \}\)/);
  assert.match(snapshotBody, /AssetManager\.clearAsset\(type, \{ allowLockedMutation: true \}\)/);

  const batchBody = script.match(/const BatchQueue = \{([\s\S]*?)\n\};\n\nconst AudioAnalysis/)?.[1] || '';
  assert.ok(batchBody, 'BatchQueue body should be present');
  assert.match(batchBody, /AssetManager\.loadFile\('audio', snapshot\.rawAudio, \{ noAutosave: true, allowLockedMutation: true \}\)/);
  assert.match(batchBody, /AssetManager\.clearAsset\('audio', \{ allowLockedMutation: true \}\)/);
  assert.match(batchBody, /AssetManager\.loadFile\('audio', item\.file, \{[\s\S]*?noAutosave: true,[\s\S]*?allowLockedMutation: true,[\s\S]*?cancelCheck: \(\) => this\.throwIfBatchCancelled\(\)[\s\S]*?\}\)/);
});

test('autosave falls back to state-only snapshots after real asset write failures', () => {
  assert.match(script, /stateOnlyPlan\(records, reason\)/);
  assert.match(script, /isQuotaLikeStorageError\(err\)/);
  const saveSnapshotBody = script.match(/async saveSnapshot\(source = 'autosave', opts = \{\}\) \{([\s\S]*?)\n  \},\n\n  async trimRecent/)?.[1] || '';
  assert.ok(saveSnapshotBody, 'AutoSave.saveSnapshot body should be present');
  assert.match(saveSnapshotBody, /try \{[\s\S]*?await this\.storeCurrentAssets\(plan\.records\)[\s\S]*?\} catch \(err\) \{/);
  assert.match(saveSnapshotBody, /if \(this\.isQuotaLikeStorageError\(err\)\) \{/);
  assert.match(saveSnapshotBody, /const recovered = await this\.reclaimAutosaveStorageBeforeFallback\(\)/);
  assert.match(saveSnapshotBody, /retriedAfterCleanup = true/);
  assert.match(saveSnapshotBody, /assetRefs = await this\.storeCurrentAssets\(plan\.records\)/);
  assert.match(saveSnapshotBody, /const prefix = retriedAfterCleanup \? 'Asset autosave failed after cleanup' : 'Asset autosave failed'/);
  assert.match(saveSnapshotBody, /this\.stateOnlyPlan\(plan\.records, `\$\{prefix\}: \$\{Utils\.safeErrMsg\(failure\)\}`\)/);
  assert.match(saveSnapshotBody, /Logger\.warn\(`Autosave asset persistence failed; saving state only:/);
  assert.match(saveSnapshotBody, /ASSETS NOT INCLUDED/);
});

test('autosave asset records are snapshot-scoped and staged blobs are cleaned after snapshot failures', () => {
  const autoSaveBody = script.match(/const AutoSave = \{([\s\S]*?)\n\};\n\nconst RenderReport/)?.[1] || '';
  assert.ok(autoSaveBody, 'AutoSave body should be present');
  assert.match(autoSaveBody, /snapshotAssetScope\(capturedAt = Date\.now\(\), generation = this\.saveGeneration\)/);
  assert.match(autoSaveBody, /globalThis\.crypto\?\.randomUUID\?\.\(\)/);

  const assetKeyBody = autoSaveBody.match(/assetKey\(type, file, scope = ''\) \{([\s\S]*?)\n  \},\n\n  currentAssetRecords/)?.[1] || '';
  assert.ok(assetKeyBody, 'AutoSave.assetKey body should be present');
  assert.match(assetKeyBody, /const metadataKey = \[/);
  assert.match(assetKeyBody, /return scope \? `\$\{scope\}:\$\{metadataKey\}` : metadataKey/);

  const currentRecordsBody = autoSaveBody.match(/currentAssetRecords\(scope = ''\) \{([\s\S]*?)\n  \},\n\n  assetBytes/)?.[1] || '';
  assert.ok(currentRecordsBody, 'AutoSave.currentAssetRecords body should be present');
  assert.match(currentRecordsBody, /id: this\.assetKey\(type, file, scope\)/);

  const cleanupBody = autoSaveBody.match(/async cleanupStagedAssets\(assetIds = \[\]\) \{([\s\S]*?)\n  \},\n\n  snapshot/)?.[1] || '';
  assert.ok(cleanupBody, 'AutoSave.cleanupStagedAssets body should be present');
  assert.match(cleanupBody, /const keep = await this\.referencedAssetIds\(\)/);
  assert.match(cleanupBody, /const remove = ids\.filter\(\(id\) => !keep\.has\(id\)\)/);
  assert.match(cleanupBody, /store\.delete\(id\)/);
  assert.match(cleanupBody, /this\.storedAssetKeys\.delete\(id\)/);

  const saveSnapshotBody = script.match(/async saveSnapshot\(source = 'autosave', opts = \{\}\) \{([\s\S]*?)\n  \},\n\n  async trimRecent/)?.[1] || '';
  assert.ok(saveSnapshotBody, 'AutoSave.saveSnapshot body should be present');
  assert.match(saveSnapshotBody, /const assetScope = this\.snapshotAssetScope\(capturedAt, generation\)/);
  assert.match(saveSnapshotBody, /const records = this\.currentAssetRecords\(assetScope\)/);
  assert.match(saveSnapshotBody, /let stagedAssetIds = \[\]/);
  assert.match(saveSnapshotBody, /stagedAssetIds = plan\.records\.map\(\(record\) => record\.id\)\.filter\(Boolean\)/);
  assert.match(saveSnapshotBody, /await this\.cleanupStagedAssets\(stagedAssetIds\)/);
  assert.ok(saveSnapshotBody.indexOf('await this.storeCurrentAssets(plan.records)') < saveSnapshotBody.indexOf('await this.cleanupStagedAssets(stagedAssetIds)'));
});

test('autosave latest uses generation and restore guards so older saves cannot overwrite newer state', () => {
  assert.match(script, /saveGeneration:\s*0/);
  assert.match(script, /projectRevision:\s*0/);
  const autoSaveBody = script.match(/const AutoSave = \{([\s\S]*?)\n\};\n\nconst RenderReport/)?.[1] || '';
  assert.ok(autoSaveBody, 'AutoSave body should be present');
  assert.match(autoSaveBody, /saveStillCurrent\(generation, restoreToken, projectRevision\)/);
  assert.match(autoSaveBody, /generation === this\.saveGeneration && projectRevision === this\.projectRevision && !Store\.restoreJob\.running && Store\.restoreJob\.token === restoreToken/);
  assert.match(autoSaveBody, /shouldContinueSave\(generation, restoreToken, projectRevision\)/);
  const restoreLockBody = autoSaveBody.match(/async withRestoreLock\(label, task\) \{([\s\S]*?)\n  \},\n\n  setControlsAvailable/)?.[1] || '';
  assert.ok(restoreLockBody, 'AutoSave.withRestoreLock body should be present');
  assert.match(restoreLockBody, /this\.saveGeneration \+= 1/);
  assert.match(autoSaveBody, /noteProjectRevision\(reason = 'Project changed'\) \{[\s\S]*?this\.projectRevision \+= 1/);

  const saveSnapshotBody = script.match(/async saveSnapshot\(source = 'autosave', opts = \{\}\) \{([\s\S]*?)\n  \},\n\n  async trimRecent/)?.[1] || '';
  assert.ok(saveSnapshotBody, 'AutoSave.saveSnapshot body should be present');
  assert.match(saveSnapshotBody, /const generation = \+\+this\.saveGeneration/);
  assert.match(saveSnapshotBody, /const restoreToken = this\.captureRestoreGuard/);
  assert.match(saveSnapshotBody, /const projectRevision = this\.projectRevision/);
  assert.match(saveSnapshotBody, /const capturedAt = Date\.now\(\)/);
  assert.match(saveSnapshotBody, /const assetScope = this\.snapshotAssetScope\(capturedAt, generation\)/);
  assert.match(saveSnapshotBody, /const isLatestGeneration = \(\) => this\.saveStillCurrent\(generation, restoreToken, projectRevision\)/);
  assert.match(saveSnapshotBody, /const records = this\.currentAssetRecords\(assetScope\)/);
  assert.match(saveSnapshotBody, /if \(!this\.shouldContinueSave\(generation, restoreToken, projectRevision\)\) return/);
  assert.match(saveSnapshotBody, /this\.snapshot\(this\.latestKey, source, assetRefs, recordsLength, plan\.reason, state, capturedAt, plan\.assetsStored\)/);
  assert.match(saveSnapshotBody, /recent-\$\{capturedAt\}-\$\{generation\}/);
  assert.match(saveSnapshotBody, /latestWritten = await this\.putSnapshotRecords\(snap, recent, isLatestGeneration, \{ saveLatest \}\)/);
  assert.ok(saveSnapshotBody.lastIndexOf('if (!this.shouldContinueSave(generation, restoreToken, projectRevision))') < saveSnapshotBody.indexOf('await this.trimAssets()'));
  assert.doesNotMatch(saveSnapshotBody, /^\s*store\.put\(snap\);\s*store\.put\(recent\);/m);
});

test('autosave latest write is guarded against cross-tab stale IndexedDB overwrites', () => {
  assert.match(script, /putSnapshotRecords\(snap, recent, isLatestGeneration/);
  const putBody = script.match(/putSnapshotRecords\(snap, recent, isLatestGeneration, opts = \{\}\) \{([\s\S]*?)\n  \},\n\n  async saveSnapshot/)?.[1] || '';
  assert.ok(putBody, 'AutoSave.putSnapshotRecords body should be present');
  const saveSnapshotBody = script.match(/async saveSnapshot\(source = 'autosave', opts = \{\}\) \{([\s\S]*?)\n  \},\n\n  async trimRecent/)?.[1] || '';
  assert.ok(saveSnapshotBody, 'AutoSave.saveSnapshot body should be present');
  assert.match(putBody, /const saveLatest = opts\.saveLatest !== false/);
  assert.match(putBody, /if \(!saveLatest\) \{[\s\S]*?store\.put\(recent\);[\s\S]*?return;/);
  assert.match(putBody, /const latestReq = store\.get\(this\.latestKey\)/);
  assert.match(putBody, /const current = latestReq\.result/);
  assert.match(putBody, /const currentTime = Number\(current\?\.updatedAt\) \|\| 0/);
  assert.match(putBody, /const nextTime = Number\(snap\.updatedAt\) \|\| 0/);
  assert.match(putBody, /const shouldWriteLatest = isLatestGeneration\(\) && \(!current \|\| currentTime <= nextTime\)/);
  assert.match(putBody, /if \(shouldWriteLatest\) \{[\s\S]*?store\.put\(snap\)/);
  assert.match(putBody, /store\.put\(recent\)/);
  assert.match(saveSnapshotBody, /latestWritten = await this\.putSnapshotRecords\(snap, recent, isLatestGeneration, \{ saveLatest \}\)/);
  assert.match(saveSnapshotBody, /if \(saveLatest && !latestWritten\) \{/);
});

test('autosave saveSnapshot returns structured saved skipped and stale results', () => {
  const autoSaveBody = script.match(/const AutoSave = \{([\s\S]*?)\n\};\n\nconst RenderReport/)?.[1] || '';
  assert.ok(autoSaveBody, 'AutoSave body should be present');
  assert.match(autoSaveBody, /snapshotResult\(ok, status, source, details = \{\}\)/);
  assert.match(autoSaveBody, /snapshotSkipResult\(source, reason, status = 'skipped'\)/);
  assert.match(autoSaveBody, /snapshotSavedResult\(source, snap, recent, plan\)/);
  assert.match(autoSaveBody, /warnManualSnapshotSkip\(result\)/);

  const initBody = autoSaveBody.match(/init\(\) \{([\s\S]*?)\n  \},\n\n  openDb/)?.[1] || '';
  assert.ok(initBody, 'AutoSave.init body should be present');
  assert.match(initBody, /this\.saveSnapshot\('manual'\)\.then\(\(result\) => this\.warnManualSnapshotSkip\(result\)\)/);

  const saveSnapshotBody = script.match(/async saveSnapshot\(source = 'autosave', opts = \{\}\) \{([\s\S]*?)\n  \},\n\n  async trimRecent/)?.[1] || '';
  assert.ok(saveSnapshotBody, 'AutoSave.saveSnapshot body should be present');
  assert.match(saveSnapshotBody, /const skipReason = !this\.hasIndexedDb\(\) \? 'Autosave unavailable' : this\.autosaveLockReason\('saving autosave'\)/);
  assert.match(saveSnapshotBody, /return this\.snapshotSkipResult\(source, skipReason \|\| 'Autosave unavailable'\)/);
  assert.match(saveSnapshotBody, /return this\.snapshotSkipResult\(source, 'Autosave skipped because project changed, restored, or a newer snapshot started', 'stale'\)/);
  assert.match(saveSnapshotBody, /return this\.snapshotSkipResult\(source, 'Autosave latest was not updated because a newer snapshot or project restore won the race', 'stale'\)/);
  assert.match(saveSnapshotBody, /return this\.snapshotSavedResult\(source, snap, recent, plan\)/);
  assert.doesNotMatch(saveSnapshotBody, /return;\s*(?:\n|$)/, 'saveSnapshot should not expose ambiguous bare returns');

  const facadeBody = script.match(/window\.AutoSave = Object\.freeze\(\{([\s\S]*?)\n\}\);/)?.[1] || '';
  assert.ok(facadeBody, 'public AutoSave facade should be present');
  assert.match(facadeBody, /get status\(\)/);
  assert.match(facadeBody, /safeToSave: AutoSave\.isSafeToSave\(\)/);
  assert.doesNotMatch(facadeBody, /saveSnapshot\(/);
  assert.doesNotMatch(facadeBody, /restoreLatest\(/);
  assert.doesNotMatch(facadeBody, /refreshRecent\(/);
});

test('stored audio analysis is restored only when it matches loaded audio evidence', () => {
  const analysisBody = script.match(/analysisMatchesAudio\(analysis, file, ref\) \{([\s\S]*?)\n  \},\n\n  restoreAudioAnalysisForSnapshot/)?.[1] || '';
  assert.ok(analysisBody, 'AutoSave.analysisMatchesAudio body should be present');
  assert.match(analysisBody, /const nameMatches =/);
  assert.match(analysisBody, /const sizeKnown =/);
  assert.match(analysisBody, /const lastModifiedKnown =/);
  assert.match(analysisBody, /const durationKnown =/);
  assert.match(analysisBody, /if \(sourceName && names\.length && !nameMatches\) return false/);
  assert.match(analysisBody, /if \(sizeKnown && !sizeMatches\) return false/);
  assert.match(analysisBody, /if \(lastModifiedKnown && !lastModifiedMatches\) return false/);
  assert.match(analysisBody, /if \(!durationKnown \|\| !durationMatches\) return false/);
  assert.match(analysisBody, /return evidence >= 2/);

  const importBody = script.match(/async importPackageFile\(file\) \{([\s\S]*?)\n  \},\n\n  init\(\)/)?.[1] || '';
  assert.ok(importBody, 'ProjectPackage.importPackageFile body should be present');
  assert.match(importBody, /lastModified: meta\.lastModified \|\| Date\.now\(\)/);
  assert.match(importBody, /ProjectPresets\.importState\(project, \{ silent: true, noAutosave: true, skipAudioAnalysis: true, allowLockedMutation: true \}\)/);
  assert.match(importBody, /AutoSave\.restoreAudioAnalysisForSnapshot\(\{ state: project, assets: project\.packageAssets \|\| \{\} \}, prepared\)/);
  assert.doesNotMatch(importBody, /Store\.audioAnalysis = AudioAnalysis\.normalizeStoredAnalysis\(project\.audioAnalysis\)/);
});

test('corrupt custom preset JSON is preserved instead of silently overwritten', () => {
  assert.match(script, /corruptBackupKey\(stamp = Date\.now\(\)\)/);
  assert.match(script, /lastLoadCorrupt:\s*false/);
  const markCorruptBody = script.match(/markCorrupt\(raw, reason\) \{([\s\S]*?)\n  \},\n\n  load/)?.[1] || '';
  assert.ok(markCorruptBody, 'CustomPresets.markCorrupt body should be present');
  assert.match(markCorruptBody, /this\.lastLoadCorrupt = true/);
  assert.match(markCorruptBody, /this\.lastCorruptRaw = raw/);
  assert.match(markCorruptBody, /Logger\.warn\(`Custom preset storage is corrupt:/);

  const loadBody = script.match(/load\(\) \{([\s\S]*?)\n  \},\n\n  saveAll/)?.[1] || '';
  assert.ok(loadBody, 'CustomPresets.load body should be present');
  assert.match(loadBody, /this\.lastLoadCorrupt = false/);
  assert.match(loadBody, /if \(!Array\.isArray\(parsed\)\) return this\.markCorrupt\(raw, 'Invalid preset storage shape'\)/);

  const saveCurrentBody = script.match(/saveCurrent\(\) \{([\s\S]*?)\n  \},\n\n  selected/)?.[1] || '';
  assert.ok(saveCurrentBody, 'CustomPresets.saveCurrent body should be present');
  assert.match(saveCurrentBody, /const items = this\.load\(\)/);
  assert.match(saveCurrentBody, /if \(this\.lastLoadCorrupt\) \{/);
  assert.match(saveCurrentBody, /BrowserStorage\.setLocal\(this\.corruptBackupKey\(\), this\.lastCorruptRaw\)/);
  assert.match(saveCurrentBody, /UI\.showError\('Recovered corrupt preset storage; previous raw data was backed up before saving new presets', 'WARN'\)/);
});

test('fadmv package import has entry count and empty-selection guards', () => {
  assert.match(script, /maxPackageEntries:\s*128/);
  assert.match(script, /maxPackageDirectoryBytes:\s*1024 \* 1024/);
  assert.match(script, /maxPackageEntryMetaBytes:\s*1024/);
  assert.match(script, /packageEntryYieldInterval:\s*16/);
  const parseBody = script.match(/async parseZip\(file\) \{([\s\S]*?)\n  \},\n\n  getRawAssetEntries/)?.[1] || '';
  assert.ok(parseBody, 'parseZip body should be present');
  assert.match(parseBody, /if \(!file\) throw new Error\('No package selected'\)/);
  assert.match(parseBody, /if \(file\.size > LIMITS\.maxPackageBytes\) throw new Error\('Package too large'\)/);
  assert.match(parseBody, /if \(count > LIMITS\.maxPackageEntries\) throw new Error\('Package has too many entries'\)/);
  assert.match(parseBody, /if \(centralSize > LIMITS\.maxPackageDirectoryBytes\) throw new Error\('Package directory too large'\)/);
  assert.match(parseBody, /const eocdOffset = tailStart \+ eocdInTail/);
  assert.match(parseBody, /const diskNumber = footerView\.getUint16\(eocdInTail \+ 4, true\)/);
  assert.match(parseBody, /const centralDisk = footerView\.getUint16\(eocdInTail \+ 6, true\)/);
  assert.match(parseBody, /const diskEntryCount = footerView\.getUint16\(eocdInTail \+ 8, true\)/);
  assert.match(parseBody, /const commentLen = footerView\.getUint16\(eocdInTail \+ 20, true\)/);
  assert.match(parseBody, /eocdOffset \+ 22 \+ commentLen !== file\.size/);
  assert.match(parseBody, /centralDirOffset \+ centralSize !== eocdOffset/);
  assert.match(parseBody, /extraLen > LIMITS\.maxPackageEntryMetaBytes/);
  assert.match(parseBody, /commentLen > LIMITS\.maxPackageEntryMetaBytes/);
  assert.match(parseBody, /i > 0 && i % LIMITS\.packageEntryYieldInterval === 0/);
  assert.match(parseBody, /if \(centralOffset !== centralSize\) throw new Error\('Corrupt package directory size'\)/);
  assert.match(parseBody, /localFlags !== flags/);
  assert.match(parseBody, /localMethod !== method/);
  assert.match(parseBody, /localCrc !== expectedCrc/);
  assert.match(parseBody, /localName !== name/);

  const entriesBody = script.match(/getRawAssetEntries\(\) \{([\s\S]*?)\n  \},\n\n  invalidRawAssetTypes/)?.[1] || '';
  assert.ok(entriesBody, 'getRawAssetEntries body should be present');
  assert.match(entriesBody, /if \(!file \|\| !Store\.flags\.assetValid\[type\]\) continue/);
  assert.match(script, /invalidRawAssetTypes\(\) \{/);
});

test('fadmv package jobs wait for audio analysis to finish', () => {
  const packageBody = script.match(/const ProjectPackage = \{([\s\S]*?)\n\};\n\nconst AutoSave/)?.[1] || '';
  assert.ok(packageBody, 'ProjectPackage body should be present');
  assert.match(packageBody, /isAudioAnalysisBusy\(\) \{/);
  assert.match(packageBody, /Store\.audioAnalysis\.status === 'analyzing'/);

  const startJobBody = script.match(/startPackageJob\(label\) \{([\s\S]*?)\n  \},\n\n  finishPackageJob/)?.[1] || '';
  assert.ok(startJobBody, 'startPackageJob body should be present');
  assert.match(startJobBody, /this\.assertPackageJobReady\(\)/);

  const packageJobBlockerBody = script.match(/packageJobBlocker\(\) \{([\s\S]*?)\n  \},\n\n  assertPackageJobReady/)?.[1] || '';
  assert.ok(packageJobBlockerBody, 'ProjectPackage.packageJobBlocker body should be present');
  assert.match(packageJobBlockerBody, /if \(this\.isAudioAnalysisBusy\(\)\) return 'Audio analysis in progress'/);

  const controlsBody = script.match(/updateControls\(\) \{([\s\S]*?)\n  \},\n\n  async exportPackageBlob/)?.[1] || '';
  assert.ok(controlsBody, 'ProjectPackage.updateControls body should be present');
  assert.match(controlsBody, /const analysisBusy = this\.isAudioAnalysisBusy\(\)/);
  assert.match(controlsBody, /const restoreRunning = Store\.restoreJob\.running/);
  assert.match(controlsBody, /const autosaveRunning = Store\.autosaveJob\.running/);
  assert.match(controlsBody, /const batchRunning = Store\.batch\.running/);
  assert.match(controlsBody, /btn\.disabled = running \|\| restoreRunning \|\| autosaveRunning \|\| batchRunning \|\| analysisBusy \|\| invalidAssets\.length > 0 \|\| Machine\.status !== 'IDLE' \|\| tooLarge/);
  assert.match(controlsBody, /loadBtn\.disabled = running \|\| restoreRunning \|\| autosaveRunning \|\| batchRunning \|\| analysisBusy \|\| Machine\.status !== 'IDLE'/);
  assert.match(controlsBody, /Dom\['in-package-file'\]\.disabled = running \|\| restoreRunning \|\| autosaveRunning \|\| batchRunning \|\| analysisBusy \|\| Machine\.status !== 'IDLE'/);
});

test('render readiness and start are blocked while offline audio analysis is running', () => {
  const preflightBody = script.match(/const Preflight = \{([\s\S]*?)\n\};\n\nconst Engine/)?.[1] || '';
  assert.ok(preflightBody, 'Preflight body should be present');
  assert.match(preflightBody, /const analysisBusy = Store\.audioAnalysis\.status === 'analyzing'/);
  assert.match(preflightBody, /if \(analysisBusy\) pushRender\('Audio analysis in progress', 'audio-analysis'\)/);
  assert.match(preflightBody, /const recordReady = blockers\.length === 0 && Store\.caps\.canRecord/);

  const checkReadyBody = script.match(/checkReady\(\) \{([\s\S]*?)\n  \},\n\n  setupPerformanceObserver/)?.[1] || '';
  assert.ok(checkReadyBody, 'Engine.checkReady body should be present');
  assert.match(checkReadyBody, /const readiness = Preflight\.getRenderReadiness\(\)/);
  assert.match(checkReadyBody, /Dom\['btn-rec'\]\.disabled = !readiness\.recordReady/);

  const recorderBody = script.match(/const Recorder = \{([\s\S]*?)\n\};\n\nwindow\.LIMITS/)?.[1] || '';
  assert.ok(recorderBody, 'Recorder body should be present');
  const blockerBody = recorderBody.match(/renderStartBlocker\(opts = \{\}\) \{([\s\S]*?)\n  \},\n\n  async start/)?.[1] || '';
  assert.ok(blockerBody, 'Recorder.renderStartBlocker body should be present');
  assert.match(blockerBody, /if \(Store\.audioAnalysis\.status === 'analyzing'\) \{/);
  assert.match(blockerBody, /Audio analysis in progress\. Wait or cancel it before starting render\./);

  const startBody = recorderBody.match(/async start\(opts = \{\}\) \{([\s\S]*?)\n  \},\n\n  finish\(\)/)?.[1] || '';
  assert.ok(startBody, 'Recorder.start body should be present');
  assert.match(startBody, /const startBlocker = this\.renderStartBlocker\(opts\)/);
  assert.match(startBody, /UI\.showError\(startBlocker, 'WARN'\)/);
  assert.match(startBody, /return false/);

  assert.match(script, /refreshReadiness\(\) \{/);
  const setStatusBody = script.match(/setStatus\(status, error = ''\) \{([\s\S]*?)\n  \},\n\n  async yieldToBrowser/)?.[1] || '';
  assert.ok(setStatusBody, 'AudioAnalysis.setStatus body should be present');
  assert.match(setStatusBody, /this\.refreshReadiness\(\)/);
  const analyzeBody = script.match(/async analyzeCurrentFile\(\) \{([\s\S]*?)\n  \},\n\n  getBeatPulse/)?.[1] || '';
  assert.ok(analyzeBody, 'AudioAnalysis.analyzeCurrentFile body should be present');
  assert.match(analyzeBody, /skipAnalysis[\s\S]*?this\.refreshReadiness\(\)/);
  assert.match(analyzeBody, /Store\.audioAnalysis\.status = 'done'[\s\S]*?this\.refreshReadiness\(\)/);
  assert.match(analyzeBody, /Store\.audioAnalysis\.status = \/timeout\/i\.test\(message\) \? 'timeout' : 'error'[\s\S]*?this\.refreshReadiness\(\)/);
});

test('long-running package jobs have a visible cancel path and keep final status', () => {
  const packageBody = script.match(/const ProjectPackage = \{([\s\S]*?)\n\};\n\nconst AutoSave/)?.[1] || '';
  assert.ok(packageBody, 'ProjectPackage body should be present');
  assert.match(packageBody, /cancelPackageJob\(reason = 'Package operation cancelled'\)/);
  assert.match(packageBody, /Store\.packageJob = \{ \.\.\.Store\.packageJob, running: true, cancelling: true, cancelledToken, label: 'PACKAGE CANCELLING' \}/);
  assert.match(packageBody, /Store\.packageProgress = \{ stage: 'PACKAGE CANCELLING', loaded: 0, total: 0 \}/);
  assert.match(packageBody, /UI\.progressPending\('PACKAGE CANCELLING'\)/);
  assert.doesNotMatch(packageBody, /UI\.progress\(1, 1, 'PACKAGE CANCELLING'\)/);
  assert.match(packageBody, /Waiting for the current package task to stop before unlocking the project/);
  assert.match(packageBody, /Store\.packageJob\.cancelledToken === token/);

  const controlsBody = script.match(/updateControls\(\) \{([\s\S]*?)\n  \},\n\n  async exportPackageBlob/)?.[1] || '';
  assert.ok(controlsBody, 'ProjectPackage.updateControls body should be present');
  assert.match(controlsBody, /Dom\['btn-cancel-package'\]/);
  assert.match(controlsBody, /style\.display = running \? 'block' : 'none'/);
  assert.match(controlsBody, /cancelBtn\.disabled = !running \|\| Store\.packageJob\.cancelling/);
  assert.match(controlsBody, /Dom\['btn-retry-package-download'\]/);
  assert.match(controlsBody, /const retryAvailable = this\.canRetryPackageDownload\(lastDownload\)/);
  assert.match(controlsBody, /retryBtn\.style\.display = retryAvailable \? 'block' : 'none'/);
  assert.match(controlsBody, /UI\.setControlReason\([\s\S]*retryBtn,[\s\S]*!retryAvailable \|\| !!retryLockReason/);

  const downloadBody = script.match(/async downloadPackage\(\) \{([\s\S]*?)\n  \},\n\n  mimeForAsset/)?.[1] || '';
  assert.ok(downloadBody, 'downloadPackage body should be present');
  assert.ok(downloadBody.indexOf('this.finishPackageJob(token);') < downloadBody.indexOf('项目包下载已触发，请检查文件 / VERIFY FILE'));
  assert.match(downloadBody, /Store\.packageDownload = \{ status: 'working'/);
  assert.ok(downloadBody.indexOf('retryRetention = this.retainPackageDownload(blob, fileName)') < downloadBody.indexOf('result = DownloadManager.dispatchBlob(blob, fileName)'));
  assert.match(downloadBody, /Store\.packageDownload = \{[\s\S]*?status: result\.saveVerified \? 'verified' : 'download-dispatched'/);
  assert.match(downloadBody, /Store\.packageDownload = \{[\s\S]*?status: 'error'/);
  assert.match(downloadBody, /retryAvailable: !result\.saveVerified && !!retryRetention\.retryAvailable/);
  assert.match(downloadBody, /retryAvailable: !!retryRetention\.retryAvailable/);

  const retryBody = packageBody.match(/retryPackageDownload\(\) \{([\s\S]*?)\n  \},\n\n  updateControls/)?.[1] || '';
  assert.ok(retryBody, 'ProjectPackage.retryPackageDownload body should be present');
  assert.match(retryBody, /if \(!this\.canRetryPackageDownload\(\)\)/);
  assert.match(retryBody, /const lockReason = this\.packageRetryLockReason\(\)/);
  assert.ok(retryBody.indexOf('const lockReason = this.packageRetryLockReason()') < retryBody.indexOf('DownloadManager.dispatchBlob(saved.blob, saved.fileName)'));
  assert.match(retryBody, /Store\.packageDownload = \{[\s\S]*?status: result\.saveVerified \? 'verified' : 'download-dispatched'/);

  const importBody = script.match(/async importPackageFile\(file\) \{([\s\S]*?)\n  \},\n\n  init\(\)/)?.[1] || '';
  assert.ok(importBody, 'importPackageFile body should be present');
  assert.ok(importBody.lastIndexOf('this.finishPackageJob(token);') < importBody.lastIndexOf("UI.log('PROJECT PACKAGE LOADED', 'ok')"));
  assert.match(importBody, /this\.throwIfPackageJobStopped\(token\);[\s\S]*AutoSave\.restoreAudioAnalysisForSnapshot\(\{ state: project, assets: project\.packageAssets \|\| \{\} \}, prepared\)/);
  assert.match(importBody, /AssetManager\.preflightFile\(type, assetFile, \{\s*cancelCheck: \(\) => this\.throwIfPackageJobStopped\(token\)\s*\}\)/);
  assert.match(importBody, /cancelCheck: \(\) => this\.throwIfPackageJobStopped\(token\)/);
  assert.ok(importBody.lastIndexOf("AutoSave.saveSnapshot('package-import')") > importBody.lastIndexOf('this.finishPackageJob(token);'));

  const loadFileBody = script.match(/loadFile\(type, file, opts = \{\}\) \{([\s\S]*?)\n  \},\n  bindFile/)?.[1] || '';
  assert.ok(loadFileBody, 'AssetManager.loadFile body should be present');
  assert.match(loadFileBody, /const assertNotCancelled = \(\) => \{/);
  assert.match(loadFileBody, /typeof opts\.cancelCheck === 'function'/);
  assert.match(loadFileBody, /assertNotCancelled\(\)/);
  assert.match(loadFileBody, /let cancelId = null/);
  assert.match(loadFileBody, /const cancelIfRequested = \(\) => \{/);
  assert.match(loadFileBody, /cancelId = setInterval\(cancelIfRequested, 50\)/);
  assert.match(loadFileBody, /clearInterval\(cancelId\)/);
});

test('export finalize and batch render expose cancellable states', () => {
  const updateStateBody = script.match(/updateState\(state, opts = \{\}\) \{([\s\S]*?)\n  \},\n  moveFocusForState/)?.[1] || '';
  assert.ok(updateStateBody, 'UI.updateState body should be present');
  assert.match(updateStateBody, /state === 'RECORDING' \|\| state === 'WARMING' \|\| state === 'EXPORTING'/);
  assert.match(updateStateBody, /Dom\['btn-finish'\]\.disabled = state === 'EXPORTING'/);
  assert.match(updateStateBody, /Dom\['btn-finish'\]\.innerHTML = state === 'EXPORTING'/);
  assert.match(updateStateBody, /<span class="btn-main">正在封装<\/span><span class="btn-sub">Finalizing\.\.\.<\/span>/);
  assert.match(updateStateBody, /<span class="btn-main">完成并保存<\/span><span class="btn-sub">Finish & Save<\/span>/);

  const batchRenderBody = script.match(/render\(\) \{([\s\S]*?)\n  \},\n\n  init\(\)/)?.[1] || '';
  assert.ok(batchRenderBody, 'BatchQueue.render body should be present');
  assert.match(batchRenderBody, /const clearMain = Store\.batch\.running/);
  assert.match(batchRenderBody, /restoring \? '正在恢复原项目' : \(cancelling \? '正在取消批量' : '取消批量'\)/);
  assert.match(batchRenderBody, /const clearSub = Store\.batch\.running/);
  assert.match(batchRenderBody, /restoring \? '恢复中 \/ Restoring' : \(cancelling \? '取消中 \/ Cancelling' : '取消 \/ Cancel'\)/);
  assert.match(batchRenderBody, /clearConfirmArmed \? '确认丢弃 \/ Discard' : '清空 \/ Clear'/);
  assert.match(batchRenderBody, /Dom\['btn-clear-batch'\]\.innerHTML = `<span class="btn-main">\$\{clearMain\}<\/span><span class="btn-sub">\$\{clearSub\}<\/span>`/);
  assert.match(batchRenderBody, /Dom\['btn-clear-batch'\]\.disabled = Store\.packageJob\.running \|\| Store\.restoreJob\.running \|\| Store\.autosaveJob\.running \|\| restoring \|\| cancelling \|\| \(!Store\.batch\.running && Machine\.status !== 'IDLE'\)/);
  assert.match(batchRenderBody, /const analysisBusy = Store\.audioAnalysis\.status === 'analyzing'/);
  assert.match(batchRenderBody, /const batchStartBlocked = Store\.packageJob\.running \|\| Store\.restoreJob\.running \|\| Store\.autosaveJob\.running \|\| analysisBusy \|\| streamSaveBatchBlock \|\| !runnablePending \|\| !baseReady \|\| Store\.batch\.running \|\| Machine\.status !== 'IDLE'/);
  assert.match(batchRenderBody, /summary\.classList\.toggle\('ready', !batchStartBlocked\)/);
  assert.match(batchRenderBody, /Dom\['btn-start-batch'\]\.disabled = batchStartBlocked/);
  assert.match(batchRenderBody, /UI\.setControlReason\(Dom\['btn-start-batch'\]/);

  const batchBody = script.match(/const BatchQueue = \{([\s\S]*?)\n\};\n\nconst AudioAnalysis/)?.[1] || '';
  assert.ok(batchBody, 'BatchQueue body should be present');
  assert.match(batchBody, /throwIfBatchCancelled\(reason = 'Batch cancelled'\)/);
  assert.match(batchBody, /Store\.audioAnalysis\.status === 'analyzing'/);
  assert.match(batchBody, /Audio analysis in progress\. Wait or cancel it before starting batch render/);
  const batchReadinessBody = script.match(/getBatchRenderReadiness\(\) \{([\s\S]*?)\n  \},\n\n  checkReady/)?.[1] || '';
  assert.ok(batchReadinessBody, 'Engine.getBatchRenderReadiness body should be present');
  assert.match(batchReadinessBody, /Preflight\.getRenderReadiness\(Preflight\.getAudioDuration\(\), \{ ignoreBatchLock: true \}\)/);
  assert.doesNotMatch(batchReadinessBody, /Store\.batch\.running/, 'batch internal readiness should ignore the expected batch-running lock');
  const renderNextBody = batchBody.match(/async renderNext\(index\) \{([\s\S]*?)\n  \},\n\n  async start/)?.[1] || '';
  assert.ok(renderNextBody, 'BatchQueue.renderNext body should be present');
  assert.match(renderNextBody, /await AssetManager\.loadFile\('audio', item\.file, \{[\s\S]*?noAutosave: true,[\s\S]*?allowLockedMutation: true,[\s\S]*?cancelCheck: \(\) => this\.throwIfBatchCancelled\(\)[\s\S]*?\}\)/);
  assert.match(renderNextBody, /Engine\.getBatchRenderReadiness\(\)/);
  assert.match(renderNextBody, /const started = await Recorder\.start\(\{ ignoreBatchLock: true \}\)/);
  assert.doesNotMatch(
    renderNextBody,
    /Dom\['btn-rec'\]\?*\.disabled|Dom\['btn-rec'\]\.disabled/,
    'batch render readiness must not depend on the manual render button lock'
  );
  const titleAt = renderNextBody.indexOf("ProjectPresets.setText('in-song'");
  assert.ok(renderNextBody.indexOf('this.throwIfBatchCancelled();') < titleAt);
  const guardAfterTitle = renderNextBody.indexOf('this.throwIfBatchCancelled();', titleAt);
  assert.ok(guardAfterTitle > titleAt);
  assert.ok(renderNextBody.indexOf('this.throwIfBatchCancelled();') < renderNextBody.indexOf('const started = await Recorder.start({ ignoreBatchLock: true })'));
  const batchInitBody = batchBody.match(/init\(\) \{([\s\S]*?)\n    this\.render\(\);/)?.[1] || '';
  assert.ok(batchInitBody, 'BatchQueue.init body should be present');
  assert.match(batchInitBody, /Store\.batch\.running \? this\.requestCancel\('Batch cancelled by user'\) : this\.clear\(\)/);
});

test('batch cancellation exposes a persistent cancelling state while teardown is pending', () => {
  const batchBody = script.match(/const BatchQueue = \{([\s\S]*?)\n\};\n\nconst AudioAnalysis/)?.[1] || '';
  assert.ok(batchBody, 'BatchQueue body should be present');
  const requestCancelBody = batchBody.match(/requestCancel\(reason = 'Batch cancelled'\) \{([\s\S]*?)\n  \},\n\n  throwIfBatchCancelled/)?.[1] || '';
  assert.ok(requestCancelBody, 'BatchQueue.requestCancel body should be present');
  assert.match(requestCancelBody, /if \(Store\.batch\.restoring\) \{[\s\S]*?暂时不能取消[\s\S]*?return/);
  assert.match(requestCancelBody, /Store\.batch\.cancelRequested = true/);
  const cancelSetAt = requestCancelBody.indexOf('Store.batch.cancelRequested = true');
  const renderAfterCancelAt = requestCancelBody.indexOf('this.render()', cancelSetAt);
  assert.ok(renderAfterCancelAt > cancelSetAt);

  const renderBody = batchBody.match(/render\(\) \{([\s\S]*?)\n  \},\n\n  init/)?.[1] || '';
  assert.ok(renderBody, 'BatchQueue.render body should be present');
  assert.match(renderBody, /const restoring = Store\.batch\.running && Store\.batch\.restoring/);
  assert.match(renderBody, /const cancelling = Store\.batch\.running && Store\.batch\.cancelRequested && !restoring/);
  assert.match(renderBody, /restoring \? 'RESTORING PROJECT' : \(cancelling \? 'CANCELLING' : 'RUNNING'\)/);
  assert.match(renderBody, /Store\.batch\.running/);
  assert.match(renderBody, /restoring \? '恢复中 \/ Restoring' : \(cancelling \? '取消中 \/ Cancelling' : '取消 \/ Cancel'\)/);
  assert.match(renderBody, /clearConfirmArmed \? '确认丢弃 \/ Discard' : '清空 \/ Clear'/);
  assert.match(renderBody, /Store\.packageJob\.running \|\| Store\.restoreJob\.running \|\| Store\.autosaveJob\.running \|\| restoring \|\| cancelling \|\| \(!Store\.batch\.running && Machine\.status !== 'IDLE'\)/);
  assert.match(renderBody, /restoring\s*\?\s*'Restoring original project after batch'/);
  assert.match(renderBody, /cancelling\s*\?\s*'Waiting for batch render to stop'/);
});

test('batch render save waiters are armed before start to avoid short-track save races', () => {
  const batchBody = script.match(/const BatchQueue = \{([\s\S]*?)\n\};\n\nconst AudioAnalysis/)?.[1] || '';
  assert.ok(batchBody, 'BatchQueue body should be present');
  const renderNextBody = batchBody.match(/async renderNext\(index\) \{([\s\S]*?)\n  \},\n\n  async start/)?.[1] || '';
  assert.ok(renderNextBody, 'BatchQueue.renderNext body should be present');
  assert.ok(renderNextBody.indexOf('const saved = Recorder.waitForNextSave(') < renderNextBody.indexOf('const started = await Recorder.start({ ignoreBatchLock: true });'));
  assert.match(renderNextBody, /if \(!started\) throw new Error\(`Batch render did not start:/);
  assert.doesNotMatch(renderNextBody, /Machine\.status !== 'RECORDING'/);
  assert.match(renderNextBody, /const saved = Recorder\.waitForNextSave\([\s\S]*?, Recorder\._sessionId \+ 1\)/);
  assert.match(renderNextBody, /saved\.catch\(\(\) => \{\}\)/);
  assert.match(renderNextBody, /saved\.cancel\?\.\(err\)/);
});

test('batch render waits for loaded audio to become playable before readiness checks', () => {
  const batchBody = script.match(/const BatchQueue = \{([\s\S]*?)\n\};\n\nconst AudioAnalysis/)?.[1] || '';
  assert.ok(batchBody, 'BatchQueue body should be present');
  const renderNextBody = batchBody.match(/async renderNext\(index\) \{([\s\S]*?)\n  \},\n\n  async start/)?.[1] || '';
  assert.ok(renderNextBody, 'BatchQueue.renderNext body should be present');
  const loadAt = renderNextBody.indexOf("await AssetManager.loadFile('audio', item.file");
  const canPlayAt = renderNextBody.indexOf('await Recorder.waitForCanPlay(Store.assets.audio, LIMITS.warmupTimeoutMs)');
  const readinessAt = renderNextBody.indexOf('const readiness = Engine.getBatchRenderReadiness()');
  assert.ok(loadAt >= 0, 'batch should load the current audio item');
  assert.ok(canPlayAt > loadAt, 'batch should wait for audio canplay after loading the item');
  assert.ok(readinessAt > canPlayAt, 'batch readiness should run after audio canplay');
  assert.match(renderNextBody, /this\.throwIfBatchCancelled\(\);\s*await Recorder\.waitForCanPlay\(Store\.assets\.audio, LIMITS\.warmupTimeoutMs\);\s*this\.throwIfBatchCancelled\(\);/);
});

test('audio analysis can be cancelled and decode is bounded by timeout', () => {
  assert.match(script, /audioDecodeTimeoutMs:\s*30000/);
  assert.match(script, /audioAnalysisTimeoutMs:\s*60000/);
  assert.match(script, /audioAnalysisReadChunkBytes/);
  const audioBody = script.match(/const AudioAnalysis = \{([\s\S]*?)\n\};\n\nconst Preflight/)?.[1] || '';
  assert.ok(audioBody, 'AudioAnalysis body should be present');
  assert.match(audioBody, /cancelAnalysis\(reason = 'Audio analysis cancelled'\)/);
  const cancelBody = audioBody.match(/cancelAnalysis\(reason = 'Audio analysis cancelled'\) \{([\s\S]*?)\n  \},\n\n  analysisTimeoutMs/)?.[1] || '';
  assert.ok(cancelBody, 'AudioAnalysis.cancelAnalysis body should be present');
  assert.match(cancelBody, /if \(Store\.audioAnalysis\.status !== 'analyzing'\) return false/);
  assert.ok(cancelBody.indexOf("if (Store.audioAnalysis.status !== 'analyzing') return false") < cancelBody.indexOf('Store.audioAnalysisJob.token += 1'));
  assert.ok(cancelBody.indexOf("RenderReport.invalidateProjectOutput('Audio analysis cancelled')") < cancelBody.indexOf("Store.audioAnalysis.status = 'cancelled'"));
  assert.match(cancelBody, /const ctx = this\._decodeCtx/);
  assert.match(cancelBody, /ctx\.close\(\)\.catch\(\(\) => \{\}\)/);
  assert.match(cancelBody, /AutoSave\.schedule\('audio-analysis'\)/);
  assert.match(cancelBody, /return true/);
  assert.match(audioBody, /_decodeCtx: null/);
  assert.match(audioBody, /_decodeToken: 0/);
  assert.match(audioBody, /withDecodeTimeout\(promise, token, file, deadlineMs\)/);
  assert.match(audioBody, /withAnalysisTimeout\(promise, token, file, deadlineMs/);
  assert.match(audioBody, /readAudioFileForDecode\(file, token, analysisFile, deadlineMs\)/);
  assert.match(audioBody, /this\._decodeCtx = ctx/);
  assert.match(audioBody, /this\._decodeToken = token/);
  assert.match(audioBody, /if \(this\._decodeCtx === ctx && this\._decodeToken === token\)/);
  assert.match(audioBody, /Audio decode timeout/);
  assert.match(audioBody, /Audio analysis timeout/);
  assert.match(audioBody, /safeDecodedAnalysisSeconds\(channels = LIMITS\.analysisAssumedChannels/);
  assert.match(audioBody, /analysisLimitLabel\(channels = LIMITS\.analysisAssumedChannels/);

  const initBody = audioBody.match(/init\(\) \{([\s\S]*?)\n  \},\n\n  setStatus/)?.[1] || '';
  assert.ok(initBody, 'AudioAnalysis.init body should be present');
  assert.match(initBody, /if \(Store\.audioAnalysis\.status === 'analyzing'\) \{/);
  assert.match(initBody, /this\.cancelAnalysis\(\)/);

  const panelBody = script.match(/const AudioAnalysis = \{[\s\S]*?updatePanel\(\) \{([\s\S]*?)\n  \}\n\};\n\nconst Preflight/)?.[1] || '';
  assert.ok(panelBody, 'AudioAnalysis.updatePanel body should be present');
  assert.match(panelBody, /button\.innerHTML = isBusy/);
  assert.match(panelBody, /<span class="btn-main">取消分析<\/span><span class="btn-sub">Cancel Analysis<\/span>/);
  assert.match(panelBody, /<span class="btn-main">分析音轨<\/span><span class="btn-sub">Analyze Track<\/span>/);
  assert.match(panelBody, /button\.disabled = !hasAudio \|\| \(!isBusy && !!lockReason\)/);
  assert.match(panelBody, /ANALYSIS CANCELLED/);
  assert.match(panelBody, /ANALYSIS TIMED OUT/);
  assert.match(panelBody, /ANALYSIS SKIPPED/);
  assert.match(panelBody, /this\.analysisLimitLabel\(\)/);
  assert.doesNotMatch(panelBody, /\$\{Math\.round\(LIMITS\.audioAnalysisTimeoutMs \/ 1000\)\}s max/);
});

test('batch queue has item and aggregate size limits', () => {
  assert.match(script, /maxBatchItems:\s*50/);
  assert.match(script, /maxBatchTotalBytes/);
  assert.match(script, /queuedBytes\(\)/);
  assert.match(script, /Store\.batch\.items\.length >= LIMITS\.maxBatchItems/);
  assert.match(script, /Batch total too large/);
});

test('audio analysis refuses unknown or decoded-overlong duration', () => {
  assert.match(script, /skipAnalysis = \(reason\)/);
  assert.match(script, /duration unavailable/);
  assert.match(script, /unknown compressed audio layout exceeds safe decoded analysis window/);
  assert.match(script, /decoded audio exceeds safe analysis window/);
  assert.match(script, /track longer than \$\{Utils\.formatSeconds\(LIMITS\.maxAnalysisSeconds\)\} analysis limit/);
  assert.match(script, /Audio analysis skipped for this file; render can continue/);
  assert.doesNotMatch(script, /return 'decoded audio too large'/);
});

test('audio analysis probes container decoded size before full decode', () => {
  assert.match(script, /audioMetadataProbeBytes:\s*256 \* 1024/);
  assert.match(script, /analysisUnknownSampleRate:\s*96_000/);
  assert.match(script, /analysisUnknownChannels:\s*8/);
  const audioBody = script.match(/const AudioAnalysis = \{([\s\S]*?)\n\};\n\nconst Preflight/)?.[1] || '';
  assert.ok(audioBody, 'AudioAnalysis body should be present');
  assert.match(audioBody, /parseWavMetadata\(view, fallbackDurationSec = 0\)/);
  assert.match(audioBody, /id3v2PayloadSize\(view\)/);
  assert.match(audioBody, /parseMp3Metadata\(view, fallbackDurationSec = 0, file = null\)/);
  assert.match(audioBody, /parseFlacMetadata\(view, fallbackDurationSec = 0, file = null\)/);
  assert.match(audioBody, /readAudioMetadata\(file, token, analysisFile, deadlineMs, fallbackDurationSec = 0\)/);
  assert.match(audioBody, /metadataDecodedSkipReason\(metadata, file = null\)/);
  assert.match(audioBody, /assumedDecodedSkipReason\(durationSec, file = null\)/);
  assert.match(audioBody, /probeBlob\.arrayBuffer\(\)/);
  assert.match(audioBody, /this\.readFourCC\(view, 0\) !== 'fLaC'/);
  assert.match(audioBody, /const blockType = header & 0x7f/);
  assert.match(audioBody, /const blockLength = \(view\.getUint8\(offset \+ 1\) << 16\) \| \(view\.getUint8\(offset \+ 2\) << 8\) \| view\.getUint8\(offset \+ 3\)/);
  assert.match(audioBody, /blockType === 0 && blockLength === 34/);
  assert.match(audioBody, /const sampleRate = \(view\.getUint8\(dataOffset \+ 10\) << 12\) \| \(view\.getUint8\(dataOffset \+ 11\) << 4\) \| \(view\.getUint8\(dataOffset \+ 12\) >> 4\)/);
  assert.match(audioBody, /const channels = \(\(view\.getUint8\(dataOffset \+ 12\) >> 1\) & 0x07\) \+ 1/);
  assert.match(audioBody, /const bitsPerSample = \(\(\(view\.getUint8\(dataOffset \+ 12\) & 0x01\) << 4\) \| \(view\.getUint8\(dataOffset \+ 13\) >> 4\)\) \+ 1/);
  assert.match(audioBody, /const totalSamples = highTotalSamples \* 0x100000000 \+ lowTotalSamples/);
  assert.match(audioBody, /format: 'flac'/);
  assert.match(audioBody, /audioFormat === 0xfffe/);
  assert.match(audioBody, /subFormat = view\.getUint32\(dataOffset \+ 24, true\)/);
  assert.match(audioBody, /const decodedFormat = audioFormat === 0xfffe \? subFormat : audioFormat/);
  assert.match(audioBody, /this\.readFourCC\(view, 0\) !== 'ID3'/);
  assert.match(audioBody, /parseMp3FrameHeader\(view, offset\)/);
  assert.match(audioBody, /if \(!\/mpeg\|mp3\/\.test\(type\) && !name\.endsWith\('\.mp3'\)\) return null/);
  assert.match(audioBody, /const sampleRates = \{/);
  assert.match(audioBody, /const bitrateTables = \{/);
  assert.match(audioBody, /const frameLength = layerKey === 1/);
  assert.match(audioBody, /const start = this\.id3v2PayloadSize\(view\)/);
  assert.match(audioBody, /layerBits !== 1/);
  assert.match(audioBody, /channels: channelMode === 0x03 \? 1 : 2/);
  assert.match(audioBody, /const nextFrameOffset = offset \+ frame\.frameLength/);
  assert.match(audioBody, /const nextFrame = this\.parseMp3FrameHeader\(view, nextFrameOffset\)/);
  assert.match(audioBody, /if \(!nextFrame\) continue/);
  assert.match(audioBody, /format: 'mp3'/);
  assert.match(audioBody, /this\.parseWavMetadata\(view, fallbackDurationSec\)[\s\S]*\|\| this\.parseMp3Metadata\(view, fallbackDurationSec, file\)[\s\S]*\|\| this\.parseFlacMetadata\(view, fallbackDurationSec, file\)/);

  const analyzeStart = audioBody.indexOf('async analyzeCurrentFile()');
  const analyzeEnd = audioBody.indexOf('\n  updatePanel()', analyzeStart);
  const analyzeBody = analyzeStart >= 0 && analyzeEnd > analyzeStart ? audioBody.slice(analyzeStart, analyzeEnd) : '';
  assert.ok(analyzeBody, 'AudioAnalysis.analyzeCurrentFile body should be present');
  const metadataAt = analyzeBody.indexOf('await this.readAudioMetadata(file, token, file, deadlineMs, durationSec)');
  const assumedSkipAt = analyzeBody.indexOf('this.assumedDecodedSkipReason(durationSec, file)');
  const decodeAt = analyzeBody.indexOf('await this.decodeAudioFile(file, token, file, deadlineMs)');
  assert.ok(metadataAt >= 0, 'metadata probe should run in analyzeCurrentFile');
  assert.ok(assumedSkipAt >= 0, 'assumed decoded-size fallback should still exist for unparsed containers');
  assert.ok(decodeAt >= 0, 'decode should still run after metadata probe');
  assert.ok(metadataAt < decodeAt, 'metadata decoded-size guard must run before decodeAudioFile');
  assert.ok(metadataAt < assumedSkipAt && assumedSkipAt < decodeAt, 'generic assumed decoded-size fallback should run only after metadata probe misses');
  assert.match(analyzeBody, /if \(metadataSkipReason\) return skipAnalysis\(metadataSkipReason\)/);
  assert.match(analyzeBody, /if \(!metadata\) \{[\s\S]*?this\.assumedDecodedSkipReason\(durationSec, file\)/);
  assert.match(audioBody, /this\.safeDecodedAnalysisSeconds\(LIMITS\.analysisUnknownChannels, LIMITS\.analysisUnknownSampleRate\)/);
});

test('audio analysis panel discloses effective safe decode limits', () => {
  const audioBody = script.match(/const AudioAnalysis = \{([\s\S]*?)\n\};\n\nconst Preflight/)?.[1] || '';
  assert.ok(audioBody, 'AudioAnalysis body should be present');
  assert.match(audioBody, /safeDecodedAnalysisSeconds\(channels = LIMITS\.analysisAssumedChannels, sampleRate = LIMITS\.analysisAssumedSampleRate\)/);
  assert.match(audioBody, /const bytesPerSecond = safeChannels \* safeSampleRate \* Float32Array\.BYTES_PER_ELEMENT/);
  assert.match(audioBody, /Math\.min\(LIMITS\.maxAnalysisSeconds, LIMITS\.maxAnalysisDecodedBytes \/ bytesPerSecond\)/);
  assert.match(audioBody, /analysisLimitLabel\(channels = LIMITS\.analysisAssumedChannels, sampleRate = LIMITS\.analysisAssumedSampleRate\)/);
  assert.match(audioBody, /unknown compressed precheck/);
  assert.match(audioBody, /working-set budget/);
  assert.match(audioBody, /safe decode · \$\{unknownSafe\} unknown compressed precheck · \$\{Utils\.formatBytes\(LIMITS\.maxAnalysisWorkingSetBytes\)\} working-set budget · \$\{Math\.round\(LIMITS\.audioAnalysisTimeoutMs \/ 1000\)\}s timeout/);
  assert.match(audioBody, /\['限制 \/ Limit', this\.analysisLimitLabel\(\)\]/);
});

test('audio analysis working-set budget blocks combined compressed and decoded memory before decode', () => {
  assert.match(script, /maxAnalysisWorkingSetBytes:\s*160 \* 1024 \* 1024/);
  const audioBody = script.match(/const AudioAnalysis = \{([\s\S]*?)\n\};\n\nconst Preflight/)?.[1] || '';
  assert.ok(audioBody, 'AudioAnalysis body should be present');
  assert.match(audioBody, /analysisWorkingSetBytes\(file, decodedBytes\)/);
  assert.match(audioBody, /analysisWorkingSetSkipReason\(file, decodedBytes\)/);
  assert.match(audioBody, /fileBytes \+ decoded/);
  assert.match(audioBody, /LIMITS\.maxAnalysisWorkingSetBytes/);
  assert.match(audioBody, /audio analysis working set exceeds safe memory budget/);

  const metadataSkipBody = audioBody.match(/metadataDecodedSkipReason\(metadata(?:, file = null)?\) \{([\s\S]*?)\n  \},\n\n  analysisSkipReason/)?.[1] || '';
  assert.ok(metadataSkipBody, 'AudioAnalysis.metadataDecodedSkipReason body should be present');
  assert.match(metadataSkipBody, /this\.analysisWorkingSetSkipReason\(file, metadata\.decodedBytes\)/);

  const assumedSkipBody = audioBody.match(/assumedDecodedSkipReason\(durationSec(?:, file = null)?\) \{([\s\S]*?)\n  \},\n\n  async readAudioFileForDecode/)?.[1] || '';
  assert.ok(assumedSkipBody, 'AudioAnalysis.assumedDecodedSkipReason body should be present');
  assert.match(assumedSkipBody, /const assumedDecodedBytes = this\.estimateDecodedAudioBytes\(durationSec, LIMITS\.analysisUnknownChannels, LIMITS\.analysisUnknownSampleRate\)/);
  assert.match(assumedSkipBody, /this\.analysisWorkingSetSkipReason\(file, assumedDecodedBytes\)/);

  const analyzeStart = audioBody.indexOf('async analyzeCurrentFile()');
  const analyzeEnd = audioBody.indexOf('\n  updatePanel()', analyzeStart);
  const analyzeBody = analyzeStart >= 0 && analyzeEnd > analyzeStart ? audioBody.slice(analyzeStart, analyzeEnd) : '';
  assert.ok(analyzeBody, 'AudioAnalysis.analyzeCurrentFile body should be present');
  assert.match(analyzeBody, /const metadataSkipReason = this\.metadataDecodedSkipReason\(metadata, file\)/);
  assert.match(analyzeBody, /const assumedSkipReason = this\.assumedDecodedSkipReason\(durationSec, file\)/);
});

test('video frame fallback cache avoids per-frame dynamic canvas resizing', () => {
  assert.match(script, /const cacheW = Math\.max\(1, Math\.round\(Math\.min\(w \* 0\.9, LayoutConfig\.videoBaseWidth, maxVideoH \* ratio\)\)\)/);
  assert.doesNotMatch(script, /c\.width !== Math\.round\(drawW\)/);
});

test('secondary center video decoder is lazy-loaded only for loop prewarm', () => {
  const assetBody = script.match(/const AssetManager = \{([\s\S]*?)\n\};\n\nconst ProjectPresets/)?.[1] || '';
  assert.ok(assetBody, 'AssetManager body should be present');
  const loadFileBody = assetBody.match(/loadFile\(type, file, opts = \{\}\) \{([\s\S]*?)\n  \},\n  mutationLockReason/)?.[1] || '';
  assert.ok(loadFileBody, 'AssetManager.loadFile body should be present');
  assert.doesNotMatch(loadFileBody, /const vb = Store\.assets\.videoB/);
  assert.doesNotMatch(loadFileBody, /const vb = Store\.assets\.videoB[\s\S]*?vb\.load\(\)/);

  const engineBody = script.match(/const Engine = \{([\s\S]*?)\n\};\n\nconst Recorder/)?.[1] || '';
  assert.ok(engineBody, 'Engine body should be present');
  assert.match(engineBody, /prepareSecondaryVideoLoop\(vid, vidB, loopStartSec\)/);
  assert.match(engineBody, /vidB\.src = src/);
  assert.match(engineBody, /vidB\.load\(\)/);
  const prepareAt = engineBody.indexOf('prepareSecondaryVideoLoop(vid, vidB, loopStartSec)');
  const updateAt = engineBody.indexOf('updateSimulation(dtSec)');
  assert.ok(prepareAt >= 0 && updateAt >= 0 && prepareAt < updateAt, 'secondary prewarm helper should live before simulation loop uses it');
  assert.match(engineBody, /if \(vidB && vid\.currentTime >= prewarmAt\) \{[\s\S]*?this\.prepareSecondaryVideoLoop\(vid, vidB, loopStartSec\)/);
  const recorderBody = script.match(/const Recorder = \{([\s\S]*?)\n\};\n\nwindow\.LIMITS/)?.[1] || '';
  assert.ok(recorderBody, 'Recorder body should be present');
  assert.match(recorderBody, /stopPreview\(\)[\s\S]*?Engine\.resetSecondaryVideoLoop\(\)/);
  assert.match(recorderBody, /cleanup\(partial\)[\s\S]*?Engine\.resetSecondaryVideoLoop\(\)/);
});

test('preflight blocks non-stream long renders before late recording failure', () => {
  assert.match(script, /maxRecordingBytes:\s*700 \* 1024 \* 1024/);
  assert.match(script, /maxNonStreamLiveMemoryBytes:\s*512 \* 1024 \* 1024/);
  assert.match(script, /estimatedOutputBytes/);
  assert.match(script, /estimatedNonStreamLiveMemoryBytes/);
  assert.match(script, /willExceedMemoryCap/);
  assert.match(script, /return estimated > 0 \? Math\.ceil\(estimated \* 1\.25\) : 0/);
  assert.match(script, /!Store\.config\.streamSave && \(estimated > LIMITS\.maxRecordingBytes \|\| liveMemory > LIMITS\.maxNonStreamLiveMemoryBytes\)/);
  assert.match(script, /estimatedLiveMemoryBytes/);
  assert.match(script, /live \$\{Utils\.formatBytes\(estimatedLiveMemoryBytes\)\}/);
  assert.match(script, /output-size/);
  assert.match(script, /enable Streaming Save/);
});

test('preflight blocks audio longer than the recording hard cap even with Streaming Save', () => {
  assert.match(script, /maxAudioSeconds:\s*60 \* 60/);
  assert.match(script, /maxRecordingSeconds:\s*60 \* 30/);
  const preflightBody = script.match(/const Preflight = \{([\s\S]*?)\n\};\n\nconst Engine/)?.[1] || '';
  assert.ok(preflightBody, 'Preflight body should be present');
  assert.match(preflightBody, /renderDurationCapRecovery\(\)/);
  assert.match(preflightBody, /const renderTooLong = aRecordDurOk && durationSec > LIMITS\.maxRecordingSeconds/);
  assert.match(preflightBody, /if \(renderTooLong\) pushRender\(this\.renderDurationCapRecovery\(\), 'render-duration'\)/);
  assert.ok(preflightBody.indexOf('if (renderTooLong)') < preflightBody.indexOf('if (outputTooLarge)'));
  assert.match(preflightBody, /Audio exceeds \$\{Utils\.formatSeconds\(LIMITS\.maxRecordingSeconds\)\} recording cap/);
});

test('long render recovery is actionable when Streaming Save is unavailable', () => {
  const preflightBody = script.match(/const Preflight = \{([\s\S]*?)\n\};\n\nconst Engine/)?.[1] || '';
  assert.ok(preflightBody, 'Preflight body should be present');
  assert.match(preflightBody, /memoryCapRecovery\(\)/);
  assert.match(preflightBody, /Store\.caps\.canFSAccess/);
  assert.match(preflightBody, /browser download mode needs < \$\{Utils\.formatBytes\(LIMITS\.maxNonStreamLiveMemoryBytes\)\} live memory/);
  assert.match(preflightBody, /使用 Chrome\/Edge 开启 Streaming Save，或降低码率\/缩短音频，让实时内存低于 \$\{Utils\.formatBytes\(LIMITS\.maxNonStreamLiveMemoryBytes\)\} \/ Use Chrome or Edge for Streaming Save, or lower bitrate\/shorten audio below \$\{Utils\.formatBytes\(LIMITS\.maxNonStreamLiveMemoryBytes\)\} live memory/);
  assert.match(preflightBody, /if \(outputTooLarge\) pushRender\(this\.memoryCapRecovery\(\), 'output-size'\)/);
  assert.match(preflightBody, /Preflight\.memoryCapEstimateHint\(\)/);
});

test('export geometry respects video max height and logo bottom margin', () => {
  assert.match(script, /maxVideoH = Math\.max\(160, Math\.min\(LayoutConfig\.videoMaxHeight/);
  assert.match(script, /maxVideoH \* ratio/);
  assert.match(script, /h - LayoutConfig\.logoBottomMargin - lh/);
  assert.match(script, /let logoRect = null/);
  assert.match(script, /belowLogoY = logoRect\.y \+ logoRect\.h \+ 24/);
  assert.doesNotMatch(script, /const ly = h - LayoutConfig\.logoBottomMargin;/);
});

test('batch queue surfaces rejected files and continues item failures', () => {
  assert.match(script, /status: reason \? 'rejected' : 'queued'/);
  assert.match(script, /Batch added \$\{added\}, rejected \$\{rejected\}/);
  assert.match(script, /\['done', 'download-dispatched', 'error', 'rejected'\]\.includes\(item\.status\)/);
  assert.match(script, /Batch item failed:/);
  assert.match(script, /批量完成但有 \$\{failures\} 个错误/);
});

test('batch render distinguishes verified saves from unverified browser download dispatches', () => {
  const batchBody = script.match(/const BatchQueue = \{([\s\S]*?)\n\};\n\nconst AudioAnalysis/)?.[1] || '';
  assert.ok(batchBody, 'BatchQueue body should be present');
  const renderNextBody = batchBody.match(/async renderNext\(index\) \{([\s\S]*?)\n  \},\n\n  async start/)?.[1] || '';
  assert.ok(renderNextBody, 'BatchQueue.renderNext body should be present');
  assert.match(renderNextBody, /item\.downloadDispatched = !!result\.downloadDispatched/);
  assert.match(renderNextBody, /item\.saveVerified = !!result\.saveVerified/);
  assert.match(renderNextBody, /item\.retryAvailable = !!result\.retryAvailable/);
  assert.match(renderNextBody, /item\.status = result\.saveVerified \? 'done' : 'download-dispatched'/);
  assert.doesNotMatch(renderNextBody, /item\.status = 'done';\s*item\.outputName = result\.fileName/);

  assert.match(batchBody, /\['done', 'download-dispatched'\]\.includes\(item\.status\)/);
  assert.match(batchBody, /下载已触发，请检查文件/);
  assert.match(batchBody, /请检查文件|VERIFY FILES/);
  assert.doesNotMatch(batchBody, /failures \? `BATCH COMPLETE WITH \$\{failures\} ERRORS` : 'BATCH COMPLETE'/);
});

test('batch unverified downloads retain bounded per-item retry blobs', () => {
  assert.match(script, /maxBatchRetryBytes:\s*256 \* 1024 \* 1024/);
  const batchBody = script.match(/const BatchQueue = \{([\s\S]*?)\n\};\n\nconst AudioAnalysis/)?.[1] || '';
  assert.ok(batchBody, 'BatchQueue body should be present');
  assert.match(batchBody, /batchRetryBytes\(\)/);
  assert.match(batchBody, /releaseRetryForItem\(item, note = ''\)/);
  assert.match(batchBody, /pruneBatchRetryBlobs\(keepId = ''\)/);
  assert.match(batchBody, /retainRetryForItem\(item, result\)/);
  assert.match(batchBody, /saved\.fileName !== result\.fileName/);
  assert.match(batchBody, /saved\.bytes[\s\S]*?> LIMITS\.maxBatchRetryBytes/);
  assert.match(batchBody, /this\.pruneBatchRetryBlobs\(item\.id\)/);
  assert.match(batchBody, /retryDownload\(itemId\)/);
  assert.match(batchBody, /DownloadManager\.dispatchBlob\(item\.retryBlob, item\.outputName/);
  assert.match(batchBody, /批量下载已重试，请检查文件 \/ VERIFY FILE/);
  assert.match(batchBody, /retry\.dataset\.batchRetryId = item\.id/);
  assert.match(batchBody, /UI\.setControlReason\(retry, !!retryReason, retryReason, 'batch-summary'\)/);
  assert.match(batchBody, /this\.retainRetryForItem\(item, result\)/);

  const publicBatchBody = script.match(/window\.BatchQueue = Object\.freeze\(\{([\s\S]*?)\n\}\);/)?.[1] || '';
  assert.ok(publicBatchBody, 'public BatchQueue facade should be present');
  assert.match(publicBatchBody, /get status\(\)/);
  assert.match(publicBatchBody, /retryAvailable: !!item\.retryAvailable/);
  assert.doesNotMatch(publicBatchBody, /addFiles\(/);
  assert.doesNotMatch(publicBatchBody, /start\(/);
  assert.doesNotMatch(publicBatchBody, /requestCancel\(/);
  assert.doesNotMatch(publicBatchBody, /retryDownload\(/);
  assert.doesNotMatch(publicBatchBody, /clear\(/);
  assert.doesNotMatch(publicBatchBody, /retryBlob/);
});

test('batch clear requires explicit discard confirmation for unverified retryable outputs', () => {
  const batchBody = script.match(/const BatchQueue = \{([\s\S]*?)\n\};\n\nconst AudioAnalysis/)?.[1] || '';
  assert.ok(batchBody, 'BatchQueue body should be present');
  assert.match(batchBody, /_clearConfirmUntilMs:\s*0/);
  assert.match(batchBody, /_clearConfirmTimer:\s*null/);
  assert.match(batchBody, /hasProtectedClearOutputs\(\)/);
  assert.match(batchBody, /item\.status === 'download-dispatched' \|\| item\.retryAvailable \|\| item\.retryBlob/);
  assert.match(batchBody, /isClearConfirmArmed\(\)/);
  assert.match(batchBody, /this\.hasProtectedClearOutputs\(\) && this\._clearConfirmUntilMs > Date\.now\(\)/);
  assert.match(batchBody, /armClearDiscardConfirmation\(\)/);
  assert.match(batchBody, /this\._clearConfirmUntilMs = Date\.now\(\) \+ 5000/);

  const clearBody = batchBody.match(/clear\(\) \{([\s\S]*?)\n  \},\n\n  requestCancel/)?.[1] || '';
  assert.ok(clearBody, 'BatchQueue.clear body should be present');
  assert.match(clearBody, /if \(this\.hasProtectedClearOutputs\(\) && !this\.isClearConfirmArmed\(\)\) \{/);
  assert.match(clearBody, /this\.armClearDiscardConfirmation\(\)/);
  assert.match(clearBody, /清空批量会丢弃尚未验证保存的下载和可重试输出/);
  assert.ok(clearBody.indexOf('this.armClearDiscardConfirmation()') < clearBody.indexOf('Store.batch.items.forEach'));
  assert.match(clearBody, /this\.clearDiscardConfirmation\(\)/);
  assert.ok(clearBody.indexOf('this.clearDiscardConfirmation()') < clearBody.indexOf('Store.batch.items.forEach'));

  const renderBody = batchBody.match(/render\(\) \{([\s\S]*?)\n  \},\n\n  init/)?.[1] || '';
  assert.ok(renderBody, 'BatchQueue.render body should be present');
  assert.match(renderBody, /const clearConfirmArmed = this\.isClearConfirmArmed\(\)/);
  assert.match(renderBody, /const clearNeedsConfirmation = this\.hasProtectedClearOutputs\(\)/);
  assert.match(renderBody, /已等待确认丢弃/);
  assert.match(renderBody, /clearConfirmArmed \? '确认丢弃 \/ Discard' : '清空 \/ Clear'/);
  assert.match(renderBody, /Clearing will discard unverified retryable outputs/);
});

test('large audio analysis is safely skipped instead of freezing the tab', () => {
  assert.match(script, /maxAnalysisBytes/);
  assert.match(script, /maxAnalysisSeconds/);
  assert.match(script, /maxAnalysisDecodedBytes/);
  assert.match(script, /maxAnalysisWorkingSetBytes/);
  assert.match(script, /analysisAssumedSampleRate/);
  assert.match(script, /analysisAssumedChannels/);
  assert.match(script, /estimateDecodedAudioBytes\(durationSec/);
  assert.match(script, /safeDecodedAnalysisSeconds\(channels/);
  assert.match(script, /analysisSkipReason\(file, durationSec\)/);
  assert.match(script, /safe decoded analysis window/);
  assert.match(script, /Analysis skipped:/);
  assert.match(script, /Audio analysis skipped for this file; render can continue/);
});

test('preflight discloses audio analysis skipped failed cancelled and timeout states', () => {
  const preflightBody = script.match(/const Preflight = \{([\s\S]*?)\n\};\n\nconst Engine/)?.[1] || '';
  assert.ok(preflightBody, 'Preflight body should be present');
  assert.match(preflightBody, /audioAnalysisStatusLabel\(\)/);
  const statusBody = preflightBody.match(/audioAnalysisStatusLabel\(\) \{([\s\S]*?)\n  \},\n\n  getStatus/)?.[1] || '';
  assert.ok(statusBody, 'Preflight.audioAnalysisStatusLabel body should be present');
  assert.match(statusBody, /const status = Store\.audioAnalysis\.status/);
  assert.match(statusBody, /status === 'analyzing'[\s\S]*?Analyzing audio\.\.\./);
  assert.match(statusBody, /status === 'skipped'[\s\S]*?Analysis skipped/);
  assert.match(statusBody, /status === 'error'[\s\S]*?Analysis failed/);
  assert.match(statusBody, /status === 'timeout'[\s\S]*?Analysis timed out/);
  assert.match(statusBody, /status === 'cancelled'[\s\S]*?Analysis cancelled/);
  assert.match(statusBody, /Store\.audioAnalysis\.error \|\| Store\.audioAnalysis\.summary/);
  const resultAt = statusBody.indexOf('const analysis = Store.audioAnalysis.result');
  assert.ok(resultAt > 0, 'Preflight should still show completed audio analysis metrics');
  for (const status of ['analyzing', 'skipped', 'error', 'timeout', 'cancelled']) {
    const statusAt = statusBody.indexOf(`status === '${status}'`);
    assert.ok(statusAt >= 0, `Preflight should disclose ${status} analysis state`);
    assert.ok(statusAt < resultAt, `Preflight should show ${status} before stale metrics from a previous result`);
  }
  assert.match(preflightBody, /\['音频分析 \/ Audio Analysis', this\.audioAnalysisStatusLabel\(\)\]/);
  assert.doesNotMatch(preflightBody, /\['音频分析 \/ Audio Analysis', analysis \? `\$\{Utils\.formatBpm\(analysis\.bpm\)\}/);
});

test('render loop exposes performance budget misses and adaptive degradation', () => {
  assert.match(script, /renderMinFpsRatio:\s*0\.85/);
  assert.match(script, /renderMaxDropRate:\s*0\.08/);
  assert.match(script, /renderBudgetMissSamples:\s*3/);
  assert.match(script, /performanceThrottle:\s*false/);
  assert.match(script, /performanceWarning:\s*''/);

  const engineBody = script.match(/const Engine = \{([\s\S]*?)\n\};\n\nconst Recorder/)?.[1] || '';
  assert.ok(engineBody, 'Engine body should be present');
  assert.match(engineBody, /safeDrawFrame\(timestamp, context = Machine\.status\)/);
  assert.match(engineBody, /this\.safeDrawFrame\(t, 'IDLE'\)/);
  assert.match(engineBody, /this\.safeDrawFrame\(now, Machine\.status\)/);
  assert.doesNotMatch(engineBody, /this\.drawFrame\(t\);\n\s*\}\);/);
  assert.doesNotMatch(engineBody, /this\.drawFrame\(now\);\n\s*Store\.timing\.renderedFrames\+\+/);
  assert.match(engineBody, /evaluatePerformanceBudget\(\)/);
  assert.match(engineBody, /Store\.debug\.fps < Store\.config\.recordFps \* LIMITS\.renderMinFpsRatio/);
  assert.match(engineBody, /Store\.debug\.dropRate > LIMITS\.renderMaxDropRate/);
  assert.match(engineBody, /Store\.timing\.performanceThrottle = true/);
  assert.match(engineBody, /const performanceWarning = '性能预算未达标，已降低本次渲染的视觉效果 \/ Performance budget missed; reducing visual effects for this render'/);
  assert.match(engineBody, /UI\.showError\(performanceWarning, 'WARN'\)/);
  assert.match(engineBody, /timing\.skipHeavyLayers = !!timing\.performanceThrottle/);
  assert.match(engineBody, /this\.evaluatePerformanceBudget\(\)/);
  const motionBody = script.match(/const MotionPolicy = \{([\s\S]*?)\n\};\n\nconst BrowserStorage/)?.[1] || '';
  assert.ok(motionBody, 'MotionPolicy body should be present');
  assert.match(motionBody, /const performanceThrottled = !!Store\.timing\.performanceThrottle/);
  assert.match(motionBody, /performanceThrottled,/);
  assert.match(motionBody, /if \(!performanceThrottled\) return base/);
  assert.match(motionBody, /glitch: false/);
  assert.match(motionBody, /visSensitivity: base\.visSensitivity \* 0\.35/);
  assert.match(motionBody, /visFxIntensity: Math\.min\(base\.visFxIntensity \* 0\.35, 0\.35\)/);
  assert.match(motionBody, /visGlowAmount: Math\.min\(base\.visGlowAmount \* 0\.35, 0\.35\)/);
  assert.match(engineBody, /drawFrame\(timestamp\) \{[\s\S]*?AudioEngine\.freqBuffer && fxIntens > 0\.1 && !Store\.timing\.skipHeavyLayers/);
  assert.doesNotMatch(engineBody, /if \(!Store\.timing\.skipHeavyLayers\) ctx\.stroke\(\)/);

  const reportBody = script.match(/createReport\(exportInfo = \{\}\) \{([\s\S]*?)\n  \},\n\n  recordExport/)?.[1] || '';
  assert.ok(reportBody, 'RenderReport.createReport body should be present');
  assert.match(reportBody, /performanceHealth:/);
  assert.match(reportBody, /throttled: Store\.timing\.performanceThrottle/);
  assert.match(reportBody, /warning: Store\.debug\.performanceWarning/);
});

test('main thread long tasks feed the same visible performance guard path', () => {
  assert.match(script, /renderLongTaskWarningMs:\s*120/);
  assert.match(script, /longTaskCount:\s*0/);
  assert.match(script, /longestTaskMs:\s*0/);

  const engineBody = script.match(/const Engine = \{([\s\S]*?)\n\};\n\nconst Recorder/)?.[1] || '';
  assert.ok(engineBody, 'Engine body should be present');
  assert.match(engineBody, /setupPerformanceObserver\(\)/);
  assert.match(engineBody, /PerformanceObserver\.supportedEntryTypes/);
  assert.match(engineBody, /supportedEntryTypes\.includes\('longtask'\)/);
  assert.match(engineBody, /new PerformanceObserver/);
  assert.match(engineBody, /entryTypes:\s*\['longtask'\]/);
  assert.match(engineBody, /recordLongTask\(entry\.duration/);
  assert.match(engineBody, /recordLongTask\(durationMs\)/);
  assert.match(engineBody, /duration < LIMITS\.renderLongTaskWarningMs/);
  assert.match(engineBody, /Store\.debug\.longTaskCount \+= 1/);
  assert.match(engineBody, /Store\.debug\.longestTaskMs = Math\.max/);
  assert.match(engineBody, /this\.raisePerformanceWarning\('longtask'\)/);

  const reportBody = script.match(/createReport\(exportInfo = \{\}\) \{([\s\S]*?)\n  \},\n\n  recordExport/)?.[1] || '';
  assert.ok(reportBody, 'RenderReport.createReport body should be present');
  assert.match(reportBody, /longTaskCount: Store\.debug\.longTaskCount/);
  assert.match(reportBody, /longestTaskMs: Store\.debug\.longestTaskMs/);
});

test('performance guard evidence survives same-recording background resume', () => {
  const engineBody = script.match(/const Engine = \{([\s\S]*?)\n\};\n\nconst Recorder/)?.[1] || '';
  assert.ok(engineBody, 'Engine body should be present');
  assert.match(engineBody, /startLoop\(options = \{\}\)/);
  assert.match(engineBody, /const resetMetrics = options\.resetMetrics !== false/);
  assert.match(engineBody, /if \(resetMetrics\) this\.resetRenderMetrics\(\)/);
  const resetBody = engineBody.match(/resetRenderMetrics\(\) \{([\s\S]*?)\n  \},\n\n  startLoop/)?.[1] || '';
  assert.ok(resetBody, 'Engine.resetRenderMetrics body should be present');
  assert.match(resetBody, /Store\.timing\.droppedSinceStart = 0/);
  assert.match(resetBody, /Store\.debug\.fps = 0/);
  assert.match(resetBody, /Store\.debug\.dropRate = 0/);
  assert.match(resetBody, /Store\.debug\.longTaskCount = 0/);
  assert.match(resetBody, /Store\.timing\.performanceThrottle = false/);

  const recorderBody = script.match(/const Recorder = \{([\s\S]*?)\n\};\n\nwindow\.LIMITS/)?.[1] || '';
  assert.ok(recorderBody, 'Recorder body should be present');
  assert.match(recorderBody, /resumePreviewFromBackground\(\)[\s\S]*?Engine\.startLoop\(\{ resetMetrics: false \}\)/);
  assert.match(recorderBody, /resumeFromBackgroundIfNeeded\(\)[\s\S]*?Engine\.startLoop\(\{ resetMetrics: false \}\)/);

  const machineBody = script.match(/const Machine = \{([\s\S]*?)\n\};\n\nconst AssetManager/)?.[1] || '';
  assert.ok(machineBody, 'Machine body should be present');
  assert.match(machineBody, /if \(to === 'PREVIEWING' \|\| to === 'RECORDING'\) Engine\.startLoop\(\)/);
});

test('public runtime does not expose raw machine state mutators', () => {
  const machineBody = script.match(/const Machine = \{([\s\S]*?)\n\};\n\nconst AssetManager/)?.[1] || '';
  assert.ok(machineBody, 'Machine body should be present');
  assert.match(machineBody, /transition\(to\) \{/);
  assert.match(machineBody, /forceIdle\(\) \{/);
  assert.doesNotMatch(script, /window\.Machine\s*=\s*Machine/);
  assert.match(script, /window\.Machine\s*=\s*Object\.freeze\(\{\s*get status\(\) \{\s*return Machine\.status;\s*\}\s*\}\)/);
});

test('public runtime does not expose mutable project state and internal override knobs', () => {
  const storeBody = script.match(/const Store = \{([\s\S]*?)\n\};\n\nconst INTERNAL_RESTORE_APPLY_TOKEN/)?.[1] || '';
  assert.ok(storeBody, 'Store body should be present');
  assert.match(storeBody, /controlMutationOverrideDepth: 0/);
  assert.match(storeBody, /packageJob: \{ running: false/);
  assert.match(storeBody, /restoreJob: \{ running: false/);
  assert.match(storeBody, /batch: \{ items: \[\], running: false/);

  const projectBody = script.match(/const ProjectPresets = \{([\s\S]*?)\n\};\n\nconst ProjectPackage/)?.[1] || '';
  assert.ok(projectBody, 'ProjectPresets body should be present');
  assert.match(projectBody, /allowLockedMutation: Store\.flags\.controlMutationOverrideDepth > 0/);

  assert.doesNotMatch(script, /window\.Store\s*=\s*Store/);
  assert.doesNotMatch(script, /window\.LayoutConfig\s*=\s*LayoutConfig/);
  assert.doesNotMatch(script, /window\.LIMITS\s*=\s*LIMITS/);
  assert.doesNotMatch(script, /window\.BrowserStorage\s*=/);
  assert.doesNotMatch(script, /window\.ProjectPresets[\s\S]*importState\(raw\)/);
  assert.doesNotMatch(script, /showWarning\(message\) \{ return UI\.showError/);
  assert.match(script, /window\.LIMITS\s*=\s*Object\.freeze\(JSON\.parse\(JSON\.stringify\(LIMITS\)\)\)/);
  assert.match(script, /window\.LayoutConfig\s*=\s*Object\.freeze\(\{[\s\S]*get snapshot\(\) \{[\s\S]*return Object\.freeze\(\{ \.\.\.LayoutConfig \}\);[\s\S]*\}\s*\}\)/);
  assert.match(script, /window\.Store\s*=\s*Object\.freeze\(\{[\s\S]*get locks\(\) \{[\s\S]*package: Store\.packageJob\.running[\s\S]*restore: Store\.restoreJob\.running[\s\S]*batch: Store\.batch\.running[\s\S]*get snapshot\(\) \{[\s\S]*return JSON\.parse\(JSON\.stringify\(ProjectPresets\.exportState\(\)\)\);[\s\S]*\}\s*\}\)/);
});

test('public runtime exposes safe facades instead of internal mutation APIs', () => {
  const assetBody = script.match(/const AssetManager = \{([\s\S]*?)\n\};\n\nconst ProjectPresets/)?.[1] || '';
  const projectBody = script.match(/const ProjectPresets = \{([\s\S]*?)\n\};\n\nconst ProjectPackage/)?.[1] || '';
  const packageBody = script.match(/const ProjectPackage = \{([\s\S]*?)\n\};\n\nconst AutoSave/)?.[1] || '';
  const batchBody = script.match(/const BatchQueue = \{([\s\S]*?)\n\};\n\nconst AudioAnalysis/)?.[1] || '';
  const engineBody = script.match(/const Engine = \{([\s\S]*?)\n\};\n\nconst Recorder/)?.[1] || '';
  const recorderBody = script.match(/const Recorder = \{([\s\S]*?)\n\};\n\nwindow\.LIMITS/)?.[1] || '';

  assert.match(assetBody, /loadFile\(type, file, opts = \{\}\)/);
  assert.match(assetBody, /if \(opts\.allowLockedMutation\) return ''/);
  assert.match(projectBody, /projectMutationLockReason\(opts = \{\}\)/);
  assert.match(projectBody, /if \(opts\.allowLockedMutation\) return ''/);
  assert.match(packageBody, /currentPackageToken\(\)/);
  assert.match(packageBody, /finishPackageJob\(token\)/);
  assert.match(batchBody, /renderNext\(index\)/);
  assert.match(batchBody, /Recorder\.start\(\{ ignoreBatchLock: true \}\)/);
  assert.match(engineBody, /resetRenderMetrics\(\)/);
  assert.match(engineBody, /resetTimelineBase\(clockBaseSec = 0, source = 'MEDIA'\)/);
  assert.match(recorderBody, /cleanup\(partial\)/);
  assert.match(recorderBody, /resolveSaveWaiters\(result/);
  assert.match(recorderBody, /rejectSaveWaiters\(err\)/);
  assert.match(recorderBody, /_saveWaiters: \[\]/);

  for (const name of [
    'AssetManager',
    'ProjectPresets',
    'ProjectPackage',
    'AutoSave',
    'RenderReport',
    'CustomPresets',
    'BatchQueue',
    'Preflight',
    'BrandPresets',
    'AudioAnalysis',
    'AudioEngine',
    'Engine',
    'Recorder'
  ]) {
    assert.doesNotMatch(script, new RegExp(`window\\.${name}\\s*=\\s*${name}`));
    assert.match(script, new RegExp(`window\\.${name}\\s*=\\s*Object\\.freeze\\(\\{`));
  }

  const publicBlock = script.slice(script.indexOf('window.LIMITS ='), script.indexOf("window.addEventListener('load'"));
  assert.ok(publicBlock, 'public runtime export block should be present');
  for (const unsafeName of [
    'allowLockedMutation',
    'renderNext',
    'restoreProjectRuntime',
    'currentPackageToken',
    'finishPackageJob',
    'startPackageJob',
    'captureMutationGuard',
    'assertMutationGuard',
    'cleanup',
    'resolveSaveWaiters',
    'rejectSaveWaiters',
    '_saveWaiters',
    '_sessionId',
    'resetRenderMetrics',
    'resetTimelineBase',
    'checkReady',
    'triggerUpdate',
    'clearWarnings',
    'dismissError',
    'startLoop',
    'stopLoop',
    'setRoute',
    'downloadProject',
    'downloadPackage',
    'importPackageFile',
    'saveSnapshot',
    'restoreLatest',
    'refreshRecent',
    'downloadReport',
    'retryExportDownload',
    'saveCurrent',
    'applySelected',
    'deleteSelected',
    'addFiles',
    'requestCancel',
    'retryDownload',
    'applyPreset',
    'analyzeCurrentFile',
    'cancelAnalysis',
    'finish',
    'requestAbort',
    'togglePreview'
  ]) {
    assert.doesNotMatch(publicBlock, new RegExp(`\\b${unsafeName}\\b`), `public runtime should not expose ${unsafeName}`);
  }
  assert.doesNotMatch(publicBlock, /\bstart\(\) \{ return (BatchQueue|Recorder)\.start\(/);
  assert.doesNotMatch(publicBlock, /\bfinish\(\) \{ return Recorder\.finish\(/);
  assert.doesNotMatch(publicBlock, /\bcancel\(\) \{ return ProjectPackage\.cancelPackageJob\(/);
  assert.doesNotMatch(publicBlock, /\bclear\(\) \{ return BatchQueue\.clear\(/);
  assert.doesNotMatch(publicBlock, /importState\(raw\) \{ return ProjectPresets\.importState\(raw\); \}/);
  assert.match(publicBlock, /exportState\(\) \{ return JSON\.parse\(JSON\.stringify\(ProjectPresets\.exportState\(\)\)\); \}/);
});

test('recording background resume failures stay paused and expose an explicit retry control', () => {
  assert.match(html, /id="btn-retry-resume"[^>]*aria-describedby="status-text"/);
  assert.match(html, /#btn-retry-resume \{[^}]*order: 0;[^}]*position: sticky;[^}]*top: 74px/);
  assert.match(script, /Dom\['btn-retry-resume'\]\.addEventListener\('click', \(\) => Recorder\.retryBackgroundResume\(\)\.catch/);
  assert.doesNotMatch(script, /Click anywhere in the page to retry/);

  const recorderBody = script.match(/const Recorder = \{([\s\S]*?)\n\};\n\nwindow\.LIMITS/)?.[1] || '';
  assert.ok(recorderBody, 'Recorder body should be present');
  assert.match(recorderBody, /_resumeRetryArmed:\s*false/);

  const clearBody = recorderBody.match(/clearBackgroundResumeRetry\(\) \{([\s\S]*?)\n  \},\n\n  updateBackgroundResumeRetryControl/)?.[1] || '';
  assert.ok(clearBody, 'Recorder.clearBackgroundResumeRetry body should be present');
  assert.match(clearBody, /this\._resumeRetryArmed = false/);
  assert.match(clearBody, /this\.updateBackgroundResumeRetryControl\(\)/);

  const updateBody = recorderBody.match(/updateBackgroundResumeRetryControl\(\) \{([\s\S]*?)\n  \},\n\n  scheduleBackgroundResumeRetry/)?.[1] || '';
  assert.ok(updateBody, 'Recorder.updateBackgroundResumeRetryControl body should be present');
  assert.match(updateBody, /Dom\['btn-retry-resume'\]/);
  assert.match(updateBody, /this\._resumeRetryArmed && this\.bgPaused && Machine\.status === 'RECORDING' && !document\.hidden/);
  assert.match(updateBody, /btn\.style\.display = active \? 'block' : 'none'/);
  assert.match(updateBody, /UI\.setControlReason\(btn, !active, active \? '' : '暂时不能重试恢复', 'status-text'\)/);

  const scheduleBody = recorderBody.match(/scheduleBackgroundResumeRetry\(\) \{([\s\S]*?)\n  \},\n\n  async retryBackgroundResume/)?.[1] || '';
  assert.ok(scheduleBody, 'Recorder.scheduleBackgroundResumeRetry body should be present');
  assert.match(scheduleBody, /this\._resumeRetryArmed = true/);
  assert.match(scheduleBody, /this\.updateBackgroundResumeRetryControl\(\)/);
  assert.doesNotMatch(scheduleBody, /document\.addEventListener/);

  const retryBody = recorderBody.match(/async retryBackgroundResume\(\) \{([\s\S]*?)\n  \},\n\n  pauseForBackground/)?.[1] || '';
  assert.ok(retryBody, 'Recorder.retryBackgroundResume body should be present');
  assert.match(retryBody, /!this\._resumeRetryArmed \|\| document\.hidden \|\| !this\.bgPaused \|\| Machine\.status !== 'RECORDING'/);
  assert.match(retryBody, /this\.clearBackgroundResumeRetry\(\)/);
  assert.match(retryBody, /await this\.resumeFromBackgroundIfNeeded\(\)/);
  assert.doesNotMatch(recorderBody, /document\.addEventListener\('pointerdown'[\s\S]*resumeFromBackgroundIfNeeded/);
  assert.doesNotMatch(recorderBody, /document\.addEventListener\('keydown'[\s\S]*resumeFromBackgroundIfNeeded/);

  const resumeBody = recorderBody.match(/async resumeFromBackgroundIfNeeded\(\) \{([\s\S]*?)\n  \},\n\n  async start/)?.[1] || '';
  assert.ok(resumeBody, 'Recorder.resumeFromBackgroundIfNeeded body should be present');
  const resumeTryBody = resumeBody.match(/try \{([\s\S]*?)\n    \} catch \(e\) \{/)?.[1] || '';
  assert.ok(resumeTryBody, 'Recorder.resumeFromBackgroundIfNeeded try body should be present');
  assert.ok(resumeTryBody.indexOf('await AudioEngine.resume();') < resumeTryBody.indexOf('this.bgPaused = false;'));
  assert.ok(resumeTryBody.indexOf('await this.playMediaPair();') < resumeTryBody.indexOf('this.bgPaused = false;'));
  assert.match(resumeBody, /this\.clearBackgroundResumeRetry\(\)/);
  const catchBody = resumeBody.match(/\} catch \(e\) \{([\s\S]*?)\n    \}/)?.[1] || '';
  assert.ok(catchBody, 'Recorder.resumeFromBackgroundIfNeeded catch body should be present');
  assert.match(catchBody, /this\.bgPaused = true/);
  assert.match(catchBody, /if \(!this\._pauseStartMs\) this\._pauseStartMs = Date\.now\(\)/);
  assert.match(catchBody, /if \(this\.mr\?\.state === 'recording'\) this\.mr\.pause\(\)/);
  assert.match(catchBody, /this\.pauseMedia\(\)/);
  assert.match(catchBody, /Engine\.stopLoop\(\)/);
  assert.match(catchBody, /this\.scheduleBackgroundResumeRetry\(\)/);
  assert.match(catchBody, /UI\.showError\('录制恢复被浏览器自动播放策略阻止。请点击“重试恢复”继续。', 'WARN'\)/);
  assert.doesNotMatch(catchBody, /'FATAL'/);

  const finishBody = recorderBody.match(/finish\(\) \{([\s\S]*?)\n  \},\n\n  abort/)?.[1] || '';
  assert.ok(finishBody, 'Recorder.finish body should be present');
  assert.match(finishBody, /this\.clearBackgroundResumeRetry\(\)/);
  assert.ok(finishBody.indexOf('this.clearBackgroundResumeRetry();') < finishBody.indexOf('Machine.transition'));
});

test('pause-on-background handles WARMING instead of letting startup continue hidden', () => {
  const visibilityBody = script.match(/document\.addEventListener\('visibilitychange', \(\) => \{([\s\S]*?)\n    \}, \{ passive: true \}\);/)?.[1] || '';
  assert.ok(visibilityBody, 'visibilitychange handler should be present');

  const pauseBranch = visibilityBody.match(/if \(Store\.config\.pauseOnBackground\) \{([\s\S]*?)\n        \} else if/)?.[1] || '';
  assert.ok(pauseBranch, 'pauseOnBackground branch should be present');
  assert.match(pauseBranch, /st === 'WARMING'/);
  assert.match(pauseBranch, /UI\.showError\('Recording stopped: tab backgrounded during initialization', 'FATAL'\)/);
});

test('performance report preserves explicit zero export metrics and trigger context', () => {
  assert.match(script, /performanceTrigger:\s*''/);
  assert.match(script, /firstThrottleAtSec:\s*0/);
  assert.match(script, /Store\.debug\.performanceTrigger = trigger/);
  assert.match(script, /Store\.debug\.firstThrottleAtSec = Store\.timing\.visualTimeSec \|\| 0/);

  const reportBody = script.match(/createReport\(exportInfo = \{\}\) \{([\s\S]*?)\n  \},\n\n  recordExport/)?.[1] || '';
  assert.ok(reportBody, 'RenderReport.createReport body should be present');
  assert.match(reportBody, /actualFps: exportInfo\.actualFps \?\? Store\.debug\.fps \?\? 0/);
  assert.match(reportBody, /dropRate: Store\.debug\.dropRate \?\? 0/);
  assert.match(reportBody, /droppedFrames: exportInfo\.droppedFrames \?\? Store\.timing\.droppedSinceStart \?\? 0/);
  assert.match(reportBody, /trigger: Store\.debug\.performanceTrigger/);
  assert.match(reportBody, /budgetMissSamples: Store\.debug\.budgetMissSamples/);
  assert.match(reportBody, /firstThrottleAtSec: Store\.debug\.firstThrottleAtSec/);
  assert.match(reportBody, /thresholds: \{/);
  assert.match(reportBody, /minFpsRatio: LIMITS\.renderMinFpsRatio/);
  assert.match(reportBody, /maxDropRate: LIMITS\.renderMaxDropRate/);
  assert.match(reportBody, /longTaskWarningMs: LIMITS\.renderLongTaskWarningMs/);
});

test('render report distinguishes dispatched downloads from verified saves', () => {
  assert.match(script, /formatRecorderError\(event, mime\)/);
  assert.match(script, /event\?\.error \|\| event/);
  assert.match(script, /downloadDispatched: !!downloadResult\.downloadDispatched/);
  assert.match(script, /saveVerified: !!downloadResult\.saveVerified/);
  assert.match(script, /retryAvailable: !wasStreamSave && !!downloadResult\.downloadDispatched && !downloadResult\.saveVerified/);
  assert.match(script, /已触发下载/);
});

test('stream save rejects zero-byte finalized writers instead of reporting verified success', () => {
  const saveBody = script.match(/async save\(mime, sid = this\._sessionId\) \{([\s\S]*?)\n  \}\n\};/)?.[1] || '';
  assert.ok(saveBody, 'Recorder.save body should be present');

  const streamBranch = saveBody.match(/if \(wasStreamSave\) \{([\s\S]*?)\n    \} else if \(this\.chunks\.length\)/)?.[1] || '';
  assert.ok(streamBranch, 'Recorder.save stream-save branch should be present');
  assert.match(streamBranch, /outputBytes = this\.chunksBytes \|\| 0/);
  assert.match(streamBranch, /if \(!outputBytes\) \{[\s\S]*?this\.failExport\('No recorded data available', 'FATAL'\);[\s\S]*?return;[\s\S]*?\}/);
  assert.ok(streamBranch.indexOf('if (!outputBytes)') > streamBranch.indexOf('outputBytes = this.chunksBytes || 0;'));
  assert.ok(streamBranch.indexOf('if (!outputBytes)') < streamBranch.indexOf("successLog = 'EXPORT COMPLETE. (STREAM)';"));
  assert.ok(saveBody.indexOf('if (!outputBytes)') < saveBody.indexOf('saveVerified: !!downloadResult.saveVerified'));
});

test('mobile layout and core live regions are present', () => {
  assert.match(html, /@media \(max-width: 720px\)/);
  assert.match(html, /<aside class="sidebar" aria-labelledby="app-title">/);
  assert.match(html, /<h1 id="app-title">制作一段音乐视觉/);
  assert.match(html, /id="start-mode-actions" class="start-mode-actions" role="group" aria-label="开始"/);
  assert.match(html, /<main class="viewport" aria-labelledby="preview-title">/);
  assert.ok(html.indexOf('id="app-title"') < html.indexOf('id="start-controls"'), 'primary action deck should follow the app title in DOM order');
  assert.ok(html.indexOf('id="start-controls"') < html.indexOf('class="section"'), 'primary action deck should precede sidebar sections in DOM order');
  assert.ok(html.indexOf('class="status-bar"') < html.indexOf('class="section"'), 'status bar should precede sidebar sections in DOM order');
  assert.match(html, /flex-direction: column/);
  assert.match(html, /height: 100dvh/);
  assert.match(html, /\.sidebar > \.section \{ order: 3; \}/);
  assert.match(html, /\.sidebar > \.pro-section \{ order: 5; \}/);
  assert.match(html, /#start-controls,[\s\S]*?#stop-controls,[\s\S]*?#preview-controls[\s\S]*?order: 0;[\s\S]*?position: sticky/);
  assert.match(html, /\.primary-action-blocker \{[^}]*position: sticky;[^}]*top: 92px;[^}]*z-index: 39/);
  assert.match(html, /\.primary-action-blocker \{[^}]*max-height: 64px;[^}]*overflow-y: auto/);
  assert.match(html, /\.sidebar > \.status-bar \{ order: 0; flex: 0 0 32px; margin-top: 0; margin-bottom: 14px; position: sticky; top: 168px; z-index: 38; \}/);
  assert.doesNotMatch(html, /\.sidebar > \.section:first-of-type \{ order: 1; \}/);
  assert.match(html, /id="status-live"[^>]*role="status"[^>]*aria-live="polite"/);
  assert.match(html, /id="asset-input-summary"[^>]*role="status"[^>]*aria-live="polite"[^>]*aria-atomic="true"/);
  assert.match(html, /id="preflight-summary"[^>]*class="preflight-summary"[^>]*role="status"[^>]*aria-live="polite"[^>]*aria-atomic="true"/);
  assert.match(html, /role="dialog" aria-modal="true"/);
  assert.match(html, /aria-describedby="err-msg err-recovery"/);
  assert.match(html, /id="err-recovery"[^>]*>渲染已停止，未保存文件。回到编辑器检查预检后再重试。\/ Rendering stopped; no file was saved; return to the editor and check Preflight before trying again\./);
});

test('mobile preview canvas keeps a usable quality-check size', () => {
  assert.match(html, /\.viewport \{[^}]*min-width: 0;[^}]*padding: 12px;[^}]*box-sizing: border-box/);
  assert.match(html, /\.canvas-wrap \{[^}]*width: min\(calc\(90vh \* 9 \/ 16\), calc\(100% - 24px\)\);[^}]*height: auto;[^}]*max-height: 90vh/);

  const mobileCss = html.match(/@media \(max-width: 720px\) \{([\s\S]*?)\n\}/)?.[1] || '';
  assert.ok(mobileCss, 'mobile media query should be present');
  assert.match(mobileCss, /body[\s\S]*?overflow: hidden/);
  assert.doesNotMatch(mobileCss, /\.sidebar[\s\S]*?height: 50dvh/);
  assert.doesNotMatch(mobileCss, /\.viewport[\s\S]*?height: 50dvh/);
  assert.match(mobileCss, /\.sidebar[\s\S]*?height: 53dvh/);
  assert.match(mobileCss, /\.sidebar[\s\S]*?max-height: 55dvh/);
  assert.match(mobileCss, /\.sidebar[\s\S]*?overflow-y: auto/);
  assert.match(mobileCss, /\.viewport[\s\S]*?height: 47dvh/);
  assert.match(mobileCss, /\.canvas-wrap[\s\S]*?width: auto/);
  assert.match(mobileCss, /\.canvas-wrap[\s\S]*?height: min\(47dvh, calc\(\(100vw - 24px\) \* 16 \/ 9\)\)/);
  assert.doesNotMatch(mobileCss, /max-height: calc\(50dvh - 96px\)/);
  assert.match(html, /@media \(max-width: 720px\) and \(max-height: 520px\)/);
  assert.match(html, /@media \(max-width: 720px\)[\s\S]*?\.primary-action-blocker \{[\s\S]*?position: sticky;[\s\S]*?top: 72px/);
  assert.match(html, /@media \(max-width: 720px\)[\s\S]*?\.sidebar > \.status-bar \{[\s\S]*?position: sticky;[\s\S]*?top: 118px/);
  assert.match(mobileCss, /button[\s\S]*?min-height: 44px/);
  assert.match(mobileCss, /input\[type="text"\],[\s\S]*?select,[\s\S]*?\.file-upload-btn,[\s\S]*?\.primary-action-blocker \{[\s\S]*?min-height: 44px/);
  assert.match(html, /@media \(max-width: 720px\) and \(max-height: 520px\) \{[\s\S]*?\.sidebar \{[\s\S]*?height: 72dvh/);
  assert.match(html, /@media \(max-width: 720px\) and \(max-height: 520px\) \{[\s\S]*?body \{[\s\S]*?overflow-y: auto/);
  assert.match(html, /@media \(max-width: 720px\) and \(max-height: 520px\) \{[\s\S]*?\.viewport \{[\s\S]*?height: max\(240px, 28dvh\);[\s\S]*?min-height: 240px/);
  assert.match(html, /@media \(max-width: 720px\) and \(max-height: 520px\) \{[\s\S]*?\.canvas-wrap \{[\s\S]*?height: min\(240px, calc\(\(100vw - 16px\) \* 16 \/ 9\)\)/);
});

test('keyboard and assistive tech states expose commercial-grade focus feedback', () => {
  assert.match(html, /<html lang="zh-CN">/);
  assert.match(script, /uiLocale: 'zh-CN'/);
  assert.match(script, /formatUiTime\(date = new Date\(\)\)/);
  assert.match(script, /formatUiDateTime\(value\)/);
  assert.doesNotMatch(script, /toLocaleTimeString\(\[\]/);
  assert.doesNotMatch(script, /toLocaleString\(\)/);
  assert.match(html, /\.file-upload-wrapper:focus-within \.file-upload-btn/);
  assert.match(html, /id="progress-fill"[^>]*role="progressbar"[^>]*aria-valuemin="0"[^>]*aria-valuemax="100"[^>]*aria-label="渲染进度 \/ Render progress"/);
  assert.match(html, /id="primary-action-blocker"[^>]*tabindex="-1"[^>]*aria-describedby="preflight-summary"/);
  assert.match(html, /id="err-msg"[^>]*tabindex="0"[^>]*role="document"[^>]*aria-label="错误诊断详情"/);
  assert.match(html, /#err-msg:focus-visible \{[^}]*box-shadow: 0 0 0 2px rgba\(255, 68, 68, 0\.65\)/);
  assert.match(html, /id="in-font"[^>]*aria-label="字体 \/ Font family"/);
  assert.match(html, /id="in-logo-size"[^>]*aria-valuetext="Logo 尺寸 200px \/ 200 px logo size"/);
  assert.match(html, /id="in-logo-pos"[^>]*aria-valuetext="Logo 底部距离 180px \/ 180 px bottom margin"/);
  assert.match(html, /id="in-sensitivity"[^>]*aria-valuetext="音频响应灵敏度 100% \/ 100% audio response sensitivity"/);
  assert.match(html, /id="in-fx-intensity"[^>]*aria-valuetext="FX 强度 100% \/ 100% FX intensity"/);
  assert.match(html, /id="in-glow-amount"[^>]*aria-valuetext="辉光强度 100% \/ 100% glow strength"/);
  assert.match(script, /'in-logo-size': `Logo 尺寸 \$\{value\}px \/ \$\{value\} px logo size`/);
  assert.match(script, /'in-logo-pos': `Logo 底部距离 \$\{value\}px \/ \$\{value\} px bottom margin`/);
  assert.match(script, /'in-sensitivity': `音频响应灵敏度 \$\{value\}% \/ \$\{value\}% audio response sensitivity`/);
  assert.match(script, /'in-fx-intensity': `FX 强度 \$\{value\}% \/ \$\{value\}% FX intensity`/);
  assert.match(script, /'in-glow-amount': `辉光强度 \$\{value\}% \/ \$\{value\}% glow strength`/);
  assert.match(html, /\.range-control \{[^}]*grid-template-columns: minmax\(0, 1fr\) minmax\(58px, max-content\)/);
  assert.match(html, /\.range-value \{[^}]*min-width: 58px;[^}]*letter-spacing: 0;[^}]*white-space: nowrap/);
  assert.match(html, /id="out-logo-size"[^>]*for="in-logo-size"[^>]*>200 px<\/output>/);
  assert.match(html, /id="out-logo-pos"[^>]*for="in-logo-pos"[^>]*>180 px<\/output>/);
  assert.match(html, /id="out-sensitivity"[^>]*for="in-sensitivity"[^>]*>100%<\/output>/);
  assert.match(html, /id="out-fx-intensity"[^>]*for="in-fx-intensity"[^>]*>100%<\/output>/);
  assert.match(html, /id="out-glow-amount"[^>]*for="in-glow-amount"[^>]*>100%<\/output>/);
  assert.match(script, /enhanceSectionGroups\(\) \{/);
  assert.match(script, /document\.querySelectorAll\('\.sidebar > \.section'\)/);
  assert.match(script, /section\.setAttribute\('role', 'group'\)/);
  assert.match(script, /section\.setAttribute\('aria-labelledby', label\.id\)/);
  assert.match(script, /UI\.enhanceSectionGroups\(\)/);
  assert.match(html, /id="recent-projects"[^>]*aria-label="最近自动保存快照 \/ Recent autosave snapshots"/);
  assert.match(html, /id="btn-restore-selected"[^>]*aria-describedby="autosave-summary"/);
  assert.match(html, /id="in-custom-preset-name"[^>]*aria-label="自定义预设名称"/);
  assert.match(html, /id="custom-preset-list"[^>]*aria-label="已保存自定义预设 \/ Saved custom presets"/);
  assert.match(script, /moveFocusForState\(state, previousState\)/);
  assert.match(script, /updatePrimaryActionBlocker\(readiness\)/);
  assert.match(script, /const previewReady = readiness\.previewReady/);
  assert.match(script, /const recordReason = readiness\.recordReason/);
  assert.match(script, /const previewReason = readiness\.previewReason/);
  assert.match(script, /return \{[\s\S]*?recordReady,[\s\S]*?previewReady,[\s\S]*?recordReason,[\s\S]*?previewReason,[\s\S]*?estimatedSizeBytes/);
  assert.match(script, /if \(status\.recordReady && this\._lastSummaryText !== summaryText && Dom\['status-live'\]\)/);
  assert.match(script, /Dom\['status-live'\]\.textContent = summaryText/);
  assert.match(script, /blocker\.tabIndex = blocked \? 0 : -1/);
  assert.match(script, /document\.activeElement/);
  assert.match(script, /btn-finish/);
  assert.match(script, /btn-stop-preview/);
  assert.match(script, /isVisibleFocusable\(el\)/);
  assert.match(script, /focusRecoveryTarget\(\)/);
  assert.match(script, /this\.isVisibleFocusable\(this\._lastFocusedBeforeError\)/);
  assert.match(script, /syncRangeValueText\(id\)/);
  assert.match(script, /syncAllRangeValueText\(\)/);
  assert.match(script, /rangeDisplayText\(id, rawValue = Dom\[id\]\?\.value\)/);
  assert.match(script, /output\.textContent = displayText/);
});

test('state transitions refresh readiness before moving keyboard focus', () => {
  const updateStateBody = script.match(/updateState\(state, opts = \{\}\) \{([\s\S]*?)\n  \},\n  moveFocusForState/)?.[1] || '';
  assert.ok(updateStateBody, 'UI.updateState body should be present');
  const checkReadyAt = updateStateBody.indexOf("if (typeof Engine !== 'undefined') Engine.checkReady();");
  const moveFocusAt = updateStateBody.indexOf('this.moveFocusForState(state, previousState)');
  assert.ok(checkReadyAt >= 0, 'UI.updateState should refresh render readiness during state transitions');
  assert.ok(moveFocusAt >= 0, 'UI.updateState should still move keyboard focus during state transitions');
  assert.ok(checkReadyAt < moveFocusAt, 'render readiness must refresh before focus target selection');
});

test('state transition focus restore does not preserve non-editing file input focus', () => {
  const moveFocusBody = script.match(/moveFocusForState\(state, previousState\) \{([\s\S]*?)\n  \},\n  isVisibleFocusable/)?.[1] || '';
  assert.ok(moveFocusBody, 'UI.moveFocusForState body should be present');
  assert.match(moveFocusBody, /const isEditableFocus = \(el\) =>/);
  assert.match(moveFocusBody, /const isNonEditingInputFocus = \(el\) =>/);
  assert.match(moveFocusBody, /\['button', 'checkbox', 'color', 'file', 'image', 'radio', 'range', 'reset', 'submit'\]\.includes\(type\)/);

  const protectEditableAt = moveFocusBody.indexOf('if (isEditableFocus(active)) return false;');
  const restoreNonEditingInputAt = moveFocusBody.indexOf('if (isNonEditingInputFocus(active)) return true;');
  const preserveInteractiveAt = moveFocusBody.indexOf('return !isInteractiveFocus(active);');
  assert.ok(protectEditableAt >= 0, 'editable text focus should still be protected');
  assert.ok(restoreNonEditingInputAt >= 0, 'file/range/checkbox-like focus should be eligible for action focus restore');
  assert.ok(preserveInteractiveAt >= 0, 'other interactive controls should still be considered before stealing focus');
  assert.ok(protectEditableAt < restoreNonEditingInputAt, 'editable focus protection should run before non-editing input restore');
  assert.ok(restoreNonEditingInputAt < preserveInteractiveAt, 'non-editing inputs should not fall through to broad interactive-focus preservation');
});

test('disabled commercial actions expose stable visible blocker reasons', () => {
  for (const [buttonId, summaryId] of [
    ['btn-save-project', 'project-json-summary'],
    ['btn-load-project', 'project-json-summary'],
    ['btn-save-package', 'package-summary'],
    ['btn-load-package', 'package-summary'],
    ['btn-download-report', 'render-report-summary'],
    ['btn-retry-export-download', 'render-report-summary'],
    ['btn-start-batch', 'batch-summary'],
    ['btn-clear-batch', 'batch-summary'],
    ['btn-analyze-audio', 'audio-analysis-summary'],
    ['btn-preset-records', 'brand-preset-summary'],
    ['btn-preset-sample', 'brand-preset-summary'],
    ['btn-preset-promo', 'brand-preset-summary'],
    ['btn-preview', 'preflight-summary'],
    ['btn-rec', 'preflight-summary']
  ]) {
    assert.match(html, new RegExp(`id="${buttonId}"[^>]*aria-describedby="${summaryId}"`), `${buttonId} should point to ${summaryId}`);
  }
  const ids = domMapIds();
  assert.ok(ids.has('project-json-summary'), 'project JSON summary should be registered');
  assert.ok(ids.has('brand-preset-summary'), 'brand preset summary should be registered');
  assert.match(script, /setControlReason\(el, disabled, reason = '', describedById = ''\)/);
  assert.match(script, /el\.dataset\.disabledReason = displayReason/);
  assert.match(script, /ProjectPresets\.updateControls\(\)/);
  assert.match(script, /BrandPresets\.updateControls\(\)/);
  assert.match(script, /UI\.setControlReason\(Dom\['btn-save-project'\], !!saveReason, saveReason, 'project-json-summary'\)/);
  assert.match(script, /UI\.setControlReason\(Dom\['btn-load-project'\], !!loadReason, loadReason, 'project-json-summary'\)/);
  assert.match(script, /UI\.setControlReason\(button, !!reason, reason, 'brand-preset-summary'\)/);
  assert.match(script, /UI\.setControlReason\(btn, btn\.disabled, saveReason, 'package-summary'\)/);
  assert.match(script, /UI\.setControlReason\(Dom\['btn-start-batch'\], Dom\['btn-start-batch'\]\.disabled, startReason, 'batch-summary'\)/);
  assert.match(script, /UI\.setControlReason\(button, button\.disabled, buttonReason, 'audio-analysis-summary'\)/);
  assert.match(script, /UI\.setControlReason\(Dom\['btn-rec'\], Dom\['btn-rec'\]\.disabled, recordReason, 'preflight-summary'\)/);
});

test('shared disabled summaries expose action-specific reasons and ready states', () => {
  const customBody = script.match(/const CustomPresets = \{([\s\S]*?)\n\};\n\nconst BatchQueue/)?.[1] || '';
  assert.ok(customBody, 'CustomPresets body should be present');
  const customControlsBody = customBody.match(/updateControls\(\) \{([\s\S]*?)\n  \},\n\n  renderList/)?.[1] || '';
  assert.ok(customControlsBody, 'CustomPresets.updateControls body should be present');
  assert.match(customControlsBody, /const summary = Dom\['custom-preset-summary'\]/);
  assert.match(customControlsBody, /summary\.textContent = lockReason[\s\S]*?CUSTOM PRESETS LOCKED: \$\{lockReason\}/);
  assert.match(customControlsBody, /Choose a preset to apply or delete/);

  const packageBody = script.match(/updateControls\(\) \{([\s\S]*?)\n  \},\n\n  async exportPackageBlob/)?.[1] || '';
  assert.ok(packageBody, 'ProjectPackage.updateControls body should be present');
  assert.match(packageBody, /const saveStatus = saveReason \? `导出已阻止：\$\{UI\.localizeBusyReason\(saveReason\)\}` : `可导出：预计 \$\{Utils\.formatBytes\(estimate\)\}`/);
  assert.match(packageBody, /const loadStatus = loadReason \? `导入已阻止：\$\{UI\.localizeBusyReason\(loadReason\)\}` : '可导入'/);
  assert.match(packageBody, /const downloadStatus = lastDownload\.status === 'download-dispatched'/);
  assert.match(packageBody, /最近下载已触发，请检查文件/);
  assert.match(packageBody, /summary\.textContent = running[\s\S]*?`\$\{downloadStatus \? `\$\{downloadStatus\} \| ` : ''\}\$\{saveStatus\} \| \$\{loadStatus\}`/);
  assert.doesNotMatch(packageBody, /\? 'PACKAGE BLOCKED'/);

  const batchBody = script.match(/render\(\) \{([\s\S]*?)\n  \},\n\n  init/)?.[1] || '';
  assert.ok(batchBody, 'BatchQueue.render body should be present');
  assert.match(batchBody, /const addStatus = addReason \? `ADD BLOCKED: \$\{addReason\}` : 'ADD READY'/);
  assert.match(batchBody, /const startStatus = startReason \? `START BLOCKED: \$\{startReason\}` : 'START READY'/);
  assert.match(batchBody, /: `\$\{addStatus\} \| \$\{startStatus\}\$\{restoreIssue\}`/);
  assert.doesNotMatch(batchBody, /: 'QUEUE EMPTY'/);
});

test('disabled visible file buttons and normal status text meet commercial accessibility contracts', () => {
  assert.match(html, /\.file-upload-btn\[aria-disabled="true"\][\s\S]*?cursor: not-allowed/);
  assert.match(html, /\.file-upload-btn\[aria-disabled="true"\][\s\S]*?box-shadow: none/);
  assert.match(html, /\.file-upload-wrapper:hover \.file-upload-btn\[aria-disabled="true"\]/);
  assert.match(html, /\.file-upload-wrapper:focus-within \.file-upload-btn\[aria-disabled="true"\]/);
  assert.match(script, /el\.style\.color = \{ norm: '#888'/);
  assert.doesNotMatch(script, /norm: '#666'/);
});

test('project settings controls expose disabled reasons under global locks', () => {
  const settingIds = [
    'in-song', 'in-artist', 'in-label', 'in-font', 'in-glitch',
    'in-logo-size', 'in-logo-pos', 'in-fps', 'in-bitrate', 'in-bg-pause',
    'in-sensitivity', 'in-fx-intensity', 'in-glow-amount'
  ];
  for (const id of settingIds) {
    assert.match(html, new RegExp(`id="${id}"[^>]*aria-describedby="project-settings-summary"`), `${id} should expose the shared project settings lock reason`);
  }
  assert.match(html, /id="in-stream-save"[^>]*aria-describedby="stream-save-reason"/);
  const ids = domMapIds();
  assert.ok(ids.has('project-settings-summary'), 'project settings summary should be registered');

  const updateStateBody = script.match(/updateState\(state, opts = \{\}\) \{([\s\S]*?)\n  \},\n  updateStreamSaveControl/)?.[1] || '';
  assert.ok(updateStateBody, 'UI.updateState body should be present');
  assert.match(updateStateBody, /const projectSettingsReason = packageLock/);
  assert.match(updateStateBody, /Dom\['project-settings-summary'\]\.textContent = projectSettingsReason/);
  assert.match(updateStateBody, /this\.setControlReason\(Dom\[id\], hardLock, projectSettingsReason, 'project-settings-summary'\)/);
  assert.doesNotMatch(updateStateBody, /Dom\[id\]\.disabled = hardLock;/);
});

test('asset load failures remain visible in preflight after transient warnings', () => {
  assert.match(script, /assetErrors:\s*\{ video: '', audio: '', cover: '', logo: '' \}/);
  assert.match(script, /Store\.assetErrors\[type\] = message/);
  assert.match(script, /Store\.assetErrors\[type\] = why/);
  assert.match(script, /Store\.assetErrors\[type\] = ''/);
  assert.match(script, /assetStatus\(type, fallbackName\)/);
  assert.match(script, /Rejected: \$\{Store\.assetErrors\[type\]\}/);
  assert.match(script, /renderBlockers\(durationSec = this\.getAudioDuration\(\)\)/);
  assert.match(script, /Render Blocker/);
});

test('cover and logo images are hard-blocked when decoded dimensions are unsafe', () => {
  assert.match(script, /maxImageDim/);
  assert.match(script, /cover\/logo image dimension invalid/);
  assert.match(script, /IMAGE DIMENSION INVALID/);
  assert.match(script, /pixels > LIMITS\.maxImagePixels \|\| maxDim > LIMITS\.maxImageDim/);
  assert.doesNotMatch(script, /LARGE \$\{type\.toUpperCase\(\)\}[\s\S]*accepted, may reduce performance/);
});

test('asset load callbacks are token-gated and timeout-protected', () => {
  assert.match(script, /assetLoadSeq/);
  assert.match(script, /nextLoadToken\(type\)/);
  assert.match(script, /isCurrentLoad\(type, token\)/);
  const preflightBody = script.match(/preflightFile\(type, file, options = LIMITS\.warmupTimeoutMs\) \{([\s\S]*?)\n  \},\n  labelForType/)?.[1] || '';
  assert.ok(preflightBody, 'AssetManager.preflightFile body should be present');
  assert.match(preflightBody, /const opts = typeof options === 'number' \? \{ timeoutMs: options \} : \(options \|\| \{\}\)/);
  assert.match(preflightBody, /const hasCancelCheck = typeof opts\.cancelCheck === 'function'/);
  assert.match(preflightBody, /const assertNotCancelled = \(\) => \{/);
  assert.match(preflightBody, /cancelTid = setInterval\(rejectIfCancelled, 50\)/);
  assert.match(preflightBody, /clearInterval\(cancelTid\)/);
  assert.match(preflightBody, /const preflightTimeoutReason = \(\) => \(type === 'audio' && audioMetadataSeen \? 'audio duration unavailable' : `\$\{type\} preflight timeout`\)/);
  assert.match(preflightBody, /const finishAudioDurationIfReady = \(\) =>/);
  assert.match(preflightBody, /if \(!Number\.isFinite\(d\) \|\| d <= 0\) return false/);
  assert.match(preflightBody, /if \(d > LIMITS\.maxAudioSeconds\)/);
  assert.match(preflightBody, /el\.ondurationchange = \(\) => \{/);
  assert.match(preflightBody, /el\.oncanplay = \(\) => \{/);
  const loadFileBody = script.match(/loadFile\(type, file, opts = \{\}\) \{([\s\S]*?)\n  \},\n  bindFile/)?.[1] || '';
  assert.ok(loadFileBody, 'AssetManager.loadFile body should be present');
  assert.match(loadFileBody, /const token = this\.nextLoadToken\(type\)/);
  assert.match(loadFileBody, /const loadTimeoutReason = \(\) => \(type === 'audio' && audioMetadataSeen \? 'AUDIO DURATION UNAVAILABLE' : 'LOAD TIMEOUT'\)/);
  assert.match(loadFileBody, /setTimeout\(\(\) => fail\(loadTimeoutReason\(\)\), opts\.timeoutMs \|\| LIMITS\.warmupTimeoutMs\)/);
  assert.match(loadFileBody, /const acceptAudioDurationIfReady = \(\) =>/);
  assert.match(loadFileBody, /if \(!Number\.isFinite\(d\) \|\| d <= 0\) return false/);
  assert.match(loadFileBody, /if \(d > LIMITS\.maxAudioSeconds\)/);
  assert.match(loadFileBody, /el\.ondurationchange = \(\) => \{/);
  assert.match(loadFileBody, /el\.oncanplay = \(\) => \{/);
  assert.match(loadFileBody, /if \(!this\.isCurrentLoad\(type, token\)\) return/);
});

test('autosave has a quota-aware state-only fallback instead of forcing huge files into IndexedDB', () => {
  assert.match(script, /maxAutosaveAssetBytes/);
  assert.match(script, /buildAssetStoragePlan/);
  assert.match(script, /navigator\.storage\.estimate/);
  assert.match(script, /assetSaveSkippedReason/);
  assert.match(script, /hasAssetStorageBudget\(totalBytes, estimate\)/);
  assert.match(script, /storageRemainingBytes\(estimate\)/);
  assert.match(script, /reclaimAutosaveStorageBeforeFallback\(\)/);
  assert.match(script, /await this\.trimRecent\(\)/);
  assert.match(script, /await this\.trimAssets\(\)/);
  const planBody = script.match(/async buildAssetStoragePlan\(records = this\.currentAssetRecords\(\)\) \{([\s\S]*?)\n  \},\n\n  stateOnlyPlan/)?.[1] || '';
  assert.ok(planBody, 'AutoSave.buildAssetStoragePlan body should be present');
  assert.match(planBody, /let estimate = await this\.storageEstimate\(\)/);
  assert.match(planBody, /const recovered = await this\.reclaimAutosaveStorageBeforeFallback\(\)/);
  assert.match(planBody, /if \(recovered\) estimate = await this\.storageEstimate\(\)/);
  assert.match(planBody, /free\$\{suffix\}/);
  const snapshotBody = script.match(/snapshot\(id, source, assetRefs = \{\}, recordsLength = this\.currentAssetRecords\(\)\.length, assetSaveSkippedReason = '', state = ProjectPresets\.exportState\(\), capturedAt = Date\.now\(\), assetsStored = Object\.keys\(assetRefs \|\| \{\}\)\.length === recordsLength\) \{([\s\S]*?)\n  \},\n\n  putSnapshotRecords/)?.[1] || '';
  assert.ok(snapshotBody, 'AutoSave.snapshot body should be present');
  assert.match(snapshotBody, /assetsStored/);
  assert.match(script, /plan\.assetsStored/);
  assert.match(script, /ASSETS NOT INCLUDED/);
  assert.match(script, /STATE ONLY/);
  assert.match(script, /item\.assetSaveSkippedReason/);
});

test('batch abort stops the queue instead of continuing through remaining songs', () => {
  assert.match(script, /cancelRequested/);
  assert.match(script, /requestCancel\(reason = 'Batch cancelled'\)/);
  assert.match(script, /if \(Store\.batch\.running\) BatchQueue\.requestCancel/);
  assert.match(script, /if \(Store\.batch\.cancelRequested\) break/);
  assert.match(script, /BATCH CANCELLED/);
  assert.match(script, /const clearMain = Store\.batch\.running/);
  assert.match(script, /Dom\['btn-clear-batch'\]\.innerHTML = `<span class="btn-main">\$\{clearMain\}<\/span><span class="btn-sub">\$\{clearSub\}<\/span>`/);
  assert.match(script, /clearConfirmArmed \? '确认丢弃 \/ Discard' : '清空 \/ Clear'/);
  assert.match(script, /Dom\['btn-clear-batch'\]\.disabled = Store\.packageJob\.running \|\| Store\.restoreJob\.running \|\| Store\.autosaveJob\.running \|\| restoring \|\| cancelling \|\| \(!Store\.batch\.running && Machine\.status !== 'IDLE'\)/);
});

test('batch render restores the current project audio and metadata after it stops', () => {
  const batchBody = script.match(/const BatchQueue = \{([\s\S]*?)\n\};\n\nconst AudioAnalysis/)?.[1] || '';
  assert.ok(batchBody, 'BatchQueue body should be present');
  assert.match(batchBody, /captureProjectRuntime\(\)/);
  assert.match(batchBody, /restoreProjectRuntime\(snapshot\)/);
  const startBody = batchBody.match(/async start\(\) \{([\s\S]*?)\n  \},\n\n  render\(\)/)?.[1] || '';
  assert.ok(startBody, 'BatchQueue.start body should be present');
  assert.match(startBody, /const projectSnapshot = this\.captureProjectRuntime\(\)/);
  assert.ok(
    startBody.lastIndexOf('await this.restoreProjectRuntime(projectSnapshot)') < startBody.lastIndexOf('Store.batch.running = false'),
    'batch lock should remain active until project restore finishes'
  );

  const restoreBody = batchBody.match(/async restoreProjectRuntime\(snapshot\) \{([\s\S]*?)\n  \},\n\n  addFiles/)?.[1] || '';
  assert.ok(restoreBody, 'BatchQueue.restoreProjectRuntime body should be present');
  assert.match(restoreBody, /const previousSuppress = Store\.flags\.suppressAutosave/);
  assert.match(restoreBody, /Store\.flags\.suppressAutosave = true/);
  assert.match(restoreBody, /Store\.flags\.suppressAutosave = previousSuppress/);
  assert.match(restoreBody, /let audioRestored = false/);
  assert.match(restoreBody, /const restored = await AssetManager\.loadFile\('audio', snapshot\.rawAudio, \{ noAutosave: true, allowLockedMutation: true \}\)/);
  assert.match(restoreBody, /audioRestored = restored != null && !!Store\.flags\.assetValid\.audio/);
  assert.match(restoreBody, /AssetManager\.clearAsset\('audio'/);
  assert.match(restoreBody, /if \(audioRestored\) \{[\s\S]*?Store\.audioAnalysis = snapshot\.audioAnalysis/);
  assert.match(restoreBody, /AudioAnalysis\.reset\('ORIGINAL AUDIO RESTORE FAILED'\)/);
  assert.match(restoreBody, /ProjectPresets\.setText\('in-song', snapshot\.meta\.song/);
});

test('batch item audio loading is cancellable while media metadata is still pending', () => {
  const batchBody = script.match(/const BatchQueue = \{([\s\S]*?)\n\};\n\nconst AudioAnalysis/)?.[1] || '';
  assert.ok(batchBody, 'BatchQueue body should be present');
  const renderNextBody = batchBody.match(/async renderNext\(index\) \{([\s\S]*?)\n  \},\n\n  async start\(\)/)?.[1] || '';
  assert.ok(renderNextBody, 'BatchQueue.renderNext body should be present');
  assert.match(renderNextBody, /await AssetManager\.loadFile\('audio', item\.file, \{[\s\S]*?cancelCheck: \(\) => this\.throwIfBatchCancelled\(\)[\s\S]*?\}\)/);
});

test('batch project restore failures are durable in summary, report, and public status', () => {
  const batchBody = script.match(/const BatchQueue = \{([\s\S]*?)\n\};\n\nconst AudioAnalysis/)?.[1] || '';
  assert.ok(batchBody, 'BatchQueue body should be present');
  assert.match(script, /batch: \{ items: \[\], running: false, restoring: false, activeIndex: -1, cancelRequested: false, restoreFailed: false, restoreError: '' \}/);

  const restoreBody = batchBody.match(/async restoreProjectRuntime\(snapshot\) \{([\s\S]*?)\n  \},\n\n  batchMutationLockReason/)?.[1] || '';
  assert.ok(restoreBody, 'BatchQueue.restoreProjectRuntime body should be present');
  assert.match(restoreBody, /let restoreError = ''/);
  assert.match(restoreBody, /restoreError = Utils\.safeErrMsg\(err\)/);
  assert.match(restoreBody, /readiness refresh failed/);
  assert.match(restoreBody, /preview refresh failed/);
  assert.match(restoreBody, /return \{ ok: !restoreError, error: restoreError \}/);

  const startBody = batchBody.match(/async start\(\) \{([\s\S]*?)\n  \},\n\n  render\(\)/)?.[1] || '';
  assert.ok(startBody, 'BatchQueue.start body should be present');
  assert.match(startBody, /Store\.batch\.restoreFailed = false/);
  assert.match(startBody, /Store\.batch\.restoreError = ''/);
  assert.match(startBody, /Store\.batch\.restoring = true/);
  assert.match(startBody, /let restoreResult = \{ ok: true, error: '' \}/);
  assert.match(startBody, /restoreResult = await this\.restoreProjectRuntime\(projectSnapshot\)/);
  assert.match(startBody, /Store\.batch\.restoreFailed = restoreResult\?\.ok === false/);
  assert.match(startBody, /Batch render restore failed: \$\{Store\.batch\.restoreError\}/);
  assert.match(startBody, /Batch render restored original project/);
  assert.match(startBody, /Store\.batch\.running = false/);
  assert.match(startBody, /Store\.batch\.restoring = false/);
  assert.match(startBody, /Batch UI unlock refresh failed/);

  const renderBody = batchBody.match(/render\(\) \{([\s\S]*?)\n  \},\n\n  init\(\)/)?.[1] || '';
  assert.ok(renderBody, 'BatchQueue.render body should be present');
  assert.match(renderBody, /const restoreIssue = Store\.batch\.restoreFailed \? ` · RESTORE FAILED: \$\{Store\.batch\.restoreError \|\| 'original project restore failed'\}` : ''/);
  assert.match(renderBody, /const restoring = Store\.batch\.running && Store\.batch\.restoring/);
  assert.match(renderBody, /const cancelling = Store\.batch\.running && Store\.batch\.cancelRequested && !restoring/);
  assert.match(renderBody, /const batchRunStatus = restoring \? 'RESTORING PROJECT' : \(cancelling \? 'CANCELLING' : 'RUNNING'\)/);
  assert.match(renderBody, /restoring \? '恢复中 \/ Restoring' : \(cancelling \? '取消中 \/ Cancelling' : '取消 \/ Cancel'\)/);
  assert.match(renderBody, /restoring\s*\?\s*'Restoring original project after batch'/);
  assert.match(renderBody, /\$\{restoreIssue\}\$\{clearConfirmArmed \? ' · 已等待确认丢弃' : ''\} \| \$\{addStatus\} \| \$\{startStatus\}/);

  const clearBody = batchBody.match(/clear\(\) \{([\s\S]*?)\n  \},\n\n  requestCancel/)?.[1] || '';
  assert.ok(clearBody, 'BatchQueue.clear body should be present');
  assert.match(clearBody, /Store\.batch\.restoreFailed = false/);
  assert.match(clearBody, /Store\.batch\.restoreError = ''/);
  assert.match(clearBody, /Store\.batch\.restoring = false/);

  const publicBatchBody = script.match(/window\.BatchQueue = Object\.freeze\(\{([\s\S]*?)\n\}\);/)?.[1] || '';
  assert.ok(publicBatchBody, 'public BatchQueue facade should be present');
  assert.match(publicBatchBody, /restoring: Store\.batch\.restoring/);
  assert.match(publicBatchBody, /restoreFailed: !!Store\.batch\.restoreFailed/);
  assert.match(publicBatchBody, /restoreError: Store\.batch\.restoreError \|\| ''/);
});

test('autosave restore rehydrates matching saved audio analysis after audio reload resets it', () => {
  assert.match(script, /restoreAudioAnalysisForSnapshot\(snap, prepared\)/);
  assert.match(script, /analysisMatchesAudio\(analysis, file, ref\)/);
  const restoreAnalysisBody = script.match(/restoreAudioAnalysisForSnapshot\(snap, prepared\) \{([\s\S]*?)\n  \},\n\n  async applySnapshot/)?.[1] || '';
  assert.ok(restoreAnalysisBody, 'AutoSave.restoreAudioAnalysisForSnapshot body should be present');
  assert.match(restoreAnalysisBody, /const preserveCurrentAssets = snap\?\.assetsStored === false \|\| \(!snap\?\.assetsStored && Object\.keys\(assets\)\.length === 0\)/);
  assert.match(restoreAnalysisBody, /const currentAudio = preserveCurrentAssets \? Store\.rawFiles\.audio : null/);
  assert.match(restoreAnalysisBody, /prepared\?\.audio \|\| currentAudio/);
  assert.match(restoreAnalysisBody, /assets\.audio \|\| currentAudioRef/);
  const snapshotBody = autoSaveApplySnapshotBody();
  assert.match(snapshotBody, /this\.restoreAudioAnalysisForSnapshot\(snap, prepared\)/);
});

test('reduced-motion users do not get continuous decorative animation', () => {
  assert.match(html, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(html, /\.dynamic-bg,[\s\S]*?\.badge[\s\S]*?animation: none !important/);
  assert.match(html, /transition-duration: 0\.001ms !important/);
  assert.match(html, /button:active:not\(:disabled\) \{ transform: none; \}/);
  assert.match(script, /matchMedia\('\(prefers-reduced-motion: reduce\)'\)/);
  assert.match(script, /effectiveVisualConfig\(config = Store\.config\)/);
  const simulationBody = script.match(/updateSimulation\(dtSec\) \{([\s\S]*?)\n  \},\n\n  drawFrame/)?.[1] || '';
  assert.ok(simulationBody, 'Engine.updateSimulation body should be present');
  assert.match(simulationBody, /const motion = MotionPolicy\.effectiveVisualConfig\(\)/);
  assert.match(simulationBody, /if \(motion\.reducedMotion\) \{[\s\S]*?Store\.physics\.videoPulse = 0;[\s\S]*?Store\.physics\.breathPhase = 0;[\s\S]*?return;/);
  const drawBody = script.match(/drawFrame\(timestamp\) \{([\s\S]*?)\n  \}\n\};\n\nconst Recorder/)?.[1] || '';
  assert.ok(drawBody, 'Engine.drawFrame body should be present');
  assert.match(drawBody, /const motion = MotionPolicy\.effectiveVisualConfig\(\)/);
  assert.match(drawBody, /const glitchEnabled = !!motion\.glitch/);
  assert.match(drawBody, /const fxIntens = motion\.visFxIntensity/);
  assert.match(drawBody, /const cacheSizeChanged = c\.width !== cacheW \|\| c\.height !== cacheH/);
  assert.match(drawBody, /Store\.cache\.hasVideoFrame = false/);
  assert.match(drawBody, /const shouldDeferVideoFrameCache = Store\.timing\.skipHeavyLayers && Store\.cache\.hasVideoFrame && !cacheSizeChanged/);
  assert.match(drawBody, /if \(!shouldDeferVideoFrameCache\) \{[\s\S]*?Store\.cache\.videoFrameCtx\.drawImage\(video, 0, 0, c\.width, c\.height\)/);
  assert.match(drawBody, /const textWave = motion\.reducedMotion \? 0 : Math\.sin\(breathPhase\) \* 5 \* sens/);
  assert.match(script, /motionReduced: MotionPolicy\.reduced/);
});

test('long status filenames and errors cannot force horizontal panel overflow', () => {
  assert.match(html, /\.preflight-list li \{[^}]*min-width: 0/);
  assert.match(html, /\.preflight-list span,[\s\S]*?\.preflight-list b \{[^}]*min-width: 0/);
  assert.match(html, /overflow-wrap: anywhere/);
  assert.match(html, /text-overflow: ellipsis/);
});

test('state-only autosave restores keep current assets instead of destructive clearing', () => {
  const snapshotBody = autoSaveApplySnapshotBody();
  assert.match(snapshotBody, /const preserveCurrentAssets = snap\.assetsStored === false/);
  assert.match(snapshotBody, /ProjectPresets\.importState\(snap\.state, \{ silent: true, noAutosave: true, skipAudioAnalysis: true, allowLockedMutation: true \}\)/);
  assert.match(snapshotBody, /else if \(!preserveCurrentAssets\) \{[\s\S]*?assertGuards\(\);[\s\S]*?AssetManager\.clearAsset\(type, \{ allowLockedMutation: true \}\);[\s\S]*?\}/);
  assert.match(snapshotBody, /if \(preserveCurrentAssets\) this\.markMissingStateOnlyAssetReloads\(snap, prepared\)/);
  const reloadBody = script.match(/markMissingStateOnlyAssetReloads\(snap, prepared = \{\}\) \{([\s\S]*?)\n  \},\n\n  async applySnapshot/)?.[1] || '';
  assert.ok(reloadBody, 'AutoSave.markMissingStateOnlyAssetReloads body should be present');
  assert.match(reloadBody, /const listedAssets = ProjectPresets\.listedAssetRefs\(snap\?\.state\)/);
  assert.match(reloadBody, /if \(prepared\[type\] \|\| Store\.flags\.assetValid\[type\]\) return/);
  assert.match(reloadBody, /ProjectPresets\.markAssetReloadRequired\(type, name\)/);
  assert.match(reloadBody, /if \(marked\) Engine\.checkReady\(\)/);
  assert.match(snapshotBody, /CURRENT ASSETS KEPT/);
});

test('plain JSON project imports clear live assets to avoid silent mismatched renders', () => {
  assert.match(script, /clearLiveAssetsAfterJsonImport\(data\)/);
  const loadProjectBody = script.match(/async loadProjectFile\(file\) \{([\s\S]*?)\n  \},\n\n  init\(\)/)?.[1] || '';
  assert.ok(loadProjectBody, 'ProjectPresets.loadProjectFile body should be present');
  assert.match(loadProjectBody, /const data = JSON\.parse\(text\)/);
  assert.match(loadProjectBody, /this\.importState\(data, \{ silent: true, noAutosave: true, skipAudioAnalysis: true \}\)/);
  assert.match(loadProjectBody, /this\.clearLiveAssetsAfterJsonImport\(data\)/);
  const clearBody = script.match(/clearLiveAssetsAfterJsonImport\(data\) \{([\s\S]*?)\n  \},\n\n  init\(\)/)?.[1] || '';
  assert.ok(clearBody, 'ProjectPresets.clearLiveAssetsAfterJsonImport body should be present');
  assert.match(clearBody, /const listedAssets = this\.listedAssetRefs\(data\)/);
  assert.match(clearBody, /this\.markAssetReloadRequired\(type, name\)/);
  assert.match(clearBody, /PROJECT JSON LOADED — RELOAD LISTED ASSETS/);
  assert.match(clearBody, /PROJECT SETTINGS LOADED — ADD ASSETS/);
  assert.match(script, /markAssetReloadRequired\(type, name\) \{[\s\S]*?Store\.assetRefsMissing\[type\] = name/);

  const assetSummaryBody = script.match(/assetInputSummary\(\) \{([\s\S]*?)\n  \},\n  updateControls/)?.[1] || '';
  assert.ok(assetSummaryBody, 'AssetManager.assetInputSummary body should be present');
  assert.match(assetSummaryBody, /Store\.assetRefsMissing/);
  assert.match(assetSummaryBody, /ASSET RELOAD REQUIRED/);
});

test('plain JSON project imports save state-only recent entries without replacing latest autosave', () => {
  const loadProjectBody = script.match(/async loadProjectFile\(file\) \{([\s\S]*?)\n  \},\n\n  init\(\)/)?.[1] || '';
  assert.ok(loadProjectBody, 'ProjectPresets.loadProjectFile body should be present');
  assert.match(script, /jsonImportStateOnlyReason\(data\)/);
  assert.match(loadProjectBody, /AutoSave\.saveSnapshot\('project-json-import', \{ saveLatest: false, forceStateOnlyReason: this\.jsonImportStateOnlyReason\(data\) \}\)\.catch/);

  const saveSnapshotBody = script.match(/async saveSnapshot\(source = 'autosave', opts = \{\}\) \{([\s\S]*?)\n  \},\n\n  async trimRecent/)?.[1] || '';
  assert.ok(saveSnapshotBody, 'AutoSave.saveSnapshot body should be present');
  assert.match(saveSnapshotBody, /const saveLatest = opts\.saveLatest !== false/);
  assert.match(saveSnapshotBody, /if \(opts\.forceStateOnlyReason\) plan = this\.stateOnlyPlan\(plan\.records, opts\.forceStateOnlyReason\)/);
  assert.match(saveSnapshotBody, /this\.snapshot\(this\.latestKey, source, assetRefs, recordsLength, plan\.reason, state, capturedAt, plan\.assetsStored\)/);
  assert.match(saveSnapshotBody, /if \(saveLatest\) recent\.latestMirror = this\.latestKey/);
  assert.match(saveSnapshotBody, /latestWritten = await this\.putSnapshotRecords\(snap, recent, isLatestGeneration, \{ saveLatest \}\)/);
  assert.match(saveSnapshotBody, /if \(saveLatest && !latestWritten\)/);
});

test('plain JSON project imports roll back partial mutations after late failures', () => {
  const loadProjectBody = script.match(/async loadProjectFile\(file\) \{([\s\S]*?)\n  \},\n\n  init\(\)/)?.[1] || '';
  assert.ok(loadProjectBody, 'ProjectPresets.loadProjectFile body should be present');
  assert.match(loadProjectBody, /const previous = this\.captureRuntime\(\)/);
  assert.match(loadProjectBody, /const rollback = await this\.restoreRuntime\(previous\)/);
  assert.match(loadProjectBody, /Project JSON import failed with incomplete rollback/);
  assert.match(loadProjectBody, /Project JSON import failed and rollback was incomplete/);
});

test('recording startup failures unlock warming state and reject batch waiters', () => {
  const recorderBody = script.match(/const Recorder = \{([\s\S]*?)\n\};\n\nwindow\.LIMITS/)?.[1] || '';
  assert.ok(recorderBody, 'Recorder body should be present');
  const startBody = recorderBody.match(/async start\(opts = \{\}\) \{([\s\S]*?)\n  \},\n\n  finish\(\)/)?.[1] || '';
  assert.ok(startBody, 'Recorder.start body should be present');
  assert.match(startBody, /if \(!Machine\.transition\('WARMING'\)\) return false/);
  assert.match(startBody, /const sid = \+\+this\._sessionId/);
  const catchBody = startBody.match(/\} catch \(err\) \{([\s\S]*?)\n    \}/)?.[1] || '';
  assert.ok(catchBody, 'Recorder.start catch body should be present');
  assert.match(catchBody, /\['WARMING', 'RECORDING'\]\.includes\(Machine\.status\)/);
  assert.match(catchBody, /this\._aborting = true/);
  assert.match(catchBody, /if \(this\.mr && this\.mr\.state !== 'inactive'\)/);
  assert.match(catchBody, /this\.finalizeStreamSave\(false\)\.catch\(\(\) => \{\}\)/);
  assert.match(catchBody, /this\.cleanup\(false\)/);
  assert.match(catchBody, /this\.rejectSaveWaiters\(startErr\)/);
  assert.match(catchBody, /Machine\.forceIdle\(\)/);
  assert.match(catchBody, /UI\.resetProgress\(\)/);
  assert.ok(catchBody.indexOf('Machine.forceIdle();') < catchBody.indexOf("UI.showError('Stream save cancelled'"));
});

test('fatal Recorder.start failures preserve a failed render report before abort guards take over', () => {
  const recorderBody = script.match(/const Recorder = \{([\s\S]*?)\n\};\n\nwindow\.LIMITS/)?.[1] || '';
  assert.ok(recorderBody, 'Recorder body should be present');
  const startBody = recorderBody.match(/async start\(opts = \{\}\) \{([\s\S]*?)\n  \},\n\n  finish\(\)/)?.[1] || '';
  assert.ok(startBody, 'Recorder.start body should be present');
  assert.match(startBody, /this\._startEpochMs = Date\.now\(\);\s*this\._recordStartAudioSec = AudioEngine\.getAudioTime\(\);\s*this\._recordStartVisualSec = Store\.timing\.visualTimeSec;\s*this\._recordStopAudioSec = this\._recordStartAudioSec/);
  const baselineAt = startBody.indexOf('this._startEpochMs = Date.now();');
  assert.ok(startBody.indexOf('const sid = ++this._sessionId') < baselineAt);
  assert.ok(baselineAt < startBody.indexOf('const mime = Store.caps.recordMime || this.getSafeMime();'));
  const catchBody = startBody.match(/\} catch \(err\) \{([\s\S]*?)\n    \}/)?.[1] || '';
  assert.ok(catchBody, 'Recorder.start catch body should be present');
  assert.match(catchBody, /const startErr = this\.isUserCancel\(err\) \? new Error\('Render aborted'\) : this\.recordFailedExport\(err\)/);
  assert.ok(catchBody.indexOf('this.recordFailedExport(err)') < catchBody.indexOf('this._aborting = true'));
  assert.match(catchBody, /this\.rejectSaveWaiters\(startErr\)/);
});

test('recording startup failure reports reset current-run frame metrics before warmup failures', () => {
  const engineBody = script.match(/const Engine = \{([\s\S]*?)\n\};\n\nconst Recorder/)?.[1] || '';
  assert.ok(engineBody, 'Engine body should be present');
  assert.match(engineBody, /resetRenderMetrics\(\) \{/);
  const resetBody = engineBody.match(/resetRenderMetrics\(\) \{([\s\S]*?)\n  \},\n\n  startLoop/)?.[1] || '';
  assert.ok(resetBody, 'Engine.resetRenderMetrics body should be present');
  assert.match(resetBody, /Store\.timing\.droppedSinceStart = 0/);
  assert.match(resetBody, /Store\.timing\.renderedFrames = 0/);
  assert.match(resetBody, /Store\.debug\.fps = 0/);
  assert.match(resetBody, /Store\.debug\.dropRate = 0/);
  assert.match(resetBody, /Store\.debug\.longTaskCount = 0/);
  assert.match(resetBody, /Store\.timing\.performanceThrottle = false/);

  const startLoopBody = engineBody.match(/startLoop\(options = \{\}\) \{([\s\S]*?)\n  \},\n\n  stopLoop/)?.[1] || '';
  assert.ok(startLoopBody, 'Engine.startLoop body should be present');
  assert.match(startLoopBody, /if \(resetMetrics\) this\.resetRenderMetrics\(\)/);

  const recorderBody = script.match(/const Recorder = \{([\s\S]*?)\n\};\n\nwindow\.LIMITS/)?.[1] || '';
  assert.ok(recorderBody, 'Recorder body should be present');
  const startBody = recorderBody.match(/async start\(opts = \{\}\) \{([\s\S]*?)\n  \},\n\n  finish\(\)/)?.[1] || '';
  assert.ok(startBody, 'Recorder.start body should be present');
  const warmingAt = startBody.indexOf("if (!Machine.transition('WARMING')) return false");
  const resetAt = startBody.indexOf('Engine.resetRenderMetrics();');
  const sidAt = startBody.indexOf('const sid = ++this._sessionId');
  assert.ok(warmingAt >= 0 && resetAt > warmingAt, 'render metrics should reset after WARMING starts');
  assert.ok(sidAt > resetAt, 'render metrics should reset before startup failures can create a report');
});

test('Recorder.start cleans up if WARMING cannot transition to RECORDING', () => {
  const recorderBody = script.match(/const Recorder = \{([\s\S]*?)\n\};\n\nwindow\.LIMITS/)?.[1] || '';
  assert.ok(recorderBody, 'Recorder body should be present');
  const startBody = recorderBody.match(/async start\(opts = \{\}\) \{([\s\S]*?)\n  \},\n\n  finish\(\)/)?.[1] || '';
  assert.ok(startBody, 'Recorder.start body should be present');
  assert.doesNotMatch(startBody, /if \(!Machine\.transition\('RECORDING'\)\) return false/);
  const transitionFailure = startBody.match(/if \(!Machine\.transition\('RECORDING'\)\) \{([\s\S]*?)\n      \}/)?.[1] || '';
  assert.ok(transitionFailure, 'RECORDING transition failure branch should be present');
  assert.match(transitionFailure, /if \(this\._sessionId === sid && Machine\.status === 'WARMING'\) throw new Error\('Recording transition failed'\)/);
  assert.match(transitionFailure, /return false/);
  const catchBody = startBody.match(/\} catch \(err\) \{([\s\S]*?)\n    \}/)?.[1] || '';
  assert.ok(catchBody, 'Recorder.start catch body should be present');
  assert.match(catchBody, /const startErr = this\.isUserCancel\(err\) \? new Error\('Render aborted'\) : this\.recordFailedExport\(err\)/);
  assert.match(catchBody, /this\.rejectSaveWaiters\(startErr\)/);
  assert.match(catchBody, /Machine\.forceIdle\(\)/);
});

test('Recorder.start exposes a true or false contract for callers instead of silent returns', () => {
  const recorderBody = script.match(/const Recorder = \{([\s\S]*?)\n\};\n\nwindow\.LIMITS/)?.[1] || '';
  assert.ok(recorderBody, 'Recorder body should be present');
  const blockerBody = recorderBody.match(/renderStartBlocker\(opts = \{\}\) \{([\s\S]*?)\n  \},\n\n  async start/)?.[1] || '';
  assert.ok(blockerBody, 'Recorder.renderStartBlocker body should be present');
  assert.match(blockerBody, /if \(Store\.packageJob\.running\) \{[\s\S]*?return 'Package operation in progress\. Wait for it to finish before starting render\.'/);
  assert.match(blockerBody, /if \(Store\.restoreJob\.running\) \{[\s\S]*?return 'Project restore in progress\. Wait for it to finish before starting render\.'/);
  assert.match(blockerBody, /if \(Store\.autosaveJob\.running\) \{[\s\S]*?return 'Autosave in progress\. Wait for it to finish before starting render\.'/);
  assert.doesNotMatch(blockerBody, /if \(Store\.packageJob\.running\) throw/);
  assert.doesNotMatch(blockerBody, /if \(Store\.restoreJob\.running\) throw/);
  assert.match(blockerBody, /if \(!Store\.caps\.canRecord\) \{[\s\S]*?return 'Recording unsupported'/);
  assert.match(blockerBody, /const readiness = Preflight\.getRenderReadiness\(Preflight\.getAudioDuration\(\), \{ ignoreBatchLock: !!opts\.ignoreBatchLock \}\)/);
  assert.match(blockerBody, /if \(!readiness\.recordReady\) \{[\s\S]*?return readiness\.recordReason \|\| 'Inputs not ready'/);

  const startBody = recorderBody.match(/async start\(opts = \{\}\) \{([\s\S]*?)\n  \},\n\n  finish\(\)/)?.[1] || '';
  assert.ok(startBody, 'Recorder.start body should be present');
  assert.match(startBody, /const startBlocker = this\.renderStartBlocker\(opts\)/);
  assert.match(startBody, /if \(startBlocker\) \{[\s\S]*?UI\.showError\(startBlocker, 'WARN'\);[\s\S]*?return false/);
  assert.match(startBody, /const cleanupBlocker = this\.renderStartBlocker\(opts\)/);
  assert.match(startBody, /if \(cleanupBlocker\) \{[\s\S]*?UI\.showError\(cleanupBlocker, 'WARN'\);[\s\S]*?return false/);
  assert.doesNotMatch(startBody, /if \(Dom\['btn-rec'\]\.disabled\)/);
  assert.match(startBody, /if \(!Machine\.transition\('WARMING'\)\) return false/);
  assert.match(startBody, /if \(this\._aborting \|\| this\._sessionId !== sid\) return false/);
  assert.ok(startBody.indexOf('if (this._aborting || this._sessionId !== sid) return false;') > startBody.indexOf('await Promise.all(['));
  assert.ok(startBody.indexOf('if (this._aborting || this._sessionId !== sid) return false;') < startBody.indexOf('await this.playMediaPair();'));
  const warmupPlayAt = startBody.indexOf('await this.playMediaPair();');
  const warmupPostPlayGuardAt = startBody.indexOf('if (this._aborting || this._sessionId !== sid) {\n        this.pauseMedia();\n        return false;\n      }', warmupPlayAt);
  const warmupResetAt = startBody.indexOf('aud.pause();', warmupPlayAt);
  assert.ok(warmupPostPlayGuardAt > warmupPlayAt, 'Recorder.start should guard abort/stale state after warmup playback resolves');
  assert.ok(warmupPostPlayGuardAt < warmupResetAt, 'post-play abort guard should run before warmup pause/seek reset touches media');
  assert.match(startBody, /if \(!Machine\.transition\('RECORDING'\)\) \{[\s\S]*?return false;\s*\}/);
  assert.match(startBody, /return true;\s*\n    \} catch \(err\)/);
  const catchBody = startBody.match(/\} catch \(err\) \{([\s\S]*?)\n    \}/)?.[1] || '';
  assert.ok(catchBody, 'Recorder.start catch body should be present');
  assert.match(catchBody, /if \(this\._sessionId !== sid \|\| this\._aborting\) \{[\s\S]*?this\.pauseMedia\(\);[\s\S]*?return false/);
  assert.match(catchBody, /UI\.showError\('Stream save cancelled', 'WARN'\);\s*return false/);
  assert.match(catchBody, /UI\.showError\(Utils\.safeErrMsg\(err, 'Start failed'\), 'FATAL', \{ phase: failurePhase \}\);\s*return false/);
});

test('render save waiters are session scoped and explicitly cancellable', () => {
  const recorderBody = script.match(/const Recorder = \{([\s\S]*?)\n\};\n\nwindow\.LIMITS/)?.[1] || '';
  assert.ok(recorderBody, 'Recorder body should be present');
  const waitBody = recorderBody.match(/waitForNextSave\(timeoutMs = 120000, sid = this\._sessionId\) \{([\s\S]*?)\n  \},\n\n  resolveSaveWaiters/)?.[1] || '';
  assert.ok(waitBody, 'Recorder.waitForNextSave body should be present');
  assert.match(waitBody, /waiter = \{ resolve, reject, timer: null, sid, settled: false \}/);
  assert.match(waitBody, /promise\.sid = sid/);
  assert.match(waitBody, /promise\.cancel = \(reason = 'Render save cancelled'\) => this\.cancelSaveWaiter\(waiter, reason\)/);

  const settleBody = recorderBody.match(/settleSaveWaiter\(waiter, method, value\) \{([\s\S]*?)\n  \},\n\n  cancelSaveWaiter/)?.[1] || '';
  assert.ok(settleBody, 'Recorder.settleSaveWaiter body should be present');
  assert.match(settleBody, /if \(!waiter \|\| waiter\.settled\) return false/);
  assert.match(settleBody, /this\._saveWaiters = this\._saveWaiters\.filter\(\(item\) => item !== waiter\)/);

  const cancelBody = recorderBody.match(/cancelSaveWaiter\(waiter, reason = 'Render save cancelled'\) \{([\s\S]*?)\n  \},\n\n  resolveSaveWaiters/)?.[1] || '';
  assert.ok(cancelBody, 'Recorder.cancelSaveWaiter body should be present');
  assert.match(cancelBody, /this\.settleSaveWaiter\(waiter, 'reject', reason instanceof Error \? reason : new Error\(reason\)\)/);

  const resolveBody = recorderBody.match(/resolveSaveWaiters\(result, sid = this\._sessionId\) \{([\s\S]*?)\n  \},\n\n  rejectSaveWaiters/)?.[1] || '';
  assert.ok(resolveBody, 'Recorder.resolveSaveWaiters body should be present');
  assert.match(resolveBody, /if \(waiter\.sid === sid\) this\.settleSaveWaiter\(waiter, 'resolve', result\)/);
  assert.match(resolveBody, /else this\.settleSaveWaiter\(waiter, 'reject', new Error\('Stale render save waiter'\)\)/);
});

test('stream save finalize has its own timeout instead of hanging forever after recorder stop', () => {
  assert.match(script, /maxStreamFinalizeMs/);
  assert.match(script, /streamFinalizeWithTimeout\(promise, label\)/);
  assert.match(script, /Promise\.race\(\[promise, timeout\]\)/);
  assert.match(script, /Stream finalize timeout/);
  const finalizeBody = script.match(/async finalizeStreamSave\(commit\) \{([\s\S]*?)\n  \},\n\n  async togglePreview/)?.[1] || '';
  assert.ok(finalizeBody, 'Recorder.finalizeStreamSave body should be present');
  assert.match(finalizeBody, /if \(commit && this\._aborting\) return false/);
  assert.match(finalizeBody, /if \(this\._streamFinalizePromise\) return this\._streamFinalizePromise/);
  assert.match(finalizeBody, /this\._lastStreamFinalizeError = ''/);
  assert.match(finalizeBody, /await this\.streamFinalizeWithTimeout\(this\.writeChain, 'stream writes'\)/);
  assert.match(finalizeBody, /if \(commit && this\._aborting\) return false/);
  assert.match(finalizeBody, /await this\.streamFinalizeWithTimeout\(writer\.close\(\), 'stream close'\)/);
  assert.match(finalizeBody, /this\._lastStreamFinalizeError = Utils\.safeErrMsg\(e\)/);

  const onStopBody = script.match(/this\.mr\.onstop = async \(\) => \{([\s\S]*?)\n      \};/)?.[1] || '';
  assert.ok(onStopBody, 'MediaRecorder onstop body should be present');
  assert.match(onStopBody, /clearTimeout\(this\.finishTimer\)/);
  assert.match(onStopBody, /this\.finishTimer = null/);
  assert.match(onStopBody, /await this\.save\(mime, sid\)/);

  const cleanupBody = script.match(/cleanup\(partial\) \{([\s\S]*?)\n  \},\n\n  async save/)?.[1] || '';
  assert.ok(cleanupBody, 'Recorder.cleanup body should be present');
  assert.match(cleanupBody, /clearTimeout\(this\.finishTimer\)/);
  assert.match(cleanupBody, /this\.finishTimer = null/);

  const saveBody = script.match(/async save\(mime, sid = this\._sessionId\) \{([\s\S]*?)\n  \}\n\};/)?.[1] || '';
  assert.ok(saveBody, 'Recorder.save body should be session guarded');
  assert.match(saveBody, /const isCurrentExport = \(\) => !this\._aborting && this\._sessionId === sid && Machine\.status === 'EXPORTING'/);
  assert.match(saveBody, /if \(!isCurrentExport\(\)\) return/);
  assert.match(saveBody, /const detail = this\._lastStreamFinalizeError/);
  assert.match(saveBody, /detail \? `Stream save failed: \$\{detail\}` : 'Stream save failed'/);
  assert.match(saveBody, /failurePhase: 'stream-finalize'/);
  assert.ok(saveBody.indexOf('Machine.forceIdle();') < saveBody.indexOf('if (successLog) UI.log(successLog,'));
});

test('stream save write queue is bounded before slow writers can retain unlimited blobs', () => {
  const recorderBody = script.match(/const Recorder = \{([\s\S]*?)\n\};\n\nwindow\.LIMITS/)?.[1] || '';
  assert.ok(recorderBody, 'Recorder body should be present');
  assert.match(script, /maxStreamPendingBytes/);
  assert.match(recorderBody, /streamPendingBytes:\s*0/);
  assert.match(recorderBody, /streamPendingWrites:\s*0/);

  const enqueueBody = recorderBody.match(/enqueueWrite\(blob, sid\) \{([\s\S]*?)\n  \},\n\n  streamFinalizeWithTimeout/)?.[1] || '';
  assert.ok(enqueueBody, 'Recorder.enqueueWrite body should be present');
  assert.match(enqueueBody, /const pendingBytes = blob\.size \|\| 0/);
  assert.match(enqueueBody, /this\.streamPendingBytes \+= pendingBytes/);
  assert.match(enqueueBody, /this\.streamPendingWrites \+= 1/);
  assert.match(enqueueBody, /this\.streamPendingBytes > LIMITS\.maxStreamPendingBytes/);
  assert.match(enqueueBody, /this\.failExport\(`Streaming Save 磁盘写入积压超过 \$\{Utils\.formatBytes\(LIMITS\.maxStreamPendingBytes\)\}[\s\S]*?Streaming Save disk write backlog > \$\{Utils\.formatBytes\(LIMITS\.maxStreamPendingBytes\)\}[\s\S]*?'FATAL'\)/);
  assert.match(enqueueBody, /\.finally\(\(\) => \{[\s\S]*?this\.streamPendingBytes = Math\.max\(0, this\.streamPendingBytes - pendingBytes\)[\s\S]*?this\.streamPendingWrites = Math\.max\(0, this\.streamPendingWrites - 1\)/);
  assert.ok(enqueueBody.indexOf('this.streamPendingBytes += pendingBytes') < enqueueBody.indexOf('this.writeChain = this.writeChain'));
  assert.ok(enqueueBody.indexOf('LIMITS.maxStreamPendingBytes') < enqueueBody.indexOf('this.writeChain = this.writeChain'));
});

test('canvas title artist and footer text have a final ellipsis fit guard', () => {
  assert.match(script, /fitTextLine\(ctx, text, maxWidth\)/);
  assert.match(script, /drawFittedTextLine\(ctx, text, x, y, maxWidth\)/);
  assert.match(script, /this\.drawFittedTextLine\(ctx, Store\.meta\.song, w \/ 2, 1300 \+ textWave, w \* 0\.9\)/);
  assert.match(script, /this\.drawFittedTextLine\(ctx, Store\.meta\.artist, w \/ 2, 1380 \+ textWave \* 0\.65, w \* 0\.84\)/);
  assert.match(script, /const fittedText = this\.fitTextLine\(lCtx, text, maxWidth\)/);
});

test('stream finalize timeout also bounds cleanup abort after failures', () => {
  const recorderBody = script.match(/const Recorder = \{([\s\S]*?)\n\};\n\nwindow\.LIMITS/)?.[1] || '';
  assert.ok(recorderBody, 'Recorder body should be present');
  assert.match(recorderBody, /hasPendingStreamFinalize\(\) \{[\s\S]*?return !!this\._streamFinalizePromise/);

  const finalizeBody = script.match(/async finalizeStreamSave\(commit\) \{([\s\S]*?)\n  \},\n\n  async togglePreview/)?.[1] || '';
  assert.ok(finalizeBody, 'Recorder.finalizeStreamSave body should be present');
  assert.match(finalizeBody, /await this\.streamFinalizeWithTimeout\(writer\.abort\(\), 'stream cleanup abort'\)/);
  assert.doesNotMatch(finalizeBody, /await writer\.abort\(\)/);
});

test('preview startup failures recover without opening the fatal error modal', () => {
  const recorderBody = script.match(/const Recorder = \{([\s\S]*?)\n\};\n\nwindow\.LIMITS/)?.[1] || '';
  assert.ok(recorderBody, 'Recorder body should be present');
  const toggleBody = recorderBody.match(/async togglePreview\(\) \{([\s\S]*?)\n  \},\n\n  pausePreviewForBackground/)?.[1] || '';
  assert.ok(toggleBody, 'Recorder.togglePreview body should be present');
  const readinessAt = toggleBody.indexOf('const readiness = Preflight.getRenderReadiness()');
  const transitionAt = toggleBody.indexOf("if (!Machine.transition('PREVIEWING')) return");
  assert.ok(readinessAt >= 0, 'Recorder.togglePreview should check preview readiness before entering PREVIEWING');
  assert.ok(readinessAt < transitionAt, 'preview readiness should be checked before state transition');
  assert.match(toggleBody, /if \(!readiness\.previewReady\) \{[\s\S]*?UI\.showError\(readiness\.previewReason \|\| 'Inputs not ready for preview', 'WARN'\);[\s\S]*?return false/);
  assert.match(toggleBody, /if \(!Machine\.transition\('PREVIEWING'\)\) return/);
  const catchBody = toggleBody.match(/\} catch \(e\) \{([\s\S]*?)\n    \}/)?.[1] || '';
  assert.ok(catchBody, 'Recorder.togglePreview catch body should be present');
  assert.match(catchBody, /this\.pauseMedia\(\)/);
  assert.match(catchBody, /this\.resetPreviewMediaFlags\(\)/);
  assert.match(catchBody, /Engine\.stopLoop\(\)/);
  assert.match(catchBody, /AudioEngine\.setRoute\('IDLE'\)/);
  assert.match(catchBody, /Machine\.forceIdle\(\)/);
  assert.match(catchBody, /UI\.resetProgress\(\)/);
  assert.match(catchBody, /UI\.showError\(`Preview failed: \$\{Utils\.safeErrMsg\(e\)\}`, 'WARN'\)/);
  assert.doesNotMatch(catchBody, /'FATAL'/);
});

test('preview background resume failures return to idle instead of leaving stopped PREVIEWING UI', () => {
  const recorderBody = script.match(/const Recorder = \{([\s\S]*?)\n\};\n\nwindow\.LIMITS/)?.[1] || '';
  assert.ok(recorderBody, 'Recorder body should be present');
  const resumeBody = recorderBody.match(/async resumePreviewFromBackground\(\) \{([\s\S]*?)\n  \},\n\n  resetPreviewMediaFlags/)?.[1] || '';
  assert.ok(resumeBody, 'Recorder.resumePreviewFromBackground body should be present');
  const catchBody = resumeBody.match(/\} catch \(e\) \{([\s\S]*?)\n    \}/)?.[1] || '';
  assert.ok(catchBody, 'Recorder.resumePreviewFromBackground catch body should be present');
  assert.match(catchBody, /this\.pauseMedia\(\)/);
  assert.match(catchBody, /this\.resetPreviewMediaFlags\(\)/);
  assert.match(catchBody, /Engine\.stopLoop\(\)/);
  assert.match(catchBody, /AudioEngine\.setRoute\('IDLE'\)/);
  assert.match(catchBody, /Machine\.forceIdle\(\)/);
  assert.match(catchBody, /UI\.resetProgress\(\)/);
  assert.match(catchBody, /UI\.showError\('Preview resume blocked by browser autoplay policy\. Preview stopped; click Preview to restart\.', 'WARN'\)/);
  assert.doesNotMatch(catchBody, /'FATAL'/);
});

test('stopping preview restores preview-only media loop flags', () => {
  const recorderBody = script.match(/const Recorder = \{([\s\S]*?)\n\};\n\nwindow\.LIMITS/)?.[1] || '';
  assert.ok(recorderBody, 'Recorder body should be present');
  const resetStart = recorderBody.indexOf('resetPreviewMediaFlags()');
  const resetEnd = recorderBody.indexOf('\n  stopPreview()', resetStart);
  const resetBody = resetStart >= 0 && resetEnd > resetStart ? recorderBody.slice(resetStart, resetEnd) : '';
  assert.ok(resetBody, 'Recorder.resetPreviewMediaFlags body should be present');
  assert.match(resetBody, /Store\.assets\.audio\.loop = false/);
  assert.match(resetBody, /if \(!Store\.flags\.videoIsStaticImage\) Store\.assets\.video\.loop = false/);
  assert.match(resetBody, /if \(Store\.assets\.videoB\) Store\.assets\.videoB\.loop = false/);

  const stopStart = recorderBody.indexOf('stopPreview()');
  const stopEnd = recorderBody.indexOf('\n  clearBackgroundResumeRetry()', stopStart);
  const stopBody = stopStart >= 0 && stopEnd > stopStart ? recorderBody.slice(stopStart, stopEnd) : '';
  assert.ok(stopBody, 'Recorder.stopPreview body should be present');
  assert.match(stopBody, /this\.resetPreviewMediaFlags\(\)/);
  assert.match(stopBody, /Engine\.resetSecondaryVideoLoop\(\)/);
  assert.ok(stopBody.indexOf('this.pauseMedia();') < stopBody.indexOf('this.resetPreviewMediaFlags();'));
});

test('new renders wait for pending stream cleanup and stale finalizers cannot clear newer writers', () => {
  const recorderBody = script.match(/const Recorder = \{([\s\S]*?)\n\};\n\nwindow\.LIMITS/)?.[1] || '';
  assert.ok(recorderBody, 'Recorder body should be present');
  const waitBody = recorderBody.match(/async waitForPendingStreamFinalize\(\) \{([\s\S]*?)\n  \},\n\n  async togglePreview/)?.[1] || '';
  assert.ok(waitBody, 'Recorder.waitForPendingStreamFinalize body should be present');
  assert.match(waitBody, /if \(!this\._streamFinalizePromise\) return/);
  assert.match(waitBody, /const pending = this\._streamFinalizePromise/);
  assert.match(waitBody, /await pending\.catch\(\(\) => false\)/);

  const startBody = recorderBody.match(/async start\(opts = \{\}\) \{([\s\S]*?)\n  \},\n\n  finish\(\)/)?.[1] || '';
  assert.ok(startBody, 'Recorder.start body should be present');
  assert.ok(startBody.indexOf('await this.waitForPendingStreamFinalize();') < startBody.indexOf("Machine.transition('WARMING')"));

  const finalizeBody = recorderBody.match(/async finalizeStreamSave\(commit\) \{([\s\S]*?)\n  \},\n\n  async waitForPendingStreamFinalize/)?.[1] || '';
  assert.ok(finalizeBody, 'Recorder.finalizeStreamSave body should be present');
  assert.match(finalizeBody, /const writer = this\.writer/);
  assert.match(finalizeBody, /const finalizePromise = \(async \(\) => \{/);
  assert.match(finalizeBody, /if \(this\.writer === writer\) this\.disarmStreamSave\(\)/);
  assert.match(finalizeBody, /if \(this\._streamFinalizePromise === finalizePromise\) this\._streamFinalizePromise = null/);
});

test('Recorder.start revalidates render locks after pending stream cleanup before warming', () => {
  const recorderBody = script.match(/const Recorder = \{([\s\S]*?)\n\};\n\nwindow\.LIMITS/)?.[1] || '';
  assert.ok(recorderBody, 'Recorder body should be present');
  const blockerBody = recorderBody.match(/renderStartBlocker\(opts = \{\}\) \{([\s\S]*?)\n  \},\n\n  async start/)?.[1] || '';
  assert.ok(blockerBody, 'Recorder.renderStartBlocker body should be present');
  assert.match(blockerBody, /Store\.packageJob\.running/);
  assert.match(blockerBody, /Store\.restoreJob\.running/);
  assert.match(blockerBody, /Store\.audioAnalysis\.status === 'analyzing'/);
  assert.match(blockerBody, /!Store\.caps\.canRecord/);
  assert.match(blockerBody, /Preflight\.getRenderReadiness\(Preflight\.getAudioDuration\(\), \{ ignoreBatchLock: !!opts\.ignoreBatchLock \}\)/);

  const startBody = recorderBody.match(/async start\(opts = \{\}\) \{([\s\S]*?)\n  \},\n\n  finish\(\)/)?.[1] || '';
  assert.ok(startBody, 'Recorder.start body should be present');
  const firstBlockerAt = startBody.indexOf('const startBlocker = this.renderStartBlocker(opts)');
  const waitAt = startBody.indexOf('await this.waitForPendingStreamFinalize();');
  const secondBlockerAt = startBody.indexOf('const cleanupBlocker = this.renderStartBlocker(opts)');
  const warmingAt = startBody.indexOf("Machine.transition('WARMING')");
  assert.ok(firstBlockerAt >= 0, 'Recorder.start should check render blockers before cleanup wait');
  assert.ok(waitAt > firstBlockerAt, 'pending stream cleanup should wait after initial blocker check');
  assert.ok(secondBlockerAt > waitAt, 'Recorder.start should recheck blockers after cleanup wait');
  assert.ok(warmingAt > secondBlockerAt, 'Recorder.start should revalidate before entering WARMING');
  assert.match(startBody, /if \(cleanupBlocker\) \{[\s\S]*?UI\.showError\(cleanupBlocker, 'WARN'\);[\s\S]*?return false/);
});

test('fatal errors and selected file labels cannot force overflow', () => {
  assert.match(html, /#err-msg \{[^}]*overflow-wrap: anywhere/);
  assert.match(html, /\.file-upload-btn \{[^}]*overflow-wrap: anywhere/);
  assert.match(html, /\.file-upload-btn \{[^}]*text-overflow: ellipsis/);
  assert.match(html, /\.file-upload-btn \{[^}]*white-space: nowrap/);
});

test('legacy empty-asset autosave snapshots are treated as state-only restores', () => {
  const snapshotBody = autoSaveApplySnapshotBody();
  assert.match(snapshotBody, /const preserveCurrentAssets = snap\.assetsStored === false \|\| \(!snap\.assetsStored && Object\.keys\(assets\)\.length === 0\)/);
});

test('recording MIME support gates render readiness and is reported', () => {
  const engineBody = script.match(/const Engine = \{([\s\S]*?)\n\};\n\nconst Recorder/)?.[1] || '';
  assert.ok(engineBody, 'Engine body should be present');
  const initBody = engineBody.match(/init\(\) \{([\s\S]*?)\n  \},\n\n  rebuildGradient/)?.[1] || '';
  assert.ok(initBody, 'Engine.init body should be present');
  assert.match(initBody, /Store\.caps\.recordMime = Recorder\.getSafeMime\(\)/);
  assert.match(initBody, /Store\.caps\.canRecord = !!Store\.caps\.recordMime && typeof MediaRecorder !== 'undefined' && Store\.caps\.canCaptureStream/);

  const checkReadyBody = engineBody.match(/checkReady\(\) \{([\s\S]*?)\n  \},\n\n  triggerUpdate/)?.[1] || '';
  assert.ok(checkReadyBody, 'Engine.checkReady body should be present');
  assert.match(checkReadyBody, /const readiness = Preflight\.getRenderReadiness\(\)/);
  assert.match(checkReadyBody, /Dom\['btn-rec'\]\.disabled = !readiness\.recordReady/);

  const preflightBody = script.match(/const Preflight = \{([\s\S]*?)\n\};\n\nconst Engine/)?.[1] || '';
  assert.ok(preflightBody, 'Preflight body should be present');
  assert.match(preflightBody, /const mimeReady = !!Store\.caps\.recordMime/);
  assert.match(preflightBody, /const recordReady = blockers\.length === 0 && Store\.caps\.canRecord/);
  assert.match(preflightBody, /Recording MIME unsupported in this browser/);
  assert.match(preflightBody, /recording-mime/);

  const browserCapsBody = script.match(/browserCaps\(\) \{([\s\S]*?)\n  \},\n\n  assetManifest/)?.[1] || '';
  assert.ok(browserCapsBody, 'RenderReport.browserCaps body should be present');
  assert.match(browserCapsBody, /recordMime: Store\.caps\.recordMime/);
});

test('recording readiness waits for media canplay threshold before enabling render', () => {
  const engineBody = script.match(/const Engine = \{([\s\S]*?)\n\};\n\nconst Recorder/)?.[1] || '';
  assert.ok(engineBody, 'Engine body should be present');
  const checkReadyBody = engineBody.match(/checkReady\(\) \{([\s\S]*?)\n  \},\n\n  triggerUpdate/)?.[1] || '';
  assert.ok(checkReadyBody, 'Engine.checkReady body should be present');
  assert.match(checkReadyBody, /const readiness = Preflight\.getRenderReadiness\(\)/);
  assert.match(checkReadyBody, /Dom\['btn-rec'\]\.disabled = !readiness\.recordReady/);

  const preflightBody = script.match(/const Preflight = \{([\s\S]*?)\n\};\n\nconst Engine/)?.[1] || '';
  assert.ok(preflightBody, 'Preflight body should be present');
  assert.match(preflightBody, /const vRecordReady = vReady && v\.readyState >= 2/);
  assert.match(preflightBody, /const aRecordPlayable = aPreviewReady && a\.readyState >= 2/);
  assert.match(preflightBody, /Center visual not ready to play/);
  assert.match(preflightBody, /Audio not ready to play/);

  const batchReadyBody = engineBody.match(/getBatchRenderReadiness\(\) \{([\s\S]*?)\n  \},\n\n  checkReady/)?.[1] || '';
  assert.ok(batchReadyBody, 'Engine.getBatchRenderReadiness body should be present');
  assert.match(batchReadyBody, /Preflight\.getRenderReadiness\(Preflight\.getAudioDuration\(\), \{ ignoreBatchLock: true \}\)/);
});

test('recorder MIME selection controls stream save and download filenames', () => {
  const recorderBody = script.match(/const Recorder = \{([\s\S]*?)\n\};\n\nwindow\.LIMITS/)?.[1] || '';
  assert.ok(recorderBody, 'Recorder body should be present');
  const armBody = recorderBody.match(/async armStreamSave\(([\s\S]*?)\) \{([\s\S]*?)\n  \},\n\n  isUserCancel/) || [];
  assert.ok(armBody[2], 'Recorder.armStreamSave body should be present');
  assert.match(armBody[1], /mime = Store\.caps\.recordMime \|\| this\.getSafeMime\(\)/);
  assert.match(armBody[2], /const mimeBase = this\.mimeBase\(mime\)/);
  assert.match(armBody[2], /const ext = this\.extensionForMime\(mime\)/);
  assert.match(armBody[2], /suggestedName: this\.outputFileName\(mime\)/);
  assert.match(armBody[2], /\[mimeBase\]: \[`\.\$\{ext\}`\]/);

  const startBody = recorderBody.match(/async start\(opts = \{\}\) \{([\s\S]*?)\n  \},\n\n  finish\(\)/)?.[1] || '';
  assert.ok(startBody, 'Recorder.start body should be present');
  assert.match(startBody, /await this\.armStreamSave\(Store\.caps\.recordMime\)/);
  assert.match(startBody, /const mime = Store\.caps\.recordMime \|\| this\.getSafeMime\(\)/);
  assert.match(startBody, /Store\.caps\.recordMime = mime/);

  const saveBody = recorderBody.match(/async save\(mime, sid = this\._sessionId\) \{([\s\S]*?)\n  \}/)?.[1] || '';
  assert.ok(saveBody, 'Recorder.save body should be present');
  assert.match(saveBody, /outputFileName = this\.outputFileName\(mime\)/);
  assert.match(saveBody, /fileName: outputFileName \|\| this\.outputFileName\(mime\)/);
  assert.doesNotMatch(saveBody, /_openfad\.webm/);
});

test('export failure paths reject save waiters and record failed reports', () => {
  const recorderBody = script.match(/const Recorder = \{([\s\S]*?)\n\};\n\nwindow\.LIMITS/)?.[1] || '';
  assert.ok(recorderBody, 'Recorder body should be present');
  const recordFailureBody = recorderBody.match(/recordFailedExport\(reason, outputInfo = \{\}\) \{([\s\S]*?)\n  \},\n\n  failExport/)?.[1] || '';
  assert.ok(recordFailureBody, 'Recorder.recordFailedExport body should be present');
  assert.match(recordFailureBody, /const err = reason instanceof Error \? reason : new Error\(reason \|\| 'Export failed'\)/);
  assert.match(recordFailureBody, /RenderReport\.recordExport\(\{/);
  assert.match(recordFailureBody, /failed: true/);
  assert.match(recordFailureBody, /error: err\.message/);
  assert.match(recordFailureBody, /failurePhase: outputInfo\.failurePhase \|\| Machine\.status \|\| 'export'/);
  assert.match(recordFailureBody, /retryAvailable: !!outputInfo\.retryAvailable/);

  const failBody = recorderBody.match(/failExport\(reason, level = 'WARN', outputInfo = \{\}\) \{([\s\S]*?)\n  \},\n\n  bindTrackFailure/)?.[1] || '';
  assert.ok(failBody, 'Recorder.failExport body should be present');
  assert.match(failBody, /const err = this\.recordFailedExport\(reason, outputInfo\)/);
  assert.match(failBody, /this\.rejectSaveWaiters\(err\)/);
  assert.match(failBody, /Machine\.forceIdle\(\)/);

  const finishBody = recorderBody.match(/finish\(\) \{([\s\S]*?)\n  \},\n\n  abort/)?.[1] || '';
  assert.ok(finishBody, 'Recorder.finish body should be present');
  assert.match(finishBody, /return this\.failExport\('Recorder inactive during export', 'WARN'\)/);
  assert.match(finishBody, /this\.failExport\('Export forced to reset after extended timeout', 'WARN'\)/);
  assert.doesNotMatch(finishBody, /Export forced to reset after extended timeout'[\s\S]*?Machine\.forceIdle\(\)/);
});

test('fatal recorder dialogs preserve the failure phase after cleanup resets state', () => {
  const showErrorBody = script.match(/showError\(msg, level = 'FATAL'(?:, opts = \{\})?\) \{([\s\S]*?)\n  \},\n  dismissError/)?.[1] || '';
  assert.ok(showErrorBody, 'UI.showError body should be present');
  assert.match(script, /failureTitleForState\(state = Machine\.status\)/);
  assert.match(showErrorBody, /const failurePhase = opts\.phase \|\| Machine\.status/);
  assert.match(showErrorBody, /this\.failureTitleForState\(failurePhase\)/);

  const recorderBody = script.match(/const Recorder = \{([\s\S]*?)\n\};\n\nwindow\.LIMITS/)?.[1] || '';
  assert.ok(recorderBody, 'Recorder body should be present');
  const failBody = recorderBody.match(/failExport\(reason, level = 'WARN', outputInfo = \{\}\) \{([\s\S]*?)\n  \},\n\n  bindTrackFailure/)?.[1] || '';
  assert.ok(failBody, 'Recorder.failExport body should be present');
  assert.match(failBody, /const failurePhase = Machine\.status/);
  assert.ok(failBody.indexOf('const failurePhase = Machine.status') < failBody.indexOf('Machine.forceIdle();'));
  assert.match(failBody, /UI\.showError\(err\.message, level, \{ phase: failurePhase \}\)/);

  const startBody = recorderBody.match(/async start\(opts = \{\}\) \{([\s\S]*?)\n  \},\n\n  finish\(\)/)?.[1] || '';
  assert.ok(startBody, 'Recorder.start body should be present');
  const catchBody = startBody.match(/\} catch \(err\) \{([\s\S]*?)\n    \}/)?.[1] || '';
  assert.ok(catchBody, 'Recorder.start catch body should be present');
  assert.match(catchBody, /const failurePhase = Machine\.status/);
  assert.ok(catchBody.indexOf('const failurePhase = Machine.status') < catchBody.indexOf('Machine.forceIdle();'));
  assert.match(catchBody, /UI\.showError\(Utils\.safeErrMsg\(err, 'Start failed'\), 'FATAL', \{ phase: failurePhase \}\)/);
});

test('fatal aborts during active renders preserve failed render report evidence', () => {
  const showErrorBody = script.match(/showError\(msg, level = 'FATAL'(?:, opts = \{\})?\) \{([\s\S]*?)\n  \},\n  dismissError/)?.[1] || '';
  assert.ok(showErrorBody, 'UI.showError body should be present');
  assert.match(showErrorBody, /Recorder\.abort\(true, msg\)/);

  const recorderBody = script.match(/const Recorder = \{([\s\S]*?)\n\};\n\nwindow\.LIMITS/)?.[1] || '';
  assert.ok(recorderBody, 'Recorder body should be present');
  const abortBody = recorderBody.match(/abort\(isFatal = false, reason = ''\) \{([\s\S]*?)\n  \},\n\n  requestAbort/)?.[1] || '';
  assert.ok(abortBody, 'Recorder.abort body should be present');
  assert.match(abortBody, /const wasRenderActive = \['WARMING', 'RECORDING', 'EXPORTING'\]\.includes\(Machine\.status\) \|\| this\._saveWaiters\.length > 0/);
  assert.match(abortBody, /const err = new Error\(isFatal \? \(reason \|\| 'Render failed'\) : 'Render aborted'\)/);
  assert.match(abortBody, /if \(isFatal && wasRenderActive\) this\.recordFailedExport\(err\)/);
  assert.match(abortBody, /this\.rejectSaveWaiters\(err\)/);
});

test('failed render reports show failure state and root cause in the report panel', () => {
  const updatePanelBody = script.match(/updatePanel\(\) \{([\s\S]*?)\n  \},\n\n  init\(\)/)?.[1] || '';
  assert.ok(updatePanelBody, 'RenderReport.updatePanel body should be present');
  assert.match(updatePanelBody, /const failed = !!report\.output\.failed/);
  assert.match(updatePanelBody, /summary\.textContent = reportStale\s*\?\s*`REPORT STALE: \$\{report\.output\.staleReason \|\| 'Previous render'\}`[\s\S]*?: failed\s*\?\s*`REPORT FAILED: \$\{report\.output\.error \|\| 'Export failed'\}`/);
  assert.match(updatePanelBody, /\['保存状态', reportStale \? '上一次渲染已过期' : \(failed \? '失败' : \(report\.output\.saveVerified \? '已验证' : \(report\.output\.downloadDispatched \? \(retryAvailable \? '已触发下载 · 可重试' : '已触发下载'\) : '未知'\)\)\)\]/);
  assert.match(updatePanelBody, /if \(failed\) rows\.unshift\(\['错误', report\.output\.error \|\| '未知导出错误'\]\)/);
  assert.match(updatePanelBody, /if \(retryAvailable\) rows\.push\(\['恢复建议', '开始新渲染前，请先重试导出下载'\]\)/);
});

test('recorder onstop save exceptions settle export failure instead of leaving batch waiters pending', () => {
  const onStopBody = script.match(/this\.mr\.onstop = async \(\) => \{([\s\S]*?)\n      \};/)?.[1] || '';
  assert.ok(onStopBody, 'MediaRecorder onstop body should be present');
  const catchBody = onStopBody.match(/\} catch \(e\) \{([\s\S]*?)\n        \}/)?.[1] || '';
  assert.ok(catchBody, 'MediaRecorder onstop catch body should be present');
  assert.match(catchBody, /if \(!this\._aborting && this\._sessionId === sid\)/);
  assert.match(catchBody, /this\.failExport\(`Export failed: \$\{Utils\.safeErrMsg\(e\)\}`, 'FATAL'\)/);
  assert.doesNotMatch(catchBody, /UI\.showError\(`Export failed:/);
});

test('recorder error events are session guarded before failing the active export', () => {
  const onErrorBody = script.match(/this\.mr\.onerror = \(e\) => \{([\s\S]*?)\n      \};/)?.[1] || '';
  assert.ok(onErrorBody, 'MediaRecorder onerror body should be present');
  assert.match(onErrorBody, /if \(this\._aborting \|\| this\._sessionId !== sid\) return/);
  assert.match(onErrorBody, /if \(!\['RECORDING', 'EXPORTING'\]\.includes\(Machine\.status\)\) return/);
  assert.match(onErrorBody, /this\.failExport\(`Recorder error: \$\{this\.formatRecorderError\(e, mime\)\}`, 'FATAL'\)/);
  assert.ok(onErrorBody.indexOf('this._sessionId !== sid') < onErrorBody.indexOf('this.failExport('));
});

test('recording validates live canvas tracks and binds stream failure handlers', () => {
  const recorderBody = script.match(/const Recorder = \{([\s\S]*?)\n\};\n\nwindow\.LIMITS/)?.[1] || '';
  assert.ok(recorderBody, 'Recorder body should be present');
  const startBody = recorderBody.match(/async start\(opts = \{\}\) \{([\s\S]*?)\n  \},\n\n  finish\(\)/)?.[1] || '';
  assert.ok(startBody, 'Recorder.start body should be present');
  assert.match(startBody, /if \(!videoTrack \|\| videoTrack\.readyState !== 'live'\) throw new Error\('Canvas video track unavailable'\)/);
  assert.match(startBody, /if \(!audioTrack \|\| audioTrack\.readyState !== 'live'\) throw new Error\('Audio Routing Failed'\)/);
  assert.match(startBody, /this\.bindTrackFailure\(videoTrack, 'Canvas video', sid\)/);
  assert.match(startBody, /this\.bindTrackFailure\(audioTrack, 'Audio', sid\)/);
});
