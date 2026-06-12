import test from "node:test";
import assert from "node:assert/strict";

import {
  SAFE_AREA_3X4,
  buildPreviewArgs,
  buildRenderArgs
} from "../src/ffmpegArgs.mjs";

test("builds Windows-safe argument arrays for 1x1 H.264 output", () => {
  const args = buildRenderArgs({
    input: "input.mov",
    output: "out/cover-1x1.mp4",
    target: "1x1",
    fps: "30",
    bitrate: "45M",
    mode: "scale-fill"
  });

  assert.equal(Array.isArray(args), true);
  assert.equal(args.includes("-i"), true);
  assert.equal(args.includes("-an"), true);
  assert.equal(args.includes("-b:v"), true);
  assert.equal(args.includes("45M"), true);
  assert.equal(args.includes("-x264-params"), true);
  assert.equal(args.includes("nal-hrd=cbr:force-cfr=1"), true);
  assert.equal(args.includes("+faststart+write_colr"), true);
  assert.match(args.join(" "), /scale=3840:3840/);
  assert.match(args.join(" "), /out_color_matrix=bt709/);
  assert.match(args.join(" "), /crop=3840:3840/);
});

test("builds 3x4 fill render args that fill the whole Apple template", () => {
  const args = buildRenderArgs({
    input: "input.mov",
    output: "out/cover-3x4.mov",
    target: "3x4",
    fps: "30000/1001",
    bitrate: "50M",
    mode: "scale-fill"
  });

  assert.match(args.join(" "), /scale=2048:2732/);
  assert.match(args.join(" "), /crop=2048:2732/);
  assert.equal(args.at(-1), "out/cover-3x4.mov");
});

test("render args prevent MOV timecode/data tracks and copied metadata", () => {
  const args = buildRenderArgs({
    input: "input.mov",
    output: "out/cover-3x4.mov",
    target: "3x4",
    fps: "24",
    bitrate: "50M",
    mode: "scale-fill"
  });

  assert.equal(args.includes("-an"), true);
  assert.equal(args.includes("-dn"), true);
  assert.equal(args.includes("-sn"), true);
  assert.equal(args.includes("-map_metadata"), true);
  assert.equal(args[args.indexOf("-map_metadata") + 1], "-1");
  assert.equal(args.includes("-map_chapters"), true);
  assert.equal(args[args.indexOf("-map_chapters") + 1], "-1");
  assert.equal(args.includes("-write_tmcd"), true);
  assert.equal(args[args.indexOf("-write_tmcd") + 1], "0");
});

test("blur-extend render args map only the composed video stream", () => {
  const args = buildRenderArgs({
    input: "input.mov",
    output: "out/cover-3x4.mov",
    target: "3x4",
    fps: "24",
    bitrate: "50M",
    mode: "blur-extend"
  });

  const maps = args.flatMap((arg, index) => arg === "-map" ? [args[index + 1]] : []);
  assert.deepEqual(maps, ["[v]"]);
});

test("blur-extend filter reads only the first input video stream", () => {
  const args = buildRenderArgs({
    input: "input.mov",
    output: "out/cover-3x4.mov",
    target: "3x4",
    fps: "24",
    bitrate: "50M",
    mode: "blur-extend"
  });
  const filter = args[args.indexOf("-filter_complex") + 1];

  assert.match(filter, /\[0:v:0\].+\[0:v:0\]/);
  assert.doesNotMatch(filter, /\[0:v\]/);
});

test("builds NVIDIA NVENC render args", () => {
  const args = buildRenderArgs({
    input: "input.mov",
    output: "out/cover-3x4.mp4",
    target: "3x4",
    fps: "30",
    bitrate: "50M",
    mode: "scale-fill",
    encoder: { name: "nvenc", codec: "h264_nvenc", filterFormat: "yuv420p" }
  });

  assert.equal(args.includes("h264_nvenc"), true);
  assert.match(args.join(" "), /format=yuv420p/);
});

test("builds HDR to Rec.709 conversion args for BT.2020 PQ input", () => {
  const args = buildRenderArgs({
    input: "input.mov",
    output: "out/cover-3x4.mov",
    target: "3x4",
    fps: "30",
    bitrate: "50M",
    mode: "scale-fill",
    colorConversion: {
      mode: "hdr-to-rec709",
      matrix: "bt2020nc",
      transfer: "smpte2084",
      primaries: "bt2020"
    }
  });
  const joined = args.join(" ");

  assert.match(joined, /zscale=matrixin=bt2020nc:transferin=smpte2084:primariesin=bt2020:transfer=linear:npl=100/);
  assert.match(joined, /tonemap=tonemap=hable:desat=0/);
  assert.match(joined, /zscale=transfer=bt709:primaries=bt709:matrix=bt709:range=tv/);
  assert.doesNotMatch(joined, /out_color_matrix=bt709/);
});

test("builds HDR to Rec.709 conversion args for preview overlays", () => {
  const args = buildPreviewArgs({
    input: "input.mov",
    output: "preview.png",
    mode: "scale-fill",
    colorConversion: {
      mode: "hdr-to-rec709",
      matrix: "bt2020nc",
      transfer: "smpte2084",
      primaries: "bt2020"
    }
  });
  const filter = args[args.indexOf("-vf") + 1] ?? "";

  assert.match(filter, /zscale=matrixin=bt2020nc:transferin=smpte2084:primariesin=bt2020:transfer=linear:npl=100/);
  assert.match(filter, /tonemap=tonemap=hable:desat=0/);
  assert.match(filter, /zscale=transfer=bt709:primaries=bt709:matrix=bt709:range=tv/);
  assert.match(filter, /drawbox=x=124:y=429:w=1800:h=1280/);
  assert.doesNotMatch(filter, /out_color_matrix=bt709/);
});

test("rejects unsupported color conversion modes instead of silently tagging Rec.709", () => {
  assert.throws(() => buildRenderArgs({
    input: "input.mov",
    output: "out/cover-3x4.mp4",
    target: "3x4",
    fps: "30",
    bitrate: "50M",
    mode: "scale-fill",
    colorConversion: { mode: "tag-rec709" }
  }), /Unsupported color conversion mode/);

  assert.throws(() => buildPreviewArgs({
    input: "input.mov",
    output: "preview.png",
    mode: "scale-fill",
    colorConversion: { mode: "tag-rec709" }
  }), /Unsupported color conversion mode/);
});

test("builds Intel QSV render args with nv12 filter output", () => {
  const args = buildRenderArgs({
    input: "input.mov",
    output: "out/cover-3x4.mp4",
    target: "3x4",
    fps: "30",
    bitrate: "50M",
    mode: "scale-fill",
    encoder: { name: "qsv", codec: "h264_qsv", filterFormat: "nv12" }
  });

  assert.equal(args.includes("h264_qsv"), true);
  assert.match(args.join(" "), /format=nv12/);
});

test("exports the measured 3x4 Apple safe area", () => {
  assert.deepEqual(SAFE_AREA_3X4, {
    x: 124,
    y: 429,
    width: 1800,
    height: 1280
  });
});

test("builds preview args with safe-area overlay boxes", () => {
  const args = buildPreviewArgs({
    input: "input.mov",
    output: "preview.png",
    mode: "scale-fill"
  });

  assert.match(args.join(" "), /drawbox=x=124:y=429:w=1800:h=1280/);
  assert.equal(args.includes("-frames:v"), true);
  assert.equal(args.at(-1), "preview.png");
});

test("blur-extend preview args use the same background and foreground composition", () => {
  const args = buildPreviewArgs({
    input: "input.mov",
    output: "preview.png",
    mode: "blur-extend"
  });
  const filter = args[args.indexOf("-filter_complex") + 1] ?? "";
  const maps = args.flatMap((arg, index) => arg === "-map" ? [args[index + 1]] : []);

  assert.deepEqual(maps, ["[v]"]);
  assert.match(filter, /gblur=sigma=40/);
  assert.match(filter, /\[bg\]\[fg\]overlay=\(W-w\)\/2:\(H-h\)\/2/);
  assert.match(filter, /drawbox=x=124:y=429:w=1800:h=1280/);
  assert.match(filter, /\[0:v:0\].+\[0:v:0\]/);
  assert.doesNotMatch(filter, /\[0:v\]/);
});

test("preview args map exactly one input video stream and drop non-video streams", () => {
  const args = buildPreviewArgs({
    input: "input.mov",
    output: "preview.png",
    mode: "scale-fill"
  });

  const maps = args.flatMap((arg, index) => arg === "-map" ? [args[index + 1]] : []);
  assert.deepEqual(maps, ["0:v:0"]);
  assert.equal(args.includes("-an"), true);
  assert.equal(args.includes("-dn"), true);
  assert.equal(args.includes("-sn"), true);
});
