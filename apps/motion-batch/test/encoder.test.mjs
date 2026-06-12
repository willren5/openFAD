import test from "node:test";
import assert from "node:assert/strict";

import {
  buildEncoderSmokeArgs,
  encoderFromName,
  getAutoEncoderOrder,
  parseAvailableEncoders,
  parseWindowsGpuVendors,
  pickEncoder,
  resolveEncoder
} from "../src/encoder.mjs";

test("parses ffmpeg -encoders output into encoder names", () => {
  const output = `
 V....D libx264              libx264 H.264 / AVC / MPEG-4 AVC / MPEG-4 part 10
 V....D h264_nvenc           NVIDIA NVENC H.264 encoder
 V..... h264_qsv             H.264 video (Intel Quick Sync Video acceleration)
`;

  assert.deepEqual([...parseAvailableEncoders(output)].sort(), [
    "h264_nvenc",
    "h264_qsv",
    "libx264"
  ]);
});

test("maps friendly encoder names to ffmpeg codec names", () => {
  assert.deepEqual(encoderFromName("x264"), {
    name: "x264",
    codec: "libx264",
    filterFormat: "yuv420p"
  });
  assert.deepEqual(encoderFromName("nvenc"), {
    name: "nvenc",
    codec: "h264_nvenc",
    filterFormat: "yuv420p"
  });
  assert.deepEqual(encoderFromName("qsv"), {
    name: "qsv",
    codec: "h264_qsv",
    filterFormat: "nv12"
  });
});

test("auto prefers NVIDIA, then Intel QSV, then x264", () => {
  const options = { platform: "darwin" };

  assert.equal(pickEncoder("auto", new Set(["libx264", "h264_qsv", "h264_nvenc"]), options).name, "nvenc");
  assert.equal(pickEncoder("auto", new Set(["libx264", "h264_qsv"]), options).name, "qsv");
  assert.equal(pickEncoder("auto", new Set(["libx264"]), options).name, "x264");
});

test("Windows auto only picks hardware encoders when matching GPU vendors exist", () => {
  const available = new Set(["libx264", "h264_qsv", "h264_nvenc"]);

  assert.equal(pickEncoder("auto", available, {
    platform: "win32",
    gpuVendors: new Set(["nvidia", "intel"])
  }).name, "nvenc");

  assert.equal(pickEncoder("auto", available, {
    platform: "win32",
    gpuVendors: new Set(["intel"])
  }).name, "qsv");

  assert.equal(pickEncoder("auto", available, {
    platform: "win32",
    gpuVendors: new Set()
  }).name, "x264");
});

test("parses Windows GPU vendors from video controller names", () => {
  assert.deepEqual(parseWindowsGpuVendors(`
NVIDIA GeForce RTX 4070
Intel(R) Iris(R) Xe Graphics
Microsoft Basic Display Adapter
`), new Set(["nvidia", "intel"]));
});

test("Windows auto encoder order follows detected device priority", () => {
  assert.deepEqual(getAutoEncoderOrder({
    platform: "win32",
    gpuVendors: new Set(["intel"])
  }), ["qsv", "x264"]);
  assert.deepEqual(getAutoEncoderOrder({
    platform: "win32",
    gpuVendors: new Set(["nvidia", "intel"])
  }), ["nvenc", "qsv", "x264"]);
});

test("explicit hardware encoder errors when ffmpeg does not expose it", () => {
  assert.throws(() => pickEncoder("nvenc", new Set(["libx264"])), /h264_nvenc is not available/);
  assert.throws(() => pickEncoder("qsv", new Set(["libx264"])), /h264_qsv is not available/);
});

test("dry-run auto resolves without inspecting a local FFmpeg install", async () => {
  const encoder = await resolveEncoder("auto", {
    dryRun: true,
    run: async () => {
      throw new Error("dry-run should not spawn FFmpeg");
    }
  });

  assert.equal(encoder.name, "x264");
});

test("auto skips hardware encoders that fail runtime smoke", async () => {
  const calls = [];
  const encoder = await resolveEncoder("auto", {
    platform: "win32",
    gpuVendors: new Set(["nvidia"]),
    run: async (_command, args) => {
      calls.push(args);
      if (args.includes("-encoders")) {
        return {
          code: 0,
          stdout: `
 V....D libx264              libx264 H.264 / AVC / MPEG-4 AVC / MPEG-4 part 10
 V....D h264_nvenc           NVIDIA NVENC H.264 encoder
`,
          stderr: ""
        };
      }
      if (args.includes("h264_nvenc")) {
        return {
          code: 1,
          stdout: "",
          stderr: "[h264_nvenc] Driver does not support the required nvenc API version."
        };
      }
      if (args.includes("libx264")) {
        return { code: 0, stdout: "", stderr: "" };
      }
      throw new Error(`unexpected args: ${args.join(" ")}`);
    }
  });

  assert.equal(encoder.name, "x264");
  assert.equal(calls.some((args) => args.includes("h264_nvenc")), true);
  assert.equal(calls.some((args) => args.includes("libx264")), true);
});

test("encoder probe and runtime smoke use bounded timeouts", async () => {
  const calls = [];
  const encoder = await resolveEncoder("auto", {
    platform: "darwin",
    encoderProbeTimeoutMs: 1234,
    encoderSmokeTimeoutMs: 5678,
    run: async (_command, args, options = {}) => {
      if (args.includes("-encoders")) {
        calls.push({ kind: "probe", timeoutMs: options.timeoutMs });
        return {
          code: 0,
          stdout: " V....D libx264              libx264 H.264 / AVC / MPEG-4 AVC / MPEG-4 part 10\n",
          stderr: ""
        };
      }
      if (args.includes("libx264")) {
        calls.push({ kind: "smoke", timeoutMs: options.timeoutMs });
        return { code: 0, stdout: "", stderr: "" };
      }
      throw new Error(`unexpected args: ${args.join(" ")}`);
    }
  });

  assert.equal(encoder.name, "x264");
  assert.deepEqual(calls, [
    { kind: "probe", timeoutMs: 1234 },
    { kind: "smoke", timeoutMs: 5678 }
  ]);
});

test("Windows auto falls back to x264 when GPU detection cannot start", async () => {
  const calls = [];
  const encoder = await resolveEncoder("auto", {
    platform: "win32",
    run: async (command, args) => {
      calls.push(command);
      if (args.includes("-encoders")) {
        return {
          code: 0,
          stdout: " V....D libx264              libx264 H.264 / AVC / MPEG-4 AVC / MPEG-4 part 10\n",
          stderr: ""
        };
      }
      if (command === "powershell.exe") {
        const error = new Error("spawn powershell.exe ENOENT");
        error.code = "ENOENT";
        throw error;
      }
      if (args.includes("libx264")) {
        return { code: 0, stdout: "", stderr: "" };
      }
      throw new Error(`unexpected command: ${command} ${args.join(" ")}`);
    }
  });

  assert.equal(encoder.name, "x264");
  assert.deepEqual(calls, ["ffmpeg", "powershell.exe", "ffmpeg"]);
});

test("Windows GPU detection is bounded and falls back to x264 on timeout", async () => {
  const calls = [];
  let gpuDetectionTimeoutMs;
  const encoder = await resolveEncoder("auto", {
    platform: "win32",
    run: async (command, args, options = {}) => {
      calls.push(command);
      if (args.includes("-encoders")) {
        return {
          code: 0,
          stdout: " V....D libx264              libx264 H.264 / AVC / MPEG-4 AVC / MPEG-4 part 10\n",
          stderr: ""
        };
      }
      if (command === "powershell.exe") {
        gpuDetectionTimeoutMs = options.timeoutMs;
        const error = new Error("powershell.exe timed out.");
        error.name = "TimeoutError";
        error.code = "PROCESS_TIMEOUT";
        throw error;
      }
      if (args.includes("libx264")) {
        return { code: 0, stdout: "", stderr: "" };
      }
      throw new Error(`unexpected command: ${command} ${args.join(" ")}`);
    }
  });

  assert.equal(encoder.name, "x264");
  assert.equal(Number.isInteger(gpuDetectionTimeoutMs) && gpuDetectionTimeoutMs > 0, true);
  assert.deepEqual(calls, ["ffmpeg", "powershell.exe", "ffmpeg"]);
});

test("Windows auto propagates aborts from GPU detection", async () => {
  await assert.rejects(() => resolveEncoder("auto", {
    platform: "win32",
    run: async (command, args) => {
      if (args.includes("-encoders")) {
        return {
          code: 0,
          stdout: " V....D libx264              libx264 H.264 / AVC / MPEG-4 AVC / MPEG-4 part 10\n",
          stderr: ""
        };
      }
      if (command === "powershell.exe") {
        const error = new Error("GPU detection cancelled.");
        error.name = "AbortError";
        error.code = "ABORT_ERR";
        throw error;
      }
      return { code: 0, stdout: "", stderr: "" };
    }
  }), { name: "AbortError" });
});

test("explicit hardware encoder reports runtime smoke failure", async () => {
  await assert.rejects(() => resolveEncoder("nvenc", {
    platform: "win32",
    run: async (_command, args) => {
      if (args.includes("-encoders")) {
        return {
          code: 0,
          stdout: " V....D h264_nvenc           NVIDIA NVENC H.264 encoder\n",
          stderr: ""
        };
      }
      return {
        code: 1,
        stdout: "",
        stderr: "[h264_nvenc] The minimum required Nvidia driver for nvenc is 570.0 or newer"
      };
    }
  }), /failed a runtime smoke test/);
});

test("builds tiny encoder smoke args that open the selected codec", () => {
  const args = buildEncoderSmokeArgs({
    name: "qsv",
    codec: "h264_qsv",
    filterFormat: "nv12"
  });

  assert.equal(args.includes("h264_qsv"), true);
  assert.equal(args.includes("format=nv12"), true);
  assert.equal(args.at(-1), "-");
});
