# openFAD

openFAD 是 FAD Records 发起的开源音乐视觉工具集，帮助独立音乐人、厂牌和视觉创作者制作封面、音乐视觉和平台交付素材。

## 我想直接使用

你可以直接访问官网在线入口进行操作：<https://fadrecords.com/openfad/>

- **做封面 (Cover Machine)**：在浏览器里直接排版，输出符合发行规格的单曲封面、透明 Logo 层和社媒宣发图。
- **做音乐可视化 (MV Studio)**：上传音频和图片，直接在浏览器里渲染带音频反应 (Audio Reactive) 效果的本地短视频或 Visualizer。
- **处理 Apple Music 动态封面 (Motion Batch)**：下载本地裁切工具，将方形动态封面批量自动裁切成 Apple Music 常用比例并生成检查报告。

## 我想检查源码或开发

如果需要进行本地开发或测试：

- **Cover Machine / MV Studio**：均支持单文件本地打开（`apps/cover-machine/index.html` 或 `apps/mv-studio/index.html`），可直接修改代码调试。
- **Motion Batch**：提供本地 UI，需要 Node.js 和 FFmpeg 支持，在 `apps/motion-batch` 目录下运行 `npm ci && npm run ui`。


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

## 文档

- 总规格：`docs/openfad-release-spec.zh-CN.md`
- Cover 交接规格：`apps/cover-machine/DESIGN.md`
- MV 交接规格：`apps/mv-studio/DESIGN.md`
- Motion 交接规格：`apps/motion-batch/DESIGN.md`
- 官网产品规格：`docs/website/openfad.zh-CN.md`
- 发布信任矩阵：`docs/release/trust-matrix.zh-CN.md`
- GitHub Release v0.1.1 正文：`docs/release/v0.1.1.zh-CN.md`

## 品牌边界

代码开源不等于 FAD Records 品牌、Logo、艺人素材或真实发行资产开源。请阅读 `TRADEMARKS.md`。
