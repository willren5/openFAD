# openFAD 快速开始

如果你只是想做一个东西，从工具页开始：

1. Cover Machine：打开 `apps/cover-machine/index.html`，点击“打开示例”，改文字后导出封面。
2. MV Studio：打开 `apps/mv-studio/index.html`，点击“打开示例”，选择视觉系统后预览。
3. Motion Batch：进入 `apps/motion-batch`，运行 `npm ci && npm run ui`，打开 `http://127.0.0.1:4387`，准备 Apple Music motion cover 交付素材。

如果 Cover Machine 没有弹出下载，请点击“重试下载”；仍失败时优先换用 Chrome / Edge，并使用本地上传图片。

如果 MV Studio 没有弹出视频下载，请点击“重试导出下载”；仍失败时优先换用 Chrome / Edge，并降低码率、缩短时长或减少素材尺寸。

如果 Motion Batch 找不到 FFmpeg，请先安装 FFmpeg，或在 UI/CLI 中填写 `ffmpeg` 与 `ffprobe` 的完整路径。输出已存在时，优先换空输出文件夹；只有确认替换时才打开 overwrite。

如果你想检查源码，先运行：

```bash
npm ci
npm ci --prefix apps/motion-batch
npm run scan:public
npm test
```
