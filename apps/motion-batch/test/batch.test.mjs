import { access, chmod, mkdir, mkdtemp, readdir, readFile, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import assert from "node:assert/strict";

import { collectExistingOutputFiles, collectInputFiles, runBatch } from "../src/batch.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function directoryIsCaseInsensitive(directory) {
  const markerName = `CaseProbe-${process.pid}-${Date.now()}.tmp`;
  await writeFile(path.join(directory, markerName), "case probe");
  try {
    await access(path.join(directory, markerName.toLowerCase()));
    return true;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}

test("preview-only dry run uses the source file as preview input", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "apple-motion-batch-"));
  const input = path.join(tempDir, "cover.mov");
  const outDir = path.join(tempDir, "out");
  await writeFile(input, "");

  const [result] = await runBatch({
    input,
    outDir,
    mode: "scale-fill",
    fps: "30",
    bitrate: "45M",
    container: "mp4",
    dryRun: true,
    overwrite: false,
    qcOnly: false,
    previewOnly: true
  });

  assert.equal(result.commands.length, 1);
  assert.equal(result.commands[0].target, "preview");
  assert.deepEqual(result.commands[0].args.slice(0, 3), ["-y", "-i", input]);
  assert.equal(result.commands[0].args.at(-1), result.outputPlan.preview);
});

test("preview-only dry run preserves the selected blur-extend preview mode", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "apple-motion-batch-"));
  const input = path.join(tempDir, "cover.mov");
  const outDir = path.join(tempDir, "out");
  await writeFile(input, "");

  const [result] = await runBatch({
    input,
    outDir,
    mode: "blur-extend",
    fps: "30",
    bitrate: "45M",
    container: "mp4",
    dryRun: true,
    overwrite: false,
    qcOnly: false,
    previewOnly: true
  });

  const previewArgs = result.commands.find((command) => command.target === "preview")?.args ?? [];
  const previewFilter = previewArgs[previewArgs.indexOf("-vf") + 1] ?? "";
  assert.doesNotMatch(previewFilter, /fps=30/);
  assert.doesNotMatch(previewFilter, /out_color_matrix=bt709/);
});

test("qc-only dry run does not plan a preview render", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "apple-motion-batch-"));
  const input = path.join(tempDir, "cover.mov");
  const outDir = path.join(tempDir, "out");
  await writeFile(input, "");

  const [result] = await runBatch({
    input,
    outDir,
    mode: "scale-fill",
    fps: "30",
    bitrate: "50M",
    container: "mp4",
    encoder: "x264",
    dryRun: true,
    overwrite: false,
    qcOnly: true,
    previewOnly: false
  });

  assert.equal(result.commands.some((command) => command.target === "preview"), false);
  assert.deepEqual(result.commands, []);
});

test("full dry run prints final deliverable paths instead of random temporary paths", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "apple-motion-batch-"));
  const input = path.join(tempDir, "cover.mov");
  const outDir = path.join(tempDir, "out");
  await writeFile(input, "");

  const [result] = await runBatch({
    input,
    outDir,
    mode: "scale-fill",
    fps: "30",
    bitrate: "45M",
    container: "mp4",
    dryRun: true,
    overwrite: false,
    qcOnly: false,
    previewOnly: false
  });

  const outputs = result.commands.map((command) => command.args.at(-1));
  assert.deepEqual(outputs, [
    result.outputPlan.oneByOne,
    result.outputPlan.threeByFour,
    result.outputPlan.preview
  ]);
});

test("dry run does not create missing output directories or require output write permission", { skip: process.platform === "win32" }, async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "apple-motion-batch-"));
  const input = path.join(tempDir, "cover.mov");
  const lockedParent = path.join(tempDir, "locked-parent");
  const outDir = path.join(lockedParent, "out");
  await writeFile(input, "");
  await mkdir(lockedParent);
  await chmod(lockedParent, 0o500);

  try {
    const [result] = await runBatch({
      input,
      outDir,
      mode: "scale-fill",
      fps: "30",
      bitrate: "45M",
      container: "mp4",
      encoder: "x264",
      dryRun: true,
      overwrite: false,
      qcOnly: false,
      previewOnly: false
    });

    assert.equal(result.commands.length, 3);
    assert.equal(result.outputPlan.preview.startsWith(outDir), true);
    await assert.rejects(() => access(outDir), (error) => error.code === "ENOENT");
  } finally {
    await chmod(lockedParent, 0o700).catch(() => {});
  }
});

test("batch rejects output path collisions before rendering", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "apple-motion-batch-"));
  const inputA = path.join(tempDir, "album-a", "cover.mov");
  const inputB = path.join(tempDir, "album-b", "cover.mov");
  const outDir = path.join(tempDir, "out");
  await mkdir(path.dirname(inputA), { recursive: true });
  await mkdir(path.dirname(inputB), { recursive: true });
  await writeFile(inputA, "");
  await writeFile(inputB, "");

  await assert.rejects(() => runBatch({
    input: tempDir,
    outDir,
    mode: "scale-fill",
    fps: "30",
    bitrate: "45M",
    container: "mp4",
    encoder: "x264",
    dryRun: true,
    overwrite: false,
    qcOnly: false,
    previewOnly: false
  }), /Output path collision/);
});

test("batch rejects case-only output path collisions on case-insensitive filesystems", async (t) => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "apple-motion-batch-"));
  const inputA = path.join(tempDir, "album-a", "Cover.mov");
  const inputB = path.join(tempDir, "album-b", "cover.mov");
  const outDir = path.join(tempDir, "out");
  await mkdir(path.dirname(inputA), { recursive: true });
  await mkdir(path.dirname(inputB), { recursive: true });
  await mkdir(outDir, { recursive: true });
  await writeFile(inputA, "");
  await writeFile(inputB, "");

  if (!await directoryIsCaseInsensitive(outDir)) {
    t.skip("output filesystem is case-sensitive");
    return;
  }

  await assert.rejects(() => runBatch({
    input: tempDir,
    outDir,
    mode: "scale-fill",
    fps: "30",
    bitrate: "45M",
    container: "mp4",
    encoder: "x264",
    dryRun: true,
    overwrite: false,
    qcOnly: false,
    previewOnly: false
  }), /Output path collision/);
});

test("batch rejects existing output files by default before rendering", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "apple-motion-batch-"));
  const input = path.join(tempDir, "cover.mov");
  const outDir = path.join(tempDir, "out");
  const existingPreview = path.join(outDir, "cover__apple-motion-3x4-preview.png");
  await mkdir(outDir, { recursive: true });
  await writeFile(input, "");
  await writeFile(existingPreview, "keep me");

  await assert.rejects(() => runBatch({
    input,
    outDir,
    mode: "scale-fill",
    fps: "30",
    bitrate: "45M",
    container: "mp4",
    encoder: "x264",
    dryRun: false,
    overwrite: false,
    qcOnly: false,
    previewOnly: true,
    ffmpegPath: "/does/not/matter"
  }), /Output already exists/);

  assert.equal(await readFile(existingPreview, "utf8"), "keep me");
});

test("folder input ignores the configured output directory when it is inside the input tree", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "apple-motion-batch-"));
  const input = path.join(tempDir, "cover.mov");
  const outDir = path.join(tempDir, "apple-motion-output");
  const previousOutput = path.join(outDir, "cover__apple-motion-1x1.mp4");
  await mkdir(outDir, { recursive: true });
  await writeFile(input, "");
  await writeFile(previousOutput, "old generated output");

  const results = await runBatch({
    input: tempDir,
    outDir,
    mode: "scale-fill",
    fps: "30",
    bitrate: "45M",
    container: "mp4",
    encoder: "x264",
    dryRun: true,
    overwrite: false,
    qcOnly: false,
    previewOnly: false
  });

  assert.deepEqual(results.map((result) => result.inputPath), [input]);
});

test("folder input ignores a canonical output directory selected through a symlink alias", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "apple-motion-batch-"));
  const inputDir = path.join(tempDir, "covers");
  const input = path.join(inputDir, "cover.mov");
  const actualOutDir = path.join(inputDir, "apple-motion-output");
  const outDirAlias = path.join(tempDir, "out-alias");
  const previousOutput = path.join(actualOutDir, "customer-export.mov");
  await mkdir(actualOutDir, { recursive: true });
  await writeFile(input, "");
  await writeFile(previousOutput, "old generated output");
  await symlink(actualOutDir, outDirAlias);

  const files = await collectInputFiles(inputDir, {
    excludeDirs: [outDirAlias],
    skipGeneratedOutputs: false
  });

  assert.deepEqual(files, [input]);
});

test("folder input ignores historical Apple Motion video outputs outside the configured output directory", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "apple-motion-batch-"));
  const input = path.join(tempDir, "cover.mov");
  const archiveDir = path.join(tempDir, "old-deliverables");
  const previousOneByOne = path.join(archiveDir, "cover__apple-motion-1x1.mp4");
  const previousThreeByFour = path.join(archiveDir, "cover__apple-motion-3x4.mov");
  const outDir = path.join(tempDir, "new-output");
  await mkdir(archiveDir, { recursive: true });
  await writeFile(input, "");
  await writeFile(previousOneByOne, "old generated 1x1");
  await writeFile(previousThreeByFour, "old generated 3x4");

  const results = await runBatch({
    input: tempDir,
    outDir,
    mode: "scale-fill",
    fps: "30",
    bitrate: "45M",
    container: "mp4",
    encoder: "x264",
    dryRun: true,
    overwrite: false,
    qcOnly: false,
    previewOnly: false
  });

  assert.deepEqual(results.map((result) => result.inputPath), [input]);
});

test("batch preflight scans stop when the abort signal is already cancelled", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "apple-motion-batch-"));
  const input = path.join(tempDir, "cover.mov");
  const outDir = path.join(tempDir, "out");
  await mkdir(outDir);
  await writeFile(input, "");

  const controller = new AbortController();
  controller.abort();

  await assert.rejects(() => collectInputFiles(tempDir, {
    excludeDirs: [outDir],
    signal: controller.signal
  }), { name: "AbortError" });
  await assert.rejects(() => collectExistingOutputFiles([input], {
    outDir,
    container: "mp4",
    dryRun: false,
    overwrite: true,
    qcOnly: false,
    previewOnly: true
  }, { signal: controller.signal }), { name: "AbortError" });
});

test("batch rejects using the same folder for input and output", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "apple-motion-batch-"));
  const input = path.join(tempDir, "cover.mov");
  await writeFile(input, "");

  await assert.rejects(() => runBatch({
    input: tempDir,
    outDir: tempDir,
    mode: "scale-fill",
    fps: "30",
    bitrate: "45M",
    container: "mp4",
    encoder: "x264",
    dryRun: true,
    overwrite: false,
    qcOnly: false,
    previewOnly: false
  }), /Output folder cannot be the same as the input folder/);
});

test("batch rejects output directory symlinks that resolve to the input folder", { skip: process.platform === "win32" }, async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "apple-motion-batch-"));
  const inputDir = path.join(tempDir, "covers");
  const outLink = path.join(tempDir, "out-link");
  await mkdir(inputDir);
  await writeFile(path.join(inputDir, "cover.mov"), "");
  await symlink(inputDir, outLink, "dir");

  await assert.rejects(() => runBatch({
    input: inputDir,
    outDir: outLink,
    mode: "scale-fill",
    fps: "30",
    bitrate: "45M",
    container: "mp4",
    encoder: "x264",
    dryRun: true,
    overwrite: false,
    qcOnly: false,
    previewOnly: false
  }), /Output folder cannot be the same as the input folder/);
});

test("batch recovers stale overwrite journals before checking output collisions", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "apple-motion-batch-"));
  const input = path.join(tempDir, "cover.mov");
  const outDir = path.join(tempDir, "out");
  const previewPath = path.join(outDir, "cover__apple-motion-3x4-preview.png");
  const staleTemp = path.join(outDir, ".cover__apple-motion-3x4-preview.png.test.tmp");
  const staleBackup = path.join(outDir, ".cover__apple-motion-3x4-preview.png.test.bak");
  const journal = path.join(outDir, ".openfad-motion-transaction.test.json");
  const fakeFfmpeg = await writeFakeOutputFfmpeg(tempDir);
  const fakeFfprobe = await writeFakeCompliantFfprobe(tempDir);
  await mkdir(outDir, { recursive: true });
  await writeFile(input, "");
  await writeFile(previewPath, "stale unfinalized preview");
  await writeFile(journal, JSON.stringify({
    version: 1,
    owner: "openfad-motion-batch",
    token: "test",
    updatedAt: "2000-01-01T00:00:00.000Z",
    final: previewPath,
    temp: staleTemp,
    backup: staleBackup,
    hadExistingFinal: false,
    phase: "ready-to-promote",
    finalized: false
  }));

  const [result] = await runBatch({
    input,
    outDir,
    mode: "scale-fill",
    fps: "30",
    bitrate: "45M",
    container: "mp4",
    encoder: "x264",
    dryRun: false,
    overwrite: false,
    qcOnly: false,
    previewOnly: true,
    ffmpegPath: fakeFfmpeg,
    ffprobePath: fakeFfprobe
  });

  assert.equal(result.outputPlan.preview, previewPath);
  assert.equal(await readFile(previewPath, "utf8"), "fake media");
  assert.equal(await fileExists(journal), false);
});

test("batch recovery does not recover a fresh managed journal for a planned output", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "apple-motion-batch-"));
  const input = path.join(tempDir, "cover.mov");
  const outDir = path.join(tempDir, "out");
  const previewPath = path.join(outDir, "cover__apple-motion-3x4-preview.png");
  const activeTemp = path.join(outDir, ".cover__apple-motion-3x4-preview.png.active.tmp");
  const activeBackup = path.join(outDir, ".cover__apple-motion-3x4-preview.png.active.bak");
  const journal = path.join(outDir, ".openfad-motion-transaction.active.json");
  const fakeFfmpeg = await writeFakeOutputFfmpeg(tempDir);
  const fakeFfprobe = await writeFakeCompliantFfprobe(tempDir);
  await mkdir(outDir, { recursive: true });
  await writeFile(input, "");
  await writeFile(previewPath, "active or user-created output");
  await writeFile(activeTemp, "active temp");
  await writeFile(activeBackup, "old output");
  await writeFile(journal, JSON.stringify({
    version: 1,
    owner: "openfad-motion-batch",
    token: "active",
    updatedAt: new Date().toISOString(),
    final: previewPath,
    temp: activeTemp,
    backup: activeBackup,
    hadExistingFinal: true,
    phase: "final-replaced",
    finalized: false
  }));

  await assert.rejects(() => runBatch({
    input,
    outDir,
    mode: "scale-fill",
    fps: "30",
    bitrate: "45M",
    container: "mp4",
    encoder: "x264",
    dryRun: false,
    overwrite: false,
    qcOnly: false,
    previewOnly: true,
    ffmpegPath: fakeFfmpeg,
    ffprobePath: fakeFfprobe
  }), /Output already exists/);

  assert.equal(await readFile(previewPath, "utf8"), "active or user-created output");
  assert.equal(await readFile(activeTemp, "utf8"), "active temp");
  assert.equal(await readFile(activeBackup, "utf8"), "old output");
  assert.equal(await fileExists(journal), true);
});

test("batch recovery does not trust an unmanaged journal for a planned output", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "apple-motion-batch-"));
  const input = path.join(tempDir, "cover.mov");
  const outDir = path.join(tempDir, "out");
  const previewPath = path.join(outDir, "cover__apple-motion-3x4-preview.png");
  const staleTemp = path.join(outDir, ".cover__apple-motion-3x4-preview.png.attacker.tmp");
  const staleBackup = path.join(outDir, ".cover__apple-motion-3x4-preview.png.attacker.bak");
  const journal = path.join(outDir, ".openfad-motion-transaction.attacker.json");
  const fakeFfmpeg = await writeFakeOutputFfmpeg(tempDir);
  const fakeFfprobe = await writeFakeCompliantFfprobe(tempDir);
  await mkdir(outDir, { recursive: true });
  await writeFile(input, "");
  await writeFile(previewPath, "planned output");
  await writeFile(staleBackup, "attacker backup");
  await writeFile(journal, JSON.stringify({
    version: 1,
    final: previewPath,
    temp: staleTemp,
    backup: staleBackup,
    hadExistingFinal: true,
    phase: "final-replaced",
    finalized: false
  }));

  await assert.rejects(() => runBatch({
    input,
    outDir,
    mode: "scale-fill",
    fps: "30",
    bitrate: "45M",
    container: "mp4",
    encoder: "x264",
    dryRun: false,
    overwrite: false,
    qcOnly: false,
    previewOnly: true,
    ffmpegPath: fakeFfmpeg,
    ffprobePath: fakeFfprobe
  }), /Output already exists/);

  assert.equal(await readFile(previewPath, "utf8"), "planned output");
  assert.equal(await readFile(staleBackup, "utf8"), "attacker backup");
  assert.equal(await fileExists(journal), true);
});

test("batch recovery ignores transaction journals for files outside the planned outputs", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "apple-motion-batch-"));
  const input = path.join(tempDir, "cover.mov");
  const outDir = path.join(tempDir, "out");
  const unrelatedFile = path.join(outDir, "unrelated-customer-file.mov");
  const craftedJournal = path.join(outDir, ".openfad-motion-transaction.unrelated.json");
  const fakeFfmpeg = await writeFakeOutputFfmpeg(tempDir);
  const fakeFfprobe = await writeFakeCompliantFfprobe(tempDir);
  await mkdir(outDir, { recursive: true });
  await writeFile(input, "");
  await writeFile(unrelatedFile, "do not touch");
  await writeFile(craftedJournal, JSON.stringify({
    version: 1,
    final: unrelatedFile,
    temp: path.join(outDir, ".unrelated-customer-file.mov.test.tmp"),
    backup: path.join(outDir, ".unrelated-customer-file.mov.test.bak"),
    hadExistingFinal: false,
    phase: "final-replaced",
    finalized: false
  }));

  await runBatch({
    input,
    outDir,
    mode: "scale-fill",
    fps: "30",
    bitrate: "45M",
    container: "mp4",
    encoder: "x264",
    dryRun: false,
    overwrite: false,
    qcOnly: false,
    previewOnly: true,
    ffmpegPath: fakeFfmpeg,
    ffprobePath: fakeFfprobe
  });

  assert.equal(await readFile(unrelatedFile, "utf8"), "do not touch");
  assert.equal(await fileExists(craftedJournal), true);
});

test("multi-file batch resolves and smoke-tests the encoder only once", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "apple-motion-batch-"));
  const inputDir = path.join(tempDir, "covers");
  const inputA = path.join(inputDir, "cover-a.mov");
  const inputB = path.join(inputDir, "cover-b.mov");
  const outDir = path.join(tempDir, "out");
  const countPath = path.join(tempDir, "ffmpeg-counts.txt");
  const fakeFfmpeg = await writeCountingFfmpeg(tempDir, countPath);
  const fakeFfprobe = await writeFakeCompliantFfprobe(tempDir);
  await mkdir(inputDir);
  await writeFile(inputA, "");
  await writeFile(inputB, "");

  await runBatch({
    input: inputDir,
    outDir,
    mode: "scale-fill",
    fps: "30",
    bitrate: "50M",
    container: "mp4",
    encoder: "x264",
    dryRun: false,
    overwrite: false,
    qcOnly: false,
    previewOnly: false,
    ffmpegPath: fakeFfmpeg,
    ffprobePath: fakeFfprobe
  });

  assert.equal(await countMarker(countPath, "encoders"), 1);
  assert.equal(await countMarker(countPath, "smoke"), 1);
});

test("multi-file batch records a bad source and continues with later files", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "apple-motion-batch-"));
  const inputDir = path.join(tempDir, "covers");
  const badInput = path.join(inputDir, "bad.mov");
  const goodInput = path.join(inputDir, "good.mov");
  const outDir = path.join(tempDir, "out");
  const countPath = path.join(tempDir, "ffmpeg-counts.txt");
  const fakeFfmpeg = await writeCountingFfmpeg(tempDir, countPath);
  const fakeFfprobe = await writeFakeMixedDurationFfprobe(tempDir);
  await mkdir(inputDir);
  await writeFile(badInput, "");
  await writeFile(goodInput, "");

  const results = await runBatch({
    input: inputDir,
    outDir,
    mode: "scale-fill",
    fps: "30",
    bitrate: "50M",
    container: "mp4",
    encoder: "x264",
    dryRun: false,
    overwrite: false,
    qcOnly: false,
    previewOnly: false,
    ffmpegPath: fakeFfmpeg,
    ffprobePath: fakeFfprobe
  });

  assert.deepEqual(results.map((result) => path.basename(result.inputPath)), ["bad.mov", "good.mov"]);
  assertFailedResult(results[0], /Duration must be between 8 and 35 seconds/);
  assert.equal(results[1].error, undefined);
  assert.equal(results[1].report.ok, true);
  assert.equal(await countMarker(countPath, "encoders"), 1);
  assert.equal(await countMarker(countPath, "smoke"), 1);
  assert.equal(await fileExists(path.join(outDir, "bad__apple-motion-1x1.mp4")), false);
  assert.equal(await fileExists(path.join(outDir, "good__apple-motion-1x1.mp4")), true);
});

test("multi-file batch records a render failure and continues with later files", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "apple-motion-batch-"));
  const inputDir = path.join(tempDir, "covers");
  const badInput = path.join(inputDir, "bad.mov");
  const goodInput = path.join(inputDir, "good.mov");
  const outDir = path.join(tempDir, "out");
  const fakeFfmpeg = await writeFakeFfmpegThatFailsBadThreeByFour(tempDir);
  const fakeFfprobe = await writeFakeCompliantFfprobe(tempDir);
  await mkdir(inputDir);
  await writeFile(badInput, "");
  await writeFile(goodInput, "");

  const results = await runBatch({
    input: inputDir,
    outDir,
    mode: "scale-fill",
    fps: "30",
    bitrate: "50M",
    container: "mp4",
    encoder: "x264",
    dryRun: false,
    overwrite: false,
    qcOnly: false,
    previewOnly: false,
    ffmpegPath: fakeFfmpeg,
    ffprobePath: fakeFfprobe
  });

  assert.deepEqual(results.map((result) => path.basename(result.inputPath)), ["bad.mov", "good.mov"]);
  assertFailedResult(results[0], /ffmpeg failed for 3x4/);
  assert.equal(results[1].error, undefined);
  assert.equal(results[1].report.ok, true);
  assert.equal(await fileExists(path.join(outDir, "bad__apple-motion-1x1.mp4")), false);
  assert.equal(await fileExists(path.join(outDir, "bad__apple-motion-3x4.mp4")), false);
  assert.equal(await fileExists(path.join(outDir, "good__apple-motion-3x4.mp4")), true);
});

test("multi-file batch records a report write failure and continues with later files", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "apple-motion-batch-"));
  const inputDir = path.join(tempDir, "covers");
  const badInput = path.join(inputDir, "bad.mov");
  const goodInput = path.join(inputDir, "good.mov");
  const outDir = path.join(tempDir, "out");
  const badReportJson = path.join(outDir, "bad__apple-motion-qc.json");
  const fakeFfmpeg = await writeFakeRenderingFfmpeg(tempDir);
  const fakeFfprobe = await writeFakeCompliantFfprobe(tempDir);
  await mkdir(inputDir);
  await mkdir(badReportJson, { recursive: true });
  await writeFile(badInput, "");
  await writeFile(goodInput, "");

  const results = await runBatch({
    input: inputDir,
    outDir,
    mode: "scale-fill",
    fps: "30",
    bitrate: "50M",
    container: "mp4",
    encoder: "x264",
    dryRun: false,
    overwrite: true,
    qcOnly: false,
    previewOnly: false,
    ffmpegPath: fakeFfmpeg,
    ffprobePath: fakeFfprobe
  });

  assert.deepEqual(results.map((result) => path.basename(result.inputPath)), ["bad.mov", "good.mov"]);
  assertFailedResult(results[0]);
  assert.equal(results[1].error, undefined);
  assert.equal(results[1].report.ok, true);
  assert.equal(await fileExists(path.join(outDir, "bad__apple-motion-1x1.mp4")), false);
  assert.equal(await fileExists(path.join(outDir, "bad__apple-motion-3x4.mp4")), false);
  assert.equal(await fileExists(path.join(outDir, "good__apple-motion-qc.html")), true);
});

test("multi-file batch keeps shared encoder failure as a hard stop", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "apple-motion-batch-"));
  const inputDir = path.join(tempDir, "covers");
  const inputA = path.join(inputDir, "cover-a.mov");
  const inputB = path.join(inputDir, "cover-b.mov");
  const outDir = path.join(tempDir, "out");
  const fakeFfmpeg = await writeFfmpegWithoutH264Encoders(tempDir);
  const fakeFfprobe = await writeFakeCompliantFfprobe(tempDir);
  await mkdir(inputDir);
  await writeFile(inputA, "");
  await writeFile(inputB, "");

  await assert.rejects(() => runBatch({
    input: inputDir,
    outDir,
    mode: "scale-fill",
    fps: "30",
    bitrate: "50M",
    container: "mp4",
    encoder: "x264",
    dryRun: false,
    overwrite: false,
    qcOnly: false,
    previewOnly: false,
    ffmpegPath: fakeFfmpeg,
    ffprobePath: fakeFfprobe
  }), /libx264 is not available|No supported H\.264 encoder/);

  assert.equal(await fileExists(path.join(outDir, "cover-a__apple-motion-1x1.mp4")), false);
  assert.equal(await fileExists(path.join(outDir, "cover-b__apple-motion-1x1.mp4")), false);
});

test("multi-file batch keeps missing shared FFmpeg encoder probe as a hard stop", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "apple-motion-batch-"));
  const inputDir = path.join(tempDir, "covers");
  const inputA = path.join(inputDir, "cover-a.mov");
  const inputB = path.join(inputDir, "cover-b.mov");
  const outDir = path.join(tempDir, "out");
  const fakeFfprobe = await writeFakeCompliantFfprobe(tempDir);
  await mkdir(inputDir);
  await writeFile(inputA, "");
  await writeFile(inputB, "");

  await assert.rejects(() => runBatch({
    input: inputDir,
    outDir,
    mode: "scale-fill",
    fps: "30",
    bitrate: "50M",
    container: "mp4",
    encoder: "x264",
    dryRun: false,
    overwrite: false,
    qcOnly: false,
    previewOnly: false,
    ffmpegPath: path.join(tempDir, "missing-ffmpeg"),
    ffprobePath: fakeFfprobe
  }), (error) => {
    assert.equal(error.fadAppleMotionErrorKind, "encoder-resolution");
    assert.equal(error.code, "ENOENT");
    return true;
  });

  assert.equal(await fileExists(path.join(outDir, "cover-a__apple-motion-1x1.mp4")), false);
  assert.equal(await fileExists(path.join(outDir, "cover-b__apple-motion-1x1.mp4")), false);
});

test("multi-file batch keeps timed-out shared encoder probe as a hard stop", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "apple-motion-batch-"));
  const inputDir = path.join(tempDir, "covers");
  const inputA = path.join(inputDir, "cover-a.mov");
  const inputB = path.join(inputDir, "cover-b.mov");
  const outDir = path.join(tempDir, "out");
  const terminatedPath = path.join(tempDir, "encoder-probe-terminated.txt");
  const fakeFfmpeg = await writeHangingFfmpeg(tempDir, terminatedPath);
  const fakeFfprobe = await writeFakeCompliantFfprobe(tempDir);
  await mkdir(inputDir);
  await writeFile(inputA, "");
  await writeFile(inputB, "");
  const encoderProbeTimeoutMs = 2000;

  await assert.rejects(() => runBatch({
    input: inputDir,
    outDir,
    mode: "scale-fill",
    fps: "30",
    bitrate: "50M",
    container: "mp4",
    encoder: "x264",
    dryRun: false,
    overwrite: false,
    qcOnly: false,
    previewOnly: false,
    ffmpegPath: fakeFfmpeg,
    ffprobePath: fakeFfprobe,
    encoderProbeTimeoutMs
  }), (error) => {
    assert.equal(error.fadAppleMotionErrorKind, "encoder-resolution");
    assert.equal(error.code, "PROCESS_TIMEOUT");
    assert.equal(error.timeoutMs, encoderProbeTimeoutMs);
    return true;
  });

  await waitForFile(terminatedPath);
  assert.equal(await fileExists(path.join(outDir, "cover-a__apple-motion-1x1.mp4")), false);
  assert.equal(await fileExists(path.join(outDir, "cover-b__apple-motion-1x1.mp4")), false);
});

test("full render records impossible source duration before encoder probe or render", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "apple-motion-batch-"));
  const input = path.join(tempDir, "cover.mov");
  const outDir = path.join(tempDir, "out");
  const countPath = path.join(tempDir, "ffmpeg-counts.txt");
  const fakeFfmpeg = await writeCountingFfmpeg(tempDir, countPath);
  const fakeFfprobe = await writeFakeLongDurationFfprobe(tempDir);
  await writeFile(input, "");

  const [result] = await runBatch({
    input,
    outDir,
    mode: "scale-fill",
    fps: "30",
    bitrate: "50M",
    container: "mp4",
    encoder: "x264",
    dryRun: false,
    overwrite: false,
    qcOnly: false,
    previewOnly: false,
    ffmpegPath: fakeFfmpeg,
    ffprobePath: fakeFfprobe
  });
  assertFailedResult(result, (error) => {
    assert.equal(error.fadAppleMotionErrorKind, "invalid-input-spec");
    assert.match(error.message, /Duration must be between 8 and 35 seconds/);
  });

  assert.equal(await countMarker(countPath, "encoders"), 0);
  assert.equal(await countMarker(countPath, "smoke"), 0);
  assert.equal(await countMarker(countPath, "render"), 0);
  assert.equal(await countMarker(countPath, "qc"), 0);
  assert.equal(await fileExists(path.join(outDir, "cover__apple-motion-1x1.mp4")), false);
  assert.equal(await fileExists(path.join(outDir, "cover__apple-motion-3x4.mp4")), false);
  assert.equal(await fileExists(path.join(outDir, "cover__apple-motion-3x4-preview.png")), false);
});

test("full render records unsupported source color before encoder probe or render", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "apple-motion-batch-"));
  const input = path.join(tempDir, "cover.mov");
  const outDir = path.join(tempDir, "out");
  const countPath = path.join(tempDir, "ffmpeg-counts.txt");
  const fakeFfmpeg = await writeCountingFfmpeg(tempDir, countPath);
  const fakeFfprobe = await writeFakeUnsupportedColorFfprobe(tempDir);
  await writeFile(input, "");

  const [result] = await runBatch({
    input,
    outDir,
    mode: "scale-fill",
    fps: "30",
    bitrate: "50M",
    container: "mp4",
    encoder: "x264",
    dryRun: false,
    overwrite: false,
    qcOnly: false,
    previewOnly: false,
    ffmpegPath: fakeFfmpeg,
    ffprobePath: fakeFfprobe
  });
  assertFailedResult(result, (error) => {
    assert.equal(error.fadAppleMotionErrorKind, "invalid-input-spec");
    assert.match(error.message, /Color profile must be Rec\. 709\/sRGB or HDR/);
  });

  assert.equal(await countMarker(countPath, "encoders"), 0);
  assert.equal(await countMarker(countPath, "smoke"), 0);
  assert.equal(await countMarker(countPath, "render"), 0);
  assert.equal(await countMarker(countPath, "qc"), 0);
});

test("preview render writes a temporary output before atomically replacing the final file", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "apple-motion-batch-"));
  const input = path.join(tempDir, "cover.mov");
  const outDir = path.join(tempDir, "out");
  const fakeFfmpeg = await writeFakeOutputFfmpeg(tempDir);
  const fakeFfprobe = await writeFakeCompliantFfprobe(tempDir);
  await writeFile(input, "");

  const [result] = await runBatch({
    input,
    outDir,
    mode: "scale-fill",
    fps: "30",
    bitrate: "45M",
    container: "mp4",
    encoder: "x264",
    dryRun: false,
    overwrite: false,
    qcOnly: false,
    previewOnly: true,
    ffmpegPath: fakeFfmpeg,
    ffprobePath: fakeFfprobe
  });

  const previewPath = result.outputPlan.preview;
  const commandOutput = result.commands[0].args.at(-1);
  assert.notEqual(commandOutput, previewPath);
  assert.match(path.basename(commandOutput), /^\.cover__apple-motion-3x4-preview\..+\.tmp\.png$/);
  assert.equal(path.extname(commandOutput), ".png");
  assert.equal(await readFile(previewPath, "utf8"), "fake media");
  assert.equal(await fileExists(commandOutput), false);
});

test("full render records failure and cleans up already committed outputs when a later target fails", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "apple-motion-batch-"));
  const input = path.join(tempDir, "cover.mov");
  const outDir = path.join(tempDir, "out");
  const fakeFfmpeg = await writeFakeFfmpegThatFailsThreeByFour(tempDir);
  const fakeFfprobe = await writeFakeCompliantFfprobe(tempDir);
  await writeFile(input, "");

  const [result] = await runBatch({
    input,
    outDir,
    mode: "scale-fill",
    fps: "30",
    bitrate: "50M",
    container: "mp4",
    encoder: "x264",
    dryRun: false,
    overwrite: false,
    qcOnly: false,
    previewOnly: false,
    ffmpegPath: fakeFfmpeg,
    ffprobePath: fakeFfprobe
  });
  assertFailedResult(result, /ffmpeg failed for 3x4/);

  assert.equal(await fileExists(path.join(outDir, "cover__apple-motion-1x1.mp4")), false);
  assert.equal(await fileExists(path.join(outDir, "cover__apple-motion-3x4.mp4")), false);
  assert.equal(await fileExists(path.join(outDir, "cover__apple-motion-3x4-preview.png")), false);
});

test("overwrite records failure and restores existing outputs when a later target fails", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "apple-motion-batch-"));
  const input = path.join(tempDir, "cover.mov");
  const outDir = path.join(tempDir, "out");
  const fakeFfmpeg = await writeFakeFfmpegThatFailsThreeByFour(tempDir);
  const fakeFfprobe = await writeFakeCompliantFfprobe(tempDir);
  const oldOutputs = {
    oneByOne: path.join(outDir, "cover__apple-motion-1x1.mp4"),
    threeByFour: path.join(outDir, "cover__apple-motion-3x4.mp4"),
    preview: path.join(outDir, "cover__apple-motion-3x4-preview.png"),
    reportJson: path.join(outDir, "cover__apple-motion-qc.json"),
    reportHtml: path.join(outDir, "cover__apple-motion-qc.html")
  };
  await mkdir(outDir, { recursive: true });
  await writeFile(input, "");
  for (const [name, filePath] of Object.entries(oldOutputs)) {
    await writeFile(filePath, `old ${name}`);
  }

  const [result] = await runBatch({
    input,
    outDir,
    mode: "scale-fill",
    fps: "30",
    bitrate: "50M",
    container: "mp4",
    encoder: "x264",
    dryRun: false,
    overwrite: true,
    qcOnly: false,
    previewOnly: false,
    ffmpegPath: fakeFfmpeg,
    ffprobePath: fakeFfprobe
  });
  assertFailedResult(result, /ffmpeg failed for 3x4/);

  for (const [name, filePath] of Object.entries(oldOutputs)) {
    assert.equal(await readFile(filePath, "utf8"), `old ${name}`);
  }
});

test("render finalization removes overwrite rollback journals after success", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "apple-motion-batch-"));
  const input = path.join(tempDir, "cover.mov");
  const outDir = path.join(tempDir, "out");
  const fakeFfmpeg = await writeFakeRenderingFfmpeg(tempDir);
  const fakeFfprobe = await writeFakeCompliantFfprobe(tempDir);
  const oldOutputs = [
    path.join(outDir, "cover__apple-motion-1x1.mp4"),
    path.join(outDir, "cover__apple-motion-3x4.mp4"),
    path.join(outDir, "cover__apple-motion-3x4-preview.png"),
    path.join(outDir, "cover__apple-motion-qc.json"),
    path.join(outDir, "cover__apple-motion-qc.html")
  ];
  await mkdir(outDir, { recursive: true });
  await writeFile(input, "");
  for (const filePath of oldOutputs) {
    await writeFile(filePath, "old output");
  }

  await runBatch({
    input,
    outDir,
    mode: "scale-fill",
    fps: "30",
    bitrate: "50M",
    container: "mp4",
    encoder: "x264",
    dryRun: false,
    overwrite: true,
    qcOnly: false,
    previewOnly: false,
    ffmpegPath: fakeFfmpeg,
    ffprobePath: fakeFfprobe
  });

  const leftovers = (await readdir(outDir)).filter((name) => {
    return isAtomicLeftoverName(name);
  });
  assert.deepEqual(leftovers, []);
  assert.equal(await readFile(path.join(outDir, "cover__apple-motion-1x1.mp4"), "utf8"), "fake media");
});

test("full render records failure and cleans up committed outputs when report writing fails", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "apple-motion-batch-"));
  const input = path.join(tempDir, "cover.mov");
  const outDir = path.join(tempDir, "out");
  const fakeFfmpeg = await writeFakeRenderingFfmpeg(tempDir);
  const fakeFfprobe = await writeFakeCompliantFfprobe(tempDir);
  const reportJsonPath = path.join(outDir, "cover__apple-motion-qc.json");
  await writeFile(input, "");
  await mkdir(reportJsonPath, { recursive: true });

  const [result] = await runBatch({
    input,
    outDir,
    mode: "scale-fill",
    fps: "30",
    bitrate: "50M",
    container: "mp4",
    encoder: "x264",
    dryRun: false,
    overwrite: true,
    qcOnly: false,
    previewOnly: false,
    ffmpegPath: fakeFfmpeg,
    ffprobePath: fakeFfprobe
  });
  assertFailedResult(result);

  assert.equal(await fileExists(path.join(outDir, "cover__apple-motion-1x1.mp4")), false);
  assert.equal(await fileExists(path.join(outDir, "cover__apple-motion-3x4.mp4")), false);
  assert.equal(await fileExists(path.join(outDir, "cover__apple-motion-3x4-preview.png")), false);
});

test("full render finalizes render and report overwrite journals together after success", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "apple-motion-batch-"));
  const input = path.join(tempDir, "cover.mov");
  const outDir = path.join(tempDir, "out");
  const fakeFfmpeg = await writeFakeRenderingFfmpeg(tempDir);
  const fakeFfprobe = await writeFakeCompliantFfprobe(tempDir);
  const outputs = {
    oneByOne: path.join(outDir, "cover__apple-motion-1x1.mp4"),
    threeByFour: path.join(outDir, "cover__apple-motion-3x4.mp4"),
    preview: path.join(outDir, "cover__apple-motion-3x4-preview.png"),
    reportJson: path.join(outDir, "cover__apple-motion-qc.json"),
    reportHtml: path.join(outDir, "cover__apple-motion-qc.html")
  };
  await mkdir(outDir, { recursive: true });
  await writeFile(input, "");
  for (const [name, filePath] of Object.entries(outputs)) {
    await writeFile(filePath, `old ${name}`);
  }

  await runBatch({
    input,
    outDir,
    mode: "scale-fill",
    fps: "30",
    bitrate: "50M",
    container: "mp4",
    encoder: "x264",
    dryRun: false,
    overwrite: true,
    qcOnly: false,
    previewOnly: false,
    ffmpegPath: fakeFfmpeg,
    ffprobePath: fakeFfprobe
  });

  assert.equal(await readFile(outputs.oneByOne, "utf8"), "fake media");
  assert.equal(await readFile(outputs.threeByFour, "utf8"), "fake media");
  assert.equal(await readFile(outputs.preview, "utf8"), "fake media");
  assert.match(await readFile(outputs.reportJson, "utf8"), /"ok": true/);
  assert.match(await readFile(outputs.reportHtml, "utf8"), /Apple Motion QC/);
  const leftovers = (await readdir(outDir)).filter((name) => {
    return isAtomicLeftoverName(name);
  });
  assert.deepEqual(leftovers, []);
});

test("full render emits stage progress for each long-running phase", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "apple-motion-batch-"));
  const input = path.join(tempDir, "cover.mov");
  const outDir = path.join(tempDir, "out");
  const fakeFfmpeg = await writeFakeRenderingFfmpeg(tempDir);
  const fakeFfprobe = await writeFakeCompliantFfprobe(tempDir);
  const stages = [];
  await writeFile(input, "");

  await runBatch({
    input,
    outDir,
    mode: "scale-fill",
    fps: "30",
    bitrate: "50M",
    container: "mp4",
    encoder: "x264",
    dryRun: false,
    overwrite: false,
    qcOnly: false,
    previewOnly: false,
    ffmpegPath: fakeFfmpeg,
    ffprobePath: fakeFfprobe,
    onStage: (stage) => stages.push(stage)
  });

  assert.deepEqual(simplifyStages(stages), [
    "probe:input:active",
    "probe:input:done",
    "encoder:input:active",
    "encoder:input:done",
    "render:1x1:active",
    "render:1x1:done",
    "render:3x4:active",
    "render:3x4:done",
    "preview:preview:active",
    "preview:preview:done",
    "probe:1x1:active",
    "probe:1x1:done",
    "qc:1x1:active",
    "qc:1x1:done",
    "probe:3x4:active",
    "probe:3x4:done",
    "qc:3x4:active",
    "qc:3x4:done",
    "report:reports:active",
    "report:reports:done"
  ]);
});

test("full render report keeps technical summaries for each Apple target", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "apple-motion-batch-"));
  const input = path.join(tempDir, "cover.mov");
  const outDir = path.join(tempDir, "out");
  const fakeFfmpeg = await writeFakeRenderingFfmpeg(tempDir);
  const fakeFfprobe = await writeFakeCompliantFfprobe(tempDir);
  await writeFile(input, "");

  const [result] = await runBatch({
    input,
    outDir,
    mode: "scale-fill",
    fps: "30",
    bitrate: "50M",
    container: "mp4",
    encoder: "x264",
    dryRun: false,
    overwrite: false,
    qcOnly: false,
    previewOnly: false,
    ffmpegPath: fakeFfmpeg,
    ffprobePath: fakeFfprobe
  });

  const summaries = Object.fromEntries(result.report.items.map((item) => [item.target, item.summary]));
  assert.deepEqual(summaries["1x1"], {
    target: "1x1",
    codec: "h264",
    dimensions: "3840x3840",
    durationSeconds: 15.1,
    frameRate: 30,
    bitrateMbps: 50,
    color: {
      color_space: "bt709",
      color_transfer: "bt709",
      color_primaries: "bt709"
    }
  });
  assert.deepEqual(summaries["3x4"], {
    target: "3x4",
    codec: "h264",
    dimensions: "2048x2732",
    durationSeconds: 15.1,
    frameRate: 30,
    bitrateMbps: 50,
    color: {
      color_space: "bt709",
      color_transfer: "bt709",
      color_primaries: "bt709"
    }
  });
});

test("preview-only render emits only preview stage progress", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "apple-motion-batch-"));
  const input = path.join(tempDir, "cover.mov");
  const outDir = path.join(tempDir, "out");
  const fakeFfmpeg = await writeFakeOutputFfmpeg(tempDir);
  const fakeFfprobe = await writeFakeCompliantFfprobe(tempDir);
  const stages = [];
  await writeFile(input, "");

  await runBatch({
    input,
    outDir,
    mode: "scale-fill",
    fps: "30",
    bitrate: "45M",
    container: "mp4",
    encoder: "x264",
    dryRun: false,
    overwrite: false,
    qcOnly: false,
    previewOnly: true,
    ffmpegPath: fakeFfmpeg,
    ffprobePath: fakeFfprobe,
    onStage: (stage) => stages.push(stage)
  });

  assert.deepEqual(simplifyStages(stages), [
    "probe:input:active",
    "probe:input:done",
    "preview:preview:active",
    "preview:preview:done"
  ]);
});

test("preview-only render applies HDR to Rec.709 conversion before drawing the preview overlay", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "apple-motion-batch-"));
  const input = path.join(tempDir, "cover.mov");
  const outDir = path.join(tempDir, "out");
  const fakeFfmpeg = await writeFakeOutputFfmpeg(tempDir);
  const fakeFfprobe = await writeFakeHdrFfprobe(tempDir);
  await writeFile(input, "");

  const [result] = await runBatch({
    input,
    outDir,
    mode: "scale-fill",
    fps: "auto",
    bitrate: "45M",
    container: "mp4",
    encoder: "x264",
    dryRun: false,
    overwrite: false,
    qcOnly: false,
    previewOnly: true,
    ffmpegPath: fakeFfmpeg,
    ffprobePath: fakeFfprobe
  });

  const previewArgs = result.commands.find((command) => command.target === "preview")?.args ?? [];
  const previewFilter = previewArgs[previewArgs.indexOf("-vf") + 1] ?? "";
  assert.match(previewFilter, /zscale=matrixin=bt2020nc:transferin=smpte2084:primariesin=bt2020:transfer=linear:npl=100/);
  assert.match(previewFilter, /tonemap=tonemap=hable:desat=0/);
  assert.match(previewFilter, /drawbox=x=124:y=429:w=1800:h=1280/);
  assert.equal(result.colorConversion.mode, "hdr-to-rec709");
});

test("overwrite disabled records failure and preserves outputs created after preflight", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "apple-motion-batch-"));
  const input = path.join(tempDir, "cover.mov");
  const outDir = path.join(tempDir, "out");
  const expectedPreview = path.join(outDir, "cover__apple-motion-3x4-preview.png");
  const fakeFfmpeg = await writeFakeFfmpegThatCreatesLateFinal(tempDir);
  const fakeFfprobe = await writeFakeCompliantFfprobe(tempDir);
  await writeFile(input, "");

  const [result] = await runBatch({
    input,
    outDir,
    mode: "scale-fill",
    fps: "30",
    bitrate: "45M",
    container: "mp4",
    encoder: "x264",
    dryRun: false,
    overwrite: false,
    qcOnly: false,
    previewOnly: true,
    ffmpegPath: fakeFfmpeg,
    ffprobePath: fakeFfprobe
  });
  assertFailedResult(result, /Output already exists/);

  assert.equal(await readFile(expectedPreview, "utf8"), "late concurrent output");
});

test("overwrite disabled records failure and preserves reports created after preflight", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "apple-motion-batch-"));
  const input = path.join(tempDir, "cover.mov");
  const outDir = path.join(tempDir, "out");
  const reportJson = path.join(outDir, "cover__apple-motion-qc.json");
  const reportHtml = path.join(outDir, "cover__apple-motion-qc.html");
  const fakeFfmpeg = await writeFakeFfmpegThatCreatesLateReports(tempDir, { reportJson, reportHtml });
  const fakeFfprobe = await writeFakeCompliantFfprobe(tempDir);
  await writeFile(input, "");

  const [result] = await runBatch({
    input,
    outDir,
    mode: "scale-fill",
    fps: "30",
    bitrate: "50M",
    container: "mp4",
    encoder: "x264",
    dryRun: false,
    overwrite: false,
    qcOnly: false,
    previewOnly: false,
    ffmpegPath: fakeFfmpeg,
    ffprobePath: fakeFfprobe
  });
  assertFailedResult(result, /Report already exists/);

  assert.equal(await readFile(reportJson, "utf8"), "late concurrent json");
  assert.equal(await readFile(reportHtml, "utf8"), "late concurrent html");
});

test("full render records ambiguous source files with multiple video streams before rendering", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "apple-motion-batch-"));
  const input = path.join(tempDir, "cover.mov");
  const outDir = path.join(tempDir, "out");
  const fakeFfmpeg = await writeCountingFfmpeg(tempDir, path.join(tempDir, "counts.txt"));
  const fakeFfprobe = await writeFakeMultiVideoSourceFfprobe(tempDir);
  await writeFile(input, "");

  const [result] = await runBatch({
    input,
    outDir,
    mode: "scale-fill",
    fps: "30",
    bitrate: "50M",
    container: "mp4",
    encoder: "x264",
    dryRun: false,
    overwrite: false,
    qcOnly: false,
    previewOnly: false,
    ffmpegPath: fakeFfmpeg,
    ffprobePath: fakeFfprobe
  });
  assertFailedResult(result, /Exactly one video stream is required/);

  assert.equal(await fileExists(path.join(outDir, "cover__apple-motion-1x1.mp4")), false);
  assert.equal(await fileExists(path.join(outDir, "cover__apple-motion-3x4.mp4")), false);
  assert.equal(await fileExists(path.join(outDir, "cover__apple-motion-3x4-preview.png")), false);
});

test("preview-only records ambiguous source files with multiple video streams before rendering", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "apple-motion-batch-"));
  const input = path.join(tempDir, "cover.mov");
  const outDir = path.join(tempDir, "out");
  const countPath = path.join(tempDir, "counts.txt");
  const fakeFfmpeg = await writeCountingFfmpeg(tempDir, countPath);
  const fakeFfprobe = await writeFakeMultiVideoSourceFfprobe(tempDir);
  await writeFile(input, "");

  const [result] = await runBatch({
    input,
    outDir,
    mode: "scale-fill",
    fps: "30",
    bitrate: "50M",
    container: "mp4",
    encoder: "x264",
    dryRun: false,
    overwrite: false,
    qcOnly: false,
    previewOnly: true,
    ffmpegPath: fakeFfmpeg,
    ffprobePath: fakeFfprobe
  });
  assertFailedResult(result, /Exactly one video stream is required/);

  assert.equal(await fileExists(path.join(outDir, "cover__apple-motion-3x4-preview.png")), false);
  assert.equal(await countMarker(countPath, "smoke"), 0);
});

test("preview-only input probe records the configured probe timeout", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "apple-motion-batch-"));
  const input = path.join(tempDir, "cover.mov");
  const outDir = path.join(tempDir, "out");
  const terminatedPath = path.join(tempDir, "ffprobe-terminated.txt");
  const fakeFfprobe = await writeHangingFfprobe(tempDir, terminatedPath);
  const fakeFfmpeg = await writeFakeOutputFfmpeg(tempDir);
  await writeFile(input, "materialized media placeholder");

  const [result] = await runBatch({
    input,
    outDir,
    mode: "scale-fill",
    fps: "30",
    bitrate: "50M",
    container: "mp4",
    encoder: "x264",
    dryRun: false,
    overwrite: false,
    qcOnly: false,
    previewOnly: true,
    ffmpegPath: fakeFfmpeg,
    ffprobePath: fakeFfprobe,
    probeTimeoutMs: 2000
  });
  assertFailedResult(result, (error) => {
    assert.equal(error.code, "PROCESS_TIMEOUT");
    assert.equal(error.timeoutMs, 2000);
  });
  await waitForFile(terminatedPath);
});

test("preview-only render records the configured render timeout", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "apple-motion-batch-"));
  const input = path.join(tempDir, "cover.mov");
  const outDir = path.join(tempDir, "out");
  const terminatedPath = path.join(tempDir, "ffmpeg-terminated.txt");
  const fakeFfmpeg = await writeHangingFfmpeg(tempDir, terminatedPath);
  const fakeFfprobe = await writeFakeCompliantFfprobe(tempDir);
  await writeFile(input, "materialized media placeholder");

  const controller = new AbortController();
  const abortTimer = setTimeout(() => controller.abort(), 10_000);
  try {
    const [result] = await runBatch({
      input,
      outDir,
      mode: "scale-fill",
      fps: "30",
      bitrate: "50M",
      container: "mp4",
      encoder: "x264",
      dryRun: false,
      overwrite: false,
      qcOnly: false,
      previewOnly: true,
      ffmpegPath: fakeFfmpeg,
      ffprobePath: fakeFfprobe,
      renderTimeoutMs: 2000,
      signal: controller.signal
    });
    assertFailedResult(result, (error) => {
      assert.equal(error.code, "PROCESS_TIMEOUT");
      assert.equal(error.timeoutMs, 2000);
    });
  } finally {
    clearTimeout(abortTimer);
  }

  await waitForFile(terminatedPath);
  assert.equal(await fileExists(path.join(outDir, "cover__apple-motion-3x4-preview.png")), false);
});

test("qc-only report probe records the configured probe timeout", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "apple-motion-batch-"));
  const input = path.join(tempDir, "cover.mov");
  const outDir = path.join(tempDir, "out");
  const terminatedPath = path.join(tempDir, "ffprobe-terminated.txt");
  const fakeFfprobe = await writeHangingFfprobe(tempDir, terminatedPath);
  const fakeFfmpeg = await writeFakeOutputFfmpeg(tempDir);
  await writeFile(input, "materialized media placeholder");

  const [result] = await runBatch({
    input,
    outDir,
    mode: "scale-fill",
    fps: "30",
    bitrate: "50M",
    container: "mp4",
    encoder: "x264",
    dryRun: false,
    overwrite: false,
    qcOnly: true,
    previewOnly: false,
    ffmpegPath: fakeFfmpeg,
    ffprobePath: fakeFfprobe,
    probeTimeoutMs: 2000
  });
  assertFailedResult(result, (error) => {
    assert.equal(error.code, "PROCESS_TIMEOUT");
    assert.equal(error.timeoutMs, 2000);
  });
  await waitForFile(terminatedPath);
});

test("QC command failures make the final report fail", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "apple-motion-batch-"));
  const input = path.join(tempDir, "cover.mov");
  const outDir = path.join(tempDir, "out");
  const fakeFfmpeg = await writeFakeRenderingFfmpegWithQcFailure(tempDir);
  const fakeFfprobe = await writeFakeCompliantFfprobe(tempDir);
  await writeFile(input, "");

  const [result] = await runBatch({
    input,
    outDir,
    mode: "scale-fill",
    fps: "30",
    bitrate: "50M",
    container: "mp4",
    encoder: "x264",
    dryRun: false,
    overwrite: false,
    qcOnly: false,
    previewOnly: false,
    ffmpegPath: fakeFfmpeg,
    ffprobePath: fakeFfprobe
  });

  assert.equal(result.report.ok, false);
  assert.match(result.report.items.flatMap((item) => item.errors).join("\n"), /blackdetect failed with exit code 13/);
});

test("QC command timeouts do not leave a full render job running indefinitely", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "apple-motion-batch-"));
  const input = path.join(tempDir, "cover.mov");
  const outDir = path.join(tempDir, "out");
  const terminatedPath = path.join(tempDir, "qc-terminated.txt");
  const fakeFfmpeg = await writeFakeRenderingFfmpegWithHangingQc(tempDir, terminatedPath);
  const fakeFfprobe = await writeFakeCompliantFfprobe(tempDir);
  await writeFile(input, "materialized media placeholder");

  const controller = new AbortController();
  const abortTimer = setTimeout(() => controller.abort(), 10_000);
  try {
    const [result] = await runBatch({
      input,
      outDir,
      mode: "scale-fill",
      fps: "30",
      bitrate: "50M",
      container: "mp4",
      encoder: "x264",
      dryRun: false,
      overwrite: false,
      qcOnly: false,
      previewOnly: false,
      ffmpegPath: fakeFfmpeg,
      ffprobePath: fakeFfprobe,
      qcTimeoutMs: 1000,
      signal: controller.signal
    });

    const errors = result.report.items.flatMap((item) => item.errors).join("\n");
    assert.equal(result.report.ok, false);
    assert.match(errors, /blackdetect timed out/);
    assert.doesNotMatch(errors, /\/Users|\.private-fixture|raw stderr|\b\d+ms\b/);
  } finally {
    clearTimeout(abortTimer);
  }
  await waitForFile(terminatedPath);
});

test("qc-only skips deep QC passes after fatal probe validation errors", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "apple-motion-batch-"));
  const input = path.join(tempDir, "cover.mov");
  const outDir = path.join(tempDir, "out");
  const countPath = path.join(tempDir, "ffmpeg-counts.txt");
  const fakeFfmpeg = await writeCountingFfmpeg(tempDir, countPath);
  const fakeFfprobe = await writeFakeLongDurationFfprobe(tempDir);
  await writeFile(input, "");

  const [result] = await runBatch({
    input,
    outDir,
    mode: "scale-fill",
    fps: "30",
    bitrate: "50M",
    container: "mp4",
    encoder: "x264",
    dryRun: false,
    overwrite: false,
    qcOnly: true,
    previewOnly: false,
    ffmpegPath: fakeFfmpeg,
    ffprobePath: fakeFfprobe
  });

  assert.equal(result.report.ok, false);
  assert.match(result.report.items[0].errors.join("\n"), /Duration must be between 8 and 35 seconds/);
  assert.equal(await countMarker(countPath, "qc"), 0);
});

function simplifyStages(stages) {
  return stages.map((stage) => `${stage.name}:${stage.target}:${stage.state}`);
}

function assertFailedResult(result, assertion) {
  assert.equal(result.status, "failed");
  assert.ok(result.error);
  if (assertion instanceof RegExp) {
    assert.match(String(result.error.message ?? result.error), assertion);
  } else if (typeof assertion === "function") {
    assertion(result.error);
  }
}

async function writeFakeOutputFfmpeg(tempDir) {
  const scriptPath = path.join(tempDir, "fake-ffmpeg.js");
  await writeFile(scriptPath, `#!/usr/bin/env node
const fs = require("node:fs");
const output = process.argv.at(-1);
if (output === "-") {
  process.exit(0);
}
fs.mkdirSync(require("node:path").dirname(output), { recursive: true });
fs.writeFileSync(output, "fake media");
process.exit(0);
`);
  await chmod(scriptPath, 0o755);
  return scriptPath;
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

async function writeFakeFfmpegThatCreatesLateFinal(tempDir) {
  const scriptPath = path.join(tempDir, "fake-ffmpeg-late-final.js");
  await writeFile(scriptPath, `#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const output = process.argv.at(-1);
if (output === "-") {
  process.exit(0);
}
const fileName = path.basename(output);
const match = fileName.match(/^\\.(.+)\\.\\d+\\.\\d+\\.[^.]+\\.tmp(\\.[^.]+)?$/);
const finalName = match
  ? (match[2] && !match[1].endsWith(match[2]) ? match[1] + match[2] : match[1])
  : fileName.replace(/^\\./, "");
const finalPath = path.join(path.dirname(output), finalName);
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(finalPath, "late concurrent output");
fs.writeFileSync(output, "new render output");
process.exit(0);
`);
  await chmod(scriptPath, 0o755);
  return scriptPath;
}

async function writeFakeFfmpegThatCreatesLateReports(tempDir, { reportJson, reportHtml }) {
  const scriptPath = path.join(tempDir, "fake-ffmpeg-late-reports.js");
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
fs.mkdirSync(path.dirname(${JSON.stringify(reportJson)}), { recursive: true });
fs.writeFileSync(${JSON.stringify(reportJson)}, "late concurrent json");
fs.writeFileSync(${JSON.stringify(reportHtml)}, "late concurrent html");
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

async function writeFakeFfmpegThatFailsThreeByFour(tempDir) {
  const scriptPath = path.join(tempDir, "fake-ffmpeg-fail-3x4.js");
  await writeFile(scriptPath, `#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const args = process.argv.slice(2);
const joined = args.join(" ");
const output = args.at(-1);
if (args.includes("-encoders")) {
  console.log(" V....D libx264 H.264 / AVC / MPEG-4 AVC / MPEG-4 part 10");
  process.exit(0);
}
if (joined.includes("color=c=black")) {
  process.exit(0);
}
if (String(output).includes("__apple-motion-3x4.") && String(output).endsWith(".mp4")) {
  console.error("3x4 encoder failure after 1x1 committed");
  process.exit(33);
}
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

async function writeFakeFfmpegThatFailsBadThreeByFour(tempDir) {
  const scriptPath = path.join(tempDir, "fake-ffmpeg-fail-bad-3x4.js");
  await writeFile(scriptPath, `#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const args = process.argv.slice(2);
const joined = args.join(" ");
const output = args.at(-1);
if (args.includes("-encoders")) {
  console.log(" V....D libx264 H.264 / AVC / MPEG-4 AVC / MPEG-4 part 10");
  process.exit(0);
}
if (joined.includes("color=c=black")) {
  process.exit(0);
}
if (String(output).includes("bad__apple-motion-3x4.") && String(output).endsWith(".mp4")) {
  console.error("bad file 3x4 encoder failure");
  process.exit(33);
}
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

async function writeFakeRenderingFfmpegWithQcFailure(tempDir) {
  const scriptPath = path.join(tempDir, "fake-ffmpeg-qc.js");
  await writeFile(scriptPath, `#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const args = process.argv.slice(2);
const joined = args.join(" ");
if (args.includes("-encoders")) {
  console.log(" V....D libx264 H.264 / AVC / MPEG-4 AVC / MPEG-4 part 10");
  process.exit(0);
}
if (joined.includes("blackdetect=")) {
  console.error("blackdetect decoder failure");
  process.exit(13);
}
if (joined.includes("blackframe=") || joined.includes("freezedetect=") || joined.includes("color=c=black")) {
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

async function writeFakeRenderingFfmpegWithHangingQc(tempDir, terminatedPath) {
  const scriptPath = path.join(tempDir, "fake-ffmpeg-hanging-qc.js");
  await writeFile(scriptPath, `#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const args = process.argv.slice(2);
const joined = args.join(" ");
if (args.includes("-encoders")) {
  console.log(" V....D libx264 H.264 / AVC / MPEG-4 AVC / MPEG-4 part 10");
  process.exit(0);
}
if (joined.includes("color=c=black")) {
  process.exit(0);
}
if (joined.includes("blackdetect=")) {
  process.on("SIGTERM", () => {
    fs.writeFileSync(${JSON.stringify(terminatedPath)}, "terminated");
    process.exit(0);
  });
  setInterval(() => {}, 1000);
  return;
}
if (joined.includes("blackframe=") || joined.includes("freezedetect=")) {
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

async function writeCountingFfmpeg(tempDir, countPath) {
  const scriptPath = path.join(tempDir, "fake-counting-ffmpeg.js");
  await writeFile(scriptPath, `#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const countPath = ${JSON.stringify(countPath)};
const args = process.argv.slice(2);
const joined = args.join(" ");
function mark(name) {
  fs.appendFileSync(countPath, name + "\\n");
}
if (args.includes("-encoders")) {
  mark("encoders");
  console.log(" V....D libx264 H.264 / AVC / MPEG-4 AVC / MPEG-4 part 10");
  process.exit(0);
}
if (joined.includes("color=c=black")) {
  mark("smoke");
  process.exit(0);
}
if (joined.includes("blackdetect=") || joined.includes("blackframe=") || joined.includes("freezedetect=")) {
  mark("qc");
  process.exit(0);
}
const output = args.at(-1);
if (output === "-") {
  process.exit(0);
}
mark("render");
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, "fake media");
process.exit(0);
`);
  await chmod(scriptPath, 0o755);
  return scriptPath;
}

async function writeFfmpegWithoutH264Encoders(tempDir) {
  const scriptPath = path.join(tempDir, "fake-ffmpeg-no-h264.js");
  await writeFile(scriptPath, `#!/usr/bin/env node
const args = process.argv.slice(2);
if (args.includes("-encoders")) {
  console.log(" V..... rawvideo raw video");
  process.exit(0);
}
process.exit(0);
`);
  await chmod(scriptPath, 0o755);
  return scriptPath;
}

async function countMarker(filePath, marker) {
  try {
    const content = await readFile(filePath, "utf8");
    return content.split(/\r?\n/).filter((line) => line === marker).length;
  } catch (error) {
    if (error.code === "ENOENT") return 0;
    throw error;
  }
}

async function writeFakeCompliantFfprobe(tempDir) {
  const scriptPath = path.join(tempDir, "fake-ffprobe.js");
  await writeFile(scriptPath, `#!/usr/bin/env node
const input = process.argv.at(-1);
const isOneByOne = input.includes("__apple-motion-1x1");
const width = isOneByOne ? 3840 : 2048;
const height = isOneByOne ? 3840 : 2732;
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
    duration: "15.1"
  }],
  format: {
    duration: "15.1",
    bit_rate: "50000000"
  }
}));
`);
  await chmod(scriptPath, 0o755);
  return scriptPath;
}

async function writeFakeHdrFfprobe(tempDir) {
  const scriptPath = path.join(tempDir, "fake-hdr-ffprobe.js");
  await writeFile(scriptPath, `#!/usr/bin/env node
process.stdout.write(JSON.stringify({
  streams: [{
    codec_type: "video",
    codec_name: "h264",
    width: 2048,
    height: 2732,
    sample_aspect_ratio: "1:1",
    avg_frame_rate: "30000/1001",
    bit_rate: "50000000",
    color_space: "bt2020nc",
    color_transfer: "smpte2084",
    color_primaries: "bt2020",
    pix_fmt: "yuv420p",
    duration: "15.1"
  }],
  format: {
    duration: "15.1",
    bit_rate: "50000000"
  }
}));
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

async function writeFakeUnsupportedColorFfprobe(tempDir) {
  const scriptPath = path.join(tempDir, "fake-unsupported-color-ffprobe.js");
  await writeFile(scriptPath, `#!/usr/bin/env node
process.stdout.write(JSON.stringify({
  streams: [{
    codec_type: "video",
    codec_name: "h264",
    width: 2048,
    height: 2732,
    sample_aspect_ratio: "1:1",
    avg_frame_rate: "30/1",
    bit_rate: "50000000",
    color_space: "bt470bg",
    color_transfer: "bt709",
    color_primaries: "bt470bg",
    pix_fmt: "yuv420p",
    duration: "15.1"
  }],
  format: {
    duration: "15.1",
    bit_rate: "50000000"
  }
}));
`);
  await chmod(scriptPath, 0o755);
  return scriptPath;
}

async function writeHangingFfprobe(tempDir, terminatedPath) {
  const scriptPath = path.join(tempDir, "hanging-ffprobe.js");
  await writeFile(scriptPath, `#!/usr/bin/env node
const fs = require("node:fs");
process.on("SIGTERM", () => {
  fs.writeFileSync(${JSON.stringify(terminatedPath)}, "SIGTERM");
  process.exit(143);
});
setInterval(() => {}, 1000);
`);
  await chmod(scriptPath, 0o755);
  return scriptPath;
}

async function writeHangingFfmpeg(tempDir, terminatedPath) {
  const scriptPath = path.join(tempDir, "hanging-ffmpeg.js");
  await writeFile(scriptPath, `#!/usr/bin/env node
const fs = require("node:fs");
process.on("SIGTERM", () => {
  fs.writeFileSync(${JSON.stringify(terminatedPath)}, "SIGTERM");
  process.exit(143);
});
setInterval(() => {}, 1000);
`);
  await chmod(scriptPath, 0o755);
  return scriptPath;
}

async function writeFakeMultiVideoSourceFfprobe(tempDir) {
  const scriptPath = path.join(tempDir, "fake-multi-video-ffprobe.js");
  await writeFile(scriptPath, `#!/usr/bin/env node
const input = process.argv.at(-1);
const isOutput = input.includes("__apple-motion-");
const streams = isOutput
  ? [{
      codec_type: "video",
      codec_name: "h264",
      width: input.includes("__apple-motion-1x1") ? 3840 : 2048,
      height: input.includes("__apple-motion-1x1") ? 3840 : 2732,
      sample_aspect_ratio: "1:1",
      avg_frame_rate: "30/1",
      bit_rate: "50000000",
      color_space: "bt709",
      color_transfer: "bt709",
      color_primaries: "bt709",
      pix_fmt: "yuv420p",
      duration: "15.1"
    }]
  : [
      { codec_type: "video", codec_name: "h264", width: 2048, height: 2732, avg_frame_rate: "30/1", duration: "15.1" },
      { codec_type: "video", codec_name: "h264", width: 3840, height: 3840, avg_frame_rate: "30/1", duration: "15.1" },
      { codec_type: "audio", codec_name: "aac" }
    ];
process.stdout.write(JSON.stringify({
  streams,
  format: {
    duration: "15.1",
    bit_rate: "50000000"
  }
}));
`);
  await chmod(scriptPath, 0o755);
  return scriptPath;
}

async function writeFakeLongDurationFfprobe(tempDir) {
  const scriptPath = path.join(tempDir, "fake-long-duration-ffprobe.js");
  await writeFile(scriptPath, `#!/usr/bin/env node
process.stdout.write(JSON.stringify({
  streams: [{
    codec_type: "video",
    codec_name: "h264",
    width: 2048,
    height: 2732,
    sample_aspect_ratio: "1:1",
    avg_frame_rate: "30/1",
    bit_rate: "50000000",
    color_space: "bt709",
    color_transfer: "bt709",
    color_primaries: "bt709",
    pix_fmt: "yuv420p",
    duration: "3600"
  }],
  format: {
    duration: "3600",
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

async function waitForFile(filePath, timeoutMs = 1000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await fileExists(filePath)) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`Timed out waiting for ${filePath}`);
}

function isAtomicLeftoverName(name) {
  return name.includes(".openfad-motion-transaction.")
    || name.includes(".openfad-motion-output-group.")
    || /\.\w+\.(?:bak|tmp)\.[A-Za-z0-9]+$/.test(name)
    || name.endsWith(".bak")
    || name.endsWith(".tmp");
}
