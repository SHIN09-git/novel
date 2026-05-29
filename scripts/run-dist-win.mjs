#!/usr/bin/env node
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const electronPackage = JSON.parse(readFileSync(join(root, 'node_modules', 'electron', 'package.json'), 'utf8'))
const env = {
  ...process.env,
  ELECTRON_CACHE: process.env.ELECTRON_CACHE || join(root, '.electron-cache'),
  ELECTRON_BUILDER_CACHE: process.env.ELECTRON_BUILDER_CACHE || join(root, '.electron-builder-cache'),
  CSC_IDENTITY_AUTO_DISCOVERY: 'false'
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

console.log(`Using ELECTRON_CACHE=${env.ELECTRON_CACHE}`)
console.log(`Using ELECTRON_BUILDER_CACHE=${env.ELECTRON_BUILDER_CACHE}`)

const npmCli = process.env.npm_execpath || join(dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js')
const electronRebuildCli = join(root, 'node_modules', '@electron', 'rebuild', 'lib', 'cli.js')
const electronBuilderCli = join(root, 'node_modules', 'electron-builder', 'cli.js')
const packagedSmokeScript = join(root, 'scripts', 'smoke-packaged-app.mjs')

let exitCode = 0

try {
  run(process.execPath, [npmCli, 'run', 'build'])
  console.log(`Rebuilding better-sqlite3 for Electron ${electronPackage.version} before packaging...`)
  run(process.execPath, [electronRebuildCli, '-f', '-w', 'better-sqlite3', '--version', electronPackage.version])
  run(process.execPath, [electronBuilderCli, '--win', 'nsis'])
  run(process.execPath, [packagedSmokeScript])
} catch (error) {
  exitCode = Number(error?.exitCode ?? 1)
  console.error(error)
} finally {
  console.log('Restoring Node.js better-sqlite3 binding after Electron packaging...')
  try {
    run(process.execPath, [npmCli, 'rebuild', 'better-sqlite3'])
  } catch (restoreError) {
    console.error(restoreError)
    if (exitCode === 0) exitCode = Number(restoreError?.exitCode ?? 1)
  }
}

if (exitCode !== 0) process.exit(exitCode)
