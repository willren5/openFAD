# Motion Batch 验证

公开 release 前至少运行：

```bash
npm ci
npm test
```

在仓库根目录运行：

```bash
npm run scan:public
npm run test:motion
npm run package:web
npm run checksums
```

Windows portable artifact 还需要：

```bash
npm run icon:win
npm run dist:win
npm run verify:dist:win
npm run smoke:dist:win
npm run verify:smoke:win
```

验收证据需要包含测试 summary、public scan、source package checksum、release manifest、Windows full-render smoke evidence，以及 exactly one video stream 的 ffprobe 证明。
