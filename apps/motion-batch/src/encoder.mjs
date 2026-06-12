import { isAbortError, runProcess } from "./probe.mjs";

export const ENCODERS = {
  x264: {
    name: "x264",
    codec: "libx264",
    filterFormat: "yuv420p"
  },
  nvenc: {
    name: "nvenc",
    codec: "h264_nvenc",
    filterFormat: "yuv420p"
  },
  qsv: {
    name: "qsv",
    codec: "h264_qsv",
    filterFormat: "nv12"
  }
};

const AUTO_ORDER = ["nvenc", "qsv", "x264"];
const WINDOWS_GPU_COMMAND = "powershell.exe";
const WINDOWS_GPU_ARGS = [
  "-NoProfile",
  "-Command",
  "Get-CimInstance Win32_VideoController | Select-Object -ExpandProperty Name"
];
export const DEFAULT_ENCODER_PROBE_TIMEOUT_MS = 30_000;
export const DEFAULT_ENCODER_SMOKE_TIMEOUT_MS = 30_000;
const WINDOWS_GPU_DETECTION_TIMEOUT_MS = 5000;

export function encoderFromName(name) {
  const encoder = ENCODERS[name];
  if (!encoder) {
    throw new Error(`Unknown encoder: ${name}. Use x264, nvenc, qsv, or auto.`);
  }
  return encoder;
}

export function parseAvailableEncoders(output) {
  const encoders = new Set();
  for (const line of output.split(/\r?\n/)) {
    const match = line.match(/^\s*[A-Z.]{6}\s+(?<name>\S+)/);
    if (match?.groups?.name) {
      encoders.add(match.groups.name);
    }
  }
  return encoders;
}

export function pickEncoder(requested, availableEncoders, {
  platform = process.platform,
  gpuVendors = new Set()
} = {}) {
  const candidates = getEncoderCandidates(requested, availableEncoders, { platform, gpuVendors });
  if (candidates.length === 0) {
    throw new Error("No supported H.264 encoder found. Expected libx264, h264_nvenc, or h264_qsv.");
  }
  return candidates[0];
}

export function getEncoderCandidates(requested, availableEncoders, {
  platform = process.platform,
  gpuVendors = new Set()
} = {}) {
  if (requested === "auto") {
    return getAutoEncoderOrder({ platform, gpuVendors })
      .map((name) => ENCODERS[name])
      .filter((encoder) => availableEncoders.has(encoder.codec));
  }
  const encoder = encoderFromName(requested);
  if (!availableEncoders.has(encoder.codec)) {
    throw new Error(`${encoder.codec} is not available in this FFmpeg build.`);
  }
  return [encoder];
}

export async function resolveEncoder(requested, {
  ffmpegPath = process.env.FFMPEG_PATH ?? "ffmpeg",
  dryRun = false,
  platform = process.platform,
  gpuVendors,
  signal,
  run = runProcess,
  encoderProbeTimeoutMs = DEFAULT_ENCODER_PROBE_TIMEOUT_MS,
  encoderSmokeTimeoutMs = DEFAULT_ENCODER_SMOKE_TIMEOUT_MS
} = {}) {
  const requestedEncoder = requested ?? "auto";
  if (dryRun) {
    return encoderFromName(requestedEncoder === "auto" ? "x264" : requestedEncoder);
  }

  const [result, detectedGpuVendors] = await Promise.all([
    run(ffmpegPath, ["-hide_banner", "-encoders"], { signal, timeoutMs: encoderProbeTimeoutMs }),
    platform === "win32" && requestedEncoder === "auto" && !gpuVendors
      ? detectWindowsGpuVendors({ run, signal })
      : Promise.resolve(new Set())
  ]);
  if (result.code !== 0) {
    if (dryRun) return encoderFromName("x264");
    throw new Error(`Could not inspect FFmpeg encoders:\n${result.stderr}`);
  }

  const candidates = getEncoderCandidates(requestedEncoder, parseAvailableEncoders(`${result.stdout}\n${result.stderr}`), {
    platform,
    gpuVendors: gpuVendors ?? detectedGpuVendors
  });
  if (dryRun) return candidates[0] ?? encoderFromName("x264");

  const failures = [];
  for (const encoder of candidates) {
    const smoke = await runEncoderSmoke(ffmpegPath, encoder, { run, signal, timeoutMs: encoderSmokeTimeoutMs });
    if (smoke.ok) return encoder;

    failures.push(`${encoder.codec}: ${smoke.message}`);
    if (requestedEncoder !== "auto") {
      throw new Error(`${encoder.codec} is available but failed a runtime smoke test:\n${smoke.message}`);
    }
  }

  throw new Error(`No supported H.264 encoder passed a runtime smoke test.\n${failures.join("\n")}`);
}

export function parseWindowsGpuVendors(output) {
  const vendors = new Set();
  const normalized = output.toLowerCase();
  if (/\bnvidia\b|geforce|quadro|rtx|gtx/.test(normalized)) vendors.add("nvidia");
  if (/\bintel\b|iris|uhd graphics|arc graphics/.test(normalized)) vendors.add("intel");
  return vendors;
}

export function getAutoEncoderOrder({
  platform = process.platform,
  gpuVendors = new Set()
} = {}) {
  if (platform !== "win32") return AUTO_ORDER;

  const order = [];
  if (gpuVendors.has("nvidia")) order.push("nvenc");
  if (gpuVendors.has("intel")) order.push("qsv");
  order.push("x264");
  return order;
}

export function buildEncoderSmokeArgs(encoder) {
  return [
    "-hide_banner",
    "-loglevel",
    "error",
    "-f",
    "lavfi",
    "-i",
    "color=c=black:s=128x128:r=30:d=0.1",
    "-frames:v",
    "1",
    "-an",
    "-vf",
    `format=${encoder.filterFormat}`,
    "-c:v",
    encoder.codec,
    "-b:v",
    "1M",
    "-f",
    "null",
    "-"
  ];
}

async function runEncoderSmoke(ffmpegPath, encoder, { run, signal, timeoutMs }) {
  let result;
  try {
    result = await run(ffmpegPath, buildEncoderSmokeArgs(encoder), { signal, timeoutMs });
  } catch (error) {
    if (isAbortError(error)) throw error;
    if (error?.code === "PROCESS_TIMEOUT") {
      return { ok: false, message: "runtime smoke test timed out. Technical diagnostic output omitted." };
    }
    return { ok: false, message: "runtime smoke test failed to run. Technical diagnostic output omitted." };
  }
  if (result.code === 0) return { ok: true, message: "" };
  return {
    ok: false,
    message: firstUsefulLine(`${result.stderr}\n${result.stdout}`) || `exit code ${result.code}`
  };
}

async function detectWindowsGpuVendors({ run = runProcess, signal } = {}) {
  let result;
  try {
    result = await run(WINDOWS_GPU_COMMAND, WINDOWS_GPU_ARGS, {
      signal,
      timeoutMs: WINDOWS_GPU_DETECTION_TIMEOUT_MS
    });
  } catch (error) {
    if (isAbortError(error)) throw error;
    return new Set();
  }
  if (result.code !== 0) return new Set();
  return parseWindowsGpuVendors(`${result.stdout}\n${result.stderr}`);
}

function firstUsefulLine(output) {
  return output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line && !line.startsWith("ffmpeg version")) ?? "";
}
