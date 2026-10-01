#!/usr/bin/env node
import { existsSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const packageJson = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const cliArgs = process.argv.slice(2)
const isDryRun = cliArgs.includes('--dry-run')
const modeArg = cliArgs.find(
  (arg) =>
    arg === 'dev' ||
    arg === 'release' ||
    arg === 'strict' ||
    arg === '--release' ||
    arg === '--strict' ||
    arg.startsWith('--mode=')
)
const requestedMode = modeArg?.startsWith('--mode=')
  ? modeArg.slice('--mode='.length)
  : modeArg === '--release'
    ? 'release'
    : modeArg === '--strict'
      ? 'strict'
      : modeArg ?? 'dev'

if (requestedMode !== 'dev' && requestedMode !== 'release' && requestedMode !== 'strict') {
  console.error('Usage: node scripts/smoke-packaged-app.mjs [dev|release|strict|--release|--strict] [--dry-run]')
  process.exit(2)
}

const unexpectedArgs = cliArgs.filter(
  (arg) =>
    arg !== 'dev' &&
    arg !== 'release' &&
    arg !== 'strict' &&
    arg !== '--release' &&
    arg !== '--strict' &&
    arg !== '--dry-run' &&
    !arg.startsWith('--mode=')
)
if (unexpectedArgs.length > 0) {
  console.error(`Unknown smoke test argument(s): ${unexpectedArgs.join(', ')}`)
  console.error('Usage: node scripts/smoke-packaged-app.mjs [dev|release|strict|--release|--strict] [--dry-run]')
  process.exit(2)
}

const packagedExe = join(root, 'release', 'win-unpacked', 'Novel Director.exe')
const packagedInstaller = join(root, 'release', `Novel Director Setup ${packageJson.version}.exe`)
const iconPng = join(root, 'build', 'icon.png')
const iconIco = join(root, 'build', 'icon.ico')
const smokeUserData = join(root, 'tmp', 'packaged-smoke-user-data')
const isReleaseMode = requestedMode === 'release' || requestedMode === 'strict'
const mode = isReleaseMode ? (requestedMode === 'strict' ? 'strict' : 'release') : 'dev'

function fail(message) {
  console.error(`Packaged smoke test failed: ${message}`)
  process.exit(1)
}

function readSmokeStoragePath() {
  const configPath = join(smokeUserData, 'app-config.json')
  if (!existsSync(configPath)) return ''
  try {
    const config = JSON.parse(readFileSync(configPath, 'utf8'))
    return typeof config.storagePath === 'string' ? config.storagePath : ''
  } catch {
    return ''
  }
}

function listSmokeUserDataFiles() {
  if (!existsSync(smokeUserData)) return ''
  try {
    return readdirSync(smokeUserData).join(', ')
  } catch {
    return ''
  }
}

if (!existsSync(packagedExe)) {
  if (!isReleaseMode) {
    console.log('Packaged smoke test skipped (dev mode): release/win-unpacked/Novel Director.exe was not found.')
    console.log('Run npm.cmd run dist:win first, or use release/strict mode for mandatory release acceptance.')
    process.exit(0)
  }
  fail(`missing release executable: ${packagedExe}`)
}

if (isReleaseMode && !existsSync(packagedInstaller)) {
  const releaseExecutables = existsSync(join(root, 'release'))
    ? readdirSync(join(root, 'release')).filter((name) => name.toLowerCase().endsWith('.exe'))
    : []
  fail(
    `missing versioned release installer: ${packagedInstaller}` +
      `${releaseExecutables.length > 0 ? `; found .exe files: ${releaseExecutables.join(', ')}` : ''}`
  )
}

if (!existsSync(iconPng)) fail('missing build/icon.png')
if (!existsSync(iconIco)) fail('missing build/icon.ico')

console.log(`Packaged smoke mode: ${mode}${isDryRun ? ' (dry run)' : ''}`)
console.log(`Release executable: ${packagedExe}`)
if (isReleaseMode) console.log(`Release installer: ${packagedInstaller}`)

if (isDryRun) {
  console.log('Packaged smoke dry check passed; Electron was not started and smoke userData was not modified.')
  process.exit(0)
}

rmSync(smokeUserData, { recursive: true, force: true })

// Packaged smoke tests run headlessly and do not need Chromium's GPU process.
// Disabling it avoids machine-specific driver/DLL failures that can mask whether
// the packaged main, preload, renderer, and SQLite startup path actually work.
const result = spawnSync(packagedExe, ['--disable-gpu', '--disable-gpu-compositing'], {
  cwd: root,
  env: {
    ...process.env,
    NOVEL_DIRECTOR_SMOKE_TEST: '1',
    NOVEL_DIRECTOR_SMOKE_USER_DATA: smokeUserData
  },
  encoding: 'utf8',
  timeout: 45_000,
  windowsHide: true
})

if (result.error) {
  fail(result.error.message)
}

if (result.status !== 0) {
  console.error(result.stdout)
  console.error(result.stderr)
  fail(`packaged app exited with code ${result.status}`)
}

const sqlitePath = join(smokeUserData, 'novel-director-data.sqlite')
if (!existsSync(sqlitePath)) {
  const actualStoragePath = readSmokeStoragePath()
  if (result.stdout) console.error(result.stdout)
  if (result.stderr) console.error(result.stderr)
  fail(
    `smoke userData did not create novel-director-data.sqlite` +
      `${actualStoragePath ? `; app storagePath was ${actualStoragePath}` : ''}` +
      `${listSmokeUserDataFiles() ? `; userData files: ${listSmokeUserDataFiles()}` : ''}`
  )
}

console.log('Packaged smoke test passed.')
