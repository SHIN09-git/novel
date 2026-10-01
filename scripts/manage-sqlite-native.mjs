#!/usr/bin/env node
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const mode = process.argv[2] ?? 'help'
const electronPackage = JSON.parse(readFileSync(join(root, 'node_modules', 'electron', 'package.json'), 'utf8'))
const npmCli = process.env.npm_execpath || join(dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js')
const electronRebuildCli = join(root, 'node_modules', '@electron', 'rebuild', 'lib', 'cli.js')
const electronCli = join(root, 'node_modules', 'electron', 'cli.js')
const nodeBinding = join(root, 'node_modules', 'better-sqlite3', 'build', 'Release', 'better_sqlite3.node')
const packagedBinding = join(
  root,
  'release',
  'win-unpacked',
  'resources',
  'app.asar.unpacked',
  'node_modules',
  'better-sqlite3',
  'build',
  'Release',
  'better_sqlite3.node'
)

const env = {
  ...process.env,
  ELECTRON_CACHE: process.env.ELECTRON_CACHE || join(root, '.electron-cache'),
  ELECTRON_BUILDER_CACHE: process.env.ELECTRON_BUILDER_CACHE || join(root, '.electron-builder-cache'),
  CSC_IDENTITY_AUTO_DISCOVERY: 'false'
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: root,
    env,
    stdio: options.stdio ?? 'inherit',
    shell: false
  })
  if (result.error) throw result.error
  if (result.status !== 0) {
    const error = new Error(`${command} ${args.join(' ')} exited with code ${result.status ?? 1}`)
    error.exitCode = result.status ?? 1
    error.stdout = result.stdout?.toString?.() ?? ''
    error.stderr = result.stderr?.toString?.() ?? ''
    throw error
  }
  return result
}

function probeScript(kind) {
  const probePath = join(root, 'tmp', `probe-better-sqlite3-${kind}.cjs`)
  mkdirSync(dirname(probePath), { recursive: true })
  writeFileSync(
    probePath,
    [
      "const Database = require('better-sqlite3')",
      "const db = new Database(':memory:')",
      "db.prepare('select 1 as ok').get()",
      'db.close()',
      "console.log('better-sqlite3 probe ok')",
      "if (process.versions.electron) require('electron').app.quit()"
    ].join('\n'),
    'utf8'
  )
  return probePath
}

function checkNode() {
  run(process.execPath, [probeScript('node')])
}

function checkElectron() {
  run(process.execPath, [electronCli, probeScript('electron')])
}

function rebuildElectron() {
  console.log(`Rebuilding better-sqlite3 for Electron ${electronPackage.version}...`)
  run(process.execPath, [electronRebuildCli, '-f', '-w', 'better-sqlite3', '--version', electronPackage.version])
}

function copyPackagedElectronBinding() {
  if (!existsSync(packagedBinding)) {
    throw new Error(
      `Packaged Electron better-sqlite3 binding was not found at ${packagedBinding}. Run npm.cmd run dist:win once, or install Visual Studio C++ Build Tools and rerun native:electron.`
    )
  }
  mkdirSync(dirname(nodeBinding), { recursive: true })
  copyFileSync(packagedBinding, nodeBinding)
  console.log(`Copied Electron better-sqlite3 binding from ${packagedBinding}`)
}

function ensureElectron() {
  try {
    rebuildElectron()
  } catch (error) {
    console.warn('Electron rebuild failed. Trying packaged Electron binding fallback.')
    console.warn(String(error?.message ?? error))
    copyPackagedElectronBinding()
  }
  checkElectron()
  console.log('better-sqlite3 is ready for Electron preview/package runtime.')
}

function ensureNode() {
  console.log('Rebuilding better-sqlite3 for local Node.js scripts...')
  run(process.execPath, [npmCli, 'rebuild', 'better-sqlite3'])
  checkNode()
  console.log('better-sqlite3 is ready for Node.js CLI/tests.')
}

try {
  if (mode === 'electron') {
    ensureElectron()
  } else if (mode === 'node') {
    ensureNode()
  } else if (mode === 'check-electron') {
    checkElectron()
  } else if (mode === 'check-node') {
    checkNode()
  } else {
    console.log('Usage: node scripts/manage-sqlite-native.mjs <electron|node|check-electron|check-node>')
  }
} catch (error) {
  console.error(error)
  process.exit(Number(error?.exitCode ?? 1))
}
