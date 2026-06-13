import { cp, mkdir, readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const version = JSON.parse(await readFile(path.join(repoRoot, 'package.json'), 'utf8')).version

export function motionRuntimeTarget({ platform, root = repoRoot, releaseVersion = version } = {}) {
  if (platform === 'windows') {
    const fileName = `openFAD-Motion-Batch-${releaseVersion}-x64.exe`
    return {
      source: path.join(root, 'apps', 'motion-batch', 'dist', 'windows', fileName),
      fileName,
    }
  }
  if (platform === 'macos') {
    const fileName = `openFAD-Motion-Batch-${releaseVersion}-arm64.dmg`
    return {
      source: path.join(root, 'apps', 'motion-batch', 'dist', 'macos', fileName),
      fileName,
    }
  }
  throw new Error(`Unknown Motion Batch runtime platform: ${platform || '(missing)'}`)
}

export async function copyMotionRuntime({ platform, root = repoRoot, releaseVersion = version } = {}) {
  const target = motionRuntimeTarget({ platform, root, releaseVersion })
  const source = target.source
  const info = await stat(source).catch(() => null)
  if (!info?.isFile()) {
    throw new Error(`Missing Motion Batch ${platform} artifact: ${path.relative(root, source)}`)
  }

  const destination = path.join(root, 'dist', target.fileName)
  await mkdir(path.dirname(destination), { recursive: true })
  await cp(source, destination)
  return { source, destination, size: info.size }
}

function parsePlatform(argv) {
  const index = argv.indexOf('--platform')
  if (index === -1) return ''
  return argv[index + 1] || ''
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const result = await copyMotionRuntime({ platform: parsePlatform(process.argv.slice(2)) })
  console.log(`Copied ${path.relative(repoRoot, result.source)} -> ${path.relative(repoRoot, result.destination)} (${result.size} bytes)`)
}
