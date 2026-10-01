#!/usr/bin/env node
import { existsSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const smokeUserData = join(root, 'tmp', 'preview-smoke-user-data')

const npmCli = process.env.npm_execpath || join(dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js')
const nativeManager = join(root, 'scripts', 'manage-sqlite-native.mjs')

function fail(message) {
  const error = new Error(`Preview smoke test failed: ${message}`)
  error.exitCode = 1
  throw error
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: root,
    env: options.env ?? process.env,
    stdio: options.stdio ?? 'inherit',
    shell: false,
    encoding: options.encoding
  })
  if (result.error) throw result.error
  if (result.status !== 0) {
    const error = new Error(`${command} ${args.join(' ')} exited with code ${result.status ?? 1}`)
    error.exitCode = result.status ?? 1
    error.stdout = result.stdout
    error.stderr = result.stderr
    throw error
  }
  return result
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

let exitCode = 0

try {
  rmSync(smokeUserData, { recursive: true, force: true })
  run(process.execPath, [nativeManager, 'electron'])
  run(process.execPath, [npmCli, 'exec', 'electron-vite', 'preview'], {
    env: {
      ...process.env,
      NOVEL_DIRECTOR_SMOKE_TEST: '1',
      NOVEL_DIRECTOR_SMOKE_USER_DATA: smokeUserData
    }
  })

  const sqlitePath = join(smokeUserData, 'novel-director-data.sqlite')
  if (!existsSync(sqlitePath)) {
    const actualStoragePath = readSmokeStoragePath()
    fail(
      `smoke userData did not create novel-director-data.sqlite` +
        `${actualStoragePath ? `; app storagePath was ${actualStoragePath}` : ''}` +
        `${listSmokeUserDataFiles() ? `; userData files: ${listSmokeUserDataFiles()}` : ''}`
    )
  }

  console.log('Preview smoke test passed.')
} catch (error) {
  exitCode = Number(error?.exitCode ?? 1)
  console.error(error)
} finally {
  try {
    run(process.execPath, [nativeManager, 'node'])
  } catch (restoreError) {
    console.error(restoreError)
    if (exitCode === 0) exitCode = Number(restoreError?.exitCode ?? 1)
  }
}

if (exitCode !== 0) process.exit(exitCode)
