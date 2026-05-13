#!/usr/bin/env node
import { existsSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const packagedExe = join(root, 'release', 'win-unpacked', 'Novel Director.exe')
const iconPng = join(root, 'build', 'icon.png')
const iconIco = join(root, 'build', 'icon.ico')
const smokeUserData = join(root, 'tmp', 'packaged-smoke-user-data')

function fail(message) {
  console.error(`Packaged smoke test failed: ${message}`)
  process.exit(1)
}

if (!existsSync(iconPng)) fail('missing build/icon.png')
if (!existsSync(iconIco)) fail('missing build/icon.ico')

if (!existsSync(packagedExe)) {
  console.log('Packaged smoke test skipped: release/win-unpacked/Novel Director.exe was not found.')
  console.log('Run npm.cmd run dist:win first to build and smoke-test the packaged app.')
  process.exit(0)
}

rmSync(smokeUserData, { recursive: true, force: true })

const result = spawnSync(packagedExe, [], {
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
  fail('smoke userData did not create novel-director-data.sqlite')
}

console.log('Packaged smoke test passed.')
