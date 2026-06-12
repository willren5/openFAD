# openFAD Motion Batch Design

## Product Intent

openFAD Motion Batch is a local production console for turning finished square motion-cover videos into Apple Music upload-ready `1x1` and `3x4` deliverables with immediate QC feedback.

The product mood is calm, technical, and operational: a tool an internal label operator can keep open while preparing release assets, not a marketing surface.

## Information Architecture

Primary work areas:

- Job setup: input path, output path, render mode, encoder, frame rate, bitrate, container, QC-only and preview-only modes.
- Batch status: current job state, item count, elapsed state, pass/warn/fail totals, and current-process stop control.
- Queue: every discovered video, current processing state, target outputs, report path, and issue count.
- Preview: latest generated `3x4` safe-area preview, with a persistent crop reference when no image is available.
- Color: source probe drives automatic HDR/BT.2020/PQ to Rec.709 SDR conversion before QC, so users do not need a separate manual SDR export step.
- Frame rate: source probe preserves Apple-allowed source rates by default; unsupported source rates fall back to 30 fps, while manual overrides remain available.
- Output purity: generated deliverables must contain exactly one video stream; audio, data, subtitle, chapter, metadata, and QuickTime timecode tracks are stripped.
- Preflight safety: invalid frame-rate/bitrate values, batch output path collisions, and existing outputs fail before FFmpeg starts unless overwrite is explicitly enabled.
- Input and output safety: UI job creation validates the input path, rejects empty video folders, and reuses the batch output preflight before creating a queued job.
- Atomic outputs: rendered media and reports are written to temporary files first, then renamed into final paths after successful writes.
- QC: grouped errors and warnings from the JSON report, with fast links to the report and output folder.
- QC reliability: FFmpeg QC subprocess failures are surfaced as hard report errors.
- QC evidence: reports include a technical summary per target even when the status is PASS, covering codec, dimensions, duration, frame rate, bitrate, and color metadata.
- Encoder context: a batch/job resolves encoder availability and runtime smoke once, then reuses that result for every file in the batch.
- Stage progress: active rows expose encoder, probe, render, preview, QC, report, and cancel stages so long jobs are not opaque.
- Spec rail: Apple target dimensions, frame-rate bounds, bitrate bounds, color, audio, and black/freeze checks.

Navigation is single-screen. Settings and results stay visible together so operators can correct a bad batch without context switching.

## Layout Grid

Desktop grid:

- App shell: full viewport, dark neutral background.
- Left column: fixed `360px` setup panel.
- Center column: fluid queue and job log.
- Right column: `360px` preview and QC panel.
- Header: compact, `56px` high, status summary and primary actions.

Responsive grid:

- Below `1100px`, right column moves under the queue.
- Below `760px`, setup, queue, preview, and QC become a single column.
- Controls keep stable heights; table rows do not resize on hover or status change.

## Component Inventory

- App header with product name, local server state, and current job badge.
- Path fields with desktop-native picker buttons for input video, input folder, and output folder.
- Drop zone shell for local browser drag state and typed paths.
- Segmented mode control for `scale-fill` and `blur-extend`.
- Select controls for encoder and container.
- Text controls for frame rate and bitrate; frame rate defaults to `auto` so Apple-allowed source rates are preserved.
- Field-level validation for frame rate and bitrate before a job is queued.
- Toggle rows for QC-only and preview-only.
- Overwrite toggle for intentional replacement of existing outputs.
- Primary action buttons: dry run, start, stop current processing.
- Queue table with status chips, file name, target, issues, and actions.
- Stage chip inside the queue status cell for the current per-file phase.
- Preview frame with `2048x2732` ratio and safe-area overlay.
- QC issue list grouped by target and severity.
- Spec checklist rail.
- Toast/status strip for server and validation errors.

## Visual Tokens

Color roles:

- Background: `#111313`
- Panel: `#181b1b`
- Raised panel: `#202424`
- Hairline: `#303737`
- Text primary: `#f2f5f1`
- Text secondary: `#aeb8b2`
- Text muted: `#748079`
- Active cyan: `#3fd5e8`
- Pass green: `#64d98a`
- Warning amber: `#f2b84b`
- Fail red: `#f26d6d`
- Focus violet: `#a98cff`

Typography:

- Font stack: `Inter`, `SF Pro Text`, `Segoe UI`, system sans-serif.
- Header title: `18px / 1.2`, weight `700`.
- Panel title: `12px / 1.2`, uppercase, letter spacing `0`.
- Body: `13px / 1.45`.
- Dense table: `12px / 1.35`.
- Monospace paths and command output: `ui-monospace`, `SFMono-Regular`, `Consolas`.

Geometry:

- App padding: `14px`.
- Panel radius: `8px`.
- Control radius: `6px`.
- Row height: `44px` minimum.
- Icon button: `32px` square.
- Focus ring: `2px`, focus violet.

Motion:

- Hover transitions: `120ms ease`.
- Processing indicator: low-amplitude pulse only.
- No decorative background animation.

## Interaction States

Idle:

- Start and dry-run are enabled when input and output paths are valid.
- Stop is disabled.
- Queue shows no active job.

Dry run:

- Queue is populated with planned commands.
- No QC or preview asset is expected.
- Output paths are still shown.

Processing:

- Start and dry-run are disabled.
- Stop is enabled and requests cancellation of the current FFmpeg/FFprobe process.
- Current row has active cyan status.
- Current row shows the active stage, such as checking encoder, rendering `1x1`, rendering `3x4`, generating preview, QC, or writing reports.
- Logs append without shifting surrounding layout.

Stop requested:

- The active FFmpeg/FFprobe child process receives a termination request.
- Remaining files are skipped.
- Current job stage changes to cancel immediately, then cancelled after the child process exits.
- Job status becomes cancelled after the active child process exits.

Pass:

- Status uses pass green.
- Report and preview actions are enabled when assets exist.
- HTML and JSON reports still show technical output facts, not only an empty issue list.

Preview complete:

- Status uses pass green but says `预览完成`.
- It does not increment the QC pass count and does not present a QC report.

Warning:

- Status uses warning amber.
- Warnings stay visible even when the overall report has no hard errors.

Fail:

- Status uses fail red.
- The first actionable error is shown inline in the queue row.

## Empty, Loading, Error, Success

Empty:

- Preview frame shows the measured `3x4` safe-area outline.
- QC panel shows status chips for idle, processing, pass, warning, and fail.

Loading:

- Use skeleton rows only inside the queue table.
- Keep setup controls visible and stable.

Error:

- Server errors appear in the status strip and log panel.
- Per-item errors remain attached to their file row.
- Preflight errors such as invalid settings, output path collisions, or existing outputs are shown before any job is queued.

Success:

- Keep output paths, report path, and preview action in the same row.
- Do not replace the whole app with a success page.

## Accessibility Constraints

- All controls require visible labels.
- Keyboard focus must be visible on every button, field, select, and toggle.
- Status cannot rely on color alone; chips include text.
- Hit targets are at least `32px`.
- Text must not scale with viewport width.
- Paths wrap or truncate with middle ellipsis; they never overlap adjacent controls.

## Cross-Platform Notes

macOS:

- Reveal action should use Finder when running through the local Node bridge.
- UI encoder default is `auto`. VideoToolbox is intentionally outside this MVP until tested against Apple bitrate/QC requirements.

Windows:

- Reveal action should use Explorer.
- `auto` is the UI default. On Windows it checks GPU vendor and FFmpeg encoder availability, then runs a tiny runtime smoke encode before choosing NVENC or QSV; if the driver/runtime cannot open the hardware encoder, it falls back to x264.
- Encoder detection and runtime smoke are job-scoped, not global, so cancellation or a different FFmpeg path cannot poison a later job.
- Output paths should accept drive letters and backslashes.

Browser shell:

- Plain browser file pickers cannot reliably expose local paths, so browser mode keeps typed/pasted paths and a local Node bridge.
- Electron desktop mode exposes native path pickers through a narrow preload bridge; it does not enable Node integration in the renderer.

## Implementation Checklist

- Keep `src/spec.mjs`, `src/ffmpegArgs.mjs`, `src/qc.mjs`, and `src/encoder.mjs` as the render/QC source of truth.
- Add a local UI server under `ui/server.mjs`.
- Serve static assets under `ui/public/`.
- Add `npm run ui`.
- Add a server smoke test that does not require FFmpeg.
- Use a branded Windows app icon in packaged builds; default Electron chrome is not acceptable for commercial distribution.
- Add a Windows packaged-runtime smoke and evidence verifier that launch the built `.exe`, isolate `userData`, poison inherited video-tool paths, capture screenshots/job evidence, record explicit smoke outcome/release-gate eligibility, verify overwrite/cancel/reveal/error paths, reject full-render warnings, verify asset/file hashes, and ffprobe full-render outputs for exactly one video stream per Apple target.
- Update README with UI run commands.
- Verify `npm test`.
- Start the UI server and inspect the interface in a browser at desktop and mobile widths.
