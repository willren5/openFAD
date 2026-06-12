# Motion Batch v0.1.0 Verification

Date: 2026-06-13

## Environment

- Worktree: `/tmp/openFAD-public-main`, branch `ci-focus-fix`
- Source: migrated from an internal Motion Batch snapshot, then renamed and filtered for public openFAD release boundaries.
- Node: `v25.9.0`
- OS: macOS 26.3.1, build 25D2128, arm64

## Fresh Command Evidence

```bash
npm ci --prefix apps/motion-batch
```

Output summary:

- Added 315 packages.
- Audited 316 packages.
- Deprecated warnings were printed for transitive packages: `inflight`, `rimraf@2`, `glob@7`, and `boolean`.
- `found 0 vulnerabilities`.

```bash
npm test
```

Output summary from repository root:

- Cover Machine: `tests 1`, `pass 1`, `fail 0`.
- MV Studio: `tests 288`, `pass 288`, `fail 0`.
- Motion Batch: `tests 488`, `pass 488`, `fail 0`.
- Root scanner tests: `tests 7`, `pass 7`, `fail 0`.
- Motion Batch coverage included atomic outputs, batch recovery, render/QC failure paths, encoder selection, Chinese-first CLI/report diagnostics, desktop bridge security, UI state/recovery, source graph visibility, spec validation, single-stream enforcement, and local API hardening.

```bash
node --test --test-concurrency=1 test/cli.test.mjs test/report.test.mjs test/probe.test.mjs test/qc.test.mjs test/desktop-picker.test.mjs test/renderer-behavior.test.mjs test/ui-server.test.mjs
```

Output summary from `apps/motion-batch`:

- Node test runner summary: `tests 353`, `pass 353`, `fail 0`, `skipped 0`, `duration_ms 36918.531`.
- Regression covered CLI/report/probe/QC sanitization fixtures, native picker failures, renderer recovery paths, local UI metadata, UI bridge security, static serving, persistence, reveal, overwrite, cancellation, and sanitized diagnostics.

```bash
npm run scan:public
```

Output summary from repository root:

- `public safety scan passed`

```bash
git diff --check -- .
```

Output summary from repository root:

- No whitespace errors reported.

```bash
npm run package:web
```

Output summary from repository root:

- `openfad-cover-machine-0.1.0.zip` was generated with 10 files.
- `openfad-mv-studio-0.1.0.zip` was generated with 11 files.
- `openfad-motion-batch-source-0.1.0.zip` was generated with 57 files.
- All web/source packages include root `LICENSE`, `NOTICE`, and `TRADEMARKS.md`.
- Motion Batch source zip includes the Motion Batch `test/` suite.

```bash
npm run checksums
```

Output summary:

- `dist/SHA256SUMS` was written for the generated artifact set.
- Published artifact SHA256 values must be read from the release workflow's uploaded `SHA256SUMS` and `release-manifest.json`.

```bash
npm run release:manifest
```

Output summary from repository root:

- `dist/release-manifest.json` written with 3 artifacts.
- Motion Batch source manifest entry uses `platform: source` and `stability: Preview`.
- Before upload, the release owner must verify the published manifest `commit` equals the clean release commit selected for the tag.

## Covered Behaviors

- 中文首屏 README、quickstart、recovery 文档、CLI 诊断和 HTML QC 报告。
- Local UI and CLI entry points.
- Single video stream rule preserved in spec, FFmpeg args, QC, reports, and Windows smoke verifier.
- No committed `node_modules`, `dist`, `build`, vendor FFmpeg binaries, private outputs, local caches, or real release assets.
- Public package uses `@openfad/motion-batch`, `openfad-motion`, `OPENFAD_MOTION_*`, and openFAD output labels.
- Windows source package keeps the shell `7za` shim but does not carry 7zip or FFmpeg binaries.

## Release Artifact Evidence

- Source zip size and SHA256 are release-run outputs recorded in the uploaded `SHA256SUMS` and `release-manifest.json`.
- Source zip contains 14 Motion Batch `test/` files.
- Source zip includes root `LICENSE`, `NOTICE`, and `TRADEMARKS.md`.

## Remaining Publication Gates

- GitHub release artifact must match the uploaded `SHA256SUMS` and `release-manifest.json`.
- fadrecords.com `/openfad` must render the same checksum and manifest entry.
- Windows portable full-render smoke evidence is required before marking a Windows executable artifact trusted.

## Known Limits

- Motion Batch heavy rendering runs locally, not on fadrecords.com.
- Source zip is not a Windows executable artifact.
- Windows portable release requires separately prepared and verified FFmpeg/FFprobe binaries.
- FAD Records brand assets are not open licensed.

## Release Rule

Do not mark Motion Batch Windows artifact as trusted-release complete until full-render smoke evidence proves bundled video tools, screenshots, overwrite/cancel/reveal/error paths, checksums, and exactly one video stream for both Apple targets.
