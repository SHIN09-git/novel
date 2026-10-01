#!/usr/bin/env node
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const packageJson = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const electronPackage = JSON.parse(readFileSync(join(root, 'node_modules', 'electron', 'package.json'), 'utf8'))
const releaseDir = join(root, 'release')
const releaseArchiveDir = join(root, 'releases', 'archive')
const env = {
  ...process.env,
  ELECTRON_CACHE: process.env.ELECTRON_CACHE || join(root, '.electron-cache'),
  ELECTRON_BUILDER_CACHE: process.env.ELECTRON_BUILDER_CACHE || join(root, '.electron-builder-cache'),
  CSC_IDENTITY_AUTO_DISCOVERY: 'false'
}

function timestampForPath(date = new Date()) {
  return date.toISOString().replace(/[:.]/g, '-').replace('T', '_').replace('Z', '')
}

function assertManagedReleasePath(path, expectedPath, label) {
  if (resolve(path) !== resolve(expectedPath)) {
    throw new Error(`Refusing to manage unexpected ${label} path: ${path}`)
  }
}

function installerVersions(path) {
  if (!existsSync(path)) return []
  return [...new Set(
    readdirSync(path)
      .map((name) => /^Novel Director Setup (.+)\.exe$/i.exec(name)?.[1])
      .filter(Boolean)
  )]
}

function uniqueArchivePath(label) {
  mkdirSync(releaseArchiveDir, { recursive: true })
  const base = join(releaseArchiveDir, `${label}-${timestampForPath()}`)
  let candidate = base
  let suffix = 2
  while (existsSync(candidate)) {
    candidate = `${base}-${suffix}`
    suffix += 1
  }
  return candidate
}

function prepareReleaseOutput() {
  assertManagedReleasePath(releaseDir, join(root, 'release'), 'release output')
  if (!existsSync(releaseDir)) return

  const entries = readdirSync(releaseDir)
  if (entries.length === 0) {
    rmSync(releaseDir, { recursive: true, force: true })
    return
  }

  const versions = installerVersions(releaseDir)
  const onlyCurrentVersion = versions.length === 1 && versions[0] === packageJson.version
  if (onlyCurrentVersion || versions.length === 0) {
    console.log(`Replacing generated release output for version ${packageJson.version}.`)
    rmSync(releaseDir, { recursive: true, force: true })
    return
  }

  const label = versions.length === 1 ? `v${versions[0]}` : 'legacy-mixed'
  const archivePath = uniqueArchivePath(label)
  renameSync(releaseDir, archivePath)
  console.log(`Archived previous release output to ${archivePath}`)
}

function sha256(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex').toUpperCase()
}

function writeReleaseMetadata() {
  const installerName = `Novel Director Setup ${packageJson.version}.exe`
  const installerPath = join(releaseDir, installerName)
  if (!existsSync(installerPath)) {
    throw new Error(`Packaged installer was not found: ${installerPath}`)
  }

  const installerHash = sha256(installerPath)
  writeFileSync(join(releaseDir, 'SHA256SUMS.txt'), `${installerHash}  ${installerName}\n`, 'utf8')
  writeFileSync(
    join(releaseDir, 'BUILD_INFO.json'),
    `${JSON.stringify({
      version: packageJson.version,
      builtAt: new Date().toISOString(),
      electronVersion: electronPackage.version,
      installer: installerName,
      installerSha256: installerHash,
      unpackedExecutable: 'win-unpacked/Novel Director.exe',
      packagedSmokeTest: 'passed'
    }, null, 2)}\n`,
    'utf8'
  )
}

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: root,
    env,
    stdio: 'inherit',
    shell: false
  })

  if (result.error) {
    throw result.error
  }
  if (result.status !== 0) {
    const error = new Error(`${command} ${args.join(' ')} exited with code ${result.status ?? 1}`)
    error.exitCode = result.status ?? 1
    throw error
  }
}

function sleepMs(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
}

function runWithRetry(command, args, options = {}) {
  const retries = options.retries ?? 3
  const delayMs = options.delayMs ?? 2000
  let lastError = null
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      run(command, args)
      return
    } catch (error) {
      lastError = error
      if (attempt >= retries) break
      const waitMs = delayMs * (attempt + 1)
      console.warn(`${command} ${args.join(' ')} failed; retrying in ${waitMs}ms (${attempt + 1}/${retries})...`)
      sleepMs(waitMs)
    }
  }
  throw lastError
}

console.log(`Using ELECTRON_CACHE=${env.ELECTRON_CACHE}`)
console.log(`Using ELECTRON_BUILDER_CACHE=${env.ELECTRON_BUILDER_CACHE}`)

const npmCli = process.env.npm_execpath || join(dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js')
const electronRebuildCli = join(root, 'node_modules', '@electron', 'rebuild', 'lib', 'cli.js')
const electronBuilderCli = join(root, 'node_modules', 'electron-builder', 'cli.js')
const packagedSmokeScript = join(root, 'scripts', 'smoke-packaged-app.mjs')

let exitCode = 0

try {
  prepareReleaseOutput()
  run(process.execPath, [npmCli, 'run', 'build'])
  console.log(`Rebuilding better-sqlite3 for Electron ${electronPackage.version} before packaging...`)
  run(process.execPath, [electronRebuildCli, '-f', '-w', 'better-sqlite3', '--version', electronPackage.version])
  run(process.execPath, [electronBuilderCli, '--win', 'nsis'])
  run(process.execPath, [packagedSmokeScript, 'release'])
  writeReleaseMetadata()
} catch (error) {
  exitCode = Number(error?.exitCode ?? 1)
  console.error(error)
} finally {
  console.log('Restoring Node.js better-sqlite3 binding after Electron packaging...')
  try {
    runWithRetry(process.execPath, [npmCli, 'rebuild', 'better-sqlite3'], { retries: 4, delayMs: 2500 })
  } catch (restoreError) {
    console.error(restoreError)
    if (exitCode === 0) exitCode = Number(restoreError?.exitCode ?? 1)
  }
}

if (exitCode !== 0) process.exit(exitCode)
