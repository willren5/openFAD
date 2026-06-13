export function formatQcCommandFailure(name, code) {
  return `质检命令失败：${name} 退出码 ${code}。/ ${name} failed with exit code ${code}. Technical diagnostic output omitted.`;
}

export function formatQcCommandStartupFailure(name) {
  return `${name} 无法启动质检。/ ${name} failed to run. Technical diagnostic output omitted.`;
}

export function formatQcCommandTimeout(name) {
  return `${name} 运行超时。/ ${name} timed out. Technical diagnostic output omitted.`;
}

export function sanitizeReportIssueMessage(message) {
  const text = String(message ?? "").trim();
  if (!text) return "";

  const qcExit = text.match(/^(?<name>blackdetect|blackframe|freezedetect) failed with exit code (?<code>\d+)/);
  if (qcExit?.groups) {
    return formatQcCommandFailure(qcExit.groups.name, qcExit.groups.code);
  }

  const qcStartup = text.match(/^(?<name>blackdetect|blackframe|freezedetect) failed to run\b/);
  if (qcStartup?.groups) {
    return formatQcCommandStartupFailure(qcStartup.groups.name);
  }

  const qcTimeout = text.match(/^(?<name>blackdetect|blackframe|freezedetect) timed out\b/);
  if (qcTimeout?.groups) {
    return formatQcCommandTimeout(qcTimeout.groups.name);
  }

  if (looksLikeRawChildDiagnostic(text)) {
    return "技术诊断已隐藏。/ Technical diagnostic output omitted.";
  }

  return text;
}

export function formatLocalToolCliError(error) {
  if (error?.fadAppleMotionErrorKind === "dataless-input-file") {
    return "输入视频尚未完整下载到本地。请先下载或在 Finder 中补齐文件，再重试。 / Input video data is not downloaded locally yet. Download or materialize the file in Finder, then try again.";
  }
  if (error?.fadAppleMotionErrorKind === "encoder-resolution") {
    return "无法选择可用的视频编码器。请检查本地视频工具安装，或改用 x264 / auto 后重试。 / Could not select a usable video encoder. Check the local video tool installation, or choose x264 / auto encoding and try again.";
  }
  if (error?.code === "PROCESS_TIMEOUT") {
    return "本地视频工具在分析或处理文件时超时。请确认输入已完整下载且可正常播放，再重试。 / A local video tool timed out while analyzing or processing the file. Check that the input is fully downloaded and playable, then try again.";
  }

  const filesystemError = formatFilesystemCliError(error);
  if (filesystemError) return filesystemError;

  const message = String(error?.message ?? "");
  if (message.startsWith("ffmpeg failed for ")) {
    return "FFmpeg 无法生成视频输出。请检查输入文件、输出文件夹权限和本地视频工具安装后重试。 / FFmpeg could not generate the video output. Check the input file, output folder permissions, and local video tool installation, then try again.";
  }
  if (message.startsWith("ffprobe failed for ") || message.startsWith("Could not parse ffprobe JSON for ")) {
    return "FFprobe 无法分析输入视频。请确认文件可正常播放，并检查本地视频工具安装后重试。 / FFprobe could not analyze the input video. Check that the file plays normally and that the local video tool installation is available, then try again.";
  }
  if (message.startsWith("Could not inspect FFmpeg encoders:")) {
    return "无法检查 FFmpeg 编码器。请检查本地视频工具安装，或改用 x264 / auto 后重试。 / Could not inspect FFmpeg encoders. Check the local video tool installation, or choose x264 / auto encoding and try again.";
  }
  if (isEncoderSelectionDiagnostic(message)) {
    return "无法选择可用的视频编码器。请检查本地视频工具安装，或改用 x264 / auto 后重试。 / Could not select a usable video encoder. Check the local video tool installation, or choose x264 / auto encoding and try again.";
  }
  return null;
}

function isEncoderSelectionDiagnostic(message) {
  return message.startsWith("No supported H.264 encoder")
    || message.includes("is not available in this FFmpeg build")
    || message.includes("failed a runtime smoke test");
}

function formatFilesystemCliError(error) {
  const code = String(error?.code ?? "");
  const syscall = String(error?.syscall ?? "");
  if (["ENOENT", "ENOTDIR"].includes(code)) {
    if (syscall === "stat" || syscall === "lstat" || syscall === "open") {
      return "找不到输入文件或文件夹。请检查路径后重试。 / Input file or folder could not be found. Check the path and try again.";
    }
    return "找不到所需文件或文件夹。请检查输入和输出文件夹后重试。 / A required file or folder could not be found. Check the input and output folders, then try again.";
  }
  if (["EACCES", "EPERM"].includes(code)) {
    return "访问文件或文件夹时没有权限。请检查输入和输出文件夹权限后重试。 / Permission denied while accessing a file or folder. Check input/output folder permissions, then try again.";
  }
  if (code === "EISDIR") {
    return "本来需要文件，却选中了文件夹。请检查输入和输出路径后重试。 / Expected a file but found a folder. Check the selected input and output paths, then try again.";
  }
  if (code === "ENOTEMPTY" || code === "EEXIST") {
    return "输出路径已经被占用。请换一个输出文件夹，或明确开启 overwrite。 / Output path is already occupied. Choose a different output folder or enable overwrite intentionally.";
  }
  return null;
}

function looksLikeRawChildDiagnostic(text) {
  return /(?:^|\n)\s+at\s+\S+/.test(text)
    || /\b(?:Error|TypeError|SyntaxError|ReferenceError):/.test(text)
    || /(?:^|\s)(?:\/Users\/|\/var\/|\/tmp\/|[A-Za-z]:\\)/.test(text)
    || /\.(?:secrets?|env)\b/i.test(text)
    || /\b(?:token|secret|cookie|authorization)\b/i.test(text)
    || /\b(?:ChildProcess|spawn|ENOENT|EACCES|EPERM|stderr|stdout|node:)\b/.test(text);
}
