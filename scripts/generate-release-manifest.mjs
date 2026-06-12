import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { access, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const dist = path.join(root, 'dist');
const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
const version = process.env.OPENFAD_RELEASE_VERSION || pkg.version;
const tag = process.env.GITHUB_REF_NAME || `v${version}`;
const repository = process.env.GITHUB_REPOSITORY || 'willren5/openFAD';

const gitStatus = () => execFileSync('git', ['status', '--short'], { cwd: root, encoding: 'utf8' }).trim();
const gitCommit = () => {
  if (process.env.GITHUB_SHA && /^[0-9a-f]{40}$/i.test(process.env.GITHUB_SHA)) return process.env.GITHUB_SHA.toLowerCase();
  return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
};

const dirtyStatus = gitStatus();
if (dirtyStatus && process.env.OPENFAD_ALLOW_DIRTY_MANIFEST !== '1') {
  console.error('Refusing to generate release manifest from a dirty worktree.');
  console.error('Commit or clean changes first, or set OPENFAD_ALLOW_DIRTY_MANIFEST=1 for a draft manifest.');
  console.error(dirtyStatus);
  process.exit(1);
}

const artifactMeta = (fileName) => {
  if (/cover-machine/.test(fileName)) {
    return {
      id: 'cover-machine-web',
      tool: 'cover-machine',
      platform: 'web',
      stability: 'Tested',
      trustScope: 'Browser web package. Open index.html locally after extracting the zip.',
      knownLimits: [
        'Browser download dispatch does not prove the operating system saved the file.',
        'FAD Records brand assets are not included or licensed by this package.'
      ]
    };
  }
  if (/mv-studio/.test(fileName)) {
    return {
      id: 'mv-studio-web',
      tool: 'mv-studio',
      platform: 'web',
      stability: 'Tested',
      trustScope: 'Browser web package. Open index.html locally after extracting the zip.',
      knownLimits: [
        'Browser recording and save behavior vary by renderer.',
        'Heavy renders should run locally in a supported desktop browser.'
      ]
    };
  }
  if (/motion-batch-source/.test(fileName)) {
    return {
      id: 'motion-batch-source',
      tool: 'motion-batch',
      platform: 'source',
      stability: 'Preview',
      trustScope: 'Source package for local UI, CLI, tests, and review.',
      knownLimits: [
        'This is not a Windows executable artifact.',
        'Windows runtime trust requires full-render smoke evidence before any Stable label.'
      ]
    };
  }
  if (/motion-batch/.test(fileName)) {
    return {
      id: 'motion-batch-windows',
      tool: 'motion-batch',
      platform: 'windows',
      stability: process.env.OPENFAD_MOTION_WINDOWS_STABLE === '1' ? 'Stable' : 'Preview',
      trustScope: 'Windows runtime artifact. Stable requires full-render smoke evidence.',
      knownLimits: [
        'Do not mark Stable unless Windows full-render smoke evidence passed.',
        'Generated deliverables must be verified to contain exactly one video stream.'
      ]
    };
  }
  throw new Error(`Cannot infer artifact metadata for ${fileName}`);
};

const files = (await readdir(dist).catch(() => []))
  .filter((name) => /\.(zip|dmg|exe|msi|tar\.gz)$/i.test(name))
  .sort();

if (!files.length) {
  console.error('No release artifacts found in dist/. Run npm run package:web first.');
  process.exit(1);
}

const artifacts = [];
for (const fileName of files) {
  const full = path.join(dist, fileName);
  const info = await stat(full);
  if (!info.isFile()) continue;
  const sha256 = createHash('sha256').update(await readFile(full)).digest('hex');
  artifacts.push({
    ...artifactMeta(fileName),
    fileName,
    sizeBytes: info.size,
    sha256,
    url: `https://github.com/${repository}/releases/download/${tag}/${fileName}`
  });
}

const existingEvidence = async (items) => {
  const kept = [];
  for (const item of items) {
    await access(path.join(root, item)).then(
      () => kept.push(item),
      () => {}
    );
  }
  return kept;
};

const manifest = {
  schemaVersion: 1,
  project: 'openFAD',
  version,
  releasedAt: new Date().toISOString(),
  commit: gitCommit(),
  license: 'Apache-2.0',
  artifacts,
  verification: {
    ciRunUrl: process.env.GITHUB_RUN_ID
      ? `https://github.com/${repository}/actions/runs/${process.env.GITHUB_RUN_ID}`
      : '',
    localEvidence: await existingEvidence([
      'docs/verification/cover-0.1.0.md',
      'docs/verification/mv-0.1.0.md',
      'docs/verification/motion-batch-0.1.0.md'
    ])
  },
  knownLimits: [
    'Browser exports can vary by browser renderer.',
    'Motion Batch heavy rendering runs locally, not on fadrecords.com.',
    'FAD Records brand assets are not granted by the code license.'
  ]
};

await writeFile(path.join(dist, 'release-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`dist/release-manifest.json ${artifacts.length} artifacts`);
