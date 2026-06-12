import { APPLE_TARGETS } from "./spec.mjs";
import { ENCODERS } from "./encoder.mjs";

export const SAFE_AREA_3X4 = {
  x: 124,
  y: 429,
  width: 1800,
  height: 1280
};

export function buildRenderArgs({
  input,
  output,
  target,
  fps = "30",
  bitrate = "45M",
  mode = "scale-fill",
  encoder = ENCODERS.x264,
  colorConversion = { mode: "none" }
}) {
  assertSupportedColorConversion(colorConversion);
  const targetSpec = APPLE_TARGETS[target];
  if (!targetSpec) throw new Error(`Unknown render target: ${target}`);

  const args = ["-y", "-i", input, "-an", "-dn", "-sn", "-map_metadata", "-1", "-map_chapters", "-1"];
  if (mode === "blur-extend" && target === "3x4") {
    args.push("-filter_complex", buildBlurExtendFilter(fps, encoder.filterFormat, colorConversion), "-map", "[v]");
  } else {
    args.push("-map", "0:v:0", "-vf", buildScaleFillFilter(targetSpec, fps, { pixelFormat: encoder.filterFormat, colorConversion }));
  }

  args.push(
    "-c:v",
    encoder.codec,
    "-profile:v",
    "main",
    "-pix_fmt",
    "yuv420p",
    "-color_primaries",
    "bt709",
    "-color_trc",
    "bt709",
    "-colorspace",
    "bt709",
    "-b:v",
    bitrate,
    "-minrate",
    bitrate,
    "-maxrate",
    bitrate,
    "-bufsize",
    normalizeBufferSize(bitrate),
    ...buildEncoderRateControlArgs(encoder, bitrate),
    "-movflags",
    "+faststart+write_colr",
    "-write_tmcd",
    "0",
    output
  );

  return args;
}

export function buildPreviewArgs({
  input,
  output,
  mode = "scale-fill",
  colorConversion = { mode: "none" }
}) {
  assertSupportedColorConversion(colorConversion);
  const targetSpec = APPLE_TARGETS["3x4"];
  const overlay = buildPreviewSafeAreaOverlay(targetSpec);
  const baseArgs = [
    "-y",
    "-i",
    input,
    "-an",
    "-dn",
    "-sn"
  ];

  if (mode === "blur-extend") {
    return [
      ...baseArgs,
      "-filter_complex",
      buildPreviewBlurExtendFilter(overlay, colorConversion),
      "-map",
      "[v]",
      "-frames:v",
      "1",
      output
    ];
  }

  const baseFilter = buildScaleFillFilter(targetSpec, "30", { includeFormat: false, colorConversion });

  return [
    ...baseArgs,
    "-map",
    "0:v:0",
    "-vf",
    `${baseFilter},${overlay.join(",")},format=rgb24`,
    "-frames:v",
    "1",
    output
  ];
}

export function buildQcBlackDetectArgs(input) {
  return ["-hide_banner", "-i", input, "-vf", "blackdetect=d=0.033:pic_th=0.98:pix_th=0.10", "-an", "-f", "null", "-"];
}

export function buildQcBlackFrameArgs(input) {
  return ["-hide_banner", "-i", input, "-vf", "blackframe=amount=98:threshold=32", "-an", "-f", "null", "-"];
}

export function buildQcFreezeDetectArgs(input) {
  return ["-hide_banner", "-i", input, "-vf", "freezedetect=n=0.003:d=0.5", "-an", "-f", "null", "-"];
}

function buildScaleFillFilter(targetSpec, fps, {
  includeFormat = true,
  pixelFormat = "yuv420p",
  colorConversion = { mode: "none" }
} = {}) {
  const pieces = [
    buildScaleFilter(targetSpec, colorConversion),
    `crop=${targetSpec.width}:${targetSpec.height}`,
    "setsar=1",
    `fps=${fps}`
  ];
  pieces.push(...buildColorConversionPieces(colorConversion, { includeFormat, pixelFormat }));
  return pieces.join(",");
}

function buildBlurExtendFilter(fps, pixelFormat = "yuv420p", colorConversion = { mode: "none" }) {
  return buildBlurExtendGraph({
    fps,
    colorConversion,
    terminalFilters: buildColorConversionPieces(colorConversion, { includeFormat: true, pixelFormat })
  });
}

function buildPreviewBlurExtendFilter(overlay, colorConversion = { mode: "none" }) {
  return buildBlurExtendGraph({
    colorConversion,
    terminalFilters: [
      ...overlay,
      "format=rgb24"
    ]
  });
}

function buildBlurExtendGraph({
  fps = null,
  colorConversion = { mode: "none" },
  terminalFilters = []
}) {
  const finalFilters = [
    "overlay=(W-w)/2:(H-h)/2",
    ...(fps ? [`fps=${fps}`] : []),
    ...terminalFilters
  ];

  return [
    `[0:v:0]${buildScaleFilter({ width: 2048, height: 2732 }, colorConversion)},crop=2048:2732,gblur=sigma=40,setsar=1[bg]`,
    `[0:v:0]${buildScaleFilter({ width: 2048, height: 2048 }, colorConversion)},crop=2048:2048,setsar=1[fg]`,
    `[bg][fg]${finalFilters.join(",")}[v]`
  ].join(";");
}

function buildPreviewSafeAreaOverlay(targetSpec) {
  return [
    `drawbox=x=0:y=0:w=${targetSpec.width}:h=${SAFE_AREA_3X4.y}:color=black@0.30:t=fill`,
    `drawbox=x=0:y=${SAFE_AREA_3X4.y + SAFE_AREA_3X4.height}:w=${targetSpec.width}:h=${targetSpec.height - SAFE_AREA_3X4.y - SAFE_AREA_3X4.height}:color=black@0.30:t=fill`,
    `drawbox=x=${SAFE_AREA_3X4.x}:y=${SAFE_AREA_3X4.y}:w=${SAFE_AREA_3X4.width}:h=${SAFE_AREA_3X4.height}:color=red@0.85:t=8`
  ];
}

function normalizeBufferSize(bitrate) {
  const match = String(bitrate).match(/^(\d+(?:\.\d+)?)M$/i);
  if (!match) return "90M";
  return `${Math.ceil(Number(match[1]) * 2)}M`;
}

function buildEncoderRateControlArgs(encoder) {
  if (encoder.name !== "x264") return [];
  return ["-x264-params", "nal-hrd=cbr:force-cfr=1"];
}

function buildScaleFilter(targetSpec, colorConversion) {
  const matrix = colorConversion?.mode === "hdr-to-rec709" ? "" : ":out_color_matrix=bt709";
  return `scale=${targetSpec.width}:${targetSpec.height}:force_original_aspect_ratio=increase${matrix}`;
}

function buildColorConversionPieces(colorConversion, { includeFormat, pixelFormat }) {
  if (colorConversion?.mode === "hdr-to-rec709") {
    return [
      buildHdrToRec709Zscale(colorConversion),
      "format=gbrpf32le",
      "tonemap=tonemap=hable:desat=0",
      "zscale=transfer=bt709:primaries=bt709:matrix=bt709:range=tv",
      ...(includeFormat ? [`format=${pixelFormat}`] : [])
    ];
  }

  return includeFormat ? [`format=${pixelFormat}`] : [];
}

function buildHdrToRec709Zscale(colorConversion) {
  const matrix = sanitizeZscaleColorValue(colorConversion.matrix, "bt2020nc");
  const transfer = sanitizeZscaleColorValue(colorConversion.transfer, "smpte2084");
  const primaries = sanitizeZscaleColorValue(colorConversion.primaries, "bt2020");
  return [
    `zscale=matrixin=${matrix}`,
    `transferin=${transfer}`,
    `primariesin=${primaries}`,
    "transfer=linear",
    "npl=100"
  ].join(":");
}

function sanitizeZscaleColorValue(value, fallback) {
  const normalized = String(value ?? "").toLowerCase();
  return /^[a-z0-9-]+$/.test(normalized) ? normalized : fallback;
}

function assertSupportedColorConversion(colorConversion) {
  const mode = colorConversion?.mode ?? "none";
  if (mode === "none" || mode === "hdr-to-rec709") return;
  throw new Error(`Unsupported color conversion mode: ${mode}. Refusing to silently tag video as Rec.709.`);
}
