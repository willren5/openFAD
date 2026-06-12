export function formatQcCommandFailure(name, code) {
  return `${name} failed with exit code ${code}. Technical diagnostic output omitted.`;
}

export function formatQcCommandStartupFailure(name) {
  return `${name} failed to run. Technical diagnostic output omitted.`;
}

export function formatQcCommandTimeout(name) {
  return `${name} timed out. Technical diagnostic output omitted.`;
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
    return "Technical diagnostic output omitted.";
  }

  return text;
}

export function formatLocalToolCliError(error) {
  if (error?.fadAppleMotionErrorKind === "dataless-input-file") {
    return "Input video data is not downloaded locally yet. Download or materialize the file in Finder, then try again.";
  }
  if (error?.fadAppleMotionErrorKind === "encoder-resolution") {
    return "Could not select a usable video encoder. Check the local video tool installation, or choose x264 / auto encoding and try again.";
  }
  if (error?.code === "PROCESS_TIMEOUT") {
    return "A local video tool timed out while analyzing or processing the file. Check that the input is fully downloaded and playable, then try again.";
  }

  const filesystemError = formatFilesystemCliError(error);
  if (filesystemError) return filesystemError;

  const message = String(error?.message ?? "");
  if (message.startsWith("ffmpeg failed for ")) {
    return "FFmpeg could not generate the video output. Check the input file, output folder permissions, and local video tool installation, then try again.";
  }
  if (message.startsWith("ffprobe failed for ") || message.startsWith("Could not parse ffprobe JSON for ")) {
    return "FFprobe could not analyze the input video. Check that the file plays normally and that the local video tool installation is available, then try again.";
  }
  if (message.startsWith("Could not inspect FFmpeg encoders:")) {
    return "Could not inspect FFmpeg encoders. Check the local video tool installation, or choose x264 / auto encoding and try again.";
  }
  if (isEncoderSelectionDiagnostic(message)) {
    return "Could not select a usable video encoder. Check the local video tool installation, or choose x264 / auto encoding and try again.";
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
      return "Input file or folder could not be found. Check the path and try again.";
    }
    return "A required file or folder could not be found. Check the input and output folders, then try again.";
  }
  if (["EACCES", "EPERM"].includes(code)) {
    return "Permission denied while accessing a file or folder. Check input/output folder permissions, then try again.";
  }
  if (code === "EISDIR") {
    return "Expected a file but found a folder. Check the selected input and output paths, then try again.";
  }
  if (code === "ENOTEMPTY" || code === "EEXIST") {
    return "Output path is already occupied. Choose a different output folder or enable overwrite intentionally.";
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
