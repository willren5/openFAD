import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  buildAtomicOutput,
  cleanupAtomicOutputs,
  cleanupCommittedOutputs,
  commitAtomicOutput,
  finalizeCommittedOutputs,
  recoverOutputTransactions
} from "./atomicOutput.mjs";
import { sanitizeReportIssueMessage } from "./diagnostics.mjs";

export async function writeReports(report, outputPlan, { overwrite = true, finalize = true, signal, excludeJournals = [] } = {}) {
  throwIfAborted(signal);
  const safeReport = sanitizeReport(report);
  const json = `${JSON.stringify(safeReport, null, 2)}\n`;
  const html = renderHtmlReport(safeReport);
  const outputs = [
    buildAtomicOutput(outputPlan.reportJson),
    buildAtomicOutput(outputPlan.reportHtml)
  ];
  const committedOutputs = [];

  await mkdir(path.dirname(outputPlan.reportJson), { recursive: true });
  await recoverOutputTransactions(path.dirname(outputPlan.reportJson), {
    excludeJournals,
    allowedFinals: [outputPlan.reportJson, outputPlan.reportHtml]
  });
  try {
    await writeFile(outputs[0].temp, json, { encoding: "utf8", signal });
    await writeFile(outputs[1].temp, html, { encoding: "utf8", signal });
    for (const output of outputs) {
      throwIfAborted(signal);
      await commitAtomicOutput(output, { overwrite, label: "Report" });
      committedOutputs.push(output);
    }
    throwIfAborted(signal);
    if (finalize) await finalizeCommittedReports(committedOutputs);
    return committedOutputs;
  } catch (error) {
    try {
      await cleanupAtomicOutputs(outputs);
      await cleanupCommittedReports(committedOutputs);
    } catch (cleanupError) {
      throw markReportWriteError(cleanupError);
    }
    throw markReportWriteError(error);
  }
}

function markReportWriteError(error) {
  error.fadAppleMotionErrorKind = "report-write";
  return error;
}

function throwIfAborted(signal) {
  if (!signal?.aborted) return;
  const error = new Error("Report writing was cancelled.");
  error.name = "AbortError";
  error.code = "ABORT_ERR";
  throw error;
}

export function renderHtmlReport(report) {
  const safeReport = sanitizeReport(report);
  const status = safeReport.ok ? "通过 / PASS" : "失败 / FAIL";
  const summaryRows = renderTechnicalSummaryRows(safeReport.items);
  const issues = safeReport.items.flatMap((item) => item.errors.map((error) => ({
    target: item.target,
    severity: "错误 / error",
    message: error
  }))).concat(safeReport.items.flatMap((item) => item.warnings.map((warning) => ({
    target: item.target,
    severity: "警告 / warning",
    message: warning
  }))));

  const rows = issues.length === 0
    ? "<tr><td colspan=\"3\">未发现问题 / No issues found.</td></tr>"
    : issues.map((issue) => {
      return `<tr><td>${escapeHtml(issue.target)}</td><td>${escapeHtml(issue.severity)}</td><td>${escapeHtml(issue.message)}</td></tr>`;
    }).join("\n");

  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <title>Apple Motion QC - ${escapeHtml(status)}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; margin: 32px; color: #1f2328; }
    h1 { font-size: 24px; }
    h2 { font-size: 18px; margin-top: 28px; }
    table { border-collapse: collapse; width: 100%; }
    th, td { border: 1px solid #d0d7de; padding: 8px; text-align: left; }
    .status { font-weight: 700; }
  </style>
</head>
<body>
  <h1>Apple Motion 质检 / Apple Motion QC <span class="status">${escapeHtml(status)}</span></h1>
  <p>来源 / Source: ${escapeHtml(safeReport.source)}</p>
  <h2>技术摘要 / Technical Summary</h2>
  <table>
    <thead><tr><th>目标 / Target</th><th>编码 / Codec</th><th>尺寸 / Dimensions</th><th>时长 / Duration</th><th>帧率 / Frame Rate</th><th>码率 / Bitrate</th><th>色彩空间 / Color Space</th><th>传递函数 / Color Transfer</th><th>色彩原色 / Color Primaries</th></tr></thead>
    <tbody>${summaryRows}</tbody>
  </table>
  <h2>问题 / Issues</h2>
  <table>
    <thead><tr><th>目标 / Target</th><th>级别 / Severity</th><th>说明 / Message</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>
</body>
</html>
`;
}

function sanitizeReport(report) {
  const items = Array.isArray(report?.items) ? report.items : [];
  return {
    ...report,
    source: sanitizeReportPath(report?.source),
    items: items.map((item) => ({
      ...item,
      path: sanitizeReportPath(item?.path),
      errors: sanitizeMessages(item?.errors),
      warnings: sanitizeMessages(item?.warnings)
    }))
  };
}

function sanitizeReportPath(value) {
  if (value == null || value === "") return value;
  if (value instanceof URL) return basenameFromReportPath(value.pathname);
  if (typeof value !== "string") return value;
  return basenameFromReportPath(value);
}

function basenameFromReportPath(value) {
  const normalized = value.replaceAll("\\", "/");
  const parts = normalized.split("/").filter(Boolean);
  const basename = parts.at(-1);
  return basename == null ? "[redacted path]" : decodeReportPathSegment(basename);
}

function decodeReportPathSegment(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function sanitizeMessages(messages) {
  if (!Array.isArray(messages)) return [];
  return messages.map(sanitizeReportIssueMessage).filter(Boolean);
}

function renderTechnicalSummaryRows(items) {
  if (items.length === 0) {
    return "<tr><td colspan=\"9\">暂无技术摘要 / No technical summary available.</td></tr>";
  }

  return items.map((item) => {
    const summary = item.summary ?? {};
    const color = summary.color ?? {};
    return `<tr><td>${escapeHtml(summary.target ?? item.target)}</td><td>${escapeHtml(formatValue(summary.codec))}</td><td>${escapeHtml(formatValue(summary.dimensions))}</td><td>${escapeHtml(formatDuration(summary.durationSeconds))}</td><td>${escapeHtml(formatFrameRate(summary.frameRate))}</td><td>${escapeHtml(formatBitrate(summary.bitrateMbps))}</td><td>${escapeHtml(formatValue(color.color_space))}</td><td>${escapeHtml(formatValue(color.color_transfer))}</td><td>${escapeHtml(formatValue(color.color_primaries))}</td></tr>`;
  }).join("\n");
}

function formatDuration(value) {
  return Number.isFinite(value) ? `${formatNumber(value)} s` : "N/A";
}

function formatFrameRate(value) {
  return Number.isFinite(value) ? `${formatNumber(value)} fps` : "N/A";
}

function formatBitrate(value) {
  return Number.isFinite(value) ? `${formatNumber(value)} Mbps` : "N/A";
}

function formatValue(value) {
  return value == null || value === "" ? "N/A" : value;
}

function formatNumber(value) {
  return Number(value.toFixed(3)).toString();
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;");
}

export async function cleanupCommittedReports(outputs) {
  await cleanupCommittedOutputs(outputs);
}

export async function finalizeCommittedReports(outputs) {
  await finalizeCommittedOutputs(outputs);
}
