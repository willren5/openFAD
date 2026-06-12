import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { scanPublicSafety } from './scan-public-safety.mjs';

test('scanner rejects private paths and secret-looking content', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'openfad-scan-'));
  try {
    const privatePath = `/${'Users'}/alex/Desktop/openfad.mov`;
    const windowsPrivatePath = `C:\\${'Users'}\\alex\\Desktop\\openfad.mov`;
    const secretName = 'openai_api_key';
    await writeFile(path.join(root, 'bad.md'), `local path ${privatePath}\nwindows path ${windowsPrivatePath}\n${secretName}=abc`);
    const result = await scanPublicSafety(root);
    assert.equal(result.ok, false);
    assert.deepEqual(result.findings.map((finding) => finding.id).sort(), [
      'credential-assignment',
      'local-user-path',
      'windows-user-path'
    ]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('scanner ignores dependency and build directories', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'openfad-scan-'));
  try {
    await mkdir(path.join(root, 'node_modules'), { recursive: true });
    await writeFile(path.join(root, 'node_modules', 'bad.md'), `${'openai_api_key'.toUpperCase()}=abc`);
    await writeFile(path.join(root, 'README.md'), '# safe');
    const result = await scanPublicSafety(root);
    assert.equal(result.ok, true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('scanner allows ordinary process env access without env file references', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'openfad-scan-'));
  try {
    await writeFile(path.join(root, 'release.mjs'), 'const tag = process.env.GITHUB_REF_NAME || "v0.1.0";\nconst tokenLabel = "overwrite confirmation token";');
    const result = await scanPublicSafety(root);
    assert.equal(result.ok, true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('scanner ignores escaped redaction assertions while rejecting real path literals', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'openfad-scan-'));
  try {
    await writeFile(path.join(root, 'test.mjs'), String.raw`assert.doesNotMatch(text, /\/Users\/alex|private/);`);
    const escaped = await scanPublicSafety(root);
    assert.equal(escaped.ok, true);

    await writeFile(path.join(root, 'bad.md'), `raw ${`/${'Users'}/alex/clip.mov`}`);
    const result = await scanPublicSafety(root);
    assert.equal(result.ok, false);
    assert.equal(result.findings.some((finding) => finding.id === 'local-user-path'), true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('scanner rejects private brand literals in public source', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'openfad-scan-'));
  try {
    await mkdir(path.join(root, 'apps', 'mv-studio'), { recursive: true });
    const privateArtist = ['artist', ": '", 'FAD', "'"].join('');
    await writeFile(
      path.join(root, 'apps', 'mv-studio', 'index.html'),
      [
        'console.log("[FAD][INFO] bad prefix");',
        'const fileName = "demo_FAD.webm";',
        'const label = "FAD Records Release";',
        privateArtist
      ].join('\n')
    );
    const result = await scanPublicSafety(root);
    assert.equal(result.ok, false);
    assert.equal(result.findings.every((finding) => finding.id === 'private-brand-literal'), true);
    assert.equal(result.findings.length, 4);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('scanner allows openFAD identity and FAD Records legal disclaimers', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'openfad-scan-'));
  try {
    await writeFile(
      path.join(root, 'README.md'),
      [
        'openFAD 是 FAD Records 发起的开源工具。',
        '代码开源不代表 FAD Records 品牌资产开源。',
        'const label = "openFAD Public Release";'
      ].join('\n')
    );
    const result = await scanPublicSafety(root);
    assert.equal(result.ok, true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
