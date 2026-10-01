#!/usr/bin/env node
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const checks = []

function read(relativePath) {
  return readFileSync(join(root, relativePath), 'utf8')
}

function check(name, ok, details = '') {
  checks.push({ name, ok, details })
}

function listMjsFiles(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const absolutePath = join(dir, entry)
    const stats = statSync(absolutePath)
    if (stats.isDirectory()) {
      listMjsFiles(absolutePath, out)
    } else if (entry.endsWith('.mjs')) {
      out.push(absolutePath)
    }
  }
  return out
}

const packageJson = JSON.parse(read('package.json'))
const mainIndex = read('src/main/index.ts')
const appView = read('src/renderer/src/App.tsx')
const homeView = read('src/renderer/src/views/HomeView.tsx')
const runDist = read('scripts/run-dist-win.mjs')
const smokePreview = read('scripts/run-smoke-preview.mjs')
const readme = read('README.md')
const quickstart = read('QUICKSTART.md')
const testing = read('TESTING.md')
const runTests = read('scripts/run-tests.mjs')
const rcRegression = read('scripts/rc-regression.mjs')
const publicReleaseCleanup = read('scripts/validate-public-release-cleanup.mjs')
const mojibakeValidator = read('scripts/validate-no-mojibake.mjs')
const sqliteValidator = read('scripts/validate-sqlite-storage.mjs')
const secureCredentialsValidator = read('scripts/validate-secure-credentials.mjs')
const electronSecurityValidator = read('scripts/validate-electron-security-p0.mjs')
const repoRootUtility = read('scripts/utils/repo-root.mjs')
const cwdRootScripts = listMjsFiles(join(root, 'scripts'))
  .map((absolutePath) => ({
    relativePath: relative(root, absolutePath).replaceAll('\\', '/'),
    source: readFileSync(absolutePath, 'utf8')
  }))
  .filter((item) => /const root = (?:resolve\(['"]\.['"]\)|process\.cwd\(\))/.test(item.source))
  .map((item) => item.relativePath)

check('main process uses Electron single-instance lock', /app\.requestSingleInstanceLock\(\)/.test(mainIndex))
check('main process focuses existing window on second instance', /app\.on\('second-instance'/.test(mainIndex) && /mainWindow\.focus\(\)/.test(mainIndex))
check('smoke test supports isolated userData path', /NOVEL_DIRECTOR_SMOKE_USER_DATA/.test(mainIndex) && /app\.setPath\('userData'/.test(mainIndex))
check('smoke test checks preload data APIs', /api\.data\?\.load/.test(mainIndex) && /api\.data\?\.import/.test(mainIndex) && /api\.data\?\.export/.test(mainIndex))
check('smoke test checks storage path and no-key state', /api\.app\.getStoragePath/.test(mainIndex) && /api\.credentials\.hasApiKey/.test(mainIndex) && /hasApiKey/.test(mainIndex))
check('packaged smoke script exists', existsSync(join(root, 'scripts/smoke-packaged-app.mjs')))
check('package exposes smoke:packaged script', packageJson.scripts?.['smoke:packaged'] === 'node scripts/smoke-packaged-app.mjs')
check('package exposes isolated preview smoke script', packageJson.scripts?.smoke === 'node scripts/run-smoke-preview.mjs')
check('package exposes native binding switch scripts', packageJson.scripts?.['native:electron'] && packageJson.scripts?.['native:node'] && packageJson.scripts?.['preview:sqlite'])
check('preview smoke script uses isolated userData path', /NOVEL_DIRECTOR_SMOKE_USER_DATA/.test(smokePreview) && /preview-smoke-user-data/.test(smokePreview))
check('preview smoke script switches better-sqlite3 to Electron and restores Node binding', /manage-sqlite-native\.mjs/.test(smokePreview) && /'electron'/.test(smokePreview) && /'node'/.test(smokePreview))
check('preview smoke script verifies SQLite backend creation', /novel-director-data\.sqlite/.test(smokePreview) && /smoke userData did not create novel-director-data\.sqlite/.test(smokePreview))
check('preview smoke failure path throws so native binding restore still runs', /function fail\(message\)[\s\S]*throw error/.test(smokePreview) && !/function fail\(message\)[\s\S]*process\.exit\(1\)/.test(smokePreview))
check('Windows dist flow runs packaged smoke before rebuilding Node binding', /smoke-packaged-app\.mjs/.test(runDist) && /rebuild', 'better-sqlite3'/.test(runDist))
check('HomeView exposes a queued JSON import path', /导入 JSON/.test(homeView) && /importData\(strategy\)/.test(homeView) && !/window\.novelDirector/.test(homeView))
check('HomeView merges into non-empty workspaces instead of receiving destructive replaceData', /data\.projects\.length > 0 \? 'merge' : 'replace'/.test(homeView) && /<HomeView[^>]*importData=\{importStoredData\}/s.test(appView) && !/<HomeView[^>]*replaceData=/s.test(appView))
check('README documents better-sqlite3 native setup', /better-sqlite3/.test(readme) && /Visual Studio C\+\+ Build Tools/.test(readme) && /native:electron/.test(readme) && /native:node/.test(readme))
check('README documents packaged smoke test', /smoke:packaged/.test(readme) && /dist:win/.test(readme))
check('README documents SQLite recovery or import guidance', /SQLite/.test(readme) && /导入旧数据|Import old data|restore|recovery/i.test(readme))
check('QUICKSTART mentions first-launch import', /导入旧数据|Import old data|first launch/i.test(quickstart))
check('QUICKSTART teaches AI API setup', /Base URL/.test(quickstart) && /Model Name|模型名/.test(quickstart) && /API Key/.test(quickstart) && /\/chat\/completions/.test(quickstart))
check('QUICKSTART teaches project data and revision workflow', /各资料模块|Minimum Project Data/.test(quickstart) && /怎么修订|Revision Workbench|修订工作台/.test(quickstart))
check('QUICKSTART provides new-book and existing-manuscript onboarding routes', /从零新建还是接着旧稿写|从零新建|已有小说续写/.test(quickstart) && /当前截面/.test(quickstart))
check('QUICKSTART explains first-run AI settings beyond credentials', /第一次配置的推荐值/.test(quickstart) && /默认 token 预算/.test(quickstart) && /默认 Prompt 模式/.test(quickstart) && /AI 自动总结/.test(quickstart))
check('QUICKSTART separates required, relevant, and deferred project data', /必写、按需写、以后再写/.test(quickstart) && /生成前必写/.test(quickstart) && /暂时不要写/.test(quickstart))
check('QUICKSTART includes an end-to-end synthetic project fixture', /一套可直接照填的最小示例/.test(quickstart) && /\u3010动态状态\u3011/.test(quickstart) && /\u3010第 1 章任务\u3011/.test(quickstart))
check('QUICKSTART gives click-by-click pipeline and revision guidance', /第一次在生产流水线里怎么点/.test(quickstart) && /先判断问题属于哪一层/.test(quickstart) && /修复角色状态连续性/.test(quickstart))
check('TESTING documents release smoke checklist', /smoke:packaged/.test(testing) && /preload API|SQLite backend|no-key/i.test(testing))
check('mojibake regression remains in npm test', /validate-no-mojibake\.mjs/.test(runTests))
check('release P0 readiness validation is in npm test', /validate-release-p0-readiness\.mjs/.test(runTests))
check('test runner uses repository root cwd for every validation script', /const root = dirname\(scriptsDir\)/.test(runTests) && /cwd: root/.test(runTests))
check('RC regression fixture self-locates repository root', /fileURLToPath\(import\.meta\.url\)/.test(rcRegression) && /const root = dirname\(dirname\(fileURLToPath\(import\.meta\.url\)\)\)/.test(rcRegression))
check('release readiness and cleanup validators self-locate repository root', /fileURLToPath\(import\.meta\.url\)/.test(publicReleaseCleanup) && /dirname\(dirname\(fileURLToPath\(import\.meta\.url\)\)\)/.test(publicReleaseCleanup))
check('mojibake validator self-locates repository root and scans scripts', /fileURLToPath\(import\.meta\.url\)/.test(mojibakeValidator) && /'scripts'/.test(mojibakeValidator))
check('SQLite storage validator self-locates repository root', /fileURLToPath\(import\.meta\.url\)/.test(sqliteValidator) && /dirname\(dirname\(fileURLToPath\(import\.meta\.url\)\)\)/.test(sqliteValidator))
check('secure credentials validator self-locates repository root', /fileURLToPath\(import\.meta\.url\)/.test(secureCredentialsValidator) && /dirname\(dirname\(fileURLToPath\(import\.meta\.url\)\)\)/.test(secureCredentialsValidator))
check('Electron security validator self-locates repository root', /fileURLToPath\(import\.meta\.url\)/.test(electronSecurityValidator) && /dirname\(dirname\(fileURLToPath\(import\.meta\.url\)\)\)/.test(electronSecurityValidator))
check('shared repo-root helper self-locates from import.meta.url', /fileURLToPath\(import\.meta\.url\)/.test(repoRootUtility) && /export const repoRoot/.test(repoRootUtility))
check('validation scripts do not derive repository root from cwd', cwdRootScripts.length === 0, cwdRootScripts.join(', '))

const failed = checks.filter((item) => !item.ok)
if (failed.length > 0) {
  console.error(JSON.stringify({ ok: false, failed }, null, 2))
  process.exit(1)
}

console.log(JSON.stringify({ ok: true, totalChecks: checks.length }, null, 2))
