# openFAD 部署到 fadrecords.com 和 GitHub

这份文档描述 openFAD v0.1.0 的可信发布路径。目标是让 GitHub source、Release artifacts、SHA256、release manifest、官网下载页和验证证据保持一致。

## GitHub/openFAD

目标仓库：

```text
OWNER/openFAD
```

发布前确认：

1. `main` 分支只包含公开安全代码、文档、测试和 demo assets。
2. `README.md` 是中文优先，`README.en.md` 是辅助英文。
3. `LICENSE`、`TRADEMARKS.md`、`SECURITY.md`、`CONTRIBUTING.md` 存在。
4. `npm run scan:public` 没有未分类的 secret、私有路径、admin、账号或生产运维命中。
5. `npm test` 通过。
6. `npm run release:prepare` 生成 web/source zip、`SHA256SUMS` 和 `release-manifest.json`。

如果仓库从个人账号迁到 FAD Records 组织，生成 manifest 时必须让 `GITHUB_REPOSITORY` 指向最终公开仓库，否则 artifact URL 会写错：

```bash
GITHUB_REPOSITORY=OWNER/openFAD npm run release:prepare
```

## GitHub Release

Release 必须上传：

- `openfad-cover-machine-<version>.zip`
- `openfad-mv-studio-<version>.zip`
- `openfad-motion-batch-source-<version>.zip`
- `openFAD-Motion-Batch-<version>-x64.exe`
- `openFAD-Motion-Batch-<version>-arm64.dmg`
- `SHA256SUMS`
- `release-manifest.json`

不要把 Motion Batch source zip 展示成 Windows 或 macOS 下载包。Windows runtime 只有在 full-render smoke evidence 通过后，才能拥有 `Stable` 标签；macOS runtime 需要独立 packaged-runtime smoke 后才能升为 `Stable`。

## fadrecords.com 路由

新增公开路由：

```text
/openfad
/openfad/cover
/openfad/mv
/openfad/motion-batch
/openfad/downloads
```

不要触碰：

```text
/login
/register
/dashboard
/pricing
/checkout
/support
/sample/redeem
/admin
/api/admin/*
```

## 官网数据源

`/openfad/downloads` 必须从 GitHub Release 的 `release-manifest.json` 或部署时复制的等价 JSON 渲染。页面不要手写 SHA256。

下载表最少显示：

- 工具名
- 平台/类型
- 可信标签
- 文件名
- 版本
- commit
- 文件大小
- SHA256
- GitHub Release 下载链接
- 已知限制

manifest 读取失败时显示：

```text
暂时无法读取 release manifest。请稍后刷新，或前往 GitHub Releases 查看下载。
```

## 在线工具承载方式

- Cover Machine 和 MV Studio 可以作为静态页面或静态 zip 下载承载。
- Motion Batch 不在 fadrecords.com 主站进程中执行 heavy render，只提供下载、文档和本地 UI 指引。
- 官网不新增 openFAD 账号、支付、云渲染、后台或 private FAD release ops 集成。

## 上线验证

GitHub 验证：

```bash
shasum -a 256 -c SHA256SUMS
```

官网验证：

```bash
curl -I https://fadrecords.com/openfad
curl -I https://fadrecords.com/openfad/downloads
curl -sS https://fadrecords.com/openfad | rg "openFAD|Cover|MV|Motion"
```

浏览器验证：

- 桌面截图。
- 移动端截图。
- 点击 Cover CTA。
- 点击 MV CTA。
- 点击 Motion Batch 下载。
- 点击 GitHub source。

## 发布口径

可以说：

- `中文优先`
- `本地优先`
- `可检查输出`
- `可复现 release`

不要说：

- Apple/Spotify/平台官方认证。
- FAD Records 品牌素材随代码开源。
- Motion Batch 可以在官网在线跑 heavy render。
- 没有 dated release gate 时宣称商业级正式可用。
