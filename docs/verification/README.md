# Verification

每次公开 release 必须留下日期化验证记录，包括测试命令、输出摘要、截图或产物、checksums 和已知限制。

最低证据：

- `npm run scan:public`
- `npm test`
- `npm run test:cover`
- `npm run test:mv`
- `npm run test:motion`
- `npm run package:web`
- `npm run checksums`
- clean commit 上生成的 `dist/release-manifest.json`

发布 zip 必须自包含根部 `LICENSE`、`NOTICE`、`TRADEMARKS.md`。名字带 `source` 的源码包必须包含可复现验证所需的测试文件，不能让用户解压后得到“零测试通过”的假阳性。

Motion Batch 的 Windows portable artifact 需要额外 full-render smoke evidence，不能只用 preview smoke 或 source zip checksum 代替。

发布文案必须对齐 `docs/release/trust-matrix.zh-CN.md`。官网 `/openfad` 下载页必须对齐 `docs/website/openfad.zh-CN.md`。
