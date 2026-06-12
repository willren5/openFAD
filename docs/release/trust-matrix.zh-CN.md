# openFAD Release Trust Matrix

Last updated: 2026-06-12

## 信任等级

Level 0 - Draft：

- 代码或文档仍在编辑。
- 测试未完整运行。
- 不允许公开下载主推。

Level 1 - Local Verified：

- public scan 通过。
- app focused tests 通过。
- 可以作为开发候选，但不能宣称整仓 release ready。

Level 2 - Release Candidate：

- `npm test` 通过。
- `package:web`、`checksums`、`release:manifest` 在 clean commit 上完成。
- artifact 有 SHA256 和 manifest。
- 可以发布 GitHub prerelease 或官网候选下载。

Level 3 - Trusted Public Release：

- Level 2 通过。
- GitHub release artifact 与 manifest 一致。
- 官网 `/openfad` 指向同一个 manifest。
- verification docs 更新到当前 commit。
- Windows runtime 产物还需要对应平台 full-render smoke。

## Artifact 矩阵

| Artifact | 当前可信条件 | 允许文案 | 禁止文案 |
| --- | --- | --- | --- |
| Cover web zip | public scan + `test:cover` + root `npm test` + checksum + manifest | “浏览器版源码包/网页包，可本地打开 index.html” | “系统保存已验证”“官方设计资产已授权” |
| MV web zip | public scan + `test:mv` + root `npm test` + checksum + manifest | “浏览器版网页包，包含本地 visualizer 工具” | “浏览器下载一定保存成功”“FAD Records 背书你的作品” |
| Motion source zip | public scan + `test:motion` + root `npm test` + checksum + manifest | “源码包，可运行本地 UI/CLI 验证” | “Windows 可执行可信下载”“无需安装即可运行” |
| Motion Windows portable | Windows packaged-runtime full-render smoke + output ffprobe exactly one video stream + screenshot/job evidence + checksum + manifest | “Windows portable 已通过 full-render smoke” | “只凭 source tests 或 preview smoke 可信” |

## GitHub Release 文案模板

允许：

```text
本次 release 提供 openFAD Cover Machine、MV Studio 的网页包，以及 Motion Batch 源码包。Artifacts 附 SHA256 和 release manifest。Motion Batch Windows 可执行包需要额外 full-render smoke evidence，未在本 release 中作为可信 runtime 开放。
```

不允许：

```text
所有平台安装包均已可信验证。
```

不允许：

```text
下载后即可获得 FAD Records 官方视觉资产。
```

## 官网文案模板

允许：

```text
下载前请核对 SHA256；深度用户可按验证命令复现 public scan、测试、打包和 manifest。
```

允许：

```text
CI 链接为空时，本页展示本地验证证据和 manifest，不宣称 CI 已完成。
```

不允许：

```text
已通过所有线上生产验证。
```

## Release Owner Checklist

发布前：

- `git status --short --untracked-files=all` 没有未解释的 tracked diff。
- untracked evidence artifacts 要么纳入 verification docs，要么删除或明确排除。
- `npm run scan:public` exit 0。
- `npm test` exit 0。
- `npm run package:web && npm run checksums && npm run release:manifest` exit 0。
- `dist/release-manifest.json` commit 等于 `git rev-parse HEAD`。
- `dist/*.zip` checksum 与 manifest 一致。
- verification docs 不再写 pending evidence，除非 release 文案也明确 pending。

发布后：

- 记录 GitHub release URL。
- 记录 `/openfad` 页面 URL。
- 抽查下载后的 zip 是否包含 `LICENSE`、`NOTICE`、`TRADEMARKS.md`。
- 抽查官网 SHA256 与 manifest 一致。

