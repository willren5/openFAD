import { spawn } from "node:child_process";
import { stat } from "node:fs/promises";

export const DEFAULT_MAX_PROCESS_OUTPUT_BYTES = 8 * 1024 * 1024;
export const DEFAULT_PROBE_TIMEOUT_MS = 30_000;

export class ProcessAbortedError extends Error {
  constructor(message, { stdout = "", stderr = "" } = {}) {
    super(message);
    this.name = "AbortError";
    this.code = "ABORT_ERR";
    this.stdout = stdout;
    this.stderr = stderr;
  }
}

export function isAbortError(error) {
  return error?.name === "AbortError" || error?.code === "ABORT_ERR";
}

export class ProcessTimeoutError extends Error {
  constructor(message, { stdout = "", stderr = "", timeoutMs } = {}) {
    super(message);
    this.name = "TimeoutError";
    this.code = "PROCESS_TIMEOUT";
    this.stdout = stdout;
    this.stderr = stderr;
    this.timeoutMs = timeoutMs;
  }
}

export async function probeMedia(input, {
  ffprobePath = process.env.FFPROBE_PATH ?? "ffprobe",
  signal,
  timeoutMs = DEFAULT_PROBE_TIMEOUT_MS,
  killTimeoutMs,
  maxOutputBytes
} = {}) {
  await assertMaterializedLocalInput(input);
  const args = [
    "-hide_banner",
    "-show_streams",
    "-show_format",
    "-print_format",
    "json",
    input
  ];
  const result = await runProcess(ffprobePath, args, { signal, timeoutMs, killTimeoutMs, maxOutputBytes });
  if (result.code !== 0) {
    throw new Error(`ffprobe failed for ${input}:\n${result.stderr}`);
  }
  try {
    return JSON.parse(result.stdout);
  } catch (error) {
    const details = [
      `Could not parse ffprobe JSON for ${input} using ${ffprobePath}.`,
      `Parser error: ${error.message}.`,
      result.stdoutTruncated ? "stdout was truncated." : "",
      result.stderrTruncated ? "stderr was truncated." : "",
      result.stdout ? `ffprobe stdout:\n${truncateDiagnostic(result.stdout)}` : "",
      result.stderr ? `ffprobe stderr:\n${result.stderr}` : ""
    ].filter(Boolean).join("\n");
    throw new Error(details);
  }
}

function truncateDiagnostic(value, maxChars = 4000) {
  if (value.length <= maxChars) return value;
  return `${value.slice(0, maxChars)}\n[diagnostic truncated: ${value.length - maxChars} chars omitted]`;
}

export async function runProcess(command, args, {
  cwd,
  signal,
  timeoutMs = null,
  killTimeoutMs = 2000,
  maxOutputBytes = DEFAULT_MAX_PROCESS_OUTPUT_BYTES
} = {}) {
  const normalizedTimeoutMs = normalizeOptionalTimeoutMs(timeoutMs, "timeoutMs");
  const normalizedKillTimeoutMs = normalizeOptionalTimeoutMs(killTimeoutMs, "killTimeoutMs");
  if (signal?.aborted) {
    throw new ProcessAbortedError(`${command} was cancelled before it started.`);
  }

  return new Promise((resolve, reject) => {
    let settled = false;
    let abortRequested = false;
    let timeoutRequested = false;
    let terminationReason = null;
    let killTimer = null;
    let timeoutTimer = null;
	    const child = spawn(command, args, {
	      cwd,
	      shell: false,
	      detached: process.platform !== "win32",
	      windowsHide: true
	    });
    const stdoutBuffer = createBoundedOutputBuffer(maxOutputBytes);
    const stderrBuffer = createBoundedOutputBuffer(maxOutputBytes);
    child.stdout.on("data", (chunk) => {
      stdoutBuffer.append(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderrBuffer.append(chunk);
    });

    const cleanup = () => {
      if (killTimer) clearTimeout(killTimer);
      if (timeoutTimer) clearTimeout(timeoutTimer);
      signal?.removeEventListener("abort", onAbort);
    };
    const finish = (callback) => {
      if (settled) return;
      settled = true;
      cleanup();
      callback();
    };
	    const terminateChild = () => {
	      if (child.exitCode === null) {
	        terminateProcessTree(child, "SIGTERM");
	        if (!killTimer) {
	          killTimer = setTimeout(() => {
	            if (child.exitCode === null) terminateProcessTree(child, "SIGKILL");
	          }, normalizedKillTimeoutMs);
	        }
	      }
    };
    const onAbort = () => {
      if (!terminationReason) terminationReason = "abort";
      abortRequested = terminationReason === "abort";
      terminateChild();
    };
    const onTimeout = () => {
      if (!terminationReason) terminationReason = "timeout";
      timeoutRequested = terminationReason === "timeout";
      terminateChild();
    };

    signal?.addEventListener("abort", onAbort, { once: true });
    if (signal?.aborted) onAbort();
    if (normalizedTimeoutMs !== null) {
      timeoutTimer = setTimeout(onTimeout, normalizedTimeoutMs);
    }
    child.on("error", (error) => {
      finish(() => reject(error));
    });
    child.on("close", (code) => {
      const stdout = stdoutBuffer.toString();
      const stderr = stderrBuffer.toString();
      if (timeoutRequested) {
        finish(() => reject(new ProcessTimeoutError(`${command} timed out after ${normalizedTimeoutMs}ms.`, { stdout, stderr, timeoutMs: normalizedTimeoutMs })));
        return;
      }
      if (abortRequested || signal?.aborted) {
        finish(() => reject(new ProcessAbortedError(`${command} was cancelled.`, { stdout, stderr })));
        return;
      }
      finish(() => resolve({
        code,
        stdout,
        stderr,
        stdoutTruncated: stdoutBuffer.truncated,
        stderrTruncated: stderrBuffer.truncated
      }));
    });
	  });
	}

function terminateProcessTree(child, signalName) {
  if (!child.pid) return;
  if (process.platform === "win32") {
    terminateWindowsProcessTree(child, signalName);
    return;
  }

  try {
    process.kill(-child.pid, signalName);
  } catch (error) {
    if (error.code === "ESRCH") return;
    child.kill(signalName);
  }
}

function terminateWindowsProcessTree(child, signalName) {
  const args = ["/PID", String(child.pid), "/T"];
  if (signalName === "SIGKILL") args.push("/F");
  const killer = spawn("taskkill.exe", args, {
    windowsHide: true,
    stdio: "ignore"
  });
  killer.on("error", () => {
    child.kill(signalName);
  });
}

async function assertMaterializedLocalInput(input) {
  if (typeof input !== "string" || looksLikeRemoteInput(input)) return;
  let info;
  try {
    info = await stat(input);
  } catch {
    return;
  }
  if (!info.isFile()) return;
  if (info.size > 0 && Number.isFinite(info.blocks) && info.blocks === 0) {
    const error = new Error("Input video file appears to be dataless or not fully downloaded. Download or materialize it locally, then try again.");
    error.fadAppleMotionErrorKind = "dataless-input-file";
    error.inputPath = input;
    throw error;
  }
}

export function looksLikeRemoteInput(input) {
  return /^[a-z][a-z0-9+.-]*:/i.test(input)
    && !/^file:/i.test(input)
    && !/^[a-z]:[\\/]/i.test(input);
}

function createBoundedOutputBuffer(maxBytes) {
  const limit = normalizeMaxOutputBytes(maxBytes);
  let buffer = Buffer.alloc(0);
  let truncatedBytes = 0;

  return {
    get truncated() {
      return truncatedBytes > 0;
    },
    append(chunk) {
      if (limit === 0) {
        truncatedBytes += chunk.length;
        buffer = Buffer.alloc(0);
        return;
      }
      const next = Buffer.concat([buffer, chunk]);
      if (next.length <= limit) {
        buffer = next;
        return;
      }
      truncatedBytes += next.length - limit;
      buffer = next.subarray(next.length - limit);
    },
    toString() {
      const text = buffer.toString();
      if (truncatedBytes === 0) return text;
      return `[output truncated: ${truncatedBytes} bytes omitted, kept last ${limit} bytes]\n${text}`;
    }
  };
}

function normalizeMaxOutputBytes(value) {
  if (!Number.isInteger(value) || value < 0) {
    throw new TypeError("maxOutputBytes must be an integer greater than or equal to 0.");
  }
  return value;
}

function normalizeOptionalTimeoutMs(value, label) {
  if (value === null || value === undefined) return null;
  if (!Number.isInteger(value) || value < 0) {
    throw new TypeError(`${label} must be an integer greater than or equal to 0.`);
  }
  return value;
}
