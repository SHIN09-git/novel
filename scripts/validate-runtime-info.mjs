#!/usr/bin/env node
import { mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'
import { repoRoot } from './utils/repo-root.mjs'

const root = repoRoot
const tempDir = join(root, 'tmp', 'validation', 'runtime-info')

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

async function bundle(relativePath, name, define = {}) {
  const outfile = join(tempDir, name)
  await build({
    entryPoints: [join(root, relativePath)],
    outfile,
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node22',
    logLevel: 'silent',
    define
  })
  return import(`${pathToFileURL(outfile).href}?t=${Date.now()}-${name}`)
}

async function main() {
  await rm(tempDir, { recursive: true, force: true })
  await mkdir(tempDir, { recursive: true })
  const [{ collectCurrentRuntimeInfo, collectRuntimeInfo, formatRuntimeMode, resolveRuntimeMode }, { loadRuntimeInfo }] = await Promise.all([
    bundle('src/main/RuntimeInfoService.ts', 'runtime-info.mjs', {
      __NOVEL_DIRECTOR_BUILD_TIME__: JSON.stringify('2026-09-06T01:02:03.000Z')
    }),
    bundle('src/renderer/src/platform/runtimeInfoBridge.ts', 'runtime-info-bridge.mjs')
  ])

  const development = collectRuntimeInfo({
    version: '0.1.5', buildTime: '2026-09-06T00:00:00.000Z', electronVersion: '39.2.7',
    execPath: 'C:\\Program Files\\Novel Director\\Novel Director.exe', isPackaged: false, rendererUrl: 'http://localhost:5173'
  })
  assert(development.mode === 'development', 'renderer URL selects development mode')
  assert(development.version === '0.1.5' && development.buildTime.endsWith('Z'), 'runtime info preserves version and UTC build time')
  assert(development.electronVersion === '39.2.7' && development.execPath.includes('Novel Director.exe'), 'runtime info preserves Electron version and executable path')
  const injected = collectCurrentRuntimeInfo({ getVersion: () => '0.1.5', isPackaged: false })
  assert(injected.buildTime === '2026-09-06T01:02:03.000Z', 'main service reads the UTC build time injected by the main bundle')

  assert(resolveRuntimeMode({ isPackaged: false }) === 'preview', 'unpackaged process without renderer URL selects preview mode')
  assert(resolveRuntimeMode({ isPackaged: true, rendererUrl: 'http://ignored' }) === 'packaged', 'packaged process always selects packaged mode')
  assert(formatRuntimeMode('packaged') === '桌面发行版', 'packaged mode uses the non-speculative desktop distribution label')

  const currentBridgeResult = await loadRuntimeInfo({ app: { getRuntimeInfo: async () => development } })
  assert(currentBridgeResult?.version === '0.1.5', 'current bridge resolves runtime info through the optional app method')
  assert(await loadRuntimeInfo({ app: {} }) === null, 'old bridge without runtime method remains compatible')
  assert(await loadRuntimeInfo(undefined) === null, 'missing bridge remains compatible')

  console.log('Runtime info validation passed: 10 checks.')
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
