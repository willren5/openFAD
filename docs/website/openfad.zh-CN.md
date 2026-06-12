# fadrecords.com/openfad 页面规格

Last updated: 2026-06-12

## 页面目标

`/openfad` 是 openFAD 的官方下载入口和可信 release 说明页。页面必须让轻度用户能下载/打开工具，也让深度用户能验证 artifact、commit、SHA256、license 和已知限制。

## 首屏

H1：

```text
openFAD
```

副标题：

```text
FAD Records 发起的中文开源音乐视觉工具集：封面、音乐视觉、动态封面交付。
```

主操作：

- 下载 Cover Machine
- 下载 MV Studio
- 下载 Motion Batch 源码包
- 查看 GitHub

如果 Motion Batch Windows runtime 没有 full-render smoke evidence，不能显示“下载 Windows 版”作为主按钮。

## 工具卡片

Cover Machine：

- 一句话：浏览器里制作发行封面、社媒图和透明图层。
- 适合：不想装软件的音乐人、厂牌运营、视觉协作者。
- 下载：`cover-machine` artifact。
- 运行：解压后打开 `index.html`。
- 可信状态：web zip + checksum + tests。

MV Studio：

- 一句话：浏览器里制作本地音乐视觉和 visualizer。
- 适合：单曲预告、短视频视觉、演出视觉草稿。
- 下载：`mv-studio` artifact。
- 运行：解压后打开 `index.html`。
- 可信状态：web zip + checksum + tests。

Motion Batch：

- 一句话：把方形 motion cover 批量转成 Apple Music `1x1` / `3x4` 交付素材并生成 QC 报告。
- 适合：发行交付、厂牌批处理、技术审查。
- 下载：`motion-batch` source artifact。
- 运行：解压后进入目录，执行 `npm ci && npm run ui`。
- 可信状态：source zip + tests；Windows runtime 需要额外 full-render smoke。

## 下载表

页面必须从 release manifest 渲染以下字段：

- 工具
- 平台/类型
- 可信标签：`Preview`、`Tested` 或 `Stable`
- 信任范围：说明这是网页包、源码包还是平台 runtime
- 文件名
- 版本
- commit
- 文件大小
- SHA256
- 下载链接
- 验证状态
- 已知限制

SHA256 必须可复制。不要只把 checksum 放在折叠区。
不要把 `motion-batch-source` 渲染成 Windows 稳定桌面版；它只能按 manifest 的 `platform: source` 和 `stability: Preview` 展示。

## 验证区

面向深度用户显示：

```bash
npm ci
npm ci --prefix apps/motion-batch
npm run scan:public
npm test
npm run package:web
npm run checksums
npm run release:manifest
```

文案规则：

- 可以说“这些 artifact 由 release manifest 记录 SHA256”。
- 可以说“本地验证命令见 docs/verification”。
- 只有 `ciRunUrl` 非空且对应当前 commit 时，才可以说“CI 已验证”。
- 不能说“Windows 版可信可用”，除非 Windows full-render smoke evidence 通过。

## 品牌和授权边界

页面必须显示：

```text
代码开源不代表 FAD Records 品牌、Logo、艺人素材或真实发行资产开源。openFAD 示例素材仅为公开安全占位内容。
```

链接：

- `LICENSE`
- `NOTICE`
- `TRADEMARKS.md`
- GitHub repository
- Release manifest JSON

## 空状态和失败状态

manifest 加载失败：

```text
暂时无法读取 release manifest。请稍后刷新，或前往 GitHub Releases 查看下载。
```

checksum 缺失：

```text
该 artifact 缺少 SHA256，暂不作为可信下载展示。
```

CI URL 为空：

```text
本版本提供本地验证证据；CI 链接尚未写入 manifest。
```

Motion Windows runtime 未开放：

```text
Windows 可执行包等待 full-render smoke evidence；当前仅开放源码包。
```

## SEO / 分享

title：

```text
openFAD｜中文开源音乐视觉工具集
```

description：

```text
下载 openFAD Cover Machine、MV Studio 和 Motion Batch：FAD Records 发起的中文开源音乐视觉工具集，附 SHA256、release manifest 和验证说明。
```

OG 图应使用公开安全 openFAD 图形，不得使用 FAD Records 私有 Logo 或真实艺人素材。

## 发布流程

1. release owner 在 openFAD 仓库生成 clean manifest。
2. 将 artifact 上传 GitHub Releases。
3. 官网同步 manifest URL 或复制 manifest 内容。
4. `/openfad` 页面从 manifest 渲染下载表。
5. 人工检查页面上没有过度信任声明。
6. 发布后记录官网 URL、GitHub release URL、manifest commit。
