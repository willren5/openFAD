# openFAD 开源发布规格

Last updated: 2026-06-12

## 目标

openFAD 是 FAD Records 发起的中文优先开源音乐视觉工具集。首发范围包含三个工具：

- openFAD Cover Machine：封面、社媒图、透明图层。
- openFAD MV Studio：本地音乐视觉、visualizer、`.fadmv` 项目包。
- openFAD Motion Batch：方形 motion cover 到 Apple Music `1x1` / `3x4` 交付素材和 QC 报告。

开源发布目标不是把私有 FAD 生产系统搬出来，而是发布一套公开安全、可下载、可验证、可二次开发的创作者工具。

## 非目标

- 不开源 FAD Records 品牌资产、Logo、艺人素材、真实发行项目、后台运营流程、账号、密钥或付费系统。
- 不把 Motion Batch 的 source zip 包装成 Windows 可执行可信产物。
- 不在没有 full-render smoke evidence 的情况下宣称 Motion Batch Windows runtime 可信。
- 不把 Cover/MV 浏览器下载成功说成系统级文件保存已验证。
- 不为了营销话术扩大功能范围；所有 release 文案必须跟验证证据一致。

## 用户体验原则

轻度用户和深度用户必须同样被照顾，但不应该看到同样复杂的界面。

轻度用户路径：

1. 看到中文标题和一句话定位。
2. 看到“打开示例”或“上传素材”的主按钮。
3. 不需要读 README 就能完成一次导出。
4. 每个阻塞状态都用中文说明下一步。
5. 导出失败时有重试、换浏览器、减小素材、查看报告等明确动作。

深度用户路径：

1. 能找到工程设置、批处理、报告、验证命令和已知限制。
2. 能读取 schema、项目 JSON、`.fadmv` 包、QC 报告和 release manifest。
3. 能用命令行复现 public scan、测试、打包、checksum、manifest。
4. 能判断哪些产物可信，哪些只是候选或源码包。
5. 能在 issue 里提交足够复现的信息，但不会被要求上传私有素材或本机路径。

界面默认：

- 中文为主，英文作为辅助标记或技术名词保留。
- 专业设置默认折叠，但必须可键盘访问。
- 失败路径必须比成功路径更清楚。
- 所有状态都要有文本，不只依赖颜色、图标或 toast。

## Public-Safe 规则

所有代码、文档、测试、示例和 release artifact 必须满足：

- 允许出现 `openFAD`。
- 允许在品牌边界、法律说明、发起方说明中出现 `FAD Records`。
- 不允许默认 UI、demo 素材、导出文件名、日志前缀使用 standalone private brand 标记，例如 `[FAD]`、`_FAD`、`FAD Records Release`。
- 不允许出现真实用户路径、绝对本机路径、Windows 用户目录、临时 Codex runtime 路径、密钥、token、cookie、env 文件内容。
- 不允许把真实发行素材放进 `examples/`、`docs/verification/artifacts/` 或 app 内嵌 demo。

每次发布前必须运行：

```bash
npm run scan:public
git diff --check -- .
```

## Release Gate

发布候选必须在 clean commit 上生成证据。

最低命令：

```bash
npm ci
npm ci --prefix apps/motion-batch
npm run scan:public
npm test
npm run package:web
npm run checksums
npm run release:manifest
```

合格证据：

- `npm test` 覆盖 Cover、MV、Motion、root scanner tests，且 `fail 0`。
- `dist/` 有五个 artifact：Cover web zip、MV web zip、Motion source zip、Motion Windows `.exe`、Motion macOS `.dmg`。
- 每个 zip 包含根部 `LICENSE`、`NOTICE`、`TRADEMARKS.md`。
- source zip 必须包含测试文件。
- `dist/release-manifest.json` 的 commit 是当前 clean commit。
- checksum 与实际文件一致。

不能通过的状态：

- 只跑了某个 app 的测试，就说 openFAD release ready。
- manifest 是旧 commit。
- 文档里写“可信发布完成”，但 verification 文件还有 pending evidence。
- Motion runtime artifact 没有对应平台产物和下载验证，却出现在官网下载主按钮里。

## 团队交接顺序

Cover 团队：

1. 先读 `apps/cover-machine/DESIGN.md`。
2. 只改 `apps/cover-machine/` 和它的验证文档，除非 release gate 需要改 root scripts。
3. 每个 UI 改动都要保留 30 秒路径。
4. 每个导出/保存改动都要更新失败路径和 `npm run test:cover`。

MV 团队：

1. 先读 `apps/mv-studio/DESIGN.md`。
2. 只改 `apps/mv-studio/` 和它的验证文档，除非 release gate 需要改 root scripts。
3. 保留单文件打开能力。
4. 每个录制、下载、autosave、`.fadmv` 改动都要覆盖失败路径和 `npm run test:mv`。

Motion 团队：

1. 先读 `apps/motion-batch/DESIGN.md`。
2. 保持输出 deliverables exactly one video stream。
3. Windows runtime 只能在 full-render smoke evidence 通过后进入可信下载。
4. 每个 FFmpeg/QC/desktop bridge 改动都要跑 `npm run test:motion`。

Website 团队：

1. 先读 `docs/website/openfad.zh-CN.md`。
2. 官网 `/openfad` 只读取 release manifest 和人工批准的文案。
3. 下载按钮不得绕过 manifest checksum。
4. 页面不能暗示 FAD Records 品牌资产随代码授权。

Release owner：

1. 先读 `docs/release/trust-matrix.zh-CN.md`。
2. 生成 release 前确认工作树 clean。
3. 把本地命令输出摘要写入 `docs/verification/*.md`。
4. GitHub release 和官网文案必须使用 trust matrix 的 approved wording。

## 完成定义

openFAD 当前公开版本可以被称为可信开源首发候选，仅当：

- 代码、文档、示例 public-safe scan 通过。
- 三个工具的测试全部通过。
- release artifacts、checksums、manifest 来自同一个 clean commit。
- 官网 `/openfad` 页面显示 artifact 类型、版本、commit、SHA256、验证状态和已知限制。
- Motion Batch Windows executable 若未完成 full-render smoke，只能显示为“未开放可信下载”或“源码包可用”。
