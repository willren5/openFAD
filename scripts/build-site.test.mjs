import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { test } from 'node:test'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const outRoot = path.join(repoRoot, 'dist', 'openfad-site')
const rootPackage = JSON.parse(readFileSync(path.join(repoRoot, 'package.json'), 'utf8'))
const motionDownloadName = `openfad-motion-batch-source-${rootPackage.version}.zip`

test('openFAD static site build exposes direct user-facing entry points', () => {
  assert.equal(existsSync(path.join(outRoot, 'index.html')), true)
  assert.equal(existsSync(path.join(outRoot, 'cover', 'index.html')), true)
  assert.equal(existsSync(path.join(outRoot, 'cover', 'vendor', 'html2canvas.min.js')), true)
  assert.equal(existsSync(path.join(outRoot, 'visualizer', 'index.html')), true)
  assert.equal(existsSync(path.join(outRoot, 'downloads', motionDownloadName)), true)

  const html = readFileSync(path.join(outRoot, 'index.html'), 'utf8')
  assert.equal(html.includes('href="./cover/"'), true)
  assert.equal(html.includes('href="./visualizer/"'), true)
  assert.equal(html.includes(`href="./downloads/${motionDownloadName}"`), true)
  assert.equal(html.includes('github.com/willren5/openFAD/releases/latest'), false)
  assert.match(html, /GitHub 开源项目/)
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
