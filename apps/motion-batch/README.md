# openFAD Motion Batch

openFAD Motion Batch 是中文优先的本地批处理工具，用于把已经完成的方形 motion cover 视频转换为 Apple Music 常见交付素材，并生成可审查的 QC 报告。

它适合两类用户：

- 轻度用户：打开本地 UI，选择输入视频或文件夹，选择输出文件夹，点击开始。
- 深度用户：用 CLI、批处理、QC-only、preview-only、Windows portable smoke 和 release evidence 验证交付质量。

## 当前可信范围

- 当前公开 artifact 是源码包和本地 UI，不是在线重渲染服务。
- fadrecords.com 只展示下载、manifest、checksum 和使用说明，不在主站进程里跑 heavy render。
- Windows runtime 只有在 `verify:smoke:win` 的 full-render evidence 通过后，才可以标成 `Stable`。

## 立即使用

```bash
cd apps/motion-batch
npm ci
npm run ui
```

打开：

```text
http://127.0.0.1:4387
```

然后：

1. 在“输入”选择一个 `.mov` / `.mp4`，或选择一个视频文件夹。
2. 在“输出”选择一个空文件夹。
3. 保持默认 `auto` 帧率、`50M` 码率、`mp4` 容器。
4. 点击“开始处理”。
5. 查看队列状态、预览图、JSON / HTML QC 报告。

成功标准：输出文件夹里出现 `1x1`、`3x4`、安全区预览 PNG、JSON 报告和 HTML 报告；报告里不应有阻塞性的 QC fail。

## 交付内容

- `3840x3840` Apple Music `1x1`
- `2048x2732` Apple Music `3x4`
- `3x4` 安全区预览 PNG
- JSON 和 HTML QC 报告
- HDR / BT.2020 / PQ 到 Rec.709 SDR 的自动转换
- 单一 video stream 输出：音频、data、subtitle、chapter、metadata、QuickTime timecode 都会剥离
- 默认不覆盖已有输出；只有显式开启 overwrite 才会替换
- 阶段级进度：encoder、probe、render、preview、QC、report、cancel 都有可见状态

## CLI

```bash
node ./src/cli.mjs "/path/to/input-folder" --out "/path/to/output" --container mov
```

仅预检和查看计划：

```bash
node ./src/cli.mjs "/path/to/input.mov" --out ./out --dry-run
```

仅检查已有 Apple-format 交付物：

```bash
node ./src/cli.mjs "/path/to/apple-3x4.mov" --out ./out --qc-only
```

仅生成 `3x4` 安全区预览：

```bash
node ./src/cli.mjs "/path/to/input.mov" --out ./out --preview-only
```

有意覆盖已有输出：

```bash
node ./src/cli.mjs "/path/to/input.mov" --out ./out --overwrite
```

## 依赖

- Node.js 20+
- `ffmpeg` 和 `ffprobe`

macOS:

```bash
brew install ffmpeg
```

Windows 可以把 FFmpeg 的 `bin` 加入 `PATH`，也可以显式传路径：

```powershell
node .\src\cli.mjs .\input --ffmpeg C:\ffmpeg\bin\ffmpeg.exe --ffprobe C:\ffmpeg\bin\ffprobe.exe
```

## Windows 打包门槛

源码包不携带 FFmpeg/FFprobe 二进制。Windows portable release 需要在本地准备并校验 `vendor/ffmpeg/win/x64/ffmpeg.exe` 与 `ffprobe.exe`，再运行：

```bash
npm run icon:win
npm run dist:win
npm run verify:dist:win
```

Windows runtime smoke：

```powershell
npm run smoke:dist:win
npm run verify:smoke:win
```

可信 release 不能只靠 preview smoke。`verify:smoke:win` 必须重新检查 evidence、截图、bundled tool 证明、覆盖/取消/打开路径、完整渲染输出和 exactly one video stream。

## 验证

```bash
npm test
```

在仓库根目录还需要运行：

```bash
npm run scan:public
npm run test:motion
npm run package:web
npm run checksums
```

验证记录见 `../../docs/verification/motion-batch-0.1.0.md`。

## 失败恢复

- UI 打不开：确认 `npm ci` 已完成，再重新运行 `npm run ui`。
- 找不到 FFmpeg：安装 FFmpeg，或填写 `ffmpeg` 与 `ffprobe` 的完整路径。
- 输出已存在：换空输出文件夹；只有确认替换时才打开 overwrite。
- 报告失败：先看 HTML 报告的目标、失败项和恢复建议，不要把 failed/warning 输出当 release evidence。

## 品牌边界

代码开源不代表 FAD Records 品牌、Logo、艺人素材、真实发行资产或官方交付结果被授权使用。openFAD Motion Batch 只提供工具代码和公开安全的示例/文档。
