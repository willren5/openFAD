# Motion Batch 失败恢复

- 找不到 FFmpeg：安装 FFmpeg，或在 UI/CLI 中填写 `ffmpeg` 与 `ffprobe` 的完整路径。
- 输入不合规：确认视频只有一个 video stream，时长在 8-35 秒，颜色元数据可被识别。
- 输出已存在：换一个空输出文件夹，或确认后启用 overwrite。
- 批量任务中断：重新打开 UI，检查恢复的任务记录；如果恢复失败，重置本地恢复记录后换新输出文件夹重跑。
- 导出中取消：当前 FFmpeg/FFprobe 子进程会被终止，剩余队列不会继续执行。
- 报告显示 QC fail：先看 HTML 报告里的目标、错误和技术摘要；不要把有 warning 的完整渲染当作可信 release 证据。

工具会隐藏本地路径、底层 stderr 和敏感诊断，只保留用户可执行的恢复建议。
