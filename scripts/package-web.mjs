import { mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateRawSync } from 'node:zlib';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const dist = path.join(root, 'dist');

const version = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8')).version;
const rootReleaseFiles = ['LICENSE', 'TRADEMARKS.md', 'NOTICE'];

const packages = [
  {
    tool: 'cover-machine',
    source: path.join(root, 'apps/cover-machine'),
    fileName: `openfad-cover-machine-${version}.zip`,
    include: ['index.html', 'README.md', 'docs', 'vendor', 'assets']
  },
  {
    tool: 'mv-studio',
    source: path.join(root, 'apps/mv-studio'),
    fileName: `openfad-mv-studio-${version}.zip`,
    include: ['index.html', 'README.md', 'docs', 'package.json', 'assets']
  },
  {
    tool: 'motion-batch',
    source: path.join(root, 'apps/motion-batch'),
    fileName: `openfad-motion-batch-source-${version}.zip`,
    include: ['README.md', 'DESIGN.md', 'docs', 'package.json', 'package-lock.json', 'src', 'ui', 'desktop', 'scripts', 'test']
  }
];

const crcTable = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
  return c >>> 0;
});

const crc32 = (buffer) => {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
};

const dosDateTime = (date = new Date('2026-01-01T00:00:00.000Z')) => {
  const year = Math.max(1980, date.getUTCFullYear());
  const dosTime = (date.getUTCHours() << 11) | (date.getUTCMinutes() << 5) | Math.floor(date.getUTCSeconds() / 2);
  const dosDate = ((year - 1980) << 9) | ((date.getUTCMonth() + 1) << 5) | date.getUTCDate();
  return { dosTime, dosDate };
};

const writeU16 = (buffer, at, value) => buffer.writeUInt16LE(value, at);
const writeU32 = (buffer, at, value) => buffer.writeUInt32LE(value >>> 0, at);

const listFiles = async (source, include) => {
  const files = [];
  const walk = async (full, prefix) => {
    const info = await stat(full);
    if (info.isDirectory()) {
      for (const entry of await readdir(full, { withFileTypes: true })) {
        if (entry.name === '.DS_Store') continue;
        await walk(path.join(full, entry.name), path.posix.join(prefix, entry.name));
      }
      return;
    }
    if (info.isFile()) files.push({ full, zipPath: prefix });
  };

  for (const item of include) {
    await walk(path.join(source, item), item);
  }
  return files.sort((a, b) => a.zipPath.localeCompare(b.zipPath));
};

const listRootReleaseFiles = async () => {
  const files = [];
  for (const item of rootReleaseFiles) {
    const full = path.join(root, item);
    const info = await stat(full).catch(() => null);
    if (info?.isFile()) files.push({ full, zipPath: item });
  }
  return files;
};

const zip = async (entries) => {
  const localParts = [];
  const centralParts = [];
  let offset = 0;
  const { dosTime, dosDate } = dosDateTime();

  for (const entry of entries) {
    const data = await readFile(entry.full);
    const compressed = deflateRawSync(data, { level: 9 });
    const nameBytes = Buffer.from(entry.zipPath, 'utf8');
    const checksum = crc32(data);

    const local = Buffer.alloc(30 + nameBytes.length);
    writeU32(local, 0, 0x04034b50);
    writeU16(local, 4, 20);
    writeU16(local, 6, 0x0800);
    writeU16(local, 8, 8);
    writeU16(local, 10, dosTime);
    writeU16(local, 12, dosDate);
    writeU32(local, 14, checksum);
    writeU32(local, 18, compressed.length);
    writeU32(local, 22, data.length);
    writeU16(local, 26, nameBytes.length);
    writeU16(local, 28, 0);
    nameBytes.copy(local, 30);
    localParts.push(local, compressed);

    const central = Buffer.alloc(46 + nameBytes.length);
    writeU32(central, 0, 0x02014b50);
    writeU16(central, 4, 20);
    writeU16(central, 6, 20);
    writeU16(central, 8, 0x0800);
    writeU16(central, 10, 8);
    writeU16(central, 12, dosTime);
    writeU16(central, 14, dosDate);
    writeU32(central, 16, checksum);
    writeU32(central, 20, compressed.length);
    writeU32(central, 24, data.length);
    writeU16(central, 28, nameBytes.length);
    writeU16(central, 30, 0);
    writeU16(central, 32, 0);
    writeU16(central, 34, 0);
    writeU16(central, 36, 0);
    writeU32(central, 38, 0);
    writeU32(central, 42, offset);
    nameBytes.copy(central, 46);
    centralParts.push(central);
    offset += local.length + compressed.length;
  }

  const centralSize = centralParts.reduce((sum, part) => sum + part.length, 0);
  const end = Buffer.alloc(22);
  writeU32(end, 0, 0x06054b50);
  writeU16(end, 8, entries.length);
  writeU16(end, 10, entries.length);
  writeU32(end, 12, centralSize);
  writeU32(end, 16, offset);
  writeU16(end, 20, 0);

  return Buffer.concat([...localParts, ...centralParts, end]);
};

await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });

for (const item of packages) {
  const files = [
    ...await listFiles(item.source, item.include),
    ...await listRootReleaseFiles()
  ].sort((a, b) => a.zipPath.localeCompare(b.zipPath));
  if (!files.length) throw new Error(`No files selected for ${item.tool}`);
  const bytes = await zip(files);
  await writeFile(path.join(dist, item.fileName), bytes);
  console.log(`${item.fileName} ${bytes.length} bytes ${files.length} files`);
}
