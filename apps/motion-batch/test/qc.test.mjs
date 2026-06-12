import test from "node:test";
import assert from "node:assert/strict";
import { chmod, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  parseBlackDetect,
  parseBlackFrame,
  parseFreezeDetect,
  runQcChecks
} from "../src/qc.mjs";

const privateUserRoot = `/${"Users"}/will`;

test("parses blackdetect segments from ffmpeg stderr", () => {
  const stderr = "[blackdetect @ 0x123] black_start:0 black_end:0.2 black_duration:0.2\n";
  assert.deepEqual(parseBlackDetect(stderr), [
    { start: 0, end: 0.2, duration: 0.2 }
  ]);
});

test("parses blackframe warnings from ffmpeg stderr", () => {
  const stderr = "[Parsed_blackframe_0 @ 0x123] frame:12 pblack:99 pts:400 pts_time:0.4 type:P last_keyframe:0\n";
  assert.deepEqual(parseBlackFrame(stderr), [
    { frame: 12, percentBlack: 99, time: 0.4 }
  ]);
});

test("parses freezedetect segments from ffmpeg stderr", () => {
  const stderr = [
    "[freezedetect @ 0x123] freeze_start: 4.2",
    "[freezedetect @ 0x123] freeze_duration: 1.1",
    "[freezedetect @ 0x123] freeze_end: 5.3"
  ].join("\n");

  assert.deepEqual(parseFreezeDetect(stderr), [
    { start: 4.2, end: 5.3, duration: 1.1 }
  ]);
});

test("runQcChecks defaults to serial QC filter scheduling", async () => {
  const controlledRun = createControlledQcRun();
  const qcPromise = runQcChecks("input.mov", { run: controlledRun.run });
  let failure;

  try {
    await nextTurn();
    assert.deepEqual(controlledRun.started, ["blackdetect"]);

    controlledRun.releaseNext();
    await nextTurn();
    assert.deepEqual(controlledRun.started, ["blackdetect", "blackframe"]);

    controlledRun.releaseNext();
    await nextTurn();
    assert.deepEqual(controlledRun.started, ["blackdetect", "blackframe", "freezedetect"]);

    controlledRun.releaseNext();
    const qc = await qcPromise;
    assert.equal(controlledRun.maxActive, 1);
    assert.deepEqual(qc.errors, []);
    assert.deepEqual(qc.rawExitCodes, {
      blackDetect: 0,
      blackFrame: 0,
      freezeDetect: 0
    });
  } catch (error) {
    failure = error;
  } finally {
    controlledRun.releaseAll();
    await qcPromise.catch(() => {});
  }

  if (failure) throw failure;
});

test("runQcChecks allows an internal QC concurrency override", async () => {
  const controlledRun = createControlledQcRun();
  const qcPromise = runQcChecks("input.mov", {
    run: controlledRun.run,
    qcConcurrency: 3
  });

  await nextTurn();
  assert.deepEqual(controlledRun.started, ["blackdetect", "blackframe", "freezedetect"]);
  assert.equal(controlledRun.maxActive, 3);

  controlledRun.releaseAll();
  const qc = await qcPromise;
  assert.deepEqual(qc.errors, []);
});

test("runQcChecks passes a bounded timeout to every QC filter", async () => {
  const calls = [];

  const qc = await runQcChecks("input.mov", {
    qcTimeoutMs: 1234,
    qcConcurrency: 3,
    run: async (_command, args, options = {}) => {
      calls.push({ name: qcFilterName(args), timeoutMs: options.timeoutMs });
      return { code: 0, stderr: "" };
    }
  });

  assert.deepEqual(qc.errors, []);
  assert.deepEqual(calls.sort((a, b) => a.name.localeCompare(b.name)), [
    { name: "blackdetect", timeoutMs: 1234 },
    { name: "blackframe", timeoutMs: 1234 },
    { name: "freezedetect", timeoutMs: 1234 }
  ]);
});

test("records failed QC commands as reportable errors", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "apple-motion-qc-"));
  const ffmpegPath = path.join(tempDir, "ffmpeg");
  await writeFile(ffmpegPath, `#!/usr/bin/env node
const args = process.argv.slice(2).join(" ");
if (args.includes("blackdetect=")) {
  console.error("blackdetect decoder failure ${privateUserRoot}/.private-fixture/tool-bin");
  process.exit(13);
}
process.exit(0);
`);
  await chmod(ffmpegPath, 0o755);

  const qc = await runQcChecks("input.mov", { ffmpegPath });

  assert.equal(qc.rawExitCodes.blackDetect, 13);
  assert.match(qc.errors.join("\\n"), /blackdetect failed with exit code 13/);
  assert.doesNotMatch(qc.errors.join("\\n"), /\/Users|\.private-fixture|tool-bin|decoder failure/);
});

test("records QC command startup failures as reportable errors", async () => {
  const missingFfmpegPath = path.join(os.tmpdir(), `missing-ffmpeg-${Date.now()}`);

  const qc = await runQcChecks("input.mov", { ffmpegPath: missingFfmpegPath });

  assert.equal(qc.rawExitCodes.blackDetect, null);
  assert.match(qc.errors.join("\\n"), /blackdetect failed to run/);
  assert.doesNotMatch(qc.errors.join("\\n"), /ENOENT|spawn|missing-ffmpeg|\/var\/|\/tmp\//);
});

test("records QC command timeouts as timeout errors instead of startup failures", async () => {
  const qc = await runQcChecks("input.mov", {
    qcTimeoutMs: 75,
    run: async (_command, args) => {
      if (qcFilterName(args) === "blackdetect") {
        const error = new Error(`blackdetect timed out after 75ms for ${privateUserRoot}/.private-fixture/cover.mov`);
        error.code = "PROCESS_TIMEOUT";
        error.timeoutMs = 75;
        error.stderr = `raw stderr ${privateUserRoot}/.private-fixture`;
        throw error;
      }
      return { code: 0, stderr: "" };
    }
  });

  assert.equal(qc.rawExitCodes.blackDetect, null);
  assert.match(qc.errors.join("\\n"), /blackdetect timed out/);
  assert.doesNotMatch(qc.errors.join("\\n"), /failed to run|\/Users|\.private-fixture|raw stderr|75ms/);
});

function createControlledQcRun() {
  const pending = [];
  let active = 0;
  let maxActive = 0;
  const state = {
    started: [],
    get maxActive() {
      return maxActive;
    },
    async run(_command, args) {
      state.started.push(qcFilterName(args));
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => pending.push(resolve));
      active -= 1;
      return { code: 0, stderr: "" };
    },
    releaseNext() {
      const release = pending.shift();
      if (!release) throw new Error("No pending QC command to release.");
      release();
    },
    releaseAll() {
      while (pending.length) pending.shift()();
    }
  };
  return state;
}

function qcFilterName(args) {
  const joined = args.join(" ");
  if (joined.includes("blackdetect=")) return "blackdetect";
  if (joined.includes("blackframe=")) return "blackframe";
  if (joined.includes("freezedetect=")) return "freezedetect";
  return "unknown";
}

function nextTurn() {
  return new Promise((resolve) => setImmediate(resolve));
}
