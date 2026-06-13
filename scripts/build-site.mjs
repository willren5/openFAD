import { cp, mkdir, rm, readFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const distRoot = path.join(repoRoot, 'dist')
const outRoot = path.join(repoRoot, 'dist', 'openfad-site')

async function copyRequired(source, target) {
  if (!existsSync(source)) {
    throw new Error(`Required site source is missing: ${path.relative(repoRoot, source)}`)
  }
  await cp(source, target, { recursive: true })
}

const rootPackage = JSON.parse(await readFile(path.join(repoRoot, 'package.json'), 'utf8'))
const motionWindowsName = `openFAD-Motion-Batch-${rootPackage.version}-x64.exe`
const motionMacName = `openFAD-Motion-Batch-${rootPackage.version}-arm64.dmg`

async function resolveMotionDownload({ envName, fileName, label }) {
  const configuredUrl = process.env[envName]?.trim()
  if (configuredUrl) return { url: configuredUrl, localFile: null }

  const localFile = path.join(distRoot, fileName)
  if (existsSync(localFile)) return { url: `./downloads/${fileName}`, localFile }

  throw new Error([
    `Missing Motion Batch ${label} download.`,
    `Expected ${path.relative(repoRoot, localFile)} or ${envName}.`,
    'Refusing to build a site that sends Motion Batch users to source code or dead platform links.',
  ].join(' '))
}

const motionWindowsDownload = await resolveMotionDownload({
  envName: 'OPENFAD_MOTION_WINDOWS_URL',
  fileName: motionWindowsName,
  label: 'Windows',
})
const motionMacDownload = await resolveMotionDownload({
  envName: 'OPENFAD_MOTION_MAC_URL',
  fileName: motionMacName,
  label: 'macOS',
})
await rm(outRoot, { recursive: true, force: true })
await mkdir(outRoot, { recursive: true })

const siteHtml = (await readFile(path.join(repoRoot, 'site', 'index.html'), 'utf8'))
  .replaceAll('__OPENFAD_MOTION_WINDOWS_URL__', motionWindowsDownload.url)
  .replaceAll('__OPENFAD_MOTION_MAC_URL__', motionMacDownload.url)
await writeFile(path.join(outRoot, 'index.html'), siteHtml)
await copyRequired(path.join(repoRoot, 'apps', 'cover-machine', 'index.html'), path.join(outRoot, 'cover', 'index.html'))
await copyRequired(path.join(repoRoot, 'apps', 'cover-machine', 'vendor'), path.join(outRoot, 'cover', 'vendor'))
await copyRequired(path.join(repoRoot, 'apps', 'mv-studio', 'index.html'), path.join(outRoot, 'visualizer', 'index.html'))

const coverAssets = path.join(repoRoot, 'apps', 'cover-machine', 'assets')
if (existsSync(coverAssets)) {
  await cp(coverAssets, path.join(outRoot, 'cover', 'assets'), { recursive: true })
}

const mvAssets = path.join(repoRoot, 'apps', 'mv-studio', 'assets')
if (existsSync(mvAssets)) {
  await cp(mvAssets, path.join(outRoot, 'visualizer', 'assets'), { recursive: true })
}

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

const downloadsRoot = path.join(outRoot, 'downloads')
for (const download of [motionWindowsDownload, motionMacDownload]) {
  if (!download.localFile) continue
  await mkdir(downloadsRoot, { recursive: true })
  await copyRequired(download.localFile, path.join(downloadsRoot, path.basename(download.localFile)))
}

console.log(`Built openFAD static site at ${path.relative(repoRoot, outRoot)}`)
