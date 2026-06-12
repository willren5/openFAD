# openFAD MV Studio

openFAD MV Studio 是中文优先、本地优先的开源音乐视觉工具。它保留单文件 `index.html`，适合独立音乐人、厂牌和视觉创作者快速制作一段音乐视觉。

## 立即使用

打开 `index.html`。不需要 Node.js、GitHub、FFmpeg 或命令行。

30 秒路径：

1. 点击“打开示例”。
2. 选择“唱片封面视觉”“频谱视觉”或“极简 Logo 视觉”。
3. 点击“预览”。
4. 准备自己的素材后点击“导出视频”。

导出失败时，页面会显示下一步操作。优先点击“重试导出下载”；仍失败时换用 Chrome / Edge，并减少素材大小或时长。

## 如何导出

MV Studio 依赖浏览器的录制和下载能力。Chrome / Edge 通常最稳定。导出前请确认“预检”没有阻塞项，并让主音频、背景图、中心视觉和 Logo 都载入成功。

## 失败后怎么恢复

- 下载没有出现：点击“重试导出下载”。
- 浏览器不支持 Streaming Save：关闭该选项，使用普通下载。
- 项目中断：使用自动保存、项目 JSON 或 `.fadmv` 包恢复。
- 报告里出现警告：先按报告里的中文说明处理，再重新预览。

## 深用户验证

在仓库根目录运行：

```bash
npm run scan:public
npm run test:mv
npm test
```

验证记录见 `../../docs/verification/mv-0.1.0.md`。

## 品牌边界

示例素材是 openFAD 公开安全占位内容。代码开源不代表 FAD Records 品牌、Logo、艺人素材或真实发行资产被授权使用。

导出的文件名可能包含 `openfad`，这只是工具来源标记，不代表 FAD Records 对你的作品、账号、服务或发行渠道背书。
