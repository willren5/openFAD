# openFAD

[English README](README.en.md)

openFAD 是 FAD Records 发起的中文优先开源音乐视觉工具集，包含封面、音乐视觉和 motion cover 交付工具。

## 立即使用

你可以直接访问官网在线入口进行操作：<https://fadrecords.com/openfad/>

- **做封面 (Cover Machine)**：在浏览器里打开示例，改歌名和艺人，再导出发行封面、透明 Logo 层和社媒图。
- **做音乐可视化 (MV Studio)**：上传音频和图片，先预览，再导出带音频反应效果的本地短视频或 visualizer。
- **处理 Apple Music 动态封面 (Motion Batch)**：下载本地裁切工具，把方形动态封面批量裁切成 Apple Music 常用比例并生成检查报告。

## 下载离线工具

v0.1.1 的 GitHub Release 会发布 `release-manifest.json`、SHA256 和各工具压缩包。官网 `/openfad/downloads/` 或静态下载目录只从 manifest / release artifact 同步下载信息，不手写 checksum。

- Cover Machine：下载后直接打开 `index.html`。
- MV Studio：下载后直接打开 `index.html`。
- Motion Batch：当前公开 artifact 是源码包和本地 UI，不是 Windows 稳定桌面版。

## 能做什么

- 生成发行封面、社媒图和透明图层。
- 生成本地音乐视觉和 visualizer。
- 批量制作 Apple Music motion cover 交付素材，并输出 QC 报告。

## 失败时怎么恢复

- Cover Machine：如果下载没弹出，点“重试下载”，再试 Chrome / Edge。
- MV Studio：如果导出没弹出，点“重试导出下载”，再试 Chrome / Edge，并降低码率或素材尺寸。
- Motion Batch：如果找不到 FFmpeg，先安装 `ffmpeg` / `ffprobe`，或在 UI/CLI 里显式填路径。

## 已知限制

- Motion Batch heavy render 只在本地执行，不在 fadrecords.com 主站进程里跑。
- 浏览器导出行为会随渲染器不同而变化。
- FAD Records 品牌、Logo、艺人素材和真实发行资产不随代码授权。

## 公开仓库范围

本仓库会保留开源治理文件、`.gitignore`、`packages/` 里的公开接口说明、`examples/demo-release/` 占位素材说明，以及 `docs/` 下的公开验证和部署边界文档。这些文件是 release gate、公开安全审计和官网 manifest 对齐的一部分；生成产物、私有环境配置文件、真实素材、本机路径和 Motion Batch 的 `vendor/` 资源不进入公开源码仓库。

## 源码 / 验证

```bash
npm ci
npm ci --prefix apps/motion-batch
npm run build:site
npm run scan:public
npm test
npm run test:cover
npm run test:mv
npm run test:motion
```

文档入口：

- `docs/quickstart/index.zh-CN.md`
- `docs/deployment/openfad-on-fadrecords.zh-CN.md`
- `docs/website/openfad.zh-CN.md`
- `docs/openfad-release-spec.zh-CN.md`
- `apps/cover-machine/DESIGN.md`
- `apps/mv-studio/DESIGN.md`
- `apps/motion-batch/DESIGN.md`
- `docs/release/trust-matrix.zh-CN.md`
- `docs/release/v0.1.1.zh-CN.md`
- `docs/release/v0.1.0.zh-CN.md`
- `docs/verification/cover-0.1.1.md`
- `docs/verification/mv-0.1.1.md`
- `docs/verification/motion-batch-0.1.1.md`
- `docs/verification/cover-0.1.0.md`
- `docs/verification/mv-0.1.0.md`
- `docs/verification/motion-batch-0.1.0.md`

## 品牌边界

代码开源不等于 FAD Records 品牌、Logo、艺人素材或真实发行资产开源。请阅读 `TRADEMARKS.md`。
