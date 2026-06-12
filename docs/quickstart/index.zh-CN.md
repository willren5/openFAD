# openFAD 快速开始

这份 quickstart 只回答一个问题：我现在该点哪里，才能第一次成功导出。

## 我该选哪个工具

- 想做封面或社媒图：选 `Cover Machine`。
- 想做一段音乐视觉或 visualizer：选 `MV Studio`。
- 已经有方形 motion cover，要准备 Apple Music 交付素材：选 `Motion Batch`。

## 第一次成功路径

### Cover Machine

1. 打开 `apps/cover-machine/index.html`。
2. 点击“打开示例”。
3. 修改歌名、艺人和发行信息。
4. 选择 `DSP 方形封面 3840`。
5. 点击“导出封面 JPG”。

成功标准：页面显示文件名、尺寸、文件大小和保存请求状态。

### MV Studio

1. 打开 `apps/mv-studio/index.html`。
2. 点击“打开示例”。
3. 选择“唱片封面视觉”“频谱视觉”或“极简 Logo 视觉”。
4. 点击“预览”。
5. 预览正常后点击“导出视频”。

成功标准：页面出现导出报告，浏览器触发 `.webm` 下载；如果下载没有出现，先点“重试导出下载”。

### Motion Batch

Motion Batch 目前是本地 UI / CLI 工具，不是在线重渲染服务。

```bash
cd apps/motion-batch
npm ci
npm run ui
```

打开：

```text
http://127.0.0.1:4387
```

然后选择输入视频或文件夹、选择空输出文件夹、点击“开始处理”。

成功标准：输出文件夹里出现 `1x1`、`3x4`、安全区预览 PNG、JSON 报告和 HTML 报告。

## 失败下一步

- 没有弹出下载：先点对应的“重试下载”按钮。
- 浏览器导出失败：改用 Chrome / Edge，并降低素材尺寸、码率或时长。
- Motion Batch 找不到 FFmpeg：安装 FFmpeg，或填写 `ffmpeg` 与 `ffprobe` 的完整路径。
- 输出已存在：换空输出文件夹；只有确认替换时才打开 overwrite。
- 报告显示失败：先按报告里的中文恢复建议处理，再重新导出。

## 深用户验证入口

如果你要检查源码、CI、manifest 或 release artifact，从仓库根目录运行：

```bash
npm ci
npm ci --prefix apps/motion-batch
npm run scan:public
npm test
npm run release:prepare
```

验证记录在 `docs/verification/`。官网 `/openfad/downloads` 必须从 `release-manifest.json` 或同等拷贝渲染文件名、版本、commit、SHA256 和下载链接。
