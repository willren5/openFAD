export const APPLE_TARGETS = {
  "3x4": {
    label: "Album Page Motion Art 3x4",
    width: 2048,
    height: 2732
  },
  "1x1": {
    label: "Album Page Motion Art 1x1",
    width: 3840,
    height: 3840
  }
};

const ALLOWED_FRAME_RATES = [23.976, 24, 25, 29.97, 30];
const ALLOWED_CODECS = new Set(["h264", "prores"]);
const ALLOWED_SDR_COLOR_VALUES = new Set(["bt709", "iec61966-2-1", "srgb", "rgb"]);
const HDR_TRANSFER_VALUES = new Set(["smpte2084", "arib-std-b67"]);
const HDR_COLOR_VALUES = new Set(["bt2020", "bt2020nc"]);
const MIN_DURATION_SECONDS = 8;
const MAX_DURATION_SECONDS = 35;

export function parseRate(rate) {
  if (!rate || rate === "0/0") return null;
  if (!rate.includes("/")) return Number(rate);
  const [numerator, denominator] = rate.split("/").map(Number);
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator === 0) {
    return null;
  }
  return numerator / denominator;
}

export function isAllowedFrameRate(rate) {
  const parsed = typeof rate === "number" ? rate : parseRate(rate);
  if (!Number.isFinite(parsed)) return false;
  return ALLOWED_FRAME_RATES.some((allowed) => Math.abs(parsed - allowed) < 0.01);
}

export function selectOutputFrameRate(probe, requestedFrameRate = "auto") {
  const requested = String(requestedFrameRate || "auto").trim();
  if (requested.toLowerCase() !== "auto") return requested;
  if (!probe) return "30";

  const video = getPrimaryVideoStream(probe);
  const sourceRate = selectAllowedFrameRateCandidate(video);
  if (!sourceRate) return "30";
  return normalizeOutputFrameRate(sourceRate);
}

export function inferTargetFromProbe(probe) {
  const video = getPrimaryVideoStream(probe);
  if (!video) return null;
  return Object.entries(APPLE_TARGETS).find(([, target]) => {
    return video.width === target.width && video.height === target.height;
  })?.[0] ?? null;
}

export function validateProbe(probe, targetName) {
  const target = APPLE_TARGETS[targetName];
  if (!target) {
    throw new Error(`Unknown Apple target: ${targetName}`);
  }

  const errors = [];
  const warnings = [];
  const streams = probe.streams ?? [];
  const videoStreams = streams.filter((stream) => stream.codec_type === "video");
  const video = videoStreams[0] ?? null;
  const audioStreams = streams.filter((stream) => stream.codec_type === "audio");
  const nonVideoStreams = streams.filter((stream) => stream.codec_type !== "video" && stream.codec_type !== "audio");

  if (!video) {
    errors.push("No video stream found.");
    return { ok: false, errors, warnings, summary: {} };
  }

  if (videoStreams.length !== 1) {
    errors.push(`Exactly one video stream is required, found ${videoStreams.length}.`);
  }

  if (nonVideoStreams.length > 0) {
    const streamTypes = [...new Set(nonVideoStreams.map((stream) => stream.codec_type ?? "unknown"))].join(", ");
    errors.push(`Non-video streams are not allowed: ${streamTypes}.`);
  }

  if (audioStreams.length > 0) {
    errors.push("Audio streams are not allowed.");
  }

  if (video.width !== target.width || video.height !== target.height) {
    errors.push(`Expected ${target.width}x${target.height}, found ${video.width}x${video.height}.`);
  }

  if (video.sample_aspect_ratio && video.sample_aspect_ratio !== "1:1" && video.sample_aspect_ratio !== "N/A") {
    errors.push(`Pixel aspect ratio must be 1:1, found ${video.sample_aspect_ratio}.`);
  }

  if (!ALLOWED_CODECS.has(video.codec_name)) {
    errors.push(`Codec must be H.264 or Apple ProRes, found ${video.codec_name ?? "unknown"}.`);
  }

  const duration = getDurationSeconds(probe, video);
  if (!durationIsAppleSafe(duration)) {
    errors.push(`Duration must be between 8 and 35 seconds, found ${formatNumber(duration)} seconds.`);
  }

  const frameRate = selectAllowedFrameRateCandidate(video);
  if (!isAllowedFrameRate(frameRate)) {
    errors.push(`Frame rate must be 23.976, 24, 25, 29.97, or 30 fps, found ${formatFrameRateCandidates(video)}.`);
  }

  const bitrate = getEffectiveBitrate(probe, video);
  if (!Number.isFinite(bitrate) || bitrate < 45_000_000 || bitrate > 100_000_000) {
    errors.push(`Bitrate must be between 45 and 100 Mbps, found ${formatNumber(bitrate / 1_000_000)} Mbps.`);
  }

  if (!hasAllowedSdrColorProfile(video)) {
    errors.push("Color profile must be Rec. 709 or sRGB.");
  }

  if (video.field_order && video.field_order !== "progressive" && video.field_order !== "unknown") {
    errors.push(`Video must be progressive, found ${video.field_order}.`);
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    summary: {
      target: targetName,
      codec: video.codec_name,
      dimensions: `${video.width}x${video.height}`,
      durationSeconds: duration,
      frameRate: frameRate ? parseRate(frameRate) : null,
      bitrateMbps: Number.isFinite(bitrate) ? bitrate / 1_000_000 : null,
      color: {
        color_space: video.color_space ?? null,
        color_transfer: video.color_transfer ?? null,
        color_primaries: video.color_primaries ?? null
      }
    }
  };
}

export function validateRenderableInputProbe(probe, { requireAppleDuration = true } = {}) {
  const errors = [];
  const videoStreams = (probe.streams ?? []).filter((stream) => stream.codec_type === "video");
  const video = videoStreams[0] ?? null;

  if (videoStreams.length === 0) {
    errors.push("No video stream found.");
  } else if (videoStreams.length !== 1) {
    errors.push(`Exactly one video stream is required, found ${videoStreams.length}.`);
  }

  if (requireAppleDuration && video && videoStreams.length === 1) {
    const duration = getDurationSeconds(probe, video);
    if (!durationIsAppleSafe(duration)) {
      errors.push(`Duration must be between 8 and 35 seconds, found ${formatNumber(duration)} seconds.`);
    }
  }
  if (video && videoStreams.length === 1 && !hasAllowedSdrColorProfile(video) && !hasConvertibleHdrColorProfile(video)) {
    errors.push(`Color profile must be Rec. 709/sRGB or HDR BT.2020 PQ/HLG, found ${formatColorProfile(video)}.`);
  }

  return {
    ok: errors.length === 0,
    errors
  };
}

export function getPrimaryVideoStream(probe) {
  return (probe.streams ?? []).find((stream) => stream.codec_type === "video") ?? null;
}

export function selectColorConversion(probe) {
  const video = getPrimaryVideoStream(probe);
  if (!video || hasAllowedSdrColorProfile(video)) {
    return { mode: "none" };
  }

  if (!hasConvertibleHdrColorProfile(video)) {
    throw unsupportedInputColorError(video);
  }

  const colorSpace = normalizeColorValue(video.color_space);
  const colorTransfer = normalizeColorValue(video.color_transfer);
  const colorPrimaries = normalizeColorValue(video.color_primaries);
  return {
    mode: "hdr-to-rec709",
    matrix: colorSpace,
    transfer: colorTransfer,
    primaries: colorPrimaries
  };
}

function getDurationSeconds(probe, video) {
  for (const candidate of [video.duration, probe.format?.duration]) {
    const value = Number(candidate);
    if (Number.isFinite(value)) return value;
  }
  return null;
}

function durationIsAppleSafe(duration) {
  return Number.isFinite(duration) && duration >= MIN_DURATION_SECONDS && duration <= MAX_DURATION_SECONDS;
}

function getEffectiveBitrate(probe, video) {
  const streamBitrate = Number(video.bit_rate);
  const formatBitrate = Number(probe.format?.bit_rate);
  return Math.max(
    Number.isFinite(streamBitrate) ? streamBitrate : 0,
    Number.isFinite(formatBitrate) ? formatBitrate : 0
  );
}

function hasAllowedSdrColorProfile(video) {
  const values = getNormalizedColorProfile(video);
  return values.length === 3 && values.every((value) => ALLOWED_SDR_COLOR_VALUES.has(value));
}

function hasConvertibleHdrColorProfile(video) {
  const [colorSpace, colorTransfer, colorPrimaries] = getNormalizedColorProfile(video);
  return HDR_COLOR_VALUES.has(colorSpace)
    && HDR_TRANSFER_VALUES.has(colorTransfer)
    && HDR_COLOR_VALUES.has(colorPrimaries);
}

function getNormalizedColorProfile(video) {
  return [video.color_space, video.color_transfer, video.color_primaries]
    .filter((value) => value !== undefined && value !== null && value !== "")
    .map(normalizeColorValue);
}

function unsupportedInputColorError(video) {
  const error = new Error(`Unsupported source color profile: ${formatColorProfile(video)}. Export as Rec. 709/sRGB SDR or tagged HDR BT.2020 PQ/HLG before rendering.`);
  error.fadAppleMotionErrorKind = "unsupported-input-color";
  return error;
}

function formatColorProfile(video) {
  return [
    video.color_space ?? "unknown",
    video.color_transfer ?? "unknown",
    video.color_primaries ?? "unknown"
  ].join(" / ");
}

function normalizeColorValue(value) {
  return String(value ?? "").toLowerCase();
}

function selectAllowedFrameRateCandidate(video) {
  return [video?.avg_frame_rate, video?.r_frame_rate].find((rate) => isAllowedFrameRate(rate)) ?? null;
}

function formatFrameRateCandidates(video) {
  const candidates = [video?.avg_frame_rate, video?.r_frame_rate].filter(Boolean);
  return candidates.length > 0 ? candidates.join(" / ") : "unknown";
}

function formatNumber(value) {
  return Number.isFinite(value) ? value.toFixed(3).replace(/\.?0+$/, "") : "unknown";
}

function normalizeOutputFrameRate(rate) {
  const parsed = parseRate(rate);
  if (Math.abs(parsed - 23.976) < 0.01) return "24000/1001";
  if (Math.abs(parsed - 29.97) < 0.01) return "30000/1001";
  if (Math.abs(parsed - 24) < 0.01) return "24";
  if (Math.abs(parsed - 25) < 0.01) return "25";
  if (Math.abs(parsed - 30) < 0.01) return "30";
  return String(rate);
}
