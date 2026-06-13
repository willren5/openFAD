import { spawn } from "node:child_process";
import { access, chmod, mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import assert from "node:assert/strict";

import {
  buildOutputPlan,
  formatCliError,
  formatDryRunLines,
  formatResultLines,
  parseCliArgs
} from "../src/cli.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const privateUserRoot = `/${"Users"}/will`;

test("parses CLI options without shell-specific behavior", () => {
  const options = parseCliArgs([
    "input-folder",
    "--out",
    "dist",
    "--mode",
    "scale-fill",
    "--fps",
    "30",
    "--bitrate",
    "45M",
    "--container",
    "mov",
    "--dry-run"
  ]);

  assert.deepEqual(options, {
    input: "input-folder",
    outDir: "dist",
    mode: "scale-fill",
    fps: "30",
    bitrate: "45M",
    container: "mov",
    encoder: "x264",
    dryRun: true,
    qcOnly: false,
    previewOnly: false,
    overwrite: false
  });
});

test("defaults to 50M bitrate to keep real H.264 outputs above Apple's 45 Mbps floor", () => {
  const options = parseCliArgs(["input.mov"]);
  assert.equal(options.bitrate, "50M");
  assert.equal(options.encoder, "x264");
});

test("defaults output frame rate to auto instead of forcing 30 fps", () => {
  const options = parseCliArgs(["input.mov"]);
  assert.equal(options.fps, "auto");
});

test("parses hardware encoder option", () => {
  const options = parseCliArgs(["input.mov", "--encoder", "nvenc"]);
  assert.equal(options.encoder, "nvenc");
});

test("parses explicit overwrite option", () => {
  const options = parseCliArgs(["input.mov", "--overwrite"]);
  assert.equal(options.overwrite, true);
});

test("CLI rejects multiple positional inputs because only one input file or folder is accepted", () => {
  assert.throws(
    () => parseCliArgs(["one.mov", "two.mov"]),
    /Only one input file or folder is accepted/i
  );
});

test("CLI rejects mutually exclusive QC-only and preview-only modes", () => {
  assert.throws(() => parseCliArgs(["input.mov", "--qc-only", "--preview-only"]), /cannot be used together/);
});

test("CLI validates frame rate before invoking FFmpeg", () => {
  assert.equal(parseCliArgs(["input.mov", "--fps", "30000/1001"]).fps, "30000/1001");
  assert.equal(parseCliArgs(["input.mov", "--fps", "29.97"]).fps, "29.97");
  assert.throws(() => parseCliArgs(["input.mov", "--fps", "30fps"]), /Frame rate must be auto/);
  assert.throws(() => parseCliArgs(["input.mov", "--fps", "60"]), /Frame rate must be auto/);
});

test("CLI validates H.264 bitrate before invoking FFmpeg", () => {
  assert.equal(parseCliArgs(["input.mov", "--bitrate", "45M"]).bitrate, "45M");
  assert.equal(parseCliArgs(["input.mov", "--bitrate", "50m"]).bitrate, "50M");
  assert.throws(() => parseCliArgs(["input.mov", "--bitrate", "5M"]), /Bitrate must be between 45M and 100M/);
  assert.throws(() => parseCliArgs(["input.mov", "--bitrate", "banana"]), /Bitrate must be between 45M and 100M/);
});

test("plans deterministic output paths for both Apple targets", () => {
  const plan = buildOutputPlan({
    inputPath: "/work/My Cover.mov",
    outDir: "/work/out",
    container: "mp4"
  });

  assert.equal(plan.baseName, "My Cover");
  assert.equal(plan.oneByOne.endsWith("My Cover__apple-motion-1x1.mp4"), true);
  assert.equal(plan.threeByFour.endsWith("My Cover__apple-motion-3x4.mp4"), true);
  assert.equal(plan.preview.endsWith("My Cover__apple-motion-3x4-preview.png"), true);
  assert.equal(plan.reportJson.endsWith("My Cover__apple-motion-qc.json"), true);
  assert.equal(plan.reportHtml.endsWith("My Cover__apple-motion-qc.html"), true);
});

test("formats qc-only results without claiming rendered output files", () => {
  const lines = formatResultLines({
    inputPath: "input.mov",
    outputPlan: {
      oneByOne: "out/one.mp4",
      threeByFour: "out/three.mp4",
      preview: "out/preview.png",
      reportHtml: "out/report.html"
    },
    report: { ok: true }
  }, { qcOnly: true, previewOnly: false });

  assert.equal(lines.includes("  1x1: out/one.mp4"), false);
  assert.equal(lines.includes("  3x4: out/three.mp4"), false);
  assert.equal(lines.includes("  报告 / report: out/report.html"), true);
});

test("formats qc-only dry runs with an explicit no-render plan", () => {
  const lines = formatDryRunLines({
    inputPath: "input.mov",
    outputPlan: {
      reportHtml: "out/report.html"
    },
    commands: []
  }, { qcOnly: true });

  assert.deepEqual(lines, [
    "输入 / Input: input.mov",
    "  没有计划运行 FFmpeg 渲染命令 / no FFmpeg render commands planned",
    "  计划报告 / planned report: out/report.html"
  ]);
});

test("formats failed file results with sanitized CLI diagnostics", () => {
  const error = new Error(`ffmpeg failed for 3x4 ${privateUserRoot}/cover.mov:\nError: spawn ${privateUserRoot}/.private-fixture/tool-bin/ffmpeg\nstderr token`);
  const lines = formatResultLines({
    inputPath: "cover.mov",
    outputPlan: {
      oneByOne: "out/one.mp4",
      threeByFour: "out/three.mp4",
      preview: "out/preview.png",
      reportHtml: "out/report.html"
    },
    error
  }, { qcOnly: false, previewOnly: false });

  assert.deepEqual(lines, [
    "FAIL: cover.mov",
    "  错误 / error: FFmpeg 无法生成视频输出。请检查输入文件、输出文件夹权限和本地视频工具安装后重试。 / FFmpeg could not generate the video output. Check the input file, output folder permissions, and local video tool installation, then try again."
  ]);
  assert.doesNotMatch(lines.join("\n"), /\/Users|\.private-fixture|tool-bin|stderr token|spawn|cover\.mov:/i);
});

test("formats tagged encoder resolution CLI errors without raw process diagnostics", () => {
  const error = Object.assign(new Error(`spawn ${privateUserRoot}/.private-fixture/tool-bin/ffmpeg ENOENT`), {
    code: "ENOENT",
    syscall: `spawn ${privateUserRoot}/.private-fixture/tool-bin/ffmpeg`,
    path: `${privateUserRoot}/.private-fixture/tool-bin/ffmpeg`,
    fadAppleMotionErrorKind: "encoder-resolution"
  });

  const message = formatCliError(error);

  assert.match(message, /usable video encoder|FFmpeg|x264|auto/i);
  assert.doesNotMatch(message, /\/Users|\.private-fixture|tool-bin|spawn|ENOENT/i);
});

test("CLI prints mixed batch outcomes and exits non-zero when one file fails", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "apple-motion-cli-"));
  const inputDir = path.join(tempDir, "covers");
  const outDir = path.join(tempDir, "out");
  const badInput = path.join(inputDir, "bad.mov");
  const goodInput = path.join(inputDir, "good.mov");
  const fakeFfmpeg = await writeFakeRenderingFfmpeg(tempDir);
  const fakeFfprobe = await writeFakeMixedDurationFfprobe(tempDir);
  await mkdir(inputDir);
  await writeFile(badInput, "");
  await writeFile(goodInput, "");

  const result = await runCli([
    inputDir,
    "--out", outDir,
    "--ffmpeg", fakeFfmpeg,
    "--ffprobe", fakeFfprobe,
    "--fps", "30",
    "--bitrate", "50M",
    "--encoder", "x264"
  ]);

  assert.equal(result.code, 1);
  assert.match(result.stdout, /FAIL: .*bad\.mov/);
  assert.match(result.stdout, /PASS: .*good\.mov/);
  assert.match(result.stdout, /8-35 seconds/);
  assert.doesNotMatch(result.stdout, /3600|Duration must be between|fake-mixed-duration-ffprobe|stderr|node:/i);
  assert.equal(await fileExists(path.join(outDir, "bad__apple-motion-1x1.mp4")), false);
  assert.equal(await fileExists(path.join(outDir, "good__apple-motion-1x1.mp4")), true);
});

test("formats ambiguous input CLI errors without raw stream diagnostics", () => {
  const error = new Error(`Input is ambiguous and cannot be rendered safely: ${privateUserRoot}/cover.mov\nExactly one video stream is required, found 2.`);
  error.fadAppleMotionErrorKind = "ambiguous-input-stream";

  const message = formatCliError(error);

  assert.match(message, /exactly one video track/i);
  assert.doesNotMatch(message, /Input is ambiguous|Exactly one video stream|\/Users|cover\.mov/i);
});

test("formats invalid input spec CLI errors without raw probe diagnostics", () => {
  const error = new Error(`Input does not meet Apple Motion source requirements: ${privateUserRoot}/cover.mov\nDuration must be between 8 and 35 seconds, found 3600 seconds.`);
  error.fadAppleMotionErrorKind = "invalid-input-spec";

  const message = formatCliError(error);

  assert.match(message, /Apple Motion source requirements|8-35 seconds/i);
  assert.doesNotMatch(message, /\/Users|cover\.mov|3600|Duration must/i);
});

test("formats invalid input color CLI errors without raw color metadata", () => {
  const error = new Error(`Input does not meet Apple Motion source requirements: ${privateUserRoot}/cover.mov\nColor profile must be Rec. 709/sRGB or HDR BT.2020 PQ/HLG, found bt470bg / bt709 / bt470bg.`);
  error.fadAppleMotionErrorKind = "invalid-input-spec";
  error.fadAppleMotionInputSpecErrors = ["Color profile must be Rec. 709/sRGB or HDR BT.2020 PQ/HLG, found bt470bg / bt709 / bt470bg."];

  const message = formatCliError(error);

  assert.match(message, /color profile|Rec\. 709|sRGB|HDR BT\.2020/i);
  assert.doesNotMatch(message, /\/Users|cover\.mov|bt470|Color profile must/i);
});

test("formats dataless input CLI errors without local paths", () => {
  const error = new Error(`Input video file appears to be dataless: ${privateUserRoot}/iCloud/cover.mov`);
  error.fadAppleMotionErrorKind = "dataless-input-file";
  error.inputPath = `${privateUserRoot}/iCloud/cover.mov`;

  const message = formatCliError(error);

  assert.match(message, /download|materialize/i);
  assert.doesNotMatch(message, /\/Users|iCloud|cover\.mov|dataless/i);
});

test("formats process timeout CLI errors without raw process output", () => {
  const error = Object.assign(new Error("ffprobe timed out after 30000ms.\nstdout token\nstderr secret"), {
    code: "PROCESS_TIMEOUT",
    stdout: "stdout token",
    stderr: "stderr secret"
  });

  const message = formatCliError(error);

  assert.match(message, /timed out|fully downloaded|playable/i);
  assert.doesNotMatch(message, /stdout token|stderr secret|ffprobe timed out|30000/);
});

test("formats output transaction CLI errors without journal paths", () => {
  const error = new Error("Could not read output transaction journal /var/tmp/out/.openfad-motion-transaction.broken.json: Expected property name or '}' in JSON at position 2");

  const message = formatCliError(error);

  assert.match(message, /interrupted output write/i);
  assert.doesNotMatch(message, /Could not read|journal|\.openfad-motion|broken|JSON|\/var/i);
});

test("formats unsafe standalone rollback CLI errors without journal paths", () => {
  const error = new Error("Cannot safely roll back output transaction /var/tmp/out/.openfad-motion-transaction.stale.json: missing backup for /var/tmp/out/cover__apple-motion-3x4-preview.png.");

  const message = formatCliError(error);

  assert.match(message, /interrupted output write/i);
  assert.doesNotMatch(message, /Cannot safely|transaction|journal|backup|\.openfad-motion|cover__apple-motion|\/var/i);
});

test("formats filesystem CLI errors without raw local paths", () => {
  const missingInput = Object.assign(
    new Error(`ENOENT: no such file or directory, stat '${privateUserRoot}/.private-fixture/demo-project/missing.mov'`),
    { code: "ENOENT", syscall: "stat", path: `${privateUserRoot}/.private-fixture/demo-project/missing.mov` }
  );
  const inaccessibleOutput = Object.assign(
    new Error(`EACCES: permission denied, mkdir '${privateUserRoot}/private/out'`),
    { code: "EACCES", syscall: "mkdir", path: `${privateUserRoot}/private/out` }
  );

  const missingMessage = formatCliError(missingInput);
  const inaccessibleMessage = formatCliError(inaccessibleOutput);

  assert.match(missingMessage, /input|file|folder/i);
  assert.match(inaccessibleMessage, /permission|output|folder/i);
  for (const message of [missingMessage, inaccessibleMessage]) {
    assert.doesNotMatch(message, /ENOENT|EACCES|\/Users|\.private-fixture|demo-project|private|missing\.mov|mkdir|stat/);
  }
});

async function runCli(args) {
  const cliPath = path.join(__dirname, "..", "src", "cli.mjs");
  const child = spawn(process.execPath, [cliPath, ...args], {
    cwd: path.join(__dirname, ".."),
    env: { ...process.env },
    stdio: ["ignore", "pipe", "pipe"]
  });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => {
    stdout += chunk.toString();
  });
  child.stderr.on("data", (chunk) => {
    stderr += chunk.toString();
  });
  const timeout = setTimeout(() => child.kill("SIGKILL"), 15_000);
  try {
    return await new Promise((resolve) => {
      child.on("close", (code, signal) => resolve({ code, signal, stdout, stderr }));
    });
  } finally {
    clearTimeout(timeout);
  }
}

async function writeFakeRenderingFfmpeg(tempDir) {
  const scriptPath = path.join(tempDir, "fake-ffmpeg-render.js");
  await writeFile(scriptPath, `#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const args = process.argv.slice(2);
const joined = args.join(" ");
if (args.includes("-encoders")) {
  console.log(" V....D libx264 H.264 / AVC / MPEG-4 AVC / MPEG-4 part 10");
  process.exit(0);
}
if (joined.includes("blackdetect=") || joined.includes("blackframe=") || joined.includes("freezedetect=") || joined.includes("color=c=black")) {
  process.exit(0);
}
const output = args.at(-1);
if (output === "-") {
  process.exit(0);
}
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, "fake media");
process.exit(0);
`);
  await chmod(scriptPath, 0o755);
  return scriptPath;
}

async function writeFakeMixedDurationFfprobe(tempDir) {
  const scriptPath = path.join(tempDir, "fake-mixed-duration-ffprobe.js");
  await writeFile(scriptPath, `#!/usr/bin/env node
const input = process.argv.at(-1);
const isOneByOne = input.includes("__apple-motion-1x1");
const isBadSource = input.endsWith("bad.mov");
const width = isOneByOne ? 3840 : 2048;
const height = isOneByOne ? 3840 : 2732;
const duration = isBadSource ? "3600" : "15.1";
process.stdout.write(JSON.stringify({
  streams: [{
    codec_type: "video",
    codec_name: "h264",
    width,
    height,
    sample_aspect_ratio: "1:1",
    avg_frame_rate: "30/1",
    bit_rate: "50000000",
    color_space: "bt709",
    color_transfer: "bt709",
    color_primaries: "bt709",
    pix_fmt: "yuv420p",
    duration
  }],
  format: {
    duration,
    bit_rate: "50000000"
  }
}));
`);
  await chmod(scriptPath, 0o755);
  return scriptPath;
}

async function fileExists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}

test("formats raw child process CLI diagnostics without local paths or stderr", () => {
  const envFile = `.${"env"}`;
  const rawErrors = [
    `ffmpeg failed for 3x4 ${privateUserRoot}/cover.mov:\nError: spawn ${privateUserRoot}/.private-fixture/tool-bin/ffmpeg\nstderr token`,
    `ffprobe failed for ${privateUserRoot}/cover.mov:\nffprobe stderr:\n${privateUserRoot}/${envFile} parser error`,
    `Could not inspect FFmpeg encoders:\nError: spawn ENOENT ${privateUserRoot}/private/ffmpeg`,
    `h264_nvenc is available but failed a runtime smoke test:\n${privateUserRoot}/.private-fixture/tool-bin/ffmpeg stderr token`,
    `No supported H.264 encoder passed a runtime smoke test.\nlibx264: ${privateUserRoot}/${envFile} parser error`
  ];

  for (const rawError of rawErrors) {
    const message = formatCliError(new Error(rawError));

    assert.match(message, /FFmpeg|FFprobe|encoder|local video tool/i);
    assert.doesNotMatch(message, new RegExp(`/Users|\\.private-fixture|tool-bin|\\.${"env"}|stderr token|spawn|ENOENT|cover\\.mov|parser error`, "i"));
  }
});
