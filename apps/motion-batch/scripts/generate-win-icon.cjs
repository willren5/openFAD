#!/usr/bin/env node
"use strict";

const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const DEFAULT_SIZES = [16, 24, 32, 48, 64, 128, 256];

function generateWindowsIcon({
  projectRoot = path.resolve(__dirname, ".."),
  sourceSvg = path.join(projectRoot, "ui", "public", "favicon.svg"),
  outputIco = path.join(projectRoot, "build", "icon.ico"),
  sizes = DEFAULT_SIZES
} = {}) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "openfad-motion-icon-"));
  try {
    const images = sizes.map((size) => {
      const pngPath = path.join(tempDir, `icon-${size}.png`);
      execFileSync("sips", [
        "-z",
        String(size),
        String(size),
        "-s",
        "format",
        "png",
        sourceSvg,
        "--out",
        pngPath
      ], { stdio: "ignore" });
      return {
        size,
        data: fs.readFileSync(pngPath)
      };
    });
    const ico = buildIco(images);
    fs.mkdirSync(path.dirname(outputIco), { recursive: true });
    fs.writeFileSync(outputIco, ico);
    return { outputIco, sizes };
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

function buildIco(images) {
  if (!Array.isArray(images) || images.length === 0) {
    throw new Error("At least one PNG image is required.");
  }
  const headerSize = 6;
  const directorySize = 16 * images.length;
  let offset = headerSize + directorySize;
  const chunks = [Buffer.alloc(headerSize), Buffer.alloc(directorySize)];

  chunks[0].writeUInt16LE(0, 0);
  chunks[0].writeUInt16LE(1, 2);
  chunks[0].writeUInt16LE(images.length, 4);

  images.forEach((image, index) => {
    validateIconImage(image);
    const entry = chunks[1].subarray(index * 16, (index + 1) * 16);
    entry.writeUInt8(image.size === 256 ? 0 : image.size, 0);
    entry.writeUInt8(image.size === 256 ? 0 : image.size, 1);
    entry.writeUInt8(0, 2);
    entry.writeUInt8(0, 3);
    entry.writeUInt16LE(1, 4);
    entry.writeUInt16LE(32, 6);
    entry.writeUInt32LE(image.data.length, 8);
    entry.writeUInt32LE(offset, 12);
    chunks.push(image.data);
    offset += image.data.length;
  });

  return Buffer.concat(chunks);
}

function validateIconImage(image) {
  if (!Number.isInteger(image?.size) || image.size < 1 || image.size > 256) {
    throw new Error("Icon size must be an integer between 1 and 256.");
  }
  if (!Buffer.isBuffer(image.data) || !isPng(image.data)) {
    throw new Error(`Icon ${image.size}px is not a PNG buffer.`);
  }
}

function isPng(data) {
  return data.length >= 8
    && data[0] === 0x89
    && data[1] === 0x50
    && data[2] === 0x4e
    && data[3] === 0x47
    && data[4] === 0x0d
    && data[5] === 0x0a
    && data[6] === 0x1a
    && data[7] === 0x0a;
}

if (require.main === module) {
  const result = generateWindowsIcon();
  console.log(`Generated Windows icon: ${result.outputIco}`);
}

module.exports = {
  DEFAULT_SIZES,
  buildIco,
  generateWindowsIcon,
  isPng
};
