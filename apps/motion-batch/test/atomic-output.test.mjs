import { access, link, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

import {
  buildAtomicOutput,
  commitAtomicOutput,
  finalizeCommittedOutputs,
  recoverOutputTransactions
} from "../src/atomicOutput.mjs";

test("builds FFmpeg-friendly temporary paths that preserve the final extension", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "apple-motion-atomic-"));
  const output = buildAtomicOutput(path.join(tempDir, "cover__apple-motion-3x4-preview.png"));

  assert.match(path.basename(output.temp), /^\.cover__apple-motion-3x4-preview\..+\.tmp\.png$/);
  assert.match(path.basename(output.backup), /^\.cover__apple-motion-3x4-preview\..+\.bak\.png$/);
  assert.equal(path.extname(output.temp), ".png");
});

test("recovers an unfinalized overwrite after the new final replaced the old final", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "apple-motion-atomic-"));
  const final = path.join(tempDir, "cover.mp4");
  const backup = path.join(tempDir, ".cover.mp4.test.bak");
  const temp = path.join(tempDir, ".cover.mp4.test.tmp");
  const journal = path.join(tempDir, ".openfad-motion-transaction.test.json");

  await writeFile(final, "new final");
  await writeFile(backup, "old final");
  await writeFile(temp, "stale temp");
  await writeFile(journal, JSON.stringify({
    version: 1,
    final,
    backup,
    temp,
    hadExistingFinal: true,
    phase: "final-replaced",
    finalized: false
  }));

  const recovered = await recoverOutputTransactions(tempDir);

  assert.equal(recovered.length, 1);
  assert.equal(await readFile(final, "utf8"), "old final");
  assert.equal(await fileExists(backup), false);
  assert.equal(await fileExists(temp), false);
  assert.equal(await fileExists(journal), false);
});

test("standalone recovery preserves the current final when an overwrite backup is missing", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "apple-motion-atomic-"));
  const final = path.join(tempDir, "cover.mp4");
  const backup = path.join(tempDir, ".cover.mp4.test.bak");
  const temp = path.join(tempDir, ".cover.mp4.test.tmp");
  const journal = path.join(tempDir, ".openfad-motion-transaction.test.json");

  await writeFile(final, "new final without rollback backup");
  await writeFile(temp, "stale temp");
  await writeFile(journal, JSON.stringify({
    version: 1,
    final,
    backup,
    temp,
    hadExistingFinal: true,
    phase: "final-replaced",
    finalized: false
  }));

  await assert.rejects(() => recoverOutputTransactions(tempDir), /Cannot safely roll back output transaction/);
  assert.equal(await readFile(final, "utf8"), "new final without rollback backup");
  assert.equal(await readFile(temp, "utf8"), "stale temp");
  assert.equal(await fileExists(journal), true);
});

test("recovers a started overwrite without deleting the old final before backup exists", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "apple-motion-atomic-"));
  const final = path.join(tempDir, "cover.mp4");
  const backup = path.join(tempDir, ".cover.mp4.test.bak");
  const temp = path.join(tempDir, ".cover.mp4.test.tmp");
  const journal = path.join(tempDir, ".openfad-motion-transaction.test.json");

  await writeFile(final, "old final");
  await writeFile(temp, "new temp");
  await writeFile(journal, JSON.stringify({
    version: 1,
    final,
    backup,
    temp,
    hadExistingFinal: true,
    phase: "started",
    finalized: false
  }));

  const recovered = await recoverOutputTransactions(tempDir);

  assert.equal(recovered.length, 1);
  assert.equal(await readFile(final, "utf8"), "old final");
  assert.equal(await fileExists(temp), false);
  assert.equal(await fileExists(journal), false);
});

test("recovers an unfinalized overwrite with no old final by deleting the promoted final", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "apple-motion-atomic-"));
  const final = path.join(tempDir, "cover.mp4");
  const backup = path.join(tempDir, ".cover.mp4.test.bak");
  const temp = path.join(tempDir, ".cover.mp4.test.tmp");
  const journal = path.join(tempDir, ".openfad-motion-transaction.test.json");

  await writeFile(final, "new final");
  await writeFile(journal, JSON.stringify({
    version: 1,
    final,
    backup,
    temp,
    hadExistingFinal: false,
    phase: "ready-to-promote",
    finalized: false
  }));

  const recovered = await recoverOutputTransactions(tempDir);

  assert.equal(recovered.length, 1);
  assert.equal(await fileExists(final), false);
  assert.equal(await fileExists(journal), false);
});

test("ready-to-promote recovery preserves a final created before promotion happened", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "apple-motion-atomic-"));
  const final = path.join(tempDir, "cover.mp4");
  const backup = path.join(tempDir, ".cover.mp4.test.bak");
  const temp = path.join(tempDir, ".cover.mp4.test.tmp");
  const journal = path.join(tempDir, ".openfad-motion-transaction.test.json");

  await writeFile(final, "external final");
  await writeFile(temp, "new temp");
  await writeFile(journal, JSON.stringify({
    version: 1,
    final,
    backup,
    temp,
    hadExistingFinal: false,
    phase: "ready-to-promote",
    finalized: false
  }));

  const recovered = await recoverOutputTransactions(tempDir);

  assert.equal(recovered.length, 1);
  assert.equal(await readFile(final, "utf8"), "external final");
  assert.equal(await fileExists(temp), false);
  assert.equal(await fileExists(journal), false);
});

test("ready-to-promote recovery removes a first-time final already linked from temp", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "apple-motion-atomic-"));
  const final = path.join(tempDir, "cover.mp4");
  const backup = path.join(tempDir, ".cover.mp4.test.bak");
  const temp = path.join(tempDir, ".cover.mp4.test.tmp");
  const journal = path.join(tempDir, ".openfad-motion-transaction.test.json");

  await writeFile(temp, "new final");
  await link(temp, final);
  await writeFile(journal, JSON.stringify({
    version: 1,
    final,
    backup,
    temp,
    hadExistingFinal: false,
    phase: "ready-to-promote",
    finalized: false
  }));

  const recovered = await recoverOutputTransactions(tempDir);

  assert.equal(recovered.length, 1);
  assert.equal(await fileExists(final), false);
  assert.equal(await fileExists(temp), false);
  assert.equal(await fileExists(journal), false);
});

test("recovers a finalized overwrite journal without rolling back the new final", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "apple-motion-atomic-"));
  const final = path.join(tempDir, "cover.mp4");
  const backup = path.join(tempDir, ".cover.mp4.test.bak");
  const temp = path.join(tempDir, ".cover.mp4.test.tmp");
  const journal = path.join(tempDir, ".openfad-motion-transaction.test.json");

  await writeFile(final, "new final");
  await writeFile(backup, "old final");
  await writeFile(temp, "stale temp");
  await writeFile(journal, JSON.stringify({
    version: 1,
    final,
    backup,
    temp,
    hadExistingFinal: true,
    phase: "finalized",
    finalized: true
  }));

  const recovered = await recoverOutputTransactions(tempDir);

  assert.equal(recovered.length, 1);
  assert.equal(await readFile(final, "utf8"), "new final");
  assert.equal(await fileExists(backup), false);
  assert.equal(await fileExists(temp), false);
  assert.equal(await fileExists(journal), false);
});

test("recovers an unfinalized first-time create by removing the partial final", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "apple-motion-atomic-"));
  const final = path.join(tempDir, "cover.mp4");
  const output = buildAtomicOutput(final);
  await writeFile(output.temp, "new final");

  await commitAtomicOutput(output, { overwrite: false });
  assert.equal(await readFile(final, "utf8"), "new final");
  assert.equal(await fileExists(output.journal), true);

  const recovered = await recoverOutputTransactions(tempDir);

  assert.equal(recovered.length, 1);
  assert.equal(await fileExists(final), false);
  assert.equal(await fileExists(output.temp), false);
  assert.equal(await fileExists(output.journal), false);
});

test("finalizes a first-time create without deleting the new final", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "apple-motion-atomic-"));
  const final = path.join(tempDir, "cover.mp4");
  const output = buildAtomicOutput(final);
  await writeFile(output.temp, "new final");

  await commitAtomicOutput(output, { overwrite: false });
  await finalizeCommittedOutputs([output]);

  assert.equal(await readFile(final, "utf8"), "new final");
  assert.equal(await fileExists(output.temp), false);
  assert.equal(await fileExists(output.journal), false);
});

test("recovers a finalized output group without mixing new renders with old reports", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "apple-motion-atomic-"));
  const renderFinal = path.join(tempDir, "cover__apple-motion-1x1.mp4");
  const reportFinal = path.join(tempDir, "cover__apple-motion-qc.json");
  const reportBackup = path.join(tempDir, ".cover__apple-motion-qc.json.test.bak");
  const reportTemp = path.join(tempDir, ".cover__apple-motion-qc.json.test.tmp");
  const reportJournal = path.join(tempDir, ".openfad-motion-transaction.report.json");
  const groupJournal = path.join(tempDir, ".openfad-motion-output-group.test.json");

  await writeFile(renderFinal, "new render");
  await writeFile(reportFinal, "new report");
  await writeFile(reportBackup, "old report");
  await writeFile(reportTemp, "stale report temp");
  await writeFile(reportJournal, JSON.stringify({
    version: 1,
    final: reportFinal,
    backup: reportBackup,
    temp: reportTemp,
    hadExistingFinal: true,
    phase: "final-replaced",
    finalized: false
  }));
  await writeFile(groupJournal, JSON.stringify({
    version: 1,
    phase: "finalized",
    finalized: true,
    outputs: [
      {
        final: renderFinal,
        backup: path.join(tempDir, ".cover__apple-motion-1x1.mp4.test.bak"),
        temp: path.join(tempDir, ".cover__apple-motion-1x1.mp4.test.tmp"),
        journal: path.join(tempDir, ".openfad-motion-transaction.render.json"),
        hadExistingFinal: true,
        phase: "finalized",
        finalized: true
      },
      {
        final: reportFinal,
        backup: reportBackup,
        temp: reportTemp,
        journal: reportJournal,
        hadExistingFinal: true,
        phase: "final-replaced",
        finalized: false
      }
    ]
  }));

  const recovered = await recoverOutputTransactions(tempDir);

  assert.equal(await readFile(renderFinal, "utf8"), "new render");
  assert.equal(await readFile(reportFinal, "utf8"), "new report");
  assert.equal(await fileExists(reportBackup), false);
  assert.equal(await fileExists(reportTemp), false);
  assert.equal(await fileExists(reportJournal), false);
  assert.equal(await fileExists(groupJournal), false);
  assert.deepEqual(recovered.map((entry) => entry.action), ["group-finalized"]);
});

test("does not delete restored finals when a pending group journal outlives individual cleanup", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "apple-motion-atomic-"));
  const renderFinal = path.join(tempDir, "cover__apple-motion-1x1.mp4");
  const reportFinal = path.join(tempDir, "cover__apple-motion-qc.json");
  const renderJournal = path.join(tempDir, ".openfad-motion-transaction.render.json");
  const reportJournal = path.join(tempDir, ".openfad-motion-transaction.report.json");
  const groupJournal = path.join(tempDir, ".openfad-motion-output-group.test.json");

  await writeFile(renderFinal, "old render restored by catch");
  await writeFile(reportFinal, "old report restored by catch");
  await writeFile(groupJournal, JSON.stringify({
    version: 1,
    phase: "pending",
    finalized: false,
    outputs: [
      {
        final: renderFinal,
        backup: path.join(tempDir, ".cover__apple-motion-1x1.mp4.test.bak"),
        temp: path.join(tempDir, ".cover__apple-motion-1x1.mp4.test.tmp"),
        journal: renderJournal,
        hadExistingFinal: true,
        phase: "final-replaced",
        finalized: false
      },
      {
        final: reportFinal,
        backup: path.join(tempDir, ".cover__apple-motion-qc.json.test.bak"),
        temp: path.join(tempDir, ".cover__apple-motion-qc.json.test.tmp"),
        journal: reportJournal,
        hadExistingFinal: true,
        phase: "final-replaced",
        finalized: false
      }
    ]
  }));

  await assert.rejects(() => recoverOutputTransactions(tempDir), /Cannot safely roll back output group/);
  assert.equal(await readFile(renderFinal, "utf8"), "old render restored by catch");
  assert.equal(await readFile(reportFinal, "utf8"), "old report restored by catch");
  assert.equal(await fileExists(groupJournal), true);
});

test("excluded journals also protect overlapping output groups from recovery", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "apple-motion-atomic-"));
  const final = path.join(tempDir, "cover__apple-motion-1x1.mp4");
  const backup = path.join(tempDir, ".cover__apple-motion-1x1.mp4.test.bak");
  const temp = path.join(tempDir, ".cover__apple-motion-1x1.mp4.test.tmp");
  const journal = path.join(tempDir, ".openfad-motion-transaction.render.json");
  const groupJournal = path.join(tempDir, ".openfad-motion-output-group.test.json");

  await writeFile(final, "new render");
  await writeFile(backup, "old render");
  await writeFile(temp, "stale temp");
  await writeFile(journal, JSON.stringify({
    version: 1,
    final,
    backup,
    temp,
    hadExistingFinal: true,
    phase: "final-replaced",
    finalized: false
  }));
  await writeFile(groupJournal, JSON.stringify({
    version: 1,
    phase: "pending",
    finalized: false,
    outputs: [{
      final,
      backup,
      temp,
      journal,
      hadExistingFinal: true,
      phase: "final-replaced",
      finalized: false
    }]
  }));

  const recovered = await recoverOutputTransactions(tempDir, { excludeJournals: [journal] });

  assert.deepEqual(recovered, []);
  assert.equal(await readFile(final, "utf8"), "new render");
  assert.equal(await readFile(backup, "utf8"), "old render");
  assert.equal(await readFile(temp, "utf8"), "stale temp");
  assert.equal(await fileExists(journal), true);
  assert.equal(await fileExists(groupJournal), true);
});

test("partially overlapping output groups fail before later runs can delete newer partial outputs", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "apple-motion-atomic-"));
  const groupToken = "group-stale";
  const groupJournal = path.join(tempDir, `.openfad-motion-output-group.${groupToken}.json`);
  const oneByOne = path.join(tempDir, "cover__apple-motion-1x1.mp4");
  const threeByFour = path.join(tempDir, "cover__apple-motion-3x4.mp4");
  const preview = path.join(tempDir, "cover__apple-motion-3x4-preview.png");
  const reportJson = path.join(tempDir, "cover__apple-motion-qc.json");
  const reportHtml = path.join(tempDir, "cover__apple-motion-qc.html");
  const allFinals = [oneByOne, threeByFour, preview, reportJson, reportHtml];

  await writeFile(preview, "new preview from a later preview-only run");
  await writeFile(groupJournal, JSON.stringify({
    version: 1,
    owner: "openfad-motion-batch",
    token: groupToken,
    updatedAt: "2000-01-01T00:00:00.000Z",
    phase: "pending",
    finalized: false,
    outputs: allFinals.map((final, index) => staleManagedOutput(final, `stale-${index}`))
  }));

  await assert.rejects(
    () => recoverOutputTransactions(tempDir, { allowedFinals: [preview] }),
    /Unsafe output group journal .*partially overlaps planned outputs/
  );
  assert.equal(await readFile(preview, "utf8"), "new preview from a later preview-only run");
  assert.equal(await fileExists(groupJournal), true);
});

test("does not silently skip a corrupted overwrite journal", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "apple-motion-atomic-"));
  const final = path.join(tempDir, "cover.mp4");
  const backup = path.join(tempDir, ".cover.mp4.test.bak");
  const temp = path.join(tempDir, ".cover.mp4.test.tmp");
  const journal = path.join(tempDir, ".openfad-motion-transaction.test.json");

  await writeFile(final, "new final");
  await writeFile(backup, "old final");
  await writeFile(temp, "stale temp");
  await writeFile(journal, "{ not valid json");

  await assert.rejects(() => recoverOutputTransactions(tempDir), /Could not read output transaction journal/);
  assert.equal(await readFile(final, "utf8"), "new final");
  assert.equal(await readFile(backup, "utf8"), "old final");
  assert.equal(await readFile(temp, "utf8"), "stale temp");
  assert.equal(await fileExists(journal), true);
});

test("does not silently skip an unsafe output group journal", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "apple-motion-atomic-"));
  const groupJournal = path.join(tempDir, ".openfad-motion-output-group.test.json");

  await writeFile(groupJournal, JSON.stringify({
    version: 1,
    phase: "finalized",
    finalized: true,
    outputs: [{
      final: path.join(tempDir, "cover.mp4"),
      backup: path.join(os.tmpdir(), "outside.bak"),
      temp: path.join(tempDir, ".cover.mp4.test.tmp"),
      journal: path.join(tempDir, ".openfad-motion-transaction.test.json"),
      hadExistingFinal: true,
      phase: "finalized",
      finalized: true
    }]
  }));

  await assert.rejects(() => recoverOutputTransactions(tempDir), /Unsafe output group journal/);
  assert.equal(await fileExists(groupJournal), true);
});

async function fileExists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}

function staleManagedOutput(final, token) {
  const basename = path.basename(final);
  return {
    final,
    backup: path.join(path.dirname(final), `.${basename}.${token}.bak`),
    temp: path.join(path.dirname(final), `.${basename}.${token}.tmp`),
    journal: path.join(path.dirname(final), `.openfad-motion-transaction.${token}.json`),
    token,
    hadExistingFinal: false,
    phase: "final-replaced",
    finalized: false
  };
}
