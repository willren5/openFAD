#!/usr/bin/env node
import path from "node:path";
import { fileURLToPath } from "node:url";

import { formatLocalToolCliError } from "./diagnostics.mjs";
import { isAllowedFrameRate } from "./spec.mjs";

const DEFAULT_OPTIONS = {
  outDir: "apple-motion-output",
  mode: "scale-fill",
  fps: "auto",
  bitrate: "50M",
  container: "mp4",
  encoder: "x264",
  dryRun: false,
  qcOnly: false,
  previewOnly: false,
  overwrite: false
};

export function parseCliArgs(argv) {
  const options = { ...DEFAULT_OPTIONS };
  const args = [...argv];
  const positional = [];

  while (args.length > 0) {
    const arg = args.shift();
    if (arg === "--help" || arg === "-h") {
      options.help = true;
    } else if (arg === "--dry-run") {
      options.dryRun = true;
    } else if (arg === "--qc-only") {
      options.qcOnly = true;
    } else if (arg === "--preview-only") {
      options.previewOnly = true;
    } else if (arg === "--overwrite") {
      options.overwrite = true;
    } else if (arg === "--out") {
      options.outDir = requireValue(arg, args.shift());
    } else if (arg === "--mode") {
      options.mode = requireValue(arg, args.shift());
    } else if (arg === "--fps") {
      options.fps = normalizeFrameRate(requireValue(arg, args.shift()));
    } else if (arg === "--bitrate") {
      options.bitrate = normalizeBitrate(requireValue(arg, args.shift()));
    } else if (arg === "--container") {
      options.container = normalizeContainer(requireValue(arg, args.shift()));
    } else if (arg === "--encoder") {
      options.encoder = normalizeEncoder(requireValue(arg, args.shift()));
    } else if (arg === "--ffmpeg") {
      options.ffmpegPath = requireValue(arg, args.shift());
    } else if (arg === "--ffprobe") {
      options.ffprobePath = requireValue(arg, args.shift());
    } else if (arg?.startsWith("--")) {
      throw new Error(`Unknown option: ${arg}`);
    } else {
      positional.push(arg);
    }
  }

  if (positional.length > 1) {
    throw new Error("Only one input file or folder is accepted.");
  }

  if (positional.length > 0) {
    options.input = positional[0];
  }

  if (!options.help && !options.input) {
    throw new Error("Input file or folder is required.");
  }
  if (options.qcOnly && options.previewOnly) {
    throw new Error("--qc-only and --preview-only cannot be used together.");
  }

  return options;
}

export function buildOutputPlan({ inputPath, outDir, container }) {
  const baseName = path.parse(inputPath).name;
  const ext = normalizeContainer(container);
  return {
    baseName,
    oneByOne: path.join(outDir, `${baseName}__apple-motion-1x1.${ext}`),
    threeByFour: path.join(outDir, `${baseName}__apple-motion-3x4.${ext}`),
    preview: path.join(outDir, `${baseName}__apple-motion-3x4-preview.png`),
    reportJson: path.join(outDir, `${baseName}__apple-motion-qc.json`),
    reportHtml: path.join(outDir, `${baseName}__apple-motion-qc.html`)
  };
}

export function usage() {
  return `Usage:
  openfad-motion <input-file-or-folder> [options]

Options:
  --out <dir>          Output folder. Default: apple-motion-output
  --mode <mode>        3x4 composition mode: scale-fill or blur-extend. Default: scale-fill
  --fps <rate>         Output frame rate, or auto to preserve Apple-allowed source rates. Default: auto
  --bitrate <rate>     H.264 target bitrate. Default: 50M
  --encoder <name>     x264, nvenc, qsv, or auto. Default: x264
  --container <ext>    mp4 or mov. Default: mp4
  --qc-only            Do not render; QC the input file only.
  --preview-only       Generate 3x4 preview overlay only.
  --dry-run            Print planned commands without running FFmpeg.
  --overwrite          Replace existing output files.
  --ffmpeg <path>      Custom FFmpeg executable path.
  --ffprobe <path>     Custom FFprobe executable path.
`;
}

export function formatResultLines(result, options) {
  if (result.error) {
    return [
      `FAIL: ${result.inputPath}`,
      `  error: ${formatCliError(result.error)}`
    ];
  }

  const status = result.report ? (result.report.ok ? "PASS" : "FAIL") : "OK";
  const lines = [`${status}: ${result.inputPath}`];

  if (!options.qcOnly && !options.previewOnly) {
    lines.push(`  1x1: ${result.outputPlan.oneByOne}`);
    lines.push(`  3x4: ${result.outputPlan.threeByFour}`);
    lines.push(`  preview: ${result.outputPlan.preview}`);
  } else if (options.previewOnly) {
    lines.push(`  preview: ${result.outputPlan.preview}`);
  }

  if (result.report) {
    lines.push(`  report: ${result.outputPlan.reportHtml}`);
  }

  return lines;
}

export function formatDryRunLines(result, options) {
  if (result.error) {
    return [
      `FAIL: ${result.inputPath}`,
      `  error: ${formatCliError(result.error)}`
    ];
  }

  const lines = [`Input: ${result.inputPath}`];
  const commands = Array.isArray(result.commands) ? result.commands : [];

  if (commands.length) {
    for (const command of commands) {
      lines.push(`[${command.target}] ${command.command} ${command.args.map(quoteArg).join(" ")}`);
    }
  } else {
    lines.push("  no FFmpeg render commands planned");
  }

  if (options.qcOnly && result.outputPlan?.reportHtml) {
    lines.push(`  planned report: ${result.outputPlan.reportHtml}`);
  }

  return lines;
}

export function formatCliError(error) {
  if (error?.fadAppleMotionErrorKind === "ambiguous-input-stream") {
    return "Input video stream is ambiguous. Export a .mov or .mp4 with exactly one video track and try again.";
  }
  if (isUnsupportedInputColorDiagnostic(error)) {
    return "Input video color profile is unsafe. Export as Rec. 709/sRGB SDR, or as clearly tagged HDR BT.2020 footage, then retry.";
  }
  if (error?.fadAppleMotionErrorKind === "invalid-input-spec") {
    return "Input video does not meet Apple Motion source requirements. Confirm the source duration is 8-35 seconds, then export it again and retry.";
  }
  if (isOutputTransactionRecoveryDiagnostic(error)) {
    return "Could not recover an interrupted output write. Inspect temporary files in the output folder, or choose a new output folder and try again.";
  }
  const localToolError = formatLocalToolCliError(error);
  if (localToolError) return localToolError;
  return error?.message || String(error);
}

async function main() {
  const options = parseCliArgs(process.argv.slice(2));
  if (options.help) {
    console.log(usage());
    return;
  }

  const { runBatch } = await import("./batch.mjs");
  const results = await runBatch(options);

  if (options.dryRun) {
    for (const result of results) {
      console.log(formatDryRunLines(result, options).join("\n"));
    }
    if (results.some(resultHasFailure)) process.exitCode = 1;
    return;
  }

  for (const result of results) {
    console.log(formatResultLines(result, options).join("\n"));
  }
  if (results.some(resultHasFailure)) process.exitCode = 1;
}

function requireValue(option, value) {
  if (!value || value.startsWith("--")) {
    throw new Error(`${option} requires a value.`);
  }
  return value;
}

function normalizeContainer(container) {
  const normalized = String(container).replace(/^\./, "").toLowerCase();
  if (normalized !== "mp4" && normalized !== "mov") {
    throw new Error(`Container must be mp4 or mov, found ${container}.`);
  }
  return normalized;
}

function normalizeEncoder(encoder) {
  const normalized = String(encoder).toLowerCase();
  if (!["x264", "nvenc", "qsv", "auto"].includes(normalized)) {
    throw new Error(`Encoder must be x264, nvenc, qsv, or auto, found ${encoder}.`);
  }
  return normalized;
}

export function normalizeFrameRate(frameRate, {
  message = `Frame rate must be auto, 23.976, 24, 25, 29.97, 30, 24000/1001, or 30000/1001.`
} = {}) {
  const normalized = String(frameRate ?? "").trim();
  if (normalized.toLowerCase() === "auto") return "auto";
  if (!isAllowedFrameRate(normalized)) throw new Error(message);
  return normalized;
}

export function normalizeBitrate(bitrate, {
  message = "Bitrate must be between 45M and 100M."
} = {}) {
  const match = String(bitrate ?? "").trim().match(/^(\d+(?:\.\d+)?)m$/i);
  if (!match) throw new Error(message);

  const mbps = Number(match[1]);
  if (!Number.isFinite(mbps) || mbps < 45 || mbps > 100) throw new Error(message);
  return `${match[1]}M`;
}

function quoteArg(value) {
  if (/[\s"'()]/.test(value)) return JSON.stringify(value);
  return value;
}

function resultHasFailure(result) {
  return Boolean(result.error) || result.report?.ok === false;
}

const thisFile = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === thisFile) {
  main().catch((error) => {
    console.error(formatCliError(error));
    process.exitCode = 1;
  });
}

function isOutputTransactionRecoveryDiagnostic(error) {
  const message = String(error?.message ?? error);
  return /^(Could not read|Invalid|Unsafe) output (?:transaction|group) journal /.test(message)
    || message.startsWith("Cannot safely roll back output group ")
    || message.startsWith("Cannot safely roll back output transaction ");
}

function isUnsupportedInputColorDiagnostic(error) {
  return error?.fadAppleMotionErrorKind === "unsupported-input-color"
    || (error?.fadAppleMotionErrorKind === "invalid-input-spec" && Array.isArray(error.fadAppleMotionInputSpecErrors)
      && error.fadAppleMotionInputSpecErrors.some((message) => String(message).startsWith("Color profile must ")));
}
