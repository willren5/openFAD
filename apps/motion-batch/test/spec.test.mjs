import test from "node:test";
import assert from "node:assert/strict";

import {
  APPLE_TARGETS,
  isAllowedFrameRate,
  selectColorConversion,
  selectOutputFrameRate,
  validateProbe,
  validateRenderableInputProbe
} from "../src/spec.mjs";

const compliantProbe = {
  streams: [
    {
      codec_type: "video",
      codec_name: "h264",
      width: 2048,
      height: 2732,
      sample_aspect_ratio: "1:1",
      avg_frame_rate: "30/1",
      bit_rate: "45000000",
      color_space: "bt709",
      color_transfer: "bt709",
      color_primaries: "bt709",
      pix_fmt: "yuv420p",
      duration: "15.1"
    }
  ],
  format: {
    duration: "15.1",
    bit_rate: "45500000"
  }
};

test("defines Apple Music 3x4 and 1x1 target dimensions", () => {
  assert.deepEqual(APPLE_TARGETS["3x4"], {
    label: "Album Page Motion Art 3x4",
    width: 2048,
    height: 2732
  });
  assert.deepEqual(APPLE_TARGETS["1x1"], {
    label: "Album Page Motion Art 1x1",
    width: 3840,
    height: 3840
  });
});

test("accepts only Apple allowed frame rates", () => {
  assert.equal(isAllowedFrameRate("24000/1001"), true);
  assert.equal(isAllowedFrameRate("24/1"), true);
  assert.equal(isAllowedFrameRate("25/1"), true);
  assert.equal(isAllowedFrameRate("30000/1001"), true);
  assert.equal(isAllowedFrameRate("30/1"), true);
  assert.equal(isAllowedFrameRate("60/1"), false);
});

test("passes a compliant 3x4 probe", () => {
  const result = validateProbe(compliantProbe, "3x4");
  assert.equal(result.ok, true);
  assert.deepEqual(result.errors, []);
});

test("rejects audio, wrong dimensions, low bitrate, and bad color metadata", () => {
  const badProbe = structuredClone(compliantProbe);
  badProbe.streams[0].width = 2000;
  badProbe.streams[0].bit_rate = "20000000";
  badProbe.streams[0].color_space = "bt601";
  badProbe.format.bit_rate = "20000000";
  badProbe.streams.push({ codec_type: "audio", codec_name: "aac" });

  const result = validateProbe(badProbe, "3x4");
  assert.equal(result.ok, false);
  assert.match(result.errors.join("\n"), /Expected 2048x2732/);
  assert.match(result.errors.join("\n"), /Audio streams are not allowed/);
  assert.match(result.errors.join("\n"), /Bitrate must be between 45 and 100 Mbps/);
  assert.match(result.errors.join("\n"), /Color profile must be Rec. 709 or sRGB/);
});

test("reports audio streams once instead of duplicating them as generic non-video streams", () => {
  const probe = structuredClone(compliantProbe);
  probe.streams.push({ codec_type: "audio", codec_name: "aac" });

  const result = validateProbe(probe, "3x4");
  const message = result.errors.join("\n");

  assert.equal(result.ok, false);
  assert.match(message, /Audio streams are not allowed/);
  assert.doesNotMatch(message, /Non-video streams are not allowed/);
});

test("rejects outputs that contain anything other than one video stream", () => {
  const probe = structuredClone(compliantProbe);
  probe.streams.push({ codec_type: "data", codec_tag_string: "tmcd" });
  probe.streams.push({
    ...structuredClone(compliantProbe.streams[0]),
    index: 2
  });

  const result = validateProbe(probe, "3x4");
  assert.equal(result.ok, false);
  assert.match(result.errors.join("\n"), /Exactly one video stream is required/);
  assert.match(result.errors.join("\n"), /Non-video streams are not allowed/);
});

test("renderable input validation rejects unsafe full-render durations only when required", () => {
  const probe = structuredClone(compliantProbe);
  probe.streams[0].duration = "3600";
  probe.format.duration = "3600";

  const fullRender = validateRenderableInputProbe(probe);
  assert.equal(fullRender.ok, false);
  assert.match(fullRender.errors.join("\n"), /Duration must be between 8 and 35 seconds/);

  const previewOnly = validateRenderableInputProbe(probe, { requireAppleDuration: false });
  assert.equal(previewOnly.ok, true);
  assert.deepEqual(previewOnly.errors, []);
});

test("renderable input validation falls back to format duration when stream duration is not numeric", () => {
  const probe = structuredClone(compliantProbe);
  probe.streams[0].duration = "N/A";
  probe.format.duration = "15.1";

  const result = validateRenderableInputProbe(probe);
  assert.equal(result.ok, true);
  assert.deepEqual(result.errors, []);

  const outputValidation = validateProbe(probe, "3x4");
  assert.equal(outputValidation.ok, true);
  assert.deepEqual(outputValidation.errors, []);
  assert.equal(outputValidation.summary.durationSeconds, 15.1);
});

test("selects HDR to Rec.709 conversion for BT.2020 PQ sources", () => {
  const hdrProbe = structuredClone(compliantProbe);
  hdrProbe.streams[0].color_space = "bt2020nc";
  hdrProbe.streams[0].color_transfer = "smpte2084";
  hdrProbe.streams[0].color_primaries = "bt2020";

  assert.deepEqual(selectColorConversion(hdrProbe), {
    mode: "hdr-to-rec709",
    matrix: "bt2020nc",
    transfer: "smpte2084",
    primaries: "bt2020"
  });
});

test("does not convert already compliant Rec.709 sources", () => {
  assert.deepEqual(selectColorConversion(compliantProbe), { mode: "none" });
});

test("rejects non-HDR non-Rec.709 color instead of tagging it as Rec.709", () => {
  const probe = structuredClone(compliantProbe);
  probe.streams[0].color_space = "bt470bg";
  probe.streams[0].color_transfer = "bt709";
  probe.streams[0].color_primaries = "bt470bg";

  const renderable = validateRenderableInputProbe(probe);
  assert.equal(renderable.ok, false);
  assert.match(renderable.errors.join("\n"), /Color profile must be Rec\. 709\/sRGB or HDR/);
  assert.throws(() => selectColorConversion(probe), (error) => {
    assert.equal(error.fadAppleMotionErrorKind, "unsupported-input-color");
    assert.match(error.message, /Unsupported source color profile/);
    return true;
  });
});

test("rejects missing source color metadata instead of assuming Rec.709", () => {
  const probe = structuredClone(compliantProbe);
  delete probe.streams[0].color_space;
  delete probe.streams[0].color_transfer;
  delete probe.streams[0].color_primaries;

  const renderable = validateRenderableInputProbe(probe);
  assert.equal(renderable.ok, false);
  assert.match(renderable.errors.join("\n"), /Color profile must be Rec\. 709\/sRGB or HDR/);
});

test("auto output frame rate preserves an Apple-allowed source frame rate", () => {
  const probe = structuredClone(compliantProbe);
  probe.streams[0].avg_frame_rate = "24/1";
  assert.equal(selectOutputFrameRate(probe, "auto"), "24");
});

test("auto output frame rate preserves exact fractional Apple rates", () => {
  const probe = structuredClone(compliantProbe);
  probe.streams[0].avg_frame_rate = "30000/1001";
  assert.equal(selectOutputFrameRate(probe, "auto"), "30000/1001");
});

test("auto output frame rate falls back to Apple-allowed r_frame_rate when avg_frame_rate is invalid", () => {
  const probe = structuredClone(compliantProbe);
  probe.streams[0].avg_frame_rate = "0/0";
  probe.streams[0].r_frame_rate = "24000/1001";
  assert.equal(selectOutputFrameRate(probe, "auto"), "24000/1001");
});

test("auto output frame rate falls back to 30 for unsupported source rates", () => {
  const probe = structuredClone(compliantProbe);
  probe.streams[0].avg_frame_rate = "60/1";
  assert.equal(selectOutputFrameRate(probe, "auto"), "30");
});

test("validates Apple-allowed r_frame_rate when avg_frame_rate is invalid", () => {
  const probe = structuredClone(compliantProbe);
  probe.streams[0].avg_frame_rate = "0/0";
  probe.streams[0].r_frame_rate = "24000/1001";

  const result = validateProbe(probe, "3x4");
  assert.equal(result.ok, true);
  assert.deepEqual(result.errors, []);
  assert.equal(result.summary.frameRate, 24000 / 1001);
});

test("manual output frame rate overrides auto source preservation", () => {
  const probe = structuredClone(compliantProbe);
  probe.streams[0].avg_frame_rate = "24/1";
  assert.equal(selectOutputFrameRate(probe, "30"), "30");
});
