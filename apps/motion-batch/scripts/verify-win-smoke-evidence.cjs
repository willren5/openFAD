#!/usr/bin/env node
"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const DEFAULT_EVIDENCE_PATH = path.join(__dirname, "..", "tmp", "win-runtime-smoke", "evidence.json");
const REQUIRED_SCREENSHOTS = [
  "empty",
  "previewStarted",
  "previewed",
  "overwriteDialog",
  "overwriteConfirmDialog",
  "cancelActive",
  "cancelled",
  "missingFfprobe",
  "fullStarted",
  "fullFinished"
];

function parseArgs(argv) {
  const options = {
    evidencePath: DEFAULT_EVIDENCE_PATH,
    help: false
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") {
      options.help = true;
    } else if (arg === "--evidence") {
      options.evidencePath = requireNextValue(argv, ++index, arg);
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }
  return options;
}

function requireNextValue(argv, index, option) {
  const value = argv[index];
  if (!value || value.startsWith("--")) throw new Error(`Missing value for ${option}`);
  return value;
}

function usage() {
  return [
    "Usage: node ./scripts/verify-win-smoke-evidence.cjs [options]",
    "",
    "Verifies a Windows packaged-runtime smoke evidence.json for release-gate eligibility.",
    "",
    "Options:",
    "  --evidence <path>    Evidence JSON path",
    "  --help              Show this help"
  ].join("\n");
}

function verifyWinSmokeEvidence({ evidencePath = DEFAULT_EVIDENCE_PATH } = {}) {
  const resolvedEvidencePath = path.resolve(evidencePath);
  const evidence = readEvidenceJson(resolvedEvidencePath);

  assertEqual(evidence.schemaVersion, 1, "schemaVersion must be 1.");
  assertEqual(evidence.status, "passed", "status must be passed.");
  assertEqual(evidence.smokePassed, true, "smokePassed must be true.");
  assertEqual(evidence.releaseGate?.passed, true, "releaseGate.passed must be true.");
  assertEqual(evidence.releaseGate?.fullRenderRequired, true, "releaseGate.fullRenderRequired must be true.");
  assertEqual(evidence.releaseGate?.fullRenderSkipped, false, "releaseGate.fullRenderSkipped must be false.");
  assertEqual(evidence.passed, true, "passed must be true.");
  assertEqual(Boolean(evidence.options?.skipFullRender), false, "skipFullRender must be false.");
  if (evidence.failure) throw new Error("failure must be absent for release evidence.");

  assertFileSha(evidence.appPath, evidence.appSha256, "packaged app");
  assertFileSha(evidence.bundledTools?.ffmpeg?.path, evidence.bundledTools?.ffmpeg?.sha256, "bundled ffmpeg");
  assertFileSha(evidence.bundledTools?.ffprobe?.path, evidence.bundledTools?.ffprobe?.sha256, "bundled ffprobe");
  assertPoisonedEnvironment(evidence);

  assertProbeHasAudio(evidence.inputProbe, "primary smoke input");
  assertProbeHasAudio(evidence.overwriteInputProbe, "overwrite smoke input");
  assertProbeHasAudio(evidence.cancelInputProbe, "cancel smoke input");

  assertEqual(evidence.jobs?.preview?.status, "previewed", "preview job must finish with status previewed.");
  assertEqual(evidence.jobs?.overwrite?.status, "previewed", "overwrite job must finish with status previewed.");
  assertEqual(evidence.jobs?.cancel?.status, "cancelled", "cancel job must finish with status cancelled.");
  assertEqual(evidence.jobs?.full?.status, "succeeded", "full job must finish with status succeeded.");

  const screenshots = verifyRequiredScreenshots(evidence.screenshots);
  assertFileEvidence(evidence.assets?.preview, "preview asset");
  assertPresent(evidence.assets?.preview?.endpointSha256, "preview asset endpointSha256 is required.");
  assertPresent(evidence.assets?.fullPreview?.endpointSha256, "full preview endpointSha256 is required.");
  assertPresent(evidence.assets?.reportHtml?.assetId, "report HTML asset id is required.");

  const outputs = [
    assertVideoOnlyOutput("1x1 output", evidence.outputs?.oneByOne, { width: 3840, height: 3840 }),
    assertVideoOnlyOutput("3x4 output", evidence.outputs?.threeByFour, { width: 2048, height: 2732 })
  ];
  assertFileEvidence(evidence.outputs?.preview, "full preview file");
  assertFileEvidence(evidence.outputs?.reportJson, "JSON report");
  assertFileEvidence(evidence.outputs?.reportHtml, "HTML report");
  assertReleaseReport(evidence.outputs?.reportJson?.parsed);

  assertEqual(evidence.reveal?.preview?.ok, true, "preview reveal must succeed.");
  assertEqual(evidence.reveal?.report?.ok, true, "report reveal must succeed.");
  assertEqual(evidence.reveal?.staleAsset?.status, 403, "stale reveal smoke must return HTTP 403.");

  return {
    evidencePath: resolvedEvidencePath,
    screenshots,
    outputs
  };
}

function readEvidenceJson(evidencePath) {
  const text = fs.readFileSync(evidencePath, "utf8");
  const parsed = JSON.parse(text);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Evidence JSON must be an object.");
  }
  return parsed;
}

function verifyRequiredScreenshots(screenshots) {
  if (!screenshots || typeof screenshots !== "object") {
    throw new Error("screenshots must be an object.");
  }
  return REQUIRED_SCREENSHOTS.map((key) => {
    const screenshotPath = screenshots[key];
    assertFileExists(screenshotPath, `screenshot ${key}`);
    return { key, path: screenshotPath };
  });
}

function assertVideoOnlyOutput(label, output, expected) {
  assertFileEvidence(output, label);
  const streams = Array.isArray(output.streams) ? output.streams : [];
  if (streams.length !== 1 || streams[0]?.codec_type !== "video") {
    throw new Error(`${label} must contain exactly one video stream.`);
  }
  const video = streams[0];
  assertEqual(video.width, expected.width, `${label} width must be ${expected.width}.`);
  assertEqual(video.height, expected.height, `${label} height must be ${expected.height}.`);
  assertEqual(video.codec_name, "h264", `${label} codec must be h264.`);
  return { label, path: output.path };
}

function assertReleaseReport(report) {
  if (report?.ok !== true) throw new Error("JSON report must be PASS.");
  const items = Array.isArray(report.items) ? report.items : [];
  const targets = new Set(items.map((item) => item?.target));
  for (const target of ["1x1", "3x4"]) {
    if (!targets.has(target)) throw new Error(`JSON report must include ${target}.`);
  }
  for (const item of items) {
    if ((item?.warnings ?? []).length > 0) {
      throw new Error(`JSON report target ${item.target ?? "unknown"} must not contain warnings.`);
    }
  }
}

function assertProbeHasAudio(probe, label) {
  const streamTypes = (probe?.streams ?? []).map((stream) => stream.codec_type);
  if (!streamTypes.includes("audio")) {
    throw new Error(`${label} must contain an audio stream.`);
  }
}

function assertPoisonedEnvironment(evidence) {
  const env = evidence.poisonedEnvironment ?? {};
  assertPresent(env.OPENFAD_MOTION_USER_DATA_DIR, "isolated userData env is required.");
  assertPresent(env.FFMPEG_PATH, "poisoned FFMPEG_PATH is required.");
  assertPresent(env.FFPROBE_PATH, "poisoned FFPROBE_PATH is required.");
  assertPresent(env.PATH, "poisoned PATH is required.");
  if (env.FFMPEG_PATH === evidence.bundledTools?.ffmpeg?.path) {
    throw new Error("poisoned FFMPEG_PATH must not point at bundled ffmpeg.");
  }
  if (env.FFPROBE_PATH === evidence.bundledTools?.ffprobe?.path) {
    throw new Error("poisoned FFPROBE_PATH must not point at bundled ffprobe.");
  }
}

function assertFileEvidence(evidence, label) {
  if (!evidence || typeof evidence !== "object") {
    throw new Error(`${label} evidence is required.`);
  }
  assertEqual(evidence.exists, true, `${label} must exist.`);
  assertFileSha(evidence.path, evidence.sha256, label);
  if (Number.isFinite(evidence.size)) {
    const stat = fs.statSync(evidence.path);
    assertEqual(stat.size, evidence.size, `${label} size must match evidence.`);
  }
}

function assertFileSha(filePath, expectedSha256, label) {
  assertFileExists(filePath, label);
  assertPresent(expectedSha256, `${label} sha256 is required.`);
  const actualSha256 = sha256File(filePath);
  assertEqual(actualSha256, expectedSha256, `${label} sha256 must match evidence.`);
}

function assertFileExists(filePath, label) {
  if (typeof filePath !== "string" || filePath.length === 0) {
    throw new Error(`${label} path is required.`);
  }
  const stat = fs.statSync(filePath, { throwIfNoEntry: false });
  if (!stat?.isFile()) throw new Error(`${label} file is missing: ${filePath}`);
}

function assertPresent(value, message) {
  if (value === null || value === undefined || value === "") throw new Error(message);
}

function assertEqual(actual, expected, message) {
  if (actual !== expected) {
    throw new Error(`${message} Expected ${JSON.stringify(expected)}, found ${JSON.stringify(actual)}.`);
  }
}

function sha256File(filePath) {
  const hash = crypto.createHash("sha256");
  const file = fs.openSync(filePath, "r");
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  try {
    let bytesRead = 0;
    while ((bytesRead = fs.readSync(file, buffer, 0, buffer.length, null)) > 0) {
      hash.update(buffer.subarray(0, bytesRead));
    }
    return hash.digest("hex");
  } finally {
    fs.closeSync(file);
  }
}

function run() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(usage());
    return;
  }
  const result = verifyWinSmokeEvidence({ evidencePath: options.evidencePath });
  console.log(`Verified Windows runtime smoke evidence: ${result.evidencePath}`);
}

if (require.main === module) {
  try {
    run();
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}

module.exports = {
  DEFAULT_EVIDENCE_PATH,
  REQUIRED_SCREENSHOTS,
  parseArgs,
  usage,
  verifyWinSmokeEvidence
};
