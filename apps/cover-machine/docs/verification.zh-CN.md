# Cover Machine 验证

公开 release 前至少运行：

```bash
npm run scan:public
npm run test:cover
npm test
```

验收证据需要包括：

- Cover browser 测试输出。
- 桌面截图。
- 移动端截图。
- 一张封面导出样例。
- 一张透明图层导出样例。
- `docs/verification/cover-0.1.1.md` 中的日期化记录。

验证边界：

- 测试能证明导出按钮、项目状态、公开安全示例和下载触发路径。
- 浏览器是否真的把文件保存到系统下载目录，仍受浏览器和系统设置影响。
- FAD Records 品牌、Logo、艺人素材和真实发行资产不随代码授权。
