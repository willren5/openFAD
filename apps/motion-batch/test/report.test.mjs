import { access, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";

import { cleanupCommittedReports, finalizeCommittedReports, renderHtmlReport, writeReports } from "../src/report.mjs";

const privateUserRoot = `/${"Users"}/will`;
const windowsUserRoot = `C:\\${"Users"}\\will`;

const report = {
  ok: true,
  source: "input.mov",
  generatedAt: "2026-06-08T00:00:00.000Z",
  items: []
};

test("writes QC reports through temp files before replacing final paths", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "apple-motion-report-"));
  const outputPlan = {
    reportJson: path.join(tempDir, "report.json"),
    reportHtml: path.join(tempDir, "report.html")
  };

  await writeReports(report, outputPlan);

  assert.match(await readFile(outputPlan.reportJson, "utf8"), /"ok": true/);
  assert.match(await readFile(outputPlan.reportHtml, "utf8"), /Apple Motion QC/);
  assert.equal(await fileExists(`${outputPlan.reportJson}.tmp`), false);
  assert.equal(await fileExists(`${outputPlan.reportHtml}.tmp`), false);
});

test("report output sanitizes raw child diagnostics in JSON and HTML", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "apple-motion-report-"));
  const envFile = `.${"env"}`;
  const outputPlan = {
    reportJson: path.join(tempDir, "report.json"),
    reportHtml: path.join(tempDir, "report.html")
  };
  const diagnosticReport = {
    ok: false,
    source: "input.mov",
    generatedAt: "2026-06-08T00:00:00.000Z",
    items: [{
      target: "3x4",
      errors: [`blackdetect failed with exit code 13. Error: spawn ${privateUserRoot}/.private-fixture/tool-bin/ffmpeg\n    at ChildProcess.<anonymous> (${privateUserRoot}/private/render.js:42:7)`],
      warnings: [`freezedetect warning stderr token=${privateUserRoot}/${envFile}`],
      summary: {}
    }]
  };

  await writeReports(diagnosticReport, outputPlan);
  const json = await readFile(outputPlan.reportJson, "utf8");
  const html = await readFile(outputPlan.reportHtml, "utf8");
  const rendered = renderHtmlReport(diagnosticReport);

  for (const output of [json, html, rendered]) {
    assert.match(output, /technical diagnostic|技术诊断/i);
    assert.doesNotMatch(output, new RegExp(`/Users|\\.private-fixture|tool-bin|\\.${"env"}|ChildProcess|render\\.js|Error: spawn|stderr token`));
  }
});

test("report output sanitizes source and item paths in JSON and HTML", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "apple-motion-report-"));
  const privateRoot = path.join(tempDir, "Users", "will", ".private-fixture", "demo-project");
  const privateSource = path.join(privateRoot, "client-fixture", "launch clip.mov");
  const privateOutput = path.join(privateRoot, "renders", "launch 3x4.mp4");
  const outputPlan = {
    reportJson: path.join(tempDir, "report.json"),
    reportHtml: path.join(tempDir, "report.html")
  };
  const pathReport = {
    ok: true,
    source: privateSource,
    generatedAt: "2026-06-08T00:00:00.000Z",
    items: [{
      target: "3x4",
      path: privateOutput,
      errors: [],
      warnings: [],
      summary: {}
    }]
  };

  await writeReports(pathReport, outputPlan);
  const json = await readFile(outputPlan.reportJson, "utf8");
  const html = await readFile(outputPlan.reportHtml, "utf8");
  const rendered = renderHtmlReport(pathReport);

  assert.match(json, /launch 3x4\.mp4/);
  for (const output of [json, html, rendered]) {
    assert.match(output, /launch clip\.mov/);
    assert.doesNotMatch(output, new RegExp(escapeRegExp(tempDir)));
    assert.doesNotMatch(output, /\/Users|will|\.private-fixture|client-fixture|demo-project|renders/);
  }
});

test("report output sanitizes URL source and item paths in JSON and HTML", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "apple-motion-report-"));
  const privateRoot = path.join(tempDir, "Users", "will", ".private-fixture", "demo-project");
  const privateSource = path.join(privateRoot, "client-fixture", "launch clip.mov");
  const privateOutput = path.join(privateRoot, "renders", "launch 3x4.mp4");
  const outputPlan = {
    reportJson: path.join(tempDir, "report.json"),
    reportHtml: path.join(tempDir, "report.html")
  };
  const pathReport = {
    ok: true,
    source: pathToFileURL(privateSource),
    generatedAt: "2026-06-08T00:00:00.000Z",
    items: [{
      target: "3x4",
      path: pathToFileURL(privateOutput),
      errors: [],
      warnings: [],
      summary: {}
    }]
  };

  await writeReports(pathReport, outputPlan);
  const json = await readFile(outputPlan.reportJson, "utf8");
  const html = await readFile(outputPlan.reportHtml, "utf8");
  const rendered = renderHtmlReport(pathReport);

  assert.match(json, /launch 3x4\.mp4/);
  for (const output of [json, html, rendered]) {
    assert.match(output, /launch clip\.mov/);
    assert.doesNotMatch(output, new RegExp(escapeRegExp(tempDir)));
    assert.doesNotMatch(output, /%20|file:|\/Users|will|\.private-fixture|client-fixture|demo-project|renders/);
  }
});

test("report output sanitizes Windows and UNC paths in JSON and HTML", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "apple-motion-report-"));
  const outputPlan = {
    reportJson: path.join(tempDir, "report.json"),
    reportHtml: path.join(tempDir, "report.html")
  };
  const pathReport = {
    ok: true,
    source: `${windowsUserRoot}\\.private-fixture\\demo-project\\client-fixture\\launch.mov`,
    generatedAt: "2026-06-08T00:00:00.000Z",
    items: [{
      target: "3x4",
      path: String.raw`\\studio-share\share\.private-fixture\demo-project\renders\launch-3x4.mp4`,
      errors: [],
      warnings: [],
      summary: {}
    }]
  };

  await writeReports(pathReport, outputPlan);
  const json = await readFile(outputPlan.reportJson, "utf8");
  const html = await readFile(outputPlan.reportHtml, "utf8");
  const rendered = renderHtmlReport(pathReport);

  assert.match(json, /launch-3x4\.mp4/);
  for (const output of [json, html, rendered]) {
    assert.match(output, /launch\.mov/);
    assert.doesNotMatch(output, /C:\\|\\\\|studio-share|share|Users|will|\.private-fixture|client-fixture|demo-project|renders/);
  }
});

test("atomic report writes replace existing reports only after new content is ready", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "apple-motion-report-"));
  const outputPlan = {
    reportJson: path.join(tempDir, "report.json"),
    reportHtml: path.join(tempDir, "report.html")
  };
  await writeFile(outputPlan.reportJson, "old json", "utf8");
  await writeFile(outputPlan.reportHtml, "old html", "utf8");

  await writeReports(report, outputPlan);

  assert.notEqual(await readFile(outputPlan.reportJson, "utf8"), "old json");
  assert.notEqual(await readFile(outputPlan.reportHtml, "utf8"), "old html");
});

test("report writes do not replace existing reports without overwrite", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "apple-motion-report-"));
  const outputPlan = {
    reportJson: path.join(tempDir, "report.json"),
    reportHtml: path.join(tempDir, "report.html")
  };
  await writeFile(outputPlan.reportJson, "old json", "utf8");
  await writeFile(outputPlan.reportHtml, "old html", "utf8");

  await assert.rejects(() => writeReports(report, outputPlan, { overwrite: false }), /Report already exists/);
  assert.equal(await readFile(outputPlan.reportJson, "utf8"), "old json");
  assert.equal(await readFile(outputPlan.reportHtml, "utf8"), "old html");
});

test("report writes recover stale overwrite journals before checking existing reports", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "apple-motion-report-"));
  const outputPlan = {
    reportJson: path.join(tempDir, "report.json"),
    reportHtml: path.join(tempDir, "report.html")
  };
  const staleTemp = path.join(tempDir, ".report.json.test.tmp");
  const staleBackup = path.join(tempDir, ".report.json.test.bak");
  const journal = path.join(tempDir, ".openfad-motion-transaction.test.json");
  await writeFile(outputPlan.reportJson, "stale unfinalized json", "utf8");
  await writeFile(journal, JSON.stringify({
    version: 1,
    owner: "openfad-motion-batch",
    token: "test",
    updatedAt: "2000-01-01T00:00:00.000Z",
    final: outputPlan.reportJson,
    temp: staleTemp,
    backup: staleBackup,
    hadExistingFinal: false,
    phase: "ready-to-promote",
    finalized: false
  }));

  await writeReports(report, outputPlan, { overwrite: false });

  assert.match(await readFile(outputPlan.reportJson, "utf8"), /"ok": true/);
  assert.match(await readFile(outputPlan.reportHtml, "utf8"), /Apple Motion QC/);
  assert.equal(await fileExists(journal), false);
});

test("report write failure does not replace an existing JSON report first", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "apple-motion-report-"));
  const outputPlan = {
    reportJson: path.join(tempDir, "report.json"),
    reportHtml: path.join(tempDir, "report.html")
  };
  await writeFile(outputPlan.reportJson, "old json", "utf8");
  await writeFile(outputPlan.reportHtml, "old html", "utf8");

  const brokenReport = {
    ok: true,
    source: "input.mov",
    generatedAt: "2026-06-08T00:00:00.000Z",
    toJSON() {
      return report;
    },
    get items() {
      throw new Error("render failed");
    }
  };

  await assert.rejects(() => writeReports(brokenReport, outputPlan), /render failed/);
  assert.equal(await readFile(outputPlan.reportJson, "utf8"), "old json");
  assert.equal(await readFile(outputPlan.reportHtml, "utf8"), "old html");
});

test("report write failure restores JSON when HTML commit fails", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "apple-motion-report-"));
  const outputPlan = {
    reportJson: path.join(tempDir, "report.json"),
    reportHtml: path.join(tempDir, "report.html")
  };
  await writeFile(outputPlan.reportJson, "old json", "utf8");
  await mkdir(outputPlan.reportHtml);

  await assert.rejects(() => writeReports(report, outputPlan));
  assert.equal(await readFile(outputPlan.reportJson, "utf8"), "old json");
});

test("report writes can be cleaned up by caller before finalization", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "apple-motion-report-"));
  const outputPlan = {
    reportJson: path.join(tempDir, "report.json"),
    reportHtml: path.join(tempDir, "report.html")
  };
  await writeFile(outputPlan.reportJson, "old json", "utf8");
  await writeFile(outputPlan.reportHtml, "old html", "utf8");

  const committedReports = await writeReports(report, outputPlan, { overwrite: true, finalize: false });

  assert.match(await readFile(outputPlan.reportJson, "utf8"), /"ok": true/);
  assert.match(await readFile(outputPlan.reportHtml, "utf8"), /Apple Motion QC/);
  await cleanupCommittedReports(committedReports);
  assert.equal(await readFile(outputPlan.reportJson, "utf8"), "old json");
  assert.equal(await readFile(outputPlan.reportHtml, "utf8"), "old html");
});

test("report finalization removes overwrite rollback journals after success", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "apple-motion-report-"));
  const outputPlan = {
    reportJson: path.join(tempDir, "report.json"),
    reportHtml: path.join(tempDir, "report.html")
  };
  await writeFile(outputPlan.reportJson, "old json", "utf8");
  await writeFile(outputPlan.reportHtml, "old html", "utf8");

  const committedReports = await writeReports(report, outputPlan, { overwrite: true, finalize: false });
  await finalizeCommittedReports(committedReports);
  await cleanupCommittedReports(committedReports);

  const leftovers = (await readdir(tempDir)).filter((name) => {
    return name.includes(".openfad-motion-transaction.") || name.endsWith(".bak") || name.endsWith(".tmp");
  });
  assert.deepEqual(leftovers, []);
  assert.match(await readFile(outputPlan.reportJson, "utf8"), /"ok": true/);
  assert.match(await readFile(outputPlan.reportHtml, "utf8"), /Apple Motion QC/);
});

test("report finalization failure still leaves committed reports rollbackable", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "apple-motion-report-"));
  const outputPlan = {
    reportJson: path.join(tempDir, "report.json"),
    reportHtml: path.join(tempDir, "report.html")
  };
  await writeFile(outputPlan.reportJson, "old json", "utf8");
  await writeFile(outputPlan.reportHtml, "old html", "utf8");
  const committedReports = await writeReports(report, outputPlan, { overwrite: true, finalize: false });
  await rm(committedReports[0].journal, { force: true });
  await mkdir(committedReports[0].journal, { recursive: true });

  await assert.rejects(() => finalizeCommittedReports(committedReports));
  await cleanupCommittedReports(committedReports);

  assert.equal(await readFile(outputPlan.reportJson, "utf8"), "old json");
  assert.equal(await readFile(outputPlan.reportHtml, "utf8"), "old html");
});

test("report caller can finalize deferred report commits", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "apple-motion-report-"));
  const outputPlan = {
    reportJson: path.join(tempDir, "report.json"),
    reportHtml: path.join(tempDir, "report.html")
  };
  await writeFile(outputPlan.reportJson, "old json", "utf8");
  await writeFile(outputPlan.reportHtml, "old html", "utf8");

  const committedReports = await writeReports(report, outputPlan, { overwrite: true, finalize: false });
  await finalizeCommittedReports(committedReports);
  await cleanupCommittedReports(committedReports);

  assert.match(await readFile(outputPlan.reportJson, "utf8"), /"ok": true/);
  assert.match(await readFile(outputPlan.reportHtml, "utf8"), /Apple Motion QC/);
});

test("report writes respect cancellation before committing final reports", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "apple-motion-report-"));
  const outputPlan = {
    reportJson: path.join(tempDir, "report.json"),
    reportHtml: path.join(tempDir, "report.html")
  };
  await writeFile(outputPlan.reportJson, "old json", "utf8");
  await writeFile(outputPlan.reportHtml, "old html", "utf8");
  const controller = new AbortController();
  controller.abort();

  await assert.rejects(() => writeReports(report, outputPlan, { overwrite: true, signal: controller.signal }), /cancelled/i);
  assert.equal(await readFile(outputPlan.reportJson, "utf8"), "old json");
  assert.equal(await readFile(outputPlan.reportHtml, "utf8"), "old html");
});

test("HTML QC report renders a technical summary table", () => {
  const html = renderHtmlReport({
    ok: true,
    source: "input.mov",
    generatedAt: "2026-06-08T00:00:00.000Z",
    items: [{
      target: "3x4",
      path: "output.mov",
      errors: [],
      warnings: [],
      summary: {
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
      }
    }]
  });

  assert.match(html, /Technical Summary/);
  assert.match(html, /<th>Dimensions<\/th>/);
  assert.match(html, /2048x2732/);
  assert.match(html, /15\.1 s/);
  assert.match(html, /30 fps/);
  assert.match(html, /50 Mbps/);
  assert.match(html, /bt709/);
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

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
