# MV Studio 验证

公开 release 前至少运行：

```bash
npm run scan:public
npm run test:mv
npm test
```

验收证据需要包括：

- 静态验证测试输出。
- 浏览器 smoke 输出。
- 桌面截图。
- 移动端截图。
- 预览成功截图。
- 导出或重试下载路径证据。
- `docs/verification/mv-0.1.1.md` 中的日期化记录。
