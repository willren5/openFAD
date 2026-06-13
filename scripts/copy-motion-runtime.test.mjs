import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { copyMotionRuntime, motionRuntimeTarget } from './copy-motion-runtime.mjs'

test('copyMotionRuntime stages Windows and macOS runtime artifacts into root dist', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'openfad-motion-copy-'))
  const releaseVersion = '9.9.9'
  const windows = motionRuntimeTarget({ platform: 'windows', root, releaseVersion })
  const macos = motionRuntimeTarget({ platform: 'macos', root, releaseVersion })

  await mkdir(path.dirname(windows.source), { recursive: true })
  await mkdir(path.dirname(macos.source), { recursive: true })
  await writeFile(windows.source, 'windows runtime')
  await writeFile(macos.source, 'mac runtime')

  const copiedWindows = await copyMotionRuntime({ platform: 'windows', root, releaseVersion })
  const copiedMac = await copyMotionRuntime({ platform: 'macos', root, releaseVersion })

  assert.equal(path.basename(copiedWindows.destination), 'openFAD-Motion-Batch-9.9.9-x64.exe')
  assert.equal(path.basename(copiedMac.destination), 'openFAD-Motion-Batch-9.9.9-arm64.dmg')
  assert.equal(await readFile(copiedWindows.destination, 'utf8'), 'windows runtime')
  assert.equal(await readFile(copiedMac.destination, 'utf8'), 'mac runtime')
})
