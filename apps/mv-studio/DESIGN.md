# openFAD MV Studio Design

## 产品意图

openFAD MV Studio 是中文优先、本地优先的音乐视觉制作工具。它保留单文件 `index.html` 的低门槛，同时提供预检、预览、录制、下载重试、自动保存、`.fadmv` 项目包和报告等深度能力。

产品气质：像一个可靠的本地 visualizer 工作台，不像一次性 demo。

## 用户轨道

轻度用户：

- 打开 `index.html`。
- 点击“打开示例”。
- 选择视觉系统。
- 点击“预览”。
- 换成自己的音频、背景、中心视觉和 Logo。
- 点击“导出视频”。

深度用户：

- 展开专业设置。
- 调整 FPS、bitrate、视觉强度、字体、布局和批量队列。
- 使用自动保存、项目 JSON 和 `.fadmv` 包迁移工程。
- 查看渲染报告、性能警告、失败阶段和重试状态。
- 跑 `npm run test:mv` 验证浏览器行为和静态合同。

## 信息架构

首屏必须包含：

- 中文标题和 `openFAD MV Studio` 标识。
- “打开示例”和“上传音频”主按钮。
- 三个视觉系统入口。
- 预览、导出和当前阻塞原因。
- 预检摘要。
- 快速开始说明。
- 画布预览。

专业区包含：

- 素材输入：背景图、中心视觉、音频、透明 Logo。
- 项目设置：歌名、艺人、页脚厂牌。
- 录制设置：FPS、bitrate、Streaming Save。
- 视觉设置：字体、强度、glitch、布局。
- 音频分析。
- 自动保存和最近项目。
- 项目 JSON / `.fadmv` 包。
- 批量渲染。
- 报告和 warning ledger。

## 视觉系统合同

每个视觉系统必须声明：

- 适合的素材类型。
- 默认布局。
- 对缺失素材的提示。
- 是否使用音频响应。
- 是否允许静态中心图。

当前视觉系统：

- 唱片封面视觉：适合封面式中心视觉。
- 频谱视觉：强调音频响应。
- 极简 Logo 视觉：适合透明 Logo 和短循环。

新增视觉系统不能破坏：

- 单文件打开能力。
- 预检阻塞逻辑。
- 录制失败报告。
- reduced motion。
- public-safe 默认文案。

## 录制和保存合同

预览：

- 不生成最终下载。
- 可以进入和退出，退出后焦点回到可见操作。
- 背景切出时必须暂停或明确提示。

导出：

- 导出前必须通过预检。
- 文件名使用 `_openfad` 来源标记。
- 普通下载只能说“download dispatched”，不能说系统保存已验证。
- Streaming Save 只有在浏览器能力可用时启用。
- 失败后必须保留 retry blob，直到新渲染或项目突变让它失效。

`.fadmv` 包：

- 必须边界检查条目数、文件名、大小和 manifest。
- 导入失败必须回滚当前项目。
- 导入取消必须停止后续 mutation。
- 不得信任包内本机路径。

自动保存：

- 不能在录制、批量渲染、项目恢复、音频分析期间抢占。
- 资产写入失败时允许 state-only fallback。
- 恢复 state-only 项目时必须提示用户重新补齐素材。

## 失败路径

阻塞原因必须中文优先：

- 缺背景图：`请先选择背景图`
- 缺中心视觉：`请先选择中心视觉素材`
- 缺透明 Logo：`请先选择透明 Logo`
- 缺主音频：`请先选择主音频`
- 音频分析中：`音频分析进行中，请完成后再继续`
- 正在预览：`请等待预览完成后再继续`
- 性能预算未达标：`性能预算未达标，已降低本次渲染的视觉效果`

所有失败必须进入以下至少一个可见位置：

- 当前按钮 disabled reason。
- 预检摘要。
- 状态栏。
- warning ledger。
- 渲染报告。

不能只写 console。

## 可访问性

- 画布必须有 `role="img"`、中文 aria-label 和 fallback text。
- 预检、状态、warning ledger 需要 live region 或等价状态输出。
- 移动端首屏必须先看到主操作，再看到深度设置。
- Pro Mode disclosure 在移动端必须位于高级区之前。
- 所有 disabled 操作必须有可键盘到达的原因。
- 长错误、长文件名和长报告不能横向撑破布局。

## 性能

- 首屏不请求外部网络资源。
- 音频分析必须做 decode size 和 working-set 预算。
- FLAC / MP3 / WAV 等路径必须先做 header 或 metadata 预检，避免大内存解码。
- 长任务触发后降低视觉效果，并把性能降级写入报告。
- 批处理不能因为单个项目失败而吞掉后续项目结果。

## Public-Safe 规则

- 默认 label 使用 `openFAD Public Release` 或 `openFAD Public Demo`。
- 导出后缀使用 `_openfad`。
- console 前缀使用 `[openFAD]`。
- 不允许默认 UI 出现 `FAD Records Release`、`_FAD`、`Untitled FAD MV`。
- `FAD Records` 只能出现在品牌边界说明。

## 验收命令

```bash
npm run scan:public
npm run test:mv
git diff --check -- .
```

发布前还要跑根级：

```bash
npm test
npm run package:web
npm run checksums
npm run release:manifest
```

## 交付清单

每次 MV 改动必须回答：

- 打开示例、预览、导出三步是否仍然成立？
- 缺素材、忙碌状态、浏览器限制是否都有中文下一步？
- `.fadmv`、autosave、retry blob 是否仍然可恢复？
- 导出文件名和默认品牌是否 public-safe？
- `npm run test:mv` 是否 fresh pass？

