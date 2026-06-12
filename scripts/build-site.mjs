import { cp, mkdir, rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const outRoot = path.join(repoRoot, 'dist', 'openfad-site')

async function copyRequired(source, target) {
  if (!existsSync(source)) {
    throw new Error(`Required site source is missing: ${path.relative(repoRoot, source)}`)
  }
  await cp(source, target, { recursive: true })
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

console.log(`Built openFAD static site at ${path.relative(repoRoot, outRoot)}`)
