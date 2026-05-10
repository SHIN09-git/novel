#!/usr/bin/env node
import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
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
    console.error(result.error)
    process.exit(1)
  }
  if (result.status !== 0) {
    process.exit(result.status ?? 1)
  }
}

console.log(`Using ELECTRON_CACHE=${env.ELECTRON_CACHE}`)
console.log(`Using ELECTRON_BUILDER_CACHE=${env.ELECTRON_BUILDER_CACHE}`)

const npmCli = process.env.npm_execpath || join(dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js')
const electronBuilderCli = join(root, 'node_modules', 'electron-builder', 'cli.js')

run(process.execPath, [npmCli, 'run', 'build'])
run(process.execPath, [electronBuilderCli, '--win', 'nsis'])
console.log('Restoring Node.js better-sqlite3 binding after Electron packaging...')
run(process.execPath, [npmCli, 'rebuild', 'better-sqlite3'])
