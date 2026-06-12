# Cover Machine v0.1.0 Verification

Date: 2026-06-12

## Environment

- Worktree: isolated `openfad-trusted-release` branch worktree
- Base commit before Cover migration: `788a63b212e8260ca781e753bb43641d9b96511a`
- Release artifact set: `openfad-cover-machine-0.1.0.zip`
- Node: `v25.9.0`
- OS: macOS 26.3.1, build 25D2128

## Fresh Command Evidence

```bash
node --test apps/cover-machine/tests/phase0-cover-machine.test.mjs
```

Output summary:

- 11 Cover browser checks printed `PASS`.
- Node test runner summary: `pass 1`, `fail 0`.

```bash
npm run scan:public
```

Output summary:

- `public safety scan passed`

```bash
git diff --check -- .
```

Output summary:

- No whitespace errors reported.

```bash
npm test
```

Output summary from repository root:

- Cover Machine: `tests 1`, `pass 1`, `fail 0`.
- MV Studio: `tests 285`, `pass 285`, `fail 0`.
- Motion Batch: `tests 488`, `pass 488`, `fail 0`.
- Root scanner tests: `tests 6`, `pass 6`, `fail 0`.

```bash
npm run package:web
```

Output summary from repository root:

- `openfad-cover-machine-0.1.0.zip` - 84264 bytes, 9 files.
- Package includes root `LICENSE`, `NOTICE`, and `TRADEMARKS.md`.

```bash
npm run checksums
```

Cover artifact checksum:

```text
4bca4a2f7de91a9e2ec1135982222972f832c963979d1e4eb118f3c06c636bb8  openfad-cover-machine-0.1.0.zip
```

```bash
npm run release:manifest
```

Output summary:

- `dist/release-manifest.json` written with 3 artifacts.
- Cover manifest entry uses `platform: web`, `stability: Tested`, and the SHA256 above.
- Before upload, the release owner must verify the published manifest `commit` equals the clean release commit selected for the tag.

## Covered Behaviors

- 中文首屏和 Start Mode。
- Pro Mode 默认折叠。
- 公开安全示例背景和 Logo。
- Demo project validation reaches `READY`.
- 字号、背景裁切、自动保存和自定义预设。
- 大图上传。
- 项目 JSON metadata。
- 字体选择器预览和切换。
- 使用分析默认关闭，打开示例不会创建 telemetry session。

## Release Artifact Evidence

- Web zip size: 84264 bytes.
- Web zip SHA256: `4bca4a2f7de91a9e2ec1135982222972f832c963979d1e4eb118f3c06c636bb8`.
- Root release manifest records the Cover artifact as a browser web package, not an installed desktop runtime.
- Browser test coverage verifies export dispatch paths, but does not prove the operating system saved a file after the browser download prompt.

## Remaining Publication Gates

- GitHub release artifact must match this checksum.
- fadrecords.com `/openfad` must render the same checksum and manifest entry.
- Any future visual screenshot/export-sample claims need their own dated artifacts.

## Known Limits

- Browser renderer differences remain possible.
- Remote images may be blocked by cross-origin restrictions.
- FAD Records brand assets are not open licensed.

## Release Rule

Do not claim system-level file-save verification or FAD Records brand-asset licensing from this evidence. Public release wording must say this is a tested browser web package with SHA256 and manifest evidence.
