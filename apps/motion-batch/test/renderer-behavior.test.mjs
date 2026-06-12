import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import test from "node:test";
import assert from "node:assert/strict";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");
const privateUserRoot = `/${"Users"}/will`;

test("renderer overwrite cancellation preserves the current review surface without confirmed retry", async () => {
  const previousJob = createFinishedJob();
  let confirmCalls = 0;
  const renderer = await loadRenderer({
    confirm: () => {
      confirmCalls += 1;
      return false;
    },
    routes: {
      "GET /api/jobs": { ok: true, jobs: [previousJob] },
      "GET /api/jobs/job-previous?full=1": { ok: true, job: previousJob },
      "POST /api/jobs": {
        ok: false,
        error: "确认覆盖已有输出后会替换 1 个已有输出文件。请复核替换清单后再继续。",
        overwriteConfirmation: {
          required: true,
          token: "confirm-token",
          count: 1,
          replacements: ["report.html"]
        },
        statusCode: 409
      }
    }
  });

  assert.match(renderer.elements.queueBody.innerHTML, /old\.mov/);
  assert.match(renderer.elements.qcIssues.innerHTML, /边缘安全区/);

  renderer.elements.inputPath.value = "/work/new.mov";
  renderer.elements.outDir.value = "/work/out";
  renderer.elements.overwrite.checked = true;
  renderer.submitForm();
  await renderer.flush();

  assert.equal(confirmCalls, 0);
  assert.equal(renderer.elements.overwriteDialog.hidden, false);
  assert.match(renderer.elements.overwriteDialogSummary.textContent, /1 个已有输出文件/);
  assert.match(renderer.elements.overwriteDialogList.innerHTML, /report\.html/);
  assert.doesNotMatch(renderer.elements.overwriteDialogList.innerHTML, /\/work\/out|\/Users|\/var|\/tmp/);
  renderer.elements.overwriteCancelButton.dispatchEvent(new FakeEvent("click"));
  await renderer.flush();

  assert.equal(renderer.calls.filter((call) => call.method === "POST" && call.url === "/api/jobs").length, 1);
  assert.equal(renderer.calls.some((call) => call.body?.overwriteConfirmationToken), false);
  assert.equal(renderer.elements.overwriteDialog.hidden, true);
  assert.match(renderer.elements.queueBody.innerHTML, /old\.mov/);
  assert.match(renderer.elements.qcIssues.innerHTML, /边缘安全区/);
  assert.doesNotMatch(renderer.elements.jobLog.textContent, /正在检查输入和输出路径/);
});

test("renderer confirms exact overwrite replacements before retrying job creation", async () => {
  const activeJob = createRunningJob();
  let confirmCalls = 0;
  const renderer = await loadRenderer({
    confirm: () => {
      confirmCalls += 1;
      return true;
    },
    routes: {
      "POST /api/jobs": ({ body, calls }) => {
        if (!body.overwriteConfirmationToken) {
          return {
            ok: false,
            error: "确认覆盖已有输出后会替换 2 个已有输出文件。请复核替换清单后再继续。",
            overwriteConfirmation: {
              required: true,
              token: "confirm-token",
              count: 2,
              replacements: [
                "cover__apple-motion-3x4-preview.png",
                "cover__apple-motion-qc.html"
              ]
            },
            statusCode: 409
          };
        }
        assert.equal(body.overwriteConfirmationToken, "confirm-token");
        assert.equal(calls.filter((call) => call.method === "POST" && call.url === "/api/jobs").length, 2);
        return { ok: true, job: activeJob };
      },
      "GET /api/jobs/job-active/poll": { ok: true, job: activeJob }
    }
  });

  renderer.elements.inputPath.value = "/work/active.mov";
  renderer.elements.outDir.value = "/work/out";
  renderer.elements.overwrite.checked = true;
  renderer.submitForm();
  await renderer.flush();

  assert.equal(confirmCalls, 0);
  assert.equal(renderer.elements.overwriteDialog.hidden, false);
  assert.match(renderer.elements.overwriteDialogSummary.textContent, /2 个已有输出文件/);
  assert.match(renderer.elements.overwriteDialogList.innerHTML, /3x4-preview\.png/);
  assert.match(renderer.elements.overwriteDialogList.innerHTML, /qc\.html/);
  assert.doesNotMatch(renderer.elements.overwriteDialogList.innerHTML, /\/work\/out|\/Users|\/var|\/tmp/);
  renderer.elements.overwriteConfirmButton.dispatchEvent(new FakeEvent("click"));
  await renderer.flush();

  assert.equal(renderer.calls.filter((call) => call.method === "POST" && call.url === "/api/jobs").length, 2);
  assert.equal(renderer.elements.overwriteDialog.hidden, true);
  assert.match(renderer.elements.queueBody.innerHTML, /active\.mov/);
});

test("renderer stop aborts a pending overwrite confirmation dialog", async () => {
  const renderer = await loadRenderer({
    confirm: () => {
      throw new Error("native confirm should not be used");
    },
    routes: {
      "POST /api/jobs": {
        ok: false,
        error: "确认覆盖已有输出后会替换 1 个已有输出文件。请复核替换清单后再继续。",
        overwriteConfirmation: {
          required: true,
          token: "confirm-token",
          count: 1,
          replacements: ["/work/out/cover__apple-motion-qc.html"]
        },
        statusCode: 409
      }
    }
  });

  renderer.elements.inputPath.value = "/work/active.mov";
  renderer.elements.outDir.value = "/work/out";
  renderer.elements.overwrite.checked = true;
  renderer.submitForm();
  await renderer.flush();

  assert.equal(renderer.elements.overwriteDialog.hidden, false);
  assert.equal(renderer.elements.stopButton.disabled, false);

  renderer.elements.stopButton.dispatchEvent(new FakeEvent("click"));
  await renderer.flush();

  assert.equal(renderer.elements.overwriteDialog.hidden, true);
  assert.equal(renderer.calls.filter((call) => call.method === "POST" && call.url === "/api/jobs").length, 1);
  assert.equal(renderer.calls.some((call) => call.body?.overwriteConfirmationToken), false);
  assert.equal(renderer.elements.stopButton.disabled, true);
});

test("renderer traps keyboard focus inside overwrite confirmation", async () => {
  const renderer = await loadRenderer({
    routes: {
      "POST /api/jobs": {
        ok: false,
        error: "确认覆盖已有输出后会替换 1 个已有输出文件。请复核替换清单后再继续。",
        overwriteConfirmation: {
          required: true,
          token: "confirm-token",
          count: 1,
          replacements: ["/work/out/cover__apple-motion-qc.html"]
        },
        statusCode: 409
      }
    }
  });

  renderer.elements.inputPath.value = "/work/active.mov";
  renderer.elements.outDir.value = "/work/out";
  renderer.elements.overwrite.checked = true;
  renderer.submitForm();
  await renderer.flush();

  assert.equal(renderer.elements.overwriteDialog.hidden, false);
  assert.equal(renderer.document.activeElement, renderer.elements.overwriteCancelButton);

  renderer.elements.overwriteCancelButton.dispatchEvent(new FakeEvent("keydown", {
    key: "Tab",
    shiftKey: true,
    bubbles: true,
    target: renderer.elements.overwriteCancelButton
  }));
  assert.equal(renderer.document.activeElement, renderer.elements.overwriteConfirmButton);

  renderer.elements.overwriteConfirmButton.dispatchEvent(new FakeEvent("keydown", {
    key: "Tab",
    bubbles: true,
    target: renderer.elements.overwriteConfirmButton
  }));
  assert.equal(renderer.document.activeElement, renderer.elements.overwriteCancelButton);
});

test("renderer pulls escaped focus back into overwrite confirmation", async () => {
  const renderer = await loadRenderer({
    routes: {
      "POST /api/jobs": {
        ok: false,
        error: "确认覆盖已有输出后会替换 1 个已有输出文件。请复核替换清单后再继续。",
        overwriteConfirmation: {
          required: true,
          token: "confirm-token",
          count: 1,
          replacements: ["/work/out/cover__apple-motion-qc.html"]
        },
        statusCode: 409
      }
    }
  });

  renderer.elements.inputPath.value = "/work/active.mov";
  renderer.elements.outDir.value = "/work/out";
  renderer.elements.overwrite.checked = true;
  renderer.submitForm();
  await renderer.flush();

  assert.equal(renderer.elements.overwriteDialog.hidden, false);
  renderer.elements.inputPath.focus();
  const activeAfterEscape = renderer.document.activeElement;
  renderer.elements.overwriteCancelButton.dispatchEvent(new FakeEvent("click"));
  await renderer.flush();

  assert.equal(activeAfterEscape?.id, "overwriteCancelButton");
});

test("renderer restores keyboard focus after cancelling overwrite confirmation", async () => {
  const renderer = await loadRenderer({
    routes: {
      "POST /api/jobs": {
        ok: false,
        error: "确认覆盖已有输出后会替换 1 个已有输出文件。请复核替换清单后再继续。",
        overwriteConfirmation: {
          required: true,
          token: "confirm-token",
          count: 1,
          replacements: ["/work/out/cover__apple-motion-qc.html"]
        },
        statusCode: 409
      }
    }
  });

  renderer.elements.inputPath.value = "/work/active.mov";
  renderer.elements.outDir.value = "/work/out";
  renderer.elements.overwrite.checked = true;
  renderer.elements.startButton.focus();
  renderer.elements.startButton.dispatchEvent(new FakeEvent("click"));
  await renderer.flush();

  assert.equal(renderer.elements.overwriteDialog.hidden, false);
  assert.equal(renderer.document.activeElement, renderer.elements.overwriteCancelButton);

  renderer.elements.overwriteCancelButton.dispatchEvent(new FakeEvent("click"));
  await renderer.flush();

  assert.equal(renderer.elements.startButton.disabled, false);
  assert.equal(renderer.document.activeElement, renderer.elements.startButton);
});

test("renderer pulls escaped focus back into clear-history confirmation", async () => {
  const renderer = await loadRenderer({
    routes: {
      "GET /api/jobs": { ok: true, jobs: [createFinishedJob()] },
      "GET /api/jobs/job-previous?full=1": { ok: true, job: createFinishedJob() }
    }
  });

  await openClearHistoryDialog(renderer);
  renderer.elements.inputPath.focus();
  const activeAfterEscape = renderer.document.activeElement;
  renderer.elements.clearHistoryCancelButton.dispatchEvent(new FakeEvent("click"));
  await renderer.flush();

  assert.equal(activeAfterEscape?.id, "clearHistoryCancelButton");
});

test("renderer clears stale review state and announces preflight while job creation is pending", async () => {
  const previousJob = createFinishedJob();
  const renderer = await loadRenderer({
    routes: {
      "GET /api/jobs": { ok: true, jobs: [previousJob] },
      "GET /api/jobs/job-previous?full=1": { ok: true, job: previousJob },
      "POST /api/jobs": () => new Promise(() => {})
    }
  });

  assert.match(renderer.elements.queueBody.innerHTML, /old\.mov/);
  assert.match(renderer.elements.qcIssues.innerHTML, /边缘安全区/);
  assert.equal(renderer.elements.revealReportButton.disabled, false);

  renderer.elements.inputPath.value = "/work/new.mov";
  renderer.elements.outDir.value = "/work/out";
  renderer.submitForm();

  assert.doesNotMatch(renderer.elements.queueBody.innerHTML, /old\.mov/);
  assert.match(renderer.elements.queueBody.innerHTML, /暂无批处理任务/);
  assert.equal(renderer.elements.revealReportButton.disabled, true);
  assert.equal(renderer.elements.jobBadge.textContent, "检查中");
  assert.match(renderer.elements.jobStatusAnnouncer.textContent, /正在检查输入和输出路径/);
});

test("renderer lets Stop abort a pending job creation request", async () => {
  const previousJob = createFinishedJob();
  let createSignal;
  const renderer = await loadRenderer({
    routes: {
      "GET /api/jobs": { ok: true, jobs: [previousJob] },
      "GET /api/jobs/job-previous?full=1": { ok: true, job: previousJob },
      "POST /api/jobs": ({ signal }) => {
        createSignal = signal;
        return new Promise((_resolve, reject) => {
          signal.addEventListener("abort", () => {
            const error = new Error("The operation was aborted.");
            error.name = "AbortError";
            reject(error);
          });
        });
      }
    }
  });

  renderer.elements.inputPath.value = "/work/new.mov";
  renderer.elements.outDir.value = "/work/out";
  renderer.submitForm();

  assert.equal(renderer.elements.stopButton.disabled, false);
  renderer.elements.stopButton.dispatchEvent(new FakeEvent("click"));
  await renderer.flush();

  assert.equal(createSignal.aborted, true);
  assert.match(renderer.elements.queueBody.innerHTML, /old\.mov/);
  assert.doesNotMatch(renderer.elements.jobLog.textContent, /The operation was aborted/);
  assert.match(renderer.elements.toast.textContent, /已停止检查/);
  assert.match(renderer.elements.jobStatusAnnouncer.textContent, /已停止检查/);
});

test("renderer times out pending job creation when the local API never settles", async () => {
  const previousJob = createFinishedJob();
  let createSignal;
  const renderer = await loadRenderer({
    routes: {
      "GET /api/jobs": { ok: true, jobs: [previousJob] },
      "GET /api/jobs/job-previous?full=1": { ok: true, job: previousJob },
      "POST /api/jobs": ({ signal }) => {
        createSignal = signal;
        return new Promise((_resolve, reject) => {
          signal.addEventListener("abort", () => {
            const error = new Error("The operation was aborted.");
            error.name = "AbortError";
            reject(error);
          });
        });
      }
    }
  });

  renderer.elements.inputPath.value = "/work/new.mov";
  renderer.elements.outDir.value = "/work/out";
  renderer.submitForm();
  await renderer.flush();

  assert.equal(renderer.elements.startButton.disabled, true);
  assert.equal(renderer.elements.dryRunButton.disabled, true);
  assert.equal(renderer.elements.stopButton.disabled, false);
  assert.equal(Boolean(createSignal?.aborted), false);

  await renderer.runLastTimer();

  assert.equal(createSignal.aborted, true);
  assert.match(renderer.elements.queueBody.innerHTML, /old\.mov/);
  assert.match(renderer.elements.errorPanel.textContent, /本地桥接请求没有响应/);
  assert.match(renderer.elements.toast.textContent, /本地桥接请求没有响应/);
  assert.equal(renderer.elements.startButton.disabled, false);
  assert.equal(renderer.elements.dryRunButton.disabled, false);
  assert.equal(renderer.elements.stopButton.disabled, true);
});

test("renderer blocks history clearing while job creation is pending", async () => {
  const previousJob = createFinishedJob();
  let createSignal;
  const renderer = await loadRenderer({
    routes: {
      "GET /api/jobs": { ok: true, jobs: [previousJob] },
      "GET /api/jobs/job-previous?full=1": { ok: true, job: previousJob },
      "POST /api/jobs": ({ signal }) => {
        createSignal = signal;
        return new Promise((_resolve, reject) => {
          signal.addEventListener("abort", () => {
            const error = new Error("The operation was aborted.");
            error.name = "AbortError";
            reject(error);
          });
        });
      },
      "DELETE /api/jobs/history": { ok: true, cleared: 1, jobs: [] }
    }
  });

  renderer.elements.inputPath.value = "/work/new.mov";
  renderer.elements.outDir.value = "/work/out";
  renderer.submitForm();

  assert.equal(renderer.elements.stopButton.disabled, false);
  assert.equal(renderer.elements.clearHistoryButton.disabled, true);

  renderer.elements.clearHistoryButton.dispatchEvent(new FakeEvent("click"));
  await renderer.flush();

  assert.equal(renderer.calls.some((call) => call.method === "DELETE" && call.url === "/api/jobs/history"), false);
  assert.equal(renderer.elements.stopButton.disabled, false);
  renderer.elements.stopButton.dispatchEvent(new FakeEvent("click"));
  await renderer.flush();

  assert.equal(createSignal.aborted, true);
  assert.match(renderer.elements.queueBody.innerHTML, /old\.mov/);
  assert.match(renderer.elements.toast.textContent, /已停止检查/);
  assert.match(renderer.elements.jobStatusAnnouncer.textContent, /已停止检查/);
});

test("renderer keeps newly created job context when the first poll fails", async () => {
  const activeJob = createRunningJob();
  const renderer = await loadRenderer({
    routes: {
      "POST /api/jobs": { ok: true, job: activeJob },
      "GET /api/jobs/job-active/poll": {
        ok: false,
        error: "本地桥接暂时不可用。",
        statusCode: 500
      }
    }
  });

  renderer.elements.inputPath.value = "/work/active.mov";
  renderer.elements.outDir.value = "/work/out";
  renderer.submitForm();
  await renderer.flush();

  assert.equal(renderer.elements.stopButton.disabled, false);
  assert.match(renderer.elements.queueBody.innerHTML, /active\.mov/);
  assert.match(renderer.elements.jobBadge.textContent, /处理中/);
  assert.match(renderer.elements.errorPanel.textContent, /连接中断/);
  assert.equal(renderer.lastTimer?.kind, "timeout");
});

test("renderer resumes normal polling when Stop succeeds during a poll retry window", async () => {
  const activeJob = createRunningJob();
  let pollCalls = 0;
  const renderer = await loadRenderer({
    routes: {
      "GET /api/jobs": { ok: true, jobs: [activeJob] },
      "GET /api/jobs/job-active/poll": () => {
        pollCalls += 1;
        if (pollCalls === 1) {
          return {
            ok: false,
            error: "本地桥接暂时不可用。",
            statusCode: 500
          };
        }
        return { ok: true, job: activeJob };
      },
      "POST /api/jobs/job-active/cancel": { ok: true, job: activeJob }
    }
  });

  assert.equal(renderer.lastTimer?.kind, "timeout");
  renderer.elements.stopButton.dispatchEvent(new FakeEvent("click"));
  await renderer.flush();

  assert.equal(pollCalls, 2);
  assert.equal(renderer.lastTimer?.kind, "interval");
});

test("renderer lets new jobs start while final detail retry runs in the background", async () => {
  const activeJob = createRunningJob({ id: "job-final-detail" });
  const finalSnapshot = {
    ...createTwoItemFinishedJob(),
    id: "job-final-detail",
    items: [],
    itemsOffset: 2,
    totalItems: 2
  };
  const fullDetail = {
    ...createTwoItemFinishedJob(),
    id: "job-final-detail"
  };
  let fullDetailCalls = 0;
  const renderer = await loadRenderer({
    routes: {
      "GET /api/jobs": { ok: true, jobs: [activeJob] },
      "GET /api/jobs/job-final-detail/poll": { ok: true, job: finalSnapshot },
      "GET /api/jobs/job-final-detail?full=1": () => {
        fullDetailCalls += 1;
        if (fullDetailCalls === 1) {
          return {
            ok: false,
            error: "完整任务记录暂时不可用。",
            statusCode: 500
          };
        }
        return { ok: true, job: fullDetail };
      }
    }
  });

  assert.equal(fullDetailCalls, 1);
  assert.equal(renderer.lastTimer?.kind, "timeout");
  assert.match(renderer.elements.errorPanel.textContent, /完整报告暂时无法加载/);
  assert.equal(renderer.elements.startButton.disabled, false);
  assert.equal(renderer.elements.dryRunButton.disabled, false);
  assert.equal(renderer.elements.clearHistoryButton.disabled, false);
  assert.equal(renderer.elements.stopButton.disabled, true);

  await renderer.runLastTimer();

  assert.equal(fullDetailCalls, 2);
  assert.equal(renderer.elements.startButton.disabled, false);
  assert.equal(renderer.elements.dryRunButton.disabled, false);
  assert.equal(renderer.elements.clearHistoryButton.disabled, false);
  assert.equal(renderer.elements.stopButton.disabled, true);
  assert.equal(renderer.elements.errorPanel.hidden, true);
});

test("renderer gives immediate feedback and blocks duplicate Stop while cancel is pending", async () => {
  const activeJob = createRunningJob();
  const renderer = await loadRenderer({
    routes: {
      "GET /api/jobs": { ok: true, jobs: [activeJob] },
      "GET /api/jobs/job-active/poll": { ok: true, job: activeJob },
      "POST /api/jobs/job-active/cancel": () => new Promise(() => {})
    }
  });

  renderer.elements.stopButton.dispatchEvent(new FakeEvent("click"));
  await renderer.flush();

  assert.match(renderer.elements.toast.textContent, /正在停止/);
  assert.match(renderer.elements.jobStatusAnnouncer.textContent, /正在停止/);
  assert.equal(renderer.elements.stopButton.disabled, true);

  renderer.elements.stopButton.dispatchEvent(new FakeEvent("click"));
  await renderer.flush();

  assert.equal(
    renderer.calls.filter((call) => call.method === "POST" && call.url === "/api/jobs/job-active/cancel").length,
    1
  );
});

test("renderer recovers controls when a Stop request times out", async () => {
  const activeJob = createRunningJob();
  const renderer = await loadRenderer({
    routes: {
      "GET /api/jobs": { ok: true, jobs: [activeJob] },
      "GET /api/jobs/job-active/poll": { ok: true, job: activeJob },
      "POST /api/jobs/job-active/cancel": ({ signal }) => new Promise((_resolve, reject) => {
        signal?.addEventListener("abort", () => {
          const error = new Error("The operation was aborted.");
          error.name = "AbortError";
          reject(error);
        });
      })
    }
  });

  renderer.elements.stopButton.dispatchEvent(new FakeEvent("click"));
  await renderer.flush();

  assert.equal(renderer.elements.stopButton.disabled, true);
  assert.equal(renderer.calls.find((call) => call.url === "/api/jobs/job-active/cancel")?.signal?.aborted, false);

  await renderer.runLastTimer();

  assert.match(renderer.elements.toast.textContent, /停止请求没有响应/);
  assert.match(renderer.elements.errorPanel.textContent, /停止请求没有响应/);
  assert.equal(renderer.elements.stopButton.disabled, false);
  assert.equal(renderer.calls.find((call) => call.url === "/api/jobs/job-active/cancel")?.signal?.aborted, true);
});

test("renderer logs ordinary Stop request failures for later diagnosis", async () => {
  const activeJob = createRunningJob();
  const renderer = await loadRenderer({
    routes: {
      "GET /api/jobs": { ok: true, jobs: [activeJob] },
      "GET /api/jobs/job-active/poll": { ok: true, job: activeJob },
      "POST /api/jobs/job-active/cancel": {
        ok: false,
        error: "本地桥接拒绝停止请求。",
        statusCode: 503
      }
    }
  });

  renderer.elements.stopButton.dispatchEvent(new FakeEvent("click"));
  await renderer.flush();

  assert.match(renderer.elements.toast.textContent, /本地桥接拒绝停止请求/);
  assert.match(renderer.elements.errorPanel.textContent, /本地桥接拒绝停止请求/);
  assert.match(renderer.elements.jobLog.textContent, /本地桥接拒绝停止请求/);
  assert.equal(renderer.elements.stopButton.disabled, false);
});

test("renderer resets submit controls and restores review after job creation persistence failures", async () => {
  const previousJob = createFinishedJob();
  const renderer = await loadRenderer({
    routes: {
      "GET /api/jobs": { ok: true, jobs: [previousJob] },
      "GET /api/jobs/job-previous?full=1": { ok: true, job: previousJob },
      "POST /api/jobs": {
        ok: false,
        error: "任务恢复记录暂时无法写入。请确认应用数据目录可写后重试。",
        persistence: {
          configured: true,
          ok: false,
          error: "任务恢复记录暂时无法写入。请确认应用数据目录可写后重试。"
        },
        statusCode: 500
      }
    }
  });

  renderer.elements.inputPath.value = "/work/new.mov";
  renderer.elements.outDir.value = "/work/out";
  renderer.submitForm();
  await renderer.flush();

  assert.equal(renderer.elements.startButton.disabled, false);
  assert.equal(renderer.elements.dryRunButton.disabled, false);
  assert.equal(renderer.elements.stopButton.disabled, true);
  assert.match(renderer.elements.queueBody.innerHTML, /old\.mov/);
  assert.match(renderer.elements.qcIssues.innerHTML, /边缘安全区/);
  assert.match(renderer.elements.errorPanel.textContent, /任务恢复记录暂时无法写入/);
  assert.equal(countOccurrences(renderer.elements.errorPanel.textContent, "任务恢复记录暂时无法写入"), 1);
});

test("renderer resets submit controls after job creation transport failures", async () => {
  const previousJob = createFinishedJob();
  const errors = [];
  const renderer = await loadRenderer({
    testConsole: {
      ...console,
      error: (...args) => errors.push(args)
    },
    routes: {
      "GET /api/jobs": { ok: true, jobs: [previousJob] },
      "GET /api/jobs/job-previous?full=1": { ok: true, job: previousJob },
      "POST /api/jobs": () => {
        throw new TypeError("Failed to fetch");
      }
    }
  });

  renderer.elements.inputPath.value = "/work/new.mov";
  renderer.elements.outDir.value = "/work/out";
  renderer.submitForm();
  await renderer.flush();

  assert.equal(renderer.elements.startButton.disabled, false);
  assert.equal(renderer.elements.dryRunButton.disabled, false);
  assert.equal(renderer.elements.stopButton.disabled, true);
  assert.match(renderer.elements.queueBody.innerHTML, /old\.mov/);
  assert.match(renderer.elements.errorPanel.textContent, /本地桥接/);
  assert.doesNotMatch(renderer.elements.errorPanel.textContent, /Failed to fetch|Load failed|NetworkError/);
  assert.doesNotMatch(renderer.elements.toast.textContent, /Failed to fetch|Load failed|NetworkError/);
  assert.equal(errors.length, 1);
  assert.doesNotMatch(flattenConsoleArgs(errors), /Failed to fetch|\/Users\/|ui\/public\/app\.js/);
});

test("renderer hides malformed API parse diagnostics from browser console", async () => {
  const errors = [];
  const renderer = await loadRenderer({
    testConsole: {
      ...console,
      error: (...args) => errors.push(args)
    },
    routes: {
      "GET /api/health": {
        rawText: `<html>SyntaxError ${privateUserRoot}/private/app.js</html>`,
        statusCode: 502
      }
    }
  });

  assert.equal(renderer.elements.errorPanel.hidden, false);
  assert.match(renderer.elements.errorPanel.textContent, /本地桥接返回了无法识别的响应/);
  assert.equal(errors.length, 1);
  assert.doesNotMatch(flattenConsoleArgs(errors), /SyntaxError|\/Users\/|ui\/public\/app\.js/);
});

test("renderer sanitizes raw API errors before showing them to users", async () => {
  const rawError = `Error: spawn ${privateUserRoot}/.private-fixture/tool-bin/ffmpeg\n    at ChildProcess.<anonymous> (${privateUserRoot}/private/app.js:42:7)`;
  const renderer = await loadRenderer({
    routes: {
      "POST /api/jobs": {
        ok: false,
        error: rawError,
        statusCode: 500
      }
    }
  });

  renderer.elements.inputPath.value = "/work/new.mov";
  renderer.elements.outDir.value = "/work/out";
  renderer.submitForm();
  await renderer.flush();

  const userText = [
    renderer.elements.errorPanel.textContent,
    renderer.elements.toast.textContent,
    renderer.elements.jobLog.textContent
  ].join("\n");
  assert.match(userText, /本地桥接返回了未脱敏的技术错误/);
  assert.doesNotMatch(userText, /\/Users\/will|\.private-fixture|tool-bin|ChildProcess|app\.js:42|Error: spawn/);
});

test("renderer sanitizes private Unix-style local paths in API errors", async () => {
  const rawError = "请求失败：/private/var/folders/56/client-fixture/render.mov 无法读取；/Volumes/Client Secret/cover.mov 也不可访问。";
  const renderer = await loadRenderer({
    routes: {
      "POST /api/jobs": {
        ok: false,
        error: rawError,
        statusCode: 400
      }
    }
  });

  renderer.elements.inputPath.value = "/work/new.mov";
  renderer.elements.outDir.value = "/work/out";
  renderer.submitForm();
  await renderer.flush();

  const userText = [
    renderer.elements.errorPanel.textContent,
    renderer.elements.toast.textContent,
    renderer.elements.jobLog.textContent
  ].join("\n");
  assert.match(userText, /本地桥接返回了未脱敏的技术错误/);
  assert.doesNotMatch(userText, /\/private\/var|\/Volumes|Client Secret|client-fixture|render\.mov|cover\.mov/);
});

test("renderer sanitizes sticky persistence errors before showing them to users", async () => {
  const rawPersistenceError = `Error: EACCES ${privateUserRoot}/.private-fixture/tool-bin/store.json`;
  const renderer = await loadRenderer({
    routes: {
      "POST /api/jobs": {
        ok: false,
        error: "任务恢复记录暂时无法写入。请确认应用数据目录可写后重试。",
        persistence: {
          configured: true,
          ok: false,
          error: rawPersistenceError
        },
        statusCode: 500
      }
    }
  });

  renderer.elements.inputPath.value = "/work/new.mov";
  renderer.elements.outDir.value = "/work/out";
  renderer.submitForm();
  await renderer.flush();

  const userText = [
    renderer.elements.errorPanel.textContent,
    renderer.elements.toast.textContent,
    renderer.elements.jobLog.textContent
  ].join("\n");
  assert.match(userText, /任务恢复记录无法写入/);
  assert.match(userText, /本地桥接返回了未脱敏的技术错误/);
  assert.doesNotMatch(userText, /\/Users\/will|\.private-fixture|tool-bin|EACCES|store\.json/);
});

test("renderer native picker failure disables concurrent pickers and persists the failure message", async () => {
  let resolvePicker;
  const pickerCalls = [];
  const renderer = await loadRenderer({
    native: {
      pickPath: (payload) => {
        pickerCalls.push(payload);
        return new Promise((resolve) => {
          resolvePicker = resolve;
        });
      }
    }
  });

  const pickerButtons = renderer.document.querySelectorAll("[data-picker]");
  pickerButtons[0].dispatchEvent(new FakeEvent("click"));

  assert.equal(pickerCalls.length, 1);
  assert.equal(pickerCalls[0].kind, "inputFile");
  assert.equal(pickerButtons.every((button) => button.disabled), true);

  pickerButtons[1].dispatchEvent(new FakeEvent("click"));
  assert.equal(pickerCalls.length, 1);

  resolvePicker({ canceled: true, path: "", error: "系统路径选择器不可用" });
  await renderer.flush();

  assert.equal(pickerButtons.every((button) => !button.disabled), true);
  assert.equal(renderer.elements.errorPanel.hidden, false);
  assert.match(renderer.elements.errorPanel.textContent, /系统路径选择器不可用/);
  assert.match(renderer.elements.jobLog.textContent, /系统路径选择器不可用/);
  assert.match(renderer.elements.toast.textContent, /系统路径选择器不可用/);
});

test("renderer announces browser-mode picker guidance beyond visual toast", async () => {
  const renderer = await loadRenderer();
  const [inputFileButton] = renderer.document.querySelectorAll("[data-picker]");

  inputFileButton.dispatchEvent(new FakeEvent("click"));
  await renderer.flush();

  assert.equal(renderer.document.activeElement, renderer.elements.inputPath);
  assert.match(renderer.elements.toast.textContent, /浏览器模式请粘贴路径/);
  assert.match(renderer.elements.jobStatusAnnouncer.textContent, /浏览器模式请粘贴路径/);
});

test("renderer sanitizes raw native picker failures before display", async () => {
  const rawError = `Error: EACCES ${privateUserRoot}/.private-fixture/tool-bin.mov\n    at pickPath (${privateUserRoot}/app/native.cjs:9:1)`;
  const renderer = await loadRenderer({
    native: {
      pickPath: () => ({ canceled: false, path: "", error: rawError })
    }
  });
  const [inputFileButton] = renderer.document.querySelectorAll("[data-picker]");

  inputFileButton.dispatchEvent(new FakeEvent("click"));
  await renderer.flush();

  const userText = [
    renderer.elements.errorPanel.textContent,
    renderer.elements.toast.textContent,
    renderer.elements.jobLog.textContent
  ].join("\n");
  assert.match(userText, /本地桥接返回了未脱敏的技术错误/);
  assert.doesNotMatch(userText, /\/Users\/will|\.private-fixture|tool-bin|EACCES|native\.cjs|pickPath|Error:/);
});

test("renderer clears stale picker errors after a later native picker success", async () => {
  const pickerResults = [
    { canceled: false, path: "", error: "系统路径选择器不可用" },
    { canceled: false, path: "/work/recovered.mov" }
  ];
  const renderer = await loadRenderer({
    native: {
      pickPath: () => pickerResults.shift()
    }
  });
  const [inputFileButton] = renderer.document.querySelectorAll("[data-picker]");

  inputFileButton.dispatchEvent(new FakeEvent("click"));
  await renderer.flush();
  assert.match(renderer.elements.errorPanel.textContent, /系统路径选择器不可用/);

  inputFileButton.dispatchEvent(new FakeEvent("click"));
  await renderer.flush();

  assert.equal(renderer.elements.inputPath.value, "/work/recovered.mov");
  assert.equal(renderer.elements.errorPanel.hidden, true);
  assert.equal(renderer.elements.errorPanel.textContent, "");
});

test("renderer resolves Electron dropped files through the native file-path bridge", async () => {
  const droppedFile = { name: "cover.mov" };
  const bridgeCalls = [];
  const renderer = await loadRenderer({
    native: {
      getPathForFile: (file) => {
        bridgeCalls.push(file);
        return "/work/cover.mov";
      }
    }
  });

  renderer.elements.dropZone.dispatchEvent(new FakeEvent("drop", {
    dataTransfer: { files: [droppedFile] }
  }));
  await renderer.flush();

  assert.deepEqual(bridgeCalls, [droppedFile]);
  assert.equal(renderer.elements.inputPath.value, "/work/cover.mov");
  assert.equal(renderer.elements.errorPanel.hidden, true);
});

test("renderer rejects multi-file drops instead of silently using the first file", async () => {
  const renderer = await loadRenderer({
    native: {
      getPathForFile: () => "/work/first.mov"
    }
  });

  renderer.elements.dropZone.dispatchEvent(new FakeEvent("drop", {
    dataTransfer: {
      files: [
        { name: "first.mov", path: "/work/first.mov" },
        { name: "second.mov", path: "/work/second.mov" }
      ]
    }
  }));
  await renderer.flush();

  assert.equal(renderer.elements.inputPath.value, "");
  assert.equal(renderer.elements.errorPanel.hidden, false);
  assert.match(renderer.elements.errorPanel.textContent, /一次只能拖入一个文件或文件夹/);
  assert.match(renderer.elements.jobLog.textContent, /一次只能拖入一个文件或文件夹/);
});

test("renderer preserves a manually entered output folder when slow defaults arrive later", async () => {
  let resolveSpec;
  const renderer = await loadRenderer({
    routes: {
      "GET /api/spec": () => new Promise((resolve) => {
        resolveSpec = resolve;
      })
    }
  });

  assert.equal(renderer.calls.some((call) => call.method === "GET" && call.url === "/api/spec"), true);

  renderer.elements.outDir.value = "/manual/out";
  renderer.elements.outDir.dispatchEvent(new FakeEvent("input", { bubbles: true }));

  resolveSpec({
    ok: true,
    defaults: {
      outDir: "/server/default/out"
    }
  });
  await renderer.flush();

  assert.equal(renderer.elements.outDir.value, "/manual/out");
});

test("renderer clears stale reveal errors after a later reveal success", async () => {
  const job = createFinishedJob();
  let revealCalls = 0;
  const renderer = await loadRenderer({
    routes: {
      "GET /api/jobs": { ok: true, jobs: [job] },
      "GET /api/jobs/job-previous?full=1": { ok: true, job },
      "POST /api/reveal": () => {
        revealCalls += 1;
        if (revealCalls === 1) {
          return {
            ok: false,
            error: "无法打开系统文件管理器。",
            statusCode: 500
          };
        }
        return { ok: true };
      }
    }
  });

  renderer.elements.revealReportButton.dispatchEvent(new FakeEvent("click"));
  await renderer.flush();
  assert.match(renderer.elements.errorPanel.textContent, /无法打开系统文件管理器/);

  renderer.elements.revealReportButton.dispatchEvent(new FakeEvent("click"));
  await renderer.flush();

  assert.equal(revealCalls, 2);
  assert.equal(renderer.elements.errorPanel.hidden, true);
  assert.equal(renderer.elements.errorPanel.textContent, "");
});

test("renderer serializes reveal requests while the file manager launch is pending", async () => {
  const job = createFinishedJob();
  let revealCalls = 0;
  let resolveReveal;
  const revealPromise = new Promise((resolve) => {
    resolveReveal = resolve;
  });
  const renderer = await loadRenderer({
    routes: {
      "GET /api/jobs": { ok: true, jobs: [job] },
      "GET /api/jobs/job-previous?full=1": { ok: true, job },
      "POST /api/reveal": () => {
        revealCalls += 1;
        return revealPromise;
      }
    }
  });

  assert.equal(renderer.elements.revealReportButton.disabled, false);
  renderer.elements.revealReportButton.dispatchEvent(new FakeEvent("click"));
  renderer.elements.revealReportButton.dispatchEvent(new FakeEvent("click"));
  await renderer.flush();

  assert.equal(revealCalls, 1);
  assert.equal(renderer.elements.revealReportButton.disabled, true);

  resolveReveal({ ok: true });
  await renderer.flush();

  assert.equal(renderer.elements.revealReportButton.disabled, false);
});

test("renderer disables every reveal control while the file manager launch is pending", async () => {
  const job = createFinishedJob();
  let revealCalls = 0;
  let resolveReveal;
  const revealPromise = new Promise((resolve) => {
    resolveReveal = resolve;
  });
  const renderer = await loadRenderer({
    routes: {
      "GET /api/jobs": { ok: true, jobs: [job] },
      "GET /api/jobs/job-previous?full=1": { ok: true, job },
      "POST /api/reveal": () => {
        revealCalls += 1;
        return revealPromise;
      }
    }
  });

  renderer.elements.previewImage.onload();
  await renderer.flush();
  assert.equal(renderer.elements.revealPreviewButton.disabled, false);
  assert.equal(renderer.elements.revealReportButton.disabled, false);

  renderer.elements.revealReportButton.dispatchEvent(new FakeEvent("click"));
  renderer.elements.revealPreviewButton.dispatchEvent(new FakeEvent("click"));
  await renderer.flush();

  assert.equal(revealCalls, 1);
  assert.equal(renderer.elements.revealPreviewButton.disabled, true);
  assert.equal(renderer.elements.revealReportButton.disabled, true);

  resolveReveal({ ok: true });
  await renderer.flush();

  assert.equal(renderer.elements.revealPreviewButton.disabled, false);
  assert.equal(renderer.elements.revealReportButton.disabled, false);
});

test("renderer recovers reveal controls when a local API call never settles", async () => {
  const job = createFinishedJob();
  let revealSignal;
  const renderer = await loadRenderer({
    routes: {
      "GET /api/jobs": { ok: true, jobs: [job] },
      "GET /api/jobs/job-previous?full=1": { ok: true, job },
      "POST /api/reveal": ({ signal }) => {
        revealSignal = signal;
        return new Promise((_resolve, reject) => {
          signal?.addEventListener("abort", () => {
            const error = new Error("The operation was aborted.");
            error.name = "AbortError";
            reject(error);
          });
        });
      }
    }
  });

  renderer.elements.previewImage.onload();
  await renderer.flush();
  assert.equal(renderer.elements.revealPreviewButton.disabled, false);
  assert.equal(renderer.elements.revealReportButton.disabled, false);

  renderer.elements.revealReportButton.dispatchEvent(new FakeEvent("click"));
  await renderer.flush();

  assert.equal(renderer.elements.revealPreviewButton.disabled, true);
  assert.equal(renderer.elements.revealReportButton.disabled, true);
  assert.equal(Boolean(revealSignal?.aborted), false);

  await renderer.runLastTimer();

  assert.equal(revealSignal.aborted, true);
  assert.equal(renderer.elements.revealPreviewButton.disabled, false);
  assert.equal(renderer.elements.revealReportButton.disabled, false);
  assert.match(renderer.elements.errorPanel.textContent, /本地桥接请求没有响应/);
  assert.match(renderer.elements.toast.textContent, /本地桥接请求没有响应/);
});

test("renderer restores focus after a pending global reveal request settles", async () => {
  const job = createFinishedJob();
  let resolveReveal;
  const revealPromise = new Promise((resolve) => {
    resolveReveal = resolve;
  });
  const renderer = await loadRenderer({
    routes: {
      "GET /api/jobs": { ok: true, jobs: [job] },
      "GET /api/jobs/job-previous?full=1": { ok: true, job },
      "POST /api/reveal": () => revealPromise
    }
  });

  renderer.elements.revealReportButton.focus();
  renderer.elements.revealReportButton.dispatchEvent(new FakeEvent("click"));
  await renderer.flush();
  assert.equal(renderer.elements.revealReportButton.disabled, true);
  renderer.document.activeElement = null;

  resolveReveal({ ok: true });
  await renderer.flush();

  assert.equal(renderer.elements.revealReportButton.disabled, false);
  assert.equal(renderer.document.activeElement, renderer.elements.revealReportButton);
});

test("renderer ignores Enter key confirmation while IME composition is active", async () => {
  const renderer = await loadRenderer({
    routes: {
      "POST /api/jobs": { ok: true, job: createRunningJob() }
    }
  });

  renderer.elements.inputPath.value = "/work/new.mov";
  renderer.elements.outDir.value = "/work/out";
  renderer.pressEnterIn(renderer.elements.inputPath, { isComposing: true });
  await renderer.flush();

  assert.equal(renderer.calls.some((call) => call.method === "POST" && call.url === "/api/jobs"), false);
  assert.doesNotMatch(renderer.elements.jobLog.textContent, /正在检查输入和输出路径/);
});

test("renderer ignores Enter submits while an active job is restored", async () => {
  const activeJob = createRunningJob();
  const renderer = await loadRenderer({
    routes: {
      "GET /api/jobs": { ok: true, jobs: [activeJob] },
      "GET /api/jobs/job-active/poll": { ok: true, job: activeJob }
    }
  });

  assert.equal(renderer.elements.stopButton.disabled, false);
  assert.match(renderer.elements.queueBody.innerHTML, /active\.mov/);
  assert.match(renderer.elements.qcIssues.innerHTML, /正在处理/);

  renderer.elements.inputPath.value = "/work/new.mov";
  renderer.elements.outDir.value = "/work/out";
  renderer.pressEnterIn(renderer.elements.inputPath);
  await renderer.flush();

  assert.equal(renderer.calls.some((call) => call.method === "POST" && call.url === "/api/jobs"), false);
  assert.equal(renderer.elements.stopButton.disabled, false);
  assert.match(renderer.elements.queueBody.innerHTML, /active\.mov/);
  assert.match(renderer.elements.qcIssues.innerHTML, /正在处理/);
  assert.doesNotMatch(renderer.elements.jobLog.textContent, /正在检查输入和输出路径/);
});

test("renderer shows job-level failures in the QC panel before item rows exist", async () => {
  const failedJob = createJobLevelFailureJob();
  const renderer = await loadRenderer({
    routes: {
      "GET /api/jobs": { ok: true, jobs: [failedJob] },
      "GET /api/jobs/job-failed?full=1": { ok: true, job: failedJob }
    }
  });

  assert.match(renderer.elements.queueBody.innerHTML, /编码器不可用/);
  assert.match(renderer.elements.qcSummary.innerHTML, /失败/);
  assert.match(renderer.elements.qcIssues.innerHTML, /编码器不可用/);
});

test("renderer does not label failed resultless rows as waiting for output", async () => {
  const job = createJobLevelFailureJob();
  job.total = 1;
  job.completed = 1;
  job.items = [{
    inputPath: "/work/bad.mov",
    status: "failed",
    error: "FFprobe 无法读取输入。",
    result: null
  }];
  const renderer = await loadRenderer({
    routes: {
      "GET /api/jobs": { ok: true, jobs: [job] },
      "GET /api/jobs/job-failed?full=1": { ok: true, job }
    }
  });

  assert.match(renderer.elements.queueBody.innerHTML, /失败/);
  assert.match(renderer.elements.queueBody.innerHTML, /未生成输出/);
  assert.doesNotMatch(renderer.elements.queueBody.innerHTML, /等待中/);
});

test("renderer sanitizes raw restored job errors and logs before display", async () => {
  const rawError = `TypeError: token leaked at ${privateUserRoot}/.private-fixture/tool-bin/render.js:9:1\n    at render (${privateUserRoot}/private/render.js:9:1)`;
  const job = createJobLevelFailureJob();
  job.error = rawError;
  job.logs = [{ at: new Date("2026-06-08T00:00:00.000Z").toISOString(), level: "error", message: rawError }];
  job.items = [{
    inputPath: "/work/failed.mov",
    status: "failed",
    error: rawError,
    result: null
  }];
  const renderer = await loadRenderer({
    routes: {
      "GET /api/jobs": { ok: true, jobs: [job] },
      "GET /api/jobs/job-failed?full=1": { ok: true, job }
    }
  });

  const userText = [
    renderer.elements.jobLog.textContent,
    renderer.elements.qcIssues.textContent,
    renderer.elements.jobStatusAnnouncer.textContent
  ].join("\n");
  assert.match(userText, /本地桥接返回了未脱敏的技术错误/);
  assert.doesNotMatch(userText, /\/Users\/will|\.private-fixture|tool-bin|render\.js:9|TypeError| at render/);
  assert.match(renderer.elements.queueBody.innerHTML, /本地桥接返回了未脱敏的技术错误/);
  assert.doesNotMatch(renderer.elements.queueBody.innerHTML, /\/Users\/will|\.private-fixture|tool-bin|render\.js:9|TypeError| at render/);
});

test("renderer displays source labels instead of raw local item paths", async () => {
  const now = new Date("2026-06-08T00:00:00.000Z").toISOString();
  const job = createFinishedJob();
  job.id = "job-display-labels";
  job.current = `${privateUserRoot}/private/session/cover.mov`;
  job.currentLabel = "cover.mov";
  job.logs = [{ at: now, level: "info", message: "正在处理 cover.mov" }];
  job.items = [{
    inputPath: `${privateUserRoot}/private/session/cover.mov`,
    inputLabel: "cover.mov",
    status: "passed",
    startedAt: now,
    finishedAt: now,
    error: null,
    currentStage: null,
    result: {
      inputPath: `${privateUserRoot}/private/session/cover.mov`,
      inputLabel: "cover.mov",
      outputPlan: {},
      assets: {},
      status: "passed",
      issueSummary: { errorCount: 0, warningCount: 0, issues: [] }
    }
  }];
  const renderer = await loadRenderer({
    routes: {
      "GET /api/jobs": { ok: true, jobs: [job] },
      "GET /api/jobs/job-display-labels?full=1": { ok: true, job }
    }
  });

  assert.match(renderer.elements.queueBody.innerHTML, /cover\.mov/);
  assert.match(renderer.elements.jobStatusAnnouncer.textContent, /cover\.mov/);
  assert.doesNotMatch(renderer.elements.queueBody.innerHTML, /\/Users\/will|private\/session/);
  assert.doesNotMatch(renderer.elements.queueBody.innerHTML, /path-(?:name|sub)[^>]*>[^<]*(?:\/Users\/will|private\/session)/);
  assert.doesNotMatch(renderer.elements.jobStatusAnnouncer.textContent, /\/Users\/will|private\/session/);
  const row = renderer.elements.queueBody.querySelector("[data-input-key]");
  assert.ok(row);
  assert.doesNotMatch(row.dataset.inputKey, /\/Users\/will|private\/session/);
});

test("renderer tells operators when restored job logs are clipped", async () => {
  const job = createClippedLogJob();
  const renderer = await loadRenderer({
    routes: {
      "GET /api/jobs": { ok: true, jobs: [job] },
      "GET /api/jobs/job-clipped-logs?full=1": { ok: true, job }
    }
  });

  assert.match(renderer.elements.jobLog.textContent, /restored log 7/);
  assert.doesNotMatch(renderer.elements.jobLog.textContent, /restored log 0/);
  assert.equal(renderer.elements.logRetentionNotice.hidden, false);
  assert.match(renderer.elements.logRetentionNotice.textContent, /仅显示最近 3\/10 条日志/);
});

test("renderer hides clipped log notice after the operator clears the log view", async () => {
  const job = createClippedLogJob();
  job.status = "running";
  job.current = "/work/clip.mov";
  job.items[0].status = "running";
  job.items[0].currentStage = { name: "render", target: "3x4", state: "active" };
  let pollCount = 0;
  const renderer = await loadRenderer({
    routes: {
      "GET /api/jobs": { ok: true, jobs: [job] },
      "GET /api/jobs/job-clipped-logs?full=1": { ok: true, job },
      "GET /api/jobs/job-clipped-logs/poll": () => {
        pollCount += 1;
        return { ok: true, job };
      }
    }
  });

  assert.equal(renderer.elements.logRetentionNotice.hidden, false);

  renderer.elements.clearLogButton.dispatchEvent(new FakeEvent("click"));
  await renderer.flush();
  assert.equal(renderer.elements.jobLog.textContent, "");
  assert.equal(renderer.elements.logRetentionNotice.hidden, true);

  const pollCountBeforeRefresh = pollCount;
  await renderer.runLastTimer();
  assert.equal(pollCount, pollCountBeforeRefresh + 1);
  assert.equal(renderer.elements.jobLog.textContent, "");
  assert.equal(renderer.elements.logRetentionNotice.hidden, true);
});

test("renderer queue output summary uses actual mode-specific assets", async () => {
  const job = createQcOnlyFinishedJob();
  const renderer = await loadRenderer({
    routes: {
      "GET /api/jobs": { ok: true, jobs: [job] },
      "GET /api/jobs/job-qc-only?full=1": { ok: true, job }
    }
  });

  const queueHtml = renderer.elements.queueBody.innerHTML;
  assert.equal(countOccurrences(queueHtml, "cover__apple-motion-qc.html"), 1);
  const reportButton = renderer.elements.queueBody.querySelectorAll("[data-asset]")
    .find((button) => button.dataset.kind === "report");
  assert.ok(reportButton);
  assert.equal(reportButton.dataset.asset, "asset-report-html-cover");
  assert.doesNotMatch(reportButton.dataset.asset, /cover__apple-motion-qc\.html|\/work\/out/);
  assert.doesNotMatch(queueHtml, /cover__apple-motion-1x1/);
  assert.doesNotMatch(queueHtml, /cover__apple-motion-3x4\.mp4/);
  assert.doesNotMatch(queueHtml, /cover__apple-motion-3x4-preview/);
});

test("renderer treats slim final job report assets as available reports", async () => {
  const job = createTwoItemFinishedJob();
  for (const item of job.items) delete item.result.report;
  const renderer = await loadRenderer({
    routes: {
      "GET /api/jobs": { ok: true, jobs: [job] },
      "GET /api/jobs/job-two-items?full=1": { ok: true, job }
    }
  });

  assert.match(renderer.elements.qcIssues.innerHTML, /质检报告已可用于复核/);
  assert.doesNotMatch(renderer.elements.qcIssues.innerHTML, /完整报告会在任务结束后可用/);
});

test("renderer gives repeated row action buttons file-specific accessible names", async () => {
  const job = createTwoItemFinishedJob();
  const renderer = await loadRenderer({
    routes: {
      "GET /api/jobs": { ok: true, jobs: [job] },
      "GET /api/jobs/job-two-items?full=1": { ok: true, job }
    }
  });

  assert.match(renderer.elements.queueBody.innerHTML, /aria-label="预览 work\/first\.mov"/);
  assert.match(renderer.elements.queueBody.innerHTML, /aria-label="报告 work\/first\.mov"/);
  assert.match(renderer.elements.queueBody.innerHTML, /aria-label="预览 work\/second\.mov"/);
  assert.match(renderer.elements.queueBody.innerHTML, /aria-label="报告 work\/second\.mov"/);
});

test("renderer includes mobile queue cell values in accessible labels", async () => {
  const job = createTwoItemFinishedJob();
  const renderer = await loadRenderer({
    routes: {
      "GET /api/jobs": { ok: true, jobs: [job] },
      "GET /api/jobs/job-two-items?full=1": { ok: true, job }
    }
  });

  const queueHtml = renderer.elements.queueBody.innerHTML;
  assert.match(queueHtml, /data-label="状态" aria-label="状态：通过"/);
  assert.match(queueHtml, /data-label="来源" aria-label="来源：work\/first\.mov"/);
  assert.match(queueHtml, /data-label="问题" aria-label="问题：0"/);
  assert.match(queueHtml, /data-label="输出" aria-label="输出：已生成 预览、报告"/);
  assert.match(queueHtml, /data-label="操作" aria-label="操作：work\/first\.mov"/);
  assert.doesNotMatch(queueHtml, /data-label="来源" aria-label="来源"/);
});

test("renderer exposes row detail selection as current state instead of a toggle", async () => {
  const job = createTwoItemFinishedJob({ current: "/work/first.mov" });
  const renderer = await loadRenderer({
    routes: {
      "GET /api/jobs": { ok: true, jobs: [job] },
      "GET /api/jobs/job-two-items?full=1": { ok: true, job }
    }
  });

  const queueHtml = renderer.elements.queueBody.innerHTML;
  assert.doesNotMatch(queueHtml, /aria-pressed=/);
  assert.match(queueHtml, /aria-current="true"[^>]*><span class="status-chip passed">通过/);
  assert.match(queueHtml, /aria-label="当前查看 work\/first\.mov 的预览与质检详情"/);
  assert.match(queueHtml, /aria-label="查看 work\/second\.mov 的预览与质检详情"/);
});

test("renderer gives global reveal buttons selected-file accessible names", async () => {
  const job = createTwoItemFinishedJob({ current: "/work/first.mov" });
  const renderer = await loadRenderer({
    routes: {
      "GET /api/jobs": { ok: true, jobs: [job] },
      "GET /api/jobs/job-two-items?full=1": { ok: true, job }
    }
  });

  assert.equal(renderer.elements.revealPreviewButton["aria-label"], "显示 work/first.mov 的预览文件");
  assert.equal(renderer.elements.revealReportButton["aria-label"], "显示 work/first.mov 的报告文件");

  const secondRow = renderer.elements.queueBody
    .querySelectorAll("[data-input-key]")
    .find((row) => row.dataset.inputKey === "1");
  const selectButton = secondRow.querySelector("[data-row-select]");
  selectButton.dispatchEvent(new FakeEvent("click", {
    bubbles: true,
    target: selectButton
  }));

  assert.equal(renderer.elements.revealPreviewButton["aria-label"], "显示 work/second.mov 的预览文件");
  assert.equal(renderer.elements.revealReportButton["aria-label"], "显示 work/second.mov 的报告文件");
  assert.equal(renderer.elements.revealPreviewButton.title, "显示 work/second.mov 的预览文件");
  assert.equal(renderer.elements.revealReportButton.title, "显示 work/second.mov 的报告文件");
});

test("renderer escapes row action labels for special characters in file names", async () => {
  const job = createTwoItemFinishedJob();
  job.items = [job.items[0]];
  job.items[0].inputPath = "/work/openfad \"final\" & <cover>.mov";
  job.items[0].result.assets.preview = "/work/out/openfad-special.png";
  job.items[0].result.assets.reportHtml = "/work/out/openfad-special.html";
  const renderer = await loadRenderer({
    routes: {
      "GET /api/jobs": { ok: true, jobs: [job] },
      "GET /api/jobs/job-two-items?full=1": { ok: true, job }
    }
  });

  const queueHtml = renderer.elements.queueBody.innerHTML;
  assert.match(queueHtml, /aria-label="预览 work\/openfad &quot;final&quot; &amp; &lt;cover&gt;\.mov"/);
  assert.match(queueHtml, /aria-label="报告 work\/openfad &quot;final&quot; &amp; &lt;cover&gt;\.mov"/);
  assert.doesNotMatch(queueHtml, /aria-label="预览 work\/openfad "final"/);
});

test("renderer does not advertise JSON-only reports as directly reviewable", async () => {
  const job = createTwoItemFinishedJob();
  for (const item of job.items) {
    delete item.result.report;
    delete item.result.assets.reportHtml;
    item.result.assets.reportJson = `/work/out/${path.basename(item.inputPath)}.json`;
  }
  const renderer = await loadRenderer({
    routes: {
      "GET /api/jobs": { ok: true, jobs: [job] },
      "GET /api/jobs/job-two-items?full=1": { ok: true, job }
    }
  });

  assert.match(renderer.elements.qcIssues.innerHTML, /输出目录/);
  assert.doesNotMatch(renderer.elements.qcIssues.innerHTML, /质检报告已可用于复核/);
});

test("renderer points restored slim reports to the output directory instead of pending completion", async () => {
  const job = createTwoItemFinishedJob();
  for (const item of job.items) {
    delete item.result.report;
    item.result.assets = {};
    item.result.outputPlan = {
      reportHtml: `/work/out/${path.basename(item.inputPath)}.html`
    };
  }
  const renderer = await loadRenderer({
    routes: {
      "GET /api/jobs": { ok: true, jobs: [job] },
      "GET /api/jobs/job-two-items?full=1": { ok: true, job }
    }
  });

  assert.match(renderer.elements.queueBody.innerHTML, /out\/first\.mov\.html/);
  assert.match(renderer.elements.queueBody.innerHTML, /out\/second\.mov\.html/);
  assert.match(renderer.elements.qcIssues.innerHTML, /输出目录/);
  assert.doesNotMatch(renderer.elements.qcIssues.innerHTML, /完整报告会在任务结束后可用/);
  assert.doesNotMatch(renderer.elements.qcIssues.innerHTML, /质检报告已可用于复核/);
});

test("renderer does not announce output-plan-only rows as generated output", async () => {
  const job = createTwoItemFinishedJob();
  job.status = "planned";
  job.items = [job.items[0]];
  job.total = 1;
  job.completed = 1;
  job.planned = 1;
  job.passed = 0;
  job.items[0].status = "planned";
  job.items[0].result.status = "planned";
  job.items[0].result.assets = {};
  job.items[0].result.assetIds = {};
  job.items[0].result.outputPlan = {
    preview: "/work/out/first__apple-motion-3x4-preview.png",
    reportHtml: "/work/out/first__apple-motion-qc.html"
  };
  const renderer = await loadRenderer({
    routes: {
      "GET /api/jobs": { ok: true, jobs: [job] },
      "GET /api/jobs/job-two-items?full=1": { ok: true, job }
    }
  });

  const queueHtml = renderer.elements.queueBody.innerHTML;
  assert.match(queueHtml, /data-label="输出" aria-label="输出：计划生成 预览、报告"/);
  assert.doesNotMatch(queueHtml, /aria-label="输出：已生成/);
});

test("renderer shows a fallback output label for empty restored output plans", async () => {
  const job = createTwoItemFinishedJob();
  job.items = [job.items[0]];
  job.total = 1;
  job.completed = 1;
  delete job.items[0].result.report;
  job.items[0].result.assets = {};
  job.items[0].result.outputPlan = {};
  const renderer = await loadRenderer({
    routes: {
      "GET /api/jobs": { ok: true, jobs: [job] },
      "GET /api/jobs/job-two-items?full=1": { ok: true, job }
    }
  });

  assert.match(renderer.elements.queueBody.innerHTML, /等待中/);
  assert.equal(renderer.elements.queueBody.innerHTML.includes("<span class=\"path-sub\"></span>"), false);
});

test("renderer clears restored finished history from the queue surface", async () => {
  const job = createFinishedJob();
  const renderer = await loadRenderer({
    routes: {
      "GET /api/jobs": { ok: true, jobs: [job] },
      "GET /api/jobs/job-previous?full=1": { ok: true, job },
      "DELETE /api/jobs/history": { ok: true, cleared: 1, jobs: [] }
    }
  });

  assert.match(renderer.elements.queueBody.innerHTML, /old\.mov/);

  await openClearHistoryDialog(renderer);
  assert.equal(renderer.calls.some((call) => call.method === "DELETE" && call.url === "/api/jobs/history"), false);
  renderer.elements.clearHistoryCancelButton.dispatchEvent(new FakeEvent("click"));
  await renderer.flush();
  assert.equal(renderer.elements.clearHistoryDialog.hidden, true);
  assert.equal(renderer.document.activeElement, renderer.elements.clearHistoryButton);
  assert.match(renderer.elements.queueBody.innerHTML, /old\.mov/);

  await confirmClearHistory(renderer);
  assert.equal(renderer.document.activeElement, renderer.elements.clearHistoryButton);

  const clearCall = renderer.calls.find((call) => call.method === "DELETE" && call.url === "/api/jobs/history");
  assert.deepEqual(clearCall?.body, { confirm: "clear-finished-history" });
  assert.match(renderer.elements.queueBody.innerHTML, /暂无批处理任务/);
  assert.equal(renderer.elements.metricTotal.textContent, "0");
  assert.equal(renderer.elements.jobBadge.textContent, "空闲");
  assert.equal(renderer.elements.revealPreviewButton.disabled, true);
  assert.equal(renderer.elements.revealReportButton.disabled, true);
  assert.match(renderer.elements.toast.textContent, /已清除 1 条历史任务记录，输出文件不会被删除/);
  assert.match(renderer.elements.jobStatusAnnouncer.textContent, /已清除 1 条历史任务记录，输出文件不会被删除/);
});

test("renderer blocks job creation while clear-history confirmation is open", async () => {
  const job = createFinishedJob();
  const activeJob = createRunningJob();
  const renderer = await loadRenderer({
    routes: {
      "GET /api/jobs": { ok: true, jobs: [job] },
      "GET /api/jobs/job-previous?full=1": { ok: true, job },
      "POST /api/jobs": { ok: true, job: activeJob },
      "GET /api/jobs/job-active/poll": { ok: true, job: activeJob }
    }
  });

  renderer.elements.inputPath.value = "/work/new.mov";
  renderer.elements.outDir.value = "/work/out";
  await openClearHistoryDialog(renderer);

  assert.equal(renderer.elements.startButton.disabled, true);
  assert.equal(renderer.elements.dryRunButton.disabled, true);
  assert.equal(renderer.elements.clearHistoryButton.disabled, true);

  renderer.elements.startButton.dispatchEvent(new FakeEvent("click"));
  renderer.pressEnterIn(renderer.elements.inputPath);
  await renderer.flush();

  assert.equal(renderer.calls.some((call) => call.method === "POST" && call.url === "/api/jobs"), false);
  assert.match(renderer.elements.queueBody.innerHTML, /old\.mov/);
});

test("renderer keeps active job controls after clearing finished history", async () => {
  const previousJob = createFinishedJob();
  const activeJob = createRunningJob();
  const renderer = await loadRenderer({
    routes: {
      "GET /api/jobs": { ok: true, jobs: [previousJob] },
      "GET /api/jobs/job-previous?full=1": { ok: true, job: previousJob },
      "DELETE /api/jobs/history": { ok: true, cleared: 1, jobs: [activeJob] },
      "GET /api/jobs/job-active/poll": { ok: true, job: activeJob }
    }
  });

  await confirmClearHistory(renderer);

  assert.equal(renderer.calls.some((call) => call.method === "DELETE" && call.url === "/api/jobs/history"), true);
  assert.doesNotMatch(renderer.elements.queueBody.innerHTML, /old\.mov/);
  assert.match(renderer.elements.queueBody.innerHTML, /active\.mov/);
  assert.match(renderer.elements.jobBadge.textContent, /处理中/);
  assert.equal(renderer.elements.startButton.disabled, true);
  assert.equal(renderer.elements.dryRunButton.disabled, true);
  assert.equal(renderer.elements.stopButton.disabled, false);
  assert.match(renderer.elements.toast.textContent, /已清除 1 条历史任务记录，输出文件不会被删除/);
  assert.match(renderer.elements.jobStatusAnnouncer.textContent, /已清除 1 条历史任务记录，输出文件不会被删除/);
});

test("renderer ignores stale poll responses after history clearing changes the selected job", async () => {
  const activeJob = createRunningJob();
  let pollCalls = 0;
  let resolvePoll;
  const renderer = await loadRenderer({
    routes: {
      "POST /api/jobs": { ok: true, job: activeJob },
      "GET /api/jobs/job-active/poll": () => {
        pollCalls += 1;
        if (pollCalls === 1) return { ok: true, job: activeJob };
        return new Promise((resolve) => {
          resolvePoll = resolve;
        });
      },
      "DELETE /api/jobs/history": { ok: true, cleared: 1, jobs: [] }
    }
  });

  renderer.elements.inputPath.value = "/work/active.mov";
  renderer.elements.outDir.value = "/work/out";
  renderer.submitForm();
  await renderer.flush();

  assert.equal(pollCalls, 1);
  assert.equal(renderer.elements.clearHistoryButton.disabled, false);
  renderer.lastTimer.callback();
  await renderer.flush();

  assert.equal(typeof resolvePoll, "function");
  assert.match(renderer.elements.queueBody.innerHTML, /active\.mov/);

  await confirmClearHistory(renderer);

  assert.match(renderer.elements.queueBody.innerHTML, /暂无批处理任务/);
  assert.equal(renderer.elements.jobBadge.textContent, "空闲");

  resolvePoll({ ok: true, job: activeJob });
  await renderer.flush();

  assert.match(renderer.elements.queueBody.innerHTML, /暂无批处理任务/);
  assert.doesNotMatch(renderer.elements.queueBody.innerHTML, /active\.mov/);
  assert.equal(renderer.elements.jobBadge.textContent, "空闲");
  assert.equal(renderer.elements.stopButton.disabled, true);
});

test("renderer does not let a hung stale poll freeze a later job", async () => {
  const activeJob = createRunningJob();
  const newJob = createRunningJob({ id: "job-new", current: "/work/new.mov" });
  let postCalls = 0;
  let oldPollCalls = 0;
  let newPollCalls = 0;
  const renderer = await loadRenderer({
    routes: {
      "POST /api/jobs": () => {
        postCalls += 1;
        return { ok: true, job: postCalls === 1 ? activeJob : newJob };
      },
      "GET /api/jobs/job-active/poll": () => {
        oldPollCalls += 1;
        if (oldPollCalls === 1) return { ok: true, job: activeJob };
        return new Promise(() => {});
      },
      "GET /api/jobs/job-new/poll": () => {
        newPollCalls += 1;
        return { ok: true, job: newJob };
      },
      "DELETE /api/jobs/history": { ok: true, cleared: 1, jobs: [] }
    }
  });

  renderer.elements.inputPath.value = "/work/active.mov";
  renderer.elements.outDir.value = "/work/out";
  renderer.submitForm();
  await renderer.flush();
  renderer.lastTimer.callback();
  await renderer.flush();

  assert.equal(oldPollCalls, 2);
  await confirmClearHistory(renderer);

  renderer.elements.inputPath.value = "/work/new.mov";
  renderer.elements.outDir.value = "/work/out";
  renderer.submitForm();
  await renderer.flush();

  assert.equal(newPollCalls, 1);
  assert.match(renderer.elements.queueBody.innerHTML, /new\.mov/);
});

test("renderer keeps restored history visible when clearing history fails", async () => {
  const job = createFinishedJob();
  const renderer = await loadRenderer({
    routes: {
      "GET /api/jobs": { ok: true, jobs: [job] },
      "GET /api/jobs/job-previous?full=1": { ok: true, job },
      "DELETE /api/jobs/history": {
        ok: false,
        error: "任务恢复记录暂时无法写入。请确认应用数据目录可写后重试。",
        statusCode: 500
      }
    }
  });

  await confirmClearHistory(renderer);

  assert.match(renderer.elements.queueBody.innerHTML, /old\.mov/);
  assert.equal(renderer.elements.metricTotal.textContent, "1");
  assert.equal(renderer.elements.clearHistoryButton.disabled, false);
  assert.match(renderer.elements.errorPanel.textContent, /任务恢复记录暂时无法写入/);
  assert.match(renderer.elements.toast.textContent, /任务恢复记录暂时无法写入/);
});

test("renderer explains empty history clearing without changing the idle surface", async () => {
  const renderer = await loadRenderer({
    routes: {
      "GET /api/jobs": { ok: true, jobs: [] },
      "DELETE /api/jobs/history": { ok: true, cleared: 0, jobs: [] }
    }
  });

  await confirmClearHistory(renderer);

  assert.match(renderer.elements.queueBody.innerHTML, /暂无批处理任务/);
  assert.equal(renderer.elements.metricTotal.textContent, "0");
  assert.equal(renderer.elements.jobBadge.textContent, "空闲");
  assert.match(renderer.elements.toast.textContent, /没有可清除的历史任务记录，输出文件不会被删除/);
  assert.match(renderer.elements.jobStatusAnnouncer.textContent, /没有可清除的历史任务记录，输出文件不会被删除/);
});

test("renderer blocks job creation while history clearing is pending", async () => {
  const previousJob = createFinishedJob();
  let resolveClear;
  const renderer = await loadRenderer({
    routes: {
      "GET /api/jobs": { ok: true, jobs: [previousJob] },
      "GET /api/jobs/job-previous?full=1": { ok: true, job: previousJob },
      "DELETE /api/jobs/history": () => new Promise((resolve) => {
        resolveClear = resolve;
      }),
      "POST /api/jobs": { ok: true, job: createRunningJob() }
    }
  });

  await confirmClearHistory(renderer);

  assert.equal(renderer.elements.clearHistoryButton.disabled, true);
  assert.equal(renderer.elements.startButton.disabled, true);
  assert.equal(renderer.elements.dryRunButton.disabled, true);
  assert.equal(renderer.elements.stopButton.disabled, true);

  renderer.elements.inputPath.value = "/work/new.mov";
  renderer.elements.outDir.value = "/work/out";
  renderer.submitForm();
  await renderer.flush();

  assert.equal(renderer.calls.some((call) => call.method === "POST" && call.url === "/api/jobs"), false);

  renderer.elements.inputPath.focus();
  resolveClear({ ok: true, cleared: 1, jobs: [] });
  await renderer.flush();

  assert.match(renderer.elements.queueBody.innerHTML, /暂无批处理任务/);
  assert.equal(renderer.elements.startButton.disabled, false);
  assert.equal(renderer.elements.dryRunButton.disabled, false);
  assert.equal(renderer.elements.clearHistoryButton.disabled, false);
  assert.equal(renderer.document.activeElement, renderer.elements.inputPath);
});

test("renderer localizes fetch transport failures instead of showing browser errors", async () => {
  const errors = [];
  const renderer = await loadRenderer({
    testConsole: {
      ...console,
      error: (...args) => errors.push(args)
    },
    routes: {
      "GET /api/health": () => {
        throw new TypeError("Failed to fetch");
      }
    }
  });

  assert.equal(renderer.elements.errorPanel.hidden, false);
  assert.match(renderer.elements.errorPanel.textContent, /本地桥接/);
  assert.doesNotMatch(renderer.elements.errorPanel.textContent, /Failed to fetch|Load failed|NetworkError/);
  assert.doesNotMatch(renderer.elements.toast.textContent, /Failed to fetch|Load failed|NetworkError/);
  assert.equal(errors.length, 1);
  assert.doesNotMatch(flattenConsoleArgs(errors), /Failed to fetch|\/Users\/|ui\/public\/app\.js/);
});

test("restore failure does not render idle empty state", async () => {
  const renderer = await loadRenderer({
    routes: {
      "GET /api/jobs": {
        ok: false,
        error: "任务恢复记录读取失败。",
        statusCode: 500
      }
    }
  });

  assert.equal(renderer.elements.errorPanel.hidden, false);
  assert.match(renderer.elements.errorPanel.textContent, /无法恢复上次任务状态/);
  assert.match(renderer.elements.queueBody.innerHTML, /任务恢复失败/);
  assert.doesNotMatch(renderer.elements.queueBody.innerHTML, /暂无批处理任务/);
  assert.equal(renderer.elements.jobBadge.textContent, "失败");
  assert.notEqual(renderer.elements.qcSummary.textContent, "空闲");
  assert.match(renderer.elements.jobLog.textContent, /无法恢复上次任务状态/);
  assert.match(renderer.elements.jobStatusAnnouncer.textContent, /重置本地任务恢复记录/);
  assert.doesNotMatch(renderer.elements.jobStatusAnnouncer.textContent, /请重启应用/);
});

test("renderer resets local recovery record after restore failure", async () => {
  const renderer = await loadRenderer({
    routes: {
      "GET /api/jobs": {
        ok: false,
        error: "任务恢复记录读取失败。",
        statusCode: 500
      },
      "DELETE /api/jobs/recovery": {
        ok: true,
        reset: true,
        archived: true,
        archivedLabel: "jobs.corrupt-20260610T120000000Z.json",
        restore: { failed: false, error: null },
        jobs: []
      }
    }
  });

  assert.equal(renderer.elements.clearHistoryButton.disabled, false);
  assert.equal(renderer.elements.clearHistoryButton.title, "重置本地任务恢复记录");
  assert.equal(renderer.elements.clearHistoryButton["aria-label"], "重置本地任务恢复记录");
  renderer.elements.clearHistoryButton.dispatchEvent(new FakeEvent("click"));
  await renderer.flush();

  const resetCall = renderer.calls.find((call) => call.method === "DELETE" && call.url === "/api/jobs/recovery");
  assert.deepEqual(resetCall?.body, { confirm: "reset-restore-failure" });
  assert.equal(renderer.elements.errorPanel.hidden, true);
  assert.equal(renderer.elements.jobBadge.textContent, "空闲");
  assert.match(renderer.elements.toast.textContent, /已重置本地任务恢复记录/);
  assert.equal(renderer.elements.startButton.disabled, false);
  assert.equal(renderer.elements.dryRunButton.disabled, false);
});

test("renderer treats server restore metadata as resettable restore failure", async () => {
  const renderer = await loadRenderer({
    routes: {
      "GET /api/jobs": {
        ok: true,
        restore: {
          failed: true,
          error: "无法读取本地任务恢复记录。请重新开始任务。"
        },
        jobs: [{
          id: "restore-failure-job",
          status: "failed",
          total: 0,
          completed: 0,
          passed: 0,
          warnings: 0,
          failed: 1,
          error: "无法读取本地任务恢复记录。请重新开始任务。",
          logs: [{ at: new Date().toISOString(), level: "error", message: "无法读取本地任务恢复记录。请重新开始任务。" }],
          items: []
        }]
      },
      "DELETE /api/jobs/recovery": {
        ok: true,
        reset: true,
        archived: true,
        archivedLabel: "jobs.corrupt-20260610T120000000Z.json",
        restore: { failed: false, error: null },
        jobs: []
      }
    }
  });

  assert.equal(renderer.elements.clearHistoryButton.disabled, false);
  assert.match(renderer.elements.queueBody.innerHTML, /任务恢复失败/);
  assert.match(renderer.elements.errorPanel.textContent, /无法恢复上次任务状态/);

  renderer.elements.clearHistoryButton.dispatchEvent(new FakeEvent("click"));
  await renderer.flush();

  assert.equal(renderer.elements.clearHistoryDialog.hidden, true);
  assert.equal(renderer.calls.some((call) => call.method === "DELETE" && call.url === "/api/jobs/recovery"), true);
  assert.match(renderer.elements.queueBody.innerHTML, /暂无批处理任务/);
  assert.equal(renderer.elements.clearHistoryButton.title, "清除历史任务记录，不删除输出文件");
});

test("renderer blocks job creation after restore failure until the operator resets recovery", async () => {
  const renderer = await loadRenderer({
    routes: {
      "GET /api/jobs": {
        ok: false,
        error: "任务恢复记录读取失败。",
        statusCode: 500
      },
      "POST /api/jobs": { ok: true, job: createRunningJob() }
    }
  });

  renderer.elements.inputPath.value = "/work/new.mov";
  renderer.elements.outDir.value = "/work/out";
  renderer.submitForm();
  await renderer.flush();

  assert.equal(renderer.calls.some((call) => call.method === "POST" && call.url === "/api/jobs"), false);
  assert.equal(renderer.elements.startButton.disabled, true);
  assert.equal(renderer.elements.dryRunButton.disabled, true);
  assert.match(renderer.elements.errorPanel.textContent, /无法恢复上次任务状态/);
  assert.match(renderer.elements.toast.textContent, /请先重置本地任务恢复记录/);
});

test("renderer blocks job creation while restore is still checking prior jobs", async () => {
  let resolveJobs;
  const activeJob = createRunningJob({ current: "/work/new.mov" });
  const renderer = await loadRenderer({
    routes: {
      "GET /api/jobs": () => new Promise((resolve) => {
        resolveJobs = resolve;
      }),
      "POST /api/jobs": { ok: true, job: activeJob },
      "GET /api/jobs/job-active/poll": { ok: true, job: activeJob }
    }
  });

  assert.equal(renderer.elements.startButton.disabled, true);
  assert.equal(renderer.elements.dryRunButton.disabled, true);
  assert.equal(renderer.elements.clearHistoryButton.disabled, true);
  assert.equal(renderer.elements.jobBadge.textContent, "恢复中");
  assert.match(renderer.elements.jobStatusAnnouncer.textContent, /正在恢复上次任务状态/);

  renderer.elements.clearHistoryButton.dispatchEvent(new FakeEvent("click"));
  await renderer.flush();

  assert.equal(renderer.elements.clearHistoryDialog.hidden, true);
  assert.equal(renderer.calls.some((call) => call.method === "DELETE" && call.url === "/api/jobs/history"), false);
  assert.match(renderer.elements.errorPanel.textContent, /正在恢复上次任务状态/);
  assert.match(renderer.elements.toast.textContent, /稍后再清除历史任务记录/);

  renderer.elements.inputPath.value = "/work/new.mov";
  renderer.elements.outDir.value = "/work/out";
  renderer.submitForm();
  await renderer.flush();

  assert.equal(renderer.calls.some((call) => call.method === "POST" && call.url === "/api/jobs"), false);
  assert.match(renderer.elements.errorPanel.textContent, /正在恢复上次任务状态/);
  assert.match(renderer.elements.toast.textContent, /正在恢复上次任务状态/);

  resolveJobs({
    ok: false,
    error: "任务恢复记录读取失败。",
    statusCode: 500
  });
  await renderer.flush();

  assert.equal(renderer.elements.startButton.disabled, true);
  assert.equal(renderer.elements.dryRunButton.disabled, true);
  assert.match(renderer.elements.errorPanel.textContent, /无法恢复上次任务状态/);
});

test("renderer clears stale missing-input validation after the operator edits the input field", async () => {
  const renderer = await loadRenderer();

  renderer.elements.inputPath.value = "";
  renderer.elements.outDir.value = "/work/out";
  renderer.submitForm();
  await renderer.flush();

  assert.equal(renderer.elements.errorPanel.hidden, false);
  assert.match(renderer.elements.errorPanel.textContent, /需要输入文件或文件夹路径/);
  assert.equal(renderer.elements.inputPath["aria-invalid"], "true");
  assert.equal(renderer.elements.inputPath["aria-describedby"], "errorPanel");
  assert.equal(renderer.elements.outDir["aria-invalid"], undefined);

  renderer.elements.inputPath.value = "/work/new.mov";
  renderer.elements.inputPath.dispatchEvent(new FakeEvent("input", { bubbles: true }));
  await renderer.flush();

  assert.equal(renderer.elements.errorPanel.hidden, true);
  assert.equal(renderer.elements.errorPanel.textContent, "");
  assert.equal(renderer.elements.inputPath["aria-invalid"], undefined);
  assert.equal(renderer.elements.inputPath["aria-describedby"], undefined);
});

test("renderer clears stale missing-output validation after the operator edits the output field", async () => {
  const renderer = await loadRenderer({
    routes: {
      "GET /api/spec": {
        ok: true,
        defaults: {
          outDir: ""
        }
      }
    }
  });

  renderer.elements.inputPath.value = "/work/new.mov";
  renderer.elements.outDir.value = "";
  renderer.submitForm();
  await renderer.flush();

  assert.equal(renderer.elements.errorPanel.hidden, false);
  assert.match(renderer.elements.errorPanel.textContent, /需要输出文件夹路径/);
  assert.equal(renderer.elements.outDir["aria-invalid"], "true");
  assert.equal(renderer.elements.outDir["aria-describedby"], "errorPanel");
  assert.equal(renderer.elements.inputPath["aria-invalid"], undefined);

  renderer.elements.outDir.value = "/work/out";
  renderer.elements.outDir.dispatchEvent(new FakeEvent("input", { bubbles: true }));
  await renderer.flush();

  assert.equal(renderer.elements.errorPanel.hidden, true);
  assert.equal(renderer.elements.errorPanel.textContent, "");
  assert.equal(renderer.elements.outDir["aria-invalid"], undefined);
  assert.equal(renderer.elements.outDir["aria-describedby"], undefined);
});

test("renderer validates frame rate locally before clearing the current review", async () => {
  const previousJob = createFinishedJob();
  const renderer = await loadRenderer({
    routes: {
      "GET /api/jobs": { ok: true, jobs: [previousJob] },
      "GET /api/jobs/job-previous?full=1": { ok: true, job: previousJob },
      "POST /api/jobs": { ok: true, job: createRunningJob() }
    }
  });

  renderer.elements.inputPath.value = "/work/new.mov";
  renderer.elements.outDir.value = "/work/out";
  renderer.elements.fps.value = "60";
  renderer.submitForm();
  await renderer.flush();

  assert.equal(renderer.calls.some((call) => call.method === "POST" && call.url === "/api/jobs"), false);
  assert.match(renderer.elements.errorPanel.textContent, /帧率必须是 auto/);
  assert.match(renderer.elements.toast.textContent, /帧率必须是 auto/);
  assert.equal(renderer.elements.fps["aria-invalid"], "true");
  assert.equal(renderer.elements.fps["aria-describedby"], "errorPanel");
  assert.equal(renderer.document.activeElement, renderer.elements.fps);
  assert.match(renderer.elements.queueBody.innerHTML, /old\.mov/);
  assert.match(renderer.elements.qcIssues.innerHTML, /边缘安全区/);
  assert.doesNotMatch(renderer.elements.jobLog.textContent, /正在检查输入和输出路径/);

  renderer.elements.fps.value = "29.97";
  renderer.elements.fps.dispatchEvent(new FakeEvent("input", { bubbles: true }));
  await renderer.flush();

  assert.equal(renderer.elements.errorPanel.hidden, true);
  assert.equal(renderer.elements.fps["aria-invalid"], undefined);
  assert.equal(renderer.elements.fps["aria-describedby"], undefined);
});

test("renderer validates bitrate locally before queueing work", async () => {
  const previousJob = createFinishedJob();
  const renderer = await loadRenderer({
    routes: {
      "GET /api/jobs": { ok: true, jobs: [previousJob] },
      "GET /api/jobs/job-previous?full=1": { ok: true, job: previousJob },
      "POST /api/jobs": { ok: true, job: createRunningJob() }
    }
  });

  renderer.elements.inputPath.value = "/work/new.mov";
  renderer.elements.outDir.value = "/work/out";
  renderer.elements.bitrate.value = "5M";
  renderer.submitForm();
  await renderer.flush();

  assert.equal(renderer.calls.some((call) => call.method === "POST" && call.url === "/api/jobs"), false);
  assert.match(renderer.elements.errorPanel.textContent, /码率必须在 45M 到 100M/);
  assert.equal(renderer.elements.bitrate["aria-invalid"], "true");
  assert.equal(renderer.elements.bitrate["aria-describedby"], "errorPanel");
  assert.equal(renderer.document.activeElement, renderer.elements.bitrate);
  assert.match(renderer.elements.queueBody.innerHTML, /old\.mov/);
  assert.match(renderer.elements.qcIssues.innerHTML, /边缘安全区/);

  renderer.elements.bitrate.value = "50M";
  renderer.elements.bitrate.dispatchEvent(new FakeEvent("input", { bubbles: true }));
  await renderer.flush();

  assert.equal(renderer.elements.errorPanel.hidden, true);
  assert.equal(renderer.elements.bitrate["aria-invalid"], undefined);
  assert.equal(renderer.elements.bitrate["aria-describedby"], undefined);
});

test("renderer surfaces custom FFprobe path errors without replacing the current review", async () => {
  const previousJob = createFinishedJob();
  const renderer = await loadRenderer({
    routes: {
      "GET /api/jobs": { ok: true, jobs: [previousJob] },
      "GET /api/jobs/job-previous?full=1": { ok: true, job: previousJob },
      "POST /api/jobs": {
        ok: false,
        statusCode: 400,
        error: "无法访问自定义 FFprobe 路径。请确认文件存在且可执行。",
        field: "ffprobePath"
      }
    }
  });

  renderer.elements.inputPath.value = "/work/new.mov";
  renderer.elements.outDir.value = "/work/out";
  renderer.elements.ffprobePath.value = "/work/missing-ffprobe";
  renderer.submitForm();
  await renderer.flush();

  assert.equal(renderer.calls.filter((call) => call.method === "POST" && call.url === "/api/jobs").length, 1);
  assert.match(renderer.elements.errorPanel.textContent, /无法访问自定义 FFprobe 路径/);
  assert.match(renderer.elements.toast.textContent, /无法访问自定义 FFprobe 路径/);
  assert.equal(renderer.elements.ffprobePath["aria-invalid"], "true");
  assert.equal(renderer.elements.ffprobePath["aria-describedby"], "errorPanel");
  assert.equal(renderer.document.activeElement, renderer.elements.ffprobePath);
  assert.match(renderer.elements.queueBody.innerHTML, /old\.mov/);
  assert.match(renderer.elements.qcIssues.innerHTML, /边缘安全区/);
  assert.doesNotMatch(renderer.elements.queueBody.innerHTML, /failed|失败|new\.mov/i);
  assert.doesNotMatch(renderer.elements.jobLog.textContent, /正在检查输入和输出路径/);

  renderer.elements.ffprobePath.value = "/usr/local/bin/ffprobe";
  renderer.elements.ffprobePath.dispatchEvent(new FakeEvent("input", { bubbles: true }));
  await renderer.flush();

  assert.equal(renderer.elements.errorPanel.hidden, true);
  assert.equal(renderer.elements.ffprobePath["aria-invalid"], undefined);
  assert.equal(renderer.elements.ffprobePath["aria-describedby"], undefined);
});

test("renderer field edits do not clear restore or persistence failures", async () => {
  const restoreRenderer = await loadRenderer({
    routes: {
      "GET /api/jobs": {
        ok: false,
        error: "任务恢复记录读取失败。",
        statusCode: 500
      }
    }
  });

  restoreRenderer.elements.inputPath.value = "/work/new.mov";
  restoreRenderer.elements.inputPath.dispatchEvent(new FakeEvent("input", { bubbles: true }));
  restoreRenderer.elements.outDir.value = "/work/out";
  restoreRenderer.elements.outDir.dispatchEvent(new FakeEvent("input", { bubbles: true }));
  await restoreRenderer.flush();

  assert.equal(restoreRenderer.elements.errorPanel.hidden, false);
  assert.match(restoreRenderer.elements.errorPanel.textContent, /无法恢复上次任务状态/);

  const persistenceRenderer = await loadRenderer({
    routes: {
      "GET /api/spec": {
        ok: true,
        defaults: {
          outDir: "/tmp/apple-motion-output"
        },
        persistence: {
          configured: true,
          ok: false,
          error: "任务恢复记录暂时无法写入。"
        }
      }
    }
  });

  persistenceRenderer.elements.inputPath.value = "/work/new.mov";
  persistenceRenderer.elements.inputPath.dispatchEvent(new FakeEvent("input", { bubbles: true }));
  persistenceRenderer.elements.outDir.value = "/work/out";
  persistenceRenderer.elements.outDir.dispatchEvent(new FakeEvent("input", { bubbles: true }));
  await persistenceRenderer.flush();

  assert.equal(persistenceRenderer.elements.errorPanel.hidden, false);
  assert.match(persistenceRenderer.elements.errorPanel.textContent, /任务恢复记录无法写入/);
});

test("renderer picker and drop path updates do not clear restore failures", async () => {
  const restoreFailureRoute = {
    ok: false,
    error: "任务恢复记录读取失败。",
    statusCode: 500
  };
  const pickerRenderer = await loadRenderer({
    native: {
      pickPath: () => ({ canceled: false, path: "/work/picked.mov" })
    },
    routes: {
      "GET /api/jobs": restoreFailureRoute
    }
  });
  const [inputFileButton] = pickerRenderer.document.querySelectorAll("[data-picker]");

  inputFileButton.dispatchEvent(new FakeEvent("click"));
  await pickerRenderer.flush();

  assert.equal(pickerRenderer.elements.inputPath.value, "/work/picked.mov");
  assert.equal(pickerRenderer.elements.errorPanel.hidden, false);
  assert.match(pickerRenderer.elements.errorPanel.textContent, /无法恢复上次任务状态/);

  const dropRenderer = await loadRenderer({
    routes: {
      "GET /api/jobs": restoreFailureRoute
    }
  });

  dropRenderer.elements.dropZone.dispatchEvent(new FakeEvent("drop", {
    dataTransfer: { files: [{ name: "dropped.mov", path: "/work/dropped.mov" }] }
  }));
  await dropRenderer.flush();

  assert.equal(dropRenderer.elements.inputPath.value, "/work/dropped.mov");
  assert.equal(dropRenderer.elements.errorPanel.hidden, false);
  assert.match(dropRenderer.elements.errorPanel.textContent, /无法恢复上次任务状态/);
});

test("renderer picker and drop failures do not hide restore failure as the primary blocker", async () => {
  const restoreFailureRoute = {
    ok: false,
    error: "任务恢复记录读取失败。",
    statusCode: 500
  };
  const pickerRenderer = await loadRenderer({
    native: {
      pickPath: () => ({ canceled: false, path: "", error: "系统路径选择器不可用。" })
    },
    routes: {
      "GET /api/jobs": restoreFailureRoute
    }
  });
  const [inputFileButton] = pickerRenderer.document.querySelectorAll("[data-picker]");

  inputFileButton.dispatchEvent(new FakeEvent("click"));
  await pickerRenderer.flush();

  assert.equal(pickerRenderer.elements.errorPanel.hidden, false);
  assert.match(pickerRenderer.elements.errorPanel.textContent, /无法恢复上次任务状态/);
  assert.match(pickerRenderer.elements.errorPanel.textContent, /系统路径选择器不可用/);
  assert.ok(
    pickerRenderer.elements.errorPanel.textContent.indexOf("无法恢复上次任务状态")
      < pickerRenderer.elements.errorPanel.textContent.indexOf("系统路径选择器不可用")
  );

  const dropRenderer = await loadRenderer({
    routes: {
      "GET /api/jobs": restoreFailureRoute
    }
  });

  dropRenderer.elements.dropZone.dispatchEvent(new FakeEvent("drop", {
    dataTransfer: { files: [{ name: "dropped.mov" }] }
  }));
  await dropRenderer.flush();

  assert.equal(dropRenderer.elements.errorPanel.hidden, false);
  assert.match(dropRenderer.elements.errorPanel.textContent, /无法恢复上次任务状态/);
  assert.match(dropRenderer.elements.errorPanel.textContent, /无法读取 dropped\.mov 的本地路径/);
  assert.ok(
    dropRenderer.elements.errorPanel.textContent.indexOf("无法恢复上次任务状态")
      < dropRenderer.elements.errorPanel.textContent.indexOf("无法读取 dropped.mov 的本地路径")
  );
});

test("renderer restores persistence warnings after corrected local validation", async () => {
  const persistence = {
    configured: true,
    ok: false,
    error: "任务恢复记录暂时无法写入。"
  };
  const inputRenderer = await loadRenderer({
    routes: {
      "GET /api/spec": {
        ok: true,
        defaults: {
          outDir: "/tmp/apple-motion-output"
        },
        persistence
      }
    }
  });

  inputRenderer.elements.inputPath.value = "";
  inputRenderer.elements.outDir.value = "/work/out";
  inputRenderer.submitForm();
  await inputRenderer.flush();
  assert.match(inputRenderer.elements.errorPanel.textContent, /需要输入文件或文件夹路径/);

  inputRenderer.elements.inputPath.value = "/work/new.mov";
  inputRenderer.elements.inputPath.dispatchEvent(new FakeEvent("input", { bubbles: true }));
  await inputRenderer.flush();

  assert.equal(inputRenderer.elements.errorPanel.hidden, false);
  assert.match(inputRenderer.elements.errorPanel.textContent, /任务恢复记录无法写入/);
  assert.doesNotMatch(inputRenderer.elements.errorPanel.textContent, /需要输入文件或文件夹路径/);

  const outputRenderer = await loadRenderer({
    routes: {
      "GET /api/spec": {
        ok: true,
        defaults: {
          outDir: ""
        },
        persistence
      }
    }
  });

  outputRenderer.elements.inputPath.value = "/work/new.mov";
  outputRenderer.elements.outDir.value = "";
  outputRenderer.submitForm();
  await outputRenderer.flush();
  assert.match(outputRenderer.elements.errorPanel.textContent, /需要输出文件夹路径/);

  outputRenderer.elements.outDir.value = "/work/out";
  outputRenderer.elements.outDir.dispatchEvent(new FakeEvent("input", { bubbles: true }));
  await outputRenderer.flush();

  assert.equal(outputRenderer.elements.errorPanel.hidden, false);
  assert.match(outputRenderer.elements.errorPanel.textContent, /任务恢复记录无法写入/);
  assert.doesNotMatch(outputRenderer.elements.errorPanel.textContent, /需要输出文件夹路径/);
});

test("renderer renders restored active job context when the first poll fails", async () => {
  const activeJob = createRunningJob();
  const renderer = await loadRenderer({
    routes: {
      "GET /api/jobs": { ok: true, jobs: [activeJob] },
      "GET /api/jobs/job-active/poll": {
        ok: false,
        error: "本地桥接暂时不可用。",
        statusCode: 500
      }
    }
  });

  assert.equal(renderer.elements.stopButton.disabled, false);
  assert.match(renderer.elements.queueBody.innerHTML, /active\.mov/);
  assert.match(renderer.elements.jobBadge.textContent, /处理中/);
  assert.match(renderer.elements.errorPanel.textContent, /连接中断/);
  assert.equal(renderer.lastTimer?.kind, "timeout");
});

test("renderer preserves row focus after keyboard queue selection", async () => {
  const job = createTwoItemFinishedJob();
  const renderer = await loadRenderer({
    routes: {
      "GET /api/jobs": { ok: true, jobs: [job] },
      "GET /api/jobs/job-two-items?full=1": { ok: true, job }
    }
  });

  const [firstRow] = renderer.elements.queueBody.querySelectorAll("[data-input-key]");
  assert.equal(firstRow.dataset.inputKey, "0");
  const selectButton = firstRow.querySelector("[data-row-select]");
  assert.ok(selectButton);

  selectButton.focus();
  selectButton.dispatchEvent(new FakeEvent("click", {
    bubbles: true,
    target: selectButton
  }));

  const selectedRow = renderer.elements.queueBody
    .querySelectorAll("[data-input-key]")
    .find((row) => row.dataset.inputKey === "0");
  assert.ok(selectedRow);
  assert.equal(selectedRow.classList.contains("selected"), true);
  assert.equal(renderer.document.activeElement, selectedRow.querySelector("[data-row-select]"));
});

test("renderer preserves focused queue row across background poll refreshes", async () => {
  const activeJob = createTwoItemRunningJob();
  const renderer = await loadRenderer({
    routes: {
      "GET /api/jobs": { ok: true, jobs: [activeJob] },
      "GET /api/jobs/job-two-active/poll": { ok: true, job: activeJob }
    }
  });

  const focusedRow = renderer.elements.queueBody
    .querySelectorAll("[data-input-key]")
    .find((row) => row.dataset.inputKey === "1");
  assert.ok(focusedRow);
  const focusedSelectButton = focusedRow.querySelector("[data-row-select]");
  assert.ok(focusedSelectButton);
  focusedSelectButton.focus();

  await renderer.runLastTimer();

  const recreatedRow = renderer.elements.queueBody
    .querySelectorAll("[data-input-key]")
    .find((row) => row.dataset.inputKey === "1");
  assert.ok(recreatedRow);
  assert.equal(renderer.document.activeElement, recreatedRow.querySelector("[data-row-select]"));
});

test("renderer moves queue focus to the retained current row when the focused row is clipped", async () => {
  const activeJob = createTwoItemRunningJob();
  const clippedJob = createTwoItemRunningJob();
  clippedJob.current = "/work/second.mov";
  clippedJob.items = [clippedJob.items[1]];
  clippedJob.itemsOffset = 1;
  clippedJob.totalItems = 2;
  let pollCalls = 0;
  const renderer = await loadRenderer({
    routes: {
      "GET /api/jobs": { ok: true, jobs: [activeJob] },
      "GET /api/jobs/job-two-active/poll": () => {
        pollCalls += 1;
        return { ok: true, job: pollCalls === 1 ? activeJob : clippedJob };
      }
    }
  });

  const secondRow = renderer.elements.queueBody
    .querySelectorAll("[data-input-key]")
    .find((row) => row.dataset.inputKey === "1");
  assert.ok(secondRow);
  const focusedSelectButton = secondRow.querySelector("[data-row-select]");
  assert.ok(focusedSelectButton);
  focusedSelectButton.focus();

  await renderer.runLastTimer();

  const [retainedRow] = renderer.elements.queueBody.querySelectorAll("[data-input-key]");
  assert.ok(retainedRow);
  assert.match(renderer.elements.queueBody.innerHTML, /second\.mov/);
  assert.equal(renderer.document.activeElement, retainedRow.querySelector("[data-row-select]"));
});

test("renderer moves queue focus to a stable control when refreshed items become empty", async () => {
  const activeJob = createTwoItemRunningJob();
  const emptiedJob = {
    ...activeJob,
    current: null,
    items: []
  };
  let pollCalls = 0;
  const renderer = await loadRenderer({
    routes: {
      "GET /api/jobs": { ok: true, jobs: [activeJob] },
      "GET /api/jobs/job-two-active/poll": () => {
        pollCalls += 1;
        return { ok: true, job: pollCalls === 1 ? activeJob : emptiedJob };
      }
    }
  });

  const secondRow = renderer.elements.queueBody
    .querySelectorAll("[data-input-key]")
    .find((row) => row.dataset.inputKey === "1");
  assert.ok(secondRow);
  const focusedSelectButton = secondRow.querySelector("[data-row-select]");
  assert.ok(focusedSelectButton);
  focusedSelectButton.focus();

  await renderer.runLastTimer();

  assert.equal(renderer.elements.queueBody.querySelectorAll("[data-input-key]").length, 0);
  assert.equal(renderer.document.activeElement, renderer.elements.clearHistoryButton);
});

test("renderer preserves manual log scroll position during background poll refreshes", async () => {
  const activeJob = createRunningJob();
  activeJob.logs = createJobLogs("poll log", 8);
  const refreshedJob = {
    ...activeJob,
    logs: createJobLogs("poll log", 9)
  };
  const renderer = await loadRenderer({
    routes: {
      "GET /api/jobs": { ok: true, jobs: [activeJob] },
      "GET /api/jobs/job-active/poll": { ok: true, job: refreshedJob }
    }
  });

  renderer.elements.jobLog.clientHeight = 200;
  renderer.elements.jobLog.scrollHeight = 1000;
  renderer.elements.jobLog.scrollTop = 120;

  await renderer.runLastTimer();

  assert.match(renderer.elements.jobLog.textContent, /poll log 8/);
  assert.equal(renderer.elements.jobLog.scrollTop, 120);
});

test("renderer gives generated previews a file-specific accessible name", async () => {
  const job = createTwoItemFinishedJob({ current: "/work/first.mov" });
  job.items[0].inputLabel = "first.mov";
  job.items[1].inputLabel = "second.mov";
  const renderer = await loadRenderer({
    routes: {
      "GET /api/jobs": { ok: true, jobs: [job] },
      "GET /api/jobs/job-two-items?full=1": { ok: true, job }
    }
  });

  assert.equal(renderer.elements.previewImage.alt, "first.mov 的 3x4 预览");

  const secondRow = renderer.elements.queueBody
    .querySelectorAll("[data-input-key]")
    .find((row) => row.dataset.inputKey === "1");
  const selectButton = secondRow.querySelector("[data-row-select]");
  selectButton.dispatchEvent(new FakeEvent("click", {
    bubbles: true,
    target: selectButton
  }));

  assert.equal(renderer.elements.previewImage.alt, "second.mov 的 3x4 预览");
});

test("renderer does not re-log a broken preview on every same-job re-render", async () => {
  const job = createBrokenPreviewJob();
  let revealCalls = 0;
  const renderer = await loadRenderer({
    routes: {
      "GET /api/jobs": { ok: true, jobs: [job] },
      "GET /api/jobs/job-broken-preview?full=1": { ok: true, job },
      "POST /api/reveal": ({ body }) => {
        revealCalls += 1;
        assert.equal(body.id, "asset-preview-first");
        assert.equal("path" in body, false);
        return { ok: true };
      }
    }
  });

  renderer.elements.previewImage.onerror();
  const firstLog = renderer.elements.jobLog.textContent;
  assert.equal(countOccurrences(firstLog, "预览文件无法加载"), 1);
  assert.equal(renderer.elements.previewImage.onerror, null);

  const [row] = renderer.elements.queueBody.querySelectorAll("[data-input-key]");
  const selectButton = row.querySelector("[data-row-select]");
  assert.ok(selectButton);
  selectButton.focus();
  selectButton.dispatchEvent(new FakeEvent("click", {
    bubbles: true,
    target: selectButton
  }));

  assert.match(renderer.elements.errorPanel.textContent, /预览文件无法加载/);
  assert.equal(renderer.elements.previewImage.onerror, null);
  assert.equal(renderer.elements.previewImage.src, undefined);
  assert.match(renderer.elements.previewEmpty.textContent, /预览加载失败/);
  assert.equal(renderer.elements.revealPreviewButton.disabled, false);

  renderer.elements.revealPreviewButton.dispatchEvent(new FakeEvent("click"));
  await renderer.flush();

  assert.equal(revealCalls, 1);
});

test("renderer lets an explicit row preview click retry a failed preview asset", async () => {
  const job = createBrokenPreviewJob();
  const renderer = await loadRenderer({
    routes: {
      "GET /api/jobs": { ok: true, jobs: [job] },
      "GET /api/jobs/job-broken-preview?full=1": { ok: true, job }
    }
  });

  renderer.elements.previewImage.onerror();
  assert.equal(countOccurrences(renderer.elements.jobLog.textContent, "预览文件无法加载"), 1);
  assert.equal(renderer.elements.previewImage.onerror, null);

  const [row] = renderer.elements.queueBody.querySelectorAll("[data-input-key]");
  const previewButton = row.querySelectorAll("[data-asset]")
    .find((button) => button.dataset.kind === "preview");
  assert.ok(previewButton);
  const clickEvent = new FakeEvent("click", {
    bubbles: true,
    target: previewButton
  });
  previewButton.dispatchEvent(clickEvent);

  assert.equal(clickEvent.propagationStopped, true);
  assert.equal(renderer.elements.previewImage.src, "/api/asset?id=asset-preview-first");
  assert.equal(typeof renderer.elements.previewImage.onerror, "function");
});

test("renderer treats successful delegated row report opens as handled without false failure logs", async () => {
  const job = createFinishedJob();
  const renderer = await loadRenderer({
    open: () => ({}),
    routes: {
      "GET /api/jobs": { ok: true, jobs: [job] },
      "GET /api/jobs/job-previous?full=1": { ok: true, job }
    }
  });

  const [row] = renderer.elements.queueBody.querySelectorAll("[data-input-key]");
  const reportButton = row.querySelectorAll("[data-asset]")
    .find((button) => button.dataset.kind === "report");
  assert.ok(reportButton);

  reportButton.dispatchEvent(new FakeEvent("click", {
    bubbles: true,
    target: reportButton
  }));
  await renderer.flush();

  assert.equal(renderer.openCalls.length, 1);
  assert.doesNotMatch(renderer.elements.errorPanel.textContent, /报告无法在新窗口打开/);
  assert.doesNotMatch(renderer.elements.jobLog.textContent, /报告无法在新窗口打开/);
  assert.doesNotMatch(renderer.elements.toast.textContent, /报告无法在新窗口打开/);
});

test("renderer reports blocked row report windows with a recovery path", async () => {
  const job = createFinishedJob();
  const renderer = await loadRenderer({
    open: () => null,
    routes: {
      "GET /api/jobs": { ok: true, jobs: [job] },
      "GET /api/jobs/job-previous?full=1": { ok: true, job }
    }
  });

  const [row] = renderer.elements.queueBody.querySelectorAll("[data-input-key]");
  const reportButton = row.querySelectorAll("[data-asset]")
    .find((button) => button.dataset.kind === "report");
  assert.ok(reportButton);

  reportButton.dispatchEvent(new FakeEvent("click", {
    bubbles: true,
    target: reportButton
  }));
  await renderer.flush();

  assert.equal(renderer.openCalls.length, 1);
  assert.match(renderer.elements.errorPanel.textContent, /报告无法在新窗口打开/);
  assert.match(renderer.elements.jobLog.textContent, /报告无法在新窗口打开/);
  assert.match(renderer.elements.toast.textContent, /显示报告文件/);
});

test("renderer delegates report opening to the desktop bridge without false failure logs", async () => {
  const job = createFinishedJob();
  const openedAssets = [];
  const renderer = await loadRenderer({
    native: {
      openAsset: async (assetId) => {
        openedAssets.push(assetId);
        return { ok: true };
      }
    },
    open: () => {
      throw new Error("window.open should not be used in desktop mode");
    },
    routes: {
      "GET /api/jobs": { ok: true, jobs: [job] },
      "GET /api/jobs/job-previous?full=1": { ok: true, job }
    }
  });

  const [row] = renderer.elements.queueBody.querySelectorAll("[data-input-key]");
  const reportButton = row.querySelectorAll("[data-asset]")
    .find((button) => button.dataset.kind === "report");
  assert.ok(reportButton);

  reportButton.dispatchEvent(new FakeEvent("click", {
    bubbles: true,
    target: reportButton
  }));
  await renderer.flush();

  assert.deepEqual(openedAssets, ["asset-report-old"]);
  assert.equal(renderer.openCalls.length, 0);
  assert.doesNotMatch(renderer.elements.errorPanel.textContent, /报告无法在新窗口打开/);
  assert.doesNotMatch(renderer.elements.jobLog.textContent, /报告无法在新窗口打开/);
  assert.doesNotMatch(renderer.elements.toast.textContent, /报告无法在新窗口打开/);
});

test("renderer reports desktop bridge report-open failures with the recovery path", async () => {
  const job = createFinishedJob();
  const renderer = await loadRenderer({
    native: {
      openAsset: async () => ({ ok: false, error: "无法打开报告文件。请使用右侧“显示报告文件”按钮或输出目录复核。" })
    },
    routes: {
      "GET /api/jobs": { ok: true, jobs: [job] },
      "GET /api/jobs/job-previous?full=1": { ok: true, job }
    }
  });

  const [row] = renderer.elements.queueBody.querySelectorAll("[data-input-key]");
  const reportButton = row.querySelectorAll("[data-asset]")
    .find((button) => button.dataset.kind === "report");
  assert.ok(reportButton);

  reportButton.dispatchEvent(new FakeEvent("click", {
    bubbles: true,
    target: reportButton
  }));
  await renderer.flush();

  assert.equal(renderer.openCalls.length, 0);
  assert.match(renderer.elements.errorPanel.textContent, /报告无法在新窗口打开/);
  assert.match(renderer.elements.jobLog.textContent, /报告无法在新窗口打开/);
  assert.match(renderer.elements.toast.textContent, /显示报告文件/);
});

test("renderer opens row report assets through the trusted local URL directly", async () => {
  const job = createFinishedJob();
  const renderer = await loadRenderer({
    routes: {
      "GET /api/jobs": { ok: true, jobs: [job] },
      "GET /api/jobs/job-previous?full=1": { ok: true, job }
    }
  });

  const [row] = renderer.elements.queueBody.querySelectorAll("[data-input-key]");
  const reportButton = row.querySelectorAll("[data-asset]")
    .find((button) => button.dataset.kind === "report");
  assert.ok(reportButton);

  reportButton.dispatchEvent(new FakeEvent("click", {
    bubbles: true,
    target: reportButton
  }));
  await renderer.flush();

  assert.equal(renderer.openCalls.length, 1);
  assert.equal(renderer.openCalls[0][1], "_blank");
  assert.equal(renderer.openCalls[0][0], "/api/asset?id=asset-report-old");
  assert.notEqual(renderer.openCalls[0][0], "about:blank");
});

test("renderer uses opaque asset ids instead of raw paths in asset controls", async () => {
  const job = createFinishedJob();
  const renderer = await loadRenderer({
    routes: {
      "GET /api/jobs": { ok: true, jobs: [job] },
      "GET /api/jobs/job-previous?full=1": { ok: true, job }
    }
  });

  const buttons = renderer.elements.queueBody.querySelectorAll("[data-asset]");
  assert.equal(buttons.some((button) => /\/work\/out/.test(button.dataset.asset)), false);
  assert.deepEqual(buttons.map((button) => button.dataset.asset), [
    "asset-preview-old",
    "asset-report-old"
  ]);
  assert.equal(renderer.elements.previewImage.src, "/api/asset?id=asset-preview-old");
});

test("renderer keeps row action clicks to one selection path and restores action focus", async () => {
  const job = createTwoItemFinishedJob({ current: "/work/first.mov" });
  const renderer = await loadRenderer({
    routes: {
      "GET /api/jobs": { ok: true, jobs: [job] },
      "GET /api/jobs/job-two-items?full=1": { ok: true, job }
    }
  });

  const rows = renderer.elements.queueBody.querySelectorAll("[data-input-key]");
  assert.equal(rows[0].classList.contains("selected"), true);

  const reportButton = rows[1].querySelectorAll("[data-asset]")
    .find((button) => button.dataset.kind === "report");
  assert.ok(reportButton);
  reportButton.focus();
  const clickEvent = new FakeEvent("click", {
    bubbles: true,
    target: reportButton
  });
  reportButton.dispatchEvent(clickEvent);

  const selectedRow = renderer.elements.queueBody
    .querySelectorAll("[data-input-key]")
    .find((row) => row.dataset.inputKey === "1");
  const focusedReportButton = selectedRow
    .querySelectorAll("[data-asset]")
    .find((button) => button.dataset.kind === "report");

  assert.equal(renderer.openCalls.length, 1);
  assert.equal(clickEvent.propagationStopped, true);
  assert.ok(selectedRow);
  assert.equal(selectedRow.classList.contains("selected"), true);
  assert.equal(renderer.document.activeElement, focusedReportButton);
});

async function loadRenderer({ routes = {}, confirm = () => true, native = null, open = () => ({}), testConsole = console } = {}) {
  const source = await readFile(path.join(projectRoot, "ui", "public", "app.js"), "utf8");
  const document = new FakeDocument();
  const calls = [];
  const openCalls = [];
  let lastTimer = null;
  const routeMap = {
    "GET /api/health": {
      ok: true,
      platform: "darwin",
      arch: "arm64",
      node: "v20.0.0"
    },
    "GET /api/spec": {
      ok: true,
      defaults: {
        outDir: "/tmp/apple-motion-output"
      }
    },
    "GET /api/jobs": {
      ok: true,
      jobs: []
    },
    ...routes
  };

  const context = {
    console: testConsole,
    document,
    window: {
      confirm,
      fadNative: native,
      open: (...args) => {
        openCalls.push(args);
        return open(...args);
      }
    },
    Event: FakeEvent,
    FormData: FakeFormData,
    HTMLInputElement: FakeInputElement,
    AbortController,
    fetch: async (url, options = {}) => {
      const method = options.method ?? "GET";
      const key = `${method} ${url}`;
      const body = options.body ? JSON.parse(options.body) : null;
      calls.push({ method, url, body, signal: options.signal });
      const handler = routeMap[key];
      if (!handler) {
        return jsonResponse({ ok: false, error: `Unhandled test route: ${key}` }, 500);
      }
      const payload = typeof handler === "function"
        ? await handler({ method, url, body, calls, signal: options.signal })
        : handler;
      if (payload && typeof payload === "object" && Object.hasOwn(payload, "rawText")) {
        return textResponse(payload.rawText, payload.statusCode ?? 200);
      }
      return jsonResponse(payload, payload.statusCode ?? 200);
    },
    setInterval: (callback, ms) => {
      lastTimer = { kind: "interval", callback, ms };
      return lastTimer;
    },
    clearInterval: () => {},
    setTimeout: (callback, ms) => {
      lastTimer = { kind: "timeout", callback, ms };
      return lastTimer;
    },
    clearTimeout: () => {}
  };
  vm.createContext(context);
  vm.runInContext(source, context, {
    filename: path.join(projectRoot, "ui", "public", "app.js")
  });
  await flushPromises();

  return {
    calls,
    document,
    elements: document.elements,
    get lastTimer() {
      return lastTimer;
    },
    openCalls,
    runLastTimer: async () => {
      const callback = lastTimer?.callback;
      if (typeof callback === "function") await callback();
      await flushPromises();
    },
    submitForm: () => document.elements.jobForm.dispatchEvent(new FakeEvent("submit")),
    pressEnterIn: (target, init = {}) => document.elements.jobForm.dispatchEvent(new FakeEvent("keydown", { key: "Enter", target, ...init })),
    flush: flushPromises
  };
}

function createFinishedJob() {
  const now = new Date("2026-06-08T00:00:00.000Z").toISOString();
  return {
    id: "job-previous",
    status: "warning",
    current: null,
    total: 1,
    completed: 1,
    passed: 0,
    warnings: 1,
    failed: 0,
    logs: [{ at: now, level: "warn", message: "old.mov 有 1 个警告。" }],
    items: [{
      inputPath: "/work/old.mov",
      status: "warning",
      result: {
        status: "warning",
        assets: {
          preview: "/work/out/old-preview.png",
          reportHtml: "/work/out/report.html"
        },
        assetIds: {
          preview: "asset-preview-old",
          reportHtml: "asset-report-old"
        },
        issueSummary: {
          errorCount: 0,
          warningCount: 1,
          issues: [{
            severity: "warning",
            target: "3x4",
            message: "边缘安全区需要人工复核。"
          }]
        },
        report: {
          ok: false
        }
      }
    }]
  };
}

function createRunningJob({ id = "job-active", current = "/work/active.mov" } = {}) {
  const now = new Date("2026-06-08T00:00:00.000Z").toISOString();
  return {
    id,
    status: "running",
    current,
    total: 1,
    completed: 0,
    passed: 0,
    warnings: 0,
    failed: 0,
    logs: [{ at: now, level: "info", message: `${path.basename(current)} 正在处理。` }],
    items: [{
      inputPath: current,
      status: "running",
      currentStage: { name: "render", target: "3x4", state: "active" },
      error: "正在处理",
      result: null
    }]
  };
}

function createJobLogs(prefix, count) {
  return Array.from({ length: count }, (_value, index) => ({
    at: new Date(Date.UTC(2026, 5, 8, 0, 0, index)).toISOString(),
    level: "info",
    message: `${prefix} ${index}`
  }));
}

function createJobLevelFailureJob() {
  const now = new Date("2026-06-08T00:00:00.000Z").toISOString();
  return {
    id: "job-failed",
    status: "failed",
    current: null,
    total: 0,
    completed: 0,
    passed: 0,
    warnings: 0,
    failed: 1,
    error: "编码器不可用。请检查 FFmpeg 路径或改用 x264。",
    logs: [{ at: now, level: "error", message: "编码器不可用。请检查 FFmpeg 路径或改用 x264。" }],
    items: []
  };
}

function createClippedLogJob() {
  const now = new Date("2026-06-08T00:00:00.000Z").toISOString();
  return {
    id: "job-clipped-logs",
    status: "succeeded",
    current: null,
    total: 1,
    completed: 1,
    passed: 1,
    warnings: 0,
    failed: 0,
    logsOffset: 7,
    totalLogs: 10,
    logsLimit: 3,
    logs: [7, 8, 9].map((index) => ({
      at: now,
      level: "info",
      message: `restored log ${index}`
    })),
    items: [{
      inputPath: "/work/clip.mov",
      status: "passed",
      result: {
        status: "passed",
        assets: {},
        issueSummary: { errorCount: 0, warningCount: 0, issues: [] },
        report: { ok: true }
      }
    }]
  };
}

function createQcOnlyFinishedJob() {
  const now = new Date("2026-06-08T00:00:00.000Z").toISOString();
  return {
    id: "job-qc-only",
    status: "succeeded",
    current: null,
    total: 1,
    completed: 1,
    passed: 1,
    warnings: 0,
    failed: 0,
    logs: [{ at: now, level: "info", message: "QC-only 完成。" }],
    items: [{
      inputPath: "/work/cover.mov",
      status: "passed",
      result: {
        status: "passed",
        outputPlan: {
          oneByOne: "/work/out/cover__apple-motion-1x1.mp4",
          threeByFour: "/work/out/cover__apple-motion-3x4.mp4",
          preview: "/work/out/cover__apple-motion-3x4-preview.png",
          reportJson: "/work/out/cover__apple-motion-qc.json",
          reportHtml: "/work/out/cover__apple-motion-qc.html"
        },
        assets: {
          reportJson: "/work/out/cover__apple-motion-qc.json",
          reportHtml: "/work/out/cover__apple-motion-qc.html"
        },
        assetIds: {
          reportJson: "asset-report-json-cover",
          reportHtml: "asset-report-html-cover"
        },
        issueSummary: {
          errorCount: 0,
          warningCount: 0,
          issues: []
        },
        report: { ok: true }
      }
    }]
  };
}

function createTwoItemFinishedJob({ current = null } = {}) {
  const now = new Date("2026-06-08T00:00:00.000Z").toISOString();
  const assetSlug = (inputPath) => path.basename(inputPath, path.extname(inputPath));
  const item = (inputPath, status) => ({
    inputPath,
    status,
    result: {
      status,
      assets: {
        preview: `/work/out/${path.basename(inputPath)}.png`,
        reportHtml: `/work/out/${path.basename(inputPath)}.html`
      },
      assetIds: {
        preview: `asset-preview-${assetSlug(inputPath)}`,
        reportHtml: `asset-report-${assetSlug(inputPath)}`
      },
      issueSummary: {
        errorCount: 0,
        warningCount: 0,
        issues: []
      },
      report: { ok: true }
    }
  });
  return {
    id: "job-two-items",
    status: "succeeded",
    current,
    total: 2,
    completed: 2,
    passed: 2,
    warnings: 0,
    failed: 0,
    logs: [{ at: now, level: "info", message: "任务完成：2 个文件。" }],
    items: [
      item("/work/first.mov", "passed"),
      item("/work/second.mov", "passed")
    ]
  };
}

function createTwoItemRunningJob() {
  const job = createTwoItemFinishedJob({ current: "/work/first.mov" });
  job.id = "job-two-active";
  job.status = "running";
  job.completed = 1;
  job.passed = 1;
  job.items[0].status = "passed";
  job.items[1].status = "processing";
  job.items[1].currentStage = { name: "render", target: "3x4", state: "active" };
  job.items[1].result = null;
  return job;
}

function createBrokenPreviewJob() {
  const job = createTwoItemFinishedJob();
  job.id = "job-broken-preview";
  job.total = 1;
  job.completed = 1;
  job.passed = 1;
  job.items = [job.items[0]];
  return job;
}

function jsonResponse(payload, status) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(payload)
  };
}

function textResponse(text, status) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => String(text)
  };
}

function countOccurrences(text, needle) {
  return text.split(needle).length - 1;
}

function flattenConsoleArgs(entries) {
  return entries
    .flat()
    .map((entry) => entry instanceof Error ? entry.stack || entry.message : String(entry))
    .join("\n");
}

async function flushPromises() {
  await Promise.resolve();
  await Promise.resolve();
  await new Promise((resolve) => setImmediate(resolve));
}

async function openClearHistoryDialog(renderer) {
  renderer.elements.clearHistoryButton.focus();
  renderer.elements.clearHistoryButton.dispatchEvent(new FakeEvent("click"));
  await renderer.flush();
  assert.equal(renderer.elements.clearHistoryDialog.hidden, false);
  assert.equal(renderer.document.activeElement, renderer.elements.clearHistoryCancelButton);
  assert.match(renderer.elements.clearHistoryDialogSummary.textContent, /不会删除任何输出文件/);
}

async function confirmClearHistory(renderer) {
  await openClearHistoryDialog(renderer);
  renderer.elements.clearHistoryConfirmButton.dispatchEvent(new FakeEvent("click"));
  await renderer.flush();
  assert.equal(renderer.elements.clearHistoryDialog.hidden, true);
}

class FakeFormData {
  constructor(form) {
    this.values = new Map();
    for (const control of form.controls) {
      if (!control.name) continue;
      if ((control.type === "checkbox" || control.type === "radio") && !control.checked) continue;
      this.values.set(control.name, control.type === "checkbox" ? "on" : control.value);
    }
  }

  get(name) {
    return this.values.has(name) ? this.values.get(name) : null;
  }
}

class FakeEvent {
  constructor(type, init = {}) {
    this.type = type;
    this.bubbles = Boolean(init.bubbles);
    this.key = init.key;
    this.isComposing = Boolean(init.isComposing);
    this.keyCode = init.keyCode;
    this.shiftKey = Boolean(init.shiftKey);
    this.target = init.target ?? null;
    this.currentTarget = null;
    this.defaultPrevented = false;
    this.propagationStopped = false;
    this.dataTransfer = init.dataTransfer;
  }

  preventDefault() {
    this.defaultPrevented = true;
  }

  stopPropagation() {
    this.propagationStopped = true;
  }
}

class FakeClassList {
  constructor(element) {
    this.element = element;
  }

  add(...names) {
    const classes = new Set(this.tokens());
    for (const name of names) classes.add(name);
    this.element.className = [...classes].join(" ");
  }

  remove(...names) {
    const removed = new Set(names);
    this.element.className = this.tokens().filter((name) => !removed.has(name)).join(" ");
  }

  contains(name) {
    return this.tokens().includes(name);
  }

  tokens() {
    return String(this.element.className || "").split(/\s+/).filter(Boolean);
  }
}

class FakeElement {
  constructor(tagName, ownerDocument) {
    this.tagName = tagName.toUpperCase();
    this.ownerDocument = ownerDocument;
    this.children = [];
    this.parentElement = null;
    this.dataset = {};
    this.style = {};
    this.listeners = new Map();
    this.className = "";
    this.classList = new FakeClassList(this);
    this.textContent = "";
    this._innerHTML = "";
    this.disabled = false;
    this.hidden = false;
    this.value = "";
    this.checked = false;
    this.type = "";
    this.name = "";
    this.scrollTop = 0;
    this.scrollHeight = 0;
  }

  setAttribute(name, value) {
    const normalizedValue = String(value);
    if (name === "id") {
      this.id = normalizedValue;
      this.ownerDocument.register(this);
      return;
    }
    if (name === "class") {
      this.className = normalizedValue;
      return;
    }
    if (name.startsWith("data-")) {
      this.dataset[dataKey(name.slice(5))] = normalizedValue;
      return;
    }
    this[name] = normalizedValue;
  }

  removeAttribute(name) {
    delete this[name];
  }

  get innerHTML() {
    return this._innerHTML;
  }

  set innerHTML(value) {
    if (isDescendant(this.ownerDocument.activeElement, this)) {
      this.ownerDocument.activeElement = null;
    }
    this._innerHTML = String(value);
    this.children = [];
    if (this.id === "queueBody") parseQueueRows(this);
  }

  append(child) {
    child.parentElement = this;
    this.children.push(child);
  }

  prepend(child) {
    child.parentElement = this;
    this.children.unshift(child);
  }

  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) ?? [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  dispatchEvent(event) {
    if (!event.target) event.target = this;
    event.currentTarget = this;
    for (const listener of this.listeners.get(event.type) ?? []) {
      listener(event);
    }
    if (event.bubbles && !event.propagationStopped && this.parentElement) {
      this.parentElement.dispatchEvent(event);
    }
    return !event.defaultPrevented;
  }

  focus() {
    if (this.disabled) return;
    this.ownerDocument.activeElement = this;
    this.ownerDocument.dispatchEvent(new FakeEvent("focusin", { target: this }));
  }

  select() {
    this.selected = true;
  }

  querySelectorAll(selector) {
    if (selector === "[data-input-key]") return findDescendants(this, (node) => Boolean(node.dataset.inputKey));
    if (selector === "[data-asset]") return findDescendants(this, (node) => Boolean(node.dataset.asset));
    if (selector === "[data-row-select]") return findDescendants(this, (node) => Boolean(node.dataset.rowSelect));
    return [];
  }

  querySelector(selector) {
    return this.querySelectorAll(selector)[0] ?? null;
  }

  closest(selector) {
    let node = this;
    while (node) {
      if (selector === "[data-input-key]" && node.dataset.inputKey) return node;
      node = node.parentElement;
    }
    return null;
  }
}

class FakeInputElement extends FakeElement {
  constructor(ownerDocument) {
    super("input", ownerDocument);
  }
}

class FakeFormElement extends FakeElement {
  constructor(ownerDocument) {
    super("form", ownerDocument);
    this.controls = [];
  }

  addControl(control) {
    control.parentElement = this;
    this.controls.push(control);
  }
}

class FakeDocument {
  constructor() {
    this.elements = {};
    this.all = [];
    this.activeElement = null;
    this.listeners = new Map();
    this.buildInitialTree();
  }

  buildInitialTree() {
    const plainIds = [
      "serverState",
      "metricTotal",
      "metricPass",
      "metricWarn",
      "metricFail",
      "jobBadge",
      "queueBody",
      "jobLog",
      "previewImage",
      "previewEmpty",
      "qcSummary",
      "qcIssues",
      "logRetentionNotice",
      "jobStatusAnnouncer",
      "errorPanel",
    "toast"
  ];
    for (const id of plainIds) this.addElement(id, new FakeElement("div", this));

    for (const id of ["startButton", "stopButton", "dryRunButton", "clearHistoryButton", "clearLogButton", "revealPreviewButton", "revealReportButton"]) {
      const button = this.addElement(id, new FakeElement("button", this));
      button.type = "button";
      button.dataset.icon = id === "startButton"
        ? "play"
        : id === "stopButton"
          ? "square"
          : id === "dryRunButton"
            ? "terminal"
            : id === "clearHistoryButton"
              ? "trash-2"
            : id === "clearLogButton"
              ? "x"
              : "external-link";
    }
    this.elements.stopButton.disabled = true;
    this.elements.revealPreviewButton.disabled = true;
    this.elements.revealReportButton.disabled = true;

    const overwriteDialog = this.addElement("overwriteDialog", new FakeElement("div", this));
    overwriteDialog.hidden = true;
    const overwriteDialogTitle = this.addElement("overwriteDialogTitle", new FakeElement("h2", this));
    const overwriteDialogSummary = this.addElement("overwriteDialogSummary", new FakeElement("p", this));
    const overwriteDialogList = this.addElement("overwriteDialogList", new FakeElement("ul", this));
    const overwriteDialogMore = this.addElement("overwriteDialogMore", new FakeElement("p", this));
    const overwriteCancelButton = this.addElement("overwriteCancelButton", new FakeElement("button", this));
    const overwriteConfirmButton = this.addElement("overwriteConfirmButton", new FakeElement("button", this));
    for (const child of [overwriteDialogTitle, overwriteDialogSummary, overwriteDialogList, overwriteDialogMore, overwriteCancelButton, overwriteConfirmButton]) {
      overwriteDialog.append(child);
    }

    const clearHistoryDialog = this.addElement("clearHistoryDialog", new FakeElement("div", this));
    clearHistoryDialog.hidden = true;
    const clearHistoryDialogTitle = this.addElement("clearHistoryDialogTitle", new FakeElement("h2", this));
    const clearHistoryDialogSummary = this.addElement("clearHistoryDialogSummary", new FakeElement("p", this));
    clearHistoryDialogSummary.textContent = "只会从队列中移除已完成的历史任务，不会删除任何输出文件。正在运行的任务会保留。";
    const clearHistoryCancelButton = this.addElement("clearHistoryCancelButton", new FakeElement("button", this));
    const clearHistoryConfirmButton = this.addElement("clearHistoryConfirmButton", new FakeElement("button", this));
    for (const child of [clearHistoryDialogTitle, clearHistoryDialogSummary, clearHistoryCancelButton, clearHistoryConfirmButton]) {
      clearHistoryDialog.append(child);
    }

    const dropZone = this.addElement("dropZone", new FakeElement("div", this));
    dropZone.dataset.icon = "file-video";

    const jobForm = this.addElement("jobForm", new FakeFormElement(this));
    const inputPath = this.input("inputPath", { name: "input", type: "text" });
    const outDir = this.input("outDir", { name: "outDir", type: "text" });
    const qcOnly = this.input("qcOnly", { name: "qcOnly", type: "checkbox" });
    const previewOnly = this.input("previewOnly", { name: "previewOnly", type: "checkbox" });
    const overwrite = this.input("overwrite", { name: "overwrite", type: "checkbox" });
    const fps = this.input("fps", { name: "fps", type: "text", value: "auto" });
    const bitrate = this.input("bitrate", { name: "bitrate", type: "text", value: "50M" });
    const ffmpegPath = this.input("ffmpegPath", { name: "ffmpegPath", type: "text" });
    const ffprobePath = this.input("ffprobePath", { name: "ffprobePath", type: "text" });
    const mode = this.input("modeScaleFill", { name: "mode", type: "radio", value: "scale-fill", checked: true });
    const encoder = this.input("encoder", { name: "encoder", value: "auto" });
    const container = this.input("container", { name: "container", value: "mp4" });
    for (const control of [inputPath, outDir, qcOnly, previewOnly, overwrite, fps, bitrate, ffmpegPath, ffprobePath, mode, encoder, container]) {
      jobForm.addControl(control);
    }

    this.picker("input-file-picker", "inputFile", "inputPath", "file-video");
    this.picker("input-folder-picker", "inputFolder", "inputPath", "folder");
    this.picker("output-folder-picker", "outputFolder", "outDir", "folder-open");

    this.elements.errorPanel.hidden = true;
  }

  addElement(id, element) {
    element.id = id;
    this.register(element);
    return element;
  }

  input(id, attributes) {
    const input = this.addElement(id, new FakeInputElement(this));
    Object.assign(input, attributes);
    return input;
  }

  picker(id, kind, target, icon) {
    const button = this.addElement(id, new FakeElement("button", this));
    button.type = "button";
    button.dataset.picker = kind;
    button.dataset.target = target;
    button.dataset.icon = icon;
    return button;
  }

  register(element) {
    this.elements[element.id] = element;
    if (!this.all.includes(element)) this.all.push(element);
  }

  querySelector(selector) {
    if (selector.startsWith("#")) return this.elements[selector.slice(1)] ?? null;
    if (selector.startsWith("[data-picker=")) {
      const kind = selector.match(/"([^"]+)"/)?.[1];
      return this.all.find((element) => element.dataset.picker === kind) ?? null;
    }
    return null;
  }

  querySelectorAll(selector) {
    if (selector === "[data-icon]") return this.all.filter((element) => element.dataset.icon);
    if (selector === "[data-picker]") return this.all.filter((element) => element.dataset.picker);
    return [];
  }

  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) ?? [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type, listener) {
    const listeners = this.listeners.get(type) ?? [];
    this.listeners.set(type, listeners.filter((candidate) => candidate !== listener));
  }

  dispatchEvent(event) {
    event.currentTarget = this;
    for (const listener of this.listeners.get(event.type) ?? []) {
      listener(event);
    }
    return !event.defaultPrevented;
  }

  getElementById(id) {
    return this.elements[id] ?? null;
  }

  createElementNS(_namespace, tagName) {
    return new FakeElement(tagName, this);
  }
}

function dataKey(name) {
  return name.replaceAll(/-([a-z])/g, (_, letter) => letter.toUpperCase());
}

function parseQueueRows(parent) {
  const rowPattern = /<tr\s+([^>]*)>([\s\S]*?)<\/tr>/g;
  let match;
  while ((match = rowPattern.exec(parent.innerHTML))) {
    const attributes = match[1];
    const content = match[2];
    const inputKey = attributeValue(attributes, "data-input-key");
    if (inputKey === null || inputKey === undefined) continue;
    const row = new FakeElement("tr", parent.ownerDocument);
    row.parentElement = parent;
    row.dataset.inputKey = decodeHtml(inputKey);
    row.className = decodeHtml(attributeValue(attributes, "class") ?? "");
    parent.children.push(row);
    parseQueueAssetButtons(row, content);
  }
}

function parseQueueAssetButtons(row, source) {
  const buttonPattern = /<button\s+([^>]*)>/g;
  let match;
  while ((match = buttonPattern.exec(source))) {
    const attributes = match[1];
    const asset = attributeValue(attributes, "data-asset");
    const button = new FakeElement("button", row.ownerDocument);
    button.parentElement = row;
    button.id = decodeHtml(attributeValue(attributes, "id") ?? "");
    if (asset) button.dataset.asset = decodeHtml(asset);
    button.dataset.kind = decodeHtml(attributeValue(attributes, "data-kind") ?? "");
    if (attributeValue(attributes, "data-row-select")) {
      button.dataset.rowSelect = decodeHtml(attributeValue(attributes, "data-row-select"));
    }
    button.disabled = /\sdisabled(?:\s|>|$)/.test(attributes);
    row.children.push(button);
  }
}

function findDescendants(root, predicate) {
  const matches = [];
  for (const child of root.children) {
    if (predicate(child)) matches.push(child);
    matches.push(...findDescendants(child, predicate));
  }
  return matches;
}

function isDescendant(node, root) {
  let current = node;
  while (current) {
    if (current === root) return true;
    current = current.parentElement;
  }
  return false;
}

function attributeValue(source, name) {
  const match = source.match(new RegExp(`${name}="([^"]*)"`));
  return match?.[1] ?? null;
}

function decodeHtml(value) {
  return String(value)
    .replaceAll("&quot;", "\"")
    .replaceAll("&#39;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&amp;", "&");
}
