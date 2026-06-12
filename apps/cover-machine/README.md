# openFAD Cover Machine

openFAD Cover Machine 是中文优先的开源封面制作工具，用于快速生成发行封面、社媒视觉和透明图层。

## 立即使用

打开 `index.html`。不需要 Node.js、GitHub、FFmpeg 或命令行。

30 秒路径：

1. 点击“打开示例”。
2. 修改“示例艺人”“示例标题”和发行信息。
3. 选择“DSP 方形封面 3840”。
4. 点击“导出封面 JPG”。

导出成功时，“导出状态”会显示文件名、尺寸、文件大小和保存请求状态。没有看到下载时，点击“重试下载”；仍失败时换用 Chrome / Edge，并优先上传本地图片。

## 深用户验证

在仓库根目录运行：

```bash
npm run scan:public
npm run test:cover
npm test
```

本目录验证说明见 `docs/verification.zh-CN.md`；release 级验证记录见 `../../docs/verification/cover-0.1.0.md`。

## 品牌边界

示例背景和 Logo 是 openFAD 公开安全占位素材。代码开源不代表 FAD Records 品牌、Logo、艺人素材或真实发行资产被授权使用。

## 使用分析

公开版默认“分析: 关”。开启后只发送使用事件，不上传封面图片、项目 JSON 或导出文件；本地自动保存不受影响。

## 已知限制

- 浏览器保存文件失败时，请点击“重试下载”或更换 Chrome / Edge。
- 浏览器截图导出和专业设计软件渲染可能存在细微差异。
- 远程图片可能因跨域限制无法导出，推荐上传本地图片。
- FAD Records 品牌资产不随代码授权。
