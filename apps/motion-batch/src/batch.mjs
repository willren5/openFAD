import { access, mkdir, readdir, realpath, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  buildAtomicOutput,
  cleanupAtomicOutput,
  cleanupCommittedOutputs,
  commitAtomicOutput,
  finalizeCommittedOutputGroup,
  finalizeCommittedOutputs,
  recoverOutputTransactions
} from "./atomicOutput.mjs";
import { buildPreviewArgs, buildRenderArgs } from "./ffmpegArgs.mjs";
import { resolveEncoder } from "./encoder.mjs";
import { isAbortError, probeMedia, ProcessAbortedError, runProcess } from "./probe.mjs";
import { inferTargetFromProbe, selectColorConversion, selectOutputFrameRate, validateProbe, validateRenderableInputProbe } from "./spec.mjs";
import { runQcChecks } from "./qc.mjs";
import { cleanupCommittedReports, writeReports } from "./report.mjs";
import { buildOutputPlan } from "./cli.mjs";

const VIDEO_EXTENSIONS = new Set([".mov", ".mp4", ".m4v"]);
export const DEFAULT_RENDER_TIMEOUT_MS = 2 * 60 * 60 * 1000;

export async function runBatch(options) {
  await assertInputOutputDirectoriesAreSeparate(options);
  const files = await collectInputFiles(options.input, {
    excludeDirs: [options.outDir],
    skipGeneratedOutputs: !options.qcOnly,
    signal: options.signal
  });
  if (files.length === 0) {
    throw new Error(`No .mov, .mp4, or .m4v files found in ${options.input}`);
  }
  await assertSafeOutputPaths(files, options);

  const batchContext = await prepareBatchContext(options);
  const results = [];
  for (const inputPath of files) {
    try {
      results.push(await processFile(inputPath, { ...options, batchContext }));
    } catch (error) {
      if (isBatchHardStopError(error)) throw error;
      results.push(buildFailedResult(inputPath, options, error));
    }
  }
  return results;
}

function buildFailedResult(inputPath, options, error) {
  return {
    inputPath,
    outputPlan: buildOutputPlan({
      inputPath,
      outDir: options.outDir,
      container: options.container
    }),
    commands: [],
    report: null,
    error,
    status: "failed"
  };
}

function isBatchHardStopError(error) {
  return isAbortError(error) || isEncoderDiagnostic(error);
}

function isEncoderDiagnostic(error) {
  const message = String(error?.message ?? "");
  return error?.fadAppleMotionErrorKind === "encoder-resolution"
    || message.startsWith("Unknown encoder:")
    || message.startsWith("No supported H.264 encoder")
    || message.includes("is not available in this FFmpeg build")
    || message.startsWith("Could not inspect FFmpeg encoders:")
    || message.includes("failed a runtime smoke test");
}

export async function assertInputOutputDirectoriesAreSeparate(options, {
  message = `Output folder cannot be the same as the input folder: ${options.outDir}. Choose a separate output folder.`,
  signal = options.signal
} = {}) {
  let inputInfo;
  try {
    throwIfAborted(signal);
    inputInfo = await stat(options.input);
    throwIfAborted(signal);
  } catch (error) {
    if (["ENOENT", "ENOTDIR", "EACCES", "EPERM"].includes(error.code)) return;
    throw error;
  }
  if (!inputInfo.isDirectory()) return;
  const inputKey = await normalizeExistingDirectoryKey(options.input, { signal });
  throwIfAborted(signal);
  const outputKey = await normalizeExistingDirectoryKey(options.outDir, { signal });
  throwIfAborted(signal);
  if (inputKey === outputKey) {
    throw new Error(message);
  }
}

export async function assertSafeOutputPaths(files, options, { signal = options.signal } = {}) {
  await assertNoOutputPathCollisions(files, options, { signal });
  await recoverPlannedOutputTransactions(files, options, { signal });
  if (!options.dryRun && !options.overwrite) {
    await assertNoExistingOutputFiles(files, options, { signal });
  }
}

export async function prepareBatchContext(options) {
  const ffmpegPath = options.ffmpegPath ?? process.env.FFMPEG_PATH ?? "ffmpeg";
  const ffprobePath = options.ffprobePath ?? process.env.FFPROBE_PATH ?? "ffprobe";

  return {
    ffmpegPath,
    ffprobePath
  };
}

export async function collectInputFiles(input, { excludeDirs = [], skipGeneratedOutputs = false, signal } = {}) {
  const excludedDirectories = await buildExcludedDirectoryKeys(excludeDirs, { signal });
  return collectInputFilesInternal(input, { excludedDirectories, skipGeneratedOutputs, signal });
}

async function buildExcludedDirectoryKeys(excludeDirs, { signal } = {}) {
  const excludedDirectories = new Set();
  for (const directory of excludeDirs) {
    throwIfAborted(signal);
    excludedDirectories.add(normalizeOutputCollisionKey(directory));
    try {
      excludedDirectories.add(normalizeOutputCollisionKey(await realpath(directory)));
    } catch (error) {
      if (!["ENOENT", "ENOTDIR", "EACCES", "EPERM"].includes(error.code)) {
        throw error;
      }
    }
  }
  return excludedDirectories;
}

async function collectInputFilesInternal(input, { excludedDirectories, skipGeneratedOutputs, signal }) {
  throwIfAborted(signal);
  const info = await stat(input);
  throwIfAborted(signal);
  if (info.isFile()) {
    return VIDEO_EXTENSIONS.has(path.extname(input).toLowerCase()) ? [input] : [];
  }
  if (await isExcludedInputDirectory(input, excludedDirectories, { signal })) {
    return [];
  }

  const entries = await readdir(input, { withFileTypes: true });
  throwIfAborted(signal);
  const files = [];
  for (const entry of entries) {
    throwIfAborted(signal);
    const fullPath = path.join(input, entry.name);
    if (entry.isDirectory()) {
      files.push(...await collectInputFilesInternal(fullPath, { excludedDirectories, skipGeneratedOutputs, signal }));
    } else if (VIDEO_EXTENSIONS.has(path.extname(entry.name).toLowerCase()) && !shouldSkipGeneratedOutput(entry.name, { skipGeneratedOutputs })) {
      files.push(fullPath);
    }
  }
  return files.sort();
}

async function isExcludedInputDirectory(input, excludedDirectories, { signal } = {}) {
  if (excludedDirectories.has(normalizeOutputCollisionKey(input))) return true;
  try {
    const canonical = await realpath(input);
    throwIfAborted(signal);
    return excludedDirectories.has(normalizeOutputCollisionKey(canonical));
  } catch (error) {
    if (["ENOENT", "ENOTDIR", "EACCES", "EPERM"].includes(error.code)) return false;
    throw error;
  }
}

function shouldSkipGeneratedOutput(fileName, { skipGeneratedOutputs }) {
  if (!skipGeneratedOutputs) return false;
  return /__apple-motion-(?:1x1|3x4|3x4-preview)\./i.test(fileName);
}

async function assertNoOutputPathCollisions(files, options, { signal = options.signal } = {}) {
  const ownersByOutput = new Map();
  const outputCollisionKey = await buildOutputCollisionKeyNormalizer(options.outDir, {
    signal,
    allowFilesystemProbe: !options.dryRun
  });
  for (const inputPath of files) {
    throwIfAborted(signal);
    const outputPlan = buildOutputPlan({
      inputPath,
      outDir: options.outDir,
      container: options.container
    });
    for (const outputPath of plannedOutputPaths(outputPlan, options)) {
      throwIfAborted(signal);
      const key = outputCollisionKey(outputPath);
      const owner = ownersByOutput.get(key);
      if (owner && owner !== inputPath) {
        throw new Error(`Output path collision: ${outputPath} would be written by both ${owner} and ${inputPath}. Rename one input file or use separate output folders.`);
      }
      ownersByOutput.set(key, inputPath);
    }
  }
}

async function assertNoExistingOutputFiles(files, options, { signal = options.signal } = {}) {
  const existingOutputs = await collectExistingOutputFiles(files, options, { signal });
  if (existingOutputs.length > 0) {
    throw new Error(`Output already exists: ${existingOutputs[0]}. Use --overwrite only when replacing it is intentional.`);
  }
}

export async function collectExistingOutputFiles(files, options, { signal = options.signal } = {}) {
  const existingOutputs = [];
  for (const inputPath of files) {
    throwIfAborted(signal);
    const outputPlan = buildOutputPlan({
      inputPath,
      outDir: options.outDir,
      container: options.container
    });
    for (const outputPath of plannedOutputPaths(outputPlan, options)) {
      throwIfAborted(signal);
      if (await fileExists(outputPath)) existingOutputs.push(outputPath);
      throwIfAborted(signal);
    }
  }
  return existingOutputs;
}

async function recoverPlannedOutputTransactions(files, options, { signal = options.signal } = {}) {
  if (options.dryRun) return;
  const allowedFinalsByDirectory = new Map();
  for (const inputPath of files) {
    throwIfAborted(signal);
    const outputPlan = buildOutputPlan({
      inputPath,
      outDir: options.outDir,
      container: options.container
    });
    for (const outputPath of plannedOutputPaths(outputPlan, options)) {
      throwIfAborted(signal);
      const directory = path.dirname(outputPath);
      const allowedFinals = allowedFinalsByDirectory.get(directory) ?? [];
      allowedFinals.push(outputPath);
      allowedFinalsByDirectory.set(directory, allowedFinals);
    }
  }
  for (const [directory, allowedFinals] of allowedFinalsByDirectory) {
    throwIfAborted(signal);
    await recoverOutputTransactions(directory, { allowedFinals });
    throwIfAborted(signal);
  }
}

export function plannedOutputPaths(outputPlan, options) {
  if (options.qcOnly) return [outputPlan.reportJson, outputPlan.reportHtml];
  if (options.previewOnly) return [outputPlan.preview];
  return [
    outputPlan.oneByOne,
    outputPlan.threeByFour,
    outputPlan.preview,
    outputPlan.reportJson,
    outputPlan.reportHtml
  ];
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

function normalizeOutputCollisionKey(outputPath) {
  const resolved = path.resolve(outputPath);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

async function buildOutputCollisionKeyNormalizer(outDir, { signal, allowFilesystemProbe = true } = {}) {
  const caseInsensitive = await pathUsesCaseInsensitiveNames(outDir, { signal, allowFilesystemProbe });
  return (outputPath) => {
    const resolved = path.resolve(outputPath);
    return caseInsensitive ? resolved.toLowerCase() : resolved;
  };
}

async function pathUsesCaseInsensitiveNames(directoryPath, { signal, allowFilesystemProbe = true } = {}) {
  if (!allowFilesystemProbe) return process.platform === "win32" || process.platform === "darwin";
  const probeDirectory = await findNearestExistingDirectory(directoryPath, { signal });
  if (!probeDirectory) return process.platform === "win32";
  return directoryIsCaseInsensitive(probeDirectory, { signal });
}

async function findNearestExistingDirectory(directoryPath, { signal } = {}) {
  let current = path.resolve(directoryPath);
  while (true) {
    throwIfAborted(signal);
    try {
      const info = await stat(current);
      throwIfAborted(signal);
      return info.isDirectory() ? current : path.dirname(current);
    } catch (error) {
      if (!["ENOENT", "ENOTDIR"].includes(error.code)) throw error;
      const parent = path.dirname(current);
      if (parent === current) return null;
      current = parent;
    }
  }
}

async function directoryIsCaseInsensitive(directoryPath, { signal } = {}) {
  const markerName = `.openfad-motion-case-probe-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}.tmp`;
  const markerPath = path.join(directoryPath, markerName);
  const alternatePath = path.join(directoryPath, markerName.toUpperCase());
  try {
    await writeFile(markerPath, "case probe");
    throwIfAborted(signal);
    return await fileExists(alternatePath);
  } finally {
    await rm(markerPath, { force: true }).catch(() => {});
  }
}

async function normalizeExistingDirectoryKey(directoryPath, { signal } = {}) {
  throwIfAborted(signal);
  try {
    const canonicalPath = await realpath(directoryPath);
    throwIfAborted(signal);
    return normalizeOutputCollisionKey(canonicalPath);
  } catch (error) {
    if (["ENOENT", "ENOTDIR", "EACCES", "EPERM"].includes(error.code)) {
      return normalizeOutputCollisionKey(directoryPath);
    }
    throw error;
  }
}

export async function processFile(inputPath, options) {
  const outputPlan = buildOutputPlan({
    inputPath,
    outDir: options.outDir,
    container: options.container
  });
  const renderPlan = buildAtomicRenderPlan(outputPlan);
  const commands = [];
  const ffmpegPath = options.batchContext?.ffmpegPath ?? options.ffmpegPath ?? process.env.FFMPEG_PATH ?? "ffmpeg";
  const ffprobePath = options.batchContext?.ffprobePath ?? options.ffprobePath ?? process.env.FFPROBE_PATH ?? "ffprobe";

  const inputProbe = !options.qcOnly && !options.dryRun
    ? await withStage(options, { name: "probe", target: "input" }, () => {
        return probeMedia(inputPath, { ffprobePath, signal: options.signal, timeoutMs: options.probeTimeoutMs });
      })
    : null;
  if (inputProbe) assertRenderableInputProbe(inputProbe, inputPath, {
    requireAppleDuration: !options.previewOnly
  });
  const colorConversion = inputProbe
    ? selectColorConversion(inputProbe)
    : { mode: "none" };
  const outputFps = inputProbe
    ? selectOutputFrameRate(inputProbe, options.fps)
    : selectOutputFrameRate(null, options.fps);
  const encoder = await resolveFileEncoder(options, ffmpegPath);
  const commandOutputPlan = buildCommandOutputPlan(outputPlan, renderPlan, options);

  if (!options.qcOnly && !options.previewOnly) {
    commands.push({
      target: "1x1",
      command: ffmpegPath,
      args: buildRenderArgs({
        input: inputPath,
        output: commandOutputPlan["1x1"],
        target: "1x1",
        fps: outputFps,
        bitrate: options.bitrate,
        mode: options.mode,
        encoder,
        colorConversion
      })
    });
    commands.push({
      target: "3x4",
      command: ffmpegPath,
      args: buildRenderArgs({
        input: inputPath,
        output: commandOutputPlan["3x4"],
        target: "3x4",
        fps: outputFps,
        bitrate: options.bitrate,
        mode: options.mode,
        encoder,
        colorConversion
      })
    });
  }

  if (!options.qcOnly) {
    commands.push({
      target: "preview",
      command: ffmpegPath,
      args: buildPreviewArgs({
        input: options.previewOnly ? inputPath : outputPlan.threeByFour,
        output: commandOutputPlan.preview,
        mode: options.mode,
        colorConversion: options.previewOnly ? colorConversion : { mode: "none" }
      })
    });
  }

  if (options.dryRun) {
    return { inputPath, outputPlan, commands };
  }

  await mkdir(options.outDir, { recursive: true });

  const committedOutputs = [];
  for (const command of commands) {
    if (options.previewOnly && command.target !== "preview") continue;
    const atomicOutput = renderPlan[command.target];
    const stage = command.target === "preview"
      ? { name: "preview", target: "preview" }
      : { name: "render", target: command.target };
    await withStage(options, stage, async () => {
      let result;
      try {
        result = await runProcess(command.command, command.args, {
          signal: options.signal,
          timeoutMs: options.renderTimeoutMs ?? DEFAULT_RENDER_TIMEOUT_MS
        });
      } catch (error) {
        await cleanupAtomicOutput(atomicOutput);
        await cleanupCommittedOutputs(committedOutputs);
        throw error;
      }
      if (result.code !== 0) {
        await cleanupAtomicOutput(atomicOutput);
        await cleanupCommittedOutputs(committedOutputs);
        throw new Error(`ffmpeg failed for ${command.target} ${inputPath}:\n${result.stderr}`);
      }
      try {
        throwIfAborted(options.signal);
        await commitAtomicOutput(atomicOutput, { overwrite: options.overwrite, label: "Output" });
        committedOutputs.push(atomicOutput);
      } catch (error) {
        await cleanupAtomicOutput(atomicOutput);
        await cleanupCommittedOutputs(committedOutputs);
        throw error;
      }
    });
  }

  if (options.previewOnly) {
    await finalizeCommittedOutputs(committedOutputs);
    return { inputPath, outputPlan, commands, report: null, colorConversion, outputFps };
  }

  let committedReports = [];
  try {
    const report = await buildQcReport({
      source: inputPath,
      outputPlan,
      qcOnly: options.qcOnly,
      ffprobePath,
      ffmpegPath,
      qcConcurrency: options.qcConcurrency,
      probeTimeoutMs: options.probeTimeoutMs,
      qcTimeoutMs: options.qcTimeoutMs,
      signal: options.signal,
      onStage: options.onStage
    });
    committedReports = await withStage(options, { name: "report", target: "reports" }, () => {
      return writeReports(report, outputPlan, {
        overwrite: options.overwrite,
        finalize: false,
        signal: options.signal,
        excludeJournals: committedOutputs.map((output) => output.journal).filter(Boolean)
      });
    });
    await finalizeCommittedOutputGroup([...committedOutputs, ...committedReports]);
    return { inputPath, outputPlan, commands, report, colorConversion, outputFps };
  } catch (error) {
    await cleanupCommittedReports(committedReports);
    await cleanupCommittedOutputs(committedOutputs);
    throw error;
  }
}

async function resolveFileEncoder(options, ffmpegPath) {
  if (options.qcOnly || options.previewOnly) return null;
  if (options.batchContext) {
    if ("resolvedEncoder" in options.batchContext) {
      return options.batchContext.resolvedEncoder;
    }
    if (!options.batchContext.encoderPromise) {
      options.batchContext.encoderPromise = resolveEncoderWithDiagnostic(options, ffmpegPath);
    }
    options.batchContext.resolvedEncoder = await options.batchContext.encoderPromise;
    return options.batchContext.resolvedEncoder;
  }

  return resolveEncoderWithDiagnostic(options, ffmpegPath);
}

async function resolveEncoderWithDiagnostic(options, ffmpegPath) {
  return withStage(options, { name: "encoder", target: "input" }, () => {
    return resolveEncoder(options.encoder, {
      ffmpegPath,
      dryRun: options.dryRun,
      signal: options.signal,
      encoderProbeTimeoutMs: options.encoderProbeTimeoutMs,
      encoderSmokeTimeoutMs: options.encoderSmokeTimeoutMs
    }).catch((error) => {
      if (isAbortError(error)) throw error;
      throw markEncoderResolutionError(error);
    });
  });
}

function markEncoderResolutionError(error) {
  if (error && typeof error === "object") {
    error.fadAppleMotionErrorKind = "encoder-resolution";
    return error;
  }
  const wrapped = new Error(String(error));
  wrapped.fadAppleMotionErrorKind = "encoder-resolution";
  return wrapped;
}

async function withStage(options, stage, action) {
  emitStage(options, { ...stage, state: "active" });
  try {
    const result = await action();
    emitStage(options, { ...stage, state: "done" });
    return result;
  } catch (error) {
    emitStage(options, { ...stage, state: isAbortError(error) ? "cancelled" : "failed" });
    throw error;
  }
}

function emitStage(options, stage) {
  if (typeof options.onStage !== "function") return;
  options.onStage({
    ...stage,
    at: new Date().toISOString()
  });
}

function throwIfAborted(signal) {
  if (signal?.aborted) {
    throw new ProcessAbortedError("Processing was cancelled before committing output.");
  }
}

function assertRenderableInputProbe(probe, inputPath, validationOptions = {}) {
  const validation = validateRenderableInputProbe(probe, validationOptions);
  if (validation.ok) return;
  const hasStreamAmbiguity = validation.errors.some((message) => {
    return message === "No video stream found." || message.startsWith("Exactly one video stream is required");
  });
  const label = hasStreamAmbiguity
    ? "Input is ambiguous and cannot be rendered safely"
    : "Input does not meet Apple Motion source requirements";
  const error = new Error(`${label}: ${inputPath}\n${validation.errors.join("\n")}`);
  error.fadAppleMotionErrorKind = hasStreamAmbiguity ? "ambiguous-input-stream" : "invalid-input-spec";
  error.fadAppleMotionInputSpecErrors = validation.errors;
  throw error;
}

function buildAtomicRenderPlan(outputPlan) {
  return {
    "1x1": buildAtomicOutput(outputPlan.oneByOne),
    "3x4": buildAtomicOutput(outputPlan.threeByFour),
    preview: buildAtomicOutput(outputPlan.preview)
  };
}

function buildCommandOutputPlan(outputPlan, renderPlan, options) {
  if (options.dryRun) {
    return {
      "1x1": outputPlan.oneByOne,
      "3x4": outputPlan.threeByFour,
      preview: outputPlan.preview
    };
  }

  return {
    "1x1": renderPlan["1x1"].temp,
    "3x4": renderPlan["3x4"].temp,
    preview: renderPlan.preview.temp
  };
}

async function buildQcReport({ source, outputPlan, qcOnly, ffprobePath, ffmpegPath, qcConcurrency, probeTimeoutMs, qcTimeoutMs, signal, onStage }) {
  const targets = qcOnly
    ? [{ target: "auto", path: source }]
    : [
        { target: "1x1", path: outputPlan.oneByOne },
        { target: "3x4", path: outputPlan.threeByFour }
      ];
  const items = [];

  for (const target of targets) {
    const stageTarget = target.target === "auto" ? "input" : target.target;
    const stageOptions = { onStage };
    const probe = await withStage(stageOptions, { name: "probe", target: stageTarget }, () => {
      return probeMedia(target.path, { ffprobePath, signal, timeoutMs: probeTimeoutMs });
    });
    const inferredTarget = target.target === "auto" ? inferTargetFromProbe(probe) : target.target;
    const errors = [];
    const warnings = [];
    let summary = {};

    if (!inferredTarget) {
      errors.push("Could not infer Apple target from dimensions.");
    } else {
      const validation = validateProbe(probe, inferredTarget);
      errors.push(...validation.errors);
      warnings.push(...validation.warnings);
      summary = validation.summary;
    }

    const qc = errors.length > 0
      ? emptyQcChecks()
      : await withStage(stageOptions, { name: "qc", target: stageTarget }, () => {
          return runQcChecks(target.path, { ffmpegPath, qcConcurrency, qcTimeoutMs, signal });
        });
    errors.push(...qc.errors);
    if (qc.blackSegments.length > 0) {
      warnings.push(`${qc.blackSegments.length} black segment(s) detected.`);
    }
    if (qc.blackFrames.length > 0) {
      warnings.push(`${qc.blackFrames.length} near-black frame(s) detected.`);
    }
    if (qc.frozenSegments.length > 0) {
      warnings.push(`${qc.frozenSegments.length} frozen segment(s) detected.`);
    }

    items.push({
      target: inferredTarget ?? target.target,
      path: target.path,
      errors,
      warnings,
      summary,
      qc
    });
  }

  return {
    ok: items.every((item) => item.errors.length === 0),
    source,
    generatedAt: new Date().toISOString(),
    items
  };
}

function emptyQcChecks() {
  return {
    blackSegments: [],
    blackFrames: [],
    frozenSegments: [],
    errors: [],
    rawExitCodes: {
      blackDetect: null,
      blackFrame: null,
      freezeDetect: null
    }
  };
}
