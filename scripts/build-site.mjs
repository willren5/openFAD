import { cp, mkdir, rm, readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { execFile } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const distRoot = path.join(repoRoot, 'dist')
const outRoot = path.join(repoRoot, 'dist', 'openfad-site')
const execFileAsync = promisify(execFile)

async function copyRequired(source, target) {
  if (!existsSync(source)) {
    throw new Error(`Required site source is missing: ${path.relative(repoRoot, source)}`)
  }
  await cp(source, target, { recursive: true })
}

const rootPackage = JSON.parse(await readFile(path.join(repoRoot, 'package.json'), 'utf8'))
const motionDownloadName = `openfad-motion-batch-source-${rootPackage.version}.zip`
const motionDownload = path.join(distRoot, motionDownloadName)
if (!existsSync(motionDownload)) {
  await execFileAsync(process.execPath, [path.join(repoRoot, 'scripts', 'package-web.mjs')], { cwd: repoRoot })
}

await rm(outRoot, { recursive: true, force: true })
await mkdir(outRoot, { recursive: true })

await copyRequired(path.join(repoRoot, 'site', 'index.html'), path.join(outRoot, 'index.html'))
await copyRequired(path.join(repoRoot, 'apps', 'cover-machine', 'index.html'), path.join(outRoot, 'cover', 'index.html'))
await copyRequired(path.join(repoRoot, 'apps', 'cover-machine', 'vendor'), path.join(outRoot, 'cover', 'vendor'))
await copyRequired(path.join(repoRoot, 'apps', 'mv-studio', 'index.html'), path.join(outRoot, 'visualizer', 'index.html'))

const siteAssets = path.join(repoRoot, 'site', 'assets')
if (existsSync(siteAssets)) {
  await cp(siteAssets, path.join(outRoot, 'assets'), { recursive: true })
}

const verificationAssets = path.join(repoRoot, 'docs', 'verification', 'artifacts')
if (existsSync(path.join(verificationAssets, 'mv-studio-preview-desktop.png'))) {
  await mkdir(path.join(outRoot, 'assets'), { recursive: true })
  await cp(
    path.join(verificationAssets, 'mv-studio-preview-desktop.png'),
    path.join(outRoot, 'assets', 'mv-studio-preview-desktop.png'),
  )
}

await mkdir(path.join(outRoot, 'downloads'), { recursive: true })
await copyRequired(motionDownload, path.join(outRoot, 'downloads', motionDownloadName))

console.log(`Built openFAD static site at ${path.relative(repoRoot, outRoot)}`)
