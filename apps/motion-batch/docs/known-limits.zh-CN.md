# Motion Batch 已知限制

- 渲染在本机完成，不在 fadrecords.com 主站进程内执行。
- 源码包不携带 FFmpeg/FFprobe 二进制；Windows portable release 需要单独准备、校验和记录证据。
- Apple Music 交付规则可能变化，公开 release 前必须重新跑 QC 和 smoke。
- `preview-only` 只能证明预览路径可用，不能证明完整交付物可信。
- 可信 release 需要完整渲染、checksums、manifest、截图或 smoke evidence；不能只用 dry run。
- 当前边界保留单一 video stream，不扩展到音频轨、多视频轨或复合时间线。
