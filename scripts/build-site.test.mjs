import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { after, before, test } from 'node:test'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const outRoot = path.join(repoRoot, 'dist', 'openfad-site')
const rootPackage = JSON.parse(readFileSync(path.join(repoRoot, 'package.json'), 'utf8'))
const motionSourceName = `openfad-motion-batch-source-${rootPackage.version}.zip`
const motionWindowsName = `openFAD-Motion-Batch-${rootPackage.version}-x64.exe`
const motionMacName = `openFAD-Motion-Batch-${rootPackage.version}-arm64.dmg`
const execFileAsync = promisify(execFile)

before(async () => {
  mkdirSync(path.join(repoRoot, 'dist'), { recursive: true })
  writeFileSync(path.join(repoRoot, 'dist', motionWindowsName), 'test windows artifact')
  writeFileSync(path.join(repoRoot, 'dist', motionMacName), 'test mac artifact')
  await execFileAsync(process.execPath, [path.join(repoRoot, 'scripts', 'build-site.mjs')], {
    cwd: repoRoot,
  })
})

after(() => {
  rmSync(path.join(repoRoot, 'dist', motionWindowsName), { force: true })
  rmSync(path.join(repoRoot, 'dist', motionMacName), { force: true })
})

test('openFAD static site build exposes direct user-facing entry points', () => {
  assert.equal(existsSync(path.join(outRoot, 'index.html')), true)
  assert.equal(existsSync(path.join(outRoot, 'cover', 'index.html')), true)
  assert.equal(existsSync(path.join(outRoot, 'cover', 'vendor', 'html2canvas.min.js')), true)
  assert.equal(existsSync(path.join(outRoot, 'cover', 'assets', 'fad-logo.png')), true)
  assert.equal(existsSync(path.join(outRoot, 'visualizer', 'index.html')), true)
  assert.equal(existsSync(path.join(outRoot, 'visualizer', 'assets', 'fad-logo.png')), true)
  assert.equal(existsSync(path.join(outRoot, 'downloads', motionWindowsName)), true)
  assert.equal(existsSync(path.join(outRoot, 'downloads', motionMacName)), true)

  const html = readFileSync(path.join(outRoot, 'index.html'), 'utf8')
  assert.equal(html.includes('href="./cover/"'), true)
  assert.equal(html.includes('href="./visualizer/"'), true)
  assert.equal(html.includes(`href="./downloads/${motionWindowsName}"`), true)
  assert.equal(html.includes(`href="./downloads/${motionMacName}"`), true)
  assert.equal(html.includes(motionSourceName), false)
  assert.equal(html.includes('__OPENFAD_MOTION_'), false)
  assert.equal(html.includes('github.com/willren5/openFAD/releases/latest'), false)
  assert.match(html, /GitHub 开源项目/)
  assert.match(html, /github-icon/)
  assert.match(html, /assets\/fad-logo\.png/)
  assert.doesNotMatch(html, /smoke evidence|SHA256|checksum|manifest|release gate|full-render|runtime|artifact|npm|index\.html|\bCI\b/i)

  const localAssetRefs = [...html.matchAll(/(?:src|href)="\.\/assets\/([^"]+)"/g)]
    .map((match) => match[1])
  assert.ok(localAssetRefs.length > 0, 'homepage should use at least one real product visual asset')

  for (const assetRef of localAssetRefs) {
    assert.equal(
      existsSync(path.join(outRoot, 'assets', assetRef)),
      true,
      `homepage asset is missing from build output: ${assetRef}`,
    )
  }
})
