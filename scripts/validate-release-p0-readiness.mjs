#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()
const checks = []

function read(relativePath) {
  return readFileSync(join(root, relativePath), 'utf8')
}

function check(name, ok, details = '') {
  checks.push({ name, ok, details })
}

const packageJson = JSON.parse(read('package.json'))
const mainIndex = read('src/main/index.ts')
const appView = read('src/renderer/src/App.tsx')
const homeView = read('src/renderer/src/views/HomeView.tsx')
const runDist = read('scripts/run-dist-win.mjs')
const readme = read('README.md')
const quickstart = read('QUICKSTART.md')
const testing = read('TESTING.md')
const runTests = read('scripts/run-tests.mjs')

check('main process uses Electron single-instance lock', /app\.requestSingleInstanceLock\(\)/.test(mainIndex))
check('main process focuses existing window on second instance', /app\.on\('second-instance'/.test(mainIndex) && /mainWindow\.focus\(\)/.test(mainIndex))
check('smoke test supports isolated userData path', /NOVEL_DIRECTOR_SMOKE_USER_DATA/.test(mainIndex) && /app\.setPath\('userData'/.test(mainIndex))
check('smoke test checks preload data APIs', /api\.data\?\.load/.test(mainIndex) && /api\.data\?\.import/.test(mainIndex) && /api\.data\?\.export/.test(mainIndex))
check('smoke test checks storage path and no-key state', /api\.app\.getStoragePath/.test(mainIndex) && /api\.credentials\.hasApiKey/.test(mainIndex) && /hasApiKey/.test(mainIndex))
check('packaged smoke script exists', existsSync(join(root, 'scripts/smoke-packaged-app.mjs')))
check('package exposes smoke:packaged script', packageJson.scripts?.['smoke:packaged'] === 'node scripts/smoke-packaged-app.mjs')
check('Windows dist flow runs packaged smoke before rebuilding Node binding', /smoke-packaged-app\.mjs/.test(runDist) && /rebuild', 'better-sqlite3'/.test(runDist))
check('HomeView exposes first-launch JSON import path', /导入旧数据 JSON/.test(homeView) && /window\.novelDirector\.data\.import/.test(homeView))
check('App passes replaceData into HomeView', /<HomeView[^>]*replaceData=\{replaceData\}/s.test(appView))
check('README documents better-sqlite3 native setup', /better-sqlite3/.test(readme) && /Visual Studio C\+\+ Build Tools/.test(readme))
check('README documents packaged smoke test', /smoke:packaged/.test(readme) && /dist:win/.test(readme))
check('README documents SQLite recovery or import guidance', /SQLite/.test(readme) && /导入旧数据|Import old data|restore|recovery/i.test(readme))
check('QUICKSTART mentions first-launch import', /导入旧数据|Import old data|first launch/i.test(quickstart))
check('TESTING documents release smoke checklist', /smoke:packaged/.test(testing) && /preload API|SQLite backend|no-key/i.test(testing))
check('mojibake regression remains in npm test', /validate-no-mojibake\.mjs/.test(runTests))
check('release P0 readiness validation is in npm test', /validate-release-p0-readiness\.mjs/.test(runTests))

const failed = checks.filter((item) => !item.ok)
if (failed.length > 0) {
  console.error(JSON.stringify({ ok: false, failed }, null, 2))
  process.exit(1)
}

console.log(JSON.stringify({ ok: true, totalChecks: checks.length }, null, 2))
