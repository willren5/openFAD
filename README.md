# openFAD

openFAD 是 FAD Records 发起的开源音乐视觉工具集，帮助独立音乐人、厂牌和视觉创作者制作封面、音乐视觉和平台交付素材。

## 我想直接使用

- Cover Machine：打开 `apps/cover-machine/index.html`，制作发行封面、社媒图和透明图层。
- MV Studio：打开 `apps/mv-studio/index.html`，制作本地音乐视觉和 visualizer。
- Motion Batch：进入 `apps/motion-batch`，运行 `npm ci && npm run ui`，把方形 motion cover 转成 Apple Music 交付素材，并生成 QC 报告。

Cover Machine 不需要 Node.js、GitHub、FFmpeg 或命令行才能开始使用。打开页面后点击“打开示例”，改歌名和艺人，再点击“导出封面 JPG”。

MV Studio 也保留单文件本地打开能力。打开页面后点击“打开示例”，选择视觉系统，先“预览”，再换成自己的素材并“导出视频”。

Motion Batch 面向交付批处理，需要 Node.js 和 FFmpeg。轻度用户优先用本地 UI；深度用户可用 CLI、QC-only、preview-only、Windows portable smoke 和 release evidence。

## 我想检查源码

```bash
npm ci
npm ci --prefix apps/motion-batch
npm run scan:public
npm test
npm run test:cover
npm run test:mv
npm run test:motion
```

## 我想继续开发或发布

- 总规格：`docs/openfad-release-spec.zh-CN.md`
- Cover 交接规格：`apps/cover-machine/DESIGN.md`
- MV 交接规格：`apps/mv-studio/DESIGN.md`
- Motion 交接规格：`apps/motion-batch/DESIGN.md`
- 官网 `/openfad` 规格：`docs/website/openfad.zh-CN.md`
- release 信任矩阵：`docs/release/trust-matrix.zh-CN.md`
- GitHub Release v0.1.0 正文：`docs/release/v0.1.0.zh-CN.md`

## 当前状态

v0.1.0 是可信开源发布流程的首发候选。请以每个工具 README 和 `docs/verification/` 内的验证记录为准；Motion Batch 的 source zip 不等于 Windows 可执行可信产物。

## 品牌边界

代码开源不等于 FAD Records 品牌、Logo、艺人素材或真实发行资产开源。请阅读 `TRADEMARKS.md`。
