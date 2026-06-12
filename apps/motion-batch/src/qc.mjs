import {
  buildQcBlackDetectArgs,
  buildQcBlackFrameArgs,
  buildQcFreezeDetectArgs
} from "./ffmpegArgs.mjs";
import { formatQcCommandFailure, formatQcCommandStartupFailure, formatQcCommandTimeout } from "./diagnostics.mjs";
import { isAbortError, runProcess } from "./probe.mjs";

export const DEFAULT_QC_TIMEOUT_MS = 10 * 60 * 1000;

export function parseBlackDetect(stderr) {
  const matches = [...stderr.matchAll(/black_start:(?<start>[\d.]+)\s+black_end:(?<end>[\d.]+)\s+black_duration:(?<duration>[\d.]+)/g)];
  return matches.map(({ groups }) => ({
    start: Number(groups.start),
    end: Number(groups.end),
    duration: Number(groups.duration)
  }));
}

export function parseBlackFrame(stderr) {
  const matches = [...stderr.matchAll(/frame:(?<frame>\d+)\s+pblack:(?<percentBlack>\d+).*?pts_time:(?<time>[\d.]+)/g)];
  return matches.map(({ groups }) => ({
    frame: Number(groups.frame),
    percentBlack: Number(groups.percentBlack),
    time: Number(groups.time)
  }));
}

export function parseFreezeDetect(stderr) {
  const events = [...stderr.matchAll(/freeze_(?<kind>start|duration|end):\s*(?<value>[\d.]+)/g)]
    .map(({ groups }) => ({ kind: groups.kind, value: Number(groups.value) }));
  const segments = [];
  let current = null;

  for (const event of events) {
    if (event.kind === "start") {
      current = { start: event.value, end: null, duration: null };
    } else if (event.kind === "duration" && current) {
      current.duration = event.value;
    } else if (event.kind === "end" && current) {
      current.end = event.value;
      if (current.duration === null) current.duration = current.end - current.start;
      segments.push(current);
      current = null;
    }
  }

  return segments;
}

export async function runQcChecks(input, {
  ffmpegPath = process.env.FFMPEG_PATH ?? "ffmpeg",
  signal,
  run = runProcess,
  qcConcurrency = 1,
  qcTimeoutMs = DEFAULT_QC_TIMEOUT_MS
} = {}) {
  const [blackDetect, blackFrame, freezeDetect] = await runWithConcurrency([
    () => runQcCommand("blackdetect", ffmpegPath, buildQcBlackDetectArgs(input), { signal, run, timeoutMs: qcTimeoutMs }),
    () => runQcCommand("blackframe", ffmpegPath, buildQcBlackFrameArgs(input), { signal, run, timeoutMs: qcTimeoutMs }),
    () => runQcCommand("freezedetect", ffmpegPath, buildQcFreezeDetectArgs(input), { signal, run, timeoutMs: qcTimeoutMs })
  ], normalizeQcConcurrency(qcConcurrency));

  return {
    blackSegments: parseBlackDetect(blackDetect.stderr),
    blackFrames: parseBlackFrame(blackFrame.stderr),
    frozenSegments: parseFreezeDetect(freezeDetect.stderr),
    errors: [
      ...blackDetect.errors,
      ...blackFrame.errors,
      ...freezeDetect.errors
    ],
    rawExitCodes: {
      blackDetect: blackDetect.code,
      blackFrame: blackFrame.code,
      freezeDetect: freezeDetect.code
    }
  };
}

async function runWithConcurrency(tasks, concurrency) {
  const results = new Array(tasks.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < tasks.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await tasks[index]();
    }
  }

  const workerCount = Math.min(concurrency, tasks.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return results;
}

function normalizeQcConcurrency(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 1;
  return Math.min(3, Math.max(1, Math.trunc(number)));
}

async function runQcCommand(name, ffmpegPath, args, { signal, run, timeoutMs }) {
  try {
    const result = await run(ffmpegPath, args, { signal, timeoutMs });
    return {
      code: result.code,
      stderr: result.stderr ?? "",
      errors: result.code === 0
        ? []
        : [formatQcCommandFailure(name, result.code)]
    };
  } catch (error) {
    if (isAbortError(error)) throw error;
    if (error?.code === "PROCESS_TIMEOUT") {
      return {
        code: null,
        stderr: "",
        errors: [formatQcCommandTimeout(name)]
      };
    }
    return {
      code: null,
      stderr: error.stderr ?? "",
      errors: [formatQcCommandStartupFailure(name)]
    };
  }
}
