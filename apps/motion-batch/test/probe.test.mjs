import { access, chmod, mkdtemp, stat, truncate, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

import { looksLikeRemoteInput, probeMedia, runProcess } from "../src/probe.mjs";

test("probeMedia rejects zero-block local MOV files before spawning ffprobe", async (t) => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "apple-motion-probe-"));
  const input = path.join(tempDir, "offloaded.mov");
  const markerPath = path.join(tempDir, "ffprobe-started.txt");
  const scriptPath = path.join(tempDir, "ffprobe-marker.js");
  await writeFile(input, "");
  await truncate(input, 1024 * 1024);
  const inputInfo = await stat(input);
  if (inputInfo.blocks !== 0) {
    t.skip(`test filesystem allocated ${inputInfo.blocks} blocks for sparse fixture`);
    return;
  }
  await writeFile(scriptPath, `#!/usr/bin/env node
const fs = require("node:fs");
fs.writeFileSync(${JSON.stringify(markerPath)}, "spawned");
process.stdout.write(JSON.stringify({ streams: [], format: {} }));
`);
  await chmod(scriptPath, 0o755);

  await assert.rejects(() => probeMedia(input, { ffprobePath: scriptPath }), (error) => {
    assert.equal(error.fadAppleMotionErrorKind, "dataless-input-file");
    assert.match(error.message, /download|materialize/i);
    return true;
  });
  assert.equal(await fileExists(markerPath), false);
});

test("probeMedia treats Windows drive-letter paths as local inputs", () => {
  assert.equal(looksLikeRemoteInput("https://example.com/cover.mov"), true);
  assert.equal(looksLikeRemoteInput("s3://bucket/cover.mov"), true);
  assert.equal(looksLikeRemoteInput(`file:///${"Users"}/will/cover.mov`), false);
  assert.equal(looksLikeRemoteInput("C:\\Users\\Will\\cover.mov"), false);
  assert.equal(looksLikeRemoteInput("D:/covers/cover.mov"), false);
});

test("runProcess rejects and terminates a child after a wall-clock timeout", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "apple-motion-probe-"));
  const startedPath = path.join(tempDir, "started.txt");
  const terminatedPath = path.join(tempDir, "terminated.txt");
  const scriptPath = path.join(tempDir, "hanging-child.js");
  await writeFile(scriptPath, `#!/usr/bin/env node
const fs = require("node:fs");
fs.writeFileSync(${JSON.stringify(startedPath)}, String(process.pid));
process.stdout.write("stdout-head-" + "A".repeat(128) + "-stdout-tail");
process.stderr.write("stderr-head-" + "B".repeat(128) + "-stderr-tail");
process.on("SIGTERM", () => {
  fs.writeFileSync(${JSON.stringify(terminatedPath)}, "SIGTERM");
  process.exit(143);
});
setInterval(() => {}, 1000);
`);
  await chmod(scriptPath, 0o755);
  const controller = new AbortController();
  const timeoutMs = 2000;
  const guard = setTimeout(() => controller.abort(), timeoutMs + 1000);
  const assertion = assert.rejects(runProcess(scriptPath, [], {
    timeoutMs,
    killTimeoutMs: 50,
    maxOutputBytes: 32,
    signal: controller.signal
  }), (error) => {
    assert.equal(error.name, "TimeoutError");
    assert.equal(error.code, "PROCESS_TIMEOUT");
    assert.equal(error.timeoutMs, timeoutMs);
    assert.match(error.stdout, /output truncated/);
    assert.match(error.stderr, /output truncated/);
    assert.match(error.stdout, /stdout-tail$/);
    assert.match(error.stderr, /stderr-tail$/);
    return true;
  });

  try {
    await waitForFile(startedPath, 5000);
    await assertion;
  } finally {
    clearTimeout(guard);
  }
  assert.equal(await fileExists(terminatedPath), true);
});

test("runProcess reports timeout even when an external abort follows before child exit", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "apple-motion-probe-"));
  const terminatedPath = path.join(tempDir, "terminated.txt");
  const scriptPath = path.join(tempDir, "sigterm-ignoring-child.js");
  await writeFile(scriptPath, `#!/usr/bin/env node
const fs = require("node:fs");
process.on("SIGTERM", () => {
  fs.appendFileSync(${JSON.stringify(terminatedPath)}, "SIGTERM\\n");
});
setInterval(() => {}, 1000);
`);
  await chmod(scriptPath, 0o755);
  const controller = new AbortController();
  const timeoutMs = 3000;
  const abortTimer = setTimeout(() => controller.abort(), timeoutMs + 250);

  try {
    await assert.rejects(() => runProcess(scriptPath, [], {
      timeoutMs,
      killTimeoutMs: 500,
      signal: controller.signal
    }), (error) => {
      assert.equal(error.name, "TimeoutError");
      assert.equal(error.code, "PROCESS_TIMEOUT");
      assert.equal(error.timeoutMs, timeoutMs);
      return true;
    });
  } finally {
    clearTimeout(abortTimer);
  }
  assert.equal(await fileExists(terminatedPath), true);
});

test("runProcess reports abort when external abort fires before a later timeout", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "apple-motion-probe-"));
  const startedPath = path.join(tempDir, "started.txt");
  const terminatedPath = path.join(tempDir, "terminated.txt");
  const scriptPath = path.join(tempDir, "abort-first-child.js");
  await writeFile(scriptPath, `#!/usr/bin/env node
const fs = require("node:fs");
process.on("SIGTERM", () => {
  fs.appendFileSync(${JSON.stringify(terminatedPath)}, "SIGTERM\\n");
});
fs.writeFileSync(${JSON.stringify(startedPath)}, String(process.pid));
setInterval(() => {}, 1000);
`);
  await chmod(scriptPath, 0o755);
  const controller = new AbortController();
  const assertion = assert.rejects(() => runProcess(scriptPath, [], {
    timeoutMs: 10_000,
    killTimeoutMs: 100,
    signal: controller.signal
  }), (error) => {
    assert.equal(error.name, "AbortError");
    assert.equal(error.code, "ABORT_ERR");
    return true;
  });

  try {
    await waitForFile(startedPath, 5000);
    controller.abort();
    await assertion;
  } catch (error) {
    controller.abort();
    await assertion.catch(() => {});
    throw error;
  }
  assert.equal(await fileExists(terminatedPath), true);
});

test("runProcess abort terminates helper grandchildren in the same process group", async (t) => {
  if (process.platform === "win32") {
    t.skip("POSIX process-group signal semantics are covered on Unix-like hosts.");
    return;
  }
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "apple-motion-probe-"));
  const parentStartedPath = path.join(tempDir, "parent-started.txt");
  const grandchildStartedPath = path.join(tempDir, "grandchild-started.txt");
  const parentTerminatedPath = path.join(tempDir, "parent-terminated.txt");
  const grandchildTerminatedPath = path.join(tempDir, "grandchild-terminated.txt");
  const lateWritePath = path.join(tempDir, "grandchild-late-write.txt");
  const grandchildScriptPath = path.join(tempDir, "grandchild.js");
  const wrapperScriptPath = path.join(tempDir, "wrapper.js");
  await writeFile(grandchildScriptPath, `#!/usr/bin/env node
const fs = require("node:fs");
fs.writeFileSync(${JSON.stringify(grandchildStartedPath)}, String(process.pid));
process.on("SIGTERM", () => {
  fs.writeFileSync(${JSON.stringify(grandchildTerminatedPath)}, "SIGTERM");
  process.exit(143);
});
setTimeout(() => {
  fs.writeFileSync(${JSON.stringify(lateWritePath)}, "grandchild still running");
}, 700);
setInterval(() => {}, 1000);
`);
  await writeFile(wrapperScriptPath, `#!/usr/bin/env node
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const child = spawn(process.execPath, [${JSON.stringify(grandchildScriptPath)}], {
  stdio: "ignore"
});
fs.writeFileSync(${JSON.stringify(parentStartedPath)}, [process.pid, child.pid].join("\\n"));
process.on("SIGTERM", () => {
  fs.writeFileSync(${JSON.stringify(parentTerminatedPath)}, "SIGTERM");
  process.exit(143);
});
setInterval(() => {}, 1000);
`);
  await chmod(wrapperScriptPath, 0o755);
  const controller = new AbortController();
  const assertion = assert.rejects(() => runProcess(wrapperScriptPath, [], {
    timeoutMs: 10_000,
    // Leave enough room for both parent and grandchild SIGTERM handlers to flush
    // marker files before the SIGKILL fallback runs on loaded CI/dev hosts.
    killTimeoutMs: 1000,
    signal: controller.signal
  }), (error) => {
    assert.equal(error.name, "AbortError");
    assert.equal(error.code, "ABORT_ERR");
    return true;
  });

  try {
    await waitForFile(parentStartedPath, 5000);
    await waitForFile(grandchildStartedPath, 5000);
    controller.abort();
    await assertion;
    await waitForFile(parentTerminatedPath, 5000);
    await waitForFile(grandchildTerminatedPath, 5000);
    await new Promise((resolve) => setTimeout(resolve, 800));
    assert.equal(await fileExists(lateWritePath), false);
  } catch (error) {
    controller.abort();
    await cleanupWrapperGrandchild(parentStartedPath);
    await assertion.catch(() => {});
    throw error;
  }
});

test("probeMedia passes timeout options through to ffprobe", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "apple-motion-probe-"));
  const input = path.join(tempDir, "cover.mov");
  const scriptPath = path.join(tempDir, "hanging-ffprobe.js");
  await writeFile(input, "materialized media placeholder");
  await writeFile(scriptPath, `#!/usr/bin/env node
setInterval(() => {}, 1000);
`);
  await chmod(scriptPath, 0o755);
  const controller = new AbortController();
  const guard = setTimeout(() => controller.abort(), 500);

  try {
    await assert.rejects(() => probeMedia(input, {
      ffprobePath: scriptPath,
      timeoutMs: 50,
      signal: controller.signal
    }), (error) => {
      assert.equal(error.name, "TimeoutError");
      assert.equal(error.code, "PROCESS_TIMEOUT");
      assert.equal(error.timeoutMs, 50);
      return true;
    });
  } finally {
    clearTimeout(guard);
  }
});

test("runProcess bounds noisy child output while keeping the useful tail", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "apple-motion-probe-"));
  const scriptPath = path.join(tempDir, "noisy-child.js");
  await writeFile(scriptPath, `#!/usr/bin/env node
process.stdout.write("stdout-head-" + "A".repeat(80) + "-stdout-tail");
process.stderr.write("stderr-head-" + "B".repeat(80) + "-stderr-tail");
process.exit(7);
`);
  await chmod(scriptPath, 0o755);

  const result = await runProcess(scriptPath, [], { maxOutputBytes: 32 });

  assert.equal(result.code, 7);
  assert.equal(result.stdoutTruncated, true);
  assert.equal(result.stderrTruncated, true);
  assert.match(result.stdout, /output truncated/);
  assert.match(result.stderr, /output truncated/);
  assert.match(result.stdout, /stdout-tail$/);
  assert.match(result.stderr, /stderr-tail$/);
  assert.equal(result.stdout.includes("stdout-head"), false);
  assert.equal(result.stderr.includes("stderr-head"), false);
});

test("probeMedia reports input and ffprobe path when JSON parsing fails", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "apple-motion-probe-"));
  const scriptPath = path.join(tempDir, "bad-ffprobe.js");
  const input = path.join(tempDir, "cover.mov");
  await writeFile(input, "");
  await writeFile(scriptPath, `#!/usr/bin/env node
process.stdout.write("{not valid json");
process.exit(0);
`);
  await chmod(scriptPath, 0o755);

  await assert.rejects(() => probeMedia(input, { ffprobePath: scriptPath }), (error) => {
    assert.match(error.message, /Could not parse ffprobe JSON/);
    assert.match(error.message, new RegExp(escapeRegExp(input)));
    assert.match(error.message, new RegExp(escapeRegExp(scriptPath)));
    assert.match(error.message, /\{not valid json/);
    return true;
  });
});

test("runProcess rechecks abort after installing the child abort listener", async () => {
  const source = await import("node:fs/promises").then(({ readFile }) => {
    return readFile(path.resolve("src", "probe.mjs"), "utf8");
  });
  const listenerIndex = source.indexOf("signal?.addEventListener(\"abort\", onAbort, { once: true });");
  const recheckIndex = source.indexOf("if (signal?.aborted) onAbort();", listenerIndex);
  const childErrorIndex = source.indexOf("child.on(\"error\"", listenerIndex);

  assert.notEqual(listenerIndex, -1);
  assert.notEqual(recheckIndex, -1);
  assert.notEqual(childErrorIndex, -1);
  assert.ok(listenerIndex < recheckIndex);
  assert.ok(recheckIndex < childErrorIndex);
});

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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

async function waitForFile(filePath, timeoutMs = 1000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await fileExists(filePath)) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`Timed out waiting for ${filePath}`);
}

async function cleanupWrapperGrandchild(startedPath) {
  let pids = [];
  try {
    const { readFile } = await import("node:fs/promises");
    pids = (await readFile(startedPath, "utf8"))
      .split(/\s+/)
      .map((value) => Number(value))
      .filter((value) => Number.isInteger(value) && value > 0);
  } catch {
    return;
  }
  for (const pid of pids.reverse()) {
    try {
      process.kill(pid, "SIGKILL");
    } catch (error) {
      if (error.code !== "ESRCH") throw error;
    }
  }
}
