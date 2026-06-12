# MV Studio v0.1.0 Verification

Date: 2026-06-12

## Environment

- Worktree: isolated `openfad-trusted-release` branch worktree
- Source: migrated from an internal MV Studio snapshot, then public defaults were relabeled to openFAD demo copy.
- Node: `v25.9.0`
- OS: macOS 26.3.1, build 25D2128, arm64

## Fresh Command Evidence

```bash
npm run test:mv
```

Output summary:

- `tests 285`, `pass 285`, `fail 0`, `skipped 0`, `duration_ms 65069.402291`.
- Browser smoke covered Start Mode demo, visual systems, preflight, autosave, package import/export, render retry, batch render, performance guard, accessibility, and failure recovery paths.
- Static validation covered embedded script parsing, public output filenames, preflight copy, mobile layout, performance warning copy, and public runtime facades.

Screenshot evidence refreshed:

- `docs/verification/artifacts/mv-studio-demo-desktop.png`
- `docs/verification/artifacts/mv-studio-demo-mobile.png`
- `docs/verification/artifacts/mv-studio-preview-desktop.png`

Manual classification:

- `INTERNAL_RESTORE_APPLY_TOKEN` is a public-safe internal lock symbol name, not a credential or access token.
- The openFAD public default label is `openFAD Public Release`; the private `FAD Records Release` default was removed from the migrated app.
- Export filenames use `_openfad` and the regression test blocks `_FAD` / `Untitled FAD MV`.
- Runtime busy and performance warnings are Chinese-first, with English as secondary fallback.

```bash
npm run scan:public
git diff --check -- .
npm test
npm run package:web
npm run checksums
npm run release:manifest
```

Root release-gate summary:

- `npm run scan:public`: `public safety scan passed`.
- `git diff --check -- .`: no whitespace errors reported.
- Root `npm test`: Cover `pass 1`, MV `pass 285`, Motion `pass 488`, root scanner `pass 6`, all `fail 0`.
- `openfad-mv-studio-0.1.0.zip`: 100706 bytes, 11 files.
- MV web zip includes root `LICENSE`, `NOTICE`, and `TRADEMARKS.md`.
- MV web zip SHA256: `9c2c8a28697d8b1ae2d6c817091874118076486eb08bcad7c279f9adc149f3d0`.
- `dist/release-manifest.json` written with 3 artifacts; MV entry uses `platform: web`, `stability: Tested`, and the SHA256 above.
- Before upload, the release owner must verify the published manifest `commit` equals the clean release commit selected for the tag.

## Covered Behaviors

- 中文首屏和 Start Mode。
- Public-safe demo project path and openFAD demo labels.
- Three visual systems.
- Single-file local use through `apps/mv-studio/index.html`.
- Static validation harness can parse the embedded script.
- Browser smoke harness uses repository-local Playwright dependency.
- Mobile Pro Mode keeps the disclosure before advanced sections.
- Export/download retry paths remain covered by browser smoke.

## Release Artifact Evidence

- Web zip size: 100706 bytes.
- Web zip SHA256: `9c2c8a28697d8b1ae2d6c817091874118076486eb08bcad7c279f9adc149f3d0`.
- Screenshot evidence is stored under `docs/verification/artifacts/`.
- Browser smoke coverage verifies recording/export dispatch and recovery paths, but browser save behavior can still vary by renderer.

## Remaining Publication Gates

- GitHub release artifact must match this checksum.
- fadrecords.com `/openfad` must render the same checksum and manifest entry.
- Do not claim CI evidence unless `dist/release-manifest.json` has a non-empty `verification.ciRunUrl` for the release commit.

## Known Limits

- Browser recording and save behavior varies by browser.
- Heavy video rendering runs locally, not on fadrecords.com.
- FAD Records brand assets are not open licensed.

## Release Rule

Do not mark openFAD v0.1.0 as a trusted public release until the root release gate passes and the GitHub release, checksums, release manifest, verification docs, and website downloads all point to the same commit and artifact set.
