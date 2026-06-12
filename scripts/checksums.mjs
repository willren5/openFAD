import { createHash } from 'node:crypto';
import { readdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const dist = path.join(root, 'dist');
const skip = new Set(['SHA256SUMS', 'release-manifest.json']);

const files = (await readdir(dist).catch(() => []))
  .filter((name) => !skip.has(name))
  .sort();

const rows = [];
for (const name of files) {
  const full = path.join(dist, name);
  const info = await stat(full);
  if (!info.isFile()) continue;
  const hash = createHash('sha256').update(await readFile(full)).digest('hex');
  rows.push(`${hash}  ${name}`);
}

if (!rows.length) {
  console.error('No release artifacts found in dist/. Run npm run package:web first.');
  process.exit(1);
}

await writeFile(path.join(dist, 'SHA256SUMS'), `${rows.join('\n')}\n`);
console.log(rows.join('\n'));
